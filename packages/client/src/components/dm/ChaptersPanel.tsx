import { useEffect, useMemo, useState, type FormEvent } from 'react';
import type { ClientMessage, ChapterView, CharacterView, AssetManifest, Note } from '@vtt/shared';
import { useStore } from '../../store';
import { Button } from './../ui/button';
import { Input } from './../ui/input';
import { Label } from './../ui/label';
import { ScrollArea } from './../ui/scroll-area';
import { Dialog, DialogContent, DialogHeader } from './../ui/dialog';

function sendWs(msg: ClientMessage): void {
  const conn = (window as unknown as { __vttConn?: { send: (msg: ClientMessage) => void } }).__vttConn;
  conn?.send(msg);
}

const CHAPTER_PREFIX = 'chapter:';
const chapterIdsOf = (tags: string[]): string[] =>
  tags.filter((t) => t.startsWith(CHAPTER_PREFIX)).map((t) => t.slice(CHAPTER_PREFIX.length));
const isUnfiled = (tags: string[]): boolean => !tags.some((t) => t.startsWith(CHAPTER_PREFIX));

type EntityType = 'asset' | 'character' | 'note';

/**
 * The DM's chapter-organized panel. Chapters are the scope: the rail picks a
 * chapter (or All), and the Maps / NPCs / Notes sections below filter to it.
 * Membership is the `chapter:<id>` tag on each entity; the Unfiled footer
 * surfaces untagged items so nothing is ever silently hidden.
 */
