import { useRef, useState } from 'react';
import type { ClientMessage } from '@vtt/shared';
import { useStore } from '../store';
import { renderMarkdown } from '../lib/markdown';
import { Button } from './ui/button';
import { Input } from './ui/input';

/**
 * Note editor rendered over the canvas area (non-modal — the sidebar stays
 * usable). Markdown body with a small formatting toolbar and live preview.
 */
export function NoteEditor({ noteId }: { noteId: string | null }) {
  const myNotes = useStore((s) => s.myNotes);
  const self = useStore((s) => s.self);
  const connection = useStore((s) => s.connection);
  const setNoteEditor = useStore((s) => s.setNoteEditor);

  const existing = noteId ? myNotes.find((n) => n.id === noteId) : undefined;
  const isDm = self?.role === 'dm';

  const [title, setTitle] = useState(existing?.title ?? '');
  const [body, setBody] = useState(existing?.body ?? '');
  const [visibility, setVisibility] = useState<'dm' | 'player'>(
    existing?.visibility ?? (isDm ? 'dm' : 'player'),
  );
  const [mode, setMode] = useState<'write' | 'preview'>('write');
  // Existing notes open in read mode; new notes go straight to editing.
  const [editing, setEditing] = useState(noteId === null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const canSave = connection === 'open' && title.trim() !== '';

  function save() {
    if (!canSave) return;
    const conn = (window as unknown as { __vttConn?: { send: (msg: ClientMessage) => void } }).__vttConn;
    conn?.send({
      type: 'saveNote',
      ...(noteId ? { noteId } : {}),
      title: title.trim(),
      body,
      visibility,
    });
    if (noteId) {
      // Back to reading the (locally up-to-date) note.
      setEditing(false);
      setMode('write');
    } else {
      // New note gets its id server-side; close — it appears in the list.
      setNoteEditor(null);
    }
  }

  function deleteThisNote() {
    if (!noteId) return;
    if (!window.confirm(`Delete "${title || 'this note'}"? This cannot be undone.`)) return;
    const conn = (window as unknown as { __vttConn?: { send: (msg: ClientMessage) => void } }).__vttConn;
    conn?.send({ type: 'deleteNote', noteId });
    // The noteDeleted broadcast removes it from the list and closes this editor.
  }

  function cancelEdit() {
    if (noteId && existing) {
      setTitle(existing.title);
      setBody(existing.body);
      setVisibility(existing.visibility);
      setEditing(false);
      setMode('write');
    } else {
      setNoteEditor(null);
    }
  }

  // --- toolbar actions operate on the textarea selection -------------------
  function applyEdit(fn: (value: string, start: number, end: number) => { value: string; start: number; end: number }) {
    const ta = textareaRef.current;
    if (!ta) return;
    const { value, start, end } = fn(ta.value, ta.selectionStart, ta.selectionEnd);
    setBody(value);
    requestAnimationFrame(() => {
      ta.focus();
      ta.setSelectionRange(start, end);
    });
  }

  function wrapSelection(marker: string) {
    applyEdit((value, start, end) => {
      const selected = value.slice(start, end) || 'text';
      const next = value.slice(0, start) + marker + selected + marker + value.slice(end);
      return { value: next, start: start + marker.length, end: start + marker.length + selected.length };
    });
  }

  function prefixLines(prefix: string | ((i: number) => string)) {
    applyEdit((value, start, end) => {
      const lineStart = value.lastIndexOf('\n', start - 1) + 1;
      const sliceEnd = end > start && value[end - 1] === '\n' ? end - 1 : end;
      const lineEnd = value.indexOf('\n', sliceEnd) === -1 ? value.length : value.indexOf('\n', sliceEnd);
      const segment = value.slice(lineStart, lineEnd);
      const prefixed = segment
        .split('\n')
        .map((l, i) => (typeof prefix === 'string' ? prefix : prefix(i)) + l)
        .join('\n');
      const next = value.slice(0, lineStart) + prefixed + value.slice(lineEnd);
      return { value: next, start: lineStart, end: lineStart + prefixed.length };
    });
  }

  const toolbar: Array<{ label: string; title: string; action: () => void; className?: string }> = [
    { label: 'B', title: 'Bold', action: () => wrapSelection('**'), className: 'font-bold' },
    { label: 'I', title: 'Italic', action: () => wrapSelection('*'), className: 'italic' },
    { label: 'H', title: 'Heading', action: () => prefixLines('## ') },
    { label: '•', title: 'Bullet list', action: () => prefixLines('- ') },
    { label: '1.', title: 'Numbered list', action: () => prefixLines((i) => `${i + 1}. `) },
  ];

  return (
    <div className="absolute inset-0 z-20 flex flex-col bg-zinc-900 border-r border-zinc-800">
      {/* Header */}
      <div className="flex items-center justify-between gap-2 px-4 py-2 border-b border-zinc-800 bg-zinc-950 shrink-0">
        <p className="text-sm font-medium text-zinc-200 truncate">
          {noteId ? (editing ? 'Edit note' : 'Note') : 'New note'}
        </p>
        <div className="flex items-center gap-2 shrink-0">
          {editing ? (
            <>
              {isDm && (
                <label className="flex items-center gap-1.5 text-xs text-zinc-400 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={visibility === 'dm'}
                    onChange={(e) => setVisibility(e.target.checked ? 'dm' : 'player')}
                    className="rounded"
                  />
                  DM-only
                </label>
              )}
              <Button size="sm" variant="ghost" onClick={cancelEdit}>
                Cancel
              </Button>
              <Button size="sm" onClick={save} disabled={!canSave}>
                Save
              </Button>
            </>
          ) : (
            <>
              <Button size="sm" variant="secondary" onClick={() => setEditing(true)}>
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="w-3.5 h-3.5">
                  <path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
                Edit
              </Button>
              <Button
                size="sm"
                variant="destructive"
                onClick={deleteThisNote}
                disabled={connection !== 'open'}
                aria-label="Delete note"
                title="Delete note"
              >
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="w-3.5 h-3.5">
                  <path d="M3 6h18M8 6V4a2 2 0 012-2h4a2 2 0 012 2v2m3 0v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6h14M10 11v6M14 11v6" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              </Button>
            </>
          )}
          <button
            type="button"
            onClick={() => setNoteEditor(null)}
            className="p-1.5 text-zinc-400 hover:text-zinc-200 rounded transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-indigo-500"
            aria-label="Close editor (back to canvas)"
            title="Close (back to canvas)"
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="w-4 h-4">
              <path d="M18 6 6 18M6 6l12 12" strokeLinecap="round" />
            </svg>
          </button>
        </div>
      </div>

      {/* Read mode */}
      {!editing && (
        <div className="flex-1 min-h-0 overflow-y-auto">
          <div className="max-w-3xl w-full mx-auto p-6">
            <div className="flex items-center gap-2 mb-4">
              <h1 className="text-2xl font-bold text-zinc-100">{title}</h1>
              {isDm && visibility === 'dm' && (
                <span className="text-[10px] uppercase tracking-wider bg-zinc-800 text-zinc-400 rounded px-1.5 py-0.5">DM</span>
              )}
            </div>
            {body.trim() === '' ? (
              <p className="text-sm text-zinc-600 italic">This note is empty — hit Edit to write something.</p>
            ) : (
              renderMarkdown(body)
            )}
          </div>
        </div>
      )}

      {/* Editor */}
      {editing && (
      <div className="flex-1 min-h-0 flex flex-col p-4 gap-2 max-w-3xl w-full mx-auto">
        <Input
          placeholder="Title"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          autoFocus={!noteId}
          className="text-base font-medium"
        />

        {/* Toolbar */}
        <div className="flex items-center gap-1 flex-wrap gap-y-2">
          {toolbar.map((t) => (
            <button
              key={t.title}
              type="button"
              onClick={t.action}
              disabled={mode === 'preview'}
              className={`w-8 h-8 rounded border border-zinc-700 text-zinc-300 hover:bg-zinc-800 disabled:opacity-40 text-sm transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-indigo-500 ${t.className ?? ''}`}
              title={t.title}
              aria-label={t.title}
            >
              {t.label}
            </button>
          ))}
          <div className="ml-auto flex rounded-md border border-zinc-700 overflow-hidden text-xs">
            <button
              type="button"
              onClick={() => setMode('write')}
              className={`px-3 py-1.5 transition-colors ${mode === 'write' ? 'bg-zinc-700 text-zinc-100' : 'text-zinc-400 hover:text-zinc-200'}`}
            >
              Write
            </button>
            <button
              type="button"
              onClick={() => setMode('preview')}
              className={`px-3 py-1.5 transition-colors ${mode === 'preview' ? 'bg-zinc-700 text-zinc-100' : 'text-zinc-400 hover:text-zinc-200'}`}
            >
              Preview
            </button>
          </div>
        </div>

        {mode === 'write' ? (
          <textarea
            ref={textareaRef}
            placeholder="Write your note… (markdown: **bold**, *italic*, ## heading, - list)"
            value={body}
            onChange={(e) => setBody(e.target.value)}
            className="flex-1 min-h-0 w-full rounded-md bg-zinc-950 border border-zinc-800 px-3 py-2.5 text-sm text-zinc-200 placeholder:text-zinc-600 focus:outline-none focus-visible:border-indigo-500 resize-none font-mono leading-relaxed"
          />
        ) : (
          <div className="flex-1 min-h-0 overflow-y-auto rounded-md bg-zinc-950 border border-zinc-800 px-4 py-3">
            {body.trim() === '' ? (
              <p className="text-sm text-zinc-600 italic">Nothing to preview yet.</p>
            ) : (
              renderMarkdown(body)
            )}
          </div>
        )}
      </div>
      )}
    </div>
  );
}
