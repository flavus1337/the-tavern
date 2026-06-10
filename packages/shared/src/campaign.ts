// Campaign entity schema — the LLM-targetable contract for all persistent entities.

export const SCHEMA_VERSIONS = {
  campaign: 1,
  chapter: 1,
  character: 1,
  note: 1,
  asset: 1,
} as const;

export type EntityType = keyof typeof SCHEMA_VERSIONS;

// ---------------------------------------------------------------------------
// Sub-types
// ---------------------------------------------------------------------------

export interface Scene {
  id: string;
  title: string;
  body?: string;
  assetIds: string[];
  characterIds: string[];
}

export interface StatBlock {
  size?: string;
  creatureType?: string;
  alignment?: string;
  ac: number;
  hp: { average: number; formula?: string };
  speed?: string;
  abilities: { str: number; dex: number; con: number; int: number; wis: number; cha: number };
  skills?: Record<string, number>;
  senses?: string;
  languages?: string[];
  cr?: string;
  traits?: Array<{ name: string; text: string }>;
  actions?: Array<{ name: string; text: string }>;
}

export interface CharacterSheet {
  class?: string;
  level?: number;
  race?: string;
  abilities?: { str: number; dex: number; con: number; int: number; wis: number; cha: number };
  maxHp?: number;
  ac?: number;
  speed?: string;
  proficiencies?: string[];
  inventory?: string[];
  spells?: string[];
  background?: string;
  /** Uploaded PDF character sheet asset id. */
  sheetAssetId?: string | null;
}

// ---------------------------------------------------------------------------
// Entity interfaces
// ---------------------------------------------------------------------------

export interface CampaignMeta {
  type: 'campaign';
  schemaVersion: number;
  id: string;
  name: string;
  description: string;
  coverAssetId?: string | null;
}

export interface Chapter {
  type: 'chapter';
  schemaVersion: number;
  id: string;
  title: string;
  order: number;
  summary?: string;
  /** Filled from same-basename .md sidecar by the server loader; sidecar wins over inline. */
  body?: string;
  scenes: Scene[];
}

export interface Character {
  type: 'character';
  schemaVersion: number;
  id: string;
  name: string;
  kind: 'npc' | 'pc';
  tags: string[];
  portraitAssetId?: string | null;
  /** PC → links to an account username; lenient. */
  ownerUsername?: string | null;
  statBlock?: StatBlock;
  sheet?: CharacterSheet;
  /** Markdown sidecar content. */
  body?: string;
}

