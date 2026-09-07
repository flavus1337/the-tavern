import fs from 'node:fs/promises';
import path from 'node:path';
import { log } from '../log.js';
import { recoverCampaign, withCampaignFiles, writeCampaignFile, updateCampaignMemory } from './commit.js';
import { randomId, parseSharing } from '@vtt/shared';
import type { RollLogEntry, GridState, Sharing, MapPiece, MapMeta, AoeTemplate, TokenStatBlock, InitiativeState } from '@vtt/shared';

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

export interface Token {
  revision?: number;
  id: string;
  name: string;
  shape: 'round' | 'square';
  allegiance: 'ally' | 'enemy' | 'neutral';
  ownerUserId: string | null;
  size: 'S' | 'M' | 'L' | 'H';
  x: number;
  y: number;
  z: number;
  /** asset id of the face image — resolved to imageUrl in snapshot */
  assetId: string | null;
  fill: string | null;
  hp: number | null;
  maxHp: number | null;
  dmOnly: boolean;
  /** Who, besides owner + DM, may control this token. */
  sharing: Sharing;
  /** active conditions (visible to everyone) */
  conditions: string[];
  /** combat stat block — redacted per viewer in the snapshot/broadcast */
  statBlock: TokenStatBlock | null;
}

export const DEFAULT_GRID: GridState = {
  cell: 44,
  offsetX: 0,
  offsetY: 0,
  visible: true,
  snap: true,
  color: '#ffffff33',
  unit: 'm',
};

export const DEFAULT_MAP_META: MapMeta = { name: 'Untitled map', areaTag: '' };

/** A saved, reloadable map (background + pieces + grid + meta) for this campaign. */
export interface MapTemplate {
  id: string;
  name: string;
  createdAt: string;
  board: BoardItem[];
  pieces: MapPiece[];
  grid: GridState;
  mapMeta: MapMeta;
}

export interface RuntimeState {
  board: BoardItem[];
  uploadsLocked: boolean;
  /** when true the background/board is locked from moving — even for the DM */
  mapLocked: boolean;
  /** documents explicitly shared with the table — visible/fetchable by all members */
  sharedDocumentIds: string[];
  tokens: Token[];
  grid: GridState;
  /** placed map pieces (terrain/props) authored in build mode */
  pieces: MapPiece[];
  /** placed AoE templates (spell/effect areas) — persist through the session */
  aoes: AoeTemplate[];
  /** initiative tracker — DM-controlled, order visible to everyone */
  initiative: InitiativeState;
  mapMeta: MapMeta;
  /** saved reusable maps */
  mapTemplates: MapTemplate[];
}

export const EMPTY_INITIATIVE: InitiativeState = { active: false, round: 0, turnIndex: 0, entries: [] };

export interface CampaignRuntime {
  state: RuntimeState;
  rollLog: RollLogEntry[];
  dir: string; // .runtime/ dir
}

const MAX_ROLL_LOG = 200;

