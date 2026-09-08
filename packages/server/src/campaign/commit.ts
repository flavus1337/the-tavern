import { AsyncLocalStorage } from 'node:async_hooks';
import { randomUUID } from 'node:crypto';
import fs from 'node:fs/promises';
import { constants } from 'node:fs';
import path from 'node:path';
import type { CampaignEntry } from './registry.js';
import { log } from '../log.js';
import { performance } from 'node:perf_hooks';
import { changeQueueDepth, count, duration } from '../metrics.js';

// sourcePath is a completed private scratch file. Its data must never change:
// callers may only unlink it after the enclosing transaction settles.
type FileContent = string | Buffer | { sourcePath: string } | null;

interface CommitContext {
  dir: string;
  original?: CampaignEntry;
  draft?: CampaignEntry;
  files: Map<string, FileContent>;
  values: Map<object, unknown>;
  publish: Array<() => void>;
}

interface JournalFile { file: string; existed: boolean; deleted: boolean }
const context = new AsyncLocalStorage<CommitContext>();
const queues = new Map<string, Promise<void>>();
const blocked = new Set<string>();
let stopping = false;

function missing(err: unknown): boolean {
  return (err as NodeJS.ErrnoException).code === 'ENOENT';
}

async function syncDir(dir: string): Promise<void> {
  // Windows does not expose directory fsync through Node. File data is still
  // synced and renamed atomically there; power-loss directory durability is OS-dependent.
  try {
    const handle = await fs.open(dir, 'r');
    try { await handle.sync(); } finally { await handle.close(); }
  } catch (err) {
    if (process.platform !== 'win32' || !['EISDIR', 'EPERM', 'EINVAL', 'EBADF', 'ENOTSUP'].includes((err as NodeJS.ErrnoException).code ?? '')) throw err;
  }
}

async function writeSynced(file: string, value: string | Buffer): Promise<void> {
  const handle = await fs.open(file, 'wx');
  try { await handle.writeFile(value); await handle.sync(); } finally { await handle.close(); }
}

async function copySynced(source: string, target: string): Promise<void> {
  // Reflink where supported; Node falls back to a regular copy elsewhere.
  await fs.copyFile(source, target, constants.COPYFILE_FICLONE);
  const handle = await fs.open(target, 'r+');
  try { await handle.sync(); } finally { await handle.close(); }
}

async function stageSource(source: string, target: string): Promise<void> {
  // Upload scratch files are immutable until commit settles. Linking avoids a
  // large copy while holding the queue; different filesystems fall back to copy.
  try { await fs.link(source, target); }
  catch (error) {
    if (!['EXDEV', 'ENOTSUP', 'EOPNOTSUPP', 'ENOSYS', 'EPERM'].includes((error as NodeJS.ErrnoException).code ?? '')) throw error;
    await copySynced(source, target);
    return;
  }
  const handle = await fs.open(target, 'r+');
  try { await handle.sync(); } finally { await handle.close(); }
}

/** Publish a fsynced replacement atomically; recovery copies keep their source. */
async function replaceFrom(source: string, target: string, consume = false): Promise<void> {
  const dir = path.dirname(target);
  const created = await fs.mkdir(dir, { recursive: true });
  if (created) {
    for (let current = dir; ; current = path.dirname(current)) {
      await syncDir(path.dirname(current));
      if (current === created) break;
    }
  }
  if (consume) {
    await fs.rename(source, target);
    await syncDir(dir);
    return;
  }
  const tmp = `${target}.${randomUUID()}.tmp`;
  try {
    await copySynced(source, tmp);
    await fs.rename(tmp, target);
    await syncDir(dir);
  } finally {
    await fs.unlink(tmp).catch((err: unknown) => { if (!missing(err)) throw err; });
  }
}

function campaignPath(dir: string, file: string): string {
  const absolute = path.resolve(dir, file);
  const relative = path.relative(dir, absolute);
  if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) {
    throw new Error('file is outside the campaign');
  }
  return absolute;
}

async function readJournal(dir: string, pending: string): Promise<JournalFile[]> {
  const raw: unknown = JSON.parse(await fs.readFile(path.join(pending, 'journal.json'), 'utf8'));
  if (!Array.isArray(raw)) throw new Error('invalid campaign commit journal');
  for (const item of raw) {
    if (!item || typeof item.file !== 'string' || typeof item.existed !== 'boolean' || typeof item.deleted !== 'boolean') {
      throw new Error('invalid campaign commit journal entry');
    }
    campaignPath(dir, item.file);
  }
  return raw as JournalFile[];
}

async function restore(dir: string, pending: string, files: JournalFile[]): Promise<void> {
  // Clear a possibly published marker before restoring, so another crash retries rollback.
  await fs.unlink(path.join(pending, 'committed')).catch((err: unknown) => { if (!missing(err)) throw err; });
  await syncDir(pending);
  for (const [i, item] of files.entries()) {
    const target = campaignPath(dir, item.file);
    if (item.existed) {
      await replaceFrom(path.join(pending, `${i}.before`), target);
    } else {
      await fs.unlink(target).catch((err: unknown) => { if (!missing(err)) throw err; });
      await syncDir(path.dirname(target)).catch((err: unknown) => { if (!missing(err)) throw err; });
    }
  }
}

