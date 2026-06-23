import { PROTOCOL_VERSION } from '@vtt/shared';
import type { ClientMessage, ServerMessage } from '@vtt/shared';
import { useStore } from '../store';

const PING_INTERVAL_MS = 25_000;
const SILENCE_TIMEOUT_MS = 45_000;
const BACKOFF_STEPS = [1000, 2000, 4000, 8000, 15000];

export class TableConnection {
  private ws: WebSocket | null = null;
  private campaignId: string | null = null;
  private pingTimer: ReturnType<typeof setInterval> | null = null;
  private silenceTimer: ReturnType<typeof setTimeout> | null = null;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private reconnectAttempt = 0;
  private intentionalClose = false;
  private lastMessageTime = 0;

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

  send(msg: ClientMessage): void {
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(msg));
    }
  }

  // --------------------------------------------------------------------------
  // Internal
  // --------------------------------------------------------------------------

  private _openSocket(): void {
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
      this._startPing();
      this.send({
        type: 'join',
        protocolVersion: PROTOCOL_VERSION,
        campaignId: this.campaignId!,
      });
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
        store.setConnection('open');
        store.setSelf({ userId: msg.userId, username: msg.username, role: msg.role });
        store.setLastErrorMessage(null);
        this.reconnectAttempt = 0;
        break;

      case 'snapshot':
        store.applySnapshot(msg);
        break;

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
        store.setMediaSync(msg.assetId, { action: msg.action, time: msg.time, atMs: Date.now() });
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

      case 'pong':
        // heartbeat acknowledged — silence timer already reset on message receipt
        break;

      default:
        // Unknown message type — ignore for forward-compat
        break;
    }
  }

  private _startPing(): void {
    this._stopPing();
    this.pingTimer = setInterval(() => {
      this.send({ type: 'ping', sentAt: Date.now() });
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
