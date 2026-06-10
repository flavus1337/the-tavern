import { useState, useRef, type ReactNode, type PointerEvent, type WheelEvent } from 'react';
import type { AssetRef } from '@vtt/shared';
import { Button } from './ui/button';
import { useStore } from '../store';

interface ViewState {
  x: number;
  y: number;
  scale: number;
}

const SCALE_MIN = 0.1;
const SCALE_MAX = 8;

interface CanvasViewerProps {
  children?: ReactNode;
}

export function CanvasViewer({ children }: CanvasViewerProps) {
  const currentImage = useStore((s) => s.currentImage);

  const [view, setView] = useState<ViewState>({ x: 0, y: 0, scale: 1 });
  const dragging = useRef(false);
  const lastPointer = useRef<{ x: number; y: number }>({ x: 0, y: 0 });
  const containerRef = useRef<HTMLDivElement>(null);

  function clampScale(s: number): number {
    return Math.min(SCALE_MAX, Math.max(SCALE_MIN, s));
  }

  function fitToContainer(img: AssetRef) {
    const container = containerRef.current;
    if (!container) return;
    const { clientWidth: cw, clientHeight: ch } = container;
    const iw = img.width ?? 800;
    const ih = img.height ?? 600;
    const scale = clampScale(Math.min(cw / iw, ch / ih) * 0.95);
    const x = (cw - iw * scale) / 2;
    const y = (ch - ih * scale) / 2;
    setView({ x, y, scale });
  }

  function resetTo100() {
    const container = containerRef.current;
    if (!container) return;
    const { clientWidth: cw, clientHeight: ch } = container;
    const iw = currentImage?.width ?? 800;
    const ih = currentImage?.height ?? 600;
    const x = (cw - iw) / 2;
    const y = (ch - ih) / 2;
    setView({ x, y, scale: 1 });
  }

  function handlePointerDown(e: PointerEvent<HTMLDivElement>) {
    if (e.button !== 0) return;
    dragging.current = true;
    lastPointer.current = { x: e.clientX, y: e.clientY };
    (e.currentTarget as HTMLDivElement).setPointerCapture(e.pointerId);
  }

  function handlePointerMove(e: PointerEvent<HTMLDivElement>) {
    if (!dragging.current) return;
    const dx = e.clientX - lastPointer.current.x;
    const dy = e.clientY - lastPointer.current.y;
    lastPointer.current = { x: e.clientX, y: e.clientY };
    setView((v) => ({ ...v, x: v.x + dx, y: v.y + dy }));
  }

  function handlePointerUp() {
    dragging.current = false;
  }

  function handleWheel(e: WheelEvent<HTMLDivElement>) {
    e.preventDefault();
    const container = containerRef.current;
    if (!container) return;
    const rect = container.getBoundingClientRect();
    const mouseX = e.clientX - rect.left;
    const mouseY = e.clientY - rect.top;

    const factor = e.deltaY < 0 ? 1.1 : 0.9;
    setView((v) => {
      const newScale = clampScale(v.scale * factor);
      const scaleDelta = newScale / v.scale;
      const newX = mouseX - scaleDelta * (mouseX - v.x);
      const newY = mouseY - scaleDelta * (mouseY - v.y);
      return { x: newX, y: newY, scale: newScale };
    });
  }

  function handleDoubleClick() {
    if (currentImage) fitToContainer(currentImage);
  }

  // Fit on image load / image change
  function handleImageLoad() {
    if (currentImage) fitToContainer(currentImage);
  }

  return (
    <div
      ref={containerRef}
      className="relative flex-1 overflow-hidden bg-zinc-950 select-none"
      style={{ touchAction: 'none' }}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onPointerLeave={handlePointerUp}
      onWheel={handleWheel}
      onDoubleClick={handleDoubleClick}
      aria-label="Campaign map canvas"
    >
      {!currentImage ? (
        <EmptyCanvas />
      ) : (
        <div
          className="absolute top-0 left-0"
          style={{
            transform: `translate(${view.x}px, ${view.y}px) scale(${view.scale})`,
            transformOrigin: '0 0',
            willChange: 'transform',
          }}
        >
          <img
            src={currentImage.url}
            alt={currentImage.title}
            draggable={false}
            onLoad={handleImageLoad}
            className="block max-w-none"
            style={{
              width: currentImage.width ?? 'auto',
              height: currentImage.height ?? 'auto',
            }}
          />
          {children}
        </div>
      )}

      {/* Controls */}
      {currentImage && (
        <div className="absolute bottom-4 right-4 flex flex-col gap-1.5 z-10">
          <Button
            size="sm"
            variant="secondary"
            onClick={() => fitToContainer(currentImage)}
            title="Fit to screen"
            aria-label="Fit image to screen"
            className="px-2.5"
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="w-4 h-4">
              <path d="M4 8V4m0 0h4M4 4l5 5M20 8V4m0 0h-4m4 0l-5 5M4 16v4m0 0h4m-4 0l5-5M20 16v4m0 0h-4m4 0l-5-5" strokeLinecap="round" />
            </svg>
          </Button>
          <Button
            size="sm"
            variant="secondary"
            onClick={resetTo100}
            title="100% zoom"
            aria-label="Reset to 100% zoom"
            className="px-2.5 font-mono"
          >
            1:1
          </Button>
          <Button
            size="sm"
            variant="secondary"
            onClick={() => setView((v) => ({ ...v, scale: clampScale(v.scale * 1.25) }))}
            aria-label="Zoom in"
            className="px-2.5"
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="w-4 h-4">
              <circle cx="11" cy="11" r="8" /><path d="M21 21l-4.35-4.35M11 8v6M8 11h6" strokeLinecap="round" />
            </svg>
          </Button>
          <Button
            size="sm"
            variant="secondary"
            onClick={() => setView((v) => ({ ...v, scale: clampScale(v.scale / 1.25) }))}
            aria-label="Zoom out"
            className="px-2.5"
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="w-4 h-4">
              <circle cx="11" cy="11" r="8" /><path d="M21 21l-4.35-4.35M8 11h6" strokeLinecap="round" />
            </svg>
          </Button>
        </div>
      )}

      {/* Zoom indicator */}
      {currentImage && (
        <div className="absolute bottom-4 left-4 text-xs text-zinc-600 font-mono z-10">
          {Math.round(view.scale * 100)}%
        </div>
      )}
    </div>
  );
}

