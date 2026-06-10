# VTT — Browser-Based Virtual Tabletop

A lightweight, self-hosted virtual tabletop for running tabletop RPG sessions in a browser. No subscription, no account with a third party, no proprietary format. You own your data.

---

## Features

- **Live shared canvas** — the DM shares a map or art image and every player sees it instantly via WebSocket.
- **Dice roller + roll log** — roll any standard polyhedral expression (e.g. `4d6kh3`, `1d20+5`). Results appear in a live log, visible to all or DM-only depending on roll visibility.
- **Accounts + invite links** — registration is invite-only. The DM generates a link; the player opens it to register and automatically joins the campaign. No open sign-up.
- **Campaign lobby** — players see all campaigns they belong to and can jump into a session from the lobby.
- **Player PDF uploads** — players can upload their character sheet PDF in-app; it's stored in the campaign's `assets/` folder and linked to their character.
- **LLM-friendly campaign folders** — campaign content (chapters, characters, notes, assets) lives in plain JSON files inside `campaigns/<id>/`. A language model can write or update content offline; the server loads it at startup. See [Campaign Format Specification](campaigns/demo-campaign/README.md).
- **Per-campaign roles** — each campaign member is either DM (full access, can share images, manage invites, see all assets) or player (can roll, upload their own PDF, see shared canvas).

---

## Architecture

```
packages/
  shared/   — TypeScript types and helpers (campaign entities, WebSocket protocol, API DTOs, dice).
              Source-only package consumed by server and client.
  server/   — Node.js + Express + WebSocket server. Serves the built client and all API/WS endpoints.
  client/   — Browser SPA (Vite). Communicates over REST + WebSocket.

campaigns/  — Campaign content folders. One subfolder per campaign.
data/       — Server-owned runtime data: users, sessions, invites, memberships (JSON files).
              Created automatically on first run. Not the same as campaign content.
deploy/     — Deployment helpers: systemd unit file.
```

The server is a **single Node process** on one port (default `8080`). It serves the built client bundle, the REST API under `/api/`, and a WebSocket endpoint at `/ws`. No separate backend/frontend processes.

---

## Quickstart (development)

**Requirements:** Node 22, pnpm 9.

```bash
git clone <repo-url> vtt
cd vtt
pnpm install
pnpm dev
```

Open [http://localhost:8080](http://localhost:8080).

On first run the server generates a random admin password and **prints it once to the terminal**. Copy it — you'll need it to log in as `admin`.

```
[vtt] First run: admin password set to: Xk3mP9rQv7nL
[vtt] Store it securely — it will not be printed again.
```

After logging in as admin, create a campaign via the UI, generate an invite link, and share it with players.

For development against live-reloaded code:

```bash
pnpm dev        # starts server + client with hot reload
```

For a production-style build:

```bash
pnpm install && pnpm build
node packages/server/dist/index.js
```

---

## Configuration (environment variables)

| Variable | Default | Meaning |
|---|---|---|
| `PORT` | `8080` | HTTP + WebSocket port. |
| `DATA_DIR` | `./data` | Server-owned data directory (users, sessions, invites, memberships). Created automatically. |
| `CAMPAIGNS_DIR` | `./campaigns` | Path to campaign content folders. |
| `ADMIN_USER` | `admin` | Username for the initial admin account. |
| `ADMIN_PASSWORD` | *(generated)* | If unset on first run, a random password is generated and printed once to stdout. |
| `COOKIE_SECURE` | *(unset)* | Set to `true` in production when running behind HTTPS (Cloudflare Tunnel or reverse proxy). |
| `PUBLIC_ORIGIN` | *(unset)* | Full origin URL, e.g. `https://vtt.example.com`. Used to generate invite link URLs. |

---

## Demo Campaign

A complete playable demo campaign — *Shards of the Ashen Throne* — is included in `campaigns/demo-campaign/`. It contains chapters, NPC and PC characters, DM notes, and generated map/art images. Use it as a starting point or as an example when writing your own campaign content.

The campaign folder format is fully documented in [campaigns/demo-campaign/README.md](campaigns/demo-campaign/README.md). That document is the authoritative specification for anyone (or any language model) writing campaign content.

---

## Production Deployment

See [DEPLOY.md](DEPLOY.md) for a step-by-step guide covering:

- Ubuntu 24 server setup
- Node 22 + pnpm installation
- Cloudflare Tunnel configuration (free, no port forwarding required)
- systemd service setup and first-run admin password recovery
- Updating the server and resetting passwords

---

## Roadmap (v2)

- Token layer — drag-and-drop creature tokens on the shared map with position sync.
- Fog of war — DM-controlled vision masking per scene.
- PDF auto-import — upload a campaign PDF and let an LLM pipeline generate the campaign folder structure automatically.
- Condition tracker — track HP, conditions, and initiative order in a live sidebar.
