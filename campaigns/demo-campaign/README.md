# Campaign Folder Format Specification

**Version:** schema v1  
**Target audience:** LLM import pipelines, human content authors, and the server loader.

This document defines the authoritative contract for campaign folder content. The server reads campaign folders at startup; any content you write here becomes live data without a server restart (in development) or after a restart (production). Only the `packages/` code and `DATA_DIR` server-owned files live outside these folders.

---

## Folder Layout

```
campaigns/
  <campaign-id>/             # Root. campaign-id must be URL-safe (letters, digits, hyphens, underscores).
    campaign.json            # REQUIRED. CampaignMeta entity.
    chapters/
      <id>.json              # Chapter entity.
      <id>.md                # Optional sidecar — its content is loaded as the chapter's `body` field.
    characters/
      <id>.json              # Character entity (NPC or PC).
    notes/
      <id>.json              # Note entity.
    assets/
      <filename>.png/.jpg    # Binary image file.
      <filename>.json        # AssetManifest entity — same basename as the binary.
      <filename>.pdf         # Binary document file.
      <filename>.json        # AssetManifest entity for the document.
    .runtime/                # SERVER-OWNED. Never author. Safe to delete (server recreates it).
      current-image.json     # Currently shared image state.
      roll-history.json      # Roll log (last 200 entries).
```

**Unknown folders** (e.g. `handouts/`, `tables/`, `maps/`) are ignored by the current server. They are safe to add for forward compatibility. **Unknown JSON fields** within a known entity are preserved by the parser and passed through without error — authors may add extra fields freely, but the canonical examples below use only schema-defined fields.

---

## Entity Types

Every `.json` file in a campaign folder is a **campaign entity**. All entities share these top-level required fields:

| Field | Type | Required | Meaning |
|---|---|---|---|
| `type` | string enum | YES | Discriminator. One of `campaign`, `chapter`, `character`, `note`, `asset`. |
| `schemaVersion` | number | YES | Integer version. Must be ≤ the server's maximum for this type (all currently 1). Parser rejects files with a higher version. |
| `id` | string (non-empty) | YES | Unique within its type. Conventionally a kebab-case slug matching the filename (without extension). |

---

### `campaign` — CampaignMeta

Exactly one file per campaign folder, always named `campaign.json`. The `id` field **must** match the folder name.

| Field | Type | Required | Meaning |
|---|---|---|---|
| `type` | `"campaign"` | YES | Must be exactly `"campaign"`. |
| `schemaVersion` | `1` | YES | Current max: 1. |
| `id` | string | YES | Must match the folder name (e.g. `"my-campaign"` for `campaigns/my-campaign/`). |
| `name` | string | YES | Human-readable campaign title. Shown in the lobby and campaign list. |
| `description` | string | YES | Short campaign pitch. Shown in the lobby. |
| `coverAssetId` | string or null | no | Asset `id` of a cover image. Used as the lobby thumbnail. |

**Example:**

```json
{
  "type": "campaign",
  "schemaVersion": 1,
  "id": "demo-campaign",
  "name": "Shards of the Ashen Throne",
  "description": "An undead empire stirs beneath the ashen wastes.",
  "coverAssetId": "asset-malgrath-portrait"
}
```

---

### `chapter` — Chapter

Files in `chapters/`. Multiple chapters allowed; displayed in ascending `order`.

| Field | Type | Required | Meaning |
|---|---|---|---|
| `type` | `"chapter"` | YES | |
| `schemaVersion` | `1` | YES | |
| `id` | string | YES | |
| `title` | string | YES | Displayed in the chapter list. |
| `order` | number | YES | Integer. Chapters are sorted ascending by this value. |
| `summary` | string | no | One-paragraph DM-facing summary of the chapter. Shown in the chapter browser. |
| `body` | string | no | Full DM narrative text (Markdown). **Overridden by sidecar** — see Sidecar Rule below. |
| `scenes` | `Scene[]` | YES | Array of Scene objects. May be empty. |

