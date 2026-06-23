# Design brief — Campaign PDF importer & chapter-organized DM panel

Audience: a designer (or design agent) with no prior context on this thread.
Goal: produce UI/UX designs for two linked features in our self-hosted VTT
("a Roll20 alternative"). Read this whole doc first — it's self-contained.

---

## 1. Product context

This is a virtual tabletop for running tabletop-RPG sessions. One **DM** (game
master) prepares and runs a **campaign**; **players** join a shared table. The
app already has: a battlemap board with tokens, dice, an initiative tracker,
notes, document/handout sharing, and an AI image generator for maps and token
art (house "inked battlemap" style, gated behind an optional API key).

A **campaign** is a structured set of entities:

- **Chapters** — ordered sections of the adventure. Each has a title, a summary,
  DM prep text (markdown), and a list of scenes.
- **Characters** — NPCs and monsters (with stat blocks + token/portrait art) and
  player characters.
- **Notes / handouts** — DM-secret notes, read-aloud (boxed) text, player
  handouts. Each has a sharing scope (private / DM / specific users / everyone).
- **Assets** — images: maps, token art, props, uploaded documents.

Today the DM creates a campaign by typing only a **name + description**. Chapters
exist in the data model but have **no UI at all** — they're invisible to the DM.

## 2. What we're building

### Feature A — Campaign PDF importer
On the campaign-selection screen, when creating a new campaign, the DM can
**upload a campaign PDF** (a published adventure module). We parse it and
auto-generate the campaign: chapters, NPCs & monsters (stat blocks + generated
token art), maps (book maps re-drawn in our house art style), and DM notes —
all organized by chapter. Output is a **first-pass draft the DM reviews and
edits**, not a finished product. This entry point only appears when the AI
features are enabled (an API key is configured).

### Feature B — Chapter-organized DM panel (the bigger design problem)
Chapters are the **organizing parent** for everything else: a given map, NPC,
monster, or note belongs to one or more chapters. The DM needs a panel where
this hierarchy is obvious and self-explanatory — it must be clear *why* a given
item is shown, and why others aren't.

## 3. The IA decision already made (please design within this)

Chapters are **not** a sibling tab next to "Assets." They are the **primary axis
/ scope** of the DM panel. Agreed model:

1. **Chapter rail** at the top of the DM panel — an ordered, horizontally
   scrollable selector: `All · 1 Descent · 2 Ritual Chamber · 3 Escape · +`.
   Selecting a chapter scopes everything below it. Includes add / rename /
   reorder (drag) / delete.
2. **Active-chapter header** — the selected chapter's title, summary, and an
   "Edit prep" affordance opening its markdown prep notes.
3. **Scoped content sections** below — Maps, NPCs & monsters, Notes & handouts —
   each filtered to the active chapter. (These reuse existing list/grid UI.)
4. **Chapter chips** on every item — redundant when scoped to one chapter, but
   essential in the **All** view and for items that span chapters (a recurring
   villain legitimately shows `Ch 1` + `Ch 3`). Membership is multi-valued.
5. **Unfiled bucket** — untagged items (player uploads, generic props) surface in
   a footer; drag onto a chapter to assign. Nothing is ever silently hidden — if
   something isn't shown, it's because it's filed under another chapter or
   unfiled, and the UI makes that visible.
6. The **All** view (chips visible, content grouped by chapter) must be a
   first-class toggle — some DMs think "show me every monster in the book."

Engineering note (don't redesign this, just so you know it's cheap): chapter
membership is stored as a `chapter:<id>` tag on each item, so multi-chapter
membership and the chip model come for free.

## 4. Screens / components to design

1. **Campaign-selection screen** — where the "Create new campaign" and the new
   "Import from PDF" entry points live. Show how import is presented vs. a blank
   campaign, and how it's hidden when AI is unavailable.
2. **Import flow** — file picker → in-progress state (parsing + generating art
   can take minutes; design a progress/streaming state with per-step feedback,
   e.g. "Extracting chapters → Generating tokens → Re-drawing maps") → review/done
   state. Include an empty/error state (bad PDF, too large, partial result).
3. **DM panel, chapter-scoped** (the core) — chapter rail, active-chapter header,
   scoped Maps / NPCs & monsters / Notes sections, chapter chips, Unfiled footer.
   A reference mockup of this exists; treat it as a starting point to refine, not
   a final spec.
4. **All view** — same panel with scope = All: chips visible, grouped by chapter.
5. **Assign-to-chapter interaction** — how an item gets tagged to a chapter (drag
   to rail, and/or a chapter multi-select in the item editor).
6. **Chapter management** — add / rename / reorder / delete chapters, and the
   chapter prep-notes editor (markdown).

For each, please cover the usual states: empty, loading, populated, error, and
the read-only vs. editable distinction.

## 5. Constraints & house style

- **Existing dark "leather gaming table" theme.** Match it. Core tokens (from
  `packages/client/src/index.css`):
  - Backgrounds: `--bg #0c0a09`, `--surface #16110f`, `--surface2 #1f1815`,
    `--raised #262019`
  - Borders: `--border #2e2723`, `--border-soft #241d19`
  - Text: `--hi #f4efe9`, `--mid #b3a89e`, `--low #7d7269`, `--faint #574e48`
  - Accents: `--ember #e08a4b` (primary), `--gold #e8b765`, `--garnet #b6485a`
    (destructive/danger), `--ink #1a1209` (text on ember)
- The DM panel is a **narrow side panel** (~320–360px wide), not a full page —
  design for that width. The campaign-selection and import screens are full-screen.
- Sharing/visibility matters: DM-secret notes vs. read-aloud vs. player handouts
  should be visually distinguishable (icon/treatment), since leaking a secret to
  players is a real failure.
- Generated art has a fixed "inked battlemap" look — maps are top-down, tokens
  are cut-outs on transparent backgrounds. Token thumbnails are circular in the
  existing UI.
- Keep it lightweight — this is an indie self-hosted tool, not an enterprise
  suite. Favor clarity and density over chrome.

## 6. Open questions for the designer to weigh in on

- Best affordance for assigning an item to chapters (drag-to-rail vs. an editor
  multi-select vs. both) and how multi-chapter items read at a glance.
- How the import "review" step should work — auto-commit everything and let the
  DM clean up, or a confirm/triage screen before anything is saved?
- Whether maps deserve their own scope/section prominence given they're the
  thing the DM acts on most during play.
- How far the chapter rail scales — a long module can have 15+ chapters. Overflow
  / grouping / search in the rail?

## 7. Out of scope (for now)

Encounter builder, read-aloud auto-splitting, pronunciation guides, and
handling of very large PDFs (chunked parsing). Mentioned only so you don't design
around them.
