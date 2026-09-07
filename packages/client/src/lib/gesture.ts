/** Tracks previews across overlapping commands and clicks that produce no command. */
export function gestureLifecycle(reset: () => void) {
  let generation = 0;
  let active = false;
  const pending = new Set<number>();
  return {
    begin() { generation++; active = true; },
    finish() { active = false; if (!pending.size) reset(); },
    reconcile() { generation++; active = false; pending.clear(); reset(); },
    submitted() {
      const current = generation;
      active = false;
      pending.add(current);
      return () => {
        if (!pending.delete(current)) return; // A snapshot already superseded this command.
        if (!active && (generation === current || !pending.size)) reset();
      };
    },
  };
}