**Scene sub-object:**

| Field | Type | Required | Meaning |
|---|---|---|---|
| `id` | string | YES | Unique within the chapter. |
| `title` | string | YES | Scene heading. |
| `body` | string | no | Inline scene description. Displayed to DM. |
| `assetIds` | `string[]` | YES | Asset `id`s referenced in this scene. The DM can share any of these from the scene panel. |
| `characterIds` | `string[]` | YES | Character `id`s that appear in this scene. Used to populate the encounter roster. Duplicates are allowed (same creature appears twice). |

---

### `.md` Sidecar Rule

If a file `chapters/<id>.md` exists alongside `chapters/<id>.json`, the server loader reads the `.md` file and uses its content as the chapter's `body` field. **The sidecar always wins over any inline `body` value in the JSON.** This allows long narrative text to be maintained in a separate readable file while keeping the JSON clean. The `.md` file path must exactly match the chapter JSON filename (same directory, same basename, `.md` extension instead of `.json`).

The same mechanism is available for `character` entities (character backstory/notes) via `characters/<id>.md`.

---

### `character` — Character

Files in `characters/`. Covers both NPCs/enemies and player characters.

| Field | Type | Required | Meaning |
|---|---|---|---|
| `type` | `"character"` | YES | |
| `schemaVersion` | `1` | YES | |
| `id` | string | YES | |
| `name` | string | YES | Display name. |
| `kind` | `"npc"` or `"pc"` | YES | Determines which UI panels and access rules apply. |
| `tags` | `string[]` | YES | Freeform tags used for filtering. Empty array `[]` is valid. |
| `portraitAssetId` | string or null | no | Asset `id` for a portrait image. |
| `ownerUsername` | string or null | no | For PCs: set to the player's registered username. For NPCs: `null`. See Ownership section. |
| `statBlock` | StatBlock object | no | 5e-style combat statistics. Omit for PCs that only use the sheet. |
| `sheet` | CharacterSheet object | no | Player-facing character data. Omit for pure NPCs. |
| `body` | string | no | Markdown backstory/notes. Overridden by sidecar. |

**StatBlock sub-object:**

| Field | Type | Required | Meaning |
|---|---|---|---|
| `ac` | number | YES | Armour Class. |
| `hp` | `{ average: number, formula?: string }` | YES | Hit points. |
| `abilities` | `{ str, dex, con, int, wis, cha }` | YES | Six ability scores (integers). |
| `size` | string | no | `"Tiny"`, `"Small"`, `"Medium"`, `"Large"`, `"Huge"`, `"Gargantuan"`. |
| `creatureType` | string | no | e.g. `"Undead"`, `"Humanoid (half-orc)"`. |
| `alignment` | string | no | e.g. `"Neutral Evil"`. |
| `speed` | string | no | e.g. `"30 ft., fly 40 ft."`. |
| `skills` | `Record<string, number>` | no | Skill bonus modifiers, e.g. `{ "Perception": 4 }`. |
| `senses` | string | no | e.g. `"Darkvision 60 ft., passive Perception 14"`. |
| `languages` | `string[]` | no | Languages spoken/understood. |
| `cr` | string | no | Challenge rating as a string, e.g. `"1/4"`, `"14"`. |
| `traits` | `Array<{ name, text }>` | no | Passive abilities and features. |
| `actions` | `Array<{ name, text }>` | no | Actions available in combat. |

**CharacterSheet sub-object:**

| Field | Type | Required | Meaning |
|---|---|---|---|
| `class` | string | no | Class name. |
| `level` | number | no | Character level. |
| `race` | string | no | Race/species. |
| `abilities` | `{ str, dex, con, int, wis, cha }` | no | Ability scores. |
| `maxHp` | number | no | Maximum hit points. |
| `ac` | number | no | Armour Class. |
| `speed` | string | no | Movement speed. |
| `proficiencies` | `string[]` | no | Proficiency list. |
| `inventory` | `string[]` | no | Equipment/item list. |
| `spells` | `string[]` | no | Known or prepared spells. |
| `background` | string | no | Character background text. |
| `sheetAssetId` | string or null | no | Asset `id` of an uploaded PDF character sheet. Set by the app when a player uploads their sheet in-app. Leave `null` in authored content. |

