import { PROTOCOL_VERSION, isDurableMessage, randomId } from '@vtt/shared';
import type { ClientMessage, ServerMessage, ServerCommandAckPayload } from '@vtt/shared';
import { useStore } from '../store';
import { clockSample } from '../lib/media';

const PING_INTERVAL_MS = 25_000;
const SILENCE_TIMEOUT_MS = 45_000;
const BACKOFF_STEPS = [1000, 2000, 4000, 8000, 15000];
const COMMAND_TIMEOUT_MS = 15_000;
export type DurableCommand = Exclude<ClientMessage, { type: 'join' | 'ping' | 'measure' }>;

export class CommandError extends Error {
  constructor(message: string, readonly code: string, readonly uncertain = false) { super(message); }
}

function reportCommandError(error: CommandError): void {
  useStore.setState({ lastErrorMessage: error.message, saveOutcome: error.uncertain ? 'unconfirmed' : 'failed' });
}

/** Await this for editors/actions that must retain input until confirmed. */
export function sendCommand(msg: DurableCommand): Promise<ServerCommandAckPayload> {
  const connection = (window as unknown as { __vttConn?: TableConnection }).__vttConn;
  if (connection) return connection.send(msg);
  const error = new CommandError('Not connected. Your change was not sent.', 'OFFLINE');
  reportCommandError(error);
  return Promise.reject(error);
}

/** Non-editor actions still report failures, without unhandled rejected promises. */
export function sendWs(msg: ClientMessage): void {
  const connection = (window as unknown as { __vttConn?: TableConnection }).__vttConn;
  if (connection) void connection.send(msg).catch(() => {});
  else if (isDurableMessage(msg)) reportCommandError(new CommandError('Not connected. Your change was not sent.', 'OFFLINE'));
}

export class TableConnection {
  private ws: WebSocket | null = null;
  private campaignId: string | null = null;
  private pingTimer: ReturnType<typeof setInterval> | null = null;
  private silenceTimer: ReturnType<typeof setTimeout> | null = null;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private reconnectAttempt = 0;
  private intentionalClose = false;
  private lastMessageTime = 0;
  private ready = false;
  private pendingPings = new Set<number>();
  private clockSamples: Array<{ rtt: number; offset: number }> = [];
  private pending = new Map<string, {
    resolve: (ack: ServerCommandAckPayload) => void;
    reject: (error: CommandError) => void;
    timer: ReturnType<typeof setTimeout>;
  }>();

  // --------------------------------------------------------------------------
  // Public API
  // --------------------------------------------------------------------------

  connect(campaignId: string): void {
    this.campaignId = campaignId;
    this.intentionalClose = false;
    this.reconnectAttempt = 0;
    this._openSocket();

    window.addEventListener('online', this._handleOnline);
    document.addEventListener('visibilitychange', this._handleVisibility);
  }

  disconnect(): void {
    this.intentionalClose = true;
    this._cleanup();
    useStore.getState().setConnection('closed');

    window.removeEventListener('online', this._handleOnline);
    document.removeEventListener('visibilitychange', this._handleVisibility);
  }

