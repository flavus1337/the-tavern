import { CONDITIONS, isDurableMessage } from './protocol.js';
import type { ClientMessage } from './protocol.js';
import { NOTE_KINDS } from './campaign.js';

export type Validator = (value: unknown) => boolean;
export const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);
export const text = (max: number, min = 0): Validator => (value) => typeof value === 'string' && value.length <= max && value.trim().length >= min;
export const finite = (min = -10_000_000, max = 10_000_000): Validator => (value) => typeof value === 'number' && Number.isFinite(value) && value >= min && value <= max;
export const integer = (min = 0, max = Number.MAX_SAFE_INTEGER): Validator => (value) => Number.isSafeInteger(value) && (value as number) >= min && (value as number) <= max;
export const oneOf = (values: readonly unknown[]): Validator => (value) => values.includes(value);
export const nullable = (check: Validator): Validator => (value) => value === null || check(value);
export const list = (check: Validator, max = 1000): Validator => (value) => Array.isArray(value) && value.length <= max && value.every(check);
export const isSafeId = (value: unknown): value is string => typeof value === 'string' && /^[a-zA-Z0-9][a-zA-Z0-9_-]{0,127}$/.test(value);
const bool: Validator = (value) => typeof value === 'boolean';

export function object(required: Record<string, Validator>, optional: Record<string, Validator> = {}): Validator {
  return (value) => isRecord(value)
    && Object.entries(required).every(([key, check]) => check(value[key]))
    && Object.entries(value).every(([key, field]) => {
      const check = Object.hasOwn(required, key) ? required[key] : Object.hasOwn(optional, key) ? optional[key] : undefined;
      return !!check && (field === undefined && !(key in required) || check(field));
    });
}

const sharing = object({ scope: oneOf(['private', 'dm', 'users', 'all']), userIds: list(isSafeId, 1000) });
const statBlock = object({
  ac: nullable(finite()), speed: text(60), str: nullable(finite()), dex: nullable(finite()),
  con: nullable(finite()), int: nullable(finite()), wis: nullable(finite()), cha: nullable(finite()), notes: text(4000),
});
const noteFields = { title: text(200), body: text(500_000), sharing, tags: list(text(128), 1000), noteKind: oneOf(NOTE_KINDS) };
const chapterFields = { title: text(200), summary: text(4000), body: text(500_000) };
const tokenFields = {
  name: text(200), shape: oneOf(['round', 'square']), allegiance: oneOf(['ally', 'enemy', 'neutral']),
  ownerUserId: nullable(isSafeId), size: oneOf(['S', 'M', 'L', 'H']), fill: nullable(text(80)), hp: nullable(finite()),
  maxHp: nullable(finite(0)), dmOnly: bool, sharing, conditions: list(oneOf(CONDITIONS), CONDITIONS.length), statBlock: nullable(statBlock),
};
const grid = object({}, { cell: finite(), offsetX: finite(), offsetY: finite(), visible: bool, snap: bool, color: text(80), unit: oneOf(['ft', 'm']) });
const initiativeEntry = object({ id: isSafeId, tokenId: nullable(isSafeId), name: text(200), initiative: finite(), ownerUserId: nullable(isSafeId) });
const initiative = object({ active: bool, round: integer(0, 1_000_000), turnIndex: integer(0, 100), entries: list(initiativeEntry, 100) });
const point = { x: finite(), y: finite() };
const area = { x1: finite(), y1: finite(), x2: finite(), y2: finite() };
const areaKind = oneOf(['circle', 'cone', 'line', 'square']);
const message = (required: Record<string, Validator>, optional: Record<string, Validator> = {}): Validator => object({ type: text(40, 1), ...required }, { requestId: isSafeId, ...optional });