export interface NoteEntity {
  type: 'note';
  schemaVersion: number;
  id: string;
  title: string;
  body: string;
  visibility: 'dm' | 'player';
  ownerUsername: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface AssetManifest {
  type: 'asset';
  schemaVersion: number;
  id: string;
  /** Basename of the binary file in assets/. */
  file: string;
  title: string;
  /**
   * Field named `assetKind` (not `kind`) to avoid clashing with union-discriminator naming.
   * JSON field is `assetKind`.
   */
  assetKind: 'map' | 'art' | 'handout' | 'token' | 'document';
  tags: string[];
  dmOnly: boolean;
  /** null for documents */
  width: number | null;
  /** null for documents */
  height: number | null;
  mime: string;
  /** Who uploaded; null for authored content. */
  ownerUsername?: string | null;
}

export type CampaignEntity = CampaignMeta | Chapter | Character | NoteEntity | AssetManifest;

// ---------------------------------------------------------------------------
// Type guards
// ---------------------------------------------------------------------------

export function isCampaignMeta(e: CampaignEntity): e is CampaignMeta {
  return e.type === 'campaign';
}

export function isChapter(e: CampaignEntity): e is Chapter {
  return e.type === 'chapter';
}

export function isCharacter(e: CampaignEntity): e is Character {
  return e.type === 'character';
}

export function isNoteEntity(e: CampaignEntity): e is NoteEntity {
  return e.type === 'note';
}

export function isAssetManifest(e: CampaignEntity): e is AssetManifest {
  return e.type === 'asset';
}

// ---------------------------------------------------------------------------
// Lenient parsing helper (pure — no fs)
// ---------------------------------------------------------------------------

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function isNonEmptyString(v: unknown): v is string {
  return typeof v === 'string' && v.trim().length > 0;
}

function applyDefaults(expectedType: EntityType, raw: Record<string, unknown>): CampaignEntity {
  // Spread first to preserve unknown extra fields.
  const base = { ...raw };

  switch (expectedType) {
    case 'campaign': {
      return {
        ...base,
        type: 'campaign',
        schemaVersion: raw['schemaVersion'] as number,
        id: raw['id'] as string,
        name: typeof raw['name'] === 'string' ? raw['name'] : '',
        description: typeof raw['description'] === 'string' ? raw['description'] : '',
        coverAssetId:
          raw['coverAssetId'] !== undefined ? (raw['coverAssetId'] as string | null) : null,
      } as CampaignMeta;
    }

    case 'chapter': {
      return {
        ...base,
        type: 'chapter',
        schemaVersion: raw['schemaVersion'] as number,
        id: raw['id'] as string,
        title: typeof raw['title'] === 'string' ? raw['title'] : '',
        order: typeof raw['order'] === 'number' ? raw['order'] : 0,
        scenes: Array.isArray(raw['scenes']) ? (raw['scenes'] as Scene[]) : [],
      } as Chapter;
    }

    case 'character': {
      return {
        ...base,
        type: 'character',
        schemaVersion: raw['schemaVersion'] as number,
        id: raw['id'] as string,
        name: typeof raw['name'] === 'string' ? raw['name'] : '',
        kind:
          raw['kind'] === 'npc' || raw['kind'] === 'pc'
            ? (raw['kind'] as 'npc' | 'pc')
            : 'npc',
        tags: Array.isArray(raw['tags']) ? (raw['tags'] as string[]) : [],
      } as Character;
    }

    case 'note': {
      const now = new Date().toISOString();
      return {
        ...base,
        type: 'note',
        schemaVersion: raw['schemaVersion'] as number,
        id: raw['id'] as string,
        title: typeof raw['title'] === 'string' ? raw['title'] : '',
        body: typeof raw['body'] === 'string' ? raw['body'] : '',
        visibility:
          raw['visibility'] === 'dm' || raw['visibility'] === 'player'
            ? (raw['visibility'] as 'dm' | 'player')
            : 'dm',
        ownerUsername:
          typeof raw['ownerUsername'] === 'string' ? raw['ownerUsername'] : null,
        createdAt: typeof raw['createdAt'] === 'string' ? raw['createdAt'] : now,
        updatedAt: typeof raw['updatedAt'] === 'string' ? raw['updatedAt'] : now,
      } as NoteEntity;
    }

    case 'asset': {
      return {
        ...base,
        type: 'asset',
        schemaVersion: raw['schemaVersion'] as number,
        id: raw['id'] as string,
        file: typeof raw['file'] === 'string' ? raw['file'] : '',
        title: typeof raw['title'] === 'string' ? raw['title'] : '',
        assetKind: (
          ['map', 'art', 'handout', 'token', 'document'].includes(raw['assetKind'] as string)
            ? raw['assetKind']
            : 'art'
        ) as AssetManifest['assetKind'],
        tags: Array.isArray(raw['tags']) ? (raw['tags'] as string[]) : [],
        dmOnly: typeof raw['dmOnly'] === 'boolean' ? raw['dmOnly'] : false,
        width: typeof raw['width'] === 'number' ? raw['width'] : null,
        height: typeof raw['height'] === 'number' ? raw['height'] : null,
        mime: typeof raw['mime'] === 'string' ? raw['mime'] : 'application/octet-stream',
      } as AssetManifest;
    }
  }
}

export function parseEntity(
  expectedType: EntityType,
  raw: unknown,
): { ok: true; entity: CampaignEntity } | { ok: false; reason: string } {
  if (!isObject(raw)) {
    return { ok: false, reason: 'expected an object' };
  }

  if (raw['type'] !== expectedType) {
    return {
      ok: false,
      reason: `expected type "${expectedType}", got "${String(raw['type'])}"`,
    };
  }

  if (typeof raw['schemaVersion'] !== 'number') {
    return { ok: false, reason: 'schemaVersion must be a number' };
  }

  const maxVersion = SCHEMA_VERSIONS[expectedType];
  if (raw['schemaVersion'] > maxVersion) {
    return {
      ok: false,
      reason: `schemaVersion ${raw['schemaVersion']} exceeds maximum ${maxVersion} for type "${expectedType}"`,
    };
  }

  if (!isNonEmptyString(raw['id'])) {
    return { ok: false, reason: 'id must be a non-empty string' };
  }

  // Basic slug validation: only allow chars that make sense as a file slug
  // (letters, digits, hyphens, underscores). Lenient — just a non-empty string check above.

  const entity = applyDefaults(expectedType, raw);

  return { ok: true, entity };
}
