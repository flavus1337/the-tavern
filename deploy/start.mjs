#!/usr/bin/env node
/**
 * One-command launcher for The Tavern. Works the same on Linux, macOS,
 * and Windows. Use Node 24 LTS (minimum 22.13), and Corepack or pinned pnpm.
 *
 *   node deploy/start.mjs
 *
 * What it does:
 *   1. checks the Node version
 *   2. installs frozen dependencies when manifests/lockfile/runtime change
 *   3. rebuilds when sources or dependencies change
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
import { existsSync, mkdirSync, chmodSync, renameSync, createReadStream } from 'node:fs';
import { writeFile, mkdtemp, readFile, readdir, rename } from 'node:fs/promises';
import { randomBytes, createHash } from 'node:crypto';
import { once } from 'node:events';
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
const args = new Set(process.argv.slice(2));
if ([...args].some((arg) => !['--local', '--rebuild', '--update', '--help'].includes(arg))) die('Unknown option. Use --help.');
if (args.has('--help')) {
  console.log('Usage: node deploy/start.mjs [--local] [--rebuild] [--update]\n  --local    Start locally without downloading or opening a tunnel\n  --rebuild  Force a build\n  --update   Reinstall the frozen lockfile and rebuild (run after git pull)');
  process.exit(0);
}

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
const [nodeMajor, nodeMinor] = process.versions.node.split('.').map(Number);
if (nodeMajor < 22 || nodeMajor === 22 && nodeMinor < 13) {
  die(`Node 22.13+ required, found ${process.version}. Use Node 24 LTS from https://nodejs.org`);
}
if (!Number.isInteger(PORT) || PORT < 1 || PORT > 65535) die('PORT must be an integer from 1 to 65535.');

// --- 2. Dependencies ----------------------------------------------------------
const pkg = JSON.parse(await readFile('package.json', 'utf8'));
const pnpmVersion = /^pnpm@(\d+\.\d+\.\d+)$/.exec(pkg.packageManager)?.[1];
if (!pnpmVersion) die('package.json must pin an exact pnpm version.');
let packageRunner;
function pnpm(args, label) {
  if (!packageRunner) {
    for (const candidate of [['corepack', 'pnpm'], ['pnpm']]) {
      const probe = spawnSync(candidate[0], [...candidate.slice(1), '--version'], { encoding: 'utf8', shell: isWindows, timeout: 30_000 });
      if (probe.status === 0 && probe.stdout.trim() === pnpmVersion) { packageRunner = candidate; break; }
    }
    if (!packageRunner) die(`Install Corepack or the pinned pnpm: npm install -g pnpm@${pnpmVersion}`);
  }
  run(packageRunner[0], [...packageRunner.slice(1), ...args], label);
}

async function fingerprint(paths) {
  const hash = createHash('sha256');
  async function add(file) {
    hash.update(file + '\0');
    for await (const chunk of createReadStream(file)) hash.update(chunk);
  }
  async function walk(dir) {
    for (const entry of (await readdir(dir, { withFileTypes: true })).sort((a, b) => a.name.localeCompare(b.name))) {
      if (['node_modules', 'dist'].includes(entry.name) || entry.name.endsWith('.tsbuildinfo')) continue;
      if (dir === 'packages' && !['shared', 'server', 'client'].includes(entry.name)) continue;
      if (/^packages[/\\][^/\\]+$/.test(dir)) {
        if (entry.isDirectory() && !['src', 'assets', 'public'].includes(entry.name)) continue;
        if (entry.isFile() && !/\.(json|[cm]?[jt]s|html)$/.test(entry.name)) continue;
      }
      const file = path.join(dir, entry.name);
      if (entry.isDirectory()) await walk(file);
      else if (entry.isFile()) await add(file);
    }
  }
  for (const entry of paths) {
    if (entry === 'packages') await walk(entry);
    else await add(entry);
  }
  return hash.digest('hex');
}
const stampFile = path.join('node_modules', '.tavern-launcher.json');
let stamp = {};
try {
  const saved = JSON.parse(await readFile(stampFile, 'utf8'));
  if (saved && typeof saved === 'object' && !Array.isArray(saved)) stamp = saved;
} catch {}
const dependencies = `${process.platform}/${process.arch}/${process.versions.modules}/${await fingerprint(['package.json', 'pnpm-lock.yaml', 'pnpm-workspace.yaml', ...['shared', 'server', 'client'].map((name) => `packages/${name}/package.json`)])}`;
const install = args.has('--update') || stamp.dependencies !== dependencies || ['node_modules', ...['server', 'client'].map((name) => `packages/${name}/node_modules`)].some((dir) => !existsSync(dir));
async function saveStamp() {
  mkdirSync('node_modules', { recursive: true });
  const tmp = `${stampFile}.${process.pid}.tmp`;
  await writeFile(tmp, JSON.stringify(stamp));
  await rename(tmp, stampFile);
}
if (install) {
  pnpm(['install', '--frozen-lockfile'], 'Installing pinned dependencies');
  stamp = { dependencies };
  await saveStamp();
}

// --- 3. Build ------------------------------------------------------------------
const sources = await fingerprint(['packages', 'tsconfig.base.json']);
if (install || args.has('--rebuild') || stamp.sources !== sources || !existsSync(SERVER_ENTRY) || !existsSync(CLIENT_INDEX) || !existsSync('packages/server/dist/image-worker.js')) {
  stamp = { dependencies };
  await saveStamp();
  pnpm(['-r', 'build'], 'Building current sources');
  stamp = { dependencies, sources };
  await saveStamp();
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
  const res = await fetch(url, { signal: AbortSignal.timeout(60_000) });
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
const cloudflaredBin = args.has('--local') ? null : await ensureCloudflared();

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
if (cloudflaredBin) console.log(`==> Starting Cloudflare quick tunnel for http://localhost:${PORT} …`);
const tunnel = cloudflaredBin ? spawn(cloudflaredBin, ['tunnel', '--url', `http://localhost:${PORT}`], {
  stdio: ['ignore', 'pipe', 'pipe'],
}) : null;

tunnel?.on('error', (err) => { console.error(`cloudflared failed to start: ${err.message}`); void shutdown(1); });

let serverProc = null;
let shuttingDown = false;

async function shutdown(code = 0) {
  if (shuttingDown) return;
  shuttingDown = true;
  await Promise.all([serverProc, tunnel].filter(Boolean).map(async (child) => {
    if (!child.pid || child.exitCode !== null || child.signalCode !== null) return;
    const exited = once(child, 'exit').catch(() => {});
    // IPC lets Windows drain too: Windows kill(SIGTERM) terminates immediately.
    if (child === serverProc && child.connected) child.send({ type: 'shutdown' }, (error) => { if (error) child.kill('SIGTERM'); });
    else child.kill('SIGTERM');
    const timeout = setTimeout(() => {
      console.error('Child shutdown exceeded 12s; forcing termination.');
      code = 1;
      child.kill('SIGKILL');
    }, 12_000);
    try {
      const result = await exited;
      if (child === serverProc && result?.[0] !== 0) code = result?.[0] ?? 1;
    } finally { clearTimeout(timeout); }
  }));
  process.exit(code);
}
process.on('SIGINT', () => shutdown(0));
process.on('SIGTERM', () => shutdown(0));

// cloudflared writes the URL (and everything else) to stderr.
const publicUrl = !tunnel ? `http://localhost:${PORT}` : await new Promise((resolve) => {
  let buf = '';
  const onEarlyExit = () => {
    console.error(buf);
    console.error('cloudflared exited before providing a URL (log above).');
    void shutdown(1);
  };
  const timer = setTimeout(() => {
    console.error(buf);
    console.error('Tunnel did not come up within 30s (log above).');
    void shutdown(1);
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

    (${tunnel ? 'the URL changes on every restart; ' : ''}Ctrl-C waits for saved work, then stops everything)
  ╚══════════════════════════════════════════════════════════════╝
`);

// --- 7. Server (foreground; exits propagate to the tunnel) -----------------------
serverProc = spawn(process.execPath, [SERVER_ENTRY], {
  stdio: ['inherit', 'inherit', 'inherit', 'ipc'],
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

serverProc.on('exit', (code) => shutdown(code ?? 1));
serverProc.on('error', (err) => { console.error(`Server failed to start: ${err.message}`); void shutdown(1); });
tunnel?.on('exit', () => {
  if (!shuttingDown) {
    console.error('Tunnel exited; stopping server (restart the script for a new URL).');
    shutdown(1);
  }
});
