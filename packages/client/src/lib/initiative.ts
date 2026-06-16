import type { InitiativeState, InitiativeEntry } from '@vtt/shared';

/** Entries in turn order: highest initiative first, name as a stable tiebreak. */
export function sortedInitiative(init: InitiativeState): InitiativeEntry[] {
  return [...init.entries].sort((a, b) => b.initiative - a.initiative || a.name.localeCompare(b.name));
}

/** The combatant whose turn it is (null when combat isn't running / empty). */
export function activeEntry(init: InitiativeState): InitiativeEntry | null {
  if (!init.active || init.entries.length === 0) return null;
  const order = sortedInitiative(init);
  const i = ((init.turnIndex % order.length) + order.length) % order.length;
  return order[i] ?? null;
}