export function ChaptersPanel() {
  const chapters = useStore((s) => s.chapters);
  const characters = useStore((s) => s.characters);
  const assets = useStore((s) => s.assets) ?? [];
  const notes = useStore((s) => s.myNotes);
  const campaignId = useStore((s) => s.activeCampaignId);

  const ordered = useMemo(() => [...chapters].sort((a, b) => a.order - b.order), [chapters]);
  const maps = useMemo(() => assets.filter((a) => a.assetKind === 'map'), [assets]);

  // 'all' shows the whole campaign; otherwise scope to one chapter.
  const [active, setActive] = useState<string>('all');
  const [editing, setEditing] = useState<{ id?: string } | null>(null);

  // Default to the first chapter; clamp if the active one disappears.
  useEffect(() => {
    if (active !== 'all' && !ordered.some((c) => c.id === active)) setActive('all');
    if (active === 'all' && ordered.length > 0) setActive(ordered[0]!.id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ordered.length]);

  const allView = active === 'all';
  const inScope = (tags: string[]) => allView || chapterIdsOf(tags).includes(active);

  const scopedMaps = maps.filter((m) => inScope(m.tags));
  const scopedNpcs = characters.filter((c) => inScope(c.tags));
  const scopedNotes = notes.filter((n) => inScope(n.tags));

  const unfiled = [
    ...maps.filter((m) => isUnfiled(m.tags)).map((m) => ({ type: 'asset' as EntityType, id: m.id, name: m.title })),
    ...characters.filter((c) => isUnfiled(c.tags)).map((c) => ({ type: 'character' as EntityType, id: c.id, name: c.name })),
    ...notes.filter((n) => isUnfiled(n.tags)).map((n) => ({ type: 'note' as EntityType, id: n.id, name: n.title })),
  ];

  const itemCount = scopedMaps.length + scopedNpcs.length + scopedNotes.length;
  const activeChapter = ordered.find((c) => c.id === active);
  const chapterNumber = (id: string) => ordered.findIndex((c) => c.id === id) + 1;

  function setChapters(type: EntityType, entityId: string, chapterIds: string[]) {
    sendWs({ type: 'setEntityChapters', entityType: type, entityId, chapterIds });
  }
  function fileHere(type: EntityType, entityId: string, current: string[]) {
    if (allView) return;
    setChapters(type, entityId, [...new Set([...current, active])]);
  }
  function unfileFromActive(type: EntityType, entityId: string, current: string[]) {
    setChapters(type, entityId, current.filter((c) => c !== active));
  }

  // Chips: scoped view shows the item's *other* chapters; All view shows them all.
  function Chips({ tags }: { tags: string[] }) {
    const ids = chapterIdsOf(tags);
    const shown = allView ? ids : ids.filter((c) => c !== active);
    if (allView && ids.length === 0) {
      return <span className="chchip" style={{ color: 'var(--faint)', borderColor: 'var(--border)' }}>Unfiled</span>;
    }
    return (
      <>
        {shown.map((id) => {
          const n = chapterNumber(id);
          if (n <= 0) return null;
          return <span key={id} className="chchip">Ch {n}</span>;
        })}
      </>
    );
  }

  function RowActions({ type, id, tags }: { type: EntityType; id: string; tags: string[] }) {
    if (allView) return null;
    return (
      <button
        type="button"
        title="Remove from this chapter"
        onClick={() => unfileFromActive(type, id, chapterIdsOf(tags))}
        className="shrink-0 px-1.5 text-[var(--faint)] hover:text-[var(--garnet)]"
        style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 14 }}
      >
        ×
      </button>
    );
  }

  const Section = ({ label, count, children }: { label: string; count: number; children: React.ReactNode }) => (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <p className="eyebrow" style={{ margin: 0 }}>{label}</p>
        <span style={{ fontFamily: 'var(--mono)', fontSize: 11, color: 'var(--faint)' }}>{count}</span>
      </div>
      {count === 0
        ? <p style={{ fontSize: 11, color: 'var(--faint)', padding: '2px 0 4px' }}>Nothing here yet.</p>
        : children}
    </div>
  );

  const rowStyle: React.CSSProperties = {
    background: 'var(--surface2)', border: '1px solid var(--border)', borderRadius: 10,
  };

  function MapRow({ m }: { m: AssetManifest }) {
    return (
      <div className="flex items-center gap-2 p-1.5" style={rowStyle}>
        <img
          src={`/api/campaigns/${campaignId}/files/assets/${m.file}`}
          alt=""
          className="shrink-0 rounded object-cover"
          style={{ width: 40, height: 28, background: 'var(--raised)' }}
        />
        <span className="truncate flex-1" style={{ fontSize: 13, color: 'var(--hi)' }}>{m.title}</span>
        <Chips tags={m.tags} />
        <RowActions type="asset" id={m.id} tags={m.tags} />
      </div>
    );
  }

  function NpcRow({ c }: { c: CharacterView }) {
    const portrait = c.portraitAssetId ? assets.find((a) => a.id === c.portraitAssetId) : undefined;
    return (
      <div className="flex items-center gap-2 p-1.5" style={rowStyle}>
        <div className="shrink-0 rounded-full overflow-hidden" style={{ width: 28, height: 28, background: 'var(--raised)' }}>
          {portrait && (
            <img src={`/api/campaigns/${campaignId}/files/assets/${portrait.file}`} alt="" className="w-full h-full object-cover" />
          )}
        </div>
        <span className="truncate flex-1" style={{ fontSize: 13, color: 'var(--hi)' }}>{c.name}</span>
        {c.cr && <span style={{ fontFamily: 'var(--mono)', fontSize: 10, color: 'var(--low)' }}>{c.cr}</span>}
        <Chips tags={c.tags} />
        <RowActions type="character" id={c.id} tags={c.tags} />
      </div>
    );
  }

  const NOTE_COLOR: Record<string, string> = { secret: 'var(--garnet)', readaloud: 'var(--gold)', handout: 'var(--teal)' };
  function NoteRow({ n }: { n: Note }) {
    const kind = n.noteKind ?? 'secret';
    return (
      <div className="flex items-center gap-2 p-1.5" style={rowStyle}>
        <span className="shrink-0" style={{ width: 6, height: 6, borderRadius: 999, background: NOTE_COLOR[kind] }} />
        <span className="truncate flex-1" style={{ fontSize: 13, color: 'var(--hi)' }}>{n.title}</span>
        <Chips tags={n.tags} />
        <RowActions type="note" id={n.id} tags={n.tags} />
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full">
      {/* Chapter rail */}
      <div className="flex gap-1.5 p-2 overflow-x-auto" style={{ borderBottom: '1px solid var(--border-soft)' }}>
        <RailPill label="All" active={allView} onClick={() => setActive('all')} />
        {ordered.map((c, i) => (
          <RailPill key={c.id} label={`${i + 1}`} title={c.title} active={active === c.id} onClick={() => setActive(c.id)} />
        ))}
        <button
          type="button"
          title="Add chapter"
          onClick={() => setEditing({})}
          className="shrink-0 px-2 rounded-[8px]"
          style={{ color: 'var(--low)', background: 'var(--surface2)', border: '1px solid var(--border)', cursor: 'pointer' }}
        >
          +
        </button>
      </div>

      {/* Active-chapter header */}
      <div className="p-3" style={{ borderBottom: '1px solid var(--border-soft)' }}>
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <p style={{ fontFamily: 'var(--serif)', fontSize: 16, fontWeight: 600, color: 'var(--hi)' }} className="truncate">
              {allView ? 'All chapters' : activeChapter?.title}
            </p>
            {!allView && activeChapter?.summary && (
              <p className="mt-0.5" style={{ fontSize: 12, color: 'var(--low)', lineHeight: 1.4 }}>{activeChapter.summary}</p>
            )}
          </div>
          {!allView && activeChapter && (
            <Button size="sm" variant="ghost" onClick={() => setEditing({ id: activeChapter.id })}>Edit</Button>
          )}
        </div>
        <p className="mt-1" style={{ fontFamily: 'var(--mono)', fontSize: 11, color: 'var(--faint)' }}>
          {itemCount} item{itemCount === 1 ? '' : 's'}{allView ? ' · whole campaign' : ''}
        </p>
      </div>

      {/* Scoped sections */}
      <ScrollArea className="flex-1">
        {ordered.length === 0 ? (
          <p className="text-xs text-center py-10" style={{ color: 'var(--faint)' }}>
            No chapters yet. Add one with <b style={{ color: 'var(--mid)' }}>+</b> to start organizing your campaign.
          </p>
        ) : (
          <div className="p-3 space-y-5">
            <Section label="Maps" count={scopedMaps.length}>
              <div className="space-y-1.5">{scopedMaps.map((m) => <MapRow key={m.id} m={m} />)}</div>
            </Section>
            <Section label="NPCs & monsters" count={scopedNpcs.length}>
              <div className="space-y-1.5">{scopedNpcs.map((c) => <NpcRow key={c.id} c={c} />)}</div>
            </Section>
            <Section label="Notes & handouts" count={scopedNotes.length}>
              <div className="space-y-1.5">{scopedNotes.map((n) => <NoteRow key={n.id} n={n} />)}</div>
            </Section>
          </div>
        )}
      </ScrollArea>

      {/* Unfiled footer */}
      {unfiled.length > 0 && (
        <div className="p-2.5" style={{ borderTop: '1px solid var(--border-soft)', background: 'var(--surface)' }}>
          <p className="eyebrow" style={{ margin: '0 0 6px' }}>
            <span style={{ color: 'var(--gold)' }}>{unfiled.length}</span> unfiled
            {!allView && ' — file into this chapter'}
          </p>
          <div className="space-y-1 max-h-28 overflow-y-auto">
            {unfiled.map((u) => (
              <div key={`${u.type}:${u.id}`} className="flex items-center gap-2 px-1.5 py-1" style={{ fontSize: 12, color: 'var(--mid)' }}>
                <span className="truncate flex-1">{u.name || '(untitled)'}</span>
                {!allView && (
                  <button
                    type="button"
                    onClick={() => fileHere(u.type, u.id, [])}
                    className="shrink-0 px-2 py-0.5 rounded-[7px]"
                    style={{ fontSize: 11, color: 'var(--ember)', background: 'var(--surface2)', border: '1px solid var(--border)', cursor: 'pointer' }}
                  >
                    File here
                  </button>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {editing && (
        <ChapterEditDialog
          chapter={editing.id ? ordered.find((c) => c.id === editing.id) : undefined}
          canDelete={Boolean(editing.id)}
          onClose={() => setEditing(null)}
        />
      )}
    </div>
  );
}

function RailPill({ label, title, active, onClick }: { label: string; title?: string; active: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      title={title}
      onClick={onClick}
      className="shrink-0 px-2.5 py-1 rounded-[8px] whitespace-nowrap"
      style={{
        fontFamily: 'var(--mono)', fontSize: 12,
        color: active ? 'var(--ink)' : 'var(--mid)',
        background: active ? 'var(--ember)' : 'var(--surface2)',
        border: `1px solid ${active ? 'var(--ember)' : 'var(--border)'}`,
        cursor: 'pointer',
      }}
    >
      {label}
    </button>
  );
}

function ChapterEditDialog({ chapter, canDelete, onClose }: { chapter?: ChapterView; canDelete: boolean; onClose: () => void }) {
  const [title, setTitle] = useState(chapter?.title ?? '');
  const [summary, setSummary] = useState(chapter?.summary ?? '');
  const [body, setBody] = useState(chapter?.body ?? '');

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (!title.trim()) return;
    sendWs({ type: 'saveChapter', chapterId: chapter?.id, title: title.trim(), summary: summary.trim(), body });
    onClose();
  }
  function handleDelete() {
    if (chapter && window.confirm(`Delete "${chapter.title}"? Its items stay, but lose this chapter.`)) {
      sendWs({ type: 'deleteChapter', chapterId: chapter.id });
      onClose();
    }
  }

  return (
    <Dialog open onClose={onClose}>
      <DialogContent title={chapter ? 'Edit Chapter' : 'New Chapter'}>
        <DialogHeader title={chapter ? 'Edit Chapter' : 'New Chapter'} />
        <form onSubmit={handleSubmit}>
          <div className="space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor="ch-title">Title</Label>
              <Input id="ch-title" required value={title} onChange={(e) => setTitle(e.target.value)} placeholder="The Ritual Chamber" />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="ch-summary">Summary <span className="text-[var(--low)] font-normal">(optional)</span></Label>
              <Input id="ch-summary" value={summary} onChange={(e) => setSummary(e.target.value)} placeholder="One line shown under the title" />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="ch-body">Prep notes <span className="text-[var(--low)] font-normal">(markdown)</span></Label>
              <textarea
                id="ch-body"
                value={body}
                onChange={(e) => setBody(e.target.value)}
                rows={6}
                className="w-full px-3 py-2 rounded-[9px]"
                style={{ background: '#100c0a', border: '1px solid var(--border)', color: 'var(--hi)', fontFamily: 'var(--mono)', fontSize: 13, resize: 'vertical' }}
                placeholder="What the DM needs to run this chapter…"
              />
            </div>
            <div className="flex gap-2 pt-1">
              {canDelete && (
                <Button type="button" variant="destructive" size="sm" onClick={handleDelete}>Delete</Button>
              )}
              <Button type="button" variant="secondary" onClick={onClose} className="flex-1">Cancel</Button>
              <Button type="submit" className="flex-1">Save</Button>
            </div>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
