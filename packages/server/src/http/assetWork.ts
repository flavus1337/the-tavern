import fs from 'node:fs/promises';
import path from 'node:path';
import type { Request, Response, RequestHandler } from 'express';
import { asyncRoute } from './asyncRoute.js';
import { getCampaign } from '../campaign/registry.js';
import { getRole } from '../auth/memberships.js';
import { param } from './params.js';
import { log } from '../log.js';
import { config } from '../config.js';

export interface AssetWork { dir: string; signal: AbortSignal }
const workByRequest = new WeakMap<Request, AssetWork>();
const active = new Set<{ cancel: () => void; done: Promise<void> }>();
let stopping = false;
const stagingDir = path.join(config.DATA_DIR, '.upload-staging');

/** This single-process server owns these scratch directories, including crash leftovers. */
export async function initAssetWork(): Promise<void> {
  await fs.mkdir(stagingDir, { recursive: true });
  for (const name of await fs.readdir(stagingDir)) {
    if (/^request-[a-zA-Z0-9]{6}$/.test(name)) await fs.rm(path.join(stagingDir, name), { recursive: true, force: true });
  }
}

export function uploadDirectory(req: Request): string { return workByRequest.get(req)!.dir; }

/** Flush large payload data before taking the campaign queue; the journal still
 * syncs its own copies and metadata before publication. */
export async function syncAssetFile(file: string, signal: AbortSignal): Promise<void> {
  signal.throwIfAborted();
  const handle = await fs.open(file, 'r+');
  try { await handle.sync(); } finally { await handle.close(); }
  signal.throwIfAborted();
}

export function canSaveAsset(req: Request, res: Response, entry: NonNullable<ReturnType<typeof getCampaign>>, dmOnly = false): boolean {
  const role = getRole(entry.store.meta.id, req.user!.id);
  if (!role) { res.status(404).json({ error: 'Campaign not found', code: 'NOT_FOUND' }); return false; }
  if (dmOnly && role !== 'dm') { res.status(403).json({ error: 'DM role required', code: 'FORBIDDEN' }); return false; }
  if (role !== 'dm' && entry.runtime.state.uploadsLocked) { res.status(403).json({ error: 'Uploads are locked by the DM', code: 'UPLOADS_LOCKED' }); return false; }
  if (entry.store.assets.size >= 1000) { res.status(413).json({ error: 'Campaign asset limit reached', code: 'ASSET_LIMIT' }); return false; }
  req.campaignRole = role;
  return true;
}

export function checkAssetCapacity(dmOnly = false): RequestHandler {
  return (req, res, next) => {
    const entry = getCampaign(param(req.params['id']));
    if (!entry) { res.status(404).json({ error: 'Campaign not found' }); return; }
    if (canSaveAsset(req, res, entry, dmOnly)) next();
  };
}

/** Auth/lock checks precede this wrapper; reserve before consuming any body. */
export function assetRoute(parser: RequestHandler, handler: (req: Request, res: Response, work: AssetWork) => Promise<void>): RequestHandler {
  return asyncRoute(async (req, res) => {
    if (stopping || active.size >= 2) {
      res.status(503).json({ error: 'Asset processing is busy. Try again shortly.', code: 'ASSET_BUSY' });
      return;
    }
    const controller = new AbortController();
    const abort = () => controller.abort(new Error('Asset request was cancelled'));
    const closed = () => { if (!res.writableFinished) abort(); };
    req.once('aborted', abort);
    res.once('close', closed);
    let finish!: () => void;
    const operation = { cancel: () => { abort(); req.destroy(); }, done: new Promise<void>((resolve) => { finish = resolve; }) };
    active.add(operation);
    let dir: string | undefined;
    try {
      dir = await fs.mkdtemp(path.join(stagingDir, 'request-'));
      const work = { dir, signal: controller.signal };
      workByRequest.set(req, work);
      work.signal.throwIfAborted();
      await new Promise<void>((resolve, reject) => {
        const cancelled = () => { req.destroy(); reject(work.signal.reason); };
        work.signal.addEventListener('abort', cancelled, { once: true });
        parser(req, res, (error?: unknown) => {
          work.signal.removeEventListener('abort', cancelled);
          if (error) {
            const code = (error as { code?: string }).code;
            if (!(error as { status?: number }).status) Object.assign(error, { status: code === 'LIMIT_FILE_SIZE' ? 413 : 400 });
            reject(error);
          } else resolve();
        });
      });
      work.signal.throwIfAborted();
      await handler(req, res, work);
    } catch (error) {
      if (!controller.signal.aborted) throw error;
    } finally {
      req.removeListener('aborted', abort);
      res.removeListener('close', closed);
      workByRequest.delete(req);
      if (dir) await fs.rm(dir, { recursive: true, force: true, maxRetries: 3, retryDelay: 50 }).catch((error: unknown) => {
        log.warn(`Upload staging cleanup failed: ${dir}: ${String(error)}`);
      });
      active.delete(operation);
      finish();
    }
  });
}

/** Called after accepted campaign commits drain; abort unfinished body/CPU work. */
export async function closeAssetWork(): Promise<void> {
  stopping = true;
  for (const operation of active) operation.cancel();
  await Promise.all([...active].map((operation) => operation.done));
}
