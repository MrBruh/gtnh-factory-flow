# Self-hosting GTNH Factory Flow on your home server

This deploys the app as a **second site alongside your portfolio** on the same Ubuntu
box, behind the same Cloudflare Tunnel and the same `webhook` daemon. It follows the
exact pattern documented for the portfolio (`mdnssv-portfolio/docs/archive/`), so the
mental model is identical — only the names, port, and one extra step (the recipe
dataset) differ.

**Target end state**

| Thing          | Value                                                                  |
| -------------- | ---------------------------------------------------------------------- |
| Public URL     | `https://gtnh.denissov.tech`                                           |
| App bind       | `127.0.0.1:3001` (loopback only; tunnel is the sole inbound path)      |
| Checkout dir   | `/srv/gtnh-factory-flow` (admin-owned)                                 |
| Runtime user   | `gtnhflow` (dedicated, unprivileged, no login)                         |
| systemd unit   | `gtnh-factory-flow.service`                                            |
| Dataset volume | `/srv/data/gtnh-factory-flow/datasets/gtnh` (self-host mode only)      |
| Auto-deploy    | push to `main` → existing `webhook.denissov.tech` daemon → `deploy.sh` |

**Reused from the portfolio setup (no new work):** the Ubuntu host, Node 20, the
Cloudflare Tunnel, the `webhook` daemon on `127.0.0.1:9000`, and its
`webhook.denissov.tech` route. **New:** one runtime user, one systemd service, one
tunnel hostname, one extra hook in the existing `hooks.json`, one GitHub webhook, and
the dataset.

Templates referenced below live in this repo under `deploy/`. Replace `serveradmin`
with your actual admin/login user if different.

---

## 1. Runtime user and directories

```bash
sudo useradd --system --no-create-home --shell /usr/sbin/nologin gtnhflow
sudo mkdir -p /srv/gtnh-factory-flow
sudo chown "$USER:$USER" /srv/gtnh-factory-flow
```

## 2. Deploy key, clone, first build

The fork is private, so the server needs a read-only deploy key. If you already added
one host alias for the portfolio, give this repo its own key to keep them independent:

```bash
ssh-keygen -t ed25519 -f ~/.ssh/github_gtnh -N "" -C "homeserver-gtnh-deploy"
cat ~/.ssh/github_gtnh.pub
```

Add the printed key under **GitHub → MrBruh/gtnh-factory-flow → Settings → Deploy keys**
(leave write access off). Then tell SSH to use it for this repo via a host alias:

```bash
cat >> ~/.ssh/config <<'EOF'

Host github-gtnh
  HostName github.com
  User git
  IdentityFile ~/.ssh/github_gtnh
  IdentitiesOnly yes
EOF
chmod 600 ~/.ssh/config

git clone git@github-gtnh:MrBruh/gtnh-factory-flow.git /srv/gtnh-factory-flow
cd /srv/gtnh-factory-flow
git checkout main
```

> The `deploy.sh` template uses plain `origin`, which resolves through this host alias
> because the clone URL already embeds `github-gtnh`.

Don't build yet — decide the dataset first (next step), because the build can bake in
`GTNH_DATASET_BACKEND_URL`.

## 3. The recipe dataset — pick one

The app is useless without a dataset, and **none ships in git**. Two ways:

### Option A — Proxy upstream (recommended to go live fast)

Forward dataset traffic to an existing public deployment. No local volume, no seeding.
Set this in the env file (step 4):

```bash
GTNH_DATASET_BACKEND_URL=https://gtnh.samiracle.fr
```

`next.config.ts` then rewrites both `/datasets/gtnh/*` and `/api/datasets/*` (search,
pagination, prewarm) to that backend. Trade-off: your site depends on that upstream's
uptime, and it's a bit parasitic for a permanent public prod — fine for a personal
instance and for solver-integration work. Skip to step 4.

### Option B — Self-host the dataset (fully independent)

Populate the persistent volume; `deploy.sh` symlinks it into each build automatically.
Minimal seed (recipe data only — icons stay blank without textures, which is fine for
planning and for the solver handoff):

```bash
VOL=/srv/data/gtnh-factory-flow/datasets/gtnh
UP=https://gtnh.samiracle.fr/datasets/gtnh
sudo mkdir -p "$VOL"; sudo chown "$USER:$USER" "$VOL"
curl -fsSL "$UP/datasets.manifest.json" -o "$VOL/datasets.manifest.json"
# pull each version's recipe file referenced by the manifest
jq -r '.versions[].recipeDatasetPath' "$VOL/datasets.manifest.json" | while read -r p; do
  mkdir -p "$VOL/$(dirname "$p")"
  curl -fsSL "$UP/$p" -o "$VOL/$p"
done
```

Full icon textures have no HTTP directory listing, so a complete mirror isn't practical
over plain HTTP — either accept blank icons, `rsync` the `textures/` tree from a machine
that already has it, or regenerate everything with the dataset pipeline
(`tools/dataset-pipeline/`, recoverable from git history if you want the old workflow
back). Leave `GTNH_DATASET_BACKEND_URL` unset for this mode.

