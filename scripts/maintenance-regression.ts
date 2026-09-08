/** Real runtime, journal and handler checks; all files live in OS temp storage. */
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { fileURLToPath } from 'node:url';
import type { CampaignEntry } from '../packages/server/src/campaign/registry.js';
import type { WsSession } from '../packages/server/src/ws/hub.js';

async function main(): Promise<void> {
  const crash = process.env['MAINTENANCE_CRASH_DIR'];
  const tmp = crash ?? await fs.mkdtemp(path.join(os.tmpdir(), 'tavern-maintenance-'));
  process.env['DATA_DIR'] = path.join(tmp, 'auth');
  const { loadRuntime, persistState, DEFAULT_GRID } = await import('../packages/server/src/campaign/runtime.js');
  const { recoverCampaign, mutateCampaign } = await import('../packages/server/src/campaign/commit.js');
  const { addCampaign } = await import('../packages/server/src/campaign/registry.js');
  const { handleMessage } = await import('../packages/server/src/ws/handlers.js');
  const { closeWebSockets } = await import('../packages/server/src/ws/hub.js');
  const metrics = await import('../packages/server/src/metrics.js');
  const { log } = await import('../packages/server/src/log.js');
  if (crash) {
    const rename = fs.rename;
    fs.rename = async (source, target) => {
      if (process.env['MAINTENANCE_PHASE'] === 'committed' && String(source).endsWith('/pending-commit')) process.kill(process.pid, 'SIGKILL');
      await rename(source, target);
      if (process.env['MAINTENANCE_PHASE'] === 'partial' && String(target).endsWith('/map-templates.json')) process.kill(process.pid, 'SIGKILL');
    };
    await loadRuntime(crash);
    throw new Error('crash injection not reached');
  }
  let passed = 0;
  const pass = (label: string) => console.log(`PASS ${++passed}: ${label}`);
  const template = { id: 'tpl_old', name: 'Old map', createdAt: '', board: [{ id: 'bi_old', assetId: 'ast_old', x: 0, y: 0, w: 800, z: 1 }], pieces: [{ id: 'pc_old', builtin: null, assetId: 'ast_prop', imageUrl: null, x: 1, y: 2, w: 3, h: 4, rotation: 0, z: 1, layer: 'props', lockedToGrid: false }], grid: DEFAULT_GRID, mapMeta: { name: 'Old map', areaTag: '' } };
  const legacy = JSON.stringify({ board: [], mapTemplates: [template] });
  async function fixture(name: string): Promise<string> {
    const dir = path.join(tmp, name);
    await fs.mkdir(path.join(dir, '.runtime'), { recursive: true });
    await fs.writeFile(path.join(dir, '.runtime/state.json'), legacy);
    return dir;
  }
  async function failRename(target: string, action: () => Promise<void>) {
    const rename = fs.rename;
    let hit = false;
    fs.rename = async (source, dest) => {
      if (!hit && String(dest) === target) { hit = true; throw new Error('injected maintenance write failure'); }
      await rename(source, dest);
    };
    try { await action(); assert.ok(hit); } finally { fs.rename = rename; }
  }
  try {
    const freshDir = path.join(tmp, 'fresh');
    const fresh = await loadRuntime(freshDir);
    await failRename(path.join(fresh.dir, 'state.json'), async () => { await assert.rejects(persistState(fresh), /injected maintenance/); });
    assert.equal(fresh.templatesStored, false);
    await assert.rejects(fs.access(path.join(fresh.dir, 'map-templates.json')), { code: 'ENOENT' });
    await persistState(fresh);
    assert.equal(fresh.templatesStored, true);
    assert.deepEqual((await loadRuntime(freshDir)).state.mapTemplates, []);
    const dir = await fixture('migration');
    const stateFile = path.join(dir, '.runtime/state.json');
    const archiveFile = path.join(dir, '.runtime/map-templates.json');
    await failRename(stateFile, async () => { await assert.rejects(loadRuntime(dir), /injected maintenance/); });
    assert.equal(await fs.readFile(stateFile, 'utf8'), legacy);
    await assert.rejects(fs.access(archiveFile), { code: 'ENOENT' });
    const runtime = await loadRuntime(dir);
    assert.deepEqual(runtime.state.mapTemplates, [template]);
    assert.equal(Object.hasOwn(JSON.parse(await fs.readFile(stateFile, 'utf8')), 'mapTemplates'), false);
    assert.deepEqual(JSON.parse(await fs.readFile(archiveFile, 'utf8')), { schemaVersion: 1, templates: [template] });
    assert.deepEqual((await loadRuntime(dir)).state.mapTemplates, [template]);
    const savedArchive = await fs.readFile(archiveFile);
    const markedState = await fs.readFile(stateFile);
    await fs.unlink(archiveFile);
    await assert.rejects(loadRuntime(dir), /missing saved map templates/);
    assert.deepEqual(await fs.readFile(stateFile), markedState);
    await fs.writeFile(archiveFile, savedArchive);
    await fs.unlink(stateFile);
    await assert.rejects(loadRuntime(dir), /missing runtime state/);
    assert.deepEqual(await fs.readFile(archiveFile), savedArchive);
    await fs.writeFile(stateFile, markedState);
    pass('legacy migration is atomic, preserves nested references, and reloads the separate portable archive');

    for (const phase of ['partial', 'committed']) {
      const crashDir = await fixture(`crash-${phase}`);
      const child = spawn(process.execPath, ['--import', 'tsx', fileURLToPath(import.meta.url)], { env: { ...process.env, MAINTENANCE_CRASH_DIR: crashDir, MAINTENANCE_PHASE: phase }, stdio: 'pipe' });
      const timeout = setTimeout(() => child.kill('SIGKILL'), 5000);
      const [, signal] = await once(child, 'exit'); clearTimeout(timeout);
      assert.equal(signal, 'SIGKILL');
      await recoverCampaign(crashDir);
      const stored = JSON.parse(await fs.readFile(path.join(crashDir, '.runtime/state.json'), 'utf8'));
      assert.equal(Object.hasOwn(stored, 'mapTemplates'), phase === 'partial');
      assert.deepEqual((await loadRuntime(crashDir)).state.mapTemplates, [template]);
    }
    pass('SIGKILL before/after the migration marker restores legacy data or retains the committed archive');

    for (const contents of ['{broken', JSON.stringify({ schemaVersion: 1, templates: [{ ...template, pieces: [{}] }] })]) {
      await fs.writeFile(archiveFile, contents);
      const state = await fs.readFile(stateFile, 'utf8');
      await assert.rejects(loadRuntime(dir), /could not load saved map templates/);
      assert.equal(await fs.readFile(archiveFile, 'utf8'), contents);
      assert.equal(await fs.readFile(stateFile, 'utf8'), state);
    }
    await fs.writeFile(archiveFile, JSON.stringify({ schemaVersion: 1, templates: [template] }));
    await fs.writeFile(stateFile, legacy);
    await assert.rejects(loadRuntime(dir), /could not load saved map templates/);
    await fs.writeFile(stateFile, JSON.stringify({ board: [] }));
    pass('malformed and conflicting existing archives fail closed without replacing either file');

    const entry: CampaignEntry = { store: { dir, meta: { type: 'campaign', schemaVersion: 1, id: 'maintenance', name: 'Maintenance', description: '' }, chapters: new Map(), characters: new Map(), assets: new Map(), notes: new Map() }, runtime, room: new Set(), media: null };
    addCampaign('maintenance', entry.store, entry.runtime);
    const archive = runtime.state.mapTemplates;
    const before = await fs.stat(archiveFile);
    Object.defineProperty(archive[0], 'toJSON', { configurable: true, enumerable: true, value: () => { throw new Error('archive was serialized'); } });
    for (let i = 0; i < 10; i++) await mutateCampaign(entry, async (draft) => {
      assert.equal(draft.runtime.state.mapTemplates, archive, 'ordinary commands must not clone the archive');
      draft.runtime.state.mapMeta.name = `board-${i}`;
      await persistState(draft.runtime);
    });
    const after = await fs.stat(archiveFile);
    assert.equal(before.ino, after.ino); assert.equal(before.mtimeMs, after.mtimeMs);
    assert.equal(Object.hasOwn(JSON.parse(await fs.readFile(stateFile, 'utf8')), 'mapTemplates'), false);
    Reflect.deleteProperty(archive[0]!, 'toJSON');
    pass('ordinary commits neither clone, serialize nor rewrite archived templates');

    const sent: any[] = [];
    const session: WsSession = { id: 'fixture', ws: { readyState: 1, send: (data: string) => sent.push(JSON.parse(data)), close: () => {} } as unknown as WsSession['ws'], userId: 'dm', username: 'DM', campaignId: 'maintenance', role: 'dm', isAlive: true };
    await handleMessage(session, { type: 'saveMapTemplate', requestId: 'save', name: 'New map' });
    assert.ok(sent.some((message) => message.type === 'commandAck' && message.requestId === 'save'));
    assert.equal((await loadRuntime(dir)).state.mapTemplates.length, 2);
    await failRename(archiveFile, async () => { await handleMessage(session, { type: 'deleteMapTemplate', requestId: 'failed', id: 'tpl_old' }); });
    assert.ok(sent.some((message) => message.type === 'error' && message.requestId === 'failed'));
    assert.ok(!sent.some((message) => message.type === 'commandAck' && message.requestId === 'failed'));
    assert.equal((await loadRuntime(dir)).state.mapTemplates.length, 2);
    await handleMessage(session, { type: 'deleteMapTemplate', requestId: 'delete', id: 'tpl_old' });
    assert.equal((await loadRuntime(dir)).state.mapTemplates.length, 1);
    const commandMetrics = metrics.metricsSnapshot();
    assert.equal(commandMetrics.commands, 3);
    assert.equal(commandMetrics.rejectedCommands, 1);
    assert.ok(commandMetrics.commits > 0 && commandMetrics.failedCommits >= 3);
    assert.equal(commandMetrics.durations['commandMs']!.samples, 3);
    pass('actual template handlers save/delete only the archive and report durable failures without ACK');

    metrics.metricsSnapshot(true);
    let release!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    const queued = [mutateCampaign(entry, async () => gate), mutateCampaign(entry, async () => {}), mutateCampaign(entry, async () => {})];
    assert.equal(metrics.metricsSnapshot().queueDepth, 3);
    await new Promise((resolve) => setTimeout(resolve, 20)); release(); await Promise.all(queued);
    metrics.recordDisconnect('hidden-user'); metrics.recordConnection('hidden-user');
    for (let i = 0; i < 2000; i++) metrics.duration('commandMs', i);
    const report = metrics.metricsSnapshot();
    assert.equal(report.queueDepth, 0); assert.equal(report.peakQueueDepth, 3);
    assert.ok(report.durations['queueWaitMs']!.max >= 15);
    assert.equal(report.durations['commandMs']!.samples, 512);
    assert.equal(report.reconnectObservations, 1);
    assert.ok(!JSON.stringify(report).includes('hidden-user'));
    const logs: string[] = [], originalInfo = log.info;
    log.info = (message) => { logs.push(message); };
    try {
      const stop = metrics.startMetrics();
      await new Promise((resolve) => setTimeout(resolve, 40));
      const until = performance.now() + 60; while (performance.now() < until) {}
      await new Promise((resolve) => setTimeout(resolve, 40)); stop();
    } finally { log.info = originalInfo; }
    const local = JSON.parse(logs[0]!.slice('Local metrics '.length));
    assert.ok(local.eventLoopMs.max >= 50);
    assert.equal(metrics.metricsSnapshot().connections, 0);
    pass('bounded local metrics expose real queue pressure, reconnect observations and event-loop stalls without identity labels');
    console.log(`Maintenance regressions passed (${passed} scenarios).`);
  } finally { await closeWebSockets(); await fs.rm(tmp, { recursive: true, force: true }); }
}

main().catch((error) => { console.error(error); process.exitCode = 1; });