export async function loadRuntime(campaignDir: string): Promise<CampaignRuntime> {
  await recoverCampaign(campaignDir);
  const runtimeDir = path.join(campaignDir, '.runtime');
  await fs.mkdir(runtimeDir, { recursive: true });

  // Load state.json.
  let state: RuntimeState = {
    board: [],
    uploadsLocked: false,
    mapLocked: false,
    sharedDocumentIds: [],
    tokens: [],
    grid: { ...DEFAULT_GRID },
    pieces: [],
    aoes: [],
    initiative: { ...EMPTY_INITIATIVE, entries: [] },
    mapMeta: { ...DEFAULT_MAP_META },
    mapTemplates: [],
  };
  const statePath = path.join(runtimeDir, 'state.json');
  try {
    const raw = await fs.readFile(statePath, 'utf8');
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const parsed = JSON.parse(raw) as Record<string, any>;
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('invalid runtime state object');
    for (const key of ['board', 'tokens', 'pieces', 'aoes', 'mapTemplates', 'sharedDocumentIds']) {
      if (key in parsed && !Array.isArray(parsed[key])) throw new Error(`invalid runtime ${key}`);
    }
    for (const key of ['grid', 'initiative', 'mapMeta']) {
      if (key in parsed && (!parsed[key] || typeof parsed[key] !== 'object' || Array.isArray(parsed[key]))) throw new Error(`invalid runtime ${key}`);
    }
    for (const key of ['uploadsLocked', 'mapLocked']) {
      if (key in parsed && typeof parsed[key] !== 'boolean') throw new Error(`invalid runtime ${key}`);
    }

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

    if (Array.isArray(parsed['tokens']) && parsed['tokens'].some((token: Token) => token.revision !== undefined && (!Number.isSafeInteger(token.revision) || token.revision < 0))) throw new Error('invalid token revision');

    // Lenient migration: tokens and grid may be absent in old state.json files;
    // pre-v5 tokens have no `sharing` field → default to private control.
    const tokens: Token[] = Array.isArray(parsed['tokens'])
      ? (parsed['tokens'] as Token[]).map((t) => ({
          ...t,
          revision: t.revision ?? 0,
          sharing: parseSharing((t as { sharing?: unknown }).sharing),
          conditions: Array.isArray((t as { conditions?: unknown }).conditions)
            ? ((t as { conditions: unknown[] }).conditions.filter((c) => typeof c === 'string') as string[])
            : [],
          statBlock: (t as { statBlock?: TokenStatBlock | null }).statBlock ?? null,
        }))
      : [];

    const grid: GridState =
      parsed['grid'] != null && typeof parsed['grid'] === 'object'
        ? { ...DEFAULT_GRID, ...(parsed['grid'] as Partial<GridState>) }
        : { ...DEFAULT_GRID };

    // Lenient migration: pieces/mapMeta absent in pre-v6 state.json files.
    const pieces: MapPiece[] = Array.isArray(parsed['pieces'])
      ? (parsed['pieces'] as MapPiece[])
      : [];
    const aoes: AoeTemplate[] = Array.isArray(parsed['aoes'])
      ? (parsed['aoes'] as AoeTemplate[])
      : [];
    const initiative: InitiativeState =
      parsed['initiative'] != null && typeof parsed['initiative'] === 'object'
        ? { ...EMPTY_INITIATIVE, ...(parsed['initiative'] as Partial<InitiativeState>),
            entries: Array.isArray((parsed['initiative'] as InitiativeState).entries) ? (parsed['initiative'] as InitiativeState).entries : [] }
        : { ...EMPTY_INITIATIVE, entries: [] };
    const mapMeta: MapMeta =
      parsed['mapMeta'] != null && typeof parsed['mapMeta'] === 'object'
        ? { ...DEFAULT_MAP_META, ...(parsed['mapMeta'] as Partial<MapMeta>) }
        : { ...DEFAULT_MAP_META };

    state = {
      board,
      uploadsLocked: typeof parsed['uploadsLocked'] === 'boolean' ? parsed['uploadsLocked'] : false,
      mapLocked: typeof parsed['mapLocked'] === 'boolean' ? parsed['mapLocked'] : false,
      sharedDocumentIds: Array.isArray(parsed['sharedDocumentIds'])
        ? (parsed['sharedDocumentIds'] as string[])
        : [],
      tokens,
      grid,
      pieces,
      aoes,
      initiative,
      mapMeta,
      mapTemplates: Array.isArray(parsed['mapTemplates']) ? (parsed['mapTemplates'] as MapTemplate[]) : [],
    };
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== 'ENOENT') throw new Error(`could not load runtime state: ${statePath}`, { cause: err });
  }

  // Load last 200 lines from rolls.jsonl.
  const rollsPath = path.join(runtimeDir, 'rolls.jsonl');
  const rollLog: RollLogEntry[] = [];
  try {
    const raw = await fs.readFile(rollsPath, 'utf8');
    const lines = raw.split('\n').filter((l) => l.trim().length > 0);
    const last200 = lines.slice(-MAX_ROLL_LOG);
    for (const line of last200) {
      const entry = JSON.parse(line) as RollLogEntry;
      if (!entry || typeof entry !== 'object' || typeof entry.id !== 'string') throw new Error('invalid roll log entry');
      rollLog.push(entry);
    }
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== 'ENOENT') throw new Error(`could not load roll log: ${rollsPath}`, { cause: err });
  }

  return {
    state,
    rollLog,
    dir: runtimeDir,
  };
}

export function persistState(runtime: CampaignRuntime): Promise<void> {
  return writeCampaignFile(path.dirname(runtime.dir), path.join(runtime.dir, 'state.json'), JSON.stringify(runtime.state, null, 2));
}

export async function appendRollLog(runtime: CampaignRuntime, entry: RollLogEntry): Promise<void> {
  await withCampaignFiles(path.dirname(runtime.dir), async () => {
    // The log is already bounded to 200 entries. Replacing it atomically avoids a
    // separate append/compaction race and makes rolls recoverable with other files.
    const rollLog = [...runtime.rollLog, entry].slice(-MAX_ROLL_LOG);
    await writeCampaignFile(path.dirname(runtime.dir), path.join(runtime.dir, 'rolls.jsonl'), rollLog.map((e) => JSON.stringify(e)).join('\n') + '\n');
    updateCampaignMemory(() => {
      runtime.rollLog = rollLog;
    });
  });
}