---

### `note` — NoteEntity

Files in `notes/`. Notes can be authored in the folder (DM prep notes) or created in-app by players or the DM.

| Field | Type | Required | Meaning |
|---|---|---|---|
| `type` | `"note"` | YES | |
| `schemaVersion` | `1` | YES | |
| `id` | string | YES | |
| `title` | string | YES | Displayed in the notes panel heading. |
| `body` | string | YES | Note content (Markdown supported). |
| `visibility` | `"dm"` or `"player"` | YES | `"dm"` notes are hidden from players. `"player"` notes are visible to all campaign members. |
| `ownerUsername` | string or null | YES | Username of the note's author. `null` for authored notes not associated with a specific user. |
| `createdAt` | string (ISO 8601) | YES | Creation timestamp. e.g. `"2025-09-01T10:00:00.000Z"`. |
| `updatedAt` | string (ISO 8601) | YES | Last-modified timestamp. |

---

### `asset` — AssetManifest

Files in `assets/`. Each binary file (image, PDF) must have a matching manifest `.json` sidecar with the same basename.

| Field | Type | Required | Meaning |
|---|---|---|---|
| `type` | `"asset"` | YES | |
| `schemaVersion` | `1` | YES | |
| `id` | string | YES | Used everywhere else (chapters, characters) to reference this asset. |
| `file` | string | YES | Basename of the binary file, including extension. e.g. `"dungeon-level1.png"`. |
| `title` | string | YES | Human-readable name shown in the asset browser. |
| `assetKind` | `"map"`, `"art"`, `"handout"`, `"token"`, or `"document"` | YES | **Note: field is named `assetKind`, not `kind`.** Determines display treatment and access. |
| `tags` | `string[]` | YES | Freeform tags for filtering. Empty array `[]` is valid. |
| `dmOnly` | boolean | YES | `true` = only the DM can see and share this asset. `false` = all members can see it. Maps are typically `true`; portraits and handouts typically `false`. |
| `width` | number or null | YES | Pixel width of the image. Use `null` for PDFs and documents. |
| `height` | number or null | YES | Pixel height of the image. Use `null` for PDFs and documents. Must match the actual image dimensions exactly. |
| `mime` | string | YES | MIME type. `"image/png"`, `"image/jpeg"`, `"application/pdf"`, etc. |
| `ownerUsername` | string or null | no | `null` for authored content. Set by the server when a user uploads a file in-app. Do not set this field in authored manifests. |

**Auto-registration:** If a binary file exists in `assets/` without a matching `.json` manifest, the server creates a minimal manifest for it at startup with `assetKind: 'art'`, `dmOnly: false`, and `ownerUsername: null`. The auto-generated `id` is derived from the filename. To control `dmOnly`, `assetKind`, tags, or the canonical `id`, always provide a manifest.

---

## `ownerUsername` Linking

`ownerUsername` on a `character` entity links the character to a registered user account. The server uses this to:

- Display the character in the player's character panel when they join the campaign.
- Restrict editing of the character sheet to that user (and the DM).

**Workflow for setting up a PC:**

1. Author the PC JSON with `"ownerUsername": null` (as in the demo campaign).
2. Give the player an invite link (generated in the admin UI or via the API).
3. After the player registers, edit the character JSON and set `"ownerUsername": "<their username>"`.
4. Restart the server (or wait for a hot-reload in dev mode).

Membership (who is in a campaign, with what role) lives in `DATA_DIR` on the server, not in the campaign folder. Do not attempt to add membership data to the campaign folder — it will be ignored.

---

## `schemaVersion` and Extensibility

