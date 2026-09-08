import { useLayoutEffect, useRef, useState } from 'react';

export function clampPanel(position: { x: number; y: number }, panel: { width: number; height: number }, bounds: { width: number; height: number }) {
  const axis = (value: number, size: number, available: number) => {
    const inset = Math.min(8, Math.max(0, (available - size) / 2));
    return Math.max(inset, Math.min(value, available - size - inset));
  };
  return { x: axis(position.x, panel.width, bounds.width), y: axis(position.y, panel.height, bounds.height) };
}

/** Floating coordinates belong to the board container, including after a drawer or resize changes it. */
export function usePanelPosition(stackIndex: number) {
  const panelRef = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState({ x: 16 + (stackIndex % 5) * 28, y: 16 + (stackIndex % 5) * 20 });
  const move = (x: number, y: number) => {
    const panel = panelRef.current, parent = panel?.parentElement;
    if (!panel || !parent) return;
    const next = clampPanel({ x, y }, { width: panel.offsetWidth, height: panel.offsetHeight }, { width: parent.clientWidth, height: parent.clientHeight });
    setPos((previous) => previous.x === next.x && previous.y === next.y ? previous : next);
  };
  useLayoutEffect(() => {
    const panel = panelRef.current, parent = panel?.parentElement;
    if (!panel || !parent) return;
    const clamp = () => setPos((previous) => {
      const next = clampPanel(previous, { width: panel.offsetWidth, height: panel.offsetHeight }, { width: parent.clientWidth, height: parent.clientHeight });
      return previous.x === next.x && previous.y === next.y ? previous : next;
    });
    clamp();
    const observer = new ResizeObserver(clamp);
    observer.observe(parent); observer.observe(panel);
    // Wait for the drawer-close render; a hidden trigger cannot retain focus.
    // Run once on mount, never when a remote update changes an existing draft.
    const focusFrame = requestAnimationFrame(() => {
      const input = panel.querySelector<HTMLElement>('input:not([type="file"]):not([type="hidden"]):not([disabled]), textarea:not([disabled])');
      (input ?? panel).focus({ preventScroll: true });
    });
    return () => { observer.disconnect(); cancelAnimationFrame(focusFrame); };
  }, []);
  return { panelRef, pos, move };
}