async function retainBackup(runtimeDir: string, pending: string): Promise<void> {
  const backup = path.join(runtimeDir, 'last-commit');
  await fs.rm(backup, { recursive: true, force: true });
  await fs.rename(pending, backup);
  await syncDir(runtimeDir);
}

/** Run before either campaign entities or runtime state are loaded. Never guess on corruption. */
export async function recoverCampaign(dir: string): Promise<void> {
  const runtimeDir = path.join(dir, '.runtime');
  const pending = path.join(runtimeDir, 'pending-commit');
  let files: JournalFile[] | undefined;
  try {
    files = await readJournal(dir, pending);
  } catch (err) {
    if (!missing(err)) throw err;
    // A pending directory without its durable journal is corruption, not an empty campaign.
    let exists = true;
    try { await fs.access(pending); }
    catch (accessErr) { if (!missing(accessErr)) throw accessErr; exists = false; }
    if (exists) throw err;
  }
  if (files) {
    let committed = false;
    try { await fs.access(path.join(pending, 'committed')); committed = true; }
    catch (err) { if (!missing(err)) throw err; }
    if (committed) {
      await retainBackup(runtimeDir, pending);
    } else {
      await restore(dir, pending, files);
      await fs.rm(pending, { recursive: true });
      await syncDir(runtimeDir);
      log.warn(`Recovered interrupted campaign commit: ${dir}`);
    }
  }
  // A crash during preparation never touched live files. Discard only our scratch directories.
  const entries = await fs.readdir(runtimeDir).catch((err: unknown) => { if (!missing(err)) throw err; return []; });
  for (const entry of entries) {
    if (/^prepare-[0-9a-f-]{36}$/.test(entry)) await fs.rm(path.join(runtimeDir, entry), { recursive: true });
  }

}

async function commitFiles(ctx: CommitContext): Promise<void> {
  if (!ctx.files.size) return;
  const started = performance.now();
  try { await installFiles(ctx); count('commits'); }
  catch (error) { count('failedCommits'); throw error; }
  finally { duration('commitMs', performance.now() - started); }
}

async function installFiles(ctx: CommitContext): Promise<void> {
  const runtimeDir = path.join(ctx.dir, '.runtime');
  const created = await fs.mkdir(runtimeDir, { recursive: true });
  if (created) await syncDir(path.dirname(created));
  await recoverCampaign(ctx.dir);
  const prepared = path.join(runtimeDir, `prepare-${randomUUID()}`);
  const pending = path.join(runtimeDir, 'pending-commit');
  const files: JournalFile[] = [];
  let installed = false;
  await fs.mkdir(prepared);
  try {
    async function prepare(target: string, value: string | Buffer | null, source?: string, staged = false): Promise<string | undefined> {
      const i = files.length;
      let existed = false;
      try {
        const stat = await fs.lstat(target);
        if (!stat.isFile()) throw new Error(`campaign target is not a regular file: ${target}`);
        existed = true;
      } catch (err) { if (!missing(err)) throw err; }
      const before = path.join(prepared, `${i}.before`);
      if (existed) await copySynced(target, before);
      if (source) await (staged ? stageSource : copySynced)(source, path.join(prepared, `${i}.after`));
      else if (value !== null) await writeSynced(path.join(prepared, `${i}.after`), value);
      files.push({ file: path.relative(ctx.dir, target), existed, deleted: value === null && !source });
      return existed ? before : undefined;
    }
    for (const [target, value] of ctx.files) {
      const source = value && typeof value === 'object' && !Buffer.isBuffer(value) ? value.sourcePath : undefined;
      const before = await prepare(target, source ? null : value as string | Buffer | null, source, !!source);
      // Keep the previous version of each touched file, including absence. Backups
      // join this journal so a failed save cannot leave a mismatched sidecar pair.
      const backup = path.join(runtimeDir, 'backups', path.relative(ctx.dir, target));
      await prepare(backup, null, before);
    }
    await writeSynced(path.join(prepared, 'journal.json'), JSON.stringify(files));
    await syncDir(prepared);
    await fs.rename(prepared, pending);
    installed = true;
    await syncDir(runtimeDir);
    for (const [i, item] of files.entries()) {
      const target = campaignPath(ctx.dir, item.file);
      if (item.deleted) {
        if (!item.existed) continue;
        await fs.unlink(target).catch((err: unknown) => { if (!missing(err)) throw err; });
        await syncDir(path.dirname(target));
      } else {
        // Recovery only needs the independent .before copies. Consume the
        // prepared replacement rather than copying large payloads a second time.
        await replaceFrom(path.join(pending, `${i}.after`), target, true);
      }
    }
    await syncDir(pending);
    await writeSynced(path.join(pending, 'committed'), '1');
    await syncDir(pending);
  } catch (err) {
    if (installed) {
      try {
        await restore(ctx.dir, pending, files);
        await fs.rm(pending, { recursive: true });
        await syncDir(runtimeDir);
      } catch (rollbackErr) {
        blocked.add(ctx.dir);
        log.error(`Campaign quarantined after rollback failure: ${ctx.dir}: ${String(rollbackErr)}`);
        throw new AggregateError([err, rollbackErr], 'campaign commit and rollback failed');
      }
    }
    throw err;
  } finally {
    await fs.rm(prepared, { recursive: true, force: true }).catch((err: unknown) => {
      log.warn(`Campaign preparation cleanup deferred: ${prepared}: ${String(err)}`);
    });
  }
  // The marker is the commit point. Cleanup failure must not report a failed mutation.
  await retainBackup(runtimeDir, pending).catch((err: unknown) => {
    log.warn(`Campaign commit cleanup deferred: ${ctx.dir}: ${String(err)}`);
  });
}

