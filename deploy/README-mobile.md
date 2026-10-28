# City OS Mobile in containers

Two images, one compose file, no registry needed.

```
officers' phones --https--> [host TLS proxy] --http--> 127.0.0.1:19447
                                                        pwa (nginx)  -- /api, /auth --> bff:8002 (FastAPI)
                                                                                         |-> City Help API   (CITY_HELP_API_URL)
                                                                                         '-> Keycloak        (KEYCLOAK_URL)
```

| Image | Source | Notes |
|---|---|---|
| `tapway/city-os-mobile-pwa` | `apps/pwa/Dockerfile` | Node 22 + pnpm build, source maps deleted, served by unprivileged nginx on 8080 |
| `tapway/city-os-mobile-bff` | `apps/bff/Dockerfile` | python 3.11-slim, uid 10001, `/health` healthcheck |

Only the pwa publishes a port, and only on `127.0.0.1` (`MOBILE_PORT`, default **19447**).
The compose project is named `city-os-mobile` so it never collides with City Help's `deploy` project.

## Prerequisites

- Docker Engine 24+ with the compose plugin (v2.20+).
- To build: a git checkout of this repo and a local copy of the private `city-guard` repo.
  To only run: nothing but the two image archives (see "Moving to another server").
- A TLS-terminating reverse proxy on the host (see "TLS in front"). **The app needs HTTPS**:
  the service worker, GPS and install prompt only work in a secure context (https, or `localhost`).
- A reachable City Help API and Keycloak realm (containers on the same docker host, or hosts on the LAN).

## Build

```bash
deploy/build-mobile.sh --city-guard /path/to/city-guard [--ref <git-ref>] [--tag <tag>] [--no-latest]
```

- Builds from `git archive <ref>` (default `HEAD`), so only committed files go in. Tag defaults to the short commit id.
- **Build contexts.** The PWA context is the monorepo root (`docker build -f apps/pwa/Dockerfile .`).
  The BFF context is a scratch folder holding `apps/bff` plus a copy of `city-guard` at `./city-guard`,
  because `apps/bff/Dockerfile` does `COPY city-guard /tmp/city-guard` (private package, no git credentials in the build).
  The script assembles that, stripping `.git`, `.env*`, keys and virtualenvs from the copy, and refuses to build
  if a secret-looking file is still in either context. This is the same pattern City Help's images use.
  Building `apps/bff` directly with plain `docker build` fails at that `COPY` on purpose.
- Tags `…:<tag>` and `…:latest`. Before `latest` moves, the previous `latest` is kept as `…:pre-<tag>` (rollback).
- Wrap in `flock` + `nice` on a shared box. Measured here: ~1m40s cold (base images cached), a few seconds when cached.
- Nothing secret is read or printed; no build args.

## Configure

```bash
sudo install -d -m 700 /etc/city-os
cp deploy/.env.mobile.example /etc/city-os/mobile.env && chmod 600 /etc/city-os/mobile.env
$EDITOR /etc/city-os/mobile.env
```

Keep the env file out of git (the repo ignores `.env.mobile*`). Do not paste `docker compose config` output
anywhere: it prints the resolved values, secrets included. The template lists every key; the ones you must set:

| Key | Meaning |
|---|---|
| `PWA_ORIGINS` | The public https origin(s), exactly as typed in the browser, no trailing slash. CORS and the login origin check use it. |
| `KEYCLOAK_URL` | Realm base **reachable from the bff container**, e.g. `http://deploy-keycloak-1:8080/realms/city-os`. |
| `KEYCLOAK_CLIENT_ID` / `KEYCLOAK_CLIENT_SECRET` | The mobile client. Secret empty for a public client (the current demo client has none). |
| `CITY_HELP_API_URL` | e.g. `http://deploy-api-1:8001` (same docker network) or `http://10.0.0.5:8001` (LAN). |
| `COOKIE_SECURE` | `true` (default in compose). Needs https in front. |
| `UPSTREAM_NETWORK` | Optional. Name of an existing docker network to join, e.g. `deploy_default` when City Help runs on this host. Empty = not used. |
| `MINIO_*` | Optional; evidence-photo uploads stay disabled unless endpoint + both keys are set. |

`localhost:8001` in an env file means the bff container itself. To reach a service on the docker host use
`host.docker.internal` (mapped for you), but note a service bound only to the host's `127.0.0.1` is not reachable
that way: join its network with `UPSTREAM_NETWORK` instead.

## Run, check, stop

```bash
C="docker compose -f deploy/docker-compose.mobile.yml --env-file /etc/city-os/mobile.env"
$C up -d                       # start (or apply a changed env file / new MOBILE_TAG)
$C ps                          # both should say (healthy)
curl -si http://127.0.0.1:19447/nginx-health        # pwa: 200 ok
curl -s  http://127.0.0.1:19447/auth/config         # through to the bff: {"mode":"password"}
docker exec city-os-mobile-bff-1 python -c "import urllib.request as u;print(u.urlopen('http://127.0.0.1:8002/health').read().decode())"
$C logs -f bff
$C down                        # stop and remove containers; images are kept
```

The BFF's `/health` is internal only (the pwa does not proxy it) and does no upstream calls; it reports
`uploads_enabled` and the configured `pwa_origins`, which is the quickest way to spot a wrong env file.

