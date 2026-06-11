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

## Quick start (local)

Requirements: Node 22+, pnpm 9 (`corepack enable` gets you pnpm). Works on Linux, macOS, and Windows.

```bash
git clone https://github.com/PYannik/the-tavern.git
cd the-tavern
pnpm install
pnpm dev
```

Open **http://localhost:5173**. On first run the server creates the DM account and prints the credentials once:

```
╔══════════════════════════════════════════════════════════╗
║           ADMIN ACCOUNT CREATED                           ║
║  Username: DM                                             ║
║  Password: <generated, copy it now>                       ║
╚══════════════════════════════════════════════════════════╝
```

Set `ADMIN_PASSWORD=your-password` before the first start to choose your own.

Log in, create a campaign, pin a map from the DM tab, generate an invite link, and open it in a second browser window to see the player side.

A playable demo campaign (*Shards of the Ashen Throne*) ships in [`campaigns/demo-campaign/`](campaigns/demo-campaign/).

## Host a session for your group

Your players need a URL, not your LAN. The launcher puts The Tavern behind a free Cloudflare quick tunnel: no port forwarding, no static IP, no Cloudflare account. The host can be a Linux, macOS, or Windows machine; the only extra dependency is `cloudflared`:

| Host OS | Install cloudflared |
|---|---|
| Ubuntu/Debian | `./deploy/setup-ubuntu.sh` (installs everything, incl. Node and build) |
| macOS | `brew install cloudflared` |
| Windows | `winget install Cloudflare.cloudflared` |

Then, on any OS, after `pnpm install && pnpm -r build`:

```bash
node deploy/start.mjs
```

Set `ADMIN_PASSWORD` in the environment before the first start (`ADMIN_PASSWORD='…' node deploy/start.mjs` on Linux/macOS, `$env:ADMIN_PASSWORD='…'; node deploy/start.mjs` in PowerShell).

The launcher prints a public `https://….trycloudflare.com` URL. Share it with your players. The URL changes on every restart. On Linux/macOS, run it inside `tmux` to keep the session alive after you disconnect:

```bash
tmux new -d -s tavern "ADMIN_PASSWORD='…' node deploy/start.mjs"
tmux attach -t tavern        # view / copy the URL, detach with Ctrl-b d
```

For a permanent URL and start-on-boot (named Cloudflare tunnel plus systemd), follow [DEPLOY.md](DEPLOY.md).

Your world (accounts, campaigns, uploads) lives in `./live/`, which is gitignored. Back up that folder and you have backed up everything.

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
