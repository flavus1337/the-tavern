# Production Deployment Guide

This guide covers deploying VTT on an always-on Ubuntu 24 machine (laptop, mini PC, or server) with a Cloudflare Tunnel for public HTTPS access — no port forwarding, no static IP required.

---

## Quick start (scripts)

The two scripts in `deploy/` automate the common path:

```bash
git clone git@github.com:PYannik/the-tavern.git && cd the-tavern
./deploy/setup-ubuntu.sh        # one-time: Node 22, pnpm, cloudflared, build
ADMIN_PASSWORD='choose-a-password' ./deploy/start.sh
```

`start.sh` is a thin wrapper around the cross-platform launcher `deploy/start.mjs` — on macOS (`brew install cloudflared`) or Windows (`winget install Cloudflare.cloudflared`) run `node deploy/start.mjs` directly after `pnpm install && pnpm -r build`. It launches a Cloudflare **quick tunnel** (new random URL each start — printed in a banner), then the server with `PUBLIC_ORIGIN` wired so invite links point at the tunnel. World data lives in `./live/` (gitignored); copy an existing `live/` folder in before the first start to migrate a world. Ctrl-C stops both.

For a **permanent URL** and autostart on boot, follow the named-tunnel + systemd sections below instead of `start.sh`.

---

## 1. Install Node 22

Use the NodeSource repository for a system-wide install:

```bash
curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
sudo apt-get install -y nodejs
node --version   # should print v22.x.x
```

Alternatively, use nvm:

```bash
curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.39.7/install.sh | bash
source ~/.bashrc
nvm install 22
nvm use 22
nvm alias default 22
```

---

## 2. Install pnpm

```bash
npm install -g pnpm@9
pnpm --version   # should print 9.x.x
```

---

## 3. Clone the Repository

```bash
sudo mkdir -p /opt/vtt
sudo chown $USER:$USER /opt/vtt
git clone <repo-url> /opt/vtt
cd /opt/vtt
```

---

## 4. Install Dependencies and Build

> **Important:** Always build on the target machine. The `sharp` image-processing library includes native binaries compiled for the host OS and architecture. **Never copy `node_modules/` from a macOS machine to a Linux server.** Even if the machine architectures match, glibc differences will cause `sharp` to fail to load.

```bash
cd /opt/vtt
pnpm install        # installs all workspace dependencies, compiles sharp for Linux
pnpm build          # transpiles server and client to dist/
```

If you see a `sharp` error during install, force a rebuild:

```bash
cd /opt/vtt
pnpm rebuild sharp
```

---

## 5. Create Data Directories

```bash
mkdir -p /opt/vtt/data
mkdir -p /opt/vtt/campaigns
```

The `campaigns/` directory in the repo is already present. The `data/` directory is created automatically on first run, but creating it now avoids a permission issue if the service user does not own `/opt/vtt`.

---

## 6. Install the systemd Service

Copy and edit the service unit:

```bash
sudo cp /opt/vtt/deploy/vtt.service /etc/systemd/system/vtt.service
sudo nano /etc/systemd/system/vtt.service
```

Replace `<youruser>` with your actual Linux username (the user that will own the process — not root). Update `PUBLIC_ORIGIN` and any other environment values as needed. See the file comments for detail.

Reload systemd, enable, and start:

```bash
sudo systemctl daemon-reload
sudo systemctl enable vtt
sudo systemctl start vtt
```

Check status and read the first-run admin password:

```bash
sudo systemctl status vtt
sudo journalctl -u vtt -f
```

Look for a line like:

```
[vtt] First run: admin password set to: Xk3mP9rQv7nL
```

**Copy this password immediately.** It is printed only once to the journal. If you miss it, see the Password Reset section below.

---

## 7. Install Cloudflare Tunnel

Cloudflare Tunnel routes public HTTPS traffic to your local server without opening any firewall ports.

### Install cloudflared

```bash
curl -L https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-arm64.deb \
  -o /tmp/cloudflared.deb
# For x86_64: use cloudflared-linux-amd64.deb
sudo dpkg -i /tmp/cloudflared.deb
cloudflared --version
```

### Authenticate

```bash
cloudflared tunnel login
```

This opens a browser link. Authorize access to your Cloudflare account. A certificate is saved to `~/.cloudflared/`.

### Create the tunnel

```bash
cloudflared tunnel create vtt
```

Note the tunnel UUID printed to the terminal (e.g. `a1b2c3d4-...`).

