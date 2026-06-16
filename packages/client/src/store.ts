import { create } from 'zustand';
import type {
  PublicUser,
  CampaignListItem,
  PresenceEntry,
  BoardItemView,
  RollLogEntry,
  AssetManifest,
  Note,
  ServerSnapshotPayload,
  TokenView,
  GridState,
  MemberEntry,
  MapPiece,
  MapMeta,
  MapTemplateSummary,
  MeasureKind,
  AoeTemplate,
  InitiativeState,
} from '@vtt/shared';

/** A transient join-notification toast */
export interface JoinToast {
  id: string;
  entry: PresenceEntry;
}

/** A transient share notification toast */
export interface ShareToast {
  id: string;
  docTitle: string;
}

/** A ruler or AoE template, owned or shared, in board-space coords. */
export interface OwnMeasure {
  kind: MeasureKind;
  x1: number;
  y1: number;
  x2: number;
  y2: number;
}

/** Shared measurement from another user */
export interface SharedMeasure extends OwnMeasure {
  by: string;
}

/** D&D AoE template shapes selectable under the AoE tool. */
export type AoeShape = Exclude<MeasureKind, 'ruler'>;

/** Active board interaction tool (local UI — not broadcast) */
export type BoardTool = 'select' | 'move' | 'measure' | 'aoe' | 'stamp' | 'erase' | 'calibrate';

/** Build vs Play mode (DM-only, local UI). */
export type EditorMode = 'play' | 'build';

/** Map layers for visibility toggles in build mode. */
export type MapLayer = 'background' | 'terrain' | 'props';

/** A palette piece armed for stamping — a built-in inked piece or an image asset. */
export interface ActivePalettePiece {
  builtin: string | null;
  assetId: string | null;
  /** image url for asset-backed ghost preview */
  url: string | null;
  layer: 'terrain' | 'props';
  lockedToGrid: boolean;
}

/** AI generator dialog target. */
export type GenKind = 'background' | 'prop';

const ROLL_LOG_MAX = 200;

// ---------------------------------------------------------------------------
// Auth slice
// ---------------------------------------------------------------------------
interface AuthSlice {
  user: PublicUser | null;
  authChecked: boolean;
  setUser: (user: PublicUser) => void;
  setUnauthenticated: () => void;
  setAuthChecked: (checked: boolean) => void;
}

// ---------------------------------------------------------------------------
// Route slice
// ---------------------------------------------------------------------------
type Route = 'login' | 'register' | 'lobby' | 'table';

interface RouteSlice {
  route: Route;
  inviteToken: string | null;
  activeCampaignId: string | null;
  setRoute: (route: Route) => void;
  setInviteToken: (token: string | null) => void;
  setActiveCampaignId: (id: string | null) => void;
  clearInviteToken: () => void;
}

// ---------------------------------------------------------------------------
// Lobby slice
// ---------------------------------------------------------------------------
interface LobbySlice {
  campaigns: CampaignListItem[];
  setCampaigns: (campaigns: CampaignListItem[]) => void;
}

// ---------------------------------------------------------------------------
// Board view transform (kept in store so AssetPicker can read viewport center)
// ---------------------------------------------------------------------------
export interface BoardView {
  x: number;
  y: number;
  scale: number;
}

// ---------------------------------------------------------------------------
// Floating panels over the board (multiple docs/notes open simultaneously)
// ---------------------------------------------------------------------------
export type TablePanel =
  | { panelId: string; kind: 'doc'; doc: AssetManifest }
  | { panelId: string; kind: 'note'; noteId: string | null }
  | { panelId: string; kind: 'token'; tokenId: string | null };

let panelSeq = 0;
const nextPanelId = () => `panel_${++panelSeq}`;

// ---------------------------------------------------------------------------
// Table slice
// ---------------------------------------------------------------------------
type ConnectionState = 'connecting' | 'open' | 'reconnecting' | 'closed';

interface SelfInfo {
  userId: string;
  username: string;
  role: 'dm' | 'player';
}

const DEFAULT_GRID: GridState = {
  cell: 44,
  offsetX: 0,
  offsetY: 0,
  visible: true,
  snap: true,
  color: '#ffffff33',
  unit: 'm',
};

