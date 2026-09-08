/** Execute the actual launcher against fake package tools/server; no tunnel or network. */
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { createServer } from 'node:net';

const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'tavern-launcher-'));
const bin = path.join(tmp, 'bin');
const probe = createServer();
await new Promise((resolve) => probe.listen(0, '127.0.0.1', resolve));
const port = probe.address().port;
await new Promise((resolve) => probe.close(resolve));
const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
let sequence = 0, passed = 0;
const pass = (label) => console.log(`PASS ${++passed}: ${label}`);
async function commands() {
  return (await fs.readFile(path.join(tmp, 'commands.jsonl'), 'utf8').catch(() => '')).trim().split('\n').filter(Boolean).map((line) => JSON.parse(line));
}
async function launch(options = [], env = {}, success = true, preload) {
  const run = String(++sequence);
  const child = spawn(process.execPath, [...(preload ? ['--require', preload] : []), path.join(tmp, 'deploy/start.mjs'), '--local', ...options], {
    cwd: tmp, env: { ...process.env, PATH: bin + path.delimiter + process.env.PATH, PORT: String(port), LLM_API_KEY: '', DATA_DIR: path.join(tmp, 'world/data'), CAMPAIGNS_DIR: path.join(tmp, 'world/campaigns'), ADMIN_PASSWORD: 'fixture-only', LAUNCH_RUN: run, ...env }, stdio: ['ignore', 'pipe', 'pipe'],
  });
  let output = '';
  child.stdout.on('data', (data) => { output += data; }); child.stderr.on('data', (data) => { output += data; });
  const exit = once(child, 'exit');
  const timeout = setTimeout(() => child.kill('SIGKILL'), 10_000);
  try {
    if (success) {
      for (let i = 0; i < 400 && !output.includes('FIXTURE SERVER READY') && child.exitCode === null; i++) await pause(10);
      assert.ok(output.includes('FIXTURE SERVER READY'), output);
      const stoppedAt = performance.now();
      child.kill('SIGINT');
      const [code] = await exit;
      assert.equal(code, Number(env.FAKE_DRAIN_CODE ?? 0), output);
      assert.ok(performance.now() - stoppedAt >= 550, 'launcher must await the child durable-drain marker');
      assert.equal(await fs.readFile(path.join(tmp, `drained-${run}`), 'utf8'), 'committed');
      assert.ok(output.includes('http://localhost:'));
    } else {
      const [code] = await exit;
      assert.equal(code, 1, output);
      assert.ok(!output.includes('FIXTURE SERVER READY'), output);
    }
    assert.ok(!output.includes('CLOUDFLARED WAS CALLED'), output);
    return output;
  } finally { clearTimeout(timeout); if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL'); }
}

try {
  for (const directory of ['deploy', 'bin', 'packages/shared/src', 'packages/server/src', 'packages/client/src']) await fs.mkdir(path.join(tmp, directory), { recursive: true });
  await fs.copyFile('deploy/start.mjs', path.join(tmp, 'deploy/start.mjs'));
  await fs.writeFile(path.join(tmp, 'package.json'), JSON.stringify({ packageManager: 'pnpm@9.0.0' }));
  for (const name of ['shared', 'server', 'client']) await fs.writeFile(path.join(tmp, `packages/${name}/package.json`), '{"type":"module"}');
  for (const name of ['pnpm-lock.yaml', 'pnpm-workspace.yaml', 'tsconfig.base.json']) await fs.writeFile(path.join(tmp, name), '{}');
  await fs.writeFile(path.join(tmp, 'packages/shared/src/input.ts'), 'export const value = 1;');
  await fs.writeFile(path.join(tmp, 'fake-server.mjs'), `import fs from 'node:fs';
let stopping = false;
function stop() { if (stopping) return; stopping = true; setTimeout(() => { fs.writeFileSync('drained-' + process.env.LAUNCH_RUN, 'committed'); process.exit(Number(process.env.FAKE_DRAIN_CODE || 0)); }, 600); }
process.on('message', message => { if (message.type === 'shutdown') stop(); });
process.on('disconnect', stop);
process.on('SIGTERM', () => { throw new Error('launcher should request graceful IPC shutdown'); });
console.log('FIXTURE SERVER READY');
setInterval(() => {}, 1000);
`);
  const tool = `#!/usr/bin/env node
const fs = require('node:fs'), path = require('node:path');
const runner = path.basename(process.argv[1]);
const args = process.argv.slice(runner === 'corepack' ? 3 : 2);
if (args[0] === '--version') { console.log(process.env[runner === 'corepack' ? 'COREPACK_VERSION' : 'PNPM_VERSION'] || '9.0.0'); process.exit(0); }
fs.appendFileSync('commands.jsonl', JSON.stringify({ runner, args }) + '\\n');
if (args[0] === 'install') { for (const name of ['node_modules', 'packages/server/node_modules', 'packages/client/node_modules']) fs.mkdirSync(name, {recursive:true}); }
if (args.includes('build')) {
  if (process.env.FAKE_BUILD_FAIL) process.exit(2);
  for (const name of ['packages/server/dist', 'packages/client/dist']) fs.mkdirSync(name, {recursive:true});
  fs.copyFileSync('fake-server.mjs', 'packages/server/dist/index.js');
  fs.writeFileSync('packages/server/dist/image-worker.js', '// worker');
  fs.writeFileSync('packages/client/dist/index.html', '<html>fixture</html>');
}
`;
  for (const name of ['corepack', 'pnpm']) await fs.writeFile(path.join(bin, name), tool, { mode: 0o755 });
  await fs.writeFile(path.join(bin, 'cloudflared'), '#!/usr/bin/env node\nconsole.log("CLOUDFLARED WAS CALLED"); process.exit(2);', { mode: 0o755 });

  await launch();
  assert.deepEqual((await commands()).map((call) => call.args), [['install', '--frozen-lockfile'], ['-r', 'build']]);
  await fs.mkdir(path.join(tmp, 'packages/server/data'));
  await fs.writeFile(path.join(tmp, 'packages/server/data/accounts.json'), '{"private":"fixture"}');
  await launch();
  assert.equal((await commands()).length, 2);
  pass('first local start uses frozen install/build, subsequent unchanged starts reuse output, and IPC shutdown waits for child writes');

  const input = path.join(tmp, 'packages/shared/src/input.ts');
  const previous = await fs.stat(input);
  await fs.writeFile(input, 'export const value = 2;');
  await fs.utimes(input, previous.atime, previous.mtime);
  await launch();
  assert.deepEqual((await commands()).at(-1).args, ['-r', 'build']);
  assert.equal((await commands()).length, 3);
  await fs.appendFile(path.join(tmp, 'pnpm-lock.yaml'), '\n# changed');
  await launch();
  assert.deepEqual((await commands()).slice(-2).map((call) => call.args), [['install', '--frozen-lockfile'], ['-r', 'build']]);
  pass('content changes trigger rebuild despite unchanged mtime; lock changes trigger a frozen install and rebuild');

  let count = (await commands()).length;
  await launch(['--rebuild']); assert.equal((await commands()).length, count + 1);
  await launch(['--update']); assert.equal((await commands()).length, count + 3);
  await fs.unlink(path.join(tmp, 'packages/server/dist/image-worker.js'));
  await launch(); assert.deepEqual((await commands()).at(-1).args, ['-r', 'build']);
  pass('explicit rebuild/update and missing production worker output select the required work');

  await launch(['--rebuild'], { FAKE_BUILD_FAIL: '1' }, false);
  count = (await commands()).length;
  await launch(); assert.equal((await commands()).length, count + 1);
  await launch(['--update'], { COREPACK_VERSION: 'wrong' });
  assert.ok((await commands()).slice(-2).every((call) => call.runner === 'pnpm'));
  const badVersion = await launch(['--update'], { COREPACK_VERSION: 'wrong', PNPM_VERSION: '8.0.0' }, false);
  assert.ok(badVersion.includes('pnpm@9.0.0'));
  pass('failed builds remain stale and wrong/missing Corepack falls back only to the pinned pnpm version');

  const preload = path.join(tmp, 'old-node.cjs');
  await fs.writeFile(preload, "Object.defineProperty(process.versions, 'node', { value: '22.12.0' });");
  assert.ok((await launch([], {}, false, preload)).includes('Node 22.13+ required'));
  assert.ok((await launch([], { PORT: 'bad' }, false)).includes('PORT must be'));
  pass('unsupported Node and invalid port fail before child launch');
  await launch([], { FAKE_DRAIN_CODE: '7' });
  pass('server drain failure propagates a nonzero launcher exit after waiting for the child');
  console.log(`Launcher regressions passed (${passed} scenarios, no network/tunnel).`);
} finally { await fs.rm(tmp, { recursive: true, force: true }); }
