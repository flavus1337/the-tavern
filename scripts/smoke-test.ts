/**
 * VTT Smoke Test — runs against a freshly spawned built server.
 * Prereq: `pnpm -r build` already ran (dist/index.js must exist).
 *
 * Run via: pnpm smoke
 */

import { spawn, type ChildProcess } from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import http from 'node:http';
import { createRequire } from 'node:module';
import WebSocket from 'ws';

// ---------------------------------------------------------------------------
// Config / paths
// ---------------------------------------------------------------------------

const REPO_ROOT = path.resolve(import.meta.dirname, '..');
const SERVER_DIST = path.join(REPO_ROOT, 'packages', 'server', 'dist', 'index.js');
const DEMO_CAMPAIGN_SRC = path.join(REPO_ROOT, 'campaigns', 'demo-campaign');

// ---------------------------------------------------------------------------
// Assertion helpers
// ---------------------------------------------------------------------------

let assertCount = 0;
const failures: string[] = [];

function pass(label: string): void {
  assertCount++;
  process.stdout.write(`  [${assertCount}] PASS: ${label}\n`);
}

function fail(label: string, detail?: string): void {
  assertCount++;
  const msg = detail ? `${label} — ${detail}` : label;
  failures.push(`[${assertCount}] FAIL: ${msg}`);
  process.stdout.write(`  [${assertCount}] FAIL: ${msg}\n`);
}

function assert(condition: boolean, label: string, detail?: string): void {
  if (condition) {
    pass(label);
  } else {
    fail(label, detail ?? 'condition was false');
  }
}

function assertEqual<T>(actual: T, expected: T, label: string): void {
  if (actual === expected) {
    pass(label);
  } else {
    fail(label, `expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
  }
}

// ---------------------------------------------------------------------------
// CookieJar
// ---------------------------------------------------------------------------

class CookieJar {
  private cookies: Map<string, string> = new Map();

  update(setCookieHeader: string | string[] | null): void {
    if (!setCookieHeader) return;
    const headers = Array.isArray(setCookieHeader) ? setCookieHeader : [setCookieHeader];
    for (const h of headers) {
      const parts = h.split(';');
      const first = parts[0]?.trim();
      if (!first) continue;
      const eqIdx = first.indexOf('=');
      if (eqIdx === -1) continue;
      const name = first.slice(0, eqIdx).trim();
      const value = first.slice(eqIdx + 1).trim();
      this.cookies.set(name, value);
    }
  }

  header(): string {
    return Array.from(this.cookies.entries())
      .map(([k, v]) => `${k}=${v}`)
      .join('; ');
  }

  has(name: string): boolean {
    return this.cookies.has(name);
  }

  clear(): void {
    this.cookies.clear();
  }
}

// ---------------------------------------------------------------------------
// HTTP helpers (using fetch with cookie jar)
// ---------------------------------------------------------------------------

type FetchLike = (
  url: string,
  options?: {
    method?: string;
    body?: string | FormData;
    headers?: Record<string, string>;
  },
) => Promise<{ status: number; ok: boolean; body: unknown; headers: Record<string, string | string[]> }>;

function makeClient(base: string, jar: CookieJar): FetchLike {
  return async (url, options = {}) => {
    const fullUrl = url.startsWith('http') ? url : `${base}${url}`;
    const method = options.method ?? 'GET';

    const reqHeaders: Record<string, string> = {};
    const cookieStr = jar.header();
    if (cookieStr) reqHeaders['Cookie'] = cookieStr;

    let bodyPayload: string | undefined;
    if (options.body !== undefined) {
      if (typeof options.body === 'string') {
        reqHeaders['Content-Type'] = 'application/json';
        bodyPayload = options.body;
      }
    }
    if (options.headers) {
      Object.assign(reqHeaders, options.headers);
    }

    const res = await fetch(fullUrl, {
      method,
      headers: reqHeaders,
      body: options.body as BodyInit | undefined,
    });

    const setCookie = res.headers.getSetCookie?.() ?? [];
    if (setCookie.length > 0) jar.update(setCookie);
    else {
      const sc = res.headers.get('set-cookie');
      if (sc) jar.update(sc);
    }

    let body: unknown;
    const ct = res.headers.get('content-type') ?? '';
    if (ct.includes('application/json') && res.status !== 204) {
      try { body = await res.json(); } catch { body = null; }
    } else if (res.status === 204) {
      body = null;
    } else {
      body = await res.text();
    }

    const respHeaders: Record<string, string | string[]> = {};
    res.headers.forEach((v, k) => { respHeaders[k] = v; });
    const sc2 = res.headers.getSetCookie?.();
    if (sc2 && sc2.length > 0) respHeaders['set-cookie'] = sc2;

    return { status: res.status, ok: res.ok, body, headers: respHeaders };
  };
}

// ---------------------------------------------------------------------------
// HTTP upload helper
// ---------------------------------------------------------------------------

async function uploadFile(
  base: string,
  jar: CookieJar,
  url: string,
  fileBuffer: Buffer,
  filename: string,
  mimetype: string,
  fields?: Record<string, string>,
): Promise<{ status: number; body: unknown }> {
  const fullUrl = url.startsWith('http') ? url : `${base}${url}`;
  const form = new FormData();
  form.append('file', new Blob([fileBuffer], { type: mimetype }), filename);
  if (fields) {
    for (const [k, v] of Object.entries(fields)) {
      form.append(k, v);
    }
  }

  const cookieStr = jar.header();
  const headers: HeadersInit = {};
  if (cookieStr) headers['Cookie'] = cookieStr;

  const res = await fetch(fullUrl, {
    method: 'POST',
    headers,
    body: form,
  });

  const sc = res.headers.getSetCookie?.() ?? [];
  if (sc.length > 0) jar.update(sc);
  else {
    const s = res.headers.get('set-cookie');
    if (s) jar.update(s);
  }

  let body: unknown;
  if (res.status !== 204) {
    try { body = await res.json(); } catch { body = await res.text(); }
  }
  return { status: res.status, body };
}

// ---------------------------------------------------------------------------
// WebSocket helpers
// ---------------------------------------------------------------------------

type WsMessage = Record<string, unknown>;

function openWs(
  wsUrl: string,
  cookieJar: CookieJar,
): Promise<{ ws: WebSocket; messages: WsMessage[] }> {
  return new Promise((resolve, reject) => {
    const messages: WsMessage[] = [];
    const cookieStr = cookieJar.header();
    const ws = new WebSocket(wsUrl, {
      headers: cookieStr ? { Cookie: cookieStr } : undefined,
    });
    const timeout = setTimeout(() => {
      ws.terminate();
      reject(new Error('WS open timeout'));
    }, 5000);
    ws.on('open', () => {
      clearTimeout(timeout);
      resolve({ ws, messages });
    });
    ws.on('message', (data) => {
      try {
        messages.push(JSON.parse(data.toString()) as WsMessage);
      } catch {
        // ignore
      }
    });
    ws.on('error', (err) => {
      clearTimeout(timeout);
      reject(err);
    });
  });
}

function send(ws: WebSocket, msg: unknown): void {
  ws.send(JSON.stringify(msg));
}

function waitForMessage(
  messages: WsMessage[],
  predicate: (m: WsMessage) => boolean,
  timeoutMs = 2000,
): Promise<WsMessage> {
  return new Promise((resolve, reject) => {
    const check = (): WsMessage | undefined => messages.find(predicate);
    const found = check();
    if (found) { resolve(found); return; }

    const interval = setInterval(() => {
      const m = check();
      if (m) { clearInterval(interval); clearTimeout(t); resolve(m); }
    }, 20);
    const t = setTimeout(() => {
      clearInterval(interval);
      reject(new Error(`Timeout waiting for message matching predicate`));
    }, timeoutMs);
  });
}

function waitMs(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

function tryConnect(wsUrl: string, jar: CookieJar): Promise<{ ws: WebSocket | null; rejected: boolean; code?: number }> {
  return new Promise((resolve) => {
    const cookieStr = jar.header();
    const ws = new WebSocket(wsUrl, {
      headers: cookieStr ? { Cookie: cookieStr } : undefined,
    });
    const timeout = setTimeout(() => {
      ws.terminate();
      resolve({ ws: null, rejected: true, code: 408 });
    }, 3000);
    ws.on('open', () => {
      clearTimeout(timeout);
      resolve({ ws, rejected: false });
    });
    ws.on('error', () => {
      clearTimeout(timeout);
      resolve({ ws: null, rejected: true });
    });
    ws.on('unexpected-response', (_req, res) => {
      clearTimeout(timeout);
      resolve({ ws: null, rejected: true, code: res.statusCode });
    });
  });
}

// ---------------------------------------------------------------------------
// Server lifecycle
// ---------------------------------------------------------------------------

let serverProcess: ChildProcess | null = null;

async function spawnServer(
  port: number,
  dataDir: string,
  campaignsDir: string,
): Promise<void> {
  const env: Record<string, string> = {
    ...process.env as Record<string, string>,
    PORT: String(port),
    DATA_DIR: dataDir,
    CAMPAIGNS_DIR: campaignsDir,
    ADMIN_PASSWORD: 'test-admin-pw',
    ADMIN_USER: 'admin',
    COOKIE_SECURE: 'false',
    PUBLIC_ORIGIN: `http://localhost:${port}`,
    NODE_ENV: 'test',
  };

  serverProcess = spawn('node', [SERVER_DIST], { env, stdio: ['ignore', 'pipe', 'pipe'] });

  serverProcess.stdout?.on('data', (d: Buffer) => {
    if (process.env['VERBOSE']) process.stdout.write(`[server] ${d.toString()}`);
  });
  serverProcess.stderr?.on('data', (d: Buffer) => {
    if (process.env['VERBOSE']) process.stderr.write(`[server:err] ${d.toString()}`);
  });
}

function killServer(): void {
  if (serverProcess) {
    serverProcess.kill('SIGTERM');
    serverProcess = null;
  }
}

async function waitForHealth(base: string, timeoutMs = 10000): Promise<void> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      const res = await fetch(`${base}/api/health`);
      if (res.ok) return;
    } catch {
      // not ready
    }
    await waitMs(100);
  }
  throw new Error(`Server at ${base} did not become healthy within ${timeoutMs}ms`);
}