Browser smoke test (read-only; needs `pnpm install` at the repo root): see the header of `deploy/smoke-mobile.cjs`.

### Update and roll back one service

```bash
# deploy a new build
deploy/build-mobile.sh --city-guard /path/to/city-guard --tag 2026-10-29a
$C up -d --no-deps --force-recreate bff pwa     # --no-deps: touch only what you name

# roll back to the previous build (kept as pre-<tag>)
docker tag tapway/city-os-mobile-bff:pre-2026-10-29a tapway/city-os-mobile-bff:latest
docker tag tapway/city-os-mobile-pwa:pre-2026-10-29a tapway/city-os-mobile-pwa:latest
$C up -d --no-deps --force-recreate bff pwa
# or pin a tag instead: set MOBILE_TAG=<tag> in the env file and `up -d`
```

Recreating `bff` signs nobody out (the session is a Keycloak refresh token in a cookie), but in-flight requests fail once.
The pwa resolves `bff` per request, so it follows a recreated bff without a restart.

## TLS in front (host's job; no certificates here)

The proxy must terminate TLS and send **`Host`**, **`X-Forwarded-Proto: https`** and **`X-Forwarded-For`**
(set to the client address, *replacing* any client-supplied value, because the BFF rate limiter keys on its first entry).
The pwa container passes them to the BFF, and the BFF runs uvicorn with `--proxy-headers`, so redirects keep `https`.

nginx:

```nginx
server {
    listen 443 ssl;
    server_name mobile.example.org;
    ssl_certificate     /etc/ssl/mobile.example.org/fullchain.pem;
    ssl_certificate_key /etc/ssl/mobile.example.org/privkey.pem;
    add_header Strict-Transport-Security "max-age=31536000" always;
    client_max_body_size 10m;                       # evidence photos

    location / {
        proxy_pass http://127.0.0.1:19447;
        proxy_http_version 1.1;
        proxy_set_header Host              $host;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_set_header X-Forwarded-For   $remote_addr;   # overwrite, do not append
    }
}
```

Caddy (sets the forwarded headers itself, replacing client-supplied ones by default):

```
mobile.example.org {
    reverse_proxy 127.0.0.1:19447
}
```

Then set `PWA_ORIGINS=https://mobile.example.org` and `COOKIE_SECURE=true`. If the proxy is on another machine,
change the compose port mapping to that machine's interface deliberately; the default is loopback only.

## Moving to another server (no registry)

```bash
TAG=2026-10-29a
docker save tapway/city-os-mobile-pwa:$TAG tapway/city-os-mobile-bff:$TAG | gzip > city-os-mobile-$TAG.tar.gz   # ~90 MB
scp city-os-mobile-$TAG.tar.gz deploy/docker-compose.mobile.yml deploy/.env.mobile.example deploy/README-mobile.md user@server:
# on the server
gunzip -c city-os-mobile-$TAG.tar.gz | docker load
# fill the env file (MOBILE_TAG=$TAG), then `$C up -d`
```

Copy the compose file and the env template, never your filled env file from another environment.

## What the Keycloak alias was, and why the container does not need it

`apps/pwa/e2e/support/keycloak-alias.mjs` (run by the demo's systemd unit on :8080) is a tiny TCP relay
`127.0.0.1:8080 -> 127.0.0.1:7080`. It exists because the `city-os` realm pins `frontendUrl` to the Docker container name
`http://deploy-keycloak-1:8080`, so Keycloak writes that unresolvable name into its hosted sign-in page.
Only a browser that follows a redirect to Keycloak (**`AUTH_MODE=pkce`**) ever sees it; the file's own header
calls it "a development shim only ... not part of any deployment" and Playwright maps the name to 127.0.0.1.

With **`AUTH_MODE=password`** (the default, and what the demo runs: `/auth/config` answers `password`) the PWA shows its own
form and the BFF does the OAuth password grant against `KEYCLOAK_URL` server-side. The browser never talks to Keycloak,
so the alias, `KEYCLOAK_PUBLIC_URL` and the realm's container hostname are irrelevant. **The container build does not
include or need the alias.** It would only matter if a site switches to `pkce`.

## Open points before a DBKL install

- **Keycloak issuer / public URL.** City Help validates the token `iss`, which Keycloak derives from the realm
  `frontendUrl` / hostname config, not from the URL the BFF calls. The bff may use any reachable `KEYCLOAK_URL`, but
  the realm's issuer must be what City Help expects. For `pkce` the realm needs a browser-reachable `frontendUrl`
  (or a same-origin proxy; see `docs/testing.md`). Not solved here, not needed in `password` mode.
- **Password grant.** The Keycloak client must allow "direct access grants". Confirm on the target realm.
- **HTTPS is mandatory** for the service worker and GPS; use a real certificate (an untrusted one blocks the worker).
  Hostname and certificate are DBKL IT's call.
- **`city-guard` in the BFF image.** `apps/bff/Dockerfile` installs it, but nothing in `apps/bff/src` imports it
  (`tests/test_packaging.py` pins that). It adds most of the BFF image's size; dropping the `COPY`/`pip install` lines
  would remove the sibling-repo requirement entirely. Left as is on instruction.
- **Network reach.** The bff must reach City Help, Keycloak and (optionally) MinIO; firewalls and DNS on the target are unknown.
- **Time and persistence.** The stack keeps no state of its own (no volumes); the rate limiter is in memory and resets on restart.
