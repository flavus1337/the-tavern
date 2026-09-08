import assert from 'node:assert/strict';
import { TableConnection } from '../packages/client/src/ws/connection';
import { useStore } from '../packages/client/src/store';
import { PROTOCOL_VERSION, parseClientMessage } from '../packages/shared/src/index';
import type { ClientMessage, ServerMessage, ServerSnapshotPayload } from '../packages/shared/src/index';

Object.assign(globalThis, { window: new EventTarget(), document: Object.assign(new EventTarget(), { visibilityState: 'visible' }), location: { protocol: 'http:', host: 'fixture.invalid' } });
class Socket {
  static OPEN = 1;
  static instances: Socket[] = [];
  readyState = 0;
  sent: ClientMessage[] = [];
  onopen: (() => void) | null = null;
  onmessage: ((event: { data: string }) => void) | null = null;
  onclose: (() => void) | null = null;
  onerror: (() => void) | null = null;
  constructor() { Socket.instances.push(this); }
  send(value: string) { const message = JSON.parse(value); assert.equal(parseClientMessage(message).ok, true); this.sent.push(message); }
  open() { this.readyState = 1; this.onopen?.(); }
  receive(message: ServerMessage) { this.onmessage?.({ data: JSON.stringify(message) }); }
  close() { this.readyState = 3; this.onclose?.(); }
}
Object.assign(globalThis, { WebSocket: Socket });
const initial = useStore.getState();
const snapshot: ServerSnapshotPayload = { type: 'snapshot', boardGeneration: 0,
  campaign: { id: 'fixture', name: 'Fixture', description: '' }, board: [], uploadsLocked: false, mapLocked: false,
  presence: [], members: [], rollLog: [], assets: [], documents: [], myNotes: [], chapters: [], characters: [], media: null, tokens: [],
  grid: initial.grid, pieces: [], aoes: [], initiative: initial.initiative, mapMeta: initial.mapMeta, features: initial.features, templates: [] };
const connection = new TableConnection();
function join() {
  connection.connect('fixture'); const socket = Socket.instances.at(-1)!; socket.open();
  socket.receive({ type: 'joined', campaignId: 'fixture', protocolVersion: PROTOCOL_VERSION, userId: 'dm', username: 'DM', role: 'dm' });
  socket.receive(snapshot); return socket;
}
async function main() {
  try {
    const socket = join();
    const move = () => { const promise = connection.send({ type: 'tokenMove', tokenId: 'token', x: 44, y: 44 }); return { promise, id: socket.sent.at(-1)!.requestId! }; };
    const receipt = (id: string, generation: number) => ({ receiptId: id, label: 'move token', boardGeneration: generation });
    const accept = (id: string, generation: number) => socket.receive({ type: 'commandAck', requestId: id, undo: receipt(id, generation) });
    const first = move(); assert.equal(useStore.getState().undoReceipt, null);
    socket.receive({ type: 'undoInvalidated', boardGeneration: 1 }); assert.equal(useStore.getState().undoReceipt, null);
    accept(first.id, 1); await first.promise;
    assert.equal(useStore.getState().undoReceipt?.receiptId, first.id);
    const roll = connection.send({ type: 'roll', requestId: 'req_roll_check', expression: '1d20', visibility: 'public' });
    socket.receive({ type: 'commandAck', requestId: socket.sent.at(-1)!.requestId! }); await roll;
    assert.equal(useStore.getState().undoReceipt?.receiptId, first.id);
    console.log('PASS Undo appears only after its own ACK; non-board acknowledgments retain it.');

    const failed = connection.send({ type: 'undo', receiptId: first.id });
    const failure = assert.rejects(failed, { code: 'INTERNAL' });
    socket.receive({ type: 'error', code: 'INTERNAL', message: 'Storage unavailable. Try again.', requestId: socket.sent.at(-1)!.requestId! });
    await failure; assert.equal(useStore.getState().undoReceipt?.receiptId, first.id);
    const retry = connection.send({ type: 'undo', receiptId: first.id });
    socket.receive({ type: 'undoInvalidated', boardGeneration: 2 });
    socket.receive({ type: 'commandAck', requestId: socket.sent.at(-1)!.requestId! }); await retry;
    assert.equal(useStore.getState().undoReceipt, null);
    console.log('PASS storage failure preserves retry receipt; successful undo clears it after authoritative invalidation.');

    const old = move(), newer = move();
    socket.receive({ type: 'undoInvalidated', boardGeneration: 3 });
    socket.receive({ type: 'undoInvalidated', boardGeneration: 4 });
    accept(newer.id, 4); await newer.promise;
    accept(old.id, 3); await old.promise;
    assert.equal(useStore.getState().undoReceipt?.receiptId, newer.id);
    socket.receive({ type: 'undoInvalidated', boardGeneration: 5 });
    assert.equal(useStore.getState().undoReceipt, null);
    console.log('PASS late old ACK cannot replace newer Undo; another client’s confirmed board edit clears it.');

    const third = move(); socket.receive({ type: 'undoInvalidated', boardGeneration: 6 }); accept(third.id, 6); await third.promise;
    const stale = connection.send({ type: 'undo', receiptId: third.id });
    const staleResult = assert.rejects(stale, { code: 'UNDO_STALE' });
    socket.receive({ type: 'error', code: 'UNDO_STALE', message: 'This action can no longer be undone.', requestId: socket.sent.at(-1)!.requestId! });
    await staleResult; assert.equal(useStore.getState().undoReceipt, null);
    const beforeSnapshot = move();
    socket.receive({ ...snapshot, boardGeneration: 7 }); accept(beforeSnapshot.id, 7); await beforeSnapshot.promise;
    assert.equal(useStore.getState().undoReceipt, null, 'ACK from a previous snapshot epoch cannot revive Undo');
    console.log('PASS stale receipts clear explicitly; an authoritative snapshot also invalidates pending old-epoch receipts.');

    const undoOrigin = move(); socket.receive({ type: 'undoInvalidated', boardGeneration: 8 }); accept(undoOrigin.id, 8); await undoOrigin.promise;
    const pendingUndo = connection.send({ type: 'undo', receiptId: undoOrigin.id });
    const undoInterrupted = assert.rejects(pendingUndo, { code: 'UNCONFIRMED', uncertain: true });
    connection.disconnect(); await undoInterrupted;
    assert.equal(useStore.getState().undoReceipt, null);
    const resumed = join(); assert.equal(resumed.sent.filter((message) => !['join', 'ping'].includes(message.type)).length, 0);
    console.log('PASS pending Undo is unconfirmed on disconnect; reconnect clears its receipt and does not retry it.');
    connection.disconnect();
    join();
    const pendingMove = connection.send({ type: 'tokenMove', tokenId: 'token', x: 88, y: 88 });
    const pending = { promise: pendingMove }; const interrupted = assert.rejects(pending.promise, { code: 'UNCONFIRMED', uncertain: true });
    connection.disconnect(); await interrupted;
    assert.equal(useStore.getState().undoReceipt, null);
    const next = join(); assert.equal(next.sent.filter((message) => !['join', 'ping'].includes(message.type)).length, 0);
    connection.disconnect();
    await assert.rejects(connection.send({ type: 'undo', receiptId: third.id }), { code: 'OFFLINE' });
    console.log('PASS disconnect clears Undo, rejects pending work as unconfirmed and never replays it; offline Undo is refused.');
  } finally { connection.disconnect(); }
}
main().catch((error) => { console.error(error); process.exitCode = 1; });
