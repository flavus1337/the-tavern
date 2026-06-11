#!/usr/bin/env node
/**
 * Start The Tavern with a Cloudflare quick tunnel — cross-platform
 * (Linux, macOS, Windows).
 *
 *   node deploy/start.mjs
 *
 * Env overrides: PORT (8080), DATA_DIR (./live/data),
 * CAMPAIGNS_DIR (./live/campaigns), ADMIN_PASSWORD (first run only).
 *
 * Quick tunnels get a NEW random URL on every start — the script prints it;
 * share it (or a fresh invite link) with your players. Ctrl-C stops both the
 * server and the tunnel. For a permanent URL, see DEPLOY.md.
 *
 * Requires `cloudflared` on PATH:
 *   Linux:   see deploy/setup-ubuntu.sh (or your distro's package)
 *   macOS:   brew install cloudflared
 *   Windows: winget install Cloudflare.cloudflared
 */
import { spawn } from 'node:child_process';
import { createServer } from 'node:net';
import { existsSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
process.chdir(repoRoot);

const PORT = Number(process.env.PORT ?? 8080);
const DATA_DIR = process.env.DATA_DIR ?? path.join('live', 'data');
const CAMPAIGNS_DIR = process.env.CAMPAIGNS_DIR ?? path.join('live', 'campaigns');
const SERVER_ENTRY = path.join('packages', 'server', 'dist', 'index.js');

function die(msg) {
  console.error(msg);
  process.exit(1);
}

if (!existsSync(SERVER_ENTRY)) {
  die('Server not built — run: pnpm install && pnpm -r build  (or ./deploy/setup-ubuntu.sh on Ubuntu)');
}

mkdirSync(DATA_DIR, { recursive: true });
mkdirSync(CAMPAIGNS_DIR, { recursive: true });

// --- Fail fast if the port is taken ------------------------------------------
await new Promise((resolve) => {
  const probe = createServer();
  probe.once('error', (err) => {
    if (err.code === 'EADDRINUSE') {
      die(`Port ${PORT} is already in use — is The Tavern already running? (override with PORT=8090)`);
    }
    resolve();
  });
  probe.once('listening', () => probe.close(resolve));
  probe.listen(PORT);
});

// --- Tunnel first: its random URL goes into the server env -------------------
console.log(`==> Starting Cloudflare quick tunnel for http://localhost:${PORT} …`);
const tunnel = spawn('cloudflared', ['tunnel', '--url', `http://localhost:${PORT}`], {
  stdio: ['ignore', 'pipe', 'pipe'],
});

tunnel.on('error', (err) => {
  if (err.code === 'ENOENT') {
    die(
      'cloudflared not found on PATH.\n' +
        '  Linux:   ./deploy/setup-ubuntu.sh\n' +
        '  macOS:   brew install cloudflared\n' +
        '  Windows: winget install Cloudflare.cloudflared',
    );
  }
  die(`cloudflared failed to start: ${err.message}`);
});

let serverProc = null;
let shuttingDown = false;

function shutdown(code = 0) {
  if (shuttingDown) return;
  shuttingDown = true;
  serverProc?.kill();
  tunnel.kill();
  // Give children a moment to exit cleanly.
  setTimeout(() => process.exit(code), 300);
}
process.on('SIGINT', () => shutdown(0));
process.on('SIGTERM', () => shutdown(0));

// cloudflared writes the URL (and everything else) to stderr.
const publicUrl = await new Promise((resolve) => {
  let buf = '';
  const onData = (chunk) => {
    buf += chunk.toString();
    const m = buf.match(/https:\/\/[a-z0-9-]+\.trycloudflare\.com/);
    if (m) resolve(m[0]);
  };
  tunnel.stdout.on('data', onData);
  tunnel.stderr.on('data', onData);
  tunnel.once('exit', () => {
    console.error(buf);
    die('cloudflared exited before providing a URL — log above.');
  });
  setTimeout(() => {
    console.error(buf);
    die('Tunnel did not come up within 30s — log above.');
  }, 30_000);
});

console.log(`
  ╔══════════════════════════════════════════════════════════════╗
    The Tavern is reachable at:
    ${publicUrl}
    (new URL each start — share it or mint a fresh invite link)
  ╚══════════════════════════════════════════════════════════════╝
`);

// --- Server (foreground; exits propagate to the tunnel) ----------------------
serverProc = spawn(process.execPath, [SERVER_ENTRY], {
  stdio: 'inherit',
  env: {
    ...process.env, // ADMIN_PASSWORD, if set by the caller, passes through
    PORT: String(PORT),
    DATA_DIR,
    CAMPAIGNS_DIR,
    PUBLIC_ORIGIN: publicUrl,
    COOKIE_SECURE: 'false',
  },
});

serverProc.on('exit', (code) => shutdown(code ?? 0));
tunnel.on('exit', () => {
  if (!shuttingDown) {
    console.error('Tunnel exited — stopping server (restart the script for a new URL).');
    shutdown(1);
  }
});
