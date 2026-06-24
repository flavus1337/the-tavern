# 🎲 The Tavern

**A self-hosted virtual tabletop for running D&D sessions with your friends in the browser.**

The Tavern runs on your own machine. Players open an invite link and they are at the table. No installs for them, no third-party accounts, no subscription. Campaign data is plain files on your disk, so you can read, back up, and version everything yourself.

It is built for small groups: one DM, a few players — shared maps, tokens, dice, handouts, and background music, with a warm dark theme.

## Features

🗺️ **Shared board.** A finite, framed play surface — the "Lit Table", a lamplit leather-and-felt gaming table with a 120×120 square grid — that everyone sees from their own seat. Pin maps, handouts, and character art; drag, resize, rotate, and layer them live. Lock the map so nothing shifts mid-fight, or unlock single items so players move their own pieces. Pan and zoom stay local; the board stays in sync.

🧙 **Tokens.** Drop combat tokens for PCs and monsters — sized S/M/L/H, colored or backed by an uploaded image, with allegiance (ally / enemy / neutral) and optional HP bars. Tag them with the 15 standard D&D **conditions** (shown as badges to everyone) and attach a lightweight **stat block** (AC, speed, ability scores, notes) that the DM always sees but a player sees only for tokens they own. The DM can hand control of a token to a player so they move only their own, and snap-to-grid keeps everyone aligned.

⚔️ **Combat tracker.** A shared **initiative** order in its own Combat tab: the DM adds tokens, auto-rolls d20+DEX, and steps through turns (start/end, next/prev, edit, clear). Everyone sees the order; the active combatant is highlighted in the panel and gets a gold ring on the board. Persisted across sessions.

🏗️ **Build mode — make your own maps.** A full map editor for the DM: set a battlemap background, stamp terrain and props, and calibrate the grid to any image so one square means one square. Move, scale, rotate, and lock pieces, then **save the whole map as a reusable template** and drop it onto the table whenever you need it.

🤖 **AI map & prop generation.** Optionally generate battlemap backgrounds and transparent prop cut-outs from a text prompt, in a consistent hand-inked house style, right inside Build mode. Powered by Google Gemini — paste a key at startup to enable it, or leave it off and build by hand. Off by default; the key is never written to disk.

📐 **Measurement & AoE templates.** A ruler shows live distance in your grid's units (metric or imperial). Standard D&D area-of-effect templates — **circle/sphere, cone, line, and square/cube** — drop onto the board with a single drag, labeled with radius/length/side. Place several at once; they sync to the whole table and **stay until you clear them**, so lingering effects like a wall of fire persist across rounds.

🎲 **Dice.** Quick rolls for d4 to d100, expressions like `2d6+3` or `2d20kh`, and Advantage/Disadvantage checkboxes that show both throws with the kept die highlighted. Rolls happen server side, land in a shared roll log, and the DM can roll privately. A **BG3-style 3D dice overlay** (real tumbling d4–d20, true percentile d100) plays the throw for the whole table and settles on the server-resolved value, with a gold/garnet flourish on crits and fumbles.

📜 **Documents, private until shared.** Players upload character sheets, handouts, anything (PDF, images, text). Only the uploader sees a file until they share it. Sharing is fine-grained — keep it private, show only the DM, pick specific players, or open it to the whole table. Shared files open for everyone in floating, draggable panels. PDFs render in-app in every browser.

🎵 **Synced audio.** Upload ambience or battle music and play it for the whole table. The DM (or the uploader) controls playback, players only control their own volume, and late joiners enter the track at the current position. The player sits in a small dock at the bottom and can be minimized.

📝 **Notes.** Personal session notes with a markdown toolbar and preview, DM-only prep notes (secret / read-aloud / handout), and optional sharing of single notes with the party. Notes are stored as part of the campaign.

📖 **Chapters (DM).** The DM panel's organizing spine: a chapter rail scopes maps, NPCs, and notes to the part of the adventure they belong to, with an Unfiled bucket so nothing goes missing. Per-chapter prep bodies persist to Markdown sidecars. DM-only — players never see it.

🔑 **Invite links.** No open signup. The DM generates a link, a friend opens it, picks a name and password, and joins the campaign. Role-based visibility is enforced on the server: players never see DM-only content, non-members see nothing at all.

🤖 **LLM-friendly campaign format.** Chapters, NPCs with stat blocks, notes, and assets are plain JSON and Markdown in a documented folder layout. Write campaign content by hand or let a language model draft it and drop the files in. [Format specification](campaigns/demo-campaign/README.md)