const schemas = {
  undo: message({ receiptId: isSafeId }),
  join: message({ campaignId: isSafeId, protocolVersion: integer(1, 1000) }),
  ping: message({ sentAt: finite(0, Number.MAX_SAFE_INTEGER) }),
  measure: (value: unknown) => isRecord(value) && (value['kind'] === 'clear'
    ? message({ kind: oneOf(['clear']) })(value)
    : message({ kind: oneOf(['ruler', 'circle', 'cone', 'line', 'square']), ...area })(value)),
  roll: message({ expression: text(500, 1), visibility: oneOf(['public', 'dm']) }, { label: text(200) }),
  boardAdd: message({ assetId: isSafeId, ...point }, { w: finite() }),
  boardMove: message({ itemId: isSafeId, ...point, w: finite() }),
  boardRemove: message({ itemId: isSafeId }),
  boardSetAccess: message({ itemId: isSafeId, playersCanMove: bool }),
  setUploadsLocked: message({ locked: bool }),
  setMapLocked: message({ locked: bool }),
  setDocumentSharing: message({ assetId: isSafeId, sharing }),
  saveNote: message({}, { ...noteFields, noteId: isSafeId, baseRevision: integer(), expected: object({}, noteFields) }),
  deleteNote: message({ noteId: isSafeId }),
  saveChapter: message({}, { ...chapterFields, chapterId: isSafeId, baseRevision: integer(), expected: object({}, chapterFields) }),
  deleteChapter: message({ chapterId: isSafeId }),
  reorderChapters: message({ orderedIds: list(isSafeId) }),
  setEntityChapters: message({ entityId: isSafeId, entityType: oneOf(['note', 'character', 'asset']), chapterIds: list(isSafeId) }),
  mediaControl: message({ assetId: isSafeId, action: oneOf(['play', 'pause', 'stop']), time: finite(0, 31_536_000) }),
  tokenAdd: message({ name: text(200, 1), shape: tokenFields.shape, allegiance: tokenFields.allegiance, size: tokenFields.size, ownerUserId: nullable(isSafeId), ...point }, { ...tokenFields, assetId: nullable(isSafeId) }),
  tokenMove: message({ tokenId: isSafeId, ...point }),
  tokenUpdate: message({ tokenId: isSafeId, baseRevision: integer() }, { ...tokenFields, expected: object({}, tokenFields) }),
  tokenRemove: message({ tokenId: isSafeId }),
  setGrid: message({ grid }),
  setInitiative: message({ initiative }),
  pieceAdd: message({ ...point, w: finite(), h: finite(), layer: oneOf(['terrain', 'props']), lockedToGrid: bool }, { builtin: nullable(text(80, 1)), assetId: nullable(isSafeId), rotation: finite() }),
  pieceMove: message({ id: isSafeId, ...point }),
  pieceUpdate: message({ id: isSafeId }, { x: finite(), y: finite(), w: finite(), h: finite(), rotation: finite(), layer: oneOf(['terrain', 'props']), z: finite() }),
  pieceRemove: message({ id: isSafeId }),
  aoeAdd: message({ kind: areaKind, ...area }),
  aoeRemove: message({ id: isSafeId }),
  aoeClear: message({}),
  setMapMeta: message({}, { name: text(200), areaTag: text(200) }),
  saveMapTemplate: message({ name: text(80, 1) }),
  loadMapTemplate: message({ id: isSafeId }),
  deleteMapTemplate: message({ id: isSafeId }),
} satisfies Record<ClientMessage['type'], Validator>;

export function parseClientMessage(raw: unknown): { ok: true; message: ClientMessage } | { ok: false; reason: string } {
  if (!isRecord(raw) || typeof raw['type'] !== 'string' || !Object.hasOwn(schemas, raw['type'])) return { ok: false, reason: 'Unknown or malformed command' };
  const type = raw['type'] as ClientMessage['type'];
  if (!schemas[type](raw)) return { ok: false, reason: `Invalid fields for ${type}` };
  if (isDurableMessage({ type }) && !isSafeId(raw['requestId'])) return { ok: false, reason: 'A valid requestId is required' };
  if (type === 'saveNote' || type === 'saveChapter') {
    const id = raw[type === 'saveNote' ? 'noteId' : 'chapterId'];
    if (id === undefined) {
      if (!text(200, 1)(raw['title']) || raw['baseRevision'] !== undefined || raw['expected'] !== undefined) return { ok: false, reason: 'New entities need a title and no edit revision' };
      if (type === 'saveNote' && (!text(500_000)(raw['body']) || !sharing(raw['sharing']))) return { ok: false, reason: 'New notes need body and sharing' };
    } else if (!integer()(raw['baseRevision'])) return { ok: false, reason: 'An edit needs baseRevision' };
  }
  if ((type === 'saveNote' || type === 'saveChapter') && raw['title'] !== undefined && !text(200, 1)(raw['title'])) return { ok: false, reason: 'Title cannot be blank' };
  if (type === 'tokenUpdate' && raw['name'] !== undefined && !text(200, 1)(raw['name'])) return { ok: false, reason: 'Name cannot be blank' };
  if (isRecord(raw['expected']) && Object.keys(raw['expected']).some((key) => raw[key] === undefined)) return { ok: false, reason: 'Expected values must describe changed fields only' };
  return { ok: true, message: raw as ClientMessage };
}
