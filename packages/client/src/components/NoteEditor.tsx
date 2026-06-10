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
  // Recipients of a shared note can read it but not edit/delete/unshare.
  const isOwner = !existing || existing.ownerUsername === self?.username;
  const canModify = isOwner || isDm;

  const [title, setTitle] = useState(existing?.title ?? '');
  const [body, setBody] = useState(existing?.body ?? '');
  const [visibility, setVisibility] = useState<'dm' | 'player' | 'shared'>(
    existing?.visibility ?? (isDm ? 'dm' : 'player'),
  );
  const [mode, setMode] = useState<'write' | 'preview'>('write');
  // Existing notes open in read mode; new notes go straight to editing.
  const [editing, setEditing] = useState(noteId === null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const canSave = connection === 'open' && title.trim() !== '';

  function toggleShared() {
    if (!existing || !canModify || connection !== 'open') return;
    const next = existing.visibility === 'shared' ? (isDm ? 'dm' : 'player') : 'shared';
    const conn = (window as unknown as { __vttConn?: { send: (msg: ClientMessage) => void } }).__vttConn;
    conn?.send({
      type: 'saveNote',
      noteId: existing.id,
      title: existing.title,
      body: existing.body,
      visibility: next,
    });
    setVisibility(next);
  }

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
    <div
      className="absolute inset-0 z-20 flex flex-col lg:inset-auto lg:right-4 lg:top-4 lg:bottom-4 lg:w-[55%] lg:max-w-3xl lg:rounded-xl lg:shadow-2xl lg:overflow-hidden"
      style={{ background: 'var(--surface)', border: '1px solid var(--border)' }}
    >
      {/* Header */}
      <div
        className="flex items-center justify-between gap-2 px-4 py-2 shrink-0"
        style={{ borderBottom: '1px solid var(--border-soft)', background: 'var(--bg)' }}
      >
        <p className="text-sm font-medium truncate" style={{ color: 'var(--hi)' }}>
          {noteId ? (editing ? 'Edit note' : 'Note') : 'New note'}
        </p>
        <div className="flex items-center gap-2 shrink-0">
          {editing ? (
            <>
              {isDm && (
                <label className="flex items-center gap-1.5 text-xs cursor-pointer" style={{ color: 'var(--mid)' }}>
                  <input
                    type="checkbox"
                    checked={visibility === 'dm'}
                    onChange={(e) => setVisibility(e.target.checked ? 'dm' : 'player')}
                    className="rounded"
                    style={{ accentColor: 'var(--ember)' }}
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
              {canModify && existing && (
                existing.visibility === 'shared' ? (
                  <button
                    type="button"
                    onClick={toggleShared}
                    disabled={connection !== 'open'}
                    style={{ fontSize: 12, fontWeight: 600, color: 'var(--low)', background: 'rgba(255,255,255,0.04)', border: '1px solid var(--border)', padding: '6px 11px', borderRadius: 7, cursor: 'pointer', whiteSpace: 'nowrap' }}
                    title="Stop sharing with the table"
                  >
                    ✓ Shared with table
                  </button>
                ) : (
                  <button
                    type="button"
                    onClick={toggleShared}
                    disabled={connection !== 'open'}
                    style={{ fontSize: 12, fontWeight: 600, color: 'var(--teal)', background: '#69b7a615', border: '1px solid #69b7a63a', padding: '6px 11px', borderRadius: 7, cursor: 'pointer', whiteSpace: 'nowrap' }}
                    title="Make this note visible to everyone at the table"
                  >
                    Share with table
                  </button>
                )
              )}
              {canModify && (
                <Button size="sm" variant="secondary" onClick={() => setEditing(true)}>
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="w-3.5 h-3.5">
                    <path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                  Edit
                </Button>
              )}
              {canModify && (
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
              )}
            </>
          )}
          <button
            type="button"
            onClick={() => setNoteEditor(null)}
            className="p-1.5 rounded transition-colors"
            style={{ color: 'var(--low)' }}
            onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.color = 'var(--hi)'; }}
            onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.color = 'var(--low)'; }}
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
              <h1
                className="text-2xl font-bold"
                style={{ fontFamily: 'var(--serif)', color: 'var(--hi)' }}
              >
                {title}
              </h1>
              {isDm && visibility === 'dm' && (
                <span
                  className="text-[10px] uppercase tracking-wider rounded px-1.5 py-0.5"
                  style={{ background: 'var(--raised)', color: 'var(--mid)' }}
                >
                  DM
                </span>
              )}
              {(existing?.visibility ?? visibility) === 'shared' && (
                <span
                  className="text-[10px] uppercase tracking-wider rounded px-1.5 py-0.5"
                  style={{ background: '#69b7a61a', color: 'var(--teal)' }}
                >
                  shared
                </span>
              )}
              {existing && !isOwner && existing.ownerUsername && (
                <span className="text-xs" style={{ color: 'var(--faint)', fontFamily: 'var(--mono)' }}>
                  by {existing.ownerUsername}
                </span>
              )}
            </div>
            {body.trim() === '' ? (
              <p className="text-sm italic" style={{ color: 'var(--faint)' }}>This note is empty — hit Edit to write something.</p>
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
              className={`w-8 h-8 rounded text-sm transition-colors disabled:opacity-40 ${t.className ?? ''}`}
              style={{ border: '1px solid var(--border)', color: 'var(--mid)', background: 'transparent' }}
              onMouseEnter={(e) => { if (!(e.currentTarget as HTMLButtonElement).disabled) (e.currentTarget as HTMLElement).style.background = 'var(--surface2)'; }}
              onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.background = 'transparent'; }}
              title={t.title}
              aria-label={t.title}
            >
              {t.label}
            </button>
          ))}
          <div
            className="ml-auto flex overflow-hidden text-xs"
            style={{ borderRadius: 9, border: '1px solid var(--border)' }}
          >
            <button
              type="button"
              onClick={() => setMode('write')}
              className="px-3 py-1.5 transition-colors"
              style={mode === 'write'
                ? { background: 'var(--raised)', color: 'var(--hi)' }
                : { color: 'var(--low)' }}
            >
              Write
            </button>
            <button
              type="button"
              onClick={() => setMode('preview')}
              className="px-3 py-1.5 transition-colors"
              style={mode === 'preview'
                ? { background: 'var(--raised)', color: 'var(--hi)' }
                : { color: 'var(--low)' }}
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
            className="flex-1 min-h-0 w-full px-3 py-2.5 text-sm resize-none leading-relaxed focus:outline-none"
            style={{
              fontFamily: 'var(--mono)',
              background: '#100c0a',
              border: '1px solid var(--border)',
              borderRadius: 9,
              color: 'var(--hi)',
              caretColor: 'var(--ember)',
            }}
            onFocus={(e) => {
              (e.currentTarget as HTMLElement).style.borderColor = 'var(--ember)';
              (e.currentTarget as HTMLElement).style.boxShadow = '0 0 0 3px rgba(224,138,75,0.13)';
            }}
            onBlur={(e) => {
              (e.currentTarget as HTMLElement).style.borderColor = 'var(--border)';
              (e.currentTarget as HTMLElement).style.boxShadow = '';
            }}
          />
        ) : (
          <div
            className="flex-1 min-h-0 overflow-y-auto px-4 py-3"
            style={{ background: '#100c0a', border: '1px solid var(--border)', borderRadius: 9 }}
          >
            {body.trim() === '' ? (
              <p className="text-sm italic" style={{ color: 'var(--faint)' }}>Nothing to preview yet.</p>
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
