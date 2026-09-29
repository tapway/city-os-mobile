# Testing the mobile PWA

Two layers, both run from `apps/pwa`:

| Layer | Command | What it needs |
|---|---|---|
| Unit / component | `pnpm test` | nothing running |
| End-to-end UX | `pnpm test:e2e` | BFF on `:8002`, City Help API on `:8001`, Keycloak on `:7080`, plus the Keycloak host alias (below) |

`pnpm typecheck` covers the app and both config files.

## What the end-to-end suite covers

`e2e/tickets.spec.ts` drives a real browser against the real stack — the actual
Keycloak sign-in form, the BFF, the City Help API and Postgres. It creates the
ticket it works on (`E2E-<timestamp>` in the title), so the journey is
self-contained and demo data is not disturbed.

1. **Shell** — an anonymous visitor is sent to sign-in; the bottom navigation
   exposes Tickets, Attendance and New ticket.
2. **Ticket journey** — sign in, create a ticket with a GPS fix, find it by
   search, open it, record a fresh GPS fix, update the status with a comment,
   see the comment in the activity timeline, and still see it after a reload
   (i.e. it really persisted).
3. **Evidence photo** — attach an image to an update; the thumbnail appears and
   the stored image is served back with an `image/*` content type.
4. **Attendance** — clock in with the device position locked.
5. **Offline** — the offline banner appears when the browser goes offline and
   clears when it comes back.

The browser context is pre-granted `geolocation` and reports a fixed Johor Bahru
position (1.4927, 103.7414), so GPS assertions are deterministic instead of
prompting.

Credentials default to the local development realm's UAT account and can be
overridden: `E2E_USERNAME`, `E2E_PASSWORD`.

## Running the end-to-end suite

```bash
# 1. BFF (separate terminal, from apps/bff)
python3 -m uvicorn src.main:app --host 127.0.0.1 --port 8002

# 2. Keycloak host alias (separate terminal, from apps/pwa)
pnpm e2e:keycloak-alias

# 3. Run the suite (the Vite dev server is started automatically)
pnpm test:e2e
```

### Why the Keycloak host alias exists

The `city-os` realm pins `attributes.frontendUrl` to `http://deploy-keycloak-1:8080`
— the **Docker container name**. Keycloak renders that base into the sign-in page
as an absolute URL:

```html
<form action="http://deploy-keycloak-1:8080/realms/city-os/login-actions/authenticate?...">
```

A browser cannot resolve `deploy-keycloak-1`, so any authorization-code login
dies with a network error as soon as the form is submitted. The password-grant
clients that City Help and City Terra use never hit this, because they POST to the
token endpoint through a proxy instead of following a browser redirect.

Two settings work around it locally:

- **BFF** `KEYCLOAK_PUBLIC_URL=http://deploy-keycloak-1:8080/realms/city-os` sends
  the *browser* to the same origin Keycloak renders its form action against, so
  the session cookie is sent back with the form post. (`KEYCLOAK_URL` remains the
  server-side base used for code exchange, refresh and revoke — those never touch
  the browser.)
- **Playwright** launches Chromium with
  `--host-resolver-rules=MAP deploy-keycloak-1 127.0.0.1`, and
  `pnpm e2e:keycloak-alias` relays `127.0.0.1:8080` to the host-mapped Keycloak
  port `7080`.

Both are development accommodations for the configuration defect described below.
They change nothing in the stack.

### Blocking issue for field deployment (raised, not fixed here)

A phone in the field cannot resolve a container name either, so the redirect-based
login will not work off this box until the platform is changed. Two options,
both with a different blast radius:

1. **Change the realm's `frontendUrl` to a browser-reachable origin**
   (e.g. the Keycloak tunnel `https://…:9446`). Clean, but the `iss` claim
   changes with it, so every service that validates it — City Help, City Nexus,
   the SLA watchdog, the i-Trafik BFF — must move to the same `KEYCLOAK_URL` in
   the same window, and their containers recreated.
2. **Front Keycloak with a same-origin proxy that rewrites the container name**
   in HTML responses to the app's own origin (nginx `sub_filter … $http_host`).
   The browser then only ever talks to the app origin, the tokens keep the
   existing `iss`, and nothing else in the stack moves. More deployment plumbing,
   zero impact on other services.