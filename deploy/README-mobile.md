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
- To build: a plain `git clone` of this repo (nothing else) and internet access to docker.io, npm and PyPI.
  To only run: nothing but the two image archives (see "Moving to another server").
- A TLS-terminating reverse proxy on the host (see "TLS in front"). **The app needs HTTPS**:
  the service worker, GPS and install prompt only work in a secure context (https, or `localhost`).
- A reachable City Help API and Keycloak realm (containers on the same docker host, or hosts on the LAN).

## Build

```bash
deploy/build-mobile.sh [--ref <git-ref>] [--tag <tag>] [--no-latest]
```

- Builds from `git archive <ref>` (default `HEAD`), so only committed files go in. Tag defaults to the short commit id.
- **Build contexts.** The PWA context is the monorepo root (`docker build -f apps/pwa/Dockerfile .`); the BFF
  context is `apps/bff` (`docker build apps/bff`). The script builds both from the archive and refuses to build
  if a secret-looking file (`.env`, keys) is in it.
- **Tags.** The script refuses to run if `…:<tag>` or `…:pre-<tag>` already exists for either image (it prints the `docker rmi`
  to remove them, or pick another `--tag`). Both images are built tagged only `:<tag>`; only when BOTH succeed does it
  retag the previous `latest` to `…:pre-<tag>` (rollback) and then move `latest` to `<tag>`. A failed build moves no tag.
- Wrap in `flock` + `nice` on a shared box. Measured here: ~1m40s cold (base images cached), a few seconds when cached.
- Nothing secret is read or printed. The script prints the digests of the base images it used.

## Configure

The env file holds secrets (Keycloak client secret, MinIO keys). It must be readable by **whoever runs `docker compose`**
(compose reads it on the client side; the containers never see the file, only the resolved variables). For a user in the
`docker` group, own the directory and file as that user:

```bash
sudo install -d -m 750 -o "$USER" -g "$USER" /etc/city-os
install -m 600 deploy/.env.mobile.example /etc/city-os/mobile.env    # created by you, mode 600, owned by you
$EDITOR /etc/city-os/mobile.env
```

If a different account runs compose (for example a service user or root via systemd), change `-o`/`chown` to that account.
Nobody else needs read access.

Keep the env file out of git (the repo ignores `.env.mobile*`). Do not paste `docker compose config` output
anywhere: it prints the resolved values, secrets included. The template lists every key; the ones you must set:

| Key | Meaning |
|---|---|
| `PWA_ORIGINS` | The public https origin(s), exactly as typed in the browser, no trailing slash. CORS and the login origin check use it. |
| `KEYCLOAK_URL` | Realm base **reachable from the bff container**, e.g. `http://deploy-keycloak-1:8080/realms/city-os`. |
| `KEYCLOAK_CLIENT_ID` / `KEYCLOAK_CLIENT_SECRET` | The mobile client. Secret empty for a public client (the current demo client has none). |
| `CITY_HELP_API_URL` | e.g. `http://deploy-api-1:8001` (same docker network) or `http://10.0.0.5:8001` (LAN). |
| `COOKIE_SECURE` | `true` (default in compose). Needs https in front. |
| `UPSTREAM_NETWORK` | Optional. Existing docker network for the bff to join, e.g. `deploy_default` when City Help runs on this host. Only read when you add `-f deploy/docker-compose.mobile.upstream.yml` (see below). |
| `MINIO_*` | Optional; evidence-photo uploads stay disabled unless endpoint + both keys are set. |

`localhost:8001` in an env file means the bff container itself. To reach a service on the docker host use
`host.docker.internal` (mapped for you), but note a service bound only to the host's `127.0.0.1` is not reachable
that way: join its network instead, by adding the override file to every compose command:
`-f deploy/docker-compose.mobile.yml -f deploy/docker-compose.mobile.upstream.yml` with `UPSTREAM_NETWORK=deploy_default`.
(Compose cannot attach an optional network from one file, hence the second file.)

## Run, check, stop

```bash
C="docker compose -f deploy/docker-compose.mobile.yml --env-file /etc/city-os/mobile.env"   # from a repo checkout; on a server without the repo see "Moving to another server"
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
deploy/build-mobile.sh --tag 2026-10-29a
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

nginx (`/etc/nginx/conf.d/mobile.conf`):

```nginx
server {
    listen 80;
    server_name mobile.example.org;
    return 301 https://$host$request_uri;            # http -> https
}

server {
    listen 443 ssl;
    server_name mobile.example.org;
    server_tokens off;
    ssl_certificate     /etc/ssl/mobile.example.org/fullchain.pem;
    ssl_certificate_key /etc/ssl/mobile.example.org/privkey.pem;
    add_header Strict-Transport-Security "max-age=31536000" always;
    client_max_body_size 10m;                       # evidence photos

    location / {
        proxy_pass http://127.0.0.1:19447;
        proxy_http_version 1.1;
        proxy_set_header Host              $http_host;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_set_header X-Forwarded-For   $remote_addr;   # overwrite, do not append
    }
}
```

Enable it: `sudo nginx -t && sudo systemctl reload nginx` (test first; reload only if the test passes).
If there is already another proxy or load balancer in front of this one, set the real client address with
`set_real_ip_from <proxy address>; real_ip_header X-Forwarded-For;` (ngx_http_realip_module) so `$remote_addr` is the
client and not the previous hop; otherwise the BFF rate limiter sees one shared address.

Caddy (sets the forwarded headers itself, replacing client-supplied ones by default):

```
mobile.example.org {
    reverse_proxy 127.0.0.1:19447
}
```

Caddy's automatic HTTPS needs the name to be publicly resolvable and reachable for ACME (Let's Encrypt / ZeroSSL). For an
internal hostname with an internal CA, use `tls /path/cert.pem /path/key.pem` or Caddy's `internal` issuer and make sure
every handset trusts that CA; that is a different setup from the one-line example above.

Then set `PWA_ORIGINS=https://mobile.example.org` and `COOKIE_SECURE=true`. If the proxy is on another machine,
change the compose port mapping to that machine's interface deliberately; the default is loopback only.