interface TableSlice {
  connection: ConnectionState;
  self: SelfInfo | null;
  campaignName: string;
  presence: PresenceEntry[];
  /** All campaign members (online or not) — for share pickers + owner dropdowns */
  members: MemberEntry[];
  board: BoardItemView[];
  uploadsLocked: boolean;
  /** when true the background is locked from moving — even for the DM */
  mapLocked: boolean;
  /** View transform shared across the whole board (pan + zoom). */
  boardView: BoardView;
  rollLog: RollLogEntry[];
  assets: AssetManifest[] | null;
  documents: AssetManifest[];
  /** open floating panels over the board (docs + notes + token editor), render order = z-order */
  openPanels: TablePanel[];
  /** latest table-playback command per audio asset (drives synced players) */
  mediaSync: Record<string, { action: 'play' | 'pause' | 'stop'; time: number; atMs: number }>;
  /** bottom audio dock — one active track at a time */
  audioDock: { assetId: string; minimized: boolean } | null;
  /** transient roll-result popups shown over the canvas */
  rollToasts: RollLogEntry[];
  /** rolls awaiting the cinematic dice overlay — fed only by live rolls, never the snapshot */
  rollQueue: RollLogEntry[];
  /** transient presence-join popups */
  joinToasts: JoinToast[];
  /** transient nat-20 board moment IDs (ring sweep) */
  boardMoments: string[];
  /** transient document-share toasts */
  shareToasts: ShareToast[];
  myNotes: Note[];
  lastErrorMessage: string | null;

  // Token & grid state
  tokens: TokenView[];
  grid: GridState;
  /** Active board tool (local UI state — not persisted or broadcast) */
  boardTool: BoardTool;
  /** Selected AoE template shape (used while the AoE tool is active) */
  aoeShape: AoeShape;
  /** This user's own ruler / AoE template (board-space coords) */
  ownMeasure: OwnMeasure | null;
  /** Whether own measurement is currently shown to the table */
  ownMeasureShared: boolean;
  /** Shared measurements from other users — keyed by username */
  sharedMeasures: Record<string, SharedMeasure>;
  /** ID of the selected token on the board (null = none) */
  selectedTokenId: string | null;

  // Map creation (build mode)
  pieces: MapPiece[];
  /** Placed AoE templates (spell/effect areas) — shared, persist through play */
  aoes: AoeTemplate[];
  /** Initiative tracker (shared turn order). */
  initiative: InitiativeState;
  mapMeta: MapMeta;
  features: { imageGenEnabled: boolean };
  editorMode: EditorMode;
  selectedPieceId: string | null;
  /** palette piece armed for stamping (build mode) */
  activePalettePiece: ActivePalettePiece | null;
  /** per-layer visibility toggles (build mode aid) */
  layerVisible: Record<MapLayer, boolean>;
  /** open AI generator dialog (null = closed) */
  genDialog: GenKind | null;
  /** saved map templates (summaries) */
  templates: MapTemplateSummary[];

  setConnection: (state: ConnectionState) => void;
  setSelf: (self: SelfInfo) => void;
  applySnapshot: (snap: ServerSnapshotPayload) => void;
  setPresence: (entries: PresenceEntry[]) => void;
  setBoard: (items: BoardItemView[]) => void;
  setUploadsLocked: (locked: boolean) => void;
  setMapLocked: (locked: boolean) => void;
  setBoardView: (view: BoardView) => void;
  addRollEntry: (entry: RollLogEntry) => void;
  dismissRollToast: (id: string) => void;
  shiftRollQueue: () => void;
  addJoinToast: (entry: PresenceEntry) => void;
  dismissJoinToast: (id: string) => void;
  addBoardMoment: (id: string) => void;
  removeBoardMoment: (id: string) => void;
  addShareToast: (docTitle: string) => void;
  dismissShareToast: (id: string) => void;
  setAssets: (assets: AssetManifest[]) => void;
  setDocuments: (documents: AssetManifest[]) => void;
  openDocPanel: (doc: AssetManifest) => void;
  openNotePanel: (noteId: string | null) => void;
  openTokenPanel: (tokenId: string | null) => void;
  closePanel: (panelId: string) => void;
  bringPanelToFront: (panelId: string) => void;
  setMediaSync: (assetId: string, cmd: { action: 'play' | 'pause' | 'stop'; time: number; atMs: number }) => void;
  openAudioDock: (assetId: string) => void;
  closeAudioDock: () => void;
  setAudioDockMinimized: (minimized: boolean) => void;
  upsertNote: (note: Note) => void;
  removeNote: (noteId: string) => void;
  setLastErrorMessage: (msg: string | null) => void;
  resetTable: () => void;

