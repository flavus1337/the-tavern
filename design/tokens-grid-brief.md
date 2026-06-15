# Design brief: Tokens, Grid & Measurement

A feature brief for The Tavern (self-hosted D&D virtual tabletop). Hand this to
the designer. It describes *what* and *how it behaves*, not pixels — match the
existing Candlelight theme and board.

## What exists today (design must stay consistent with this)

- **The board** is a pan/zoom canvas with a warm lamp-glow background and a faint
  44px decorative grid. The DM pins images (maps, art, handouts) onto it as
  positioned items: each has x/y, width, z-order, and a per-item "players can
  move this" unlock. Items show a hover outline, a corner resize handle, a ✕
  remove (DM), and a bottom-left "Map · title" label chip.
- Pan and zoom are **per-player** (everyone shares the same board contents but
  looks from their own seat). The board state is server-authoritative and synced
  live; it persists across restarts.
- Theme "Candlelight": warm charcoal surfaces, **ember** primary accent, **gold**
  for crits, **garnet** for the DM / danger, **teal** for shared/connection,
  a display serif for names. Dark only.
- Roles: one **DM** (full control) and **players** (limited). Visibility and
  permissions are enforced server-side.

## Goal

Add **tokens** (movable pieces representing creatures) and a **real grid** they
snap to, plus a **measurement** tool — so the board works for tactical combat,
not just shared images.

Design principle: a token is a *kind of board item*, not a separate system. It
shares the board's positioning, drag, sync, and permission model. Design it as a
visually distinct item type, not a new screen.

---

## A. Tokens

**A1. Appearance.** A token is small and clearly different from a map image:
- Round by default (square as an option), with a colored **ring/border**.
- Shows a short **name label** below or on it.
- Can display an uploaded **image** (cropped to the shape) OR a fallback: a solid
  color disc with the name's initials.
- A **team color** drives the ring: player (e.g. blue), ally (green), enemy
  (garnet/red), neutral. Pick a small fixed palette; the DM sets it per token.
- Tokens render *above* map images on the board (own z-layer).

**A2. Sizes.** D&D creature sizes map to grid footprint: Tiny/Small/Medium = 1
cell, Large = 2×2, Huge = 3×3, Gargantuan = 4×4. The token's on-board size is
derived from its cell footprint × the grid cell size (see Grid). Design the
states for 1×1 and a multi-cell token.

**A3. Creating a token.** From the DM panel: name, team color, size, and either
upload/pick an image or use initials. Design the create/edit affordance. Tokens
should also be creatable quickly (a common action — combat has many).

**A4. Placement & movement.**
- DM can place, move, resize-by-size (not freeform px), and remove any token.
- A token can be **assigned to a player**; that player can move *their* token
  (reuses the existing per-item "players can move" idea, but scoped to ownership
  — a player moves only tokens assigned to them; the DM moves everything).
- Moving a token snaps to the grid when snapping is on (see Grid).
- Show clear hover/selected/drag states (ember outline consistent with map items;
  lift shadow on drag).

**A5. Token states to design.**
- Default, hover, selected, dragging.
- "Mine" vs "not mine" for a player (a player should see at a glance which tokens
  they control).
- A small **remove (✕)** and **edit** affordance on hover/select (DM; owner for
  their own token's position only).
- Optional: a tiny current/max **HP pip or bar** on the token — design it but
  treat as nice-to-have (it overlaps with the future initiative tracker; keep it
  visual-only here, no full HP editing UI on the token).

**A6. Empty/teaching state.** When the board has a map but no tokens, the DM
needs an obvious way to add the first token.

---

## B. Grid

**B1. Real, configurable grid.** Replace the fixed decorative 44px grid with a
DM-configurable one in **board-space** (so it scales with zoom and aligns to
tokens):
- Cell size (board units), on/off toggle, line color/opacity within the theme.
- Optional grid **offset** (nudge origin to line up with a map image's own grid).
- DM-only controls; the grid is shared (everyone sees the same grid).

**B2. Snapping.** A snapping toggle (DM-level). When on, token drops snap to the
nearest cell (token center to cell center, or footprint to cell corners for
multi-cell tokens). Map images stay freeform regardless — snapping is a token
behavior. Design the snap feedback (e.g. token settling into a cell).

**B3. Calibration.** The DM needs to align the grid to an uploaded map's printed
grid. Design a simple way to set cell size/offset to match (e.g. drag to size one
cell over the map, or numeric inputs). Keep it minimal.

---

## C. Measurement

**C1. Measure distance.** A measurement mode/tool: drag from a start point (a
token or empty cell) to an end point; show a **line** and a **distance label**
(in cells and feet — default **5 ft / cell**, DM-configurable).
- Available to everyone (players measure their own reach/movement).
- The measurement is **transient and local** by default (only the person
  measuring sees it) — design that. Optionally a "show to table" so the DM can
  demonstrate range; treat as nice-to-have.
- Snap measurement endpoints to grid cells when snapping is on.
- Design the line + label in the Candlelight style (ember line, mono distance
  label).

**C2. Movement diagonals.** Note for the spec, not necessarily a visible control:
distance counting can be "every cell = 5 ft" (simple) or 5-10-5 diagonal. Default
to the simple rule; don't design a setting unless trivial.

---

## Theme & layout constraints

- Everything in the Candlelight palette and type system already in the app.
- New DM controls live in the existing right **DM sidebar tab** (it already holds
  Assets / Invites / upload-lock). Add token + grid controls there; don't invent
  a new top-level area.
- The measurement tool and a snapping toggle want a small, always-reachable spot
  on the board itself (near the existing zoom % indicator, bottom corner).
- Mobile: the app is responsive (sidebar becomes a bottom panel under ~768px).
  Tokens/measure should degrade sanely on touch but full tactical play assumes a
  desktop; don't over-invest in mobile token editing.

## Explicitly OUT of scope (do not design these now)

- Token vision / dynamic lighting / line-of-sight. (That's fog-of-war territory,
  a separate roadmap item.)
- Conditions/status icons on tokens, initiative order, turn tracking — these
  belong to the future **initiative & condition tracker**; keep tokens visual.
- Auras, token rotation, freeform token resize, token "decks"/folders, animated
  tokens.
- Full HP management UI on the token (see A5 — a passive bar at most).

## Open questions for the designer to resolve or flag

1. Token shape default: round vs square — and how the image is masked.
2. Where the name label sits at small zoom (below the token vs tooltip on hover).
3. Multi-cell token resize affordance (drag a corner across cells vs a size
   dropdown — prefer the dropdown for simplicity).
4. How a player visually distinguishes "my token" from others (ring style? a
   subtle "you" marker?).
5. Grid calibration interaction (drag-one-cell vs numeric) — pick the simpler one.

## Deliverable

Mock-ups of: the board with a map + a mix of player/enemy tokens (1×1 and a
multi-cell), token hover/selected/drag states, the create/edit-token control, the
DM grid+snap controls in the sidebar, the on-board snap toggle + zoom area, and an
active measurement (line + distance label). Same format as the previous
"Candlelight" handoff (HTML prototype + tokens/notes) is ideal.
