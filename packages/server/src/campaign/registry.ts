import fs from 'node:fs/promises';
import path from 'node:path';
import { config } from '../config.js';
import { loadCampaign } from './loader.js';
import { loadRuntime } from './runtime.js';
import { log } from '../log.js';
import type { CampaignStore } from './loader.js';
import type { CampaignRuntime } from './runtime.js';

export interface CampaignEntry {
  store: CampaignStore;
  runtime: CampaignRuntime;
  /** WS room: set of session IDs (managed by hub). */
  room: Set<string>;
  /** transient table-playback state (not persisted) — feeds late-join snapshots */
  media?: { assetId: string; action: 'play' | 'pause'; time: number; atMs: number } | null;
}

const registry = new Map<string, CampaignEntry>();

export async function scanCampaigns(): Promise<void> {
  try {
    await fs.mkdir(config.CAMPAIGNS_DIR, { recursive: true });
    const entries = await fs.readdir(config.CAMPAIGNS_DIR);

    for (const entry of entries) {
      const campaignDir = path.join(config.CAMPAIGNS_DIR, entry);
      try {
        const stat = await fs.stat(campaignDir);
        if (!stat.isDirectory()) continue;

        const store = await loadCampaign(campaignDir);
        if (!store) continue;

        const runtime = await loadRuntime(campaignDir);
        registry.set(entry, { store, runtime, room: new Set() });
        log.info(`Loaded campaign: ${store.meta.name} (${entry})`);
      } catch (err) {
        log.warn(`Failed to load campaign ${entry}: ${String(err)}`);
      }
    }
  } catch (err) {
    log.warn(`Could not scan campaigns dir: ${String(err)}`);
  }
}

export function getCampaign(id: string): CampaignEntry | undefined {
  return registry.get(id);
}

export function addCampaign(
  id: string,
  store: CampaignStore,
  runtime: CampaignRuntime,
): void {
  registry.set(id, { store, runtime, room: new Set() });
}

export function getAllCampaigns(): Map<string, CampaignEntry> {
  return registry;
}
