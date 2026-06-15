#!/usr/bin/env node
/**
 * One-command launcher for The Tavern. Works the same on Linux, macOS,
 * and Windows. The only prerequisite is Node 22+.
 *
 *   node deploy/start.mjs
 *
 * What it does:
 *   1. checks the Node version
 *   2. installs dependencies if node_modules is missing (pnpm via corepack)
 *   3. builds the app if no build exists
 *   4. finds cloudflared on PATH, or downloads it into deploy/.bin/
 *   5. starts a Cloudflare quick tunnel + the server
 *   6. prints the public URL and, on first run, the generated DM credentials
 *
 * Env overrides: PORT (8080), DATA_DIR (./live/data),
 * CAMPAIGNS_DIR (./live/campaigns), ADMIN_USER (DM), ADMIN_PASSWORD.
 *
 * Quick tunnels get a NEW random URL on every start. Ctrl-C stops both the
 * server and the tunnel. For a permanent URL, see DEPLOY.md.
 */
import { spawn, spawnSync } from 'node:child_process';
import { createServer } from 'node:net';
import { existsSync, mkdirSync, chmodSync, renameSync } from 'node:fs';
import { writeFile, mkdtemp } from 'node:fs/promises';
import { randomBytes } from 'node:crypto';
import { tmpdir } from 'node:os';
import path from 'node:path';
import readline from 'node:readline';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
process.chdir(repoRoot);

const isWindows = process.platform === 'win32';
const PORT = Number(process.env.PORT ?? 8080);
const DATA_DIR = process.env.DATA_DIR ?? path.join('live', 'data');
const CAMPAIGNS_DIR = process.env.CAMPAIGNS_DIR ?? path.join('live', 'campaigns');
const SERVER_ENTRY = path.join('packages', 'server', 'dist', 'index.js');
const CLIENT_INDEX = path.join('packages', 'client', 'dist', 'index.html');
const LOCAL_BIN = path.join(repoRoot, 'deploy', '.bin');

function die(msg) {
  console.error(`\n${msg}`);
  process.exit(1);
}

function run(cmd, args, label) {
  console.log(`==> ${label}`);
  const res = spawnSync(cmd, args, { stdio: 'inherit', shell: isWindows });
  if (res.error?.code === 'ENOENT') die(`${cmd} not found. Is Node installed correctly?`);
  if (res.status !== 0) die(`${label} failed (exit ${res.status}).`);
}

// --- 1. Node version ----------------------------------------------------------
const nodeMajor = Number(process.versions.node.split('.')[0]);
if (nodeMajor < 22) {
  die(`Node 22+ required, found ${process.version}. Get it from https://nodejs.org`);
}

// --- 2. Dependencies ----------------------------------------------------------
// corepack ships with Node and runs the pnpm version pinned in package.json,
// so no global pnpm install is needed.
if (!existsSync('node_modules')) {
  run('corepack', ['pnpm', 'install'], 'Installing dependencies (first run, this takes a minute)');
}

// --- 3. Build ------------------------------------------------------------------
if (!existsSync(SERVER_ENTRY) || !existsSync(CLIENT_INDEX)) {
  run('corepack', ['pnpm', '-r', 'build'], 'Building');
}

// --- 4. cloudflared -------------------------------------------------------------
async function ensureCloudflared() {
  // Prefer a system install.
  const probe = spawnSync('cloudflared', ['--version'], { stdio: 'ignore', shell: isWindows });
  if (probe.status === 0) return 'cloudflared';

  const localBin = path.join(LOCAL_BIN, isWindows ? 'cloudflared.exe' : 'cloudflared');
  if (existsSync(localBin)) return localBin;

  const arch = { x64: 'amd64', arm64: 'arm64' }[process.arch];
  if (!arch) die(`Unsupported CPU architecture: ${process.arch}`);

  const base = 'https://github.com/cloudflare/cloudflared/releases/latest/download';
  let url;
  if (process.platform === 'linux') url = `${base}/cloudflared-linux-${arch}`;
  else if (process.platform === 'darwin') url = `${base}/cloudflared-darwin-${arch}.tgz`;
  else if (isWindows) {
    if (arch !== 'amd64') die('cloudflared has no Windows arm64 build; install it manually.');
    url = `${base}/cloudflared-windows-amd64.exe`;
  } else die(`Unsupported platform: ${process.platform}`);

  console.log('==> Downloading cloudflared (one time, ~20 MB)');
  const res = await fetch(url);
  if (!res.ok) die(`Download failed: ${res.status} ${res.statusText} (${url})`);
  const buf = Buffer.from(await res.arrayBuffer());

  mkdirSync(LOCAL_BIN, { recursive: true });
  if (url.endsWith('.tgz')) {
    // macOS ships a tarball; tar is preinstalled there.
    const tmp = await mkdtemp(path.join(tmpdir(), 'cloudflared-'));
    const tgz = path.join(tmp, 'cloudflared.tgz');
    await writeFile(tgz, buf);
    const tar = spawnSync('tar', ['-xzf', tgz, '-C', tmp]);
    if (tar.status !== 0) die('Failed to extract cloudflared archive.');
    renameSync(path.join(tmp, 'cloudflared'), localBin);
  } else {
    await writeFile(localBin, buf);
  }
  if (!isWindows) chmodSync(localBin, 0o755);
  return localBin;
}
const cloudflaredBin = await ensureCloudflared();

