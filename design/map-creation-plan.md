# Map Creation ("Build Mode") — Implementation Plan

Status: **proposed, awaiting approval**. Target image provider: **Google Gemini (Imagen)**. Generation env var: **`LLM_API_KEY`** (provider-agnostic; the design's `TAVERN_AI_KEY` is renamed to this everywhere).

---

## 1. Goal & scope

A DM "build mode" for authoring battle maps before a session: set a background, stamp terrain & props onto the 5 ft grid, scale/rotate props, organize in layers, optionally generate art with AI, and save a reusable template. A `Build ⇄ Play` switch flips between authoring and the lit board the party plays on. **Dark "Candlelight" chrome; bright illustrated map content.**

### In scope (this initiative, phased)
- Build/Play mode toggle (DM-only) + editor chrome (top bar, tool dock, docked inspector).
- **Map pieces**: placed terrain/props (image stamps) with snap-to-grid, free scale & rotate, layers.
- Backgrounds: presets + upload (+ grid calibrate) + AI generation.
- AI generation gated on `LLM_API_KEY` (Gemini), with upload fallback when absent.
- Save / load **map templates** (reusable across sessions).

### Explicitly deferred (call them v2 — flagged below, not built unless you say so)
- **Fog of war** (painted hidden cells) — meaningful complexity, not required to *create* a map.
- **Wall collision / line-of-sight** — depends on a wall data model + runtime geometry; large.
- **Undo/redo** — nice but not blocking; a lazy version can come later.
- Realtime multi-DM conflict resolution beyond last-write-wins (single DM is the norm).

> Rationale: fog + walls are ~half the total effort and the riskiest. Shipping authoring (place/scale/rotate/background/generate/save) first gives a usable tool fast; fog/walls layer on cleanly afterward.

---

## 2. Architecture decisions

1. **Reuse the existing canvas, don't fork it.** `CanvasViewer` already does pan/zoom, the grid layer, snap-to-cell (`snapTo`), drag-to-move, drag-to-resize (board items), z-order, and optimistic-update-until-server-echo. Build mode adds tools + a new content type on the *same* transform stage. (`packages/client/src/components/CanvasViewer.tsx`)

2. **New content type: `pieces` (map pieces), separate from `board` and `tokens`.**
   - `board` (existing) = background image(s). We **reuse it as the Background layer** — no new model for backgrounds.
   - `tokens` (existing) = creatures (play-mode, ownership/HP/sharing). Untouched.
   - `pieces` (new) = terrain & props: an image stamp at a transform, visible to everyone, **editable only by the DM in build mode**. Not `dmOnly` (they're the visible map); fog hides things later.
   - Why not overload `board`? Props need rotation + grid-lock + layer semantics that would muddy the play-mode board model. A dedicated collection that *reuses the same rendering/drag code* is cleaner and lower-risk.

3. **Build mode is DM-only and client-local.** The `Build ⇄ Play` switch is local UI state (like `boardTool`); it doesn't change what players see. Players always see the rendered map (background + pieces, later minus fog).

4. **Layers = a fixed set of z-bands + visibility**, not a compositing engine. `Background` (board, z < 0 band) · `Props & terrain` (pieces) · `Fog` (later). The layers panel toggles visibility/active layer; it does not need blend modes or arbitrary nesting. (Ponytail: no layer tree.)

5. **AI generation is a server capability gated on `LLM_API_KEY`.** The platform owns the style (system prompt); the user supplies only the subject. The client learns whether it's enabled from a new snapshot `features` flag.

---

## 3. Data model & protocol additions

### `MapPiece` (shared `protocol.ts` + server `runtime.ts`)
```ts
interface MapPiece {
  id: string;
  assetId: string;        // image asset (palette piece, generated, or uploaded)
  x: number; y: number;   // board-space top-left
  w: number; h: number;   // px size (h respects aspect unless free-resized)
  rotation: number;       // degrees
  z: number;
  layer: 'terrain' | 'props';  // terrain snaps to grid; props free
  lockedToGrid: boolean;  // terrain/walls true; props false
}
```
Lenient migration: absent `pieces` → `[]`; bump `PROTOCOL_VERSION` 5 → 6.

### Client → Server messages (all DM-only)
- `pieceAdd` { assetId, x, y, w, h, rotation, layer, lockedToGrid }
- `pieceMove` { id, x, y }
- `pieceUpdate` { id, w?, h?, rotation?, layer?, z? }
- `pieceRemove` { id }
- `setMapMeta` { name?, areaTag? }  (top-bar map name + area tag)
- (Background reuses existing `boardAdd`/`boardMove`/`boardRemove`.)
- AI generation goes over **HTTP** (POST, returns image bytes/asset), not WS — see §6.

### Server → Client
- `piecesUpdated` { pieces: MapPiece[] } (broadcast to all; visible to everyone)
- Snapshot gains: `pieces: MapPiece[]`, `mapMeta: { name, areaTag }`, and `features: { imageGenEnabled: boolean }`.

### Runtime persistence
- `RuntimeState` gains `pieces: MapPiece[]` and `mapMeta`. Reuses the existing atomic `persistState` queue. (`packages/server/src/campaign/runtime.ts`)

---

## 4. Server changes

- `protocol.ts` / `campaign.ts`: types above; `PROTOCOL_VERSION = 6`.
- `runtime.ts`: `pieces` + `mapMeta` in state + lenient load migration.
- `ws/handlers.ts`: `handlePieceAdd/Move/Update/Remove`, `handleSetMapMeta` (all `role === 'dm'` gated), `broadcastPiecesUpdated`. Mirror the board handlers exactly.
- `ws/snapshot.ts`: include `pieces`, `mapMeta`, `features.imageGenEnabled` (`= config.LLM_API_KEY != null`).
- `config.ts`: add `LLM_API_KEY` and `LLM_PROVIDER` (default `'gemini'`).
- **New** `http/generate.ts`: `POST /api/campaigns/:id/generate` (DM-only) → calls Gemini, returns N images; `POST /api/campaigns/:id/generate/save` → re-encode chosen image via `sharp`, persist as an `AssetManifest` (reusing `saveAssetManifest`), return it. See §6.

---

## 5. Client changes

- **Store**: `pieces`, `mapMeta`, `features` in state + `applySnapshot`; `editorMode: 'build' | 'play'`; extend `boardTool` with `'stamp' | 'wall' | 'fill' | 'erase' | 'fog'`; `selectedPieceId`; `activePalettePiece` (ghost to stamp); `activeLayer`. (`store.ts`)
- **Connection**: dispatch `piecesUpdated`. (`ws/connection.ts`)
- **CanvasViewer**: render `pieces` on the stage (new `PieceEl`, adapted from `BoardItemEl` + `TokenEl` — adds **rotation** + 8-handle bounding box + rotate grip + size chip). Stamp ghost that snaps to cell; click to plant; ⌥ to free-place. Tool dock gains the build tools (only in build mode).
- **Editor chrome** (new components): top-bar `Build ⇄ Play` segmented switch, map name + area tag, grid chip, undo/redo (stub initially); **docked inspector** (312px) shown in build mode containing: selected-piece card (size slider, S/M/L/H presets, rotate, lock-aspect) · asset palette (search, categories, tiles, favorites) · layer stack.
- **AI generator dialogs** (`PropGen`, `BgGen`): exact design — locked style recipe card, prompt textarea, 4-takes grid with re-roll, "Add to palette" / "Use as background", `or` upload fallback, garnet lock banner when `!features.imageGenEnabled` (text references **`LLM_API_KEY`**).
- Match Candlelight tokens + the inked palette from the handoff; reuse `Button`/`Input`/`Tabs`/`Dialog` primitives.

---

## 6. AI generation (Gemini-first, provider-agnostic seam)

- **Server module** `services/imagegen.ts` with one interface `generateImages(subject, kind: 'prop'|'background', n)`. First impl: Gemini. `LLM_PROVIDER` switches impls later (OpenAI/xAI).
- **Style is server-owned.** Fixed system/style prompt per kind (e.g. background: "top-down battlemap, hand-inked outline, grid-ready, fit to canvas, daylight"); the user subject is appended. The UI shows these as read-only chips.
- **Flow**: DM clicks Generate → `POST /generate` returns 4 image candidates (data URLs or temp ids) → DM picks one (+ optional per-tile re-roll = 1 more call) → `POST /generate/save` re-encodes via `sharp` → `AssetManifest` (assetKind `'art'` for backgrounds → pinned via `boardAdd`; `'token'`/prop for props → added to palette) → appears in palette/board.
- **Gating**: when `LLM_API_KEY` absent, `features.imageGenEnabled=false` → dialogs show the lock banner and promote upload. Upload path always works.
- **Cost**: 4 takes = 4 images (~$0.02 each on Imagen 4 Fast ≈ $0.08/generate). Cheap, but we cap re-rolls and show a count.

### ⚠️ Open risk — transparent prop cut-outs
Props need **transparent** PNGs. Imagen/Gemini image output is typically **opaque**. Mitigations, in order of laziness:
1. **Ship background generation first** (no transparency needed) — lower risk, high value.
2. For props: generate on a flat key-color background + server-side background removal (`sharp` can't segment; would need a rembg-style step or a "white background" + simple chroma key — imperfect).
3. Defer AI **prop** generation; allow prop generation only via upload of transparent PNGs initially.

Recommendation: **Phase E ships background generation; prop generation is gated behind resolving transparency** (verify Gemini alpha support during that phase; fall back to upload-only for props if it can't do clean cut-outs).

---

## 7. Phased delivery

Each phase is independently shippable, verified (typecheck + build + smoke + browser), and committed.

| Phase | Deliverable | Notes |
|---|---|---|
| **A — Foundation + pieces** | Build/Play switch, editor chrome, tool dock, docked inspector; `pieces` model end-to-end (place/move/scale/rotate/delete, snap-to-grid, layers panel, live sync, persistence). A **small built-in starter palette** (see open Q). | The core editing loop. Biggest phase. |
| **B — Backgrounds** | 6 preset areas + upload + grid **calibrate** drag-box; "set background" wired to the board layer. | Presets need art (open Q). |
| **C — AI background generation** | `LLM_API_KEY` config + `features` flag + `BgGen` dialog + Gemini server module + save-as-background. Lock-banner/upload fallback. | Lower risk (no transparency). |
| **D — AI prop generation** | `PropGen` dialog + transparent cut-out handling (or upload-only fallback if alpha unsupported). | Gated on the transparency risk. |
| **E — Templates** | Save current map (background + pieces + grid + meta) as a named, reusable template; load into a campaign. | Persistence + a template picker. |
| **F — (v2) Fog of war + walls** | Painted fog layer (per-cell hidden), wall pen + collision. | Only if you want it; largest + riskiest. |

**Recommended MVP cut: Phases A + B + C** = a DM can build a map (stamp/scale/rotate terrain & props, set a background from presets/upload, generate a background with AI) and the party plays on it. D/E/F follow on demand.

---

## 8. Decisions (resolved)

1. **Starter palette art → port the inked SVG set.** Recreate ~10–15 core pieces (trees, rocks, walls, doors, water, camp) from the handoff's inked SVG shapes as the built-in library; AI/upload for the rest. Vector = crisp + on-brand.
2. **Preset backgrounds → dropped (initially).** No bundled preset images; Phase B ships **upload + calibrate**, and AI background generation (Phase C) covers "make me a backdrop." Presets can be added later.
3. **Fog of war + walls → deferred to v2 (Phase F).** Ship authoring first (A–E).
4. **Build mode lives on the table screen** as a `Build ⇄ Play` toggle (DM-only). No separate route.

> Phase B is therefore "Backgrounds = upload + grid calibrate" only (no preset grid).

---

## 9. Reuse summary (why this is mostly additive)
- Canvas/transform/grid/snap/drag/resize/z-order/optimistic-sync → **reuse** (`CanvasViewer`).
- WS add/move/remove + broadcast + DM-auth patterns → **mirror** existing board/token handlers.
- Asset upload + `sharp` re-encode + manifest persistence → **reuse** for generated/uploaded art.
- Config/env + snapshot feature-flag plumbing → **small additions**.
- New build-only: piece rotation + 8-handle selection UI, palette, layers panel, generator dialogs, Gemini module.
