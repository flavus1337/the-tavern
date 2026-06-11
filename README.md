# 🎲 The Tavern

**A self-hosted virtual tabletop for running D&D sessions with your friends in the browser.**

The Tavern runs on your own machine. Players open an invite link and they are at the table. No installs for them, no third-party accounts, no subscription. Campaign data is plain files on your disk, so you can read, back up, and version everything yourself.

It is built for small groups: one DM, a few players, shared maps, dice, handouts, and background music, with a warm dark theme.

## Features

🗺️ **Shared board.** Pin multiple maps, handouts, and character art onto a shared board. Drag, resize, and layer them live for everyone. The DM can unlock single items so players move their own pieces. Pan and zoom stay local, so everyone views the same table from their own seat.

🎲 **Dice.** Quick rolls for d4 to d100, expressions like `2d6+3` or `2d20kh`, and Advantage/Disadvantage checkboxes that show both throws with the kept die highlighted. Rolls happen server side, land in a shared roll log, and the DM can roll privately. Natural 20s get a short gold flash on the board.

📜 **Documents, private until shared.** Players upload character sheets, handouts, anything (PDF, images, text). Only the uploader sees a file until they share it with the table. Shared files open for everyone in floating, draggable panels. PDFs render in-app in every browser.

🎵 **Synced audio.** Upload ambience or battle music and play it for the whole table. The DM (or the uploader) controls playback, players only control their own volume, and late joiners enter the track at the current position. The player sits in a small dock at the bottom and can be minimized.

📝 **Notes.** Personal session notes with a markdown toolbar and preview, DM-only prep notes, and optional sharing of single notes with the party. Notes are stored as part of the campaign.

🔑 **Invite links.** No open signup. The DM generates a link, a friend opens it, picks a name and password, and joins the campaign. Role-based visibility is enforced on the server: players never see DM-only content, non-members see nothing at all.

🤖 **LLM-friendly campaign format.** Chapters, NPCs with stat blocks, notes, and assets are plain JSON and Markdown in a documented folder layout. Write campaign content by hand or let a language model draft it and drop the files in. [Format specification](campaigns/demo-campaign/README.md)

🕯️ **Candlelight theme.** Warm charcoal, ember accents, a serif for names and dice totals, gold reserved for crits. Dark only.

## Quick start

The only requirement is **Node 22+** ([nodejs.org](https://nodejs.org)). Same flow on Linux, macOS, and Windows:

```bash
git clone https://github.com/PYannik/the-tavern.git
cd the-tavern
node deploy/start.mjs
```

The launcher checks dependencies, installs and builds on first run (this takes a minute), downloads `cloudflared` if it is not installed, starts everything, and prints what you need:

```
╔══════════════════════════════════════════════════════════════╗
  The Tavern is reachable at:
  https://your-random-words.trycloudflare.com

  DM login:  DM / <generated password>   (first run, save this!)
╚══════════════════════════════════════════════════════════════╝
```

Share the URL with your players. Log in as DM, create a campaign, pin a map from the DM tab, and generate invite links for your group. To pick your own password, set `ADMIN_PASSWORD` before the first start.

Notes:

- The tunnel URL changes on every restart (free Cloudflare quick tunnel: no account, no port forwarding). For a permanent URL and start-on-boot, follow [DEPLOY.md](DEPLOY.md).
- On a remote Linux box, run the launcher inside `tmux` so it survives disconnects: `tmux new -d -s tavern "node deploy/start.mjs"`, then `tmux attach -t tavern` to read the banner.
- Your world (accounts, campaigns, uploads) lives in `./live/`, which is gitignored. Back up that folder and you have backed up everything.
- A playable demo campaign (*Shards of the Ashen Throne*) ships in [`campaigns/demo-campaign/`](campaigns/demo-campaign/).

## Development

```bash
pnpm install
pnpm dev          # server on :8080 + client with hot reload on :5173
```

Open http://localhost:5173. The same first-run credential rules apply (the server prints generated credentials once).

## Configuration

| Variable | Default | Meaning |
|---|---|---|
| `PORT` | `8080` | HTTP and WebSocket port (single process, single port). |
| `DATA_DIR` | `./data` | Server data: users, sessions, invites, memberships (JSON files). |
| `CAMPAIGNS_DIR` | `./campaigns` | Campaign content folders. |
| `ADMIN_USER` | `DM` | Username for the seeded admin/DM account. |
| `ADMIN_PASSWORD` | *(generated)* | Set before first run to choose the DM password, otherwise printed once. |
| `COOKIE_SECURE` | `false` | Set `true` behind HTTPS (tunnel or reverse proxy). |
| `PUBLIC_ORIGIN` | `http://localhost:8080` | Origin used when generating invite links. |

## Architecture

```
packages/
  shared/   TypeScript contract: campaign entities, WebSocket protocol, dice parser
  server/   Node + Express + ws. One process serves the client, REST API, and /ws
  client/   React + Vite + Tailwind v4 SPA

campaigns/  Campaign content (one folder per campaign, plain JSON + Markdown + assets)
deploy/     start.mjs (cross-platform launcher), setup-ubuntu.sh, systemd unit
scripts/    smoke-test.ts, an end-to-end test against a real server instance
```

Single Node process, JSON files for persistence, WebSockets for live sync, scrypt plus httpOnly-cookie sessions for auth. No database, no Docker required, no external services at game time.

```bash
pnpm -r typecheck && pnpm -r build && pnpm smoke   # full verification suite
```

## Roadmap

- Fog of war (DM-controlled vision masking)
- Initiative and condition tracker
- PDF campaign auto-import: feed a campaign PDF to an LLM pipeline that writes the campaign folder
- Grid snapping and measurement tools

## License

[MIT](LICENSE)
