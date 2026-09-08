import fs from 'node:fs/promises';
import path from 'node:path';
import { slugify, SCHEMA_VERSIONS } from '@vtt/shared';
import type { CampaignMeta } from '@vtt/shared';
import { config } from '../config.js';
import { getCampaign, addCampaign } from './registry.js';
import { loadCampaign } from './loader.js';
import { loadRuntime } from './runtime.js';
import { writeCampaignFile } from './commit.js';

export async function createCampaign(
  name: string,
  description: string,
  grantMembership?: (id: string) => Promise<void>,
): Promise<CampaignMeta> {
  const id = slugify(name);

  if (getCampaign(id)) {
    throw Object.assign(new Error('Campaign id already exists'), { code: 'CONFLICT' });
  }

  const campaignDir = path.join(config.CAMPAIGNS_DIR, id);

  // mkdir without recursive is the exclusive slug reservation across concurrent requests.
  await fs.mkdir(config.CAMPAIGNS_DIR, { recursive: true });
  try { await fs.mkdir(campaignDir); }
  catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'EEXIST') throw Object.assign(new Error('Campaign directory already exists'), { code: 'CONFLICT' });
    throw err;
  }

  const meta: CampaignMeta = {
    type: 'campaign',
    schemaVersion: SCHEMA_VERSIONS.campaign,
    id,
    name,
    description,
    coverAssetId: null,
  };

  try {
    for (const sub of ['chapters', 'characters', 'notes', 'assets', '.runtime']) {
      await fs.mkdir(path.join(campaignDir, sub));
    }
    await writeCampaignFile(campaignDir, path.join(campaignDir, 'campaign.json'), JSON.stringify(meta, null, 2));
    const store = await loadCampaign(campaignDir);
    if (!store) throw new Error('Failed to load newly created campaign');
    const runtime = await loadRuntime(campaignDir);
    await grantMembership?.(id);
    addCampaign(id, store, runtime);
    return meta;
  } catch (err) {
    // Only this request owns this new directory; ordinary membership failure must
    // not leave an unusable campaign consuming its slug.
    try { await fs.rm(campaignDir, { recursive: true }); }
    catch (cleanupErr) { throw new AggregateError([err, cleanupErr], 'campaign creation and cleanup failed'); }
    throw err;
  }
}
