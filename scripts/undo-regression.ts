/** Actual compiled-server Undo checks with disposable campaigns and two clients. */
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { spawn, type ChildProcess } from 'node:child_process';
import { once } from 'node:events';
import WebSocket from 'ws';
import { PROTOCOL_VERSION } from '../packages/shared/src/index.js';
import { hashPassword } from '../packages/server/src/auth/passwords.js';
type Message = Record<string, any>;
type Client = { ws: WebSocket; messages: Message[] };
const pause = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

async function main(): Promise<void> {
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'tavern-undo-'));
  const dataDir = path.join(tmp, 'data'), dir = path.join(tmp, 'campaigns/undo'), statePath = path.join(dir, '.runtime/state.json');
  const clients: Client[] = [];
  let server: ChildProcess | undefined, logs = '', sequence = 0, checks = 0;
  const pass = (label: string) => console.log(`PASS ${++checks}: ${label}`);
  const state = async () => JSON.parse(await fs.readFile(statePath, 'utf8')) as Message;
  const probe = http.createServer();
  await new Promise<void>((resolve) => probe.listen(0, '127.0.0.1', resolve));
  const port = (probe.address() as { port: number }).port;
  await new Promise<void>((resolve) => probe.close(() => resolve()));
  const base = `http://127.0.0.1:${port}`;
  async function start() {
    server = spawn(process.execPath, [path.resolve('packages/server/dist/index.js')], { env: { ...process.env, PORT: String(port), DATA_DIR: dataDir, CAMPAIGNS_DIR: path.dirname(dir), COOKIE_SECURE: 'false', LLM_API_KEY: '' }, stdio: ['ignore', 'pipe', 'pipe'] });
    server.stderr!.on('data', (data) => { logs += data; });
    for (let i = 0; i < 200; i++) {
      try { if ((await fetch(base + '/api/health', { signal: AbortSignal.timeout(300) })).ok) return; } catch {}
      if (server.exitCode !== null) throw new Error(logs);
      await pause(30);
    }
    throw new Error('server startup timeout: ' + logs);
  }
  async function stop() {
    for (const client of clients.splice(0)) client.ws.close();
    if (!server || server.exitCode !== null) return;
    const child = server, exit = once(child, 'exit');
    child.kill('SIGTERM');
    const timeout = setTimeout(() => child.kill('SIGKILL'), 12_000);
    try { const [code] = await exit; assert.equal(code, 0, logs); } finally { clearTimeout(timeout); }
  }
  async function api(url: string, cookie: string, body?: unknown, method = body === undefined ? 'GET' : 'POST') {
    const response = await fetch(base + url, { method, headers: { Cookie: cookie, 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body), signal: AbortSignal.timeout(4000) });
    return { status: response.status, body: response.status === 204 ? undefined : await response.json() as Message, cookie: response.headers.get('set-cookie')?.split(';')[0] };
  }
  async function wait(client: Client, matches: (message: Message) => boolean) {
    for (let i = 0; i < 500; i++) { const found = client.messages.find(matches); if (found) return found; await pause(10); }
    throw new Error('message timeout: ' + JSON.stringify(client.messages.slice(-4)));
  }
  async function connect(cookie: string) {
    const ws = new WebSocket(base.replace('http:', 'ws:') + '/ws', { headers: { Cookie: cookie } });
    const client: Client = { ws, messages: [] }; clients.push(client);
    ws.on('message', (data) => client.messages.push(JSON.parse(String(data))));
    await once(ws, 'open');
    ws.send(JSON.stringify({ type: 'join', campaignId: 'undo', protocolVersion: PROTOCOL_VERSION }));
    await wait(client, (message) => message.type === 'snapshot');
    return client;
  }
  async function command(client: Client, message: Message, code?: string) {
    const requestId = `undo_${++sequence}`;
    client.ws.send(JSON.stringify({ ...message, requestId }));
    const result = await wait(client, (message) => message.requestId === requestId && ['commandAck', 'error'].includes(message.type));
    assert.equal(result.type, code ? 'error' : 'commandAck', JSON.stringify(result));
    if (code) {
      assert.equal(result.code, code, JSON.stringify(result));
      assert.ok(!client.messages.some((message) => message.type === 'commandAck' && message.requestId === requestId));
    }
    return result;
  }
  const undo = (client: Client, ack: Message, error?: string) => command(client, { type: 'undo', receiptId: ack.undo.receiptId }, error);
  try {
    for (const folder of [dataDir, path.join(dir, '.runtime'), path.join(dir, 'assets')]) await fs.mkdir(folder, { recursive: true });
    const passwordHash = await hashPassword('fixture-password');
    await fs.writeFile(path.join(dataDir, 'users.json'), JSON.stringify({ type: 'vtt.users', schemaVersion: 1, users: ['admin', 'player'].map((username) => ({ id: `usr_${username}`, username, passwordHash, isAdmin: username === 'admin', createdAt: '' })) }));
    await fs.writeFile(path.join(dataDir, 'memberships.json'), JSON.stringify({ memberships: ['admin', 'player'].map((username) => ({ campaignId: 'undo', userId: `usr_${username}`, role: username === 'admin' ? 'dm' : 'player', joinedAt: '' })) }));
    await fs.writeFile(path.join(dir, 'campaign.json'), JSON.stringify({ type: 'campaign', schemaVersion: 1, id: 'undo', name: 'Undo', description: '' }));
    const board = { id: 'board_one', assetId: 'ast_board', x: 0, y: 0, w: 100, z: 1, playersCanMove: true };
    const piece = { id: 'piece_one', assetId: 'ast_piece', builtin: null, imageUrl: null, x: 0, y: 0, w: 100, h: 100, z: 1, rotation: 0, layer: 'props', lockedToGrid: false };
    const token = { id: 'token_one', name: 'Owned token', revision: 0, shape: 'round', allegiance: 'ally', ownerUserId: 'usr_player', size: 'M', x: 0, y: 0, z: 1, assetId: 'ast_face', fill: null, hp: 10, maxHp: 10, dmOnly: false, sharing: { scope: 'private', userIds: [] }, conditions: [], statBlock: null };
    await fs.writeFile(statePath, JSON.stringify({ board: [board], pieces: [piece], tokens: [token] }));
    for (const key of ['board', 'piece', 'face', 'audio']) {
      const audio = key === 'audio', file = `${key}.${audio ? 'mp3' : 'png'}`;
      await fs.writeFile(path.join(dir, 'assets', file), 'fixture bytes');
      await fs.writeFile(path.join(dir, 'assets', `${key}.json`), JSON.stringify({ type: 'asset', schemaVersion: 2, id: `ast_${key}`, file, title: key, assetKind: audio ? 'document' : 'art', mime: audio ? 'audio/mpeg' : 'image/png', width: audio ? null : 100, height: audio ? null : 100, tags: [], dmOnly: false, ownerUsername: 'player', sharing: { scope: 'private', userIds: [] } }));
    }
    await start();
    const adminCookie = (await api('/api/auth/login', '', { username: 'admin', password: 'fixture-password' })).cookie!;
    const playerCookie = (await api('/api/auth/login', '', { username: 'player', password: 'fixture-password' })).cookie!;
    let admin = await connect(adminCookie), player = await connect(playerCookie);
    assert.equal(admin.messages.find((message) => message.type === 'snapshot')!.boardGeneration, 0);
    const move = await command(admin, { type: 'boardMove', itemId: board.id, x: 120, y: 160, w: 150 });
    assert.deepEqual(Object.keys(move.undo).sort(), ['boardGeneration', 'label', 'receiptId']);
    assert.equal(move.undo.boardGeneration, 1);
    const invalidated = await wait(admin, (message) => message.type === 'undoInvalidated' && message.boardGeneration === 1);
    const update = await wait(admin, (message) => message.type === 'boardUpdated' && message.items[0].x === 120);
    assert.ok(admin.messages.indexOf(update) < admin.messages.indexOf(invalidated) && admin.messages.indexOf(invalidated) < admin.messages.indexOf(move));
    await wait(player, (message) => message.type === 'undoInvalidated' && message.boardGeneration === 1);
    assert.equal((await state()).board[0].x, 120);
    assert.equal((await undo(admin, move)).undo, undefined);
    assert.deepEqual((await state()).board[0], board);
    await undo(admin, move, 'UNDO_STALE');
    pass('committed move publishes authoritative state and invalidation before opaque receipt ACK; Undo restores and consumes it');

    for (const message of [{ type: 'boardMove', itemId: board.id, x: 40, y: 40, w: 100 }, { type: 'pieceMove', id: piece.id, x: 40, y: 40 }]) {
      const first = await command(admin, message);
      const invalidations = admin.messages.filter((event) => event.type === 'undoInvalidated').length;
      assert.equal((await command(admin, message)).undo, undefined);
      assert.equal(admin.messages.filter((event) => event.type === 'undoInvalidated').length, invalidations);
      await undo(admin, first);
    }
    pass('no-op board/piece moves retain the current generation and original usable receipt');

    const tokenMove = await command(player, { type: 'tokenMove', tokenId: token.id, x: 90, y: 100 });
    const movedRevision = (await state()).tokens[0].revision;
    await undo(player, tokenMove);
    assert.equal((await state()).tokens[0].x, 0);
    assert.equal((await state()).tokens[0].revision, movedRevision + 1);
    assert.equal((await state()).tokens[0].hp, 10);
    const samePosition = await command(player, { type: 'tokenMove', tokenId: token.id, x: 0, y: 0 });
    assert.ok(samePosition.undo);
    assert.ok((await state()).tokens[0].revision > movedRevision + 1);
    await undo(player, samePosition);
    const transform = await command(admin, { type: 'pieceUpdate', id: piece.id, x: 200, y: 300, w: 150, h: 200, rotation: 90 });
    await undo(admin, transform); assert.deepEqual((await state()).pieces[0], piece);
    for (const [client, message, collection] of [[admin, { type: 'boardRemove', itemId: board.id }, 'board'], [admin, { type: 'pieceRemove', id: piece.id }, 'pieces'], [player, { type: 'tokenRemove', tokenId: token.id }, 'tokens']] as const) {
      const removed = await command(client, message);
      assert.equal((await state())[collection].length, 0);
      await undo(client, removed); assert.equal((await state())[collection].length, 1);
    }
    pass('owned token movement/removal and board/piece removal or full transform Undo preserve fields and increment token revision');

    await command(admin, { type: 'aoeAdd', kind: 'circle', x1: 1, y1: 1, x2: 2, y2: 2 });
    await command(player, { type: 'aoeAdd', kind: 'square', x1: 3, y1: 3, x2: 4, y2: 4 });
    const areas = (await state()).aoes;
    await undo(player, await command(player, { type: 'aoeClear' }));
    assert.deepEqual((await state()).aoes, areas);
    await undo(player, await command(player, { type: 'aoeRemove', id: areas[1].id }));
    assert.deepEqual((await state()).aoes, areas);
    pass('player spell-area clear/remove Undo restores only their own areas and preserves other owners');

    const stale = await command(admin, { type: 'boardMove', itemId: board.id, x: 40, y: 40, w: 100 });
    await command(player, { type: 'tokenMove', tokenId: token.id, x: 44, y: 44 });
    await undo(admin, stale, 'UNDO_STALE'); assert.equal((await state()).tokens[0].x, 44);
    const aba = await command(admin, { type: 'boardMove', itemId: board.id, x: 60, y: 60, w: 100 });
    await command(player, { type: 'boardMove', itemId: board.id, x: 80, y: 80, w: 100 });
    await command(player, { type: 'boardMove', itemId: board.id, x: 60, y: 60, w: 100 });
    await undo(admin, aba, 'UNDO_STALE'); assert.equal((await state()).board[0].x, 60);
    pass('peer edits and ABA changes invalidate old receipts without erasing the newer edit');

    const reloaded = await command(admin, { type: 'boardMove', itemId: board.id, x: 70, y: 70, w: 100 });
    await command(admin, { type: 'saveMapTemplate', name: 'Saved current map' });
    const templates = admin.messages.filter((message) => message.type === 'templatesUpdated').at(-1)!.templates;
    await command(admin, { type: 'loadMapTemplate', id: templates.find((template: Message) => template.name === 'Saved current map').id });
    await undo(admin, reloaded, 'UNDO_STALE');
    pass('explicit map-template loading invalidates prior Undo even when the loaded geometry is identical');

    const preserved = await command(player, { type: 'tokenMove', tokenId: token.id, x: 88, y: 88 });
    await command(player, { type: 'roll', expression: '1d6', visibility: 'public' });
    await command(player, { type: 'saveNote', title: 'Keep this note', body: 'Keep this body', sharing: { scope: 'private', userIds: [] } });
    await command(player, { type: 'mediaControl', assetId: 'ast_audio', action: 'play', time: 0 });
    const late = await connect(playerCookie);
    assert.equal(late.messages.find((message) => message.type === 'snapshot')!.boardGeneration, preserved.undo.boardGeneration);
    await undo(player, preserved); assert.equal((await state()).tokens[0].x, 44);
    assert.equal((await fs.readdir(path.join(dir, 'notes'))).length, 1);
    pass('roll, note, audio and joins preserve Undo and their own committed changes');

    const locked = await command(admin, { type: 'boardMove', itemId: board.id, x: 100, y: 100, w: 100 });
    await command(admin, { type: 'setMapLocked', locked: true });
    await undo(admin, locked, 'FORBIDDEN');
    await command(admin, { type: 'setMapLocked', locked: false });
    await undo(admin, locked);
    const retry = await command(player, { type: 'tokenMove', tokenId: token.id, x: 132, y: 132 });
    const eventCount = player.messages.filter((message) => ['tokensUpdated', 'undoInvalidated'].includes(message.type)).length;
    await fs.rename(statePath, statePath + '.saved'); await fs.mkdir(statePath);
    await undo(player, retry, 'INTERNAL');
    assert.equal(player.messages.filter((message) => ['tokensUpdated', 'undoInvalidated'].includes(message.type)).length, eventCount);
    await fs.rmdir(statePath); await fs.rename(statePath + '.saved', statePath);
    await undo(player, retry); assert.equal((await state()).tokens[0].x, 44);
    pass('map-lock and persistence failures publish no success and preserve the receipt for a valid retry');

    const deleted = await command(player, { type: 'tokenRemove', tokenId: token.id });
    assert.equal((await api('/api/campaigns/undo/assets/ast_face', playerCookie, undefined, 'DELETE')).status, 204);
    await undo(player, deleted, 'UNDO_STALE'); assert.equal((await state()).tokens.length, 0);
    await command(player, { type: 'undo', receiptId: '../outside' }, 'BAD_MESSAGE');
    const own = await command(admin, { type: 'boardMove', itemId: board.id, x: 180, y: 180, w: 100 });
    await undo(player, own, 'UNDO_STALE');
    admin.ws.close(); await once(admin.ws, 'close'); admin = await connect(adminCookie);
    await undo(admin, own, 'UNDO_STALE');
    pass('deleted required assets, malformed receipts and receipts from another or disconnected socket cannot restore data');

    const lost = await connect(adminCookie);
    lost.ws.removeAllListeners('message');
    await new Promise<void>((resolve, reject) => lost.ws.send(JSON.stringify({ type: 'boardMove', requestId: 'lost-response', itemId: board.id, x: 200, y: 200, w: 100 }), (error) => error ? reject(error) : resolve()));
    lost.ws.close(); await once(lost.ws, 'close');
    const afterLost = await connect(adminCookie);
    assert.equal(afterLost.messages.find((message) => message.type === 'snapshot')!.board[0].x, 200);
    await command(afterLost, { type: 'undo', receiptId: 'lost-response' }, 'UNDO_STALE');
    pass('lost response followed by reconnect uses committed geometry without reconstructing or replaying Undo');

    const restarted = await command(admin, { type: 'boardMove', itemId: board.id, x: 220, y: 220, w: 100 });
    await stop(); await start(); admin = await connect(adminCookie); player = await connect(playerCookie);
    const snapshot = admin.messages.find((message) => message.type === 'snapshot')!;
    assert.equal(snapshot.boardGeneration, 0); assert.equal(snapshot.board[0].x, 220);
    await undo(admin, restarted, 'UNDO_STALE');
    pass('restart retains durable geometry and discards all transient Undo receipts/generation');
    await stop();

    // Membership changes have no public route; exercise the real store and handler
    // together to ensure Undo never trusts the socket's previously cached role.
    process.env['DATA_DIR'] = dataDir;
    const { initMembershipsStore, getMembershipsStore } = await import('../packages/server/src/auth/memberships.js');
    const { loadCampaign } = await import('../packages/server/src/campaign/loader.js');
    const { loadRuntime } = await import('../packages/server/src/campaign/runtime.js');
    const { addCampaign, getCampaign } = await import('../packages/server/src/campaign/registry.js');
    const { handleMessage } = await import('../packages/server/src/ws/handlers.js');
    const { closeWebSockets } = await import('../packages/server/src/ws/hub.js');
    await initMembershipsStore();
    const changeRole = async (role: 'player' | 'dm') => getMembershipsStore().mutate((data) => ({
      memberships: data.memberships.map((member) => member.userId === 'usr_admin' ? { ...member, role } : member),
    }));
    addCampaign('undo', (await loadCampaign(dir))!, await loadRuntime(dir));
    const entry = getCampaign('undo')!;
    entry.runtime.state.board[0]!.playersCanMove = false;
    const sent: Message[] = [];
    const session = { id: 'local', userId: 'usr_admin', username: 'admin', campaignId: 'undo', role: 'dm' as const, isAlive: true, ws: { readyState: 1, send: (data: string) => sent.push(JSON.parse(data)), close: () => {} } } as unknown as import('../packages/server/src/ws/hub.js').WsSession;
    await handleMessage(session, { type: 'boardMove', requestId: 'local-move', itemId: board.id, x: 240, y: 240, w: 100 });
    const receiptId = session.undo!.receiptId;
    await changeRole('player');
    await handleMessage(session, { type: 'undo', requestId: 'local-reject', receiptId });
    assert.equal(sent.at(-1)!.code, 'FORBIDDEN'); assert.equal(entry.runtime.state.board[0]!.x, 240);
    await changeRole('dm');
    await handleMessage(session, { type: 'undo', requestId: 'local-retry', receiptId });
    assert.equal(sent.at(-1)!.type, 'commandAck'); assert.equal(entry.runtime.state.board[0]!.x, 220);
    await handleMessage(session, { type: 'aoeClear', requestId: 'local-clear' });
    const clearReceipt = session.undo!.receiptId;
    entry.runtime.state.aoes = Array.from({ length: 100 }, (_, index) => ({ id: `extra_${index}`, kind: 'circle', x1: 0, y1: 0, x2: 1, y2: 1, ownerUserId: 'other' }));
    await handleMessage(session, { type: 'undo', requestId: 'local-capacity', receiptId: clearReceipt });
    assert.equal(sent.at(-1)!.code, 'TOO_MANY'); assert.equal(entry.runtime.state.aoes.length, 100);
    await closeWebSockets();
    pass('Undo rechecks current membership/permissions and the existing AoE capacity limit inside the queue');
    console.log(`Undo regressions passed (${checks} scenarios).`);
  } finally { await stop(); await fs.rm(tmp, { recursive: true, force: true }); }
}

main().catch((error) => { console.error(error); process.exitCode = 1; });