### Create the tunnel config file

```bash
mkdir -p ~/.cloudflared
nano ~/.cloudflared/config.yml
```

Paste and edit the following (replace `<TUNNEL-UUID>` and `<your-domain>`):

```yaml
tunnel: <TUNNEL-UUID>
credentials-file: /home/<youruser>/.cloudflared/<TUNNEL-UUID>.json

ingress:
  - hostname: vtt.<your-domain>
    service: http://localhost:8080
  - service: http_status:404
```

### Route a (sub)domain to the tunnel

```bash
cloudflared tunnel route dns vtt vtt.<your-domain>
```

This creates a CNAME record in Cloudflare DNS pointing `vtt.<your-domain>` to the tunnel.

### Install cloudflared as a system service

```bash
sudo cloudflared --config /home/<youruser>/.cloudflared/config.yml service install
sudo systemctl enable cloudflared
sudo systemctl start cloudflared
sudo systemctl status cloudflared
```

---

## 8. Enable Secure Cookies and Public Origin

Now that HTTPS is active, update the systemd service to set the two production environment variables:

```bash
sudo nano /etc/systemd/system/vtt.service
```

Uncomment or edit these two lines:

```ini
Environment=COOKIE_SECURE=true
Environment=PUBLIC_ORIGIN=https://vtt.<your-domain>
```

Reload and restart:

```bash
sudo systemctl daemon-reload
sudo systemctl restart vtt
```

Verify at `https://vtt.<your-domain>` — the login page should load over HTTPS with a valid Cloudflare certificate.

---

## 9. Updating

```bash
cd /opt/vtt
git pull
pnpm install        # picks up any new/changed dependencies, rebuilds native modules for Linux
pnpm build          # recompiles server and client
sudo systemctl restart vtt
```

---

## 10. Password Reset

If you lose the admin password (or any user's password), the recovery procedure is:

1. Stop the server:
   ```bash
   sudo systemctl stop vtt
   ```

2. Edit the users file. Users are stored as JSON in `DATA_DIR/users.json` (default `/opt/vtt/data/users.json`). Open it with a text editor:
   ```bash
   nano /opt/vtt/data/users.json
   ```

3. To force a new random admin password: **remove the entire entry for the `admin` user** from the array, or delete the entire `users.json` file. On next start, the server detects zero users and recreates the admin account with a new random password, printing it to the journal.

4. To reset a specific user: remove only that user's entry from the array. The user will not be able to log in until re-invited; their campaign membership is preserved separately in `memberships.json`.

5. Start the server and read the journal:
   ```bash
   sudo systemctl start vtt
   sudo journalctl -u vtt -n 50
   ```

---

## 11. Troubleshooting

### Port already in use

```
Error: listen EADDRINUSE :::8080
```

Another process is on port 8080. Change `PORT` in the service unit to an unused port (e.g. `8090`) and update the cloudflared `config.yml` ingress service URL to match.

### sharp fails to load (`Could not load the "sharp" module`)

Run a forced rebuild of native modules:

```bash
cd /opt/vtt
pnpm rebuild sharp
sudo systemctl restart vtt
```

If still failing, delete `node_modules` and reinstall:

```bash
rm -rf node_modules packages/*/node_modules
pnpm install
pnpm build
sudo systemctl restart vtt
```

### Cloudflare Tunnel 502 Bad Gateway

The tunnel can reach Cloudflare but the local server is not responding on port 8080.

```bash
sudo systemctl status vtt          # is the service running?
sudo journalctl -u vtt -n 100      # any startup errors?
curl http://localhost:8080/api/health   # does the server respond locally?
```

If the server is not running, check the journal for the startup error. Common causes: wrong `WorkingDirectory`, missing `dist/` (forgot `pnpm build`), Node version mismatch.

---

## File Locations Summary

| Path | Meaning |
|---|---|
| `/opt/vtt/` | Application root (cloned repo). |
| `/opt/vtt/data/` | Server-owned runtime data (users, sessions, invites, memberships). |
| `/opt/vtt/campaigns/` | Campaign content folders. |
| `/opt/vtt/packages/server/dist/index.js` | Compiled server entry point. |
| `/etc/systemd/system/vtt.service` | systemd unit. |
| `~/.cloudflared/config.yml` | Cloudflare Tunnel configuration. |
| `~/.cloudflared/<UUID>.json` | Tunnel credentials (keep this file safe). |
