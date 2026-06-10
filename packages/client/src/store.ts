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
  /** document currently open in the in-table viewer (local; also set by documentShared pushes) */
  viewingDocument: AssetManifest | null;
  /** note editor open over the canvas area; noteId null = new note */
  noteEditor: { noteId: string | null } | null;
  /** transient roll-result popups shown over the canvas */
  rollToasts: RollLogEntry[];
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
  setAssets: (assets: AssetManifest[]) => void;
  setDocuments: (documents: AssetManifest[]) => void;
  setViewingDocument: (doc: AssetManifest | null) => void;
  setNoteEditor: (editor: { noteId: string | null } | null) => void;
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
  viewingDocument: null,
  noteEditor: null,
  rollToasts: [],
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

  setAssets: (assets) => set({ assets }),
  setDocuments: (documents) =>
    set((s) => ({
      documents,
      // Close the viewer if the open document was deleted.
      viewingDocument:
        s.viewingDocument && !documents.some((d) => d.id === s.viewingDocument!.id)
          ? null
          : s.viewingDocument,
    })),
  // Document viewer and note editor share the canvas overlay — opening one
  // closes the other.
  setViewingDocument: (doc) => set(doc ? { viewingDocument: doc, noteEditor: null } : { viewingDocument: null }),
  setNoteEditor: (editor) => set(editor ? { noteEditor: editor, viewingDocument: null } : { noteEditor: null }),

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
      // Close the editor if the deleted note is open.
      noteEditor: s.noteEditor?.noteId === noteId ? null : s.noteEditor,
    })),

  setLastErrorMessage: (msg) => set({ lastErrorMessage: msg }),

  resetTable: () => set(tableDefaults),
}));