## Moving to another server (no registry)

On the build machine, from the repo checkout (`TAG` is the tag you built):

```bash
TAG=2026-10-29a
docker save tapway/city-os-mobile-pwa:$TAG tapway/city-os-mobile-bff:$TAG | gzip > city-os-mobile-$TAG.tar.gz   # ~85 MB
scp city-os-mobile-$TAG.tar.gz deploy/docker-compose.mobile.yml deploy/docker-compose.mobile.upstream.yml \
    deploy/.env.mobile.example user@server:/tmp/
```

On the server (needs docker with the compose plugin; no repo, no registry):

```bash
# 1. a directory for the compose files, and one for the env file
sudo install -d -m 755 -o "$USER" -g "$USER" /opt/city-os-mobile
sudo install -d -m 750 -o "$USER" -g "$USER" /etc/city-os
mv /tmp/docker-compose.mobile.yml /tmp/docker-compose.mobile.upstream.yml /opt/city-os-mobile/

# 2. load the images
gunzip -c /tmp/city-os-mobile-2026-10-29a.tar.gz | docker load        # prints the two tapway/city-os-mobile-*:<tag> names

# 3. create the env file from the template (mode 600) and edit it
install -m 600 /tmp/.env.mobile.example /etc/city-os/mobile.env       # scp put it in /tmp
$EDITOR /etc/city-os/mobile.env

# 4. set MOBILE_TAG in that file to the tag step 2 loaded (this is NOT automatic; the default "latest" does not exist here)
grep '^MOBILE_TAG=' /etc/city-os/mobile.env       # must read MOBILE_TAG=2026-10-29a

# 5. define the compose command for this server and start
cd /opt/city-os-mobile
C="docker compose -f docker-compose.mobile.yml --env-file /etc/city-os/mobile.env"
$C up -d && $C ps
```

To join an existing docker network on that host, add `-f docker-compose.mobile.upstream.yml` to `C` and set `UPSTREAM_NETWORK`.
Copy the template, never a filled env file from another environment. To upgrade later: load the new archive, change `MOBILE_TAG`,
`$C up -d`; the previous tag is still loaded, so rolling back is changing `MOBILE_TAG` back.

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
- **Floating base images.** `node:22-alpine`, `nginxinc/nginx-unprivileged:1.27-alpine` and `python:3.11-slim` are tags, so two
  builds on different days can differ. The build prints the digest of each base image it used: keep that in the build log.
  To pin, pass digests (works for the script and for plain `docker build --build-arg`):
  `NODE_IMAGE=node:22-alpine@sha256:<digest> NGINX_IMAGE=nginxinc/nginx-unprivileged:1.27-alpine@sha256:<digest> PYTHON_IMAGE=python:3.11-slim@sha256:<digest> deploy/build-mobile.sh`.
- **`X-Forwarded-For` must be overwritten by the host proxy, not appended to.** The BFF rate limiter keys on the first entry,
  so a proxy that appends (`$proxy_add_x_forwarded_for`) lets a client pick its own bucket and dodge the login limit.
  Use `proxy_set_header X-Forwarded-For $remote_addr;` (nginx); Caddy's default already replaces it.
- **Network reach.** The bff must reach City Help, Keycloak and (optionally) MinIO; firewalls and DNS on the target are unknown.
- **Time and persistence.** The stack keeps no state of its own (no volumes); the rate limiter is in memory and resets on restart.
- **Python dependencies are not locked.** `apps/bff/pyproject.toml` lists `>=` ranges and there is no lock file, and the base
  images are floating tags, so two builds on different days can differ. Record the image digests and the `pip list` of the
  build you deploy; locking is a follow-up.

## Hardening and open points (security headers)

The pwa container sends `X-Content-Type-Options`, `Referrer-Policy`, `X-Frame-Options`, `Permissions-Policy: geolocation=(self), camera=(self)`
and a **`Content-Security-Policy-Report-Only`** (`default-src 'self'`; images also `data:`/`blob:`; workers also `blob:`;
no external hosts, because the app loads no tiles, fonts or third-party scripts; the Google Maps button is a plain link).
Report-Only blocks nothing: it only makes the browser log what a strict policy would have blocked (see the console on a test handset).
**Enforcing it (renaming the header in `apps/pwa/docker/security-headers.conf`) is a follow-up** once a soak shows no violations;
nothing collects the reports centrally yet. HSTS is the host proxy's job. The BFF runs uvicorn with `--proxy-headers
--forwarded-allow-ips "*"` and `--no-server-header`; trusting every address for forwarded headers is safe **only because the BFF
port is never published**; do not add a `ports:` entry to `bff`.

## Troubleshooting

- **Login appears to do nothing, or you are signed out on every reload.** If you opened the app over plain `http://` on a LAN IP
  (not `localhost`) with `COOKIE_SECURE=true`, the browser drops the Secure session cookie. Use https, or set `COOKIE_SECURE=false`
  for a local test only, never in a deployment.
- **Sign-in says the origin is not allowed (403) or the BFF log says "not in PWA_ORIGINS".** `PWA_ORIGINS` must equal the address in the
  browser bar, scheme and port included.
- **`bff` stays `unhealthy`.** `$C logs bff`; a missing required variable stops compose before start (`set KEYCLOAK_URL ...`).
- **All rate-limited / one bucket.** The host proxy is not sending `X-Forwarded-For` (or all clients arrive from one proxy address).
