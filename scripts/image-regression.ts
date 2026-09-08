/** Compiled worker + HTTP/WS checks, fault injection and measurements in OS-temp fixtures. */
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { createReadStream } from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { spawn, type ChildProcess } from 'node:child_process';
import { once } from 'node:events';
import { createHash } from 'node:crypto';
import WebSocket from 'ws';
import { PROTOCOL_VERSION } from '../packages/shared/src/index.js';
import { hashPassword } from '../packages/server/src/auth/passwords.js';

const requireServer = createRequire(path.resolve('packages/server/package.json'));
const sharp = requireServer('sharp') as typeof import('../packages/server/node_modules/sharp').default;
const build = requireServer('esbuild').build;
type Message = Record<string, any>;
type Client = { ws: WebSocket; messages: Message[] };
const pause = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

async function main(): Promise<void> {
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'tavern-images-'));
  const campaignDir = path.join(tmp, 'campaigns', 'images');
  const dataDir = path.join(tmp, 'data');
  const staging = path.join(dataDir, '.upload-staging');
  const bundle = path.join(tmp, 'bundle');
  const assetsDir = path.join(campaignDir, 'assets');
  let server: ChildProcess | undefined;
  let logs = '';
  let checks = 0;
  let sequence = 0;
  const samples: Array<{ t: number; gap: number; rss: number; workers: number; pid: number }> = [];
  const io: Array<{ t: number; phase: string; ms: number }> = [];
  const clients: Client[] = [];
  const receivedAt = new WeakMap<Message, number>();
  const pass = (label: string) => console.log(`PASS ${++checks}: ${label}`);
  const listener = http.createServer();
  await new Promise<void>((resolve) => listener.listen(0, '127.0.0.1', resolve));
  const port = (listener.address() as { port: number }).port;
  await new Promise<void>((resolve) => listener.close(() => resolve()));
  const base = `http://127.0.0.1:${port}`;
  async function start(): Promise<void> {
    server = spawn(process.execPath, ['--require', path.join(tmp, 'probe.cjs'), path.join(bundle, 'index.js')], {
      env: { ...process.env, PORT: String(port), DATA_DIR: dataDir, CAMPAIGNS_DIR: path.dirname(campaignDir), CLIENT_DIST: path.join(tmp, 'none'), TMPDIR: staging, COOKIE_SECURE: 'false', LLM_API_KEY: '', NODE_ENV: 'test' },
      stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
    });
    server.stderr!.on('data', (data) => { logs += String(data); });
    server.on('message', (message: Message) => { if (message.sample) samples.push(message.sample); if (message.io) io.push(message.io); });
    for (let i = 0; i < 200; i++) {
      try { if ((await fetch(`${base}/api/health`, { signal: AbortSignal.timeout(300) })).ok) return; } catch {}
      if (server.exitCode !== null) throw new Error(logs);
      await pause(30);
    }
    throw new Error(`startup timeout: ${logs}`);
  }
  async function stop(): Promise<void> {
    for (const client of clients.splice(0)) client.ws.close();
    if (!server || server.exitCode !== null || server.signalCode !== null) return;
    const child = server;
    const done = once(child, 'exit');
    child.kill('SIGTERM');
    const timer = setTimeout(() => child.kill('SIGKILL'), 12_000);
    try { const [code] = await done; assert.equal(code, 0, logs); } finally { clearTimeout(timer); }
  }
  async function fault(mode: string): Promise<void> {
    const ready = new Promise<void>((resolve) => {
      const receive = (message: Message) => { if (message.faultReady === mode) { server!.off('message', receive); resolve(); } };
      server!.on('message', receive);
    });
    server!.send({ fault: mode });
    await ready;
  }
  async function wait(client: Client, check: (message: Message) => boolean): Promise<Message> {
    for (let i = 0; i < 500; i++) { const result = client.messages.find(check); if (result) return result; await pause(10); }
    throw new Error(`WS timeout: ${JSON.stringify(client.messages.slice(-3))}`);
  }
  async function connect(cookie: string): Promise<Client> {
    const ws = new WebSocket(base.replace('http:', 'ws:') + '/ws', { headers: { Cookie: cookie } });
    const client = { ws, messages: [] as Message[] };
    clients.push(client);
    ws.on('message', (data) => {
      const message = JSON.parse(String(data)) as Message;
      receivedAt.set(message, Date.now());
      client.messages.push(message);
    });
    await once(ws, 'open');
    ws.send(JSON.stringify({ type: 'join', campaignId: 'images', protocolVersion: PROTOCOL_VERSION }));
    await wait(client, (message) => message.type === 'snapshot');
    return client;
  }
  async function command(client: Client, message: Message): Promise<Message> {
    const requestId = `image_${++sequence}`;
    client.ws.send(JSON.stringify({ ...message, requestId }));
    const result = await wait(client, (message) => message.requestId === requestId && ['commandAck', 'error'].includes(message.type));
    assert.equal(result.type, 'commandAck', JSON.stringify(result));
    return result;
  }
  async function login(username: string): Promise<string> {
    const response = await fetch(`${base}/api/auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username, password: 'regression-password' }) });
    assert.equal(response.status, 200);
    return response.headers.get('set-cookie')!.split(';')[0]!;
  }
  async function clean(): Promise<void> {
    for (let i = 0; i < 200; i++) { if (!(await fs.readdir(staging)).length) return; await pause(10); }
    assert.deepEqual(await fs.readdir(staging), [], 'all staging directories released');
  }
  const multipart = '--test\r\nContent-Disposition: form-data; name="file"; filename="data.bin"\r\nContent-Type: application/octet-stream\r\n\r\n';
  function held(cookie: string, url = '/documents', contentType = 'multipart/form-data; boundary=test', campaign = 'images') {
    let resolve!: (response: { status: number; body: Message }) => void;
    let reject!: (error: Error) => void;
    const response = new Promise<{ status: number; body: Message }>((yes, no) => { resolve = yes; reject = no; });
    const req = http.request(`${base}/api/campaigns/${campaign}${url}`, { method: 'POST', headers: { Cookie: cookie, 'Content-Type': contentType, 'Transfer-Encoding': 'chunked' } }, (res) => {
      let body = '';
      res.on('data', (data) => { body += String(data); });
      res.on('end', () => resolve({ status: res.statusCode!, body: body ? JSON.parse(body) : {} }));
    });
    req.on('error', reject);
    void response.catch(() => {});
    req.flushHeaders();
    return { req, response };
  }
  async function streamUpload(cookie: string, bytes: number, during?: () => Promise<void>) {
    const upload = held(cookie);
    upload.req.write(multipart);
    const chunk = Buffer.alloc(64 * 1024, 65);
    for (let sent = 0; sent < bytes; sent += chunk.length) {
      if (!upload.req.write(chunk.subarray(0, Math.min(chunk.length, bytes - sent)))) await once(upload.req, 'drain');
      if (sent === 0 && during) await during();
    }
    upload.req.end('\r\n--test--\r\n');
    return upload.response;
  }
  async function save(cookie: string, image: Buffer, kind = 'prop') {
    const response = await fetch(`${base}/api/campaigns/images/generate/save`, { method: 'POST', headers: { Cookie: cookie, 'Content-Type': 'application/json' }, body: JSON.stringify({ base64: image.toString('base64'), kind, title: 'Processed image' }), signal: AbortSignal.timeout(30_000) });
    return { status: response.status, body: await response.json() as Message };
  }
  try {
    for (const dir of [dataDir, assetsDir, staging, bundle]) await fs.mkdir(dir, { recursive: true });
    // Exercise the packaged worker beside index.js with no source files available.
    await fs.symlink(path.resolve('packages/server/node_modules'), path.join(bundle, 'node_modules'), 'dir');
    await fs.writeFile(path.join(bundle, 'package.json'), '{"type":"module"}');
    await build({ entryPoints: ['packages/server/src/index.ts', 'packages/server/src/services/image-worker.ts'], bundle: true, platform: 'node', format: 'esm', external: ['express', 'ws', 'multer', 'sharp'], outdir: bundle, entryNames: '[name]', banner: { js: "import { createRequire } from 'module'; const require = createRequire(import.meta.url);" } });
    await fs.access(path.join(bundle, 'image-worker.js'));
    await fs.writeFile(path.join(tmp, 'probe.cjs'), `
const wt = require('node:worker_threads');
if (wt.isMainThread) {
  const fs = require('node:fs/promises');
  const { performance } = require('node:perf_hooks');
  let fault = '', workers = 0, previous = performance.now();
  process.on('message', message => { fault = message.fault; process.send({ faultReady: fault }); });
  const OriginalWorker = wt.Worker;
  wt.Worker = class extends OriginalWorker { constructor(...args) {
    super(...args); workers++; this.once('exit', () => workers--);
    if (fault === 'worker') { fault = ''; setImmediate(() => this.terminate()); }
  }};
  require('node:module').syncBuiltinESMExports();
  const rename = fs.rename;
  const open = fs.open;
  fs.open = async (...args) => {
    const handle = await open(...args), sync = handle.sync.bind(handle), name = String(args[0]);
    const phase = name.includes('.upload-staging/') ? 'source-sync' : name.includes('/prepare-') ? 'prepare-sync' : name.includes('/assets/') ? 'asset-install-sync' : 'other-sync';
    handle.sync = async () => { const start = performance.now(); try { return await sync(); } finally { process.send?.({io:{t:Date.now(),phase,ms:performance.now()-start}}); } };
    return handle;
  };
  const copy = fs.copyFile;
  fs.copyFile = async (...args) => { const start = performance.now(); try { return await copy(...args); } finally { process.send?.({io:{t:Date.now(),phase:'copy',ms:performance.now()-start}}); } };
  fs.rename = async (source, destination) => {
    if (fault === 'rename' && String(destination).includes('/assets/') && String(destination).endsWith('.json')) { fault = ''; throw new Error('injected asset commit failure'); }
    if (fault === 'crash-committed' && String(source).endsWith('/images/.runtime/pending-commit')) { process.kill(process.pid, 'SIGKILL'); await new Promise(() => {}); }
    await rename(source, destination);
    if (fault === 'abort-installed' && String(destination).includes('/assets/') && String(destination).endsWith('.webp')) {
      fault = ''; process.send({ installed: true }); await new Promise(resolve => setTimeout(resolve, 100));
    }
    if (fault === 'crash-partial' && String(destination).includes('/assets/') && String(destination).endsWith('.webp')) { process.kill(process.pid, 'SIGKILL'); await new Promise(() => {}); }
  };
  setInterval(() => { const now = performance.now(); process.send?.({sample:{t:Date.now(),gap:now-previous,rss:process.memoryUsage().rss,workers,pid:process.pid}}); previous=now; }, 5).unref();
}
`);
    const passwordHash = await hashPassword('regression-password');
    await fs.writeFile(path.join(dataDir, 'users.json'), JSON.stringify({ type: 'vtt.users', schemaVersion: 1, users: ['admin', 'player', 'outsider'].map((username) => ({ id: `usr_${username}`, username, passwordHash, isAdmin: username === 'admin', createdAt: '' })) }));
    await fs.writeFile(path.join(dataDir, 'memberships.json'), JSON.stringify({ memberships: ['images', 'full'].flatMap((campaignId) => ['admin', 'player'].map((username) => ({ campaignId, userId: `usr_${username}`, role: username === 'admin' ? 'dm' : 'player', joinedAt: '' }))) }));
    await fs.writeFile(path.join(campaignDir, 'campaign.json'), JSON.stringify({ type: 'campaign', schemaVersion: 1, id: 'images', name: 'Images', description: '' }));
    const fullDir = path.join(path.dirname(campaignDir), 'full');
    await fs.mkdir(path.join(fullDir, 'assets'), { recursive: true });
    await fs.writeFile(path.join(fullDir, 'campaign.json'), JSON.stringify({ type: 'campaign', schemaVersion: 1, id: 'full', name: 'Full', description: '' }));
    await fs.writeFile(path.join(fullDir, 'assets/fixture.bin'), 'fixture');
    for (let i = 0; i < 999; i++) await fs.writeFile(path.join(fullDir, `assets/asset_${i}.json`), JSON.stringify({ type: 'asset', schemaVersion: 2, id: `ast_${i}`, file: 'fixture.bin', title: `Existing ${i}`, assetKind: 'document', mime: 'application/octet-stream', width: null, height: null, dmOnly: false, tags: [], ownerUsername: 'admin' }));
    await start();
    const adminCookie = await login('admin');
    const playerCookie = await login('player');
    const outsiderCookie = await login('outsider');
    const admin = await connect(adminCookie);
    const peers = await Promise.all(Array.from({ length: 4 }, () => connect(playerCookie)));
    await command(admin, { type: 'setUploadsLocked', locked: true });
    for (const [cookie, url, status] of [[playerCookie, '/documents', 403], [outsiderCookie, '/documents', 404], ['', '/assets', 401], [playerCookie, '/generate/save', 403]] as const) {
      const request = held(cookie, url);
      const response = await Promise.race([request.response, pause(1000).then(() => { throw new Error('authorization waited for body'); })]);
      assert.equal(response.status, status);
      request.req.destroy();
    }
    await clean();
    await command(admin, { type: 'setUploadsLocked', locked: false });
    pass('authorization and upload lock reject held bodies before staging');

    const first = held(adminCookie), second = held(adminCookie);
    first.req.write(multipart); second.req.write(multipart);
    await pause(50);
    const excess = held(adminCookie);
    assert.equal((await excess.response).status, 503);
    excess.req.destroy(); first.req.destroy(); second.req.destroy();
    await clean();
    pass('only two heavy requests are admitted; disconnect releases disk staging and slots');

    const changedLock = await streamUpload(playerCookie, 2 * 1024 * 1024, async () => { await command(admin, { type: 'setUploadsLocked', locked: true }); });
    assert.equal(changedLock.status, 403);
    await clean();
    await command(admin, { type: 'setUploadsLocked', locked: false });
    const beforeFailed = await fs.readdir(assetsDir);
    await fault('rename');
    assert.equal((await streamUpload(adminCookie, 1024)).status, 500);
    await clean();
    assert.deepEqual(await fs.readdir(assetsDir), beforeFailed);
    pass('final permission check and failed manifest commit leave no payload, manifest or staging behind');

    const slowFull = held(playerCookie, '/documents', 'multipart/form-data; boundary=test', 'full');
    slowFull.req.write(multipart + 'slow');
    await pause(30);
    const lastAsset = held(adminCookie, '/documents', 'multipart/form-data; boundary=test', 'full');
    lastAsset.req.end(multipart + 'last\r\n--test--\r\n');
    assert.equal((await lastAsset.response).status, 201);
    slowFull.req.end('\r\n--test--\r\n');
    assert.equal((await slowFull.response).status, 413);
    await clean();
    const alreadyFull = held(adminCookie, '/documents', 'multipart/form-data; boundary=test', 'full');
    assert.equal((await Promise.race([alreadyFull.response, pause(1000).then(() => { throw new Error('capacity check consumed body'); })])).status, 413);
    alreadyFull.req.destroy();
    await clean();
    assert.equal((await fs.readdir(path.join(fullDir, 'assets'))).filter((name) => name.endsWith('.json')).length, 1000);
    pass('capacity is checked before input and again after another request fills the last slot');

    const white = await sharp({ create: { width: 2560, height: 2560, channels: 4, background: 'white' } }).png().toBuffer();
    const oversized = await sharp({ create: { width: 5000, height: 3000, channels: 4, background: 'white' } }).composite([{ input: Buffer.from('<svg width="1000" height="1000"><rect width="1000" height="1000" fill="red"/><rect x="250" y="250" width="500" height="500" fill="white"/></svg>'), left: 2000, top: 1000 }]).png().toBuffer();
    const processed = await save(adminCookie, oversized);
    assert.equal(processed.status, 201, JSON.stringify(processed));
    const imagePath = path.join(assetsDir, processed.body.asset.file);
    const { data: pixels, info } = await sharp(imagePath).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
    assert.equal(info.width, 2560); assert.equal(info.height, 1536);
    const alpha = (x: number, y: number) => pixels[(y * info.width + x) * 4 + 3];
    assert.equal(alpha(0, 0), 0); assert.equal(alpha(1280, 768), 255); assert.equal(alpha(1080, 560), 255);
    await clean();
    assert.equal((await save(adminCookie, Buffer.from('not an image'))).status, 400);
    const bomb = await sharp({ create: { width: 7000, height: 7000, channels: 3, background: 'white' } }).png().toBuffer();
    assert.equal((await save(adminCookie, bomb)).status, 400);
    await fault('worker');
    assert.equal((await save(adminCookie, white)).status, 500);
    await clean();
    const abortedImage = held(adminCookie, '/generate/save', 'application/json');
    const abortStart = Date.now();
    abortedImage.req.end(JSON.stringify({ base64: white.toString('base64'), kind: 'prop' }));
    for (let i = 0; i < 200 && !samples.some((sample) => sample.t >= abortStart && sample.workers > 0); i++) await pause(5);
    assert.ok(samples.some((sample) => sample.t >= abortStart && sample.workers > 0));
    abortedImage.req.destroy();
    await clean();
    assert.equal((await save(adminCookie, white)).status, 201);
    await clean();
    pass('packaged worker caps before flood-fill, preserves subject/interior alpha, rejects >40MP and recovers from malformed image/worker exit/request abort');

    const beforeAbort = await fs.readdir(assetsDir);
    await fault('abort-installed');
    const installed = new Promise<void>((resolve) => {
      const receive = (message: Message) => { if (message.installed) { server!.off('message', receive); resolve(); } };
      server!.on('message', receive);
    });
    const abortedCommit = held(adminCookie, '/generate/save', 'application/json');
    abortedCommit.req.end(JSON.stringify({ base64: white.toString('base64'), kind: 'prop' }));
    await Promise.race([installed, pause(5000).then(() => { throw new Error('payload installation was not reached'); })]);
    abortedCommit.req.destroy();
    await clean();
    const committedAfterAbort = (await fs.readdir(assetsDir)).filter((name) => !beforeAbort.includes(name));
    assert.equal(committedAfterAbort.length, 2);
    const abortManifest = JSON.parse(await fs.readFile(path.join(assetsDir, committedAfterAbort.find((name) => name.endsWith('.json'))!), 'utf8'));
    assert.ok((await sharp(path.join(assetsDir, abortManifest.file)).metadata()).width);
    pass('disconnect after payload installation drains the accepted commit; scratch cleanup preserves the installed file');

    const exact = await streamUpload(adminCookie, 100 * 1024 * 1024);
    assert.equal(exact.status, 201);
    assert.equal((await fs.stat(path.join(assetsDir, exact.body.asset.file))).size, 100 * 1024 * 1024);
    const hash = createHash('sha256');
    for await (const chunk of createReadStream(path.join(assetsDir, exact.body.asset.file))) hash.update(chunk);
    const expectedHash = createHash('sha256');
    for (let i = 0; i < 1600; i++) expectedHash.update(Buffer.alloc(64 * 1024, 65));
    assert.equal(hash.digest('hex'), expectedHash.digest('hex'));
    assert.equal((await streamUpload(adminCookie, 100 * 1024 * 1024 + 1)).status, 413);
    const malformed = held(adminCookie); malformed.req.end('not multipart');
    assert.equal((await malformed.response).status, 400);
    await clean();
    pass('streamed exact100MB persists byte-for-byte; oversize and malformed multipart clean up');

    async function measure(label: string, workload: () => Promise<unknown>): Promise<void> {
      const start = Date.now();
      const rtts: number[] = [], publications: number[] = [];
      let peakStagingBytes = 0, peakStagingRequests = 0;
      // Observe workload errors immediately, even while board commands run.
      const task = workload().then(() => ({ error: undefined as unknown }), (error: unknown) => ({ error }));
      for (let i = 0; i < 30; i++) {
        const name = `${label}_${i}`;
        const sent = Date.now();
        const ack = await command(admin, { type: 'setMapMeta', name });
        rtts.push(receivedAt.get(ack)! - sent);
        const updates = await Promise.all(peers.map((peer) => wait(peer, (msg) => msg.type === 'mapMetaUpdated' && msg.mapMeta.name === name)));
        publications.push(Math.max(...updates.map((message) => receivedAt.get(message)!)) - sent);
        const directories = await fs.readdir(staging);
        peakStagingRequests = Math.max(peakStagingRequests, directories.length);
        let stagedBytes = 0;
        for (const directory of directories) {
          for (const file of await fs.readdir(path.join(staging, directory)).catch(() => [] as string[])) {
            stagedBytes += (await fs.stat(path.join(staging, directory, file)).catch(() => ({ size: 0 }))).size;
          }
        }
        peakStagingBytes = Math.max(peakStagingBytes, stagedBytes);
        await pause(Math.max(0, 100 - (Date.now() - sent)));
      }
      const result = await task;
      if (result.error) throw result.error;
      const period = samples.filter((sample) => sample.t >= start);
      const stats = (values: number[]) => { values.sort((a, b) => a - b); return { count: values.length, median: values[Math.floor(values.length / 2)], p95: values[Math.min(values.length - 1, Math.ceil(values.length * 0.95) - 1)], p99: values[Math.min(values.length - 1, Math.ceil(values.length * 0.99) - 1)], max: values.at(-1) }; };
      const phaseTimings = Object.fromEntries(['source-sync', 'prepare-sync', 'asset-install-sync', 'other-sync', 'copy'].map((phase) => [phase, stats(io.filter((operation) => operation.t >= start && operation.phase === phase).map((operation) => operation.ms))]));
      console.log(JSON.stringify({ measurement: label, pid: server!.pid, sampleIntervalMs: 5, rttMs: stats(rtts), peerPublicationMs: stats(publications), timerGapMs: stats(period.map((sample) => sample.gap)), gapsOver50Ms: period.filter((sample) => sample.gap > 50).map((sample) => sample.gap), rssMin: Math.min(...period.map((sample) => sample.rss)), rssMax: Math.max(...period.map((sample) => sample.rss)), maxWorkers: Math.max(...period.map((sample) => sample.workers)), peakObservedStagingBytes: peakStagingBytes, peakObservedStagingRequests: peakStagingRequests, phaseTimings }));
      assert.ok(period.every((sample) => sample.pid === server!.pid && sample.workers <= 2));
    }
    await measure('baseline', async () => {});
    await measure('two-prop-workers', async () => {
      const until = Date.now() + 3000;
      await Promise.all(Array.from({ length: 2 }, async () => {
        while (Date.now() < until) {
          const result = await save(adminCookie, white);
          // Successful responses precede staging cleanup; admission stays held
          // until cleanup finishes, so a rapid next request may correctly be busy.
          if (result.status === 503) { await pause(10); continue; }
          assert.equal(result.status, 201);
        }
      }));
    });
    await clean();
    await measure('two-streamed-40MB-uploads', async () => {
      await Promise.all(Array.from({ length: 2 }, async () => assert.equal((await streamUpload(adminCookie, 40 * 1024 * 1024, () => pause(100))).status, 201)));
    });
    await clean();
    pass('main-thread timer/RSS and acknowledged board publication measured with four peers under both workloads');
    for (const phase of ['partial', 'committed']) {
      const previous = await fs.readdir(assetsDir);
      await fault(`crash-${phase}`);
      const exited = once(server!, 'exit');
      const request = save(adminCookie, white).catch(() => null);
      const [, signal] = await exited;
      assert.equal(signal, 'SIGKILL');
      await request;
      await stop();
      await start();
      await clean();
      const added = (await fs.readdir(assetsDir)).filter((name) => !previous.includes(name));
      assert.equal(added.length, phase === 'partial' ? 0 : 2);
      if (phase === 'committed') {
        const manifest = JSON.parse(await fs.readFile(path.join(assetsDir, added.find((name) => name.endsWith('.json'))!), 'utf8'));
        assert.ok((await fs.stat(path.join(assetsDir, manifest.file))).size > 0);
      }
    }
    pass('SIGKILL around source-path publication restores absence or the committed manifest/payload pair, and startup clears scratch files');
    const pending = held(adminCookie); pending.req.write(multipart);
    await pause(30);
    await stop();
    await clean();
    pass('shutdown cancels unfinished input and releases staging after durable work drains');
    console.log(`Image regressions passed (${checks} scenarios).`);
  } finally {
    await stop();
    await fs.rm(tmp, { recursive: true, force: true });
  }
}

main().catch((error) => { console.error(error); process.exitCode = 1; });
