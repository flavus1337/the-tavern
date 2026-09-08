import { useEffect, useRef, useState } from 'react';

/** Latest input is available synchronously; rendering runs at most once per frame. */
export function frameValue<T>(initial: T, publish: (value: T) => void) {
  let current = initial;
  let frame: number | null = null;
  let published = initial;
  const apply = () => { if (!Object.is(current, published)) { published = current; publish(current); } };
  const cancel = () => { if (frame !== null) cancelAnimationFrame(frame); frame = null; };
  const flush = () => { cancel(); apply(); };
  return {
    get current() { return current; },
    set(next: T | ((value: T) => T)) {
      const value = typeof next === 'function' ? (next as (value: T) => T)(current) : next;
      if (Object.is(value, current)) return;
      current = value;
      if (frame === null) frame = requestAnimationFrame(() => { frame = null; apply(); });
    },
    flush,
    cancel,
  };
}

export function useFrameValue<T>(initial: T, publish: (value: T) => void) {
  const publishRef = useRef(publish);
  publishRef.current = publish;
  const ref = useRef<ReturnType<typeof frameValue<T>> | null>(null);
  if (!ref.current) ref.current = frameValue(initial, (value) => publishRef.current(value));
  useEffect(() => () => ref.current!.cancel(), []);
  return ref.current;
}

export function useFrameState<T>(initial: T) {
  const [state, publish] = useState(initial);
  const frame = useFrameValue(initial, publish);
  return [state, frame] as const;
}