  // Token & grid actions
  setTokens: (tokens: TokenView[]) => void;
  setGrid: (grid: GridState) => void;
  setBoardTool: (tool: BoardTool) => void;
  setAoeShape: (shape: AoeShape) => void;
  setOwnMeasure: (measure: OwnMeasure | null) => void;
  setOwnMeasureShared: (shared: boolean) => void;
  setSharedMeasure: (by: string, measure: SharedMeasure | null) => void;
  clearSharedMeasure: (by: string) => void;
  setSelectedTokenId: (id: string | null) => void;

  // Map creation actions
  setPieces: (pieces: MapPiece[]) => void;
  setAoes: (aoes: AoeTemplate[]) => void;
  setInitiative: (initiative: InitiativeState) => void;
  setMapMeta: (meta: MapMeta) => void;
  setEditorMode: (mode: EditorMode) => void;
  setSelectedPieceId: (id: string | null) => void;
  setActivePalettePiece: (p: ActivePalettePiece | null) => void;
  toggleLayerVisible: (layer: MapLayer) => void;
  setGenDialog: (kind: GenKind | null) => void;
  setTemplates: (templates: MapTemplateSummary[]) => void;
}

// ---------------------------------------------------------------------------
// Combined store
// ---------------------------------------------------------------------------
type StoreState = AuthSlice & RouteSlice & LobbySlice & TableSlice;

const tableDefaults = {
  connection: 'closed' as ConnectionState,
  self: null,
  campaignName: '',
  presence: [],
  members: [] as MemberEntry[],
  board: [] as BoardItemView[],
  uploadsLocked: false,
  mapLocked: false,
  boardView: { x: 0, y: 0, scale: 1 } as BoardView,
  rollLog: [],
  assets: null,
  documents: [],
  openPanels: [] as TablePanel[],
  mediaSync: {},
  audioDock: null,
  rollToasts: [],
  rollQueue: [],
  joinToasts: [] as JoinToast[],
  boardMoments: [] as string[],
  shareToasts: [] as ShareToast[],
  myNotes: [],
  lastErrorMessage: null,
  tokens: [] as TokenView[],
  grid: { ...DEFAULT_GRID } as GridState,
  boardTool: 'select' as BoardTool,
  aoeShape: 'circle' as AoeShape,
  ownMeasure: null as OwnMeasure | null,
  ownMeasureShared: false,
  sharedMeasures: {} as Record<string, SharedMeasure>,
  selectedTokenId: null as string | null,
  pieces: [] as MapPiece[],
  aoes: [] as AoeTemplate[],
  initiative: { active: false, round: 0, turnIndex: 0, entries: [] } as InitiativeState,
  mapMeta: { name: 'Untitled map', areaTag: '' } as MapMeta,
  features: { imageGenEnabled: false },
  editorMode: 'play' as EditorMode,
  selectedPieceId: null as string | null,
  activePalettePiece: null as ActivePalettePiece | null,
  layerVisible: { background: true, terrain: true, props: true } as Record<MapLayer, boolean>,
  genDialog: null as GenKind | null,
  templates: [] as MapTemplateSummary[],
};

