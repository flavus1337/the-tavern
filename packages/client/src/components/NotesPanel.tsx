import type { Note } from '@vtt/shared';
import { useStore } from '../store';
import { Button } from './ui/button';
import { ScrollArea } from './ui/scroll-area';
import { Badge } from './ui/badge';

/**
 * Notes list in the sidebar. Creating/editing opens the NoteEditor over the
 * canvas area (large editing surface, sidebar stays usable). Notes persist
 * into the campaign folder (notes/<id>.json) via the saveNote WS message.
 */
export function NotesPanel() {
  const myNotes = useStore((s) => s.myNotes);
  const self = useStore((s) => s.self);
  const openPanels = useStore((s) => s.openPanels);
  const openNotePanel = useStore((s) => s.openNotePanel);

  const isDm = self?.role === 'dm';
  const sorted = [...myNotes].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  const mine = sorted.filter((n) => n.ownerUsername === self?.username);
  const sharedWithMe = sorted.filter((n) => n.ownerUsername !== self?.username);

  function NoteRow({ note }: { note: Note }) {
    const isOpen = openPanels.some((p) => p.kind === 'note' && p.noteId === note.id);
    const ownNote = note.ownerUsername === self?.username;
    return (
      <button
        type="button"
        onClick={() => openNotePanel(note.id)}
        className="w-full text-left p-2.5 rounded-lg transition-colors"
        style={{
          background: 'var(--surface2)',
          border: `1px solid ${isOpen ? 'var(--ember)' : 'var(--border)'}`,
          ...(isOpen ? { background: '#e08a4b0a' } : {}),
        }}
        onMouseEnter={(e) => {
          if (!isOpen) (e.currentTarget as HTMLElement).style.borderColor = '#473b34';
        }}
        onMouseLeave={(e) => {
          if (!isOpen) (e.currentTarget as HTMLElement).style.borderColor = 'var(--border)';
        }}
        title={ownNote ? 'Open note' : `Shared by ${note.ownerUsername ?? 'unknown'}`}
      >
        <div className="flex items-center gap-2">
          <p
            className="truncate flex-1"
            style={{ fontFamily: 'var(--serif)', fontSize: 15, fontWeight: 600, color: 'var(--hi)' }}
          >
            {note.title}
          </p>
          {isDm && note.visibility === 'dm' && <Badge>DM</Badge>}
          {note.visibility === 'shared' && (
            <span
              className="text-[9px] uppercase tracking-wider rounded px-1.5 py-0.5 shrink-0"
              style={{ fontFamily: 'var(--mono)', background: '#69b7a61a', color: 'var(--teal)' }}
            >
              shared
            </span>
          )}
        </div>
        {!ownNote && note.ownerUsername && (
          <p className="mt-0.5" style={{ fontSize: 11, fontFamily: 'var(--mono)', color: 'var(--faint)' }}>
            by {note.ownerUsername}
          </p>
        )}
        {note.body && (
          <p className="mt-1 truncate" style={{ fontSize: 12, color: 'var(--low)' }}>
            {note.body}
          </p>
        )}
      </button>
    );
  }

  const sectionLabel = (text: string) => (
    <p className="eyebrow" style={{ margin: '4px 0 8px' }}>{text}</p>
  );

  return (
    <div className="flex flex-col h-full">
      <div className="p-3" style={{ borderBottom: '1px solid var(--border-soft)' }}>
        <Button size="sm" variant="secondary" className="w-full" onClick={() => openNotePanel(null)}>
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="w-4 h-4">
            <path d="M12 5v14M5 12h14" strokeLinecap="round" />
          </svg>
          New Note
        </Button>
      </div>

      <ScrollArea className="flex-1">
        <div className="p-3 space-y-2">
          {sorted.length === 0 ? (
            <p className="text-xs text-center py-8" style={{ color: 'var(--faint)' }}>
              No notes yet. Create one — only you see it until you share it with the table.
            </p>
          ) : (
            <>
              {mine.length > 0 && (
                <div className="space-y-2">
                  {sectionLabel('Your notes')}
                  {mine.map((note) => <NoteRow key={note.id} note={note} />)}
                </div>
              )}
              {sharedWithMe.length > 0 && (
                <div className="space-y-2" style={{ marginTop: mine.length > 0 ? 18 : 0 }}>
                  {sectionLabel('Shared with you')}
                  {sharedWithMe.map((note) => <NoteRow key={note.id} note={note} />)}
                </div>
              )}
            </>
          )}
        </div>
      </ScrollArea>
    </div>
  );
}