function EmptyCanvas() {
  return (
    <div className="absolute inset-0 flex items-center justify-center">
      {/* Subtle grid */}
      <svg className="absolute inset-0 w-full h-full opacity-5" xmlns="http://www.w3.org/2000/svg">
        <defs>
          <pattern id="grid" width="40" height="40" patternUnits="userSpaceOnUse">
            <path d="M 40 0 L 0 0 0 40" fill="none" stroke="#71717a" strokeWidth="0.5" />
          </pattern>
        </defs>
        <rect width="100%" height="100%" fill="url(#grid)" />
      </svg>
      <div className="relative text-center">
        <div className="w-16 h-16 rounded-2xl bg-zinc-900 border border-zinc-800 flex items-center justify-center mx-auto mb-3">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" className="w-8 h-8 text-zinc-700">
            <path d="m2.25 15.75 5.159-5.159a2.25 2.25 0 0 1 3.182 0l5.159 5.159m-1.5-1.5 1.409-1.409a2.25 2.25 0 0 1 3.182 0l2.909 2.909m-18 3.75h16.5a1.5 1.5 0 0 0 1.5-1.5V6a1.5 1.5 0 0 0-1.5-1.5H3.75A1.5 1.5 0 0 0 2.25 6v12a1.5 1.5 0 0 0 1.5 1.5Zm10.5-11.25h.008v.008h-.008V8.25Zm.375 0a.375.375 0 1 1-.75 0 .375.375 0 0 1 .75 0Z" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </div>
        <p className="text-zinc-600 font-medium">Nothing shared yet</p>
        <p className="text-zinc-700 text-sm mt-1">The DM will share a map when ready</p>
      </div>
    </div>
  );
}
