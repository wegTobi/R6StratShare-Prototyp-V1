# Selfhosting on Linux with Docker

This runs the editor and JSON viewer on your own server. Accounts and database
writes are disabled in this build. JSON files remain the way to keep and share
strats. Google sign-in and account storage are a separate future change.

## Requirements

- Linux with Docker Engine and the Docker Compose plugin.
- The complete current project, including public assets and pnpm-lock.yaml.
  A Git clone does not include uncommitted work from the development machine.
- A domain active in Cloudflare DNS and a remotely managed Cloudflare Tunnel.

No Node installation on the host, database, published application port, router
port forwarding, or additional reverse proxy is required for Docker deployment.

## Configure

Run from the project directory:

```sh
cp selfhost.env.example .env
mkdir -p secrets
chmod 700 secrets
```

Set `R6_SITE_URL` in `.env` to the actual public origin, for example
`https://strats.your-domain.de`, without a path. This is a runtime setting;
changing the domain does not require rebuilding the image.

Use a trusted editor on the server to put **only the tunnel token** in
`secrets/tunnel-token`. Do not paste the full Docker command. Keep the token out
of terminal history, Git, screenshots, and messages.

```sh
chmod 644 secrets/tunnel-token
```

The token file must be readable by the tunnel container's non-root user. The
parent directory's `700` permissions prevent other host users from traversing
it. Compose mounts only this file into the tunnel container as a read-only
secret; it is not mounted into the app or included in the image. An external
token-file path can instead be set with `R6_TUNNEL_TOKEN_FILE` in `.env`; protect
its parent directory the same way. `.env` and `secrets/` are ignored by Git and
excluded from the Docker build context.

In Cloudflare, add a published application route:

- Hostname: the hostname from `R6_SITE_URL`.
- Service type: HTTP.
- Service URL: `r6-app:3000` (full internal URL: `http://r6-app:3000`).
- Leave HTTP Host Header overrides unset so the public hostname is preserved.

The tunnel token authenticates the connector. It does not provide application
sign-in. With no Cloudflare Access policy, anyone who knows the URL can open
the editor; friends do not need a Cloudflare account.

## Build and start

```sh
docker compose config --quiet
docker compose up -d --build
docker compose ps
docker compose logs --tail=100 r6-app cloudflared
```

The app runs as an unprivileged user. Its network is internal; only the tunnel
also has outbound network access. Neither service publishes a host port.
The tunnel waits for the app health check before starting. Both services use
`restart: unless-stopped`; Docker itself must start on boot. The server must
stay awake and connected to the internet.

Open the HTTPS URL from another network, for example mobile data. Check editor
setup, maps, operator icons, drawing, JSON export/import and the read-only viewer.
Accounts should show “Coming soon” with no ChatGPT sign-in link. Account writes
return HTTP 503, and identity headers are ignored.

To check the app from inside its container:

```sh
docker compose exec r6-app node -e "fetch('http://127.0.0.1:3000/api/account').then(async r=>console.log(r.status,await r.text()))"
```

Stop, start, or restart the installation:

```sh
docker compose down
docker compose up -d
docker compose restart
```

After changing `.env`, use `docker compose up -d` to recreate affected containers;
`restart` alone does not apply changed environment variables. A healthy app with
a failing tunnel generally points to the token, outbound connectivity or the
Cloudflare route. Inspect each service's logs separately. Containers do not
automatically rebuild or update, and no backup automation is installed.

## Run and test without Docker

Use Node.js 24 and pnpm 11.16.0:

```sh
pnpm install --frozen-lockfile
pnpm run build:selfhost
R6_SITE_URL=https://strats.your-domain.de HOST=127.0.0.1 PORT=3000 pnpm run start:selfhost
```

The start script verifies that the server bundle matches the selfhosting build.
The public origin configures metadata and the single trusted forwarded hostname
for the tunnel. Only use trusted proxies in front of this server. HTTP is also
accepted as the configured origin for local development.

```sh
pnpm run test:selfhost
node --test tests/rendered-html.test.mjs
```

The integration tests launch the real Node production server and check HTML,
client scripts, fonts, public assets and disabled account endpoints, including
forged identity headers. Windows development uses narrowly scoped workarounds
for Vinext 0.0.50's font-path and static-cache separator issues; Linux uses the
normal production server.

For an optional browser smoke test with an installed Playwright CLI and browser,
open the running app in a dedicated CLI session, then execute
`playwright-cli -s=r6selfhost run-code --filename=tests/browser/selfhost-smoke.js`.
The script uses that session's current origin. It checks role/notes/operator
editing, clipboard JSON export, viewer import, visible images and the account
notice. Run it only against a disposable browser session; it changes the current
strat and clipboard. Use HTTPS or localhost for clipboard support.

The original `pnpm run build` remains the Cloudflare/Sites build. Both targets
currently use `dist/`, so build and test them sequentially. Never deploy the
selfhosting output to Sites. Before creating a Sites deployment, rebuild with
the original `pnpm run build` command.

References: [Vinext Node server](https://github.com/cloudflare/vinext),
[Cloudflare Tunnel setup](https://developers.cloudflare.com/tunnel/get-started/),
[tunnel token files](https://developers.cloudflare.com/cloudflare-one/networks/connectors/cloudflare-tunnel/configure-tunnels/run-parameters/).
