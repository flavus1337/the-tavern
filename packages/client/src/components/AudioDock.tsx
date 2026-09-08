import { useEffect, useRef, useState } from 'react';
import { useStore } from '../store';
import { playbackPosition } from '../lib/media';
import { SaveFeedback, useSaveCommand } from './SaveFeedback';

function fmt(t: number): string {
  if (!Number.isFinite(t)) return '0:00';
  const m = Math.floor(t / 60);
  const s = Math.floor(t % 60);
  return `${m}:${String(s).padStart(2, '0')}`;
}

/**
 * Bottom-docked audio player. The track's owner/DM gets full transport and
 * drives the whole table; everyone else sees what's playing and controls only
 * their own volume. Minimisable to a small pill; playback continues.
 */
export function AudioDock() {
  const dock = useStore((s) => s.audioDock);
  const documents = useStore((s) => s.documents);
  const self = useStore((s) => s.self);
  const connection = useStore((s) => s.connection);
  const sync = useStore((s) => (dock ? s.mediaSync[dock.assetId] : undefined));
  const clockOffsetMs = useStore((s) => s.clockOffsetMs);
  const setAudioDockMinimized = useStore((s) => s.setAudioDockMinimized);

  const audioRef = useRef<HTMLAudioElement>(null);
  const gestureBlocked = useRef(false);
  const followRef = useRef<() => void>(() => {});
  const save = useSaveCommand();
  const [playbackError, setPlaybackError] = useState<string | null>(null);
  const [seekPreview, setSeekPreview] = useState<number | null>(null);
  const [needsGesture, setNeedsGesture] = useState(false);
  const [playing, setPlaying] = useState(false);
  const [position, setPosition] = useState(0);
  const [duration, setDuration] = useState(0);
  const [volume, setVolume] = useState(0.8);

  const doc = dock ? documents.find((d) => d.id === dock.assetId) : undefined;
  const campaignId = useStore((s) => s.activeCampaignId);
  const canDrive = !!doc && (self?.role === 'dm' || doc.ownerUsername === self?.username);
  const url = doc ? `/api/campaigns/${campaignId}/files/assets/${doc.file}` : '';

  async function emit(action: 'play' | 'pause' | 'stop', time?: number) {
    if (!canDrive || !doc) return;
    const ack = await save.run({ type: 'mediaControl', assetId: doc.id, action, time: time ?? audioRef.current?.currentTime ?? 0 });
    if (!ack) followRef.current();
    return ack;
  }

  // Every browser, including the controller, follows the accepted server timeline.
  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;
    let alive = true;
    function follow(force = false) {
      if (!sync || clockOffsetMs === null || connection !== 'open') { audio!.pause(); return; }
      const end = Number.isFinite(audio!.duration) ? audio!.duration : Infinity;
      const target = Math.min(end, playbackPosition(sync, clockOffsetMs));
      if (audio!.readyState >= 1 && (force || Math.abs(audio!.currentTime - target) > 0.25)) audio!.currentTime = target;
      if (sync.action !== 'play' || target >= end) {
        audio!.pause(); gestureBlocked.current = false; setNeedsGesture(false);
      } else if (audio!.paused && !gestureBlocked.current) {
        void audio!.play().then(() => {
          if (alive) { setNeedsGesture(false); setPlaybackError(null); }
        }).catch((error: unknown) => {
          if (!alive || (error as { name?: string }).name === 'AbortError') return;
          gestureBlocked.current = true;
          setNeedsGesture(true);
        });
      }
    }
    const reconcile = () => follow(true);
    followRef.current = reconcile;
    reconcile();
    const timer = setInterval(() => follow(), 1000);
    const onVisible = () => { if (document.visibilityState === 'visible') reconcile(); };
    audio.addEventListener('loadedmetadata', reconcile);
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      alive = false;
      clearInterval(timer);
      audio.removeEventListener('loadedmetadata', reconcile);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [sync, clockOffsetMs, connection, url]);

  useEffect(() => {
    setPosition(0); setDuration(0); setSeekPreview(null); setPlaybackError(null);
  }, [url]);

  // Volume belongs to this browser, never to the shared playhead.
  useEffect(() => { if (audioRef.current) audioRef.current.volume = volume; }, [volume, url]);

  function joinPlayback() {
    if (sync?.action !== 'play' || clockOffsetMs === null || connection !== 'open') return;
    const audio = audioRef.current;
    if (!audio) return;
    followRef.current();
    void audio.play().then(() => {
      gestureBlocked.current = false;
      setNeedsGesture(false); setPlaybackError(null);
      followRef.current();
    }).catch(() => { setNeedsGesture(true); });
  }

  function togglePlay() {
    const audio = audioRef.current;
    if (!audio) return;
    if (sync?.action === 'play') {
      void emit('pause');
    } else {
      // Preserve user activation for the controller; the accepted echo reconciles it.
      void audio.play().catch((error: unknown) => {
        if ((error as { name?: string }).name === 'AbortError') return;
        gestureBlocked.current = true; setNeedsGesture(true);
      });
      void emit('play');
    }
  }

  async function seekTo(t: number) {
    if (await emit(sync?.action === 'play' ? 'play' : 'pause', t)) setSeekPreview(null);
  }

  function stopForTable() { void emit('stop', 0); }

  if (!dock || !doc) return null;
  const minimized = dock.minimized;
  const controlsDisabled = connection !== 'open' || save.saving || save.blocked;
  const tablePlaying = sync?.action === 'play';

  return (
    <div
      style={{
        position: 'absolute',
        bottom: 12,
        left: '50%',
        transform: 'translateX(-50%)',
        zIndex: 25,
        width: minimized && !needsGesture && !save.error ? 'auto' : 'min(520px, calc(100% - 32px))',
        background: 'var(--surface2)',
        border: '1px solid var(--border)',
        borderRadius: 11,
        boxShadow: '0 24px 60px -16px #000e',
        padding: minimized ? '7px 12px' : '10px 14px',
        display: 'flex',
        flexDirection: 'column',
        gap: 8,
      }}
    >
      <audio
        ref={audioRef}
        src={url}
        preload="metadata"
        onPlay={() => setPlaying(true)}
        onPause={() => setPlaying(false)}
        onTimeUpdate={() => setPosition(audioRef.current?.currentTime ?? 0)}
        onDurationChange={() => setDuration(audioRef.current?.duration ?? 0)}
        onEnded={() => { setPlaying(false); if (canDrive && connection === 'open') void emit('pause', audioRef.current?.duration ?? 0); }}
        onError={() => setPlaybackError('Could not load this audio. Check that the file is available and try again.')}
      />

      <SaveFeedback save={save} conflicts={[]} latest={{}} onUseTable={() => {}} onKeepChanges={() => {}} />
      {playbackError && <p role="alert" className="text-xs" style={{ color: 'var(--garnet)' }}>{playbackError}</p>}
      {/* Header row — always visible */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, minWidth: 0 }}>
        {/* Music note / playing indicator */}
        <span style={{ color: playing ? 'var(--ember)' : 'var(--low)', flexShrink: 0, fontSize: 15 }} aria-hidden="true">
          {playing ? '♫' : '♪'}
        </span>
        <span
          style={{
            fontFamily: 'var(--serif)', fontSize: 14, fontWeight: 600, color: 'var(--hi)',
            whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', minWidth: 0,
            maxWidth: minimized ? 180 : undefined, flex: minimized ? undefined : 1,
          }}
        >
          {doc.title}
        </span>
        {!minimized && (
          <span style={{ fontFamily: 'var(--mono)', fontSize: 10, color: 'var(--faint)', flexShrink: 0 }}>
            {canDrive ? 'you control the table' : `played by ${doc.ownerUsername ?? 'the DM'}`}
          </span>
        )}

        {/* Minimize / expand */}
        <button
          type="button"
          onClick={() => setAudioDockMinimized(!minimized)}
          style={{ background: 'none', border: 'none', color: 'var(--low)', cursor: 'pointer', padding: 4, flexShrink: 0, fontSize: 12, lineHeight: 1 }}
          aria-label={minimized ? 'Expand player' : 'Minimize player'}
          title={minimized ? 'Expand' : 'Minimize'}
        >
          {minimized ? '▴' : '▾'}
        </button>

        {/* Stop & close — controller only */}
        {canDrive && !minimized && (
          <button
            type="button"
            onClick={stopForTable}
            disabled={controlsDisabled}
            style={{ background: 'none', border: 'none', color: 'var(--low)', cursor: 'pointer', padding: 4, flexShrink: 0, fontSize: 13, lineHeight: 1 }}
            aria-label="Stop for the table and close"
            title="Stop for everyone"
          >
            ✕
          </button>
        )}
      </div>

      {/* Controls row */}
      {!minimized && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          {canDrive ? (
            <>
              <button
                type="button"
                onClick={togglePlay}
                disabled={controlsDisabled}
                style={{
                  width: 34, height: 34, borderRadius: '50%', flexShrink: 0,
                  background: 'var(--ember)', color: 'var(--ink)', border: 'none',
                  cursor: 'pointer', fontSize: 13, display: 'flex', alignItems: 'center', justifyContent: 'center',
                }}
                aria-label={tablePlaying ? 'Pause for the table' : 'Play for the table'}
              >
                {tablePlaying ? '❚❚' : '▶'}
              </button>
              <span style={{ fontFamily: 'var(--mono)', fontSize: 10, color: 'var(--faint)', flexShrink: 0 }}>
                {fmt(position)}
              </span>
              <input
                type="range"
                min={0}
                max={duration || 0}
                step={0.1}
                value={Math.min(seekPreview ?? position, duration || 0)}
                disabled={controlsDisabled}
                onChange={(e) => setSeekPreview(Number(e.target.value))}
                onPointerUp={(e) => { void seekTo(Number(e.currentTarget.value)); }}
                onPointerCancel={() => setSeekPreview(null)}
                onKeyUp={(e) => { if (['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End', 'PageUp', 'PageDown'].includes(e.key)) void seekTo(Number(e.currentTarget.value)); }}
                onBlur={(e) => { if (seekPreview !== null && !controlsDisabled) void seekTo(Number(e.currentTarget.value)); }}
                style={{ flex: 1, accentColor: 'var(--ember)', minWidth: 60 }}
                aria-label="Seek"
              />
              <span style={{ fontFamily: 'var(--mono)', fontSize: 10, color: 'var(--faint)', flexShrink: 0 }}>
                {fmt(duration)}
              </span>
            </>
          ) : (
            <span style={{ fontSize: 12, color: 'var(--mid)', flex: 1 }}>
              {playing ? 'Playing for the table…' : 'Paused'}
            </span>
          )}

          {/* Volume — local for everyone */}
          <span style={{ color: 'var(--low)', fontSize: 12, flexShrink: 0 }} aria-hidden="true">🔊</span>
          <input
            type="range"
            min={0}
            max={1}
            step={0.02}
            value={volume}
            onChange={(e) => setVolume(Number(e.target.value))}
            style={{ width: 80, accentColor: 'var(--teal)', flexShrink: 0 }}
            aria-label="Your volume"
            title="Your volume (only affects you)"
          />
        </div>
      )}

      {/* Autoplay-blocked join */}
      {needsGesture && (
        <button
          type="button"
          onClick={joinPlayback}
          disabled={connection !== 'open' || clockOffsetMs === null}
          style={{
            display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
            padding: '9px 12px', fontSize: 13, fontWeight: 600,
            background: 'var(--ember)', color: 'var(--ink)',
            border: 'none', borderRadius: 9, cursor: 'pointer',
          }}
        >
          ▶ Join audio
        </button>
      )}
    </div>
  );
}