  send(msg: DurableCommand): Promise<ServerCommandAckPayload>;
  send(msg: ClientMessage): Promise<ServerCommandAckPayload | void>;
  send(msg: ClientMessage): Promise<ServerCommandAckPayload | void> {
    const durable = isDurableMessage(msg);
    if (this.ws?.readyState !== WebSocket.OPEN || (durable && !this.ready)) {
      const error = new CommandError('Reconnecting. Your change was not sent; try again when connected.', 'OFFLINE');
      if (durable) reportCommandError(error);
      return Promise.reject(error);
    }
    if (!durable) {
      // Transient traffic has no durable acknowledgment and is never retained.
      try { this.ws.send(JSON.stringify(msg)); return Promise.resolve(); }
      catch { return Promise.reject(new CommandError('Connection interrupted.', 'OFFLINE')); }
    }
    const requestId = msg.requestId ?? randomId('req');
    const payload = JSON.stringify({ ...msg, requestId });
    if (new TextEncoder().encode(payload).byteLength > 1024 * 1024) {
      const error = new CommandError('Change is too large to send. Shorten the text before saving; your draft is kept.', 'TOO_LARGE');
      reportCommandError(error);
      return Promise.reject(error);
    }
    if (this.pending.has(requestId)) {
      const error = new CommandError('This action is already pending.', 'PENDING');
      reportCommandError(error);
      return Promise.reject(error);
    }
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.rejectPending();
        this.ws?.close();
      }, COMMAND_TIMEOUT_MS);
      this.pending.set(requestId, { resolve, reject, timer });
      useStore.setState({ pendingCommands: this.pending.size });
      try { this.ws!.send(payload); }
      catch { this.rejectPending(); this.ws?.close(); }
    });
  }

  private rejectPending(): void {
    this.ready = false;
    const error = new CommandError('Connection interrupted. An action may already have saved. Review the table after reconnecting before trying it again.', 'UNCONFIRMED', true);
    if (this.pending.size) reportCommandError(error);
    for (const pending of this.pending.values()) {
      clearTimeout(pending.timer);
      pending.reject(error);
    }
    this.pending.clear();
    useStore.setState({ pendingCommands: 0 });
  }

  // --------------------------------------------------------------------------
  // Internal
  // --------------------------------------------------------------------------

  private _openSocket(): void {
    this.rejectPending();
    this.pendingPings.clear();
    this.clockSamples = [];
    useStore.setState({ clockOffsetMs: null });
    if (this.ws) {
      this.ws.onopen = null;
      this.ws.onmessage = null;
      this.ws.onclose = null;
      this.ws.onerror = null;
      this.ws.close();
      this.ws = null;
    }

    const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
    const url = `${proto}//${location.host}/ws`;

    useStore.getState().setConnection(this.reconnectAttempt === 0 ? 'connecting' : 'reconnecting');

    const ws = new WebSocket(url);
    this.ws = ws;
    this.lastMessageTime = Date.now();

    ws.onopen = () => {
      this._resetSilenceTimer();
      void this.send({
        type: 'join',
        protocolVersion: PROTOCOL_VERSION,
        campaignId: this.campaignId!,
      }).catch(() => {});
    };

    ws.onmessage = (evt) => {
      this.lastMessageTime = Date.now();
      this._resetSilenceTimer();

      let msg: unknown;
      try {
        msg = JSON.parse(evt.data as string);
      } catch {
        return;
      }

      this._dispatch(msg as ServerMessage);
    };

    ws.onclose = () => {
      this.rejectPending();
      this._stopPing();
      this._clearSilenceTimer();
      if (!this.intentionalClose) {
        this._scheduleReconnect();
      }
    };

    ws.onerror = () => {
      // onclose will fire after onerror; handled there
    };
  }

  private _dispatch(msg: ServerMessage): void {
    const store = useStore.getState();

    switch (msg.type) {
      case 'joined':
        store.setSelf({ userId: msg.userId, username: msg.username, role: msg.role });
        this._startPing();
        this._sendPing();
        break;

      case 'snapshot':
        store.applySnapshot(msg);
        this.ready = true;
        this.reconnectAttempt = 0;
        store.setConnection('open');
        break;

      case 'commandAck': {
        const pending = this.pending.get(msg.requestId);
        if (!pending) break;
        clearTimeout(pending.timer);
        this.pending.delete(msg.requestId);
        useStore.setState((s) => ({ pendingCommands: this.pending.size, saveOutcome: s.lastErrorMessage ? s.saveOutcome : 'saved' }));
        pending.resolve(msg);
        break;
      }

      case 'presence':
        store.setPresence(msg.entries);
        break;

      case 'boardUpdated':
        store.setBoard(msg.items);
        break;

      case 'settingsUpdated':
        store.setUploadsLocked(msg.uploadsLocked);
        break;

      case 'mapLockUpdated':
        store.setMapLocked(msg.locked);
        break;

      case 'rollResult':
        store.addRollEntry(msg.entry);
        break;

      case 'assetsUpdated':
        store.setAssets(msg.assets);
        break;

      case 'documentsUpdated':
        store.setDocuments(msg.documents);
        break;

      case 'documentShared':
        // Audio lives in the bottom dock, not a floating panel.
        if (msg.asset.mime.startsWith('audio/')) {
          store.openAudioDock(msg.asset.id);
        } else {
          store.openDocPanel(msg.asset);
        }
        break;

      case 'noteSaved':
        store.upsertNote(msg.note);
        break;

      case 'noteDeleted':
        store.removeNote(msg.noteId);
        break;

      case 'chaptersUpdated':
        store.setChapters(msg.chapters);
        break;

      case 'charactersUpdated':
        store.setCharacters(msg.characters);
        break;

      case 'tokensUpdated':
        store.setTokens(msg.tokens);
        break;

      case 'gridUpdated':
        store.setGrid(msg.grid);
        break;

      case 'piecesUpdated':
        store.setPieces(msg.pieces);
        break;

      case 'aoesUpdated':
        store.setAoes(msg.aoes);
        break;

      case 'initiativeUpdated':
        store.setInitiative(msg.initiative);
        break;

      case 'mapMetaUpdated':
        store.setMapMeta(msg.mapMeta);
        break;

      case 'templatesUpdated':
        store.setTemplates(msg.templates);
        break;

      case 'measureShared':
        if (msg.kind === 'clear') {
          store.clearSharedMeasure(msg.by);
        } else {
          store.setSharedMeasure(msg.by, {
            kind: msg.kind,
            x1: msg.x1, y1: msg.y1, x2: msg.x2, y2: msg.y2,
            by: msg.by,
          });
        }
        break;

      case 'mediaControl': {
        // Record the table-playback state — the audio dock follows it
        // (including docks that mount later, e.g. via the auto-open below).
        store.setMediaSync(msg.assetId, { action: msg.action, time: msg.time, atMs: msg.atMs });
        if (msg.action === 'play') {
          store.openAudioDock(msg.assetId);
        } else if (msg.action === 'stop') {
          if (useStore.getState().audioDock?.assetId === msg.assetId) {
            store.closeAudioDock();
          }
        }
        break;
      }

      case 'error': {
        if (msg.requestId) {
          const pending = this.pending.get(msg.requestId);
          if (pending) {
            const error = new CommandError(msg.message, msg.code);
            clearTimeout(pending.timer);
            this.pending.delete(msg.requestId);
            useStore.setState({ pendingCommands: this.pending.size });
            reportCommandError(error);
            pending.reject(error);
          }
        }
        const authCodes: string[] = ['NOT_MEMBER', 'FORBIDDEN', 'PROTOCOL_MISMATCH'];
        if (msg.fatal) {
          this.intentionalClose = true;
          this._cleanup();
          store.setConnection('closed');
          store.setLastErrorMessage(msg.message);
          if (authCodes.includes(msg.code)) {
            store.setRoute('login');
          } else {
            store.setRoute('lobby');
          }
        } else {
          store.setLastErrorMessage(msg.message);
        }
        break;
      }

      case 'pong': {
        if (!this.pendingPings.delete(msg.sentAt) || !Number.isFinite(msg.serverAt)) break;
        const sample = clockSample(msg.sentAt, Date.now(), msg.serverAt);
        if (sample.rtt < 0 || sample.rtt > 10_000) break;
        this.clockSamples = [...this.clockSamples.slice(-4), sample];
        const best = this.clockSamples.reduce((a, b) => a.rtt < b.rtt ? a : b);
        useStore.setState({ clockOffsetMs: best.offset });
        break;
      }

      default:
        // Unknown message type — ignore for forward-compat
        break;
    }
  }

  private _sendPing(): void {
    const sentAt = Date.now();
    this.pendingPings.clear();
    this.pendingPings.add(sentAt);
    void this.send({ type: 'ping', sentAt }).catch(() => this.pendingPings.delete(sentAt));
  }

  private _startPing(): void {
    this._stopPing();
    this.pingTimer = setInterval(() => {
      this._sendPing();
    }, PING_INTERVAL_MS);
  }

  private _stopPing(): void {
    if (this.pingTimer !== null) {
      clearInterval(this.pingTimer);
      this.pingTimer = null;
    }
  }

  private _resetSilenceTimer(): void {
    this._clearSilenceTimer();
    this.silenceTimer = setTimeout(() => {
      // Silence too long — force reconnect
      if (!this.intentionalClose) {
        this.ws?.close();
      }
    }, SILENCE_TIMEOUT_MS);
  }

  private _clearSilenceTimer(): void {
    if (this.silenceTimer !== null) {
      clearTimeout(this.silenceTimer);
      this.silenceTimer = null;
    }
  }

  private _scheduleReconnect(): void {
    if (this.intentionalClose) return;
    const delay = BACKOFF_STEPS[Math.min(this.reconnectAttempt, BACKOFF_STEPS.length - 1)] ?? 15000;
    this.reconnectAttempt++;
    useStore.getState().setConnection('reconnecting');
    this.reconnectTimer = setTimeout(() => {
      if (!this.intentionalClose && this.campaignId) {
        this._openSocket();
      }
    }, delay);
  }

  private _handleOnline = (): void => {
    if (!this.intentionalClose && this.campaignId) {
      if (this.reconnectTimer !== null) {
        clearTimeout(this.reconnectTimer);
        this.reconnectTimer = null;
      }
      this.reconnectAttempt = 0;
      this._openSocket();
    }
  };

  private _handleVisibility = (): void => {
    if (document.visibilityState === 'visible' && !this.intentionalClose && this.campaignId) {
      const silentFor = Date.now() - this.lastMessageTime;
      if (silentFor > SILENCE_TIMEOUT_MS) {
        if (this.reconnectTimer !== null) {
          clearTimeout(this.reconnectTimer);
          this.reconnectTimer = null;
        }
        this.reconnectAttempt = 0;
        this._openSocket();
      }
    }
  };

  private _cleanup(): void {
    this.rejectPending();
    this._stopPing();
    this._clearSilenceTimer();
    if (this.reconnectTimer !== null) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    if (this.ws) {
      this.ws.onopen = null;
      this.ws.onmessage = null;
      this.ws.onclose = null;
      this.ws.onerror = null;
      this.ws.close();
      this.ws = null;
    }
  }
}