export const useStore = create<StoreState>()((set) => ({
  // -------------------------------------------------------------------------
  // Auth
  // -------------------------------------------------------------------------
  user: null,
  authChecked: false,
  setUser: (user) => set({ user }),
  setUnauthenticated: () =>
    set((s) => ({
      user: null,
      route: s.inviteToken ? 'register' : 'login',
    })),
  setAuthChecked: (checked) => set({ authChecked: checked }),

  // -------------------------------------------------------------------------
  // Route
  // -------------------------------------------------------------------------
  route: 'login',
  inviteToken: null,
  activeCampaignId: null,
  setRoute: (route) => set({ route }),
  setInviteToken: (token) => set({ inviteToken: token }),
  setActiveCampaignId: (id) => set({ activeCampaignId: id }),
  clearInviteToken: () => {
    set({ inviteToken: null });
    const url = new URL(window.location.href);
    url.searchParams.delete('invite');
    window.history.replaceState({}, '', url.toString());
  },

  // -------------------------------------------------------------------------
  // Lobby
  // -------------------------------------------------------------------------
  campaigns: [],
  setCampaigns: (campaigns) => set({ campaigns }),

  // -------------------------------------------------------------------------
  // Table
  // -------------------------------------------------------------------------
  ...tableDefaults,

  setConnection: (connection) => set({ connection }),
  setSelf: (self) => set({ self }),

  applySnapshot: (snap) =>
    set({
      mediaSync: snap.media
        ? { [snap.media.assetId]: { action: snap.media.action, time: snap.media.time, atMs: Date.now() - snap.media.elapsedMs } }
        : {},
      audioDock: snap.media
        ? { assetId: snap.media.assetId, minimized: false }
        : null,
      campaignName: snap.campaign.name,
      board: snap.board,
      uploadsLocked: snap.uploadsLocked,
      mapLocked: snap.mapLocked,
      presence: snap.presence,
      members: snap.members,
      rollLog: snap.rollLog.slice(0, ROLL_LOG_MAX),
      assets: snap.assets,
      documents: snap.documents,
      myNotes: snap.myNotes,
      tokens: snap.tokens,
      grid: snap.grid,
      pieces: snap.pieces,
      aoes: snap.aoes ?? [],
      initiative: snap.initiative ?? { active: false, round: 0, turnIndex: 0, entries: [] },
      mapMeta: snap.mapMeta,
      features: snap.features,
      templates: snap.templates,
      lastErrorMessage: null,
    }),

  setPresence: (entries) => set({ presence: entries }),
  setBoard: (items) => set({ board: items }),
  setUploadsLocked: (locked) => set({ uploadsLocked: locked }),
  setMapLocked: (locked) => set({ mapLocked: locked }),
  setBoardView: (view) => set({ boardView: view }),

  addRollEntry: (entry) =>
    set((s) => ({
      rollLog: [entry, ...s.rollLog].slice(0, ROLL_LOG_MAX),
      // Every received roll also pops a transient toast (max 3 stacked).
      rollToasts: [...s.rollToasts, entry].slice(-3),
      // …and queues the cinematic overlay. Only LIVE rolls land here (the
      // snapshot sets rollLog wholesale and never touches this), so joining a
      // campaign never replays past rolls. Cap so a flurry can't back up forever.
      rollQueue: [...s.rollQueue, entry].slice(-8),
    })),

  dismissRollToast: (id) =>
    set((s) => ({ rollToasts: s.rollToasts.filter((t) => t.id !== id) })),

  shiftRollQueue: () => set((s) => ({ rollQueue: s.rollQueue.slice(1) })),

  addJoinToast: (entry) =>
    set((s) => ({
      joinToasts: [...s.joinToasts, { id: `join-${entry.userId}-${Date.now()}`, entry }].slice(-3),
    })),

  dismissJoinToast: (id) =>
    set((s) => ({ joinToasts: s.joinToasts.filter((t) => t.id !== id) })),

  addBoardMoment: (id) =>
    set((s) => ({ boardMoments: [...s.boardMoments, id].slice(-5) })),

  removeBoardMoment: (id) =>
    set((s) => ({ boardMoments: s.boardMoments.filter((m) => m !== id) })),

  addShareToast: (docTitle) =>
    set((s) => ({
      shareToasts: [...s.shareToasts, { id: `share-${Date.now()}`, docTitle }].slice(-3),
    })),

  dismissShareToast: (id) =>
    set((s) => ({ shareToasts: s.shareToasts.filter((t) => t.id !== id) })),

  setAssets: (assets) => set({ assets }),
  setDocuments: (documents) =>
    set((s) => ({
      documents,
      // Close panels of deleted documents; refresh the doc object in surviving ones.
      openPanels: s.openPanels.flatMap((p): TablePanel[] => {
        if (p.kind !== 'doc') return [p];
        const fresh = documents.find((d) => d.id === p.doc.id);
        return fresh ? [{ ...p, doc: fresh }] : [];
      }),
      audioDock:
        s.audioDock && !documents.some((d) => d.id === s.audioDock!.assetId)
          ? null
          : s.audioDock,
    })),

  openDocPanel: (doc) =>
    set((s) => {
      const existing = s.openPanels.find((p) => p.kind === 'doc' && p.doc.id === doc.id);
      if (existing) {
        // Already open — bring to front with the fresh doc object.
        return {
          openPanels: [
            ...s.openPanels.filter((p) => p.panelId !== existing.panelId),
            { ...existing, doc },
          ],
        };
      }
      return { openPanels: [...s.openPanels, { panelId: nextPanelId(), kind: 'doc', doc }] };
    }),

  openNotePanel: (noteId) =>
    set((s) => {
      const existing = s.openPanels.find((p) => p.kind === 'note' && p.noteId === noteId);
      if (existing) {
        return {
          openPanels: [...s.openPanels.filter((p) => p.panelId !== existing.panelId), existing],
        };
      }
      return { openPanels: [...s.openPanels, { panelId: nextPanelId(), kind: 'note', noteId }] };
    }),

  openTokenPanel: (tokenId) =>
    set((s) => {
      // Only one token panel open at a time; replace if present.
      const withoutToken = s.openPanels.filter((p) => p.kind !== 'token');
      return { openPanels: [...withoutToken, { panelId: nextPanelId(), kind: 'token', tokenId }] };
    }),

  closePanel: (panelId) =>
    set((s) => ({ openPanels: s.openPanels.filter((p) => p.panelId !== panelId) })),

  bringPanelToFront: (panelId) =>
    set((s) => {
      const panel = s.openPanels.find((p) => p.panelId === panelId);
      if (!panel || s.openPanels[s.openPanels.length - 1] === panel) return s;
      return { openPanels: [...s.openPanels.filter((p) => p.panelId !== panelId), panel] };
    }),

  setMediaSync: (assetId, cmd) =>
    set((s) => ({ mediaSync: { ...s.mediaSync, [assetId]: cmd } })),

  openAudioDock: (assetId) =>
    set((s) => ({
      audioDock:
        s.audioDock?.assetId === assetId
          ? s.audioDock
          : { assetId, minimized: false },
    })),

  closeAudioDock: () => set({ audioDock: null }),

  setAudioDockMinimized: (minimized) =>
    set((s) => (s.audioDock ? { audioDock: { ...s.audioDock, minimized } } : s)),

  upsertNote: (note) =>
    set((s) => {
      const existing = s.myNotes.findIndex((n) => n.id === note.id);
      if (existing >= 0) {
        const updated = [...s.myNotes];
        updated[existing] = note;
        return { myNotes: updated };
      }
      return { myNotes: [...s.myNotes, note] };
    }),

  removeNote: (noteId) =>
    set((s) => ({
      myNotes: s.myNotes.filter((n) => n.id !== noteId),
      // Close any panel showing the deleted note.
      openPanels: s.openPanels.filter((p) => !(p.kind === 'note' && p.noteId === noteId)),
    })),

  setLastErrorMessage: (msg) => set({ lastErrorMessage: msg }),

  resetTable: () => set(tableDefaults),

  // Token & grid actions
  setTokens: (tokens) => set({ tokens }),
  setGrid: (grid) => set({ grid }),
  setBoardTool: (tool) => set({ boardTool: tool }),
  setAoeShape: (shape) => set({ aoeShape: shape }),
  setOwnMeasure: (measure) => set({ ownMeasure: measure }),
  setOwnMeasureShared: (shared) => set({ ownMeasureShared: shared }),
  setSharedMeasure: (by, measure) =>
    set((s) => ({
      sharedMeasures: measure
        ? { ...s.sharedMeasures, [by]: measure }
        : Object.fromEntries(Object.entries(s.sharedMeasures).filter(([k]) => k !== by)),
    })),
  clearSharedMeasure: (by) =>
    set((s) => ({
      sharedMeasures: Object.fromEntries(Object.entries(s.sharedMeasures).filter(([k]) => k !== by)),
    })),
  setSelectedTokenId: (id) => set({ selectedTokenId: id }),

  // Map creation
  setPieces: (pieces) => set({ pieces }),
  setAoes: (aoes) => set({ aoes }),
  setInitiative: (initiative) => set({ initiative }),
  setMapMeta: (mapMeta) => set({ mapMeta }),
  setEditorMode: (editorMode) =>
    set((s) => ({
      editorMode,
      // Leaving build mode clears build-only selections/tools.
      ...(editorMode === 'play'
        ? { selectedPieceId: null, activePalettePiece: null, boardTool: 'select' as BoardTool }
        : {}),
    })),
  setSelectedPieceId: (id) => set({ selectedPieceId: id }),
  setActivePalettePiece: (p) => set({ activePalettePiece: p }),
  toggleLayerVisible: (layer) =>
    set((s) => ({ layerVisible: { ...s.layerVisible, [layer]: !s.layerVisible[layer] } })),
  setGenDialog: (kind) => set({ genDialog: kind }),
  setTemplates: (templates) => set({ templates }),
}));
