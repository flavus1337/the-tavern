import fs from 'node:fs/promises';
import path from 'node:path';
import { log } from '../log.js';
import type { RollLogEntry } from '@vtt/shared';

export interface RuntimeState {
  currentImageAssetId: string | null;
}

export interface CampaignRuntime {
  state: RuntimeState;
  rollLog: RollLogEntry[];
  dir: string; // .runtime/ dir
}

const MAX_ROLL_LOG = 200;

export async function loadRuntime(campaignDir: string): Promise<CampaignRuntime> {
  const runtimeDir = path.join(campaignDir, '.runtime');
  await fs.mkdir(runtimeDir, { recursive: true });

  // Load state.json.
  let state: RuntimeState = { currentImageAssetId: null };
  const statePath = path.join(runtimeDir, 'state.json');
  try {
    const raw = await fs.readFile(statePath, 'utf8');
    const parsed = JSON.parse(raw) as RuntimeState;
    state = { currentImageAssetId: parsed.currentImageAssetId ?? null };
  } catch {
    // Missing is fine.
  }

  // Load last 200 lines from rolls.jsonl.
  const rollsPath = path.join(runtimeDir, 'rolls.jsonl');
  const rollLog: RollLogEntry[] = [];
  try {
    const raw = await fs.readFile(rollsPath, 'utf8');
    const lines = raw.split('\n').filter((l) => l.trim().length > 0);
    const last200 = lines.slice(-MAX_ROLL_LOG);
    for (const line of last200) {
      try {
        const entry = JSON.parse(line) as RollLogEntry;
        rollLog.push(entry);
      } catch {
        log.warn(`Skipping malformed roll log line`);
      }
    }
  } catch {
    // Missing is fine.
  }

  return { state, rollLog, dir: runtimeDir };
}

export async function persistState(runtime: CampaignRuntime): Promise<void> {
  const statePath = path.join(runtime.dir, 'state.json');
  const tmpPath = statePath + '.tmp';
  await fs.writeFile(tmpPath, JSON.stringify(runtime.state, null, 2), 'utf8');
  await fs.rename(tmpPath, statePath);
}

export async function appendRollLog(
  runtime: CampaignRuntime,
  entry: RollLogEntry,
): Promise<void> {
  runtime.rollLog.push(entry);
  if (runtime.rollLog.length > MAX_ROLL_LOG) {
    runtime.rollLog.splice(0, runtime.rollLog.length - MAX_ROLL_LOG);
  }

  const rollsPath = path.join(runtime.dir, 'rolls.jsonl');
  await fs.appendFile(rollsPath, JSON.stringify(entry) + '\n', 'utf8');
}