- All current entity types are at schemaVersion 1.
- When you author a file, always set `schemaVersion` to the current maximum for that type (currently `1` for all types).
- The parser rejects files with a `schemaVersion` higher than the server knows about. Files with a lower version (e.g. 0) that somehow exist are accepted via defaults.
- **Unknown fields** in a known entity are silently preserved. You may add fields like `"dmNotes"`, `"questReward"`, etc., and the server will round-trip them without complaint. Keep these to a minimum in canonical content.
- **Unknown folders** (e.g. `puzzles/`, `tables/`) are ignored entirely. Use them for organisational purposes or future pipeline targets.
- **Unknown entity types** (e.g. a JSON with `"type": "encounter"`) inside known folders are ignored.

---

## What `.runtime/` Is

The `.runtime/` directory inside each campaign folder is fully server-owned. The server creates it on first use and updates it continuously to track live session state:

- `.runtime/current-image.json` — the asset currently shared on the canvas (or null).
- `.runtime/roll-history.json` — the last 200 roll log entries.

**Never edit `.runtime/` files** — they will be overwritten. It is safe to delete the entire `.runtime/` directory; the server will recreate it with default (empty) state on next startup, which effectively resets the shared canvas and clears the roll log for that campaign.

---

## How an LLM Should Write a New Chapter

This section is a worked example for a generative pipeline.

**Goal:** Add Chapter 3 "The Escape Tunnel" to this campaign.

**Step 1 — Create the chapter JSON:**

```json
{
  "type": "chapter",
  "schemaVersion": 1,
  "id": "ch03-the-escape-tunnel",
  "title": "The Escape Tunnel",
  "order": 3,
  "summary": "The party discovers the tunnel beneath the Crypt and finds Vorra's captive sibling.",
  "scenes": [
    {
      "id": "scene-03-01",
      "title": "The Hidden Door",
      "body": "A crumbling section of crypt wall conceals a narrow passage sloping downward.",
      "assetIds": [],
      "characterIds": []
    }
  ]
}
```

Save as `chapters/ch03-the-escape-tunnel.json`.

**Step 2 — Optionally add a sidecar:**

Create `chapters/ch03-the-escape-tunnel.md` with the full DM narrative. The file content replaces the inline `body` field. The JSON `body` field value is ignored when a sidecar exists.

**Step 3 — Reference existing assets and characters:**

Use the `id` values from existing manifest and character files. For the escape tunnel, `"assetIds": ["asset-dungeon-level1"]` reuses the same map. New encounters reference new character JSON files.

**Step 4 — Verify:**

Run the validation script (see repo root README) to confirm `parseEntity` returns `ok: true` for the new file.

**Rules summary for LLM generation:**
- Every file must have `type`, `schemaVersion`, and `id` at minimum.
- `schemaVersion` must be a number, currently `1`.
- `id` must be a non-empty string; conventionally match the filename without `.json`.
- `assetIds` and `characterIds` in scenes must be arrays (empty `[]` is fine); do not omit them.
- `tags` in character and asset must be arrays (empty `[]` is fine).
- `dmOnly` in asset must be a boolean, not a string.
- `ownerUsername` should be `null` in authored content.
- Do not add files to `.runtime/`.
- Do not modify `packages/`.

---

## Complete File Listing for This Demo Campaign

```
campaigns/demo-campaign/
  campaign.json
  chapters/
    ch01-descent-into-the-hold.json
    ch01-descent-into-the-hold.md       ← sidecar (body content for ch01)
    ch02-the-ritual-chamber.json        ← no sidecar; body is inline in scenes
  characters/
    char-skeleton-sentinel.json
    char-vorra-lieutenant.json
    char-malgrath-lich.json
    char-pc-kaelis.json                 ← PC; set ownerUsername after player registers
  notes/
    dm-prep.json                        ← visibility: "dm"
  assets/
    dungeon-level1.png                  ← 1200×900 generated map
    asset-dungeon-level1.json           ← assetKind: "map", dmOnly: true
    malgrath-portrait.png               ← 900×1100 generated portrait
    asset-malgrath-portrait.json        ← assetKind: "art", dmOnly: false
```
