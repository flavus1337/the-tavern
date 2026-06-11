# 🎲 The Tavern

**A self-hosted virtual tabletop for D&D nights with your friends — warm, fast, and entirely yours.**

The Tavern is a browser-based VTT you run on your own machine. Your players click one invite link and they're at the table — no installs, no accounts with a third party, no subscription, no proprietary cloud holding your campaign hostage. Everything lives in plain files on your disk.

It's built for the way small groups actually play: one DM, a handful of friends, a map on the table, dice that matter, music in the background, and a candlelit look that feels like a session — not like a dev tool.

---

## Features

🗺️ **A real table.** Pin multiple maps, handouts, and character art onto a shared board. Drag, resize, and layer them live for everyone. Unlock individual items so players can move their own token art themselves. Pan and zoom are per-player — everyone looks at the same table from their own seat.

🎲 **Dice that feel like dice.** Quick-roll d4–d100, full expressions (`2d6+3`, `2d20kh`), one-click **Advantage / Disadvantage** with both throws shown and the kept die highlighted. Server-side rolls (no cheating), a shared roll log, private DM rolls, and natural 20s that make the whole board flash gold.

📜 **Documents — private until shared.** Players upload character sheets, handouts, anything (PDF, images, text…). Only the uploader sees a file until they share it with the table — then it opens on everyone's screen in a floating, draggable panel. PDFs render in-app on every browser.

🎵 **A bard in a box.** Upload ambience or battle music and play it **for the whole table, synchronized**. The DM controls playback; players control only their own volume. Late joiners drop into the track at the right position. Minimisable bottom dock keeps the music out of the way.

📝 **Notes with markdown.** Personal session notes with a formatting toolbar and live preview, DM-only prep notes, and one-click sharing of any note with the party. All saved as part of the campaign.

🔑 **Invite-link onboarding.** No open signup. Generate a link, send it to a friend, they pick a name and password, and they're in your campaign — with role-based visibility enforced server-side everywhere (players never see DM-only content, non-members never see anything).

🤖 **LLM-friendly campaign format.** Campaign content — chapters, NPCs with stat blocks, notes, assets — is plain JSON + Markdown in a documented folder structure. Write it by hand, or let a language model draft your campaign and drop the files in. [Format specification →](campaigns/demo-campaign/README.md)

🕯️ **The Candlelight theme.** Warm charcoal, ember accents, a display serif for the things that matter, gold reserved for critical hits. Dark mode isn't a setting — it's the point.

---

## Quick start (try it locally)

**Requirements:** Node 22+, pnpm 9 (`corepack enable` gets you pnpm).

```bash
git clone https://github.com/PYannik/the-tavern.git
cd the-tavern
pnpm install
pnpm dev
```

Open **http://localhost:5173**. On first run the server creates the DM account and prints the credentials **once**:

```
╔══════════════════════════════════════════════════════════╗
║           ADMIN ACCOUNT CREATED                           ║
║  Username: DM                                             ║
║  Password: <generated — copy it now>                      ║
╚══════════════════════════════════════════════════════════╝
```

(Set `ADMIN_PASSWORD=your-password` before the first start to choose your own.)

Log in, create a campaign, pin a map from the DM tab, generate an invite link — and open it in a second browser window to see the player side.

A complete playable demo campaign (*Shards of the Ashen Throne*) ships in [`campaigns/demo-campaign/`](campaigns/demo-campaign/).

---

## Host a session for your group

Your players need a URL, not your LAN. The launcher puts The Tavern behind a free Cloudflare quick tunnel — no port forwarding, no static IP, no Cloudflare account. The host can be a **Linux, macOS, or Windows** machine; the only extra dependency is `cloudflared`:

| Host OS | Install cloudflared |
|---|---|
| Ubuntu/Debian | `./deploy/setup-ubuntu.sh` (installs everything, incl. Node + build) |
| macOS | `brew install cloudflared` |
| Windows | `winget install Cloudflare.cloudflared` |

Then (any OS, after `pnpm install && pnpm -r build`):

```bash
node deploy/start.mjs
```

Set `ADMIN_PASSWORD` in the environment before the first start to choose the DM password (e.g. `ADMIN_PASSWORD='…' node deploy/start.mjs` on Linux/macOS, `$env:ADMIN_PASSWORD='…'; node deploy/start.mjs` in PowerShell).

The launcher prints a public `https://….trycloudflare.com` URL — share it (the URL changes on every restart). On Linux/macOS, run it inside `tmux` to keep the session alive after you disconnect:

```bash
tmux new -d -s tavern "ADMIN_PASSWORD='…' node deploy/start.mjs"
tmux attach -t tavern        # view / copy the URL, detach with Ctrl-b d
```

For a **permanent URL** and start-on-boot (named Cloudflare tunnel + systemd), follow [DEPLOY.md](DEPLOY.md).

Your world — accounts, campaigns, uploads — lives in `./live/` (gitignored). Back up that folder and you've backed up everything.

---

## Configuration

| Variable | Default | Meaning |
|---|---|---|
| `PORT` | `8080` | HTTP + WebSocket port (single process, single port). |
| `DATA_DIR` | `./data` | Server data: users, sessions, invites, memberships (JSON files). |
| `CAMPAIGNS_DIR` | `./campaigns` | Campaign content folders. |
| `ADMIN_USER` | `DM` | Username for the seeded admin/DM account. |
| `ADMIN_PASSWORD` | *(generated)* | Set before first run to choose the DM password; otherwise printed once. |
| `COOKIE_SECURE` | `false` | Set `true` behind HTTPS (tunnel / reverse proxy). |
| `PUBLIC_ORIGIN` | `http://localhost:8080` | Origin used when generating invite links. |

---

## Architecture

```
packages/
  shared/   TypeScript contract: campaign entities, WebSocket protocol, dice parser
  server/   Node + Express + ws — one process serves the client, REST API, and /ws
  client/   React + Vite + Tailwind v4 SPA

campaigns/  Campaign content (one folder per campaign, plain JSON + Markdown + assets)
deploy/     setup-ubuntu.sh, start.sh, systemd unit
scripts/    smoke-test.ts — 147-assertion end-to-end test against a real server
```

Single Node process, JSON files for persistence, WebSockets for live sync, scrypt + httpOnly-cookie sessions for auth. No database, no Docker required, no external services at game time.

```bash
pnpm -r typecheck && pnpm -r build && pnpm smoke   # the full verification suite
```

---

## Roadmap

- Fog of war — DM-controlled vision masking
- Initiative & condition tracker
- PDF campaign auto-import — feed a campaign PDF to an LLM pipeline that writes the campaign folder
- Grid snapping and measurement tools

---

## License

[MIT](LICENSE) — do whatever makes your table happy.
