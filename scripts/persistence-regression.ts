/** Run with pnpm persistence-regression. Every fixture lives in OS temp storage. */
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import type { CampaignEntry } from '../packages/server/src/campaign/registry.js';
import type { WsSession } from '../packages/server/src/ws/hub.js';
import type { NoteEntity, Chapter, AssetManifest, RollLogEntry, ServerMessage } from '../packages/shared/src/index.js';

async function main(): Promise<void> {
  const crashDir = process.env['PERSISTENCE_CRASH_DIR'];
  const tmp = crashDir ?? await fs.mkdtemp(path.join(os.tmpdir(), 'tavern-persistence-'));
  process.env['DATA_DIR'] = path.join(tmp, 'auth');
  process.env['CAMPAIGNS_DIR'] = path.join(tmp, 'campaigns');
  const { mutateCampaign, writeCampaignFile, drainCampaigns } = await import('../packages/server/src/campaign/commit.js');
  const { loadRuntime, persistState, appendRollLog } = await import('../packages/server/src/campaign/runtime.js');
  const { loadCampaign } = await import('../packages/server/src/campaign/loader.js');
  const { saveNote, deleteNote, saveChapter, saveAssetManifest, deleteAssetFiles } = await import('../packages/server/src/campaign/writer.js');
  const { addCampaign, getCampaign, scanCampaigns } = await import('../packages/server/src/campaign/registry.js');
  const { handleMessage: dispatch } = await import('../packages/server/src/ws/handlers.js');
  const { send, closeWebSockets } = await import('../packages/server/src/ws/hub.js');
  let commandSequence = 0;
  const handleMessage = (session: WsSession, raw: Record<string, unknown>) => {
    const command = { requestId: `persistence_${++commandSequence}`, ...raw };
    if (raw['type'] === 'saveNote' && typeof raw['noteId'] === 'string') {
      const note = getCampaign(session.campaignId!)?.store.notes.get(raw['noteId']);
      Object.assign(command, { baseRevision: note?.revision ?? 0, expected: Object.fromEntries(['title', 'body', 'sharing', 'tags', 'noteKind'].filter((key) => raw[key] !== undefined).map((key) => [key, (note as unknown as Record<string, unknown>)?.[key]])) });
    }
    return dispatch(session, command);
  };
  const { PROTOCOL_VERSION, SCHEMA_VERSIONS } = await import('../packages/shared/src/index.js');
  const chapter: Chapter = { type: 'chapter', schemaVersion: SCHEMA_VERSIONS.chapter, id: 'chapter', title: 'Before', order: 0, scenes: [], body: 'old body' };

  if (crashDir) {
    const store = (await loadCampaign(crashDir))!;
    const rename = fs.rename;
    fs.rename = async (source, destination) => {
      if (process.env['PERSISTENCE_CRASH_PHASE'] === 'committed' && String(source).endsWith('/pending-commit')) {
        process.kill(process.pid, 'SIGKILL');
        await new Promise(() => {});
      }
      await rename(source, destination);
      if (process.env['PERSISTENCE_CRASH_PHASE'] !== 'committed' && String(destination) === path.join(crashDir, 'chapters/chapter.json')) {
        process.kill(process.pid, 'SIGKILL');
        await new Promise(() => {});
      }
    };
    await saveChapter(store, { ...chapter, title: 'After', body: 'new body' });
    throw new Error('crash injection did not run');
  }

  let passed = 0;
  const pass = (label: string): void => { console.log(`PASS ${++passed}: ${label}`); };
  const sent: ServerMessage[] = [];
  const fakeSocket = { readyState: 1, send: (value: string) => { const message = JSON.parse(value) as ServerMessage; if (message.type !== 'commandAck') sent.push(message); }, close: () => {} };
  const session: WsSession = { id: 'test-ws', ws: fakeSocket as WsSession['ws'], userId: 'user', username: 'DM', campaignId: 'ordered', role: 'dm', isAlive: true };
  async function fixture(id: string): Promise<CampaignEntry> {
    const dir = path.join(tmp, 'campaigns', id);
    await fs.mkdir(dir, { recursive: true });
    const meta = { type: 'campaign' as const, schemaVersion: SCHEMA_VERSIONS.campaign, id, name: id, description: '', coverAssetId: null };
    await fs.writeFile(path.join(dir, 'campaign.json'), JSON.stringify(meta));
    const runtime = await loadRuntime(dir);
    const store = { dir, meta, chapters: new Map(), characters: new Map(), notes: new Map(), assets: new Map() };
    addCampaign(id, store, runtime);
    return getCampaign(id)!;
  }
  const note: NoteEntity = { type: 'note', schemaVersion: SCHEMA_VERSIONS.note, id: 'note', title: 'Before', body: '', tags: [], sharing: { scope: 'private', userIds: [] }, ownerUsername: 'DM', createdAt: '', updatedAt: '' };
  const read = async (file: string) => JSON.parse(await fs.readFile(file, 'utf8'));
  const absent = async (file: string) => assert.rejects(fs.access(file), { code: 'ENOENT' });
  async function failRename(target: string, action: () => Promise<unknown>): Promise<void> {
    const rename = fs.rename;
    let injected = false;
    fs.rename = async (source, destination) => {
      if (!injected && String(destination) === target) {
        injected = true;
        throw Object.assign(new Error('injected rename failure'), { code: 'EIO' });
      }
      await rename(source, destination);
    };
    try { await action(); assert.ok(injected, 'failure must hit the real commit path'); }
    finally { fs.rename = rename; }
  }

  try {
    let entry = await fixture('ordered');
    const notePath = path.join(entry.store.dir, 'notes/note.json');
    for (let round = 0; round < 20; round++) {
      await Promise.all([
        saveNote(entry.store, { ...note, title: `A-${round}`, body: 'A'.repeat(100_000) }),
        saveNote(entry.store, { ...note, title: `B-${round}`, body: 'B'.repeat(1000) }),
      ]);
      assert.deepEqual(await read(notePath), entry.store.notes.get(note.id));
      assert.equal(entry.store.notes.get(note.id)?.title, `B-${round}`);
    }
    pass('20 concurrent actual-writer save pairs stay valid, ordered, and equal on disk/in memory');

    await Promise.all([
      handleMessage(session, { type: 'saveNote', noteId: note.id, title: 'last edit', body: 'last body', sharing: note.sharing }),
      handleMessage(session, { type: 'deleteNote', noteId: note.id }),
    ]);
    assert.equal(entry.store.notes.has(note.id), false);
    await absent(notePath);
    pass('save then delete cannot resurrect a note');

    await saveChapter(entry.store, chapter);
    await saveNote(entry.store, note);
    await Promise.all([
      handleMessage(session, { type: 'setEntityChapters', entityType: 'note', entityId: note.id, chapterIds: [chapter.id] }),
      handleMessage(session, { type: 'saveNote', noteId: note.id, title: 'edited', body: 'edited body', sharing: note.sharing }),
    ]);
    assert.deepEqual(entry.store.notes.get(note.id)?.tags, ['chapter:chapter']);
    assert.deepEqual(await read(notePath), entry.store.notes.get(note.id));
    await Promise.all([
      handleMessage(session, { type: 'deleteChapter', chapterId: chapter.id }),
      handleMessage(session, { type: 'setEntityChapters', entityType: 'note', entityId: note.id, chapterIds: [chapter.id] }),
    ]);
    assert.deepEqual(entry.store.notes.get(note.id)?.tags, []);
    assert.deepEqual(await read(notePath), entry.store.notes.get(note.id));
    pass('chapter reassignment, editing, and chapter deletion use current committed state');

    // The old reproduction forced compaction at append 500. The bounded log now
    // replaces atomically on every append, exercising that boundary every time.
    const rolls = await fixture('rolls');
    for (let i = 0; i < 210; i += 2) {
      await Promise.all([
        appendRollLog(rolls.runtime, { id: `roll-${i}` } as RollLogEntry),
        appendRollLog(rolls.runtime, { id: `roll-${i + 1}` } as RollLogEntry),
      ]);
    }
    const persistedRolls = (await fs.readFile(path.join(rolls.runtime.dir, 'rolls.jsonl'), 'utf8')).trim().split('\n').map((line) => JSON.parse(line));
    assert.deepEqual(persistedRolls, rolls.runtime.rollLog);
    assert.equal(persistedRolls.length, 200);
    assert.equal(persistedRolls.at(-1).id, 'roll-209');
    pass('concurrent roll replacement preserves the next roll and the 200-entry bound');

    const broken = await fixture('broken');
    const statePath = path.join(broken.runtime.dir, 'state.json');
    await fs.mkdir(statePath);
    await assert.rejects(persistState(broken.runtime), /not a regular file/);
    await fs.rm(statePath, { recursive: true });
    await persistState(broken.runtime);
    const beforeState = await fs.readFile(statePath, 'utf8');
    await failRename(statePath, async () => {
      await assert.rejects(mutateCampaign(broken, async (draft) => {
        draft.runtime.state.uploadsLocked = true;
        await persistState(draft.runtime);
        send(session.ws, { type: 'settingsUpdated', uploadsLocked: true });
      }), /injected rename failure/);
    });
    assert.equal(broken.runtime.state.uploadsLocked, false);
    assert.equal(await fs.readFile(statePath, 'utf8'), beforeState);
    assert.equal(sent.length, 0);
    const open = fs.open;
    let injectedWrite = false;
    fs.open = async (...args: Parameters<typeof fs.open>) => {
      if (!injectedWrite && String(args[0]).endsWith('.after')) {
        injectedWrite = true;
        throw Object.assign(new Error('injected disk full'), { code: 'ENOSPC' });
      }
      return open(...args);
    };
    try { await assert.rejects(persistState(broken.runtime), /injected disk full/); }
    finally { fs.open = open; }
    assert.ok(injectedWrite);
    assert.equal(await fs.readFile(statePath, 'utf8'), beforeState);
    await persistState(broken.runtime);
    pass('directory, write, and rename failures reject; memory, disk, and outgoing messages stay committed; queue recovers');

    await failRename(notePath, async () => {
      await handleMessage(session, { type: 'saveNote', noteId: note.id, title: 'lost edit', body: 'lost body', sharing: note.sharing });
    });
    assert.equal(sent.at(-1)?.type, 'error');
    assert.equal(entry.store.notes.get(note.id)?.title, 'edited');
    assert.equal((await read(notePath)).title, 'edited');
    sent.length = 0;
    pass('the actual WS handler reports persistence failure after rollback');

    await mutateCampaign(broken, async (draft) => {
      draft.runtime.state.mapLocked = true;
      await persistState(draft.runtime);
    });
    const stateBackup = path.join(broken.runtime.dir, 'backups/.runtime/state.json');
    assert.equal(await fs.readFile(stateBackup, 'utf8'), beforeState);
    await saveNote(broken.store, note);
    assert.equal(await fs.readFile(stateBackup, 'utf8'), beforeState);
    pass('the previous runtime version remains backed up after unrelated note edits');

    for (const corrupt of ['{"board":[{"id":"precious-map"}],', '[]', '{"board":null}']) {
      await fs.writeFile(statePath, corrupt);
      await assert.rejects(loadRuntime(broken.store.dir), /could not load runtime state/);
      assert.equal(await fs.readFile(statePath, 'utf8'), corrupt);
    }
    const quarantine = path.join(tmp, 'campaigns/quarantined');
    await fs.mkdir(path.join(quarantine, '.runtime'), { recursive: true });
    await fs.writeFile(path.join(quarantine, 'campaign.json'), JSON.stringify({ ...entry.store.meta, id: 'quarantined' }));
    await fs.writeFile(path.join(quarantine, '.runtime/state.json'), '{broken');
    await scanCampaigns();
    assert.equal(getCampaign('quarantined'), undefined);
    entry = getCampaign('ordered')!;
    pass('malformed existing runtime is preserved and the campaign is quarantined on startup');

    const strict = await fixture('strict-loader');
    await saveChapter(strict.store, chapter);
    const strictBody = path.join(strict.store.dir, 'chapters/chapter.md');
    const readFile = fs.readFile;
    fs.readFile = (async (...args: Parameters<typeof fs.readFile>) => {
      if (String(args[0]) === strictBody) throw Object.assign(new Error('unreadable sidecar'), { code: 'EACCES' });
      return readFile(...args);
    }) as typeof fs.readFile;
    try { await assert.rejects(loadCampaign(strict.store.dir), /could not load entities/); }
    finally { fs.readFile = readFile; }
    assert.equal(await fs.readFile(strictBody, 'utf8'), chapter.body);
    await fs.mkdir(path.join(strict.store.dir, 'notes'));
    const badNote = path.join(strict.store.dir, 'notes/bad.json');
    await fs.writeFile(badNote, '{malformed');
    await assert.rejects(loadCampaign(strict.store.dir), /could not load entities/);
    assert.equal(await fs.readFile(badNote, 'utf8'), '{malformed');
    await fs.unlink(badNote);
    await fs.mkdir(path.join(strict.store.dir, 'assets'));
    const badManifest = path.join(strict.store.dir, 'assets/image.json');
    await fs.writeFile(badManifest, '{malformed manifest');
    await fs.writeFile(path.join(strict.store.dir, 'assets/image.png'), 'unchanged binary');
    await assert.rejects(loadCampaign(strict.store.dir), /could not read JSON/);
    assert.equal(await fs.readFile(badManifest, 'utf8'), '{malformed manifest');
    await fs.unlink(badManifest);
    await failRename(badManifest, async () => {
      await assert.rejects(loadCampaign(strict.store.dir), /injected rename failure/);
    });
    await absent(badManifest);
    assert.equal(await fs.readFile(path.join(strict.store.dir, 'assets/image.png'), 'utf8'), 'unchanged binary');
    pass('unreadable sidecars and malformed entities/manifests fail loading; auto-registration cannot hide persistence failure');

    const sidecars = await fixture('sidecars');
    await saveChapter(sidecars.store, chapter);
    const jsonPath = path.join(sidecars.store.dir, 'chapters/chapter.json');
    const markdownPath = path.join(sidecars.store.dir, 'chapters/chapter.md');
    await failRename(markdownPath, async () => {
      await assert.rejects(saveChapter(sidecars.store, { ...chapter, title: 'After', body: 'new body' }), /injected rename failure/);
    });
    assert.equal((await read(jsonPath)).title, 'Before');
    assert.equal(await fs.readFile(markdownPath, 'utf8'), 'old body');
    assert.equal(sidecars.store.chapters.get(chapter.id)?.title, 'Before');
    assert.equal((await loadCampaign(sidecars.store.dir))?.chapters.get(chapter.id)?.body, 'old body');
    await saveChapter(sidecars.store, { ...chapter, title: 'No body', body: '' });
    await saveChapter(sidecars.store, { ...chapter, title: 'Still no body', body: '' });
    assert.equal((await read(path.join(sidecars.runtime.dir, 'backups/chapters/chapter.json'))).title, 'No body');
    await absent(path.join(sidecars.runtime.dir, 'backups/chapters/chapter.md'));
    pass('failed second-sidecar installation restores the matching prior JSON and Markdown');

    for (const phase of ['partial', 'committed']) {
      const crashed = await fixture(`crash-${phase}`);
      await saveChapter(crashed.store, chapter);
      const child = spawn(process.execPath, ['--import', 'tsx', fileURLToPath(import.meta.url)], {
        env: { ...process.env, PERSISTENCE_CRASH_DIR: crashed.store.dir, PERSISTENCE_CRASH_PHASE: phase }, stdio: 'pipe',
      });
      let stderr = '';
      child.stderr.on('data', (data) => { stderr += String(data); });
      const exit = await new Promise<{ code: number | null; signal: string | null }>((resolve, reject) => {
        child.on('error', reject);
        child.on('exit', (code, signal) => resolve({ code, signal }));
      });
      assert.equal(exit.signal, 'SIGKILL', stderr);
      const recovered = (await loadCampaign(crashed.store.dir))!;
      const expected = phase === 'partial' ? chapter : { ...chapter, title: 'After', body: 'new body' };
      assert.equal(recovered.chapters.get(chapter.id)?.title, expected.title);
      assert.equal(recovered.chapters.get(chapter.id)?.body, expected.body);
      await absent(path.join(crashed.runtime.dir, 'pending-commit'));
    }
    pass('SIGKILL midway through sidecars restores old state; SIGKILL after commit preserves new state');

    const audio: AssetManifest = { type: 'asset', schemaVersion: SCHEMA_VERSIONS.asset, id: 'audio', file: 'audio.wav', title: 'Audio', mime: 'audio/wav', assetKind: 'document', ownerUsername: 'DM', sharing: { scope: 'private', userIds: [] }, tags: [], dmOnly: false, width: null, height: null };
    await saveAssetManifest(entry.store, audio);
    await Promise.all([
      handleMessage(session, { type: 'mediaControl', assetId: audio.id, action: 'play', time: 0 }),
      handleMessage(session, { type: 'mediaControl', assetId: audio.id, action: 'pause', time: 1 }),
    ]);
    assert.equal(entry.media?.action, 'pause');
    assert.equal(entry.store.assets.get(audio.id)?.sharing?.scope, 'all');
    pass('PLAY followed by PAUSE stays paused after asynchronous auto-sharing');

    const binary = path.join(entry.store.dir, 'assets', audio.file);
    await writeCampaignFile(entry.store.dir, binary, Buffer.from('test audio'));
    await failRename(path.join(entry.runtime.dir, 'state.json'), async () => {
      await assert.rejects(mutateCampaign(entry, async (draft) => {
        await deleteAssetFiles(draft.store, audio);
        draft.runtime.state.sharedDocumentIds = [];
        await persistState(draft.runtime);
      }), /injected rename failure/);
    });
    assert.equal(await fs.readFile(binary, 'utf8'), 'test audio');
    assert.ok(entry.store.assets.has(audio.id));
    assert.ok((await loadCampaign(entry.store.dir))?.assets.has(audio.id));
    pass('asset deletion is reversible when a later runtime write fails');

    let release!: () => void;
    let entered!: () => void;
    const paused = new Promise<void>((resolve) => { release = resolve; });
    const started = new Promise<void>((resolve) => { entered = resolve; });
    const delayed = mutateCampaign(entry, async (draft) => {
      draft.runtime.state.mapLocked = true;
      await persistState(draft.runtime);
      const message = { type: 'mapLockUpdated' as const, locked: true };
      send(session.ws, message);
      message.locked = false;
      entered();
      await paused;
    });
    await started;
    assert.equal(getCampaign('ordered')!.runtime.state.mapLocked, false);
    assert.equal(sent.length, 0);
    release();
    await delayed;
    assert.equal(entry.runtime.state.mapLocked, true);
    assert.deepEqual(sent.pop(), { type: 'mapLockUpdated', locked: true });
    pass('HTTP readers see committed memory; buffered payloads are serialized before mutable objects can change');

    const { initMembershipsStore, addMembership } = await import('../packages/server/src/auth/memberships.js');
    const { initUsersStore } = await import('../packages/server/src/auth/users.js');
    await initMembershipsStore();
    await initUsersStore();
    await addMembership('ordered', session.userId, 'dm');
    const joining: WsSession = { ...session, campaignId: null, role: null };
    const previous = mutateCampaign(entry, async (draft) => {
      draft.runtime.state.mapLocked = false;
      await persistState(draft.runtime);
    });
    const joined = handleMessage(joining, { type: 'join', campaignId: 'ordered', protocolVersion: PROTOCOL_VERSION });
    await Promise.all([previous, joined]);
    const snapshot = sent.find((msg) => msg.type === 'snapshot');
    assert.ok(snapshot && snapshot.type === 'snapshot');
    assert.equal(snapshot.mapLocked, false);
    pass('join snapshots wait for all previously accepted campaign commits');

    const fatalEvents: string[] = [];
    const closingSocket = {
      readyState: 1,
      send: (message: string) => { fatalEvents.push(JSON.parse(message).code); },
      close: () => { closingSocket.readyState = 3; fatalEvents.push('closed'); },
    };
    await handleMessage({ ...session, campaignId: null, role: null, ws: closingSocket as WsSession['ws'] }, {
      type: 'join', campaignId: 'ordered', protocolVersion: PROTOCOL_VERSION + 1,
    });
    assert.deepEqual(fatalEvents, ['PROTOCOL_MISMATCH', 'closed']);
    pass('a queued fatal JOIN sends its error before closing the socket');

    const final = mutateCampaign(entry, async (draft) => {
      draft.runtime.state.mapLocked = true;
      await persistState(draft.runtime);
    });
    await Promise.all([final, drainCampaigns()]);
    assert.equal((await read(path.join(entry.runtime.dir, 'state.json'))).mapLocked, true);
    await assert.rejects(mutateCampaign(entry, async () => {}), /shutting down/);
    pass('shutdown drains accepted commands and rejects new work');
    console.log(`Persistence regressions passed (${passed} scenarios).`);
  } finally {
    await closeWebSockets();
    await fs.rm(tmp, { recursive: true, force: true });
  }
}

main().catch((err: unknown) => { console.error(err); process.exitCode = 1; });
