/** Real transport/store behavior with a deterministic browser socket fixture. */
import assert from 'node:assert/strict';
import { TableConnection, CommandError, sendWs } from '../packages/client/src/ws/connection';
import { useStore } from '../packages/client/src/store';
import { gestureLifecycle } from '../packages/client/src/lib/gesture';
import { draftPatch, mergeDraft } from '../packages/client/src/lib/draft';
import { PROTOCOL_VERSION, parseClientMessage } from '../packages/shared/src/index';
import type { ClientMessage, ServerMessage, ServerSnapshotPayload } from '../packages/shared/src/index';

const unhandled: unknown[] = [];
const onUnhandled = (error: unknown) => unhandled.push(error);
process.on('unhandledRejection', onUnhandled);
const events = new EventTarget();
Object.assign(globalThis, {
  window: events,
  document: Object.assign(new EventTarget(), { visibilityState: 'visible' }),
  location: { protocol: 'http:', host: 'test.invalid' },
});
class Socket {
  static OPEN = 1;
  static instances: Socket[] = [];
  readyState = 0;
  sent: ClientMessage[] = [];
  onopen: (() => void) | null = null;
  onmessage: ((event: { data: string }) => void) | null = null;
  onclose: (() => void) | null = null;
  onerror: (() => void) | null = null;
  constructor(readonly url: string) { Socket.instances.push(this); }
  send(text: string) {
    const message = JSON.parse(text);
    assert.equal(parseClientMessage(message).ok, true, `Invalid client fixture: ${text}`);
    this.sent.push(message);
  }
  open() { this.readyState = 1; this.onopen?.(); }
  receive(message: ServerMessage) { this.onmessage?.({ data: JSON.stringify(message) }); }
  close() { this.readyState = 3; this.onclose?.(); }
}
Object.assign(globalThis, { WebSocket: Socket });
const initial = useStore.getState();
const snapshot: ServerSnapshotPayload = {
  type: 'snapshot', boardGeneration: 0, campaign: { id: 'test', name: 'Test', description: '' }, board: [],
  uploadsLocked: false, mapLocked: false, presence: [], members: [], rollLog: [], assets: [],
  documents: [], myNotes: [], chapters: [], characters: [], media: null, tokens: [],
  grid: initial.grid, pieces: [], aoes: [], initiative: initial.initiative,
  mapMeta: initial.mapMeta, features: { imageGenEnabled: false }, templates: [],
};
const connection = new TableConnection();
Object.assign(window, { __vttConn: connection });
let checks = 0;
const pass = (name: string) => { checks++; process.stdout.write(`PASS ${name}\n`); };
async function main() {
try {
  connection.connect('test');
  const first = Socket.instances.at(-1)!;
  first.open();
  assert.deepEqual(first.sent[0], { type: 'join', protocolVersion: PROTOCOL_VERSION, campaignId: 'test' });
  first.receive({ type: 'joined', campaignId: 'test', protocolVersion: PROTOCOL_VERSION, userId: 'u1', username: 'DM', role: 'dm' });
  assert.notEqual(useStore.getState().connection, 'open');
  await assert.rejects(connection.send({ type: 'saveNote', title: 'Before snapshot', body: '', sharing: { scope: 'dm', userIds: [] } }), { code: 'OFFLINE', uncertain: false });
  assert.equal(first.sent.length, 2);
  first.receive(snapshot);
  assert.equal(useStore.getState().connection, 'open');
  pass('join is not ready; durable sends require an authoritative snapshot');

  const ping = first.sent.find((message) => message.type === 'ping')!;
  assert.equal(ping.type, 'ping');
  if (ping.type !== 'ping') throw new Error('Missing ping');
  const realNow = Date.now;
  try {
    Date.now = () => ping.sentAt + 200;
    first.receive({ type: 'pong', sentAt: ping.sentAt, serverAt: ping.sentAt + 5_100 });
    assert.equal(useStore.getState().clockOffsetMs, 5_000);
    first.receive({ type: 'mediaControl', assetId: 'audio1', action: 'play', time: 12, atMs: ping.sentAt + 5_150, by: 'DM' });
    assert.equal(useStore.getState().mediaSync.audio1?.atMs, ping.sentAt + 5_150);
    assert.equal(useStore.getState().audioDock?.assetId, 'audio1');
    first.receive({ type: 'mediaControl', assetId: 'audio1', action: 'pause', time: 13, atMs: ping.sentAt + 6_000, by: 'DM' });
    assert.equal(useStore.getState().mediaSync.audio1?.action, 'pause');
  } finally { Date.now = realNow; }
  pass('clock sampling compensates browser skew and media keeps the accepted server timestamp');

  first.receive({ type: 'mediaControl', assetId: 'trackA', action: 'play', time: 0, atMs: 10_000, by: 'DM' });
  first.receive({ type: 'mediaControl', assetId: 'trackB', action: 'play', time: 4, atMs: 12_000, by: 'DM' });
  assert.deepEqual(Object.keys(useStore.getState().mediaSync), ['trackB']);
  useStore.getState().openAudioDock('trackA');
  assert.equal(useStore.getState().mediaSync[useStore.getState().audioDock!.assetId], undefined, 'Reopening an obsolete document has no PLAY timeline');
  first.receive({ type: 'mediaControl', assetId: 'trackA', action: 'play', time: 8, atMs: 14_000, by: 'DM' });
  assert.deepEqual(Object.keys(useStore.getState().mediaSync), ['trackA'], 'Explicit accepted PLAY may replace the current track');
  first.receive({ type: 'mediaControl', assetId: 'trackA', action: 'stop', time: 0, atMs: 15_000, by: 'DM' });
  assert.deepEqual(useStore.getState().mediaSync, {});
  assert.equal(useStore.getState().audioDock, null);
  useStore.getState().openAudioDock('trackA');
  assert.equal(useStore.getState().mediaSync.trackA, undefined, 'Stopped audio does not resume when its document reopens');
  pass('only the current audio timeline survives replacement; reopening old or stopped tracks never resumes them');

  useStore.getState().setLastErrorMessage(null);
  let completed = false;
  const saving = connection.send({ type: 'saveNote', title: 'Saved', body: 'Draft', sharing: { scope: 'dm', userIds: [] } });
  void saving.then(() => { completed = true; });
  const requestId = first.sent.at(-1)!.requestId!;
  assert.ok(requestId);
  assert.equal(useStore.getState().pendingCommands, 1);
  first.receive({ type: 'commandAck', requestId: 'unrelated' });
  await Promise.resolve();
  assert.equal(completed, false);
  const note = { id: 'note1', title: 'Saved', body: 'Draft', revision: 1, sharing: { scope: 'dm' as const, userIds: [] }, ownerUsername: 'DM', createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), tags: [] };
  first.receive({ type: 'noteSaved', note });
  assert.equal(useStore.getState().myNotes[0]?.title, 'Saved');
  assert.equal(completed, false);
  first.receive({ type: 'commandAck', requestId, entityId: 'note1', revision: 1 });
  assert.equal((await saving).entityId, 'note1');
  assert.equal(useStore.getState().pendingCommands, 0);
  assert.equal(useStore.getState().saveOutcome, 'saved');
  pass('confirmed data can arrive before completion; only the matching acknowledgment resolves the command');

  const denied = connection.send({ type: 'deleteNote', noteId: 'note1' });
  const deniedResult = assert.rejects(denied, { code: 'FORBIDDEN', uncertain: false });
  const deniedId = first.sent.at(-1)!.requestId!;
  const other = connection.send({ type: 'setMapMeta', name: 'Still works' });
  const otherId = first.sent.at(-1)!.requestId!;
  first.receive({ type: 'error', code: 'FORBIDDEN', message: 'No permission', requestId: deniedId });
  await deniedResult;
  assert.equal(useStore.getState().pendingCommands, 1);
  assert.equal(useStore.getState().lastErrorMessage, 'No permission');
  first.receive({ type: 'commandAck', requestId: otherId });
  await other;
  assert.equal(useStore.getState().lastErrorMessage, 'No permission');
  assert.equal(useStore.getState().saveOutcome, 'failed');
  pass('scoped rejection leaves unrelated commands intact and its visible error persists');

  const countBeforeLarge = first.sent.length;
  await assert.rejects(connection.send({ type: 'saveNote', noteId: 'note1', baseRevision: 1, body: '🎲'.repeat(150_000), expected: { body: '🎯'.repeat(150_000) } }), { code: 'TOO_LARGE', uncertain: false });
  assert.equal(first.sent.length, countBeforeLarge);
  assert.equal(useStore.getState().pendingCommands, 0);
  assert.equal(first.readyState, 1);
  pass('oversized UTF-8 payload is refused locally without disconnect or an uncertain outcome');

  const rolling = connection.send({ type: 'roll', requestId: 'roll-unconfirmed', expression: '1d20', visibility: 'public' });
  const unconfirmed = assert.rejects(rolling, (error: unknown) => error instanceof CommandError && error.uncertain && error.code === 'UNCONFIRMED');
  first.close();
  await unconfirmed;
  assert.equal(useStore.getState().pendingCommands, 0);
  assert.equal(useStore.getState().saveOutcome, 'unconfirmed');
  const sentBeforeOffline = first.sent.length;
  await assert.rejects(connection.send({ type: 'setMapMeta', name: 'Offline' }), { code: 'OFFLINE', uncertain: false });
  sendWs({ type: 'boardRemove', itemId: 'not-sent' });
  await Promise.resolve();
  assert.equal(first.sent.length, sentBeforeOffline);
  events.dispatchEvent(new Event('online'));
  const second = Socket.instances.at(-1)!;
  second.open();
  second.receive({ type: 'joined', campaignId: 'test', protocolVersion: PROTOCOL_VERSION, userId: 'u1', username: 'DM', role: 'dm' });
  second.receive(snapshot);
  assert.deepEqual(second.sent.map((message) => message.type), ['join', 'ping']);
  pass('disconnect rejects sent work as unconfirmed, refuses offline work, and never replays a roll');

  const epoch = useStore.getState().snapshotEpoch;
  useStore.setState({ ownMeasure: { kind: 'ruler', x1: 1, y1: 2, x2: 3, y2: 4 }, ownMeasureShared: true,
    sharedMeasures: { u2: { by: 'u2', kind: 'ruler', x1: 1, y1: 2, x2: 3, y2: 4 } } });
  second.receive(snapshot);
  assert.equal(useStore.getState().snapshotEpoch, epoch + 1);
  assert.equal(useStore.getState().ownMeasure, null);
  assert.equal(useStore.getState().ownMeasureShared, false);
  assert.deepEqual(useStore.getState().sharedMeasures, {});
  pass('identical snapshots still advance the preview epoch and clear all rulers');

  const base = { name: 'Guard', hp: 10, conditions: [] as string[] };
  const draft = { ...base, name: 'Captain' };
  const remote = { name: 'Guard', hp: 4, conditions: ['poisoned'] };
  const merged = mergeDraft(base, draft, remote);
  assert.deepEqual(merged.draft, { name: 'Captain', hp: 4, conditions: ['poisoned'] });
  assert.deepEqual(draftPatch(merged.base, merged.draft), { changes: { name: 'Captain' }, expected: { name: 'Guard' } });
  const conflict = mergeDraft(base, draft, { ...remote, name: 'Sentry' });
  assert.equal(conflict.base.name, 'Guard');
  assert.equal(conflict.draft.name, 'Captain');
  pass('untouched HP/conditions merge while dirty names retain their expected baseline');

  let resets = 0;
  const gesture = gestureLifecycle(() => { resets++; });
  gesture.begin(); const moveAck = gesture.submitted();
  gesture.begin(); gesture.finish(); // Press/release resize without moving, before move ACK.
  assert.equal(resets, 0);
  moveAck(); assert.equal(resets, 1);
  gesture.begin(); const nextMoveAck = gesture.submitted();
  gesture.begin(); nextMoveAck(); // Move ACK during the no-op resize must not interrupt it.
  assert.equal(resets, 1);
  gesture.finish(); assert.equal(resets, 2);
  gesture.begin(); const oldAck = gesture.submitted();
  gesture.begin(); const newAck = gesture.submitted();
  oldAck(); assert.equal(resets, 2);
  newAck(); assert.equal(resets, 3);
  gesture.begin(); const beforeSnapshot = gesture.submitted();
  gesture.reconcile(); assert.equal(resets, 4);
  gesture.begin(); beforeSnapshot(); assert.equal(resets, 4);
  gesture.finish(); assert.equal(resets, 5);
  pass('no-op gestures reconcile before or after prior ACK; old completions never clear a newer drag');

  useStore.getState().openNotePanel('note1');
  const panels = useStore.getState().openPanels;
  useStore.getState().removeNote('note1');
  assert.deepEqual(useStore.getState().openPanels, panels);
  pass('remote note removal does not discard its open draft panel');
} finally {
  connection.disconnect();
}
await new Promise((resolve) => setImmediate(resolve));
assert.deepEqual(unhandled, []);
process.off('unhandledRejection', onUnhandled);
process.stdout.write(`Client sync regression passed (${checks} checks).\n`);

}
void main().catch((error) => { console.error(error); process.exitCode = 1; });