function enqueue<T>(dir: string, action: () => Promise<T>): Promise<T> {
  if (stopping) return Promise.reject(new Error('server is shutting down'));
  const start = performance.now();
  changeQueueDepth(1);
  const result = (queues.get(dir) ?? Promise.resolve()).then(async () => {
    duration('queueWaitMs', performance.now() - start);
    if (blocked.has(dir)) throw new Error('campaign requires persistence recovery');
    return action();
  }).finally(() => changeQueueDepth(-1));
  const tail = result.then(() => {}, (err: unknown) => {
    log.error(`Campaign mutation failed (${Math.round(performance.now() - start)}ms): ${dir}: ${String(err)}`);
  });
  queues.set(dir, tail);
  void tail.then(() => { if (queues.get(dir) === tail) queues.delete(dir); });
  return result;
}

/** File helpers reuse the active command; standalone callers get the same ordered transaction. */
export function withCampaignFiles<T>(dir: string, action: () => Promise<T>): Promise<T> {
  const active = context.getStore();
  if (active) {
    if (active.dir !== dir) throw new Error('cross-campaign write in a commit');
    return action();
  }
  return enqueue(dir, async () => {
    const ctx: CommitContext = { dir, files: new Map(), values: new Map(), publish: [] };
    const result = await context.run(ctx, action);
    await commitFiles(ctx);
    for (const publish of ctx.publish) publish();
    return result;
  });
}

/** sourcePath must remain immutable; unlink only after the enclosing commit settles. */
export async function writeCampaignFile(dir: string, file: string, content: FileContent): Promise<void> {
  await withCampaignFiles(dir, async () => {
    context.getStore()!.files.set(campaignPath(dir, path.relative(dir, file)), content);
  });
}

export function updateCampaignMemory(update: () => void): void {
  const ctx = context.getStore();
  if (ctx && !ctx.draft) ctx.publish.push(update);
  else update();
}

/** Share a candidate value across repeated store mutations within one transaction. */
export function commitValue<T>(key: object, initial: T): T {
  const ctx = context.getStore();
  if (!ctx) return initial;
  if (!ctx.values.has(key)) ctx.values.set(key, initial);
  return ctx.values.get(key) as T;
}

/** Buffer already-serialized socket payloads until durable commit. */
export function afterCampaignCommit(publish: () => void): void {
  const ctx = context.getStore();
  if (ctx) ctx.publish.push(publish);
  else publish();
}

export function campaignView(entry: CampaignEntry): CampaignEntry {
  const ctx = context.getStore();
  return ctx?.original === entry ? ctx.draft! : entry;
}

export function mutateCampaign<T>(entry: CampaignEntry, action: (draft: CampaignEntry) => Promise<T>): Promise<T> {
  return enqueue(entry.store.dir, async () => {
    // Saved maps are immutable: save/delete replace the array, load copies its
    // contents. Keep this archive out of the hot command clone as well as JSON.
    const runtime: CampaignEntry['runtime'] = structuredClone({ ...entry.runtime, state: { ...entry.runtime.state, mapTemplates: [] } });
    runtime.state.mapTemplates = entry.runtime.state.mapTemplates;
    // ponytail: clone the campaign per command; copy-on-write if large campaigns make this measurable.
    const draft: CampaignEntry = {
      boardGeneration: entry.boardGeneration ?? 0,
      store: structuredClone(entry.store),
      runtime,
      room: entry.room,
      media: structuredClone(entry.media),
    };
    const ctx: CommitContext = { dir: entry.store.dir, original: entry, draft, files: new Map(), values: new Map(), publish: [] };
    const result = await context.run(ctx, () => action(draft));
    await commitFiles(ctx);
    Object.assign(entry.store, draft.store);
    Object.assign(entry.runtime, draft.runtime);
    entry.media = draft.media;
    entry.boardGeneration = draft.boardGeneration;
    // Publish outside ALS so sends cannot enqueue themselves again.
    for (const publish of ctx.publish) {
      try { publish(); } catch (err) { log.warn(`Campaign notification failed: ${String(err)}`); }
    }
    return result;
  });
}

/** Stop accepting mutations, then drain every already-accepted command. */
export async function drainCampaigns(): Promise<void> {
  stopping = true;
  await Promise.all(queues.values());
}
