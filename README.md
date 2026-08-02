# City OS Mobile

Mobile PWA + BFF for City OS field operations staff.

## Structure

```
city-os-mobile/
├── apps/
│   ├── pwa/          # React 19 + Vite 7 + TanStack PWA
│   └── bff/          # FastAPI backend-for-frontend
├── packages/
│   ├── schemas/      # Shared Zod schemas (ticket, attendance, user)
│   └── ui/           # Radix-based component primitives
└── .github/workflows/ci.yml
```

## Phase 1 Features

- **Ticket handling**: view assigned tickets, start handling with GPS logging, submit closure
- **Attendance**: shift clock-in/out with GPS validation against ticket location
- **Offline queue**: ticket creation queues in IndexedDB when offline, syncs on reconnect
- **Push notifications**: Web Push (VAPID) for new assignments, SLA warnings

## Tech Stack

| Layer | Technology |
|-------|------------|
| Frontend | React 19, Vite 7, TanStack Router/Query, Radix UI, Tailwind v4 |
| BFF | FastAPI (Python), httpx, city-guard |
| PWA | vite-plugin-pwa (Workbox), injectManifest SW |
| Auth | OIDC Authorization Code + PKCE (Keycloak) |
| Offline | IndexedDB via `idb` library |
| Maps (future) | MapLibre GL JS |

## Development

```bash
# Install dependencies
pnpm install

# Install BFF dependencies
cd apps/bff && pip install -e ".[dev]"

# Start PWA + BFF
pnpm dev

# Run tests
pnpm test           # all tests
pnpm --filter @city-os/pwa test  # PWA only
cd apps/bff && pytest            # BFF only

# E2E tests
cd apps/pwa && npx playwright test
```

## Architecture

```
PWA (phone) → BFF (FastAPI, auth + proxy) → City Help API
```

The BFF:
- Handles OIDC PKCE auth (refresh token as HttpOnly cookie)
- Proxies API calls to City Help with access token injection
- Will serve Kafka→SSE alerts + camera WHEP proxying in Phase 2