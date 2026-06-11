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
  /** serializes state.json writes so concurrent saves never interleave */
  stateWriteQueue: Promise<void>;
  /** rolls appended since the last compaction (drives jsonl rewrite) */
  rollsAppendedSinceCompaction: number;
}

const MAX_ROLL_LOG = 200;
// Rewrite rolls.jsonl down to the last MAX_ROLL_LOG after this many appends,
// so the file cannot grow without bound across a long campaign.
const ROLLS_COMPACTION_THRESHOLD = 500;

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

  return {
    state,
    rollLog,
    dir: runtimeDir,
    stateWriteQueue: Promise.resolve(),
    rollsAppendedSinceCompaction: 0,
  };
}

export function persistState(runtime: CampaignRuntime): Promise<void> {
  // Serialize writes through a per-runtime queue so two near-simultaneous saves
  // never write the shared tmp file concurrently (which could corrupt it). Each
  // write snapshots the latest in-memory state at write time.
  runtime.stateWriteQueue = runtime.stateWriteQueue.then(async () => {
    const statePath = path.join(runtime.dir, 'state.json');
    const tmpPath = statePath + '.tmp';
    await fs.writeFile(tmpPath, JSON.stringify(runtime.state, null, 2), 'utf8');
    await fs.rename(tmpPath, statePath);
  }).catch((err: unknown) => {
    log.error(`Failed to persist state for ${runtime.dir}: ${String(err)}`);
  });
  return runtime.stateWriteQueue;
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

  // Periodically compact the append-only log down to the last MAX_ROLL_LOG
  // entries so the file cannot grow without bound.
  runtime.rollsAppendedSinceCompaction += 1;
  if (runtime.rollsAppendedSinceCompaction >= ROLLS_COMPACTION_THRESHOLD) {
    runtime.rollsAppendedSinceCompaction = 0;
    const tmpPath = rollsPath + '.tmp';
    const content = runtime.rollLog.map((e) => JSON.stringify(e)).join('\n') + '\n';
    await fs.writeFile(tmpPath, content, 'utf8');
    await fs.rename(tmpPath, rollsPath);
    return;
  }

  await fs.appendFile(rollsPath, JSON.stringify(entry) + '\n', 'utf8');
}
