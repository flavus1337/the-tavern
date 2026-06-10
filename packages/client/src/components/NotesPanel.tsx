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
  const noteEditor = useStore((s) => s.noteEditor);
  const setNoteEditor = useStore((s) => s.setNoteEditor);

  const isDm = self?.role === 'dm';
  const sorted = [...myNotes].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));

  return (
    <div className="flex flex-col h-full">
      <div className="p-3" style={{ borderBottom: '1px solid var(--border-soft)' }}>
        <Button size="sm" variant="secondary" className="w-full" onClick={() => setNoteEditor({ noteId: null })}>
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
              No notes yet. Create one — it opens in the main area and only you can see it.
            </p>
          ) : (
            sorted.map((note: Note) => {
              const isOpen = noteEditor?.noteId === note.id;
              return (
                <button
                  key={note.id}
                  type="button"
                  onClick={() => setNoteEditor({ noteId: note.id })}
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
                  title="Edit note"
                >
                  <div className="flex items-center gap-2">
                    <p
                      className="truncate flex-1"
                      style={{ fontFamily: 'var(--serif)', fontSize: 15, fontWeight: 600, color: 'var(--hi)' }}
                    >
                      {note.title}
                    </p>
                    {isDm && note.visibility === 'dm' && <Badge>DM</Badge>}
                  </div>
                  {note.body && (
                    <p
                      className="mt-1 truncate"
                      style={{ fontSize: 12, color: 'var(--low)' }}
                    >
                      {note.body}
                    </p>
                  )}
                </button>
              );
            })
          )}
        </div>
      </ScrollArea>
    </div>
  );
}
