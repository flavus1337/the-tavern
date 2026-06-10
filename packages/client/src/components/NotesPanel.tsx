import { useState } from 'react';
import type { Note, ClientMessage } from '@vtt/shared';
import { useStore } from '../store';
import { Button } from './ui/button';
import { Input } from './ui/input';
import { ScrollArea } from './ui/scroll-area';
import { Badge } from './ui/badge';

interface Draft {
  noteId?: string;
  title: string;
  body: string;
  visibility: 'dm' | 'player';
}

/**
 * Personal/DM notes with inline editing. Notes persist into the campaign
 * folder (notes/<id>.json) via the saveNote WS message.
 */
export function NotesPanel() {
  const myNotes = useStore((s) => s.myNotes);
  const self = useStore((s) => s.self);
  const connection = useStore((s) => s.connection);
  const [draft, setDraft] = useState<Draft | null>(null);

  const isDm = self?.role === 'dm';
  const canSave = connection === 'open' && draft !== null && draft.title.trim() !== '';

  function startNew() {
    setDraft({ title: '', body: '', visibility: isDm ? 'dm' : 'player' });
  }

  function startEdit(note: Note) {
    setDraft({ noteId: note.id, title: note.title, body: note.body, visibility: note.visibility });
  }

  function save() {
    if (!draft || !canSave) return;
    const conn = (window as unknown as { __vttConn?: { send: (msg: ClientMessage) => void } }).__vttConn;
    conn?.send({
      type: 'saveNote',
      ...(draft.noteId ? { noteId: draft.noteId } : {}),
      title: draft.title.trim(),
      body: draft.body,
      visibility: draft.visibility,
    });
    // noteSaved comes back over WS and upserts into myNotes.
    setDraft(null);
  }

  const sorted = [...myNotes].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));

  return (
    <div className="flex flex-col h-full">
      <div className="p-3 border-b border-zinc-800">
        {draft === null ? (
          <Button size="sm" variant="secondary" className="w-full" onClick={startNew}>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="w-4 h-4">
              <path d="M12 5v14M5 12h14" strokeLinecap="round" />
            </svg>
            New Note
          </Button>
        ) : (
          <div className="space-y-2">
            <Input
              placeholder="Title"
              value={draft.title}
              onChange={(e) => setDraft({ ...draft, title: e.target.value })}
              autoFocus
            />
            <textarea
              placeholder="Write your note…"
              value={draft.body}
              onChange={(e) => setDraft({ ...draft, body: e.target.value })}
              rows={6}
              className="w-full rounded-md bg-zinc-900 border border-zinc-700 px-3 py-2 text-sm text-zinc-200 placeholder:text-zinc-600 focus:outline-none focus-visible:border-indigo-500 resize-y"
            />
            {isDm && (
              <label className="flex items-center gap-1.5 text-xs text-zinc-400 cursor-pointer">
                <input
                  type="checkbox"
                  checked={draft.visibility === 'dm'}
                  onChange={(e) => setDraft({ ...draft, visibility: e.target.checked ? 'dm' : 'player' })}
                  className="rounded"
                />
                DM-only note
              </label>
            )}
            <div className="flex gap-2">
              <Button size="sm" className="flex-1" onClick={save} disabled={!canSave}>
                Save
              </Button>
              <Button size="sm" variant="ghost" onClick={() => setDraft(null)}>
                Cancel
              </Button>
            </div>
          </div>
        )}
      </div>

      <ScrollArea className="flex-1">
        <div className="p-3 space-y-2">
          {sorted.length === 0 && draft === null ? (
            <p className="text-xs text-zinc-500 text-center py-8">
              No notes yet. Create one — only you{isDm ? ' (and DM-only notes stay with the DM)' : ''} can see it.
            </p>
          ) : (
            sorted.map((note) => (
              <button
                key={note.id}
                type="button"
                onClick={() => startEdit(note)}
                className="w-full text-left p-2.5 bg-zinc-950 border border-zinc-800 rounded-lg hover:border-zinc-600 transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-indigo-500"
                title="Edit note"
              >
                <div className="flex items-center gap-2">
                  <p className="text-sm text-zinc-200 truncate flex-1">{note.title}</p>
                  {isDm && note.visibility === 'dm' && <Badge>DM</Badge>}
                </div>
                {note.body && (
                  <p className="text-xs text-zinc-500 mt-1 line-clamp-3 whitespace-pre-wrap">{note.body}</p>
                )}
              </button>
            ))
          )}
        </div>
      </ScrollArea>
    </div>
  );
}