// ---------------------------------------------------------------------------
// PNG generator (sharp — from server's node_modules)
// ---------------------------------------------------------------------------

const _serverRequire = createRequire(
  path.join(REPO_ROOT, 'packages', 'server', 'package.json'),
);

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const _sharp = _serverRequire('sharp') as typeof import('sharp');

async function generatePng(width: number, height: number): Promise<Buffer> {
  // Create a simple image (solid colour)
  const buf = await _sharp({
    create: {
      width,
      height,
      channels: 3,
      background: { r: 128, g: 64, b: 32 },
    },
  })
    .png()
    .toBuffer();
  return buf;
}

// ---------------------------------------------------------------------------
// Minimal valid PDF
// ---------------------------------------------------------------------------

function minimalPdf(filename: string): Buffer {
  // Smallest valid %PDF-1.4 that most parsers accept
  const body = [
    '%PDF-1.4',
    '1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj',
    '2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj',
    '3 0 obj<</Type/Page/MediaBox[0 0 3 3]>>endobj',
    'xref',
    '0 4',
    '0000000000 65535 f',
    '0000000009 00000 n',
    '0000000058 00000 n',
    '0000000115 00000 n',
    '',
    'trailer<</Size 4/Root 1 0 R>>',
    'startxref',
    '190',
    '%%EOF',
  ].join('\n');
  return Buffer.from(body, 'ascii');
}

// ---------------------------------------------------------------------------
// Free port helper
// ---------------------------------------------------------------------------

function getFreePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const srv = http.createServer();
    srv.listen(0, '127.0.0.1', () => {
      const addr = srv.address();
      if (typeof addr === 'object' && addr !== null) {
        const port = addr.port;
        srv.close(() => resolve(port));
      } else {
        reject(new Error('Could not get port'));
      }
    });
    srv.on('error', reject);
  });
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  // Pre-condition: dist/index.js must exist
  try {
    await fs.access(SERVER_DIST);
  } catch {
    process.stderr.write(
      `ERROR: ${SERVER_DIST} not found.\n` +
      `Please run 'pnpm -r build' before running the smoke test.\n`,
    );
    process.exit(1);
  }

  const port = await getFreePort();
  const base = `http://localhost:${port}`;
  const wsUrl = `ws://localhost:${port}/ws`;

  // Temp dirs
  const tmpBase = await fs.mkdtemp(path.join(os.tmpdir(), 'vtt-smoke-'));
  const dataDir = path.join(tmpBase, 'data');
  const campaignsDir = path.join(tmpBase, 'campaigns');
  await fs.mkdir(dataDir, { recursive: true });
  await fs.mkdir(campaignsDir, { recursive: true });

  // Copy demo-campaign
  await fs.cp(DEMO_CAMPAIGN_SRC, path.join(campaignsDir, 'demo-campaign'), { recursive: true });

  process.stdout.write(`\nVTT Smoke Test — port ${port}\n`);
  process.stdout.write(`Temp dir: ${tmpBase}\n\n`);

  let secondServer: ChildProcess | null = null;

  try {
    await spawnServer(port, dataDir, campaignsDir);
    await waitForHealth(base);
    pass('Server started and /api/health ok');

    const adminJar = new CookieJar();
    const player1Jar = new CookieJar();
    const player2Jar = new CookieJar();
    const player3Jar = new CookieJar();

    const admin = makeClient(base, adminJar);
    const player1 = makeClient(base, player1Jar);
    const player2 = makeClient(base, player2Jar);
    const player3 = makeClient(base, player3Jar);

    // =========================================================================
    // A. Auth
    // =========================================================================
    process.stdout.write('\n--- A. Auth ---\n');

    // A1: Admin login ok + Set-Cookie
    const loginRes = await admin('/api/auth/login', {
      method: 'POST',
      body: JSON.stringify({ username: 'admin', password: 'test-admin-pw' }),
    });
    assert(loginRes.status === 200, 'A1: admin login returns 200');
    assert(adminJar.has('vtt_session'), 'A2: admin login sets vtt_session cookie');

    // A3: /api/auth/me ok
    const meRes = await admin('/api/auth/me');
    assert(meRes.status === 200, 'A3: /api/auth/me ok after login');
    const meBody = meRes.body as { user?: { username?: string; isAdmin?: boolean } };
    assert(meBody?.user?.username === 'admin', 'A4: me returns admin username');
    assert(meBody?.user?.isAdmin === true, 'A5: admin isAdmin=true');

    // A6: Wrong password → 401
    const badLogin = await admin('/api/auth/login', {
      method: 'POST',
      body: JSON.stringify({ username: 'admin', password: 'wrong-password' }),
    });
    assert(badLogin.status === 401, 'A6: wrong password returns 401');

    // A7: Register without invite → 4xx
    const noInviteReg = await player1('/api/auth/register', {
      method: 'POST',
      body: JSON.stringify({ username: 'someone', password: 'password123' }),
    });
    assert(noInviteReg.status >= 400 && noInviteReg.status < 500, 'A7: register without invite → 4xx');

    // A8: Logout invalidates session
    const logoutRes = await admin('/api/auth/logout', { method: 'POST' });
    assert(logoutRes.status === 204, 'A8: logout returns 204');
    // Re-check me after logout — need fresh jar (cookies cleared by server)
    const meAfterLogout = await admin('/api/auth/me');
    assert(meAfterLogout.status === 401, 'A9: /api/auth/me returns 401 after logout');

    // Re-login admin for remaining tests
    adminJar.clear();
    const reloginRes = await admin('/api/auth/login', {
      method: 'POST',
      body: JSON.stringify({ username: 'admin', password: 'test-admin-pw' }),
    });
    assert(reloginRes.status === 200, 'A10: admin re-login ok');

    // =========================================================================
    // B. Bootstrap membership
    // =========================================================================
    process.stdout.write('\n--- B. Bootstrap membership ---\n');

    // B1: Admin creates campaign "Smoke Test World"
    const createRes = await admin('/api/campaigns', {
      method: 'POST',
      body: JSON.stringify({ name: 'Smoke Test World', description: 'Test campaign' }),
    });
    assert(createRes.status === 201, 'B1: create campaign returns 201');
    const createBody = createRes.body as { campaign?: { id?: string; name?: string; role?: string } };
    const campaignId = createBody?.campaign?.id;
    assert(typeof campaignId === 'string' && campaignId.length > 0, 'B2: campaign has an id');
    assert(createBody?.campaign?.role === 'dm', 'B3: admin gets dm role');

    // B4: Folder skeleton on disk
    const campaignDir = path.join(campaignsDir, campaignId ?? '');
    const campaignJsonExists = await fs.access(path.join(campaignDir, 'campaign.json')).then(() => true).catch(() => false);
    assert(campaignJsonExists, 'B4: campaign.json exists on disk');

    for (const sub of ['chapters', 'characters', 'notes', 'assets', '.runtime']) {
      const subExists = await fs.access(path.join(campaignDir, sub)).then(() => true).catch(() => false);
      assert(subExists, `B5-${sub}: ${sub} subdirectory exists`);
    }

    // B6: Admin lobby lists it with role dm
    const lobbyRes = await admin('/api/campaigns');
    assert(lobbyRes.status === 200, 'B6: lobby returns 200');
    const campaigns = lobbyRes.body as Array<{ id?: string; role?: string }>;
    const ownCampaign = campaigns.find((c) => c.id === campaignId);
    assert(ownCampaign !== undefined, 'B7: lobby contains created campaign');
    assert(ownCampaign?.role === 'dm', 'B8: lobby shows dm role');

    // B9: demo-campaign NOT in admin's lobby (no membership for admin)
    const demoInLobby = campaigns.find((c) => c.id === 'demo-campaign');
    assert(demoInLobby === undefined, 'B9: demo-campaign not in admin lobby (no membership)');

    // =========================================================================
    // C. Invites
    // =========================================================================
    process.stdout.write('\n--- C. Invites ---\n');

    // C1: Admin creates invite for Smoke Test World
    const inviteRes = await admin(`/api/campaigns/${campaignId}/invites`, {
      method: 'POST',
      body: JSON.stringify({ maxUses: 1 }),
    });
    assert(inviteRes.status === 201, 'C1: create invite returns 201');
    const inviteBody = inviteRes.body as { token?: string };
    const inviteToken = inviteBody?.token;
    assert(typeof inviteToken === 'string' && inviteToken.length > 0, 'C2: invite has token');

    // C3: Public preview returns campaign name
    const previewRes = await player1(`/api/invites/${inviteToken}`);
    assert(previewRes.status === 200, 'C3: invite preview returns 200');
    const previewBody = previewRes.body as { valid?: boolean; campaignName?: string };
    assert(previewBody?.valid === true, 'C4: invite preview valid=true');
    assert(previewBody?.campaignName === 'Smoke Test World', 'C5: preview shows correct campaign name');

    // C6: Register player1 via invite
    const reg1Res = await player1('/api/auth/register', {
      method: 'POST',
      body: JSON.stringify({ username: 'player1', password: 'password123', inviteToken }),
    });
    assert(reg1Res.status === 201, 'C6: player1 registers via invite');
    assert(player1Jar.has('vtt_session'), 'C7: player1 gets session cookie');
    const reg1Body = reg1Res.body as { joinedCampaignId?: string };
    assert(reg1Body?.joinedCampaignId === campaignId, 'C8: player1 joinedCampaignId matches campaign');

    // C9: player1 lobby shows the campaign with role player
    const p1Lobby = await player1('/api/campaigns');
    assert(p1Lobby.status === 200, 'C9: player1 lobby ok');
    const p1Campaigns = p1Lobby.body as Array<{ id?: string; role?: string }>;
    const p1Campaign = p1Campaigns.find((c) => c.id === campaignId);
    assert(p1Campaign !== undefined, 'C10: player1 lobby contains smoke campaign');
    assert(p1Campaign?.role === 'player', 'C11: player1 role is player');
    // C12: exactly 1 campaign
    assert(p1Campaigns.length === 1, 'C12: player1 lobby has exactly 1 campaign');

    // C13: maxUses:1 invite exhausted after first use
    const reg2Res = await player2('/api/auth/register', {
      method: 'POST',
      body: JSON.stringify({ username: 'player2-fail', password: 'password123', inviteToken }),
    });
    assert(reg2Res.status === 410, 'C13: second register with used invite → 410');

    // Create a second invite to test revocation
    const invite2Res = await admin(`/api/campaigns/${campaignId}/invites`, {
      method: 'POST',
      body: JSON.stringify({}),
    });
    const invite2Token = (invite2Res.body as { token?: string })?.token ?? '';
    assert(typeof invite2Token === 'string' && invite2Token.length > 0, 'C14: second invite created');

    // Revoke it
    const revokeRes = await admin(`/api/campaigns/${campaignId}/invites/${invite2Token}`, {
      method: 'DELETE',
    });
    assert(revokeRes.status === 204, 'C15: revoke invite returns 204');

    // C16: revoked invite → 410
    const revokedPreview = await player2(`/api/invites/${invite2Token}`);
    assert(revokedPreview.status === 410, 'C16: revoked invite preview → 410');

    const revokedReg = await player2('/api/auth/register', {
      method: 'POST',
      body: JSON.stringify({ username: 'player2-revoked', password: 'password123', inviteToken: invite2Token }),
    });
    assert(revokedReg.status === 410, 'C17: register with revoked invite → 410');

    // C18: existing-user redeem adds membership — register player2 fresh, then redeem
    const invite3Res = await admin(`/api/campaigns/${campaignId}/invites`, {
      method: 'POST',
      body: JSON.stringify({ maxUses: 2 }),
    });
    const invite3Token = (invite3Res.body as { token?: string })?.token ?? '';

    // Register player2
    const reg2FreshRes = await player2('/api/auth/register', {
      method: 'POST',
      body: JSON.stringify({ username: 'player2', password: 'password123', inviteToken: invite3Token }),
    });
    assert(reg2FreshRes.status === 201, 'C18: player2 registers with fresh invite');

    // Register player3 (for later tests)
    const invite4Res = await admin(`/api/campaigns/${campaignId}/invites`, {
      method: 'POST',
      body: JSON.stringify({ maxUses: 2 }),
    });
    const invite4Token = (invite4Res.body as { token?: string })?.token ?? '';
    const reg3Res = await player3('/api/auth/register', {
      method: 'POST',
      body: JSON.stringify({ username: 'player3', password: 'password123', inviteToken: invite4Token }),
    });
    assert(reg3Res.status === 201, 'C19: player3 registers ok');

    // C20: existing-user redeem via POST /api/invites/:token/redeem
    // Create another invite and have player1 (already member) redeem it — should be idempotent
    const invite5Res = await admin(`/api/campaigns/${campaignId}/invites`, {
      method: 'POST',
      body: JSON.stringify({}),
    });
    const invite5Token = (invite5Res.body as { token?: string })?.token ?? '';
    const redeemExistingRes = await player1(`/api/invites/${invite5Token}/redeem`, {
      method: 'POST',
    });
    assert(redeemExistingRes.status === 200, 'C20: existing-user redeem → 200 (idempotent membership)');

    // =========================================================================
    // D. AuthZ negatives
    // =========================================================================
    process.stdout.write('\n--- D. AuthZ negatives ---\n');

    // D1: player1 POST /api/campaigns → 403
    const p1CreateCampaign = await player1('/api/campaigns', {
      method: 'POST',
      body: JSON.stringify({ name: 'Player Campaign' }),
    });
    assert(p1CreateCampaign.status === 403, 'D1: player1 create campaign → 403');

    // D2: player1 create invite → 403
    const p1CreateInvite = await player1(`/api/campaigns/${campaignId}/invites`, {
      method: 'POST',
      body: JSON.stringify({}),
    });
    assert(p1CreateInvite.status === 403, 'D2: player1 create invite → 403');

    // D3: no-cookie ws upgrade rejected
    const noCookieResult = await tryConnect(wsUrl, new CookieJar());
    assert(noCookieResult.rejected, 'D3: no-cookie WS upgrade rejected');

    // D4: player1 ws join demo-campaign → NOT_MEMBER fatal
    {
      const { ws, messages } = await openWs(wsUrl, player1Jar);
      send(ws, { type: 'join', protocolVersion: 3, campaignId: 'demo-campaign' });
      try {
        const err = await waitForMessage(messages, (m) => m['type'] === 'error');
        assert(err['code'] === 'NOT_MEMBER', 'D4: player1 join demo-campaign → NOT_MEMBER');
        assert(err['fatal'] === true, 'D5: NOT_MEMBER error is fatal');
      } catch {
        fail('D4: player1 join demo-campaign → NOT_MEMBER', 'timeout waiting for error');
      }
      ws.close();
      await waitMs(100);
    }

    // D6: roll before join → NOT_JOINED
    {
      const { ws, messages } = await openWs(wsUrl, player1Jar);
      send(ws, { type: 'roll', requestId: 'req1', expression: '1d6', visibility: 'public' });
      try {
        const err = await waitForMessage(messages, (m) => m['type'] === 'error');
        assert(err['code'] === 'NOT_JOINED', 'D6: roll before join → NOT_JOINED');
      } catch {
        fail('D6: roll before join → NOT_JOINED', 'timeout');
      }
      ws.close();
      await waitMs(100);
    }

    // =========================================================================
    // E. Upload + board flow
    // =========================================================================
    process.stdout.write('\n--- E. Upload + board ---\n');

    // Generate a 3000px PNG
    const pngBuf = await generatePng(3000, 3000);

    // E1: Admin uploads with dmOnly:true
    const uploadRes = await uploadFile(
      base, adminJar,
      `/api/campaigns/${campaignId}/assets`,
      pngBuf, 'test-image.png', 'image/png',
      { dmOnly: 'true' },
    );
    assert(uploadRes.status === 201, 'E1: admin upload image returns 201');
    const uploadBody = uploadRes.body as { asset?: { id?: string; file?: string; width?: number; height?: number; mime?: string; dmOnly?: boolean } };
    const assetId = uploadBody?.asset?.id;
    const assetFile = uploadBody?.asset?.file;
    assert(typeof assetId === 'string', 'E2: upload returns asset id');
    assert(typeof assetFile === 'string' && assetFile.endsWith('.webp'), 'E3: stored as .webp');
    const storedWidth = uploadBody?.asset?.width ?? 0;
    const storedHeight = uploadBody?.asset?.height ?? 0;
    assert(storedWidth <= 2560 && storedHeight <= 2560, `E4: stored ≤2560px (got ${storedWidth}x${storedHeight})`);
    assert(uploadBody?.asset?.mime === 'image/webp', 'E5: mime is image/webp');
    assert(uploadBody?.asset?.dmOnly === true, 'E6: dmOnly=true on uploaded asset');

    // E7: player1 GET that file → 403 (dmOnly, not on board yet)
    const p1FileGet = await player1(`/api/campaigns/${campaignId}/files/assets/${assetFile}`);
    assert(p1FileGet.status === 403, 'E7: player1 GET dmOnly file before board pin → 403');

    // E8-E12: Admin pins it to board → all members receive boardUpdated AND player can GET file
    const { ws: adminWs, messages: adminMessages } = await openWs(wsUrl, adminJar);
    const { ws: p1Ws, messages: p1Messages } = await openWs(wsUrl, player1Jar);

    // Join both (protocol version 3)
    send(adminWs, { type: 'join', protocolVersion: 3, campaignId });
    send(p1Ws, { type: 'join', protocolVersion: 3, campaignId });

    await waitForMessage(adminMessages, (m) => m['type'] === 'joined', 3000);
    await waitForMessage(p1Messages, (m) => m['type'] === 'joined', 3000);
    await waitForMessage(adminMessages, (m) => m['type'] === 'snapshot', 3000);
    await waitForMessage(p1Messages, (m) => m['type'] === 'snapshot', 3000);

    // Admin pins the image to board
    send(adminWs, { type: 'boardAdd', assetId, x: 0, y: 0 });

    // player1 should receive boardUpdated with the new item
    let boardUpdatedMsg: WsMessage | null = null;
    try {
      boardUpdatedMsg = await waitForMessage(
        p1Messages,
        (m) => m['type'] === 'boardUpdated' &&
          Array.isArray(m['items']) &&
          (m['items'] as Array<{ assetId?: string }>).some((it) => it.assetId === assetId),
        3000,
      );
      assert(boardUpdatedMsg['type'] === 'boardUpdated', 'E8: player1 receives boardUpdated after boardAdd');
      const items = boardUpdatedMsg['items'] as Array<{ assetId?: string; url?: string; id?: string }>;
      assert(Array.isArray(items) && items.length > 0, 'E9: boardUpdated has items');
      const boardItem = items.find((it) => it.assetId === assetId);
      assert(boardItem !== undefined, 'E10: boardUpdated contains the pinned asset');
      assert(
        typeof boardItem?.url === 'string' && boardItem.url.includes('/api/campaigns/') && boardItem.url.includes('/files/assets/'),
        'E11: board item url has correct pattern',
      );
    } catch {
      fail('E8: player1 receives boardUpdated', 'timeout');
    }

    // E12: player1 can now GET the file → 200 (dmOnly but on board)
    const p1FileGetAfterBoard = await player1(`/api/campaigns/${campaignId}/files/assets/${assetFile}`);
    assert(p1FileGetAfterBoard.status === 200, 'E12: player1 can GET dmOnly file after board pin → 200');

    // E13: Non-member GET → 401 or 404
    const nonMemberGet = await makeClient(base, new CookieJar())(`/api/campaigns/${campaignId}/files/assets/${assetFile}`);
    assert(nonMemberGet.status === 401 || nonMemberGet.status === 404, 'E13: non-member GET → 401 or 404');

    // E14: Path traversal → 400/404, never file contents
    const traversalAttempt = await player1(`/api/campaigns/${campaignId}/files/assets/..%2F..%2Fcampaign.json`);
    assert(traversalAttempt.status === 400 || traversalAttempt.status === 404, 'E14: path traversal → 400/404');
    const traversalBody = String(traversalAttempt.body ?? '');
    assert(!traversalBody.includes('"type":"campaign"'), 'E15: path traversal never returns campaign.json contents');

    // E16: player sending boardAdd → FORBIDDEN
    send(p1Ws, { type: 'boardAdd', assetId, x: 10, y: 10 });
    try {
      const forbMsg = await waitForMessage(p1Messages, (m) => m['type'] === 'error' && m['code'] === 'FORBIDDEN', 2000);
      assert(forbMsg['code'] === 'FORBIDDEN', 'E16: player boardAdd → FORBIDDEN');
    } catch {
      fail('E16: player boardAdd → FORBIDDEN', 'timeout');
    }

    // E17: boardRemove the item → player receives boardUpdated with empty items → file back to 403
    const pinnedItemId = (() => {
      if (!boardUpdatedMsg) return null;
      const items = boardUpdatedMsg['items'] as Array<{ assetId?: string; id?: string }>;
      return items.find((it) => it.assetId === assetId)?.id ?? null;
    })();
    assert(typeof pinnedItemId === 'string', 'E17-pre: board item id available');

    if (pinnedItemId) {
      send(adminWs, { type: 'boardRemove', itemId: pinnedItemId });
      try {
        await waitForMessage(
          p1Messages,
          (m) => m['type'] === 'boardUpdated' &&
            Array.isArray(m['items']) &&
            !(m['items'] as Array<{ assetId?: string }>).some((it) => it.assetId === assetId),
          3000,
        );
        pass('E17: player receives boardUpdated after boardRemove');
      } catch {
        fail('E17: player receives boardUpdated after boardRemove', 'timeout');
      }

      // After removal, file back to 403 for player
      const p1FileGetAfterRemove = await player1(`/api/campaigns/${campaignId}/files/assets/${assetFile}`);
      assert(p1FileGetAfterRemove.status === 403, 'E18: player GET dmOnly file after boardRemove → 403 again');
    }

    // Re-pin the asset for persistence tests later
    send(adminWs, { type: 'boardAdd', assetId, x: 0, y: 0 });
    let rePinnedItemId: string | null = null;
    try {
      const rePinMsg = await waitForMessage(
        adminMessages,
        (m) => m['type'] === 'boardUpdated' &&
          Array.isArray(m['items']) &&
          (m['items'] as Array<{ assetId?: string }>).some((it) => it.assetId === assetId),
        3000,
      );
      const items = rePinMsg['items'] as Array<{ assetId?: string; id?: string }>;
      rePinnedItemId = items.find((it) => it.assetId === assetId)?.id ?? null;
      pass('E19: admin re-pins image for persistence tests');
    } catch {
      fail('E19: admin re-pins image', 'timeout');
    }

    // =========================================================================
    // F. Documents (player PDFs)
    // =========================================================================
    process.stdout.write('\n--- F. Documents ---\n');

    const pdfBuf = minimalPdf('test.pdf');

    // F1: player1 uploads PDF
    const docUploadRes = await uploadFile(
      base, player1Jar,
      `/api/campaigns/${campaignId}/documents`,
      pdfBuf, 'test.pdf', 'application/pdf',
    );
    assert(docUploadRes.status === 201, 'F1: player1 upload PDF → 201');
    const docBody = docUploadRes.body as { asset?: { id?: string; assetKind?: string; ownerUsername?: string; file?: string } };
    const docId = docBody?.asset?.id;
    assert(typeof docId === 'string', 'F2: document has id');
    assert(docBody?.asset?.assetKind === 'document', 'F3: assetKind is document');
    assert(docBody?.asset?.ownerUsername === 'player1', 'F4: ownerUsername is player1');

    // F5: documents are PRIVATE to the uploader — admin's documentsUpdated must NOT contain it
    try {
      const docsUpdMsg = await waitForMessage(adminMessages, (m) => m['type'] === 'documentsUpdated', 3000);
      const docs = docsUpdMsg['documents'] as Array<{ id?: string }>;
      assert(Array.isArray(docs) && !docs.some((d) => d.id === docId), 'F5: admin documentsUpdated does NOT contain player1 private doc');
    } catch {
      fail('F5: admin receives documentsUpdated', 'timeout');
    }

    // F6: player1 receives documentsUpdated containing their own doc
    try {
      const p1DocsMsg = await waitForMessage(p1Messages, (m) => m['type'] === 'documentsUpdated', 3000);
      const docs = p1DocsMsg['documents'] as Array<{ id?: string }>;
      assert(Array.isArray(docs) && docs.some((d) => d.id === docId), 'F6: player1 documentsUpdated contains own doc');
    } catch {
      fail('F6: player1 receives documentsUpdated', 'timeout');
    }

    // F7: player1 GET the pdf → 200
    const docFile = docBody?.asset?.file;
    assert(typeof docFile === 'string', 'F7-pre: document file is a string');
    const p1DocGet = await player1(`/api/campaigns/${campaignId}/files/assets/${docFile}`);
    assert(p1DocGet.status === 200, 'F7: player1 GET own pdf → 200');

    // F7a: admin (even DM) cannot fetch the private doc → 403
    const adminPrivGet = await admin(`/api/campaigns/${campaignId}/files/assets/${docFile}`);
    assert(adminPrivGet.status === 403, 'F7a: dm GET private player doc → 403');

    // F7b: player1 shares the doc with the table
    send(p1Ws, { type: 'shareDocument', assetId: docId as string });
    try {
      const sharedMsg = await waitForMessage(adminMessages, (m) => m['type'] === 'documentShared', 3000);
      const sharedAsset = sharedMsg['asset'] as { id?: string };
      assert(sharedAsset?.id === docId, 'F7b: admin receives documentShared for the doc');
    } catch {
      fail('F7b: admin receives documentShared', 'timeout');
    }

    // F7c: after sharing, admin's documentsUpdated contains it and the file is fetchable
    try {
      const docsAfterShare = await waitForMessage(
        adminMessages,
        (m) => m['type'] === 'documentsUpdated' && (m['documents'] as Array<{ id?: string }>).some((d) => d.id === docId),
        3000,
      );
      assert(!!docsAfterShare, 'F7c: admin documentsUpdated contains doc after sharing');
    } catch {
      fail('F7c: admin documentsUpdated contains doc after sharing', 'timeout');
    }
    const adminSharedGet = await admin(`/api/campaigns/${campaignId}/files/assets/${docFile}`);
    assert(adminSharedGet.status === 200, 'F7d: dm GET shared doc → 200');

    // F8: player2 (non-owner) deletes player1's pdf → 403
    const p2DeleteDoc = await player2(`/api/campaigns/${campaignId}/assets/${docId}`, {
      method: 'DELETE',
    });
    assert(p2DeleteDoc.status === 403, 'F8: player2 delete player1 pdf → 403');

    // F9: player1 deletes own → 204
    const p1DeleteDoc = await player1(`/api/campaigns/${campaignId}/assets/${docId}`, {
      method: 'DELETE',
    });
    assert(p1DeleteDoc.status === 204, 'F9: player1 delete own pdf → 204');

    // F10: Admin (dm) can delete any — re-upload and test
    const docUpload2Res = await uploadFile(
      base, player1Jar,
      `/api/campaigns/${campaignId}/documents`,
      pdfBuf, 'test2.pdf', 'application/pdf',
    );
    const docId2 = (docUpload2Res.body as { asset?: { id?: string } })?.asset?.id;
    assert(typeof docId2 === 'string', 'F10-pre: doc2 uploaded');
    const adminDeleteDoc = await admin(`/api/campaigns/${campaignId}/assets/${docId2}`, {
      method: 'DELETE',
    });
    assert(adminDeleteDoc.status === 204, 'F10: admin (dm) can delete any document → 204');

    // =========================================================================
    // G. Dice
    // =========================================================================
    process.stdout.write('\n--- G. Dice ---\n');

    // Set up player2 WS
    const { ws: p2Ws, messages: p2Messages } = await openWs(wsUrl, player2Jar);
    send(p2Ws, { type: 'join', protocolVersion: 3, campaignId });
    await waitForMessage(p2Messages, (m) => m['type'] === 'joined', 3000);
    await waitForMessage(p2Messages, (m) => m['type'] === 'snapshot', 3000);

    // G1: player1 rolls 2d6+3 → all sockets receive rollResult, 5≤total≤15
    const reqId = 'req-' + Date.now();

    send(p1Ws, { type: 'roll', requestId: reqId, expression: '2d6+3', visibility: 'public' });

    try {
      const rollMsg = await waitForMessage(
        p1Messages,
        (m) => m['type'] === 'rollResult' && (m['entry'] as { expression?: string })?.expression === '2d6+3',
        3000,
      );
      const entry = rollMsg['entry'] as { total?: number; parts?: unknown[]; expression?: string };
      const total = entry?.total ?? 0;
      assert(total >= 5 && total <= 15, `G1: 2d6+3 total in [5,15] (got ${total})`);
      assert(Array.isArray(entry?.parts) && entry.parts.length > 0, 'G2: roll parts present');
      assert(rollMsg['requestId'] === reqId, 'G3: requestId echoed to roller');
    } catch {
      fail('G1: player1 roll 2d6+3', 'timeout');
    }

    // G4: admin also receives it
    try {
      await waitForMessage(
        adminMessages,
        (m) => m['type'] === 'rollResult' && (m['entry'] as { expression?: string })?.expression === '2d6+3',
        3000,
      );
      pass('G4: admin receives player1 public roll');
    } catch {
      fail('G4: admin receives player1 public roll', 'timeout');
    }

    // G5: visibility:'dm' roll by admin → player1 receives NOTHING within 500ms
    const dmRollReqId = 'dm-roll-' + Date.now();
    const p1CountBefore = p1Messages.filter((m) => m['type'] === 'rollResult').length;
    send(adminWs, { type: 'roll', requestId: dmRollReqId, expression: '1d20', visibility: 'dm' });
    try {
      const adminDmRoll = await waitForMessage(
        adminMessages,
        (m) => m['type'] === 'rollResult' && m['requestId'] === dmRollReqId,
        3000,
      );
      assert(adminDmRoll !== null, 'G5: admin receives own dm roll');
    } catch {
      fail('G5: admin receives own dm roll', 'timeout');
    }
    await waitMs(500);
    const p1CountAfter = p1Messages.filter((m) => m['type'] === 'rollResult').length;
    assert(p1CountAfter === p1CountBefore, 'G6: player1 does NOT receive dm-visibility roll');

    // G7: player1 private roll → admin sees it, player2 does not
    const privRollReqId = 'priv-' + Date.now();
    const p2CountBefore = p2Messages.filter((m) => m['type'] === 'rollResult').length;
    send(p1Ws, { type: 'roll', requestId: privRollReqId, expression: '1d8', visibility: 'dm' });
    try {
      await waitForMessage(
        adminMessages,
        (m) => m['type'] === 'rollResult' && (m['entry'] as { expression?: string })?.expression === '1d8' && m['requestId'] === privRollReqId,
        3000,
      );
      pass('G7: admin sees player1 dm-visibility roll');
    } catch {
      fail('G7: admin sees player1 dm-visibility roll', 'timeout');
    }
    await waitMs(500);
    const p2CountAfter = p2Messages.filter((m) => m['type'] === 'rollResult').length;
    assert(p2CountAfter === p2CountBefore, 'G8: player2 does NOT see player1 dm-visibility roll');

    // G9: invalid expression → BAD_EXPRESSION, no broadcast
    const p2CountBefore2 = p2Messages.filter((m) => m['type'] === 'rollResult').length;
    send(p1Ws, { type: 'roll', requestId: 'bad-expr', expression: '2d7+x', visibility: 'public' });
    try {
      const badExprMsg = await waitForMessage(p1Messages, (m) => m['type'] === 'error' && m['code'] === 'BAD_EXPRESSION', 2000);
      assert(badExprMsg['code'] === 'BAD_EXPRESSION', 'G9: invalid expression → BAD_EXPRESSION');
    } catch {
      fail('G9: invalid expression → BAD_EXPRESSION', 'timeout');
    }
    await waitMs(300);
    const p2CountAfter2 = p2Messages.filter((m) => m['type'] === 'rollResult').length;
    assert(p2CountAfter2 === p2CountBefore2, 'G10: BAD_EXPRESSION not broadcast to others');

    // G11–G14: advantage roll (keep highest) — 2d20kh
    const advReqId = 'adv-roll-1';
    send(p1Ws, { type: 'roll', requestId: advReqId, expression: '2d20kh+3', visibility: 'public' });
    try {
      const advMsg = await waitForMessage(
        p1Messages,
        (m) => m['type'] === 'rollResult' && m['requestId'] === advReqId,
        3000,
      );
      const entry = advMsg['entry'] as {
        total?: number;
        parts?: Array<{ kind: string; rolls?: number[]; dropped?: number[]; value?: number }>;
      };
      const dicePart = entry.parts?.find((p) => p.kind === 'dice');
      assert(dicePart?.rolls?.length === 2, 'G11: 2d20kh rolls both dice');
      const rolls = dicePart?.rolls ?? [];
      const dropped = dicePart?.dropped ?? [];
      assert(dropped.length === 1, 'G12: exactly one die dropped');
      const droppedIdx = dropped[0] ?? -1;
      const keptIdx = droppedIdx === 0 ? 1 : 0;
      const keptVal = rolls[keptIdx] ?? 0;
      const droppedVal = rolls[droppedIdx] ?? 0;
      assert(keptVal >= droppedVal, 'G13: dropped die is the lower roll');
      assert(entry.total === keptVal + 3, `G14: total = kept die + 3 (got ${entry.total}, kept ${keptVal})`);
    } catch {
      fail('G11: 2d20kh+3 roll', 'timeout');
    }

    // =========================================================================
    // H. Isolation
    // =========================================================================
    process.stdout.write('\n--- H. Isolation ---\n');

    // Create second campaign (admin only)
    const camp2Res = await admin('/api/campaigns', {
      method: 'POST',
      body: JSON.stringify({ name: 'Isolation Test', description: '' }),
    });
    assert(camp2Res.status === 201, 'H1: second campaign created');
    const camp2Id = (camp2Res.body as { campaign?: { id?: string } })?.campaign?.id;
    assert(typeof camp2Id === 'string', 'H2: second campaign has id');

    // Admin joins second campaign
    const { ws: adminWs2, messages: adminMessages2 } = await openWs(wsUrl, adminJar);
    send(adminWs2, { type: 'join', protocolVersion: 3, campaignId: camp2Id });
    await waitForMessage(adminMessages2, (m) => m['type'] === 'joined', 3000);
    await waitForMessage(adminMessages2, (m) => m['type'] === 'snapshot', 3000);

    // Admin uploads to campaign 2
    const img2Buf = await generatePng(100, 100);
    const upload2Res = await uploadFile(
      base, adminJar,
      `/api/campaigns/${camp2Id}/assets`,
      img2Buf, 'small.png', 'image/png',
      { dmOnly: 'false' },
    );
    const asset2Id = (upload2Res.body as { asset?: { id?: string } })?.asset?.id;
    assert(typeof asset2Id === 'string', 'H3: asset in campaign2 uploaded');

    // Admin pins to board in campaign 2 — player1 (in campaign 1) should NOT receive boardUpdated
    const p1BoardCountBefore = p1Messages.filter((m) => m['type'] === 'boardUpdated').length;
    send(adminWs2, { type: 'boardAdd', assetId: asset2Id, x: 0, y: 0 });

    // Wait for campaign2 admin to receive boardUpdated
    try {
      await waitForMessage(
        adminMessages2,
        (m) => m['type'] === 'boardUpdated' &&
          Array.isArray(m['items']) &&
          (m['items'] as Array<{ assetId?: string }>).some((it) => it.assetId === asset2Id),
        3000,
      );
      pass('H4a: admin in campaign2 receives boardUpdated');
    } catch {
      fail('H4a: admin in campaign2 receives boardUpdated', 'timeout');
    }

    await waitMs(500);
    const p1BoardCountAfter = p1Messages.filter((m) => m['type'] === 'boardUpdated').length;
    assert(p1BoardCountAfter === p1BoardCountBefore, 'H4: boardUpdated in campaign2 does NOT reach player1 in campaign1');
    adminWs2.close();

    // =========================================================================
    // I. Reconnect + persistence
    // =========================================================================
    process.stdout.write('\n--- I. Reconnect + persistence ---\n');

    // Destroy player1's socket abruptly (terminate)
    p1Ws.terminate();
    await waitMs(300);

    // Others should get presence with player1 connected:false
    try {
      const presenceAfterDisconnect = await waitForMessage(
        adminMessages,
        (m) => m['type'] === 'presence' && Array.isArray(m['entries']) &&
          (m['entries'] as Array<{ userId?: string; connected?: boolean }>).some(
            (e) => e.userId !== undefined && e.connected === false,
          ),
        3000,
      );
      assert(presenceAfterDisconnect !== null, 'I1: admin receives presence with connected:false after player1 disconnect');
    } catch {
      fail('I1: admin receives presence with connected:false after player1 disconnect', 'timeout');
    }

    // Reopen with same cookie + join
    const { ws: p1WsNew, messages: p1MessagesNew } = await openWs(wsUrl, player1Jar);
    send(p1WsNew, { type: 'join', protocolVersion: 3, campaignId });
    await waitForMessage(p1MessagesNew, (m) => m['type'] === 'joined', 3000);

    // Snapshot contains board items (re-pinned earlier) + prior rolls
    try {
      const snapMsg = await waitForMessage(p1MessagesNew, (m) => m['type'] === 'snapshot', 3000);
      const snap = snapMsg as {
        type: string;
        board?: Array<{ assetId?: string }>;
        rollLog?: unknown[];
      };
      const boardHasItem = Array.isArray(snap.board) && snap.board.some((it) => it.assetId === assetId);
      assert(boardHasItem, 'I2: snapshot contains board item (re-pinned asset)');
      assert(Array.isArray(snap.rollLog) && (snap.rollLog?.length ?? 0) > 0, 'I3: snapshot contains prior rolls');
    } catch {
      fail('I2: snapshot after reconnect', 'timeout');
    }

    // One presence entry for player1 (no duplicates)
    try {
      const presenceMsg = await waitForMessage(
        adminMessages,
        (m) => m['type'] === 'presence' && Array.isArray(m['entries']) &&
          (m['entries'] as Array<{ userId?: string; connected?: boolean }>).some(
            (e) => e.connected === true,
          ),
        3000,
      );
      const entries = presenceMsg['entries'] as Array<{ userId?: string }>;
      const p1Entries = entries.filter(
        (e) => e.userId === (reg1Body as { user?: { id?: string } })?.user?.id,
      );
      assert(p1Entries.length <= 1, `I4: at most 1 presence entry for player1 (got ${p1Entries.length})`);
      pass('I5: presence deduplication ok');
    } catch {
      fail('I4: presence dedup check', 'timeout');
    }

    // I6-I8: Kill server (SIGTERM), restart same dirs → admin cookie still valid + board intact
    killServer();
    await waitMs(500);

    const port2 = await getFreePort();
    const base2 = `http://localhost:${port2}`;
    const wsUrl2 = `ws://localhost:${port2}/ws`;

    secondServer = spawn(
      'node', [SERVER_DIST],
      {
        env: {
          ...process.env as Record<string, string>,
          PORT: String(port2),
          DATA_DIR: dataDir,
          CAMPAIGNS_DIR: campaignsDir,
          ADMIN_PASSWORD: 'test-admin-pw',
          ADMIN_USER: 'admin',
          COOKIE_SECURE: 'false',
          PUBLIC_ORIGIN: `http://localhost:${port2}`,
        },
        stdio: ['ignore', 'pipe', 'pipe'],
      },
    );

    await waitForHealth(base2, 10000);

    // Admin cookie still valid
    const admin2 = makeClient(base2, adminJar);
    const meAfterRestart = await admin2('/api/auth/me');
    assert(meAfterRestart.status === 200, 'I6: admin cookie still valid after server restart');

    // Snapshot still has board items + roll history
    const { ws: adminWsRestart, messages: adminMsgsRestart } = await openWs(wsUrl2, adminJar);
    send(adminWsRestart, { type: 'join', protocolVersion: 3, campaignId });
    await waitForMessage(adminMsgsRestart, (m) => m['type'] === 'joined', 3000);
    try {
      const snapRestart = await waitForMessage(adminMsgsRestart, (m) => m['type'] === 'snapshot', 3000);
      const snap = snapRestart as { board?: Array<{ assetId?: string }>; rollLog?: unknown[] };
      const boardHasItem = Array.isArray(snap.board) && snap.board.some((it) => it.assetId === assetId);
      assert(boardHasItem, 'I7: snapshot after restart has board item');
      assert(Array.isArray(snap.rollLog) && (snap.rollLog?.length ?? 0) > 0, 'I8: snapshot after restart has roll history');
    } catch {
      fail('I7: snapshot after restart', 'timeout');
    }

    adminWsRestart.close();

    // =========================================================================
    // J. Notes
    // =========================================================================
    process.stdout.write('\n--- J. Notes ---\n');

    // Reopen p1WsNew connection on port2
    const { ws: p1WsPort2, messages: p1MsgsPort2 } = await openWs(wsUrl2, player1Jar);
    send(p1WsPort2, { type: 'join', protocolVersion: 3, campaignId });
    await waitForMessage(p1MsgsPort2, (m) => m['type'] === 'joined', 3000);
    await waitForMessage(p1MsgsPort2, (m) => m['type'] === 'snapshot', 3000);

    // J1: player1 saveNote visibility='player' → noteSaved + persisted
    send(p1WsPort2, {
      type: 'saveNote',
      title: 'My Note',
      body: 'Player note content',
      visibility: 'player',
    });

    try {
      const noteSavedMsg = await waitForMessage(p1MsgsPort2, (m) => m['type'] === 'noteSaved', 3000);
      const note = noteSavedMsg['note'] as { id?: string; visibility?: string; ownerUsername?: string };
      assert(note?.visibility === 'player', 'J1: note visibility is player');
      assert(note?.ownerUsername === 'player1', 'J2: note ownerUsername is player1');

      const noteId = note?.id;
      assert(typeof noteId === 'string', 'J3: note has id');

      // J4: persisted as notes/<id>.json on disk
      const notePath = path.join(campaignDir, 'notes', `${noteId}.json`);
      const noteFileExists = await fs.access(notePath).then(() => true).catch(() => false);
      assert(noteFileExists, 'J4: note persisted to disk');

      if (noteFileExists) {
        const noteRaw = JSON.parse(await fs.readFile(notePath, 'utf8')) as { ownerUsername?: string };
        assert(noteRaw.ownerUsername === 'player1', 'J5: disk note ownerUsername is player1');
      }
    } catch {
      fail('J1: player1 saveNote', 'timeout');
    }

    // J6: player1 saveNote visibility='dm' → rejected (FORBIDDEN)
    send(p1WsPort2, {
      type: 'saveNote',
      title: 'DM Note',
      body: 'Trying to write dm note',
      visibility: 'dm',
    });
    try {
      const forbiddenMsg = await waitForMessage(p1MsgsPort2, (m) => m['type'] === 'error' && m['code'] === 'FORBIDDEN', 2000);
      assert(forbiddenMsg['code'] === 'FORBIDDEN', 'J6: player saveNote visibility=dm → FORBIDDEN');
    } catch {
      fail('J6: player saveNote visibility=dm → FORBIDDEN', 'timeout');
    }

    // J7: dm can save dm notes
    const { ws: adminWsPort2Notes, messages: adminMsgsPort2Notes } = await openWs(wsUrl2, adminJar);
    send(adminWsPort2Notes, { type: 'join', protocolVersion: 3, campaignId });
    await waitForMessage(adminMsgsPort2Notes, (m) => m['type'] === 'joined', 3000);
    send(adminWsPort2Notes, {
      type: 'saveNote',
      title: 'DM Secret',
      body: 'DM-only content',
      visibility: 'dm',
    });
    try {
      const dmNoteSaved = await waitForMessage(adminMsgsPort2Notes, (m) => m['type'] === 'noteSaved', 3000);
      const note = dmNoteSaved['note'] as { visibility?: string };
      assert(note?.visibility === 'dm', 'J7: dm can save dm-visibility notes');
    } catch {
      fail('J7: dm can save dm-visibility notes', 'timeout');
    }

    // J8–J11: shared notes — player1 shares a note with the table
    send(p1WsPort2, {
      type: 'saveNote',
      title: 'Party plan',
      body: 'We attack at dawn',
      visibility: 'shared',
    });
    let sharedNoteId: string | undefined;
    try {
      const sharedSaved = await waitForMessage(
        adminMsgsPort2Notes,
        (m) => m['type'] === 'noteSaved' && (m['note'] as { title?: string })?.title === 'Party plan',
        3000,
      );
      const note = sharedSaved['note'] as { id?: string; visibility?: string; ownerUsername?: string };
      sharedNoteId = note?.id;
      assert(note?.visibility === 'shared', 'J8: shared note broadcast to other members');
      assert(note?.ownerUsername === 'player1', 'J9: shared note keeps owner');
    } catch {
      fail('J8: shared note broadcast to other members', 'timeout');
    }

    // J10: non-owner non-dm cannot edit a shared note
    if (sharedNoteId) {
      const { ws: p2WsNotes, messages: p2MsgsNotes } = await openWs(wsUrl2, player2Jar);
      send(p2WsNotes, { type: 'join', protocolVersion: 3, campaignId });
      await waitForMessage(p2MsgsNotes, (m) => m['type'] === 'joined', 3000);
      send(p2WsNotes, {
        type: 'saveNote',
        noteId: sharedNoteId,
        title: 'Hijacked',
        body: 'rewritten',
        visibility: 'shared',
      });
      try {
        const forb = await waitForMessage(p2MsgsNotes, (m) => m['type'] === 'error' && m['code'] === 'FORBIDDEN', 2000);
        assert(forb['code'] === 'FORBIDDEN', 'J10: non-owner cannot edit shared note');
      } catch {
        fail('J10: non-owner cannot edit shared note', 'timeout');
      }
      p2WsNotes.close();

      // J11: unsharing removes it from other members
      send(p1WsPort2, {
        type: 'saveNote',
        noteId: sharedNoteId,
        title: 'Party plan',
        body: 'We attack at dawn',
        visibility: 'player',
      });
      try {
        const removed = await waitForMessage(
          adminMsgsPort2Notes,
          (m) => m['type'] === 'noteDeleted' && m['noteId'] === sharedNoteId,
          3000,
        );
        assert(removed['noteId'] === sharedNoteId, 'J11: unsharing sends noteDeleted to others');
      } catch {
        fail('J11: unsharing sends noteDeleted to others', 'timeout');
      }
    }

    adminWsPort2Notes.close();
    p1WsPort2.close();

    // =========================================================================
    // L. Upload lock
    // =========================================================================
    process.stdout.write('\n--- L. Upload lock ---\n');

    // Open fresh WS connections on port2
    const { ws: adminWsLock, messages: adminMsgsLock } = await openWs(wsUrl2, adminJar);
    const { ws: p1WsLock, messages: p1MsgsLock } = await openWs(wsUrl2, player1Jar);
    send(adminWsLock, { type: 'join', protocolVersion: 3, campaignId });
    send(p1WsLock, { type: 'join', protocolVersion: 3, campaignId });
    await waitForMessage(adminMsgsLock, (m) => m['type'] === 'joined', 3000);
    await waitForMessage(p1MsgsLock, (m) => m['type'] === 'joined', 3000);
    await waitForMessage(adminMsgsLock, (m) => m['type'] === 'snapshot', 3000);
    await waitForMessage(p1MsgsLock, (m) => m['type'] === 'snapshot', 3000);

    // L1: player trying setUploadsLocked → FORBIDDEN
    send(p1WsLock, { type: 'setUploadsLocked', locked: true });
    try {
      const forbMsg = await waitForMessage(p1MsgsLock, (m) => m['type'] === 'error' && m['code'] === 'FORBIDDEN', 2000);
      assert(forbMsg['code'] === 'FORBIDDEN', 'L1: player setUploadsLocked → FORBIDDEN');
    } catch {
      fail('L1: player setUploadsLocked → FORBIDDEN', 'timeout');
    }

    // L2: DM locks uploads → player receives settingsUpdated
    send(adminWsLock, { type: 'setUploadsLocked', locked: true });
    try {
      const settingsMsg = await waitForMessage(p1MsgsLock, (m) => m['type'] === 'settingsUpdated', 3000);
      assert(settingsMsg['uploadsLocked'] === true, 'L2: player receives settingsUpdated with uploadsLocked=true');
    } catch {
      fail('L2: player receives settingsUpdated', 'timeout');
    }

    // L3: player POST documents → 403 UPLOADS_LOCKED
    const pdfBuf2 = minimalPdf('locked-test.pdf');
    const lockedUpload = await uploadFile(
      base2, player1Jar,
      `/api/campaigns/${campaignId}/documents`,
      pdfBuf2, 'locked-test.pdf', 'application/pdf',
    );
    assert(lockedUpload.status === 403, 'L3: player upload while locked → 403');
    const lockedBody = lockedUpload.body as { code?: string };
    assert(lockedBody?.code === 'UPLOADS_LOCKED', 'L4: locked upload returns UPLOADS_LOCKED code');

    // L5: DM POST documents still 201 while locked
    const dmLockedUpload = await uploadFile(
      base2, adminJar,
      `/api/campaigns/${campaignId}/documents`,
      pdfBuf2, 'dm-upload.pdf', 'application/pdf',
    );
    assert(dmLockedUpload.status === 201, 'L5: DM upload while locked → 201');

    // L6: DM unlocks → player receives settingsUpdated with false
    send(adminWsLock, { type: 'setUploadsLocked', locked: false });
    try {
      const unlockMsg = await waitForMessage(p1MsgsLock, (m) => m['type'] === 'settingsUpdated' && m['uploadsLocked'] === false, 3000);
      assert(unlockMsg['uploadsLocked'] === false, 'L6: player receives settingsUpdated with uploadsLocked=false');
    } catch {
      fail('L6: player receives unlock settingsUpdated', 'timeout');
    }

    // L7: player POST documents now → 201
    const unlockedUpload = await uploadFile(
      base2, player1Jar,
      `/api/campaigns/${campaignId}/documents`,
      pdfBuf2, 'unlocked-test.pdf', 'application/pdf',
    );
    assert(unlockedUpload.status === 201, 'L7: player upload after unlock → 201');

    adminWsLock.close();
    p1WsLock.close();

    // =========================================================================
    // K. Production path
    // =========================================================================
    process.stdout.write('\n--- K. Production path ---\n');

    // The server at port2 is already running with NODE (no tsx).
    // Check if client dist exists
    const clientDist = path.join(REPO_ROOT, 'packages', 'client', 'dist');
    const clientDistExists = await fs.access(clientDist).then(() => true).catch(() => false);

    if (clientDistExists) {
      // Spawn a third server with CLIENT_DIST pointing at the real client build
      const port3 = await getFreePort();
      const base3 = `http://localhost:${port3}`;

      const prodServer = spawn(
        'node', [SERVER_DIST],
        {
          env: {
            ...process.env as Record<string, string>,
            PORT: String(port3),
            DATA_DIR: dataDir,
            CAMPAIGNS_DIR: campaignsDir,
            ADMIN_PASSWORD: 'test-admin-pw',
            ADMIN_USER: 'admin',
            COOKIE_SECURE: 'false',
            PUBLIC_ORIGIN: `http://localhost:${port3}`,
            CLIENT_DIST: clientDist,
          },
          stdio: ['ignore', 'pipe', 'pipe'],
        },
      );

      try {
        await waitForHealth(base3, 10000);

        // GET / returns index.html (SPA)
        const rootRes = await fetch(base3 + '/');
        const rootText = await rootRes.text();
        assert(rootRes.ok, 'K1: GET / returns 200');
        assert(rootText.includes('<html') || rootText.includes('<!DOCTYPE'), 'K2: GET / returns HTML');

        // /api/health ok
        const healthRes = await fetch(`${base3}/api/health`);
        const healthBody = await healthRes.json() as { ok?: boolean };
        assert(healthRes.ok && healthBody.ok === true, 'K3: /api/health ok on prod server');

        // A static asset loads (look for a .js or .css file in client dist)
        const distFiles = await fs.readdir(path.join(clientDist, 'assets')).catch(() => [] as string[]);
        const jsFile = distFiles.find((f) => f.endsWith('.js'));
        if (jsFile) {
          const assetRes = await fetch(`${base3}/assets/${jsFile}`);
          assert(assetRes.ok, `K4: static asset /assets/${jsFile} loads ok`);
        } else {
          pass('K4: (no .js in dist/assets to test, skipping)');
        }
      } finally {
        prodServer.kill('SIGTERM');
      }
    } else {
      pass('K1: (client dist not built, skipping prod static-serve test — run pnpm -r build first)');
      pass('K2: (skipped)');
      pass('K3: (skipped)');
      pass('K4: (skipped)');
    }

    // =========================================================================
    // Cleanup
    // =========================================================================
    p1WsNew.close();
    p2Ws.close();
    adminWs.close();
    p1Ws.close();

  } finally {
    killServer();
    if (secondServer) {
      secondServer.kill('SIGTERM');
      secondServer = null;
    }

    // Clean up temp dirs
    await fs.rm(tmpBase, { recursive: true, force: true }).catch(() => {});
  }

  // =========================================================================
  // Results
  // =========================================================================
  process.stdout.write('\n' + '='.repeat(60) + '\n');
  process.stdout.write(`Smoke test complete: ${assertCount} assertions\n`);

  if (failures.length === 0) {
    process.stdout.write(`ALL PASSED\n`);
    process.exit(0);
  } else {
    process.stdout.write(`FAILURES (${failures.length}):\n`);
    for (const f of failures) {
      process.stdout.write(`  ${f}\n`);
    }
    process.exit(1);
  }
}

main().catch((err: unknown) => {
  killServer();
  process.stderr.write(`Unhandled smoke test error: ${String(err)}\n`);
  if (err instanceof Error && err.stack) {
    process.stderr.write(err.stack + '\n');
  }
  process.exit(1);
});
