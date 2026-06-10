import fs from 'node:fs/promises';
import path from 'node:path';
import { slugify, SCHEMA_VERSIONS } from '@vtt/shared';
import type { CampaignMeta } from '@vtt/shared';
import { config } from '../config.js';
import { getCampaign, addCampaign } from './registry.js';
import { loadCampaign } from './loader.js';
import { loadRuntime } from './runtime.js';

export async function createCampaign(
  name: string,
  description: string,
): Promise<CampaignMeta> {
  const id = slugify(name);

  if (getCampaign(id)) {
    throw Object.assign(new Error('Campaign id already exists'), { code: 'CONFLICT' });
  }

  const campaignDir = path.join(config.CAMPAIGNS_DIR, id);

  // Check if directory already exists on disk.
  try {
    await fs.access(campaignDir);
    throw Object.assign(new Error('Campaign directory already exists'), { code: 'CONFLICT' });
  } catch (err: unknown) {
    if ((err as NodeJS.ErrnoException).code !== 'ENOENT') throw err;
  }

  const meta: CampaignMeta = {
    type: 'campaign',
    schemaVersion: SCHEMA_VERSIONS.campaign,
    id,
    name,
    description,
    coverAssetId: null,
  };

  // Create skeleton.
  await fs.mkdir(campaignDir, { recursive: true });
  for (const sub of ['chapters', 'characters', 'notes', 'assets', '.runtime']) {
    await fs.mkdir(path.join(campaignDir, sub), { recursive: true });
  }

  await fs.writeFile(
    path.join(campaignDir, 'campaign.json'),
    JSON.stringify(meta, null, 2),
    'utf8',
  );

  // Load and register.
  const store = await loadCampaign(campaignDir);
  if (!store) throw new Error('Failed to load newly created campaign');
  const runtime = await loadRuntime(campaignDir);

  addCampaign(id, store, runtime);
  return meta;
}
