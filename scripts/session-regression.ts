/** Real compiled-server playback and asset-reference checks; OS-temp fixtures only. */
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { spawn, type ChildProcess } from 'node:child_process';
import WebSocket from 'ws';
import { PROTOCOL_VERSION } from '../packages/shared/src/index.js';
import { hashPassword } from '../packages/server/src/auth/passwords.js';

type Message = Record<string, any>;
type Client = { ws: WebSocket; messages: Message[] };
const pause = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
async function main(): Promise<void> {
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'tavern-session-'));
  const dataDir = path.join(tmp, 'data');
  const campaignDir = path.join(tmp, 'campaigns', 'session');
  const clients: Client[] = [];
  let server: ChildProcess | undefined;
  let logs = '';
  let checks = 0;
  let sequence = 0;
  const pass = (label: string) => console.log(`PASS ${++checks}: ${label}`);
  const readJson = async (file: string) => JSON.parse(await fs.readFile(file, 'utf8'));
  const listener = http.createServer();
  await new Promise<void>((resolve) => listener.listen(0, '127.0.0.1', resolve));
  const port = (listener.address() as { port: number }).port;
  await new Promise<void>((resolve) => listener.close(() => resolve()));
  const base = `http://127.0.0.1:${port}`;

  async function start(): Promise<void> {
    server = spawn(process.execPath, [path.resolve('packages/server/dist/index.js')], {
      env: { ...process.env, PORT: String(port), DATA_DIR: dataDir, CAMPAIGNS_DIR: path.dirname(campaignDir), CLIENT_DIST: path.join(tmp, 'no-client'), COOKIE_SECURE: 'false', LLM_API_KEY: '', NODE_ENV: 'test' },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    server.stderr!.on('data', (data) => { logs += String(data); });
    const until = Date.now() + 10_000;
    while (Date.now() < until) {
      try { if ((await fetch(`${base}/api/health`, { signal: AbortSignal.timeout(500) })).ok) return; } catch {}
      if (server.exitCode !== null) throw new Error(logs);
      await pause(30);
    }
    throw new Error(`server startup timeout: ${logs}`);
  }

  async function stop(): Promise<void> {
    for (const client of clients.splice(0)) client.ws.close();
    if (!server || server.exitCode !== null) return;
    const child = server;
    const stopped = new Promise<void>((resolve, reject) => {
      child.once('exit', (code) => code === 0 ? resolve() : reject(new Error(`server exited ${code}: ${logs}`)));
    });
    child.kill('SIGTERM');
    const timer = setTimeout(() => child.kill('SIGKILL'), 12_000);
    try { await stopped; } finally { clearTimeout(timer); }
    server = undefined;
  }

  async function wait(client: Client, check: (msg: Message) => boolean): Promise<Message> {
    const until = Date.now() + 4000;
    while (Date.now() < until) {
      const found = client.messages.find(check);
      if (found) return found;
      await pause(10);
    }
    throw new Error(`WS timeout: ${JSON.stringify(client.messages.slice(-4))}`);
  }

  async function connect(cookie: string): Promise<Client> {
    const ws = new WebSocket(base.replace('http:', 'ws:') + '/ws', { headers: { Cookie: cookie } });
    const client = { ws, messages: [] as Message[] };
    clients.push(client);
    ws.on('message', (data) => client.messages.push(JSON.parse(String(data))));
    await new Promise<void>((resolve, reject) => { ws.once('open', resolve); ws.once('error', reject); });
    ws.send(JSON.stringify({ type: 'join', campaignId: 'session', protocolVersion: PROTOCOL_VERSION }));
    await wait(client, (msg) => msg.type === 'snapshot');
    return client;
  }

  async function command(client: Client, message: Message, expected = 'commandAck'): Promise<Message> {
    const requestId = `session_${++sequence}`;
    client.ws.send(JSON.stringify({ ...message, requestId }));
    const result = await wait(client, (msg) => msg.requestId === requestId && ['commandAck', 'error'].includes(msg.type));
    assert.equal(result.type, expected, JSON.stringify(result));
    return result;
  }

  async function login(username: string): Promise<string> {
    const response = await fetch(`${base}/api/auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username, password: 'regression-password' }) });
    assert.equal(response.status, 200);
    return response.headers.get('set-cookie')!.split(';')[0]!;
  }

  async function remove(cookie: string, key: string): Promise<Response> {
    return fetch(`${base}/api/campaigns/session/assets/ast_${key}`, { method: 'DELETE', headers: { Cookie: cookie }, signal: AbortSignal.timeout(4000) });
  }

  const references: Record<string, RegExp> = {
    board: /board item board_one/,
    token: /token face "Face token"/,
    piece: /map piece piece_one/,
    template_board: /saved map "Saved encounter" \(board\)/,
    template_piece: /saved map "Saved encounter" \(pieces\)/,
    cover: /campaign cover/,
    portrait: /character portrait "Aster"/,
    sheet: /character sheet "Aster"/,
    scene: /chapter "Arrival", scene "Gate"/,
  };
  const assets = new Map<string, { binary: string; manifest: string; bytes: Buffer }>();

  try {
    await fs.mkdir(dataDir, { recursive: true });
    const passwordHash = await hashPassword('regression-password');
    await fs.writeFile(path.join(dataDir, 'users.json'), JSON.stringify({ type: 'vtt.users', schemaVersion: 1, users: ['admin', 'player'].map((username) => ({ id: `usr_${username}`, username, passwordHash, isAdmin: username === 'admin', createdAt: '' })) }));
    await fs.writeFile(path.join(dataDir, 'memberships.json'), JSON.stringify({ memberships: ['admin', 'player'].map((username) => ({ campaignId: 'session', userId: `usr_${username}`, role: username === 'admin' ? 'dm' : 'player', joinedAt: '' })) }));
    for (const folder of ['assets', 'chapters', 'characters', '.runtime']) await fs.mkdir(path.join(campaignDir, folder), { recursive: true });
    await fs.writeFile(path.join(campaignDir, 'campaign.json'), JSON.stringify({ type: 'campaign', schemaVersion: 1, id: 'session', name: 'Session', description: '', coverAssetId: 'ast_cover' }));
    await fs.writeFile(path.join(campaignDir, 'chapters/arrival.json'), JSON.stringify({ type: 'chapter', schemaVersion: 1, id: 'arrival', title: 'Arrival', order: 0, scenes: [{ id: 'gate', title: 'Gate', assetIds: ['ast_scene'], characterIds: [] }] }));
    await fs.writeFile(path.join(campaignDir, 'characters/aster.json'), JSON.stringify({ type: 'character', schemaVersion: 1, id: 'aster', name: 'Aster', kind: 'pc', tags: [], portraitAssetId: 'ast_portrait', sheet: { sheetAssetId: 'ast_sheet' } }));
    const board = { id: 'board_one', assetId: 'ast_board', x: 0, y: 0, w: 100, z: 1 };
    const piece = { id: 'piece_one', assetId: 'ast_piece', builtin: null, x: 0, y: 0, w: 100, h: 100, z: 1, rotation: 0, layer: 'props', lockedToGrid: false };
    const grid = { cell: 44, offsetX: 0, offsetY: 0, visible: true, snap: true, color: '#ffffff33', unit: 'm' };
    const state = {
      board: [board], pieces: [piece],
      tokens: [{ id: 'token_one', name: 'Face token', shape: 'round', allegiance: 'ally', ownerUserId: null, size: 'M', x: 0, y: 0, z: 1, assetId: 'ast_token', fill: null, hp: null, maxHp: null, dmOnly: false }],
      mapTemplates: [{ id: 'saved', name: 'Saved encounter', createdAt: '', board: [{ ...board, assetId: 'ast_template_board' }], pieces: [{ ...piece, assetId: 'ast_template_piece' }], grid, mapMeta: { name: 'Encounter', areaTag: '' } }],
    };
    const statePath = path.join(campaignDir, '.runtime/state.json');
    await fs.writeFile(statePath, JSON.stringify(state));
    for (const key of [...Object.keys(references), 'unused', 'audio', 'audio_stop', 'audio_fail']) {
      const audio = key.startsWith('audio');
      const file = `${key}.${audio ? 'mp3' : 'png'}`;
      const binary = path.join(campaignDir, 'assets', file);
      const manifest = path.join(campaignDir, 'assets', `${key}.json`);
      const bytes = Buffer.from(audio ? 'ID3 fixture audio' : 'fixture image bytes');
      await fs.writeFile(binary, bytes);
      await fs.writeFile(manifest, JSON.stringify({ type: 'asset', schemaVersion: 2, id: `ast_${key}`, file, title: key, assetKind: audio ? 'document' : 'art', mime: audio ? 'audio/mpeg' : 'image/png', width: audio ? null : 100, height: audio ? null : 100, tags: [], dmOnly: false, ownerUsername: audio ? 'player' : 'admin', sharing: { scope: 'private', userIds: [] } }));
      assets.set(key, { binary, manifest, bytes });
    }
    await start();
    const adminCookie = await login('admin');
    const playerCookie = await login('player');
    const admin = await connect(adminCookie);
    const player = await connect(playerCookie);
    const sentAt = Date.now() + 3_600_000;
    const pingStart = Date.now();
    player.ws.send(JSON.stringify({ type: 'ping', sentAt }));
    const pong = await wait(player, (msg) => msg.type === 'pong' && msg.sentAt === sentAt);
    assert.ok(pong.serverAt >= pingStart && pong.serverAt <= Date.now());
    pass('pong echoes the client clock and samples a separate server epoch');

    const acceptedAfter = Date.now();
    const [playAck, pauseAck] = await Promise.all([
      command(player, { type: 'mediaControl', assetId: 'ast_audio', action: 'play', time: 12 }),
      command(player, { type: 'mediaControl', assetId: 'ast_audio', action: 'pause', time: 13 }),
    ]);
    const controls = player.messages.filter((msg) => msg.type === 'mediaControl' && msg.assetId === 'ast_audio');
    assert.deepEqual(controls.map((msg) => msg.action), ['play', 'pause']);
    for (const [index, ack] of [playAck, pauseAck].entries()) {
      const event = controls[index]!;
      assert.ok(event.atMs >= acceptedAfter && event.atMs <= Date.now());
      assert.ok(player.messages.indexOf(event) < player.messages.indexOf(ack));
      assert.deepEqual(await wait(admin, (msg) => msg.type === 'mediaControl' && msg.assetId === event.assetId && msg.action === event.action), event);
    }
    assert.equal((await readJson(assets.get('audio')!.manifest)).sharing.scope, 'all');
    const late = await connect(playerCookie);
    assert.deepEqual(late.messages.find((msg) => msg.type === 'snapshot')!.media, { assetId: 'ast_audio', action: 'pause', time: 13, atMs: controls[1]!.atMs });
    assert.equal((await remove(playerCookie, 'audio')).status, 409);
    await command(player, { type: 'mediaControl', assetId: 'ast_audio', action: 'stop', time: 0 });
    assert.equal((await remove(playerCookie, 'audio')).status, 204);
    pass('first private PLAY then PAUSE stays paused; controller, peers and late join share one accepted timeline');

    await Promise.all([
      command(player, { type: 'mediaControl', assetId: 'ast_audio_stop', action: 'play', time: 7 }),
      command(player, { type: 'mediaControl', assetId: 'ast_audio_stop', action: 'stop', time: 0 }),
    ]);
    assert.deepEqual(player.messages.filter((msg) => msg.type === 'mediaControl' && msg.assetId === 'ast_audio_stop').map((msg) => msg.action), ['play', 'stop']);
    const stopped = await connect(playerCookie);
    assert.equal(stopped.messages.find((msg) => msg.type === 'snapshot')!.media, null);
    pass('back-to-back private PLAY then STOP echoes in order and clears the late-join state');

    const failure = assets.get('audio_fail')!;
    await fs.rename(failure.manifest, `${failure.manifest}.saved`);
    await fs.mkdir(failure.manifest);
    const rejected = await command(player, { type: 'mediaControl', assetId: 'ast_audio_fail', action: 'play', time: 1 }, 'error');
    assert.equal(rejected.code, 'INTERNAL');
    assert.equal(player.messages.some((msg) => msg.type === 'commandAck' && msg.requestId === rejected.requestId), false);
    for (const client of [player, admin]) assert.equal(client.messages.some((msg) => msg.type === 'mediaControl' && msg.assetId === 'ast_audio_fail'), false);
    const afterFailure = await connect(playerCookie);
    assert.equal(afterFailure.messages.find((msg) => msg.type === 'snapshot')!.media, null);
    await fs.rmdir(failure.manifest);
    await fs.rename(`${failure.manifest}.saved`, failure.manifest);
    assert.equal((await readJson(failure.manifest)).sharing.scope, 'private');
    await command(player, { type: 'mediaControl', assetId: 'ast_audio_fail', action: 'play', time: 1 });
    const retryPlay = player.messages.find((msg) => msg.type === 'mediaControl' && msg.assetId === 'ast_audio_fail')!;
    await pause(50);
    const joiningPlayback = await connect(playerCookie);
    assert.deepEqual(joiningPlayback.messages.find((msg) => msg.type === 'snapshot')!.media, { assetId: 'ast_audio_fail', action: 'play', time: 1, atMs: retryPlay.atMs });
    await command(player, { type: 'mediaControl', assetId: 'ast_audio_fail', action: 'stop', time: 0 });
    pass('failed private-sharing persistence publishes neither playback nor ACK; retry remains usable');

    // An initial paused seek is valid; controls for an old track cannot replace
    // the newer table timeline, whether that newer track is playing or paused.
    await command(player, { type: 'mediaControl', assetId: 'ast_audio_stop', action: 'pause', time: 2 });
    await command(player, { type: 'mediaControl', assetId: 'ast_audio_stop', action: 'play', time: 2 });
    for (const currentAction of ['play', 'pause']) {
      await command(player, { type: 'mediaControl', assetId: 'ast_audio_fail', action: currentAction, time: 3 });
      const currentEvent = player.messages.filter((msg) => msg.type === 'mediaControl').at(-1)!;
      await wait(admin, (msg) => msg.type === 'mediaControl' && msg.assetId === 'ast_audio_fail' && msg.action === currentAction && msg.atMs === currentEvent.atMs);
      for (const staleAction of ['stop', 'pause']) {
        const counts = [player, admin].map((client) => client.messages.filter((msg) => msg.type === 'mediaControl').length);
        const stale = await command(player, { type: 'mediaControl', assetId: 'ast_audio_stop', action: staleAction, time: 4 }, 'error');
        assert.equal(stale.code, 'BAD_MESSAGE');
        assert.match(stale.message, /table track changed/);
        assert.equal(player.messages.some((msg) => msg.type === 'commandAck' && msg.requestId === stale.requestId), false);
        const observer = await connect(playerCookie);
        assert.deepEqual(observer.messages.find((msg) => msg.type === 'snapshot')!.media, { assetId: 'ast_audio_fail', action: currentAction, time: 3, atMs: currentEvent.atMs });
        assert.deepEqual([player, admin].map((client) => client.messages.filter((msg) => msg.type === 'mediaControl').length), counts);
      }
    }
    await command(player, { type: 'mediaControl', assetId: 'ast_audio_fail', action: 'stop', time: 0 });
    const afterCurrentStop = await connect(playerCookie);
    assert.equal(afterCurrentStop.messages.find((msg) => msg.type === 'snapshot')!.media, null);
    pass('obsolete track pause/stop reject without ACK or events; current play/pause timeline survives and current stop works');

    const beforeReferences = await fs.readFile(statePath, 'utf8');
    async function assertReferences(): Promise<void> {
      for (const [key, expectedLocation] of Object.entries(references)) {
        const asset = assets.get(key)!;
        const beforeManifest = await fs.readFile(asset.manifest);
        const response = await remove(adminCookie, key);
        assert.equal(response.status, 409, key);
        const body = await response.json() as Message;
        assert.equal(body.code, 'ASSET_IN_USE');
        assert.match(body.error, expectedLocation);
        assert.deepEqual(await fs.readFile(asset.binary), asset.bytes);
        assert.deepEqual(await fs.readFile(asset.manifest), beforeManifest);
      }
      assert.equal(await fs.readFile(statePath, 'utf8'), beforeReferences);
    }
    await assertReferences();
    pass('all nine typed asset-reference locations refuse deletion without changing files or runtime');
    assert.equal((await remove(adminCookie, 'unused')).status, 204);
    await assert.rejects(fs.access(assets.get('unused')!.binary), { code: 'ENOENT' });
    await assert.rejects(fs.access(assets.get('unused')!.manifest), { code: 'ENOENT' });
    await stop();
    await start();
    await assertReferences();
    assert.equal((await remove(adminCookie, 'unused')).status, 404);
    const restarted = await connect(adminCookie);
    await command(restarted, { type: 'boardRemove', itemId: 'board_one' });
    assert.equal((await remove(adminCookie, 'board')).status, 204);
    pass('references remain protected after restart; unused assets and explicitly detached board assets delete');
    const tabOne = await connect(playerCookie);
    const tabTwo = await connect(playerCookie);
    tabTwo.ws.send(JSON.stringify({ type: 'measure', kind: 'ruler', x1: 0, y1: 0, x2: 100, y2: 100 }));
    await wait(restarted, (msg) => msg.type === 'measureShared' && msg.kind === 'ruler' && msg.x2 === 100);
    tabOne.ws.close();
    await new Promise<void>((resolve) => tabOne.ws.once('close', () => resolve()));
    tabTwo.ws.send(JSON.stringify({ type: 'measure', kind: 'ruler', x1: 0, y1: 0, x2: 200, y2: 200 }));
    await wait(restarted, (msg) => msg.type === 'measureShared' && msg.kind === 'ruler' && msg.x2 === 200);
    assert.equal(restarted.messages.some((msg) => msg.type === 'measureShared' && msg.kind === 'clear' && msg.by === 'player'), false);
    tabTwo.ws.close();
    await wait(restarted, (msg) => msg.type === 'measureShared' && msg.kind === 'clear' && msg.by === 'player');
    pass('closing one of two user sockets preserves the ruler; closing the last clears it for peers');
    assert.equal(logs.includes('Unhandled ws handler error'), false, logs);
    console.log(`Session regressions passed (${checks} compiled-server scenarios).`);
  } finally {
    await stop();
    await fs.rm(tmp, { recursive: true, force: true });
  }
}

main().catch((error) => { console.error(error); process.exitCode = 1; });
