import { WebSocketServer, WebSocket } from 'ws';
import type { IncomingMessage } from 'node:http';
import type { Duplex } from 'node:stream';
import { resolveSessionFromCookieHeader } from '../auth/sessions.js';
import { findUserById } from '../auth/users.js';
import { getCampaign } from '../campaign/registry.js';
import { log } from '../log.js';
import { handleMessage } from './handlers.js';
import type { Role, ServerMessage, PresenceEntry } from '@vtt/shared';

export interface WsSession {
  id: string; // random session key for room membership
  ws: WebSocket;
  userId: string;
  username: string;
  campaignId: string | null;
  role: Role | null;
  isAlive: boolean;
}

// Singleton WSS. maxPayload bounds a single frame (default is 100 MiB) so a
// member cannot spike memory with a giant message.
export const wss = new WebSocketServer({ noServer: true, maxPayload: 1024 * 1024 });
const sessions = new Map<string, WsSession>();

let sessionCounter = 0;

// Heartbeat interval: ping every 30s, terminate if no pong within 45s.
const PING_INTERVAL = 30_000;
const PONG_TIMEOUT = 45_000;

setInterval(() => {
  const now = Date.now();
  for (const sess of sessions.values()) {
    if (!sess.isAlive) {
      log.debug(`Terminating unresponsive WS session for ${sess.username}`);
      sess.ws.terminate();
      continue;
    }
    sess.isAlive = false;
    sess.ws.ping();

    // Schedule pong timeout check.
    setTimeout(() => {
      if (!sess.isAlive) {
        sess.ws.terminate();
      }
    }, PONG_TIMEOUT - PING_INTERVAL);
  }
}, PING_INTERVAL);

export function handleUpgrade(req: IncomingMessage, socket: Duplex, head: Buffer): void {
  const url = req.url ?? '';
  if (url !== '/ws' && !url.startsWith('/ws?')) {
    socket.write('HTTP/1.1 404 Not Found\r\n\r\n');
    socket.destroy();
    return;
  }

  const session = resolveSessionFromCookieHeader(req.headers.cookie);
  if (!session) {
    socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n');
    socket.destroy();
    return;
  }

  const user = findUserById(session.userId);
  if (!user) {
    socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n');
    socket.destroy();
    return;
  }

  wss.handleUpgrade(req, socket, head, (ws) => {
    const sessId = `ws_${++sessionCounter}`;
    const wsSession: WsSession = {
      id: sessId,
      ws,
      userId: user.id,
      username: user.username,
      campaignId: null,
      role: null,
      isAlive: true,
    };
    sessions.set(sessId, wsSession);

    ws.on('pong', () => {
      wsSession.isAlive = true;
    });

    ws.on('close', () => {
      const campaignId = wsSession.campaignId;
      sessions.delete(sessId);

      if (campaignId) {
        const entry = getCampaign(campaignId);
        if (entry) {
          entry.room.delete(sessId);
          broadcastPresenceWithDisconnected(campaignId, wsSession.userId, wsSession.username, wsSession.role);
        }
      }
    });

    // Registered synchronously so a message sent immediately after connect is
    // not missed. (Circular import is safe: handleMessage is only called here,
    // after module init, and handlers reference hub helpers at call time too.)
    ws.on('message', (data) => {
      try {
        const text = data.toString();
        const msg = JSON.parse(text) as unknown;
        handleMessage(wsSession, msg).catch((err: unknown) => {
          log.error(`Unhandled ws handler error: ${String(err)}`);
        });
      } catch {
        log.warn(`WS received non-JSON message from ${wsSession.username}`);
      }
    });
  });
}

export function send(ws: WebSocket, msg: ServerMessage): void {
  if (ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify(msg));
  }
}

export function getSessionsInRoom(campaignId: string): WsSession[] {
  // Use the campaign's room set (O(room) lookups) instead of scanning every
  // session across all campaigns on each broadcast.
  const entry = getCampaign(campaignId);
  if (!entry) return [];
  const out: WsSession[] = [];
  for (const sessId of entry.room) {
    const sess = sessions.get(sessId);
    if (sess && sess.ws.readyState === WebSocket.OPEN) out.push(sess);
  }
  return out;
}

export function broadcast(
  campaignId: string,
  msg: ServerMessage,
  filter?: (sess: WsSession) => boolean,
): void {
  for (const sess of getSessionsInRoom(campaignId)) {
    if (filter && !filter(sess)) continue;
    send(sess.ws, msg);
  }
}

export function broadcastPresence(campaignId: string): void {
  const roomSessions = getSessionsInRoom(campaignId);

  // Deduplicate by userId: connected=true if any open socket.
  const presenceMap = new Map<string, PresenceEntry>();
  for (const sess of roomSessions) {
    if (!presenceMap.has(sess.userId) && sess.role) {
      presenceMap.set(sess.userId, {
        userId: sess.userId,
        username: sess.username,
        role: sess.role,
        connected: true,
      });
    }
  }

  const entries = [...presenceMap.values()];
  broadcast(campaignId, { type: 'presence', entries });
}

/**
 * Broadcast presence after a disconnect: includes the disconnecting user with
 * connected=false unless another socket for that user is still open.
 */
export function broadcastPresenceWithDisconnected(
  campaignId: string,
  disconnectedUserId: string,
  disconnectedUsername: string,
  disconnectedRole: Role | null,
): void {
  const roomSessions = getSessionsInRoom(campaignId);

  const presenceMap = new Map<string, PresenceEntry>();
  for (const sess of roomSessions) {
    if (!presenceMap.has(sess.userId) && sess.role) {
      presenceMap.set(sess.userId, {
        userId: sess.userId,
        username: sess.username,
        role: sess.role,
        connected: true,
      });
    }
  }

  // Add the disconnected user if no remaining socket covers them and they had a role.
  if (!presenceMap.has(disconnectedUserId) && disconnectedRole) {
    presenceMap.set(disconnectedUserId, {
      userId: disconnectedUserId,
      username: disconnectedUsername,
      role: disconnectedRole,
      connected: false,
    });
  }

  const entries = [...presenceMap.values()];
  broadcast(campaignId, { type: 'presence', entries });
}

export function getPresenceEntries(campaignId: string): PresenceEntry[] {
  const roomSessions = getSessionsInRoom(campaignId);
  const presenceMap = new Map<string, PresenceEntry>();
  for (const sess of roomSessions) {
    if (!presenceMap.has(sess.userId) && sess.role) {
      presenceMap.set(sess.userId, {
        userId: sess.userId,
        username: sess.username,
        role: sess.role,
        connected: true,
      });
    }
  }
  return [...presenceMap.values()];
}
