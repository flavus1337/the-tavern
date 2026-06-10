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
  | { panelId: string; kind: 'note'; noteId: string | null };

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

interface TableSlice {
  connection: ConnectionState;
  self: SelfInfo | null;
  campaignName: string;
  presence: PresenceEntry[];
  board: BoardItemView[];
  uploadsLocked: boolean;
  /** View transform shared across the whole board (pan + zoom). */
  boardView: BoardView;
  rollLog: RollLogEntry[];
  assets: AssetManifest[] | null;
  documents: AssetManifest[];
  /** open floating panels over the board (docs + notes), render order = z-order */
  openPanels: TablePanel[];
  /** latest table-playback command per audio asset (drives synced players) */
  mediaSync: Record<string, { action: 'play' | 'pause'; time: number; atMs: number }>;
  /** transient roll-result popups shown over the canvas */
  rollToasts: RollLogEntry[];
  /** transient presence-join popups */
  joinToasts: JoinToast[];
  /** transient nat-20 board moment IDs (ring sweep) */
  boardMoments: string[];
  /** transient document-share toasts */
  shareToasts: ShareToast[];
  myNotes: Note[];
  lastErrorMessage: string | null;

  setConnection: (state: ConnectionState) => void;
  setSelf: (self: SelfInfo) => void;
  applySnapshot: (snap: ServerSnapshotPayload) => void;
  setPresence: (entries: PresenceEntry[]) => void;
  setBoard: (items: BoardItemView[]) => void;
  setUploadsLocked: (locked: boolean) => void;
  setBoardView: (view: BoardView) => void;
  addRollEntry: (entry: RollLogEntry) => void;
  dismissRollToast: (id: string) => void;
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
  closePanel: (panelId: string) => void;
  bringPanelToFront: (panelId: string) => void;
  setMediaSync: (assetId: string, cmd: { action: 'play' | 'pause'; time: number; atMs: number }) => void;
  upsertNote: (note: Note) => void;
  removeNote: (noteId: string) => void;
  setLastErrorMessage: (msg: string | null) => void;
  resetTable: () => void;
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
  board: [] as BoardItemView[],
  uploadsLocked: false,
  boardView: { x: 0, y: 0, scale: 1 } as BoardView,
  rollLog: [],
  assets: null,
  documents: [],
  openPanels: [],
  mediaSync: {},
  rollToasts: [],
  joinToasts: [] as JoinToast[],
  boardMoments: [] as string[],
  shareToasts: [] as ShareToast[],
  myNotes: [],
  lastErrorMessage: null,
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
      campaignName: snap.campaign.name,
      board: snap.board,
      uploadsLocked: snap.uploadsLocked,
      presence: snap.presence,
      rollLog: snap.rollLog.slice(0, ROLL_LOG_MAX),
      assets: snap.assets,
      documents: snap.documents,
      myNotes: snap.myNotes,
      lastErrorMessage: null,
    }),

  setPresence: (entries) => set({ presence: entries }),
  setBoard: (items) => set({ board: items }),
  setUploadsLocked: (locked) => set({ uploadsLocked: locked }),
  setBoardView: (view) => set({ boardView: view }),

  addRollEntry: (entry) =>
    set((s) => ({
      rollLog: [entry, ...s.rollLog].slice(0, ROLL_LOG_MAX),
      // Every received roll also pops a transient toast (max 3 stacked).
      rollToasts: [...s.rollToasts, entry].slice(-3),
    })),

  dismissRollToast: (id) =>
    set((s) => ({ rollToasts: s.rollToasts.filter((t) => t.id !== id) })),

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
}));
