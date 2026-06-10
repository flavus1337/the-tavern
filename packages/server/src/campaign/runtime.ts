import fs from 'node:fs/promises';
import path from 'node:path';
import { log } from '../log.js';
import { randomId } from '@vtt/shared';
import type { RollLogEntry } from '@vtt/shared';

export interface BoardItem {
  id: string;
  assetId: string;
  x: number;
  y: number;
  w: number;
  z: number;
  /** players may move/resize this item (DM-granted, per item) */
  playersCanMove?: boolean;
}

export interface RuntimeState {
  board: BoardItem[];
  uploadsLocked: boolean;
  /** documents explicitly shared with the table — visible/fetchable by all members */
  sharedDocumentIds: string[];
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
  let state: RuntimeState = { board: [], uploadsLocked: false, sharedDocumentIds: [] };
  const statePath = path.join(runtimeDir, 'state.json');
  try {
    const raw = await fs.readFile(statePath, 'utf8');
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const parsed = JSON.parse(raw) as Record<string, any>;

    // Migration: legacy state.json with currentImageAssetId and no board.
    let board: BoardItem[];
    if (Array.isArray(parsed['board'])) {
      board = parsed['board'] as BoardItem[];
    } else if (typeof parsed['currentImageAssetId'] === 'string' && parsed['currentImageAssetId']) {
      // Migrate single shared image to a board item at origin.
      board = [
        {
          id: randomId('bi'),
          assetId: parsed['currentImageAssetId'] as string,
          x: 0,
          y: 0,
          w: 800,
          z: 1,
        },
      ];
      log.info(`Migrated legacy currentImageAssetId to board item`);
    } else {
      board = [];
    }

    state = {
      board,
      uploadsLocked: typeof parsed['uploadsLocked'] === 'boolean' ? parsed['uploadsLocked'] : false,
      sharedDocumentIds: Array.isArray(parsed['sharedDocumentIds'])
        ? (parsed['sharedDocumentIds'] as string[])
        : [],
    };
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