## 4. Environment file (optional)

Copy the template and edit. Omit the file entirely if you chose Option B with no
analytics.

```bash
sudo cp /srv/gtnh-factory-flow/deploy/gtnh-factory-flow.env.example /etc/gtnh-factory-flow.env
sudo nano /etc/gtnh-factory-flow.env   # uncomment GTNH_DATASET_BACKEND_URL for Option A
```

## 5. systemd service

```bash
sudo cp /srv/gtnh-factory-flow/deploy/gtnh-factory-flow.service \
        /etc/systemd/system/gtnh-factory-flow.service
sudo systemctl daemon-reload
```

The unit runs `node server.js` from `.next/standalone` as `gtnhflow`, binds
`127.0.0.1:3001`, and treats the env file as optional. Don't `enable --now` yet — there's
no build to run. Do the first build via `deploy.sh` in step 8.

## 6. Cloudflare Tunnel hostname

In the dashboard: **Zero Trust → Networks → Tunnels → portfolio → Public Hostname →
Add a public hostname** (reusing the tunnel that already serves the portfolio):

- Subdomain: `gtnh`
- Domain: `denissov.tech`
- Type: `HTTP`
- URL: `localhost:3001`

Cloudflare auto-creates the `gtnh.denissov.tech` CNAME and terminates TLS at the edge.

## 7. Passwordless restart (sudoers)

The webhook daemon has no TTY, so the restart at the end of `deploy.sh` must not prompt:

```bash
echo "$USER ALL=(root) NOPASSWD: /usr/bin/systemctl restart gtnh-factory-flow" \
  | sudo tee /etc/sudoers.d/gtnh-factory-flow-restart
sudo chmod 440 /etc/sudoers.d/gtnh-factory-flow-restart
sudo visudo -c
sudo -K && sudo -n /usr/bin/systemctl restart gtnh-factory-flow && echo OK   # expect: OK (service not yet started is fine)
```

## 8. Install deploy.sh and run the first deploy

Copy the script **out of the tracked checkout** so `git reset --hard` can't rewrite it
mid-run (same reason the portfolio keeps it at `/srv/portfolio/deploy.sh`):

```bash
install -m 755 /srv/gtnh-factory-flow/deploy/deploy.sh /srv/gtnh-factory-flow/deploy.sh
/srv/gtnh-factory-flow/deploy.sh        # first build + symlink + restart
sudo systemctl enable gtnh-factory-flow # start on boot from now on
```

If the build runs out of memory on the home box, the script already sets
`NODE_OPTIONS=--max-old-space-size=4096`; lower the systemd `PORT`/memory or add swap as
needed.

## 9. Auto-deploy via the existing webhook daemon

Add a **second hook** to the array in `/etc/webhook/hooks.json` (the file the portfolio
already uses). The template is `deploy/webhook-hook.json` — drop its object in next to
`deploy-portfolio`, set the secret to your existing `~/.webhook-secret` value (reuse it),
and remove the `_comment` line:

```bash
nano /etc/webhook/hooks.json          # paste the object as a 2nd array element
sudo systemctl restart webhook
```

No new tunnel route is needed — `webhook.denissov.tech` already points at this daemon.

## 10. GitHub webhook

**GitHub → MrBruh/gtnh-factory-flow → Settings → Webhooks → Add webhook:**

- Payload URL: `https://webhook.denissov.tech/hooks/deploy-gtnh-factory-flow`
- Content type: `application/json`
- Secret: the same value you put in the hook
- Events: _Just the push event_

GitHub's `ping` returns `HTTP 200` / `Hook rules were not satisfied.` (no `ref` on a
ping) — that confirms HMAC matched. Now every push to `main` redeploys in ~30–60s.

---

## Verify

```bash
curl -I https://gtnh.denissov.tech
# on the server, if anything is off:
sudo journalctl -u gtnh-factory-flow -f
sudo journalctl -u webhook -f
```

Open `https://gtnh.denissov.tech`, confirm the recipe browser loads recipes (proves the
dataset path), place a node, and **Export** a plan — that JSON is exactly what
`gtnh-process-line-solver` consumes.

## Operating notes

- **Deploy branch:** `deploy.sh` and the webhook hook are pinned to `main`. Work on
  `develop`, fast-forward `main` when you want prod to move (matches the portfolio's
  `main`-is-production model and this repo's `AGENTS.md`).
- **Manual deploy:** `ssh homeserver /srv/gtnh-factory-flow/deploy.sh`.
- **Switching dataset modes later:** edit `/etc/gtnh-factory-flow.env` and re-run
  `deploy.sh` (the var is read at build time).
- **Two apps, one box:** nothing here touches the portfolio — separate user, port,
  service, checkout, and tunnel hostname; only the tunnel and webhook daemon are shared.