🕯️ **Candlelight theme.** Warm charcoal, ember accents, a serif for names and dice totals, gold reserved for crits. Dark only.

## Quick start

The only requirement is **Node 22+** ([nodejs.org](https://nodejs.org)). Same flow on Linux, macOS, and Windows:

```bash
git clone https://github.com/flavus1337/the-tavern.git
cd the-tavern
node deploy/start.mjs
```

The launcher checks dependencies, installs and builds on first run (this takes a minute), downloads `cloudflared` if it is not installed, optionally asks for a Gemini key to enable AI map generation, starts everything, and prints what you need:

```
╔══════════════════════════════════════════════════════════════╗
  The Tavern is reachable at:
  https://your-random-words.trycloudflare.com

  DM login:  DM / <generated password>   (first run, save this!)
╚══════════════════════════════════════════════════════════════╝
```

Share the URL with your players. Log in as DM, create a campaign, build or pin a map, and generate invite links for your group. To pick your own password, set `ADMIN_PASSWORD` before the first start.

Notes:

- The tunnel URL changes on every restart (free Cloudflare quick tunnel: no account, no port forwarding). For a permanent URL and start-on-boot, follow [DEPLOY.md](DEPLOY.md).
- **AI map generation is optional.** Paste a [Google Gemini](https://aistudio.google.com/apikey) API key when the launcher asks (or set `LLM_API_KEY`) to turn it on for the session — skip it and everything else still works. The key is passed to the server in memory only, never saved.
- On a remote Linux box, run the launcher inside `tmux` so it survives disconnects: `tmux new -d -s tavern "node deploy/start.mjs"`, then `tmux attach -t tavern` to read the banner.
- Your world (accounts, campaigns, uploads) lives in `./live/`, which is gitignored. Back up that folder and you have backed up everything.
- A playable demo campaign (*Shards of the Ashen Throne*) ships in [`campaigns/demo-campaign/`](campaigns/demo-campaign/).

## Development

```bash
pnpm install
pnpm dev          # server on :8080 + client with hot reload on :5173
```

Open http://localhost:5173. The same first-run credential rules apply (the server prints generated credentials once). Set `LLM_API_KEY` in your environment to develop the AI generation features.

## Configuration

| Variable | Default | Meaning |
|---|---|---|
| `PORT` | `8080` | HTTP and WebSocket port (single process, single port). |
| `DATA_DIR` | `./data` | Server data: users, sessions, invites, memberships (JSON files). |
| `CAMPAIGNS_DIR` | `./campaigns` | Campaign content folders. |
| `ADMIN_USER` | `DM` | Username for the seeded admin/DM account. |
| `ADMIN_PASSWORD` | *(generated)* | Set before first run to choose the DM password, otherwise printed once. |
| `LLM_API_KEY` | *(none)* | Google Gemini API key. Set it to enable AI map/prop generation; unset disables it. |
| `COOKIE_SECURE` | `false` | Set `true` behind HTTPS (tunnel or reverse proxy). |
| `PUBLIC_ORIGIN` | `http://localhost:8080` | Origin used when generating invite links. |

> The `deploy/start.mjs` launcher overrides `DATA_DIR` and `CAMPAIGNS_DIR` to live under `./live/` so your world is kept separate from the repo.

## Architecture

```
packages/
  shared/   TypeScript contract: campaign entities, WebSocket protocol, dice parser
  server/   Node + Express + ws. One process serves the client, REST API, and /ws
  client/   React + Vite + Tailwind v4 SPA
  server/assets/  bundled style-reference images for AI generation

campaigns/  Campaign content (one folder per campaign, plain JSON + Markdown + assets)
deploy/     start.mjs (cross-platform launcher), systemd unit
scripts/    smoke-test.ts, an end-to-end test against a real server instance
```

Single Node process, JSON files for persistence, WebSockets for live sync, scrypt plus httpOnly-cookie sessions for auth. The board (maps, tokens, pieces, AoE templates, initiative, grid) is server-authoritative and broadcast to everyone live. No database, no Docker required, no external services at game time (AI generation is the only optional outbound call).

```bash
pnpm -r typecheck && pnpm -r build && pnpm smoke   # full verification suite (200+ assertions)
```

## Roadmap

- Fog of war (DM-controlled vision masking)
- PDF campaign auto-import: feed a campaign PDF to an LLM pipeline that writes the campaign folder

## License

[MIT](LICENSE)
