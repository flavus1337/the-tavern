/** Production-bundle, real HTTP/WebSocket regressions. Uses disposable OS-temp data only. */
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { spawn, type ChildProcess } from 'node:child_process';
import WebSocket from 'ws';
import { PROTOCOL_VERSION, parseClientMessage } from '../packages/shared/src/index.js';
import { hashPassword } from '../packages/server/src/auth/passwords.js';

type Message = Record<string, any>;
type Client = { ws: WebSocket; messages: Message[] };
const pause = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function main(): Promise<void> {
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'tavern-protocol-'));
  const dataDir = path.join(tmp, 'data');
  const campaignsDir = path.join(tmp, 'campaigns');
  const campaignDir = path.join(campaignsDir, 'legacy');
  const legacyNote = { type: 'note', schemaVersion: 3, id: 'legacy_note', title: 'Legacy', body: 'original body', sharing: { scope: 'all', userIds: [] }, ownerUsername: 'player', tags: [], createdAt: '', updatedAt: '' };
  const legacyToken = { id: 'legacy_token', name: 'Legacy token', shape: 'round', allegiance: 'ally', ownerUserId: 'usr_player', size: 'M', x: 0, y: 0, z: 1, assetId: null, fill: null, hp: 10, maxHp: 10, dmOnly: false, sharing: { scope: 'private', userIds: [] }, conditions: [], statBlock: null };
  let server: ChildProcess | undefined;
  let serverErrors = '';
  const clients: Client[] = [];
  let checks = 0;
  const pass = (label: string): void => { console.log(`PASS ${++checks}: ${label}`); };
  const readJson = async (file: string) => JSON.parse(await fs.readFile(file, 'utf8'));
  const absent = (file: string) => assert.rejects(fs.access(file), { code: 'ENOENT' });
  const listener = http.createServer();
  await new Promise<void>((resolve) => listener.listen(0, '127.0.0.1', resolve));
  const port = (listener.address() as { port: number }).port;
  await new Promise<void>((resolve) => listener.close(() => resolve()));
  const base = `http://127.0.0.1:${port}`;
  async function start(): Promise<void> {
    server = spawn(process.execPath, [path.resolve('packages/server/dist/index.js')], {
      env: { ...process.env, PORT: String(port), DATA_DIR: dataDir, CAMPAIGNS_DIR: campaignsDir, CLIENT_DIST: path.join(tmp, 'no-client'), COOKIE_SECURE: 'false', LLM_API_KEY: '', NODE_ENV: 'test' },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    server.stderr!.on('data', (data) => { serverErrors += String(data); });
    const until = Date.now() + 10_000;
    while (Date.now() < until) {
      try { if ((await fetch(`${base}/api/health`, { signal: AbortSignal.timeout(500) })).ok) return; } catch {}
      if (server.exitCode !== null) throw new Error(serverErrors);
      await pause(30);
    }
    throw new Error(`server startup timeout: ${serverErrors}`);
  }
  async function stop(): Promise<void> {
    for (const client of clients.splice(0)) client.ws.close();
    if (!server || server.exitCode !== null) return;
    const child = server;
    const stopped = new Promise<void>((resolve, reject) => {
      child.once('exit', (code) => code === 0 ? resolve() : reject(new Error(`server exited ${code}: ${serverErrors}`)));
    });
    child.kill('SIGTERM');
    const timer = setTimeout(() => child.kill('SIGKILL'), 12_000);
    try { await stopped; } finally { clearTimeout(timer); }
    server = undefined;
  }
  async function api(url: string, cookie = '', body?: unknown, method = body === undefined ? 'GET' : 'POST') {
    const response = await fetch(base + url, { method, headers: { Cookie: cookie, 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body), signal: AbortSignal.timeout(4000) });
    return { response, body: response.status === 204 ? undefined : await response.json() as Message };
  }
  async function connect(cookie: string, campaignId?: string): Promise<Client> {
    const ws = new WebSocket(base.replace('http:', 'ws:') + '/ws', { headers: { Cookie: cookie } });
    const client = { ws, messages: [] as Message[] };
    clients.push(client);
    ws.on('message', (data) => client.messages.push(JSON.parse(String(data))));
    await new Promise<void>((resolve, reject) => { ws.once('open', resolve); ws.once('error', reject); });
    if (campaignId) {
      ws.send(JSON.stringify({ type: 'join', campaignId, protocolVersion: PROTOCOL_VERSION }));
      await wait(client, (msg) => msg.type === 'snapshot');
    }
    return client;
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
  let sequence = 0;
  async function command(client: Client, message: Message): Promise<Message> {
    const requestId = `protocol_${++sequence}`;
    client.ws.send(JSON.stringify({ ...message, requestId }));
    const outcome = await wait(client, (msg) => msg.requestId === requestId && (msg.type === 'commandAck' || msg.type === 'error'));
    if (outcome.type === 'error') assert.equal(client.messages.some((msg) => msg.type === 'commandAck' && msg.requestId === requestId), false);
    return outcome;
  }
  async function ack(client: Client, message: Message): Promise<Message> {
    const result = await command(client, message);
    assert.equal(result.type, 'commandAck', JSON.stringify(result));
    return result;
  }

  try {
    await fs.mkdir(dataDir, { recursive: true });
    const passwordHash = await hashPassword('regression-password');
    await fs.writeFile(path.join(dataDir, 'users.json'), JSON.stringify({ type: 'vtt.users', schemaVersion: 1, users: [
      { id: 'usr_admin', username: 'admin', passwordHash, isAdmin: true, createdAt: '' },
      { id: 'usr_player', username: 'player', passwordHash, isAdmin: false, createdAt: '' },
    ] }));
    await fs.writeFile(path.join(dataDir, 'memberships.json'), JSON.stringify({ memberships: [
      { campaignId: 'legacy', userId: 'usr_admin', role: 'dm', joinedAt: '' },
      { campaignId: 'legacy', userId: 'usr_player', role: 'player', joinedAt: '' },
      { campaignId: 'other', userId: 'usr_admin', role: 'dm', joinedAt: '' },
      { campaignId: 'other', userId: 'usr_player', role: 'dm', joinedAt: '' },
    ] }));
    for (const id of ['legacy', 'other']) {
      const dir = path.join(campaignsDir, id);
      for (const folder of ['notes', 'chapters', 'assets', '.runtime']) await fs.mkdir(path.join(dir, folder), { recursive: true });
      await fs.writeFile(path.join(dir, 'campaign.json'), JSON.stringify({ type: 'campaign', schemaVersion: 1, id, name: id, description: '' }));
    }
    await fs.writeFile(path.join(campaignDir, 'notes/legacy_note.json'), JSON.stringify(legacyNote));
    await fs.writeFile(path.join(campaignDir, 'chapters/legacy_chapter.json'), JSON.stringify({ type: 'chapter', schemaVersion: 1, id: 'legacy_chapter', title: 'Legacy chapter', order: 0, scenes: [] }));
    await fs.writeFile(path.join(campaignDir, '.runtime/state.json'), JSON.stringify({ tokens: [legacyToken] }));
    await start();
    const adminLogin = await api('/api/auth/login', '', { username: 'admin', password: 'regression-password' });
    const playerLogin = await api('/api/auth/login', '', { username: 'player', password: 'regression-password' });
    assert.equal(adminLogin.response.status, 200);
    assert.equal(playerLogin.response.status, 200);
    const adminCookie = adminLogin.response.headers.get('set-cookie')!.split(';')[0]!;
    const playerCookie = playerLogin.response.headers.get('set-cookie')!.split(';')[0]!;
    const a = await connect(adminCookie, 'legacy');
    const b = await connect(playerCookie, 'legacy');
    const snapshot = a.messages.find((msg) => msg.type === 'snapshot')!;
    assert.equal(snapshot.myNotes[0].revision, 0);
    assert.equal(snapshot.tokens[0].revision, 0);
    assert.equal(snapshot.chapters[0].revision, 0);
    assert.equal(snapshot.chapters[0].summary, '');
    pass(`production v${PROTOCOL_VERSION} snapshots migrate legacy note/token/chapter revisions to zero`);

    const created = await ack(b, { type: 'saveNote', title: 'New note', body: 'confirmed body', sharing: { scope: 'all', userIds: [] } });
    assert.equal(created.revision, 1);
    assert.ok(created.entityId);
    const savedIndex = b.messages.findIndex((msg) => msg.type === 'noteSaved' && msg.note.id === created.entityId);
    const ackIndex = b.messages.findIndex((msg) => msg.type === 'commandAck' && msg.requestId === created.requestId);
    assert.ok(savedIndex >= 0 && savedIndex < ackIndex);
    assert.equal((await readJson(path.join(campaignDir, `notes/${created.entityId}.json`))).body, 'confirmed body');
    await wait(a, (msg) => msg.type === 'noteSaved' && msg.note.id === created.entityId);
    pass('create ACK follows the authoritative two-client update and the durable file');

    assert.equal((await command(b, { type: 'setMapLocked', locked: true })).code, 'FORBIDDEN');
    await ack(a, { type: 'setMapLocked', locked: false });
    const statePath = path.join(campaignDir, '.runtime/state.json');
    const priorState = await fs.readFile(statePath);
    await fs.unlink(statePath);
    await fs.mkdir(statePath);
    assert.equal((await command(a, { type: 'setMapLocked', locked: true })).code, 'INTERNAL');
    await fs.rmdir(statePath);
    await fs.writeFile(statePath, priorState);
    await ack(a, { type: 'setMapLocked', locked: false });
    assert.equal((await readJson(statePath)).mapLocked, false);
    assert.equal(a.messages.filter((msg) => msg.type === 'mapLockUpdated' && msg.locked).length, 0);
    pass('permission and persistence failures are scoped errors with no ACK or provisional update');

    const malformed: Message[] = [
      { type: 'saveNote', noteId: '../outside-notes', title: 'bad', body: '', sharing: legacyNote.sharing, baseRevision: 0 },
      { type: 'tokenMove', tokenId: 'legacy_token', x: null, y: 0 },
      { type: 'tokenMove', tokenId: 'legacy_token', x: 1e20, y: 0 },
      { type: 'tokenUpdate', tokenId: 'legacy_token', baseRevision: 0, conditions: ['invented'] },
      { type: 'setDocumentSharing', assetId: 'x', sharing: { scope: 'everyone', userIds: [] } },
      { type: 'setInitiative', initiative: { active: true, round: 1, turnIndex: 0, entries: [null] } },
      { type: 'setGrid', grid: { cell: '44' } },
      { type: 'setMapLocked', locked: 'false' },
      { type: 'aoeAdd', kind: 'cube', x1: 0, y1: 0, x2: 10, y2: 10 },
      JSON.parse('{"type":"aoeClear","constructor":{}}'),
      JSON.parse('{"type":"aoeClear","toString":{}}'),
      JSON.parse('{"type":"setGrid","grid":{"__proto__":{"cell":44}}}'),
    ];
    const beforeMalformed = await fs.readFile(statePath, 'utf8');
    for (const message of malformed) assert.equal((await command(a, message)).code, 'BAD_MESSAGE', JSON.stringify(message));
    assert.equal(await fs.readFile(statePath, 'utf8'), beforeMalformed);
    await absent(path.join(campaignDir, 'outside-notes.json'));
    const { saveNote, saveAssetManifest } = await import('../packages/server/src/campaign/writer.js');
    const unsafeStore = { dir: campaignDir, notes: new Map(), assets: new Map() } as Parameters<typeof saveNote>[0];
    await assert.rejects(saveNote(unsafeStore, { ...legacyNote, id: '../outside-notes' } as Parameters<typeof saveNote>[1]), /invalid entity identifier/);
    await assert.rejects(saveAssetManifest(unsafeStore, { id: 'asset', file: '../outside.json' } as Parameters<typeof saveAssetManifest>[1]), /invalid asset filename/);
    await absent(path.join(campaignDir, 'outside.json'));
    a.ws.send(JSON.stringify({ type: 'setMapLocked', locked: true }));
    await wait(a, (msg) => msg.type === 'error' && !msg.requestId && msg.code === 'BAD_MESSAGE');
    for (const type of ['saveNote', 'deleteNote', 'saveChapter', 'deleteChapter', 'tokenMove', 'tokenUpdate', 'tokenRemove', 'roll', 'boardAdd', 'boardMove', 'boardRemove', 'boardSetAccess', 'setUploadsLocked', 'setMapLocked', 'setDocumentSharing', 'reorderChapters', 'setEntityChapters', 'mediaControl', 'tokenAdd', 'setGrid', 'setInitiative', 'pieceAdd', 'pieceMove', 'pieceUpdate', 'pieceRemove', 'aoeAdd', 'aoeRemove', 'aoeClear', 'setMapMeta', 'saveMapTemplate', 'loadMapTemplate', 'deleteMapTemplate', 'join', 'ping', 'measure']) {
      assert.equal(parseClientMessage({ type, requestId: 'schema', unknownField: true }).ok, false, type);
    }
    assert.equal(parseClientMessage({ type: 'tokenMove', requestId: 'schema', tokenId: 'x', x: Infinity, y: 0 }).ok, false);
    await ack(b, { type: 'aoeAdd', kind: 'square', x1: 0, y1: 0, x2: 10, y2: 10 });
    pass('all command schemas reject unknown fields; malformed nested values, traversal and prototype names cannot write');

    assert.equal((await command(a, { type: 'saveNote', noteId: 'unknown_note', baseRevision: 0, title: 'bad' })).code, 'UNKNOWN_NOTE');
    assert.equal((await command(a, { type: 'saveChapter', chapterId: 'unknown_chapter', baseRevision: 0, title: 'bad' })).code, 'UNKNOWN_CHAPTER');
    await absent(path.join(campaignDir, 'notes/unknown_note.json'));
    await absent(path.join(campaignDir, 'chapters/unknown_chapter.json'));
    pass('unknown update IDs cannot create note or chapter files');

    await ack(a, { type: 'saveNote', noteId: 'legacy_note', baseRevision: 0, body: 'first edit', expected: { body: 'original body' } });
    assert.equal((await command(b, { type: 'saveNote', noteId: 'legacy_note', baseRevision: 0, body: 'lost edit', expected: { body: 'original body' } })).code, 'CONFLICT');
    await ack(b, { type: 'saveNote', noteId: 'legacy_note', baseRevision: 0, title: 'Disjoint title', expected: { title: 'Legacy' } });
    const finalNote = await readJson(path.join(campaignDir, 'notes/legacy_note.json'));
    assert.equal(finalNote.body, 'first edit');
    assert.equal(finalNote.title, 'Disjoint title');
    assert.equal(finalNote.revision, 2);
    pass('competing note text conflicts while stale disjoint fields merge without losing text');

    await ack(a, { type: 'tokenUpdate', tokenId: 'legacy_token', baseRevision: 0, hp: 6, expected: { hp: 10 } });
    await ack(b, { type: 'tokenUpdate', tokenId: 'legacy_token', baseRevision: 0, name: 'Renamed', expected: { name: 'Legacy token' } });
    await ack(b, { type: 'tokenMove', tokenId: 'legacy_token', x: 44, y: 44 });
    const token = (await readJson(statePath)).tokens[0];
    assert.equal(token.hp, 6);
    assert.equal(token.name, 'Renamed');
    assert.equal(token.revision, 3);
    assert.equal((await command(b, { type: 'tokenUpdate', tokenId: 'legacy_token', baseRevision: 0, hp: 9, expected: { hp: 10 } })).code, 'CONFLICT');
    pass('name-only token edits preserve remote HP; movement advances revision; stale HP conflicts');

    const newChapter = await ack(a, { type: 'saveChapter', title: 'Second chapter' });
    await ack(a, { type: 'reorderChapters', orderedIds: [newChapter.entityId, 'legacy_chapter'] });
    await ack(a, { type: 'saveChapter', chapterId: 'legacy_chapter', baseRevision: 0, summary: 'Added summary', expected: { summary: '' } });
    await ack(a, { type: 'setEntityChapters', entityType: 'note', entityId: 'legacy_note', chapterIds: ['legacy_chapter'] });
    assert.equal((await readJson(path.join(campaignDir, 'notes/legacy_note.json'))).revision, 3);
    await ack(a, { type: 'deleteChapter', chapterId: 'legacy_chapter' });
    const unfiled = await readJson(path.join(campaignDir, 'notes/legacy_note.json'));
    assert.equal(unfiled.revision, 4);
    assert.deepEqual(unfiled.tags, []);
    const longName = 'x'.repeat(150);
    await ack(a, { type: 'tokenUpdate', tokenId: 'legacy_token', baseRevision: 3, name: longName });
    await ack(a, { type: 'setInitiative', initiative: { active: true, round: 1, turnIndex: 0, entries: [{ id: 'initiative', tokenId: 'legacy_token', name: longName, initiative: 10, ownerUserId: 'usr_player' }] } });
    pass('legacy optional fields merge after reorder, sibling note mutations bump revisions, and valid token names enter initiative');

    await ack(a, { type: 'pieceAdd', builtin: 'oak', x: 100, y: 100, w: 100, h: 100, layer: 'props', lockedToGrid: false });
    const pieceId = (await readJson(statePath)).pieces[0].id;
    await ack(a, { type: 'pieceUpdate', id: pieceId, x: 75, y: 75, w: 150, h: 150 });
    const resized = (await readJson(statePath)).pieces[0];
    assert.deepEqual([resized.x, resized.y, resized.w, resized.h], [75, 75, 150, 150]);
    assert.equal(resized.x + resized.w / 2, 150);
    assert.equal(resized.y + resized.h / 2, 150);
    pass('resizing a piece commits its complete transform and preserves the preview center');

    const rejoin = await connect(playerCookie);
    rejoin.ws.send(JSON.stringify({ type: 'join', campaignId: 'legacy', protocolVersion: PROTOCOL_VERSION }));
    rejoin.ws.send(JSON.stringify({ type: 'join', campaignId: 'other', protocolVersion: PROTOCOL_VERSION }));
    const joinError = await wait(rejoin, (msg) => msg.type === 'error' && msg.code === 'ALREADY_JOINED');
    assert.equal(joinError.fatal, true);
    assert.equal(rejoin.messages.some((msg) => msg.type === 'joined' && msg.campaignId === 'other'), false);
    const other = await connect(playerCookie, 'other');
    const otherStart = other.messages.length;
    await ack(a, { type: 'setMapLocked', locked: true });
    await pause(50);
    assert.equal(other.messages.slice(otherStart).some((msg) => msg.type === 'mapLockUpdated'), false);
    pass('parallel player→DM rejoin is rejected and another campaign receives no table updates');

    for (const [url, body] of [
      ['/api/campaigns', { name: {} }],
      ['/api/campaigns/legacy/invites', []],
      ['/api/campaigns/legacy/generate', { subject: 123 }],
      ['/api/campaigns/legacy/generate/save', { base64: {} }],
      ['/api/campaigns/legacy/generate/save', { base64: '!!!!' }],
    ] as const) assert.equal((await api(url, adminCookie, body)).response.status, 400, url);
    const raced = await Promise.all([api('/api/campaigns', adminCookie, { name: 'Same slug' }), api('/api/campaigns', adminCookie, { name: 'Same-slug' })]);
    assert.deepEqual(raced.map((result) => result.response.status).sort(), [201, 409]);
    const membershipPath = path.join(dataDir, 'memberships.json');
    const memberships = await fs.readFile(membershipPath);
    await fs.unlink(membershipPath);
    await fs.mkdir(membershipPath);
    assert.equal((await api('/api/campaigns', adminCookie, { name: 'Recoverable create' })).response.status, 500);
    await absent(path.join(campaignsDir, 'recoverable-create'));
    await fs.rmdir(membershipPath);
    await fs.writeFile(membershipPath, memberships);
    assert.equal((await api('/api/campaigns', adminCookie, { name: 'Recoverable create' })).response.status, 201);
    pass('malformed HTTP returns400; same-slug creation is exclusive; membership failure removes the new orphan');

    const jsonBytes = '{"original":"uploaded JSON", "number":42}\n';
    const form = new FormData();
    form.append('file', new Blob([jsonBytes], { type: 'application/json' }), 'campaign-notes.json');
    const upload = await fetch(`${base}/api/campaigns/legacy/documents`, { method: 'POST', headers: { Cookie: playerCookie }, body: form });
    assert.equal(upload.status, 201);
    const uploaded = (await upload.json() as Message).asset;
    assert.equal(uploaded.mime, 'application/json');
    assert.equal(path.extname(uploaded.file), '.bin');
    const binary = path.join(campaignDir, 'assets', uploaded.file);
    const manifestPath = binary.slice(0, -4) + '.json';
    assert.equal(await fs.readFile(binary, 'utf8'), jsonBytes);
    assert.equal((await readJson(manifestPath)).id, uploaded.id);
    await stop();
    await start();
    const restored = await connect(adminCookie, 'legacy');
    const restoredSnapshot = restored.messages.find((msg) => msg.type === 'snapshot')!;
    assert.equal(restoredSnapshot.myNotes.find((note: Message) => note.id === 'legacy_note').revision, 4);
    assert.equal(restoredSnapshot.tokens[0].hp, 6);
    const download = await fetch(`${base}/api/campaigns/legacy/files/assets/${uploaded.file}`, { headers: { Cookie: playerCookie } });
    assert.equal(download.status, 200);
    assert.match(download.headers.get('content-disposition')!, /attachment/);
    assert.equal(await download.text(), jsonBytes);
    assert.equal((await readJson(manifestPath)).mime, 'application/json');
    pass('JSON uploads preserve exact bytes and a distinct manifest through restart; committed revisions survive');
    assert.equal(serverErrors.includes('Unhandled promise rejection'), false);
    console.log(`Protocol regressions passed (${checks} compiled-server scenarios).`);
  } finally {
    await stop();
    await fs.rm(tmp, { recursive: true, force: true });
  }
}

main().catch((err: unknown) => { console.error(err); process.exitCode = 1; });
