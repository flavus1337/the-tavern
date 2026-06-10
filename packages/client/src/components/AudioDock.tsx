import { useEffect, useRef, useState } from 'react';
import type { ClientMessage } from '@vtt/shared';
import { useStore } from '../store';

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
  const closeAudioDock = useStore((s) => s.closeAudioDock);
  const setAudioDockMinimized = useStore((s) => s.setAudioDockMinimized);

  const audioRef = useRef<HTMLAudioElement>(null);
  const applyingRemote = useRef(false);
  const [needsGesture, setNeedsGesture] = useState(false);
  const [playing, setPlaying] = useState(false);
  const [position, setPosition] = useState(0);
  const [duration, setDuration] = useState(0);
  const [volume, setVolume] = useState(0.8);

  const doc = dock ? documents.find((d) => d.id === dock.assetId) : undefined;
  const campaignId = useStore((s) => s.activeCampaignId);
  const canDrive = !!doc && (self?.role === 'dm' || doc.ownerUsername === self?.username);
  const url = doc ? `/api/campaigns/${campaignId}/files/assets/${doc.file}` : '';

  function emit(action: 'play' | 'pause' | 'stop', time?: number) {
    if (!canDrive || applyingRemote.current || !doc) return;
    const conn = (window as unknown as { __vttConn?: { send: (msg: ClientMessage) => void } }).__vttConn;
    conn?.send({ type: 'mediaControl', assetId: doc.id, action, time: time ?? audioRef.current?.currentTime ?? 0 });
  }

  function syncedTime(cmd: { action: string; time: number; atMs: number }): number {
    return cmd.action === 'play' ? cmd.time + (Date.now() - cmd.atMs) / 1000 : cmd.time;
  }

  // Follow the table-playback state.
  useEffect(() => {
    const audio = audioRef.current;
    if (!audio || !sync || sync.action === 'stop') return;
    applyingRemote.current = true;
    const target = syncedTime(sync);
    if (Math.abs(audio.currentTime - target) > 1.5) audio.currentTime = target;
    const done = () => setTimeout(() => { applyingRemote.current = false; }, 150);
    if (sync.action === 'play') {
      audio.play().then(() => { setNeedsGesture(false); done(); }).catch(() => { setNeedsGesture(true); done(); });
    } else {
      audio.pause();
      setNeedsGesture(false);
      done();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sync]);

  // Keep element volume in sync with the (local-only) slider.
  useEffect(() => {
    if (audioRef.current) audioRef.current.volume = volume;
  }, [volume]);

  function joinPlayback() {
    const audio = audioRef.current;
    if (!audio || !sync) return;
    applyingRemote.current = true;
    audio.currentTime = syncedTime(sync);
    audio.play().catch(() => undefined).finally(() => {
      setTimeout(() => { applyingRemote.current = false; }, 150);
    });
    setNeedsGesture(false);
  }

  function togglePlay() {
    const audio = audioRef.current;
    if (!audio) return;
    if (audio.paused) {
      audio.play().catch(() => undefined);
      emit('play');
    } else {
      audio.pause();
      emit('pause');
    }
  }

  function seekTo(t: number) {
    const audio = audioRef.current;
    if (!audio) return;
    audio.currentTime = t;
    emit(audio.paused ? 'pause' : 'play', t);
  }

  function stopForTable() {
    audioRef.current?.pause();
    emit('stop', 0);
    closeAudioDock();
  }

  if (!dock || !doc) return null;
  const minimized = dock.minimized;

  return (
    <div
      style={{
        position: 'absolute',
        bottom: 12,
        left: '50%',
        transform: 'translateX(-50%)',
        zIndex: 25,
        width: minimized ? 'auto' : 'min(520px, calc(100% - 32px))',
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
        onEnded={() => { setPlaying(false); if (canDrive) emit('pause', 0); }}
      />

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
                disabled={connection !== 'open'}
                style={{
                  width: 34, height: 34, borderRadius: '50%', flexShrink: 0,
                  background: 'var(--ember)', color: 'var(--ink)', border: 'none',
                  cursor: 'pointer', fontSize: 13, display: 'flex', alignItems: 'center', justifyContent: 'center',
                }}
                aria-label={playing ? 'Pause for the table' : 'Play for the table'}
              >
                {playing ? '❚❚' : '▶'}
              </button>
              <span style={{ fontFamily: 'var(--mono)', fontSize: 10, color: 'var(--faint)', flexShrink: 0 }}>
                {fmt(position)}
              </span>
              <input
                type="range"
                min={0}
                max={duration || 0}
                step={0.1}
                value={Math.min(position, duration || 0)}
                onChange={(e) => seekTo(Number(e.target.value))}
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
      {!minimized && needsGesture && (
        <button
          type="button"
          onClick={joinPlayback}
          style={{
            display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
            padding: '9px 12px', fontSize: 13, fontWeight: 600,
            background: 'var(--ember)', color: 'var(--ink)',
            border: 'none', borderRadius: 9, cursor: 'pointer',
          }}
        >
          ▶ Join playback
        </button>
      )}
    </div>
  );
}