// --- 5. World dirs + first-run credentials --------------------------------------
mkdirSync(DATA_DIR, { recursive: true });
mkdirSync(CAMPAIGNS_DIR, { recursive: true });

const adminUser = process.env.ADMIN_USER ?? 'DM';
const firstRun = !existsSync(path.join(DATA_DIR, 'users.json'));
let adminPassword = process.env.ADMIN_PASSWORD;
let generatedPassword = false;
if (firstRun && !adminPassword) {
  adminPassword = randomBytes(12).toString('base64url').slice(0, 16);
  generatedPassword = true;
}

// --- 5b. Image generation API key (interactive, optional) -----------------------
// Asked once per start. Press Enter to skip — the app runs fine without it
// (AI map generation is simply disabled). Set LLM_API_KEY in the env to skip
// the prompt. The key is passed to the server process only; never written to disk.
let llmApiKey = process.env.LLM_API_KEY ?? '';
if (!llmApiKey && process.stdin.isTTY) {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  const answer = await new Promise((resolve) =>
    rl.question('\n==> Image generation: paste a Gemini API key, or press Enter to skip: ', resolve),
  );
  rl.close();
  llmApiKey = (answer || '').trim();
  console.log(llmApiKey
    ? '    ✓ AI map generation enabled for this session.'
    : '    → Continuing without AI generation (you can add a key on the next start).');
}

// --- Fail fast if the port is taken ----------------------------------------------
await new Promise((resolve) => {
  const probe = createServer();
  probe.once('error', (err) => {
    if (err.code === 'EADDRINUSE') {
      die(`Port ${PORT} is already in use. Is The Tavern already running? (override with PORT=8090)`);
    }
    resolve();
  });
  probe.once('listening', () => probe.close(resolve));
  probe.listen(PORT);
});

// --- 6. Tunnel first: its random URL goes into the server env --------------------
console.log(`==> Starting Cloudflare quick tunnel for http://localhost:${PORT} …`);
const tunnel = spawn(cloudflaredBin, ['tunnel', '--url', `http://localhost:${PORT}`], {
  stdio: ['ignore', 'pipe', 'pipe'],
});

tunnel.on('error', (err) => die(`cloudflared failed to start: ${err.message}`));

let serverProc = null;
let shuttingDown = false;

function shutdown(code = 0) {
  if (shuttingDown) return;
  shuttingDown = true;
  serverProc?.kill();
  tunnel.kill();
  setTimeout(() => process.exit(code), 300);
}
process.on('SIGINT', () => shutdown(0));
process.on('SIGTERM', () => shutdown(0));

// cloudflared writes the URL (and everything else) to stderr.
const publicUrl = await new Promise((resolve) => {
  let buf = '';
  const onEarlyExit = () => {
    console.error(buf);
    die('cloudflared exited before providing a URL (log above).');
  };
  const timer = setTimeout(() => {
    console.error(buf);
    die('Tunnel did not come up within 30s (log above).');
  }, 30_000);
  const onData = (chunk) => {
    buf += chunk.toString();
    const m = buf.match(/https:\/\/[a-z0-9-]+\.trycloudflare\.com/);
    if (m) {
      // Success — disarm the failure paths or they fire later and kill a
      // perfectly healthy session.
      clearTimeout(timer);
      tunnel.removeListener('exit', onEarlyExit);
      tunnel.stdout.removeListener('data', onData);
      tunnel.stderr.removeListener('data', onData);
      resolve(m[0]);
    }
  };
  tunnel.stdout.on('data', onData);
  tunnel.stderr.on('data', onData);
  tunnel.once('exit', onEarlyExit);
});

const credentialLine = generatedPassword
  ? `    DM login:  ${adminUser} / ${adminPassword}   (first run, save this!)`
  : firstRun
  ? `    DM login:  ${adminUser} / <your ADMIN_PASSWORD>`
  : `    DM login:  use your existing credentials`;

console.log(`
  ╔══════════════════════════════════════════════════════════════╗
    The Tavern is reachable at:
    ${publicUrl}

${credentialLine}

    (the URL changes on every restart; Ctrl-C stops everything)
  ╚══════════════════════════════════════════════════════════════╝
`);

// --- 7. Server (foreground; exits propagate to the tunnel) -----------------------
serverProc = spawn(process.execPath, [SERVER_ENTRY], {
  stdio: 'inherit',
  env: {
    ...process.env,
    PORT: String(PORT),
    DATA_DIR,
    CAMPAIGNS_DIR,
    PUBLIC_ORIGIN: publicUrl,
    COOKIE_SECURE: 'false',
    ADMIN_USER: adminUser,
    ...(llmApiKey ? { LLM_API_KEY: llmApiKey } : {}),
    ...(adminPassword ? { ADMIN_PASSWORD: adminPassword } : {}),
  },
});

serverProc.on('exit', (code) => shutdown(code ?? 0));
tunnel.on('exit', () => {
  if (!shuttingDown) {
    console.error('Tunnel exited; stopping server (restart the script for a new URL).');
    shutdown(1);
  }
});
