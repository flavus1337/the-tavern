import assert from 'node:assert/strict';
import { frameValue } from '../packages/client/src/lib/frame';
import { zoomAt } from '../packages/client/src/lib/view';
import { useStore } from '../packages/client/src/store';
import type { OwnMeasure } from '../packages/client/src/store';
import { TableConnection } from '../packages/client/src/ws/connection';
import { PROTOCOL_VERSION, parseClientMessage } from '../packages/shared/src/index';
import type { ClientMessage, ServerMessage, ServerSnapshotPayload, TokenView } from '../packages/shared/src/index';

async function main() {
  let nextFrame = 0;
  const frames = new Map<number, FrameRequestCallback>();
  Object.assign(globalThis, {
    requestAnimationFrame: (fn: FrameRequestCallback) => { frames.set(++nextFrame, fn); return nextFrame; },
    cancelAnimationFrame: (id: number) => frames.delete(id),
  });
  const published: number[] = [];
  const preview = frameValue(0, (value) => published.push(value));
  for (let i = 1; i <= 120; i++) preview.set(i);
  assert.equal(preview.current, 120, 'Release reads the latest pointer even before the paint');
  assert.equal(frames.size, 1);
  assert.deepEqual(published, []);
  for (const [id, fn] of frames) { frames.delete(id); fn(16); }
  assert.deepEqual(published, [120]);
  preview.set((value) => value + 7);
  preview.flush();
  assert.deepEqual(published, [120, 127]);
  assert.equal(frames.size, 0, 'Flush cannot leave a trailing stale frame');
  preview.set(200); preview.set(0); preview.flush();
  assert.deepEqual(published, [120, 127, 0], 'Snapshot reset supersedes queued movement');
  console.log('PASS 120 pointer samples produce one frame; release/reset use the current value.');

  const tokens: TokenView[] = Array.from({ length: 500 }, (_, i) => ({
    id: `token${i}`, revision: 1, name: `Token ${i}`, shape: 'round', allegiance: 'ally', ownerUserId: 'dm', size: 'M',
    x: i * 44, y: 88, z: i, imageUrl: null, fill: '#abc', hp: 10, maxHp: 10, dmOnly: false,
    sharing: { scope: 'all', userIds: [] }, conditions: [], statBlock: null,
  }));
  useStore.getState().setTokens(tokens);
  const initial = useStore.getState().tokens;
  useStore.getState().setTokens(structuredClone(tokens));
  assert.equal(useStore.getState().tokens, initial);
  const incoming = structuredClone(tokens);
  incoming[20]!.hp = 7;
  incoming[20]!.revision++;
  useStore.getState().setTokens(incoming);
  const updated = useStore.getState().tokens;
  assert.notEqual(updated[20], initial[20]);
  assert.equal(updated.filter((token, i) => token === initial[i]).length, 499);
  useStore.getState().setOwnMeasure({ kind: 'ruler', x1: 0, y1: 0, x2: 55, y2: 77 });
  assert.equal(useStore.getState().tokens, updated);
  console.log('PASS a full 500-token broadcast retains 499 unchanged objects; rulers retain the scene array.');

  const view = { x: -80, y: 33, scale: 0.5 };
  for (const anchor of [{ x: 470, y: 332 }, { x: 170, y: 120 }]) {
    const point = { x: (anchor.x - view.x) / view.scale, y: (anchor.y - view.y) / view.scale };
    const next = zoomAt(view, anchor, 0.6);
    assert.ok(Math.abs(next.x + point.x * next.scale - anchor.x) < 1e-9);
    assert.ok(Math.abs(next.y + point.y * next.scale - anchor.y) < 1e-9);
    assert.deepEqual(zoomAt(next, anchor, view.scale), view);
  }
  console.log('PASS zoom buttons and wheel preserve their center/cursor board point.');

  const events = new EventTarget();
  Object.assign(globalThis, { window: events, document: Object.assign(new EventTarget(), { visibilityState: 'visible' }), location: { protocol: 'http:', host: 'fixture.invalid' } });
  class Socket {
    static OPEN = 1;
    static instances: Socket[] = [];
    readyState = 0;
    bufferedAmount = 0;
    sent: ClientMessage[] = [];
    onopen: (() => void) | null = null;
    onmessage: ((event: { data: string }) => void) | null = null;
    onclose: (() => void) | null = null;
    onerror: (() => void) | null = null;
    constructor() { Socket.instances.push(this); }
    send(text: string) { const message = JSON.parse(text); assert.equal(parseClientMessage(message).ok, true); this.sent.push(message); }
    open() { this.readyState = 1; this.onopen?.(); }
    receive(message: ServerMessage) { this.onmessage?.({ data: JSON.stringify(message) }); }
    close() { this.readyState = 3; this.onclose?.(); }
  }
  Object.assign(globalThis, { WebSocket: Socket });
  const state = useStore.getState();
  const snapshot: ServerSnapshotPayload = {
    type: 'snapshot', campaign: { id: 'fixture', name: 'Fixture', description: '' }, board: [], uploadsLocked: false, mapLocked: false,
    presence: [], members: [], rollLog: [], assets: [], documents: [], myNotes: [], chapters: [], characters: [], media: null, tokens: [],
    grid: state.grid, pieces: [], aoes: [], initiative: state.initiative, mapMeta: state.mapMeta, features: state.features, templates: [],
  };
  const real = { now: Date.now, setTimeout, clearTimeout, setInterval, clearInterval };
  let now = 1_000_000, timerId = 0;
  const timers = new Map<number, { due: number; fn: () => void; interval?: number }>();
  Object.assign(globalThis, {
    setTimeout: (fn: () => void, delay = 0) => { timers.set(++timerId, { due: now + delay, fn }); return timerId; },
    clearTimeout: (id: number) => timers.delete(id),
    setInterval: (fn: () => void, delay: number) => { timers.set(++timerId, { due: now + delay, fn, interval: delay }); return timerId; },
    clearInterval: (id: number) => timers.delete(id),
  });
  Date.now = () => now;
  function advance(ms: number) {
    const end = now + ms;
    for (;;) {
      const next = [...timers].filter(([, value]) => value.due <= end).sort((a, b) => a[1].due - b[1].due)[0];
      if (!next) break;
      const [id, timer] = next;
      now = timer.due;
      timers.delete(id);
      if (timer.interval) timers.set(id, { ...timer, due: now + timer.interval });
      timer.fn();
    }
    now = end;
  }
  const connection = new TableConnection();
  try {
    connection.connect('fixture');
    const socket = Socket.instances.at(-1)!;
    socket.open();
    socket.receive({ type: 'joined', campaignId: 'fixture', protocolVersion: PROTOCOL_VERSION, userId: 'dm', username: 'DM', role: 'dm' });
    socket.receive(snapshot);
    const ruler = (x: number): Extract<ClientMessage, { type: 'measure' }> => ({ type: 'measure', kind: 'ruler', x1: 1, y1: 2, x2: x, y2: x });
    const measures = () => socket.sent.filter((message) => message.type === 'measure');
    for (let i = 0; i < 120; i++) { connection.sendMeasure(ruler(i)); advance(8); }
    const previewCount = measures().length;
    assert.ok(previewCount <= 20, `${previewCount} preview messages exceeded 20Hz`);
    connection.sendMeasure(ruler(999), true);
    assert.deepEqual(measures().at(-1), ruler(999));
    advance(100);
    assert.equal(measures().length, previewCount + 1);
    console.log(`PASS 120 moves in 960ms send ${previewCount} previews plus one exact final endpoint.`);

    socket.bufferedAmount = 100_000;
    const beforePressure = measures().length;
    for (let i = 0; i < 120; i++) { connection.sendMeasure(ruler(i)); advance(8); }
    assert.equal(measures().length, beforePressure);
    const durable = connection.send({ type: 'setMapMeta', name: 'Durable survives pressure' });
    const requestId = socket.sent.at(-1)!.requestId!;
    assert.ok(requestId);
    socket.receive({ type: 'commandAck', requestId });
    await durable;
    connection.sendMeasure({ type: 'measure', kind: 'clear' });
    advance(200);
    socket.bufferedAmount = 0;
    advance(50);
    assert.deepEqual(measures().slice(beforePressure), [{ type: 'measure', kind: 'clear' }]);
    console.log('PASS backpressure retains only the newest clear and never drops a durable command.');

    const rulerFrame = frameValue<OwnMeasure | null>(null, (value) => useStore.getState().setOwnMeasure(value));
    rulerFrame.set({ kind: 'ruler', x1: 0, y1: 0, x2: 1, y2: 1 });
    connection.sendMeasure(ruler(1));
    assert.equal(useStore.getState().ownMeasure, null, 'Pointerdown has not rendered yet');
    // The tool change reads the synchronous preview, not the published store.
    if (rulerFrame.current) { rulerFrame.set(null); rulerFrame.flush(); connection.sendMeasure({ type: 'measure', kind: 'clear' }); }
    assert.equal(frames.size, 0);
    assert.equal(useStore.getState().ownMeasure, null);
    assert.deepEqual(measures().at(-1), { type: 'measure', kind: 'clear' });
    advance(100);
    assert.deepEqual(measures().at(-1), { type: 'measure', kind: 'clear' });
    console.log('PASS pointerdown followed by tool change before RAF cannot leave a local or remote ruler.');

    socket.bufferedAmount = 100_000;
    connection.sendMeasure(ruler(333));
    socket.receive(snapshot);
    socket.bufferedAmount = 0;
    advance(100);
    assert.deepEqual(measures().at(-1), { type: 'measure', kind: 'clear' });
    socket.bufferedAmount = 100_000;
    connection.sendMeasure(ruler(444));
    socket.close();
    events.dispatchEvent(new Event('online'));
    const next = Socket.instances.at(-1)!;
    next.open(); next.receive({ type: 'joined', campaignId: 'fixture', protocolVersion: PROTOCOL_VERSION, userId: 'dm', username: 'DM', role: 'dm' }); next.receive(snapshot);
    advance(100);
    assert.equal(next.sent.some((message) => message.type === 'measure'), false);
    console.log('PASS snapshot/reconnect discards queued rulers; no stale transient replay.');
  } finally {
    connection.disconnect();
    Date.now = real.now;
    Object.assign(globalThis, { setTimeout: real.setTimeout, clearTimeout: real.clearTimeout, setInterval: real.setInterval, clearInterval: real.clearInterval });
  }
}
void main().catch((error) => { console.error(error); process.exitCode = 1; });
