/** Exercise the actual hub send path with controlled socket backpressure. */
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import type WebSocket from 'ws';
import type { ServerMessage } from '../packages/shared/src/index.js';
import { send, closeWebSockets } from '../packages/server/src/ws/hub.js';

class Peer extends EventEmitter {
  readyState = 1;
  bufferedAmount = 128 * 1024;
  sent: ServerMessage[] = [];
  afterSend?: () => void;
  fail = false;
  send(data: string): void {
    if (this.fail) throw new Error('injected preview send failure');
    this.sent.push(JSON.parse(data));
    this.afterSend?.();
  }
  close(): void { this.readyState = 3; this.emit('close'); }
}
const pause = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
const write = (peer: Peer, message: ServerMessage) => send(peer as unknown as WebSocket, message);
const preview = (peer: Peer, by: string, x2: number) => write(peer, { type: 'measureShared', kind: 'ruler', by, x1: 0, y1: 0, x2, y2: 0 });

async function main(): Promise<void> {
  try {
    const peer = new Peer();
    for (let i = 0; i < 1000; i++) { preview(peer, 'first', i); preview(peer, 'second', i); }
    write(peer, { type: 'measureShared', kind: 'clear', by: 'first' });
    write(peer, { type: 'commandAck', requestId: 'durable' });
    write(peer, { type: 'tokensUpdated', tokens: [] });
    assert.deepEqual(peer.sent.map((message) => message.type), ['commandAck', 'tokensUpdated']);
    peer.bufferedAmount = 0;
    await pause(80);
    assert.deepEqual(peer.sent.slice(2), [
      { type: 'measureShared', kind: 'clear', by: 'first' },
      { type: 'measureShared', kind: 'ruler', by: 'second', x1: 0, y1: 0, x2: 999, y2: 0 },
    ]);
    await pause(80);
    assert.equal(peer.sent.length, 4);
    console.log('PASS 1: slow peers retain latest endpoint/clear per origin, while durable messages send normally');

    const partial = new Peer();
    preview(partial, 'first', 1); preview(partial, 'second', 2);
    partial.afterSend = () => { partial.bufferedAmount = 128 * 1024; };
    partial.bufferedAmount = 0;
    await pause(80);
    assert.equal(partial.sent.length, 1);
    preview(partial, 'second', 3);
    partial.afterSend = undefined; partial.bufferedAmount = 0;
    await pause(80);
    assert.equal(partial.sent.length, 2);
    assert.equal((partial.sent[1] as { x2: number }).x2, 3);
    console.log('PASS 2: pressure returning mid-flush retains and supersedes the remaining preview');

    const closed = new Peer();
    preview(closed, 'first', 1);
    assert.equal(closed.listenerCount('close'), 1);
    closed.close(); closed.bufferedAmount = 0;
    await pause(80);
    assert.equal(closed.sent.length, 0);
    assert.equal(closed.listenerCount('close'), 0);
    const failed = new Peer();
    preview(failed, 'first', 1); failed.fail = true; failed.bufferedAmount = 0;
    await pause(80);
    assert.equal(failed.readyState, 3);
    assert.equal(failed.listenerCount('close'), 0);
    console.log('PASS 3: close and send failure cancel pending previews and timers without unhandled errors');
  } finally { await closeWebSockets(); }
}

main().catch((error) => { console.error(error); process.exitCode = 1; });
