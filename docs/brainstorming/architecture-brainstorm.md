# Mobile PWA + GPS Attendance — Architecture Brainstorming

**Date:** 2026-08-02
**Feature:** City OS Mobile Operations PWA (Phase 1: City Help tickets + GPS attendance)
**Author:** Hermes Agent (brainstorming session)

---

## 1. Restated Problem

Build an installable mobile PWA for field handling staff that:
- Authenticates against Keycloak (City Guard) via OIDC PKCE + BFF (no tokens in browser storage)
- Lets staff view assigned tickets, handle them (IN_PROGRESS with auto-GPS log), submit closure, return with comments
- Lets staff report new events (photo + description + GPS) with offline queue
- Provides shift clock-in/out with GPS validation against the ticket's location
- Auto-logs GPS position on each ticket transition to IN_PROGRESS
- Shows shift summaries (daily/monthly) with late/early/absent calculation
- Works offline for ticket viewing and queuing; syncs on reconnect
- Sends push notifications (Web Push VAPID) for new assignments, SLA warnings
- Runs on mid-tier Android (~RM800 phones) and iOS — what field staff actually carry

The vendor URS §P513–P547 describes this as the "Smart Operations App" for handling staff. The existing PWA spec (shared today) provides a detailed architectural blueprint.

### Constraints
- **New repo** — `city-os-mobile`, monorepo, not extending City Help's frontend/ dir
- **React 19 + Vite 7 + TanStack stack** (Router, Query, DB 0.6) + Radix + Tailwind v4
- **BFF in Phase 1** — FastAPI (Python) for auth token management + API proxy
- **Performance budget**: ≤180 KB JS gzipped, LCP ≤ 2.0s, INP ≤ 200ms
- **TLS on a real domain** — assumed handled separately (prerequisite)
- **Keycloak public** — assumed handled separately (prerequisite)
- **TDD required** — unit + E2E
- **GPS attendance**: ticket-location-based, hybrid (shift + per-ticket), parallel record (not a hard gate)

### What "done" looks like (Phase 1)
1. A handling staff member opens the PWA on their phone, logs in via Keycloak (redirect → PKCE → BFF → access token in memory, refresh token in HttpOnly cookie)
2. They see their assigned tickets (filtered by `assigned_to` or their department), with status tabs, pull-to-refresh
3. They tap a ticket → detail view with location map pin, timeline, attachments
4. They tap "Start Handling" → the system gets their GPS position, calculates distance from the ticket's coordinates, auto-logs it, transitions the ticket to IN_PROGRESS, shows a green "On-site verified" or yellow "Manual override" badge
5. They can create a new ticket with photo + description + GPS — works offline, queued in IndexedDB via TanStack DB, syncs on reconnect
6. At end of shift, they clock out → daily summary shows handled tickets, per-ticket GPS validation, late/early/absent status
7. Supervisor's City Help dashboard shows attendance records with per-ticket GPS logs
8. Push notifications arrive for new assignments

---

## 2. Confusion / Uncertainty

| Question | My assumption | Confidence |
|---|---|---|
| Does the BFF live in the same repo as the PWA or its own repo? | The spec §11 says `apps/pwa` + `apps/bff` inside the monorepo. Same repo, different packages. | 90% |
| BFF in FastAPI (Python) or Fastify (TypeScript)? | The spec says "Node 22 + Fastify + TypeScript if you want to share types with the frontend. FastAPI if you'd rather stay in the Python lane." Our team runs Python + FastAPI for City Help, City Nexus, City Guard. I'd recommend FastAPI — matches team expertise, shared City Guard SDK for auth, and the BFF for Phase 1 is small enough that type-sharing with the frontend doesn't justify a second language. Types can be shared via a Zod JSON schema export (JS → Python) or a QuickType generator. | 80% |
| Should attendance be a City Help API (existing backend) or a BFF-managed feature? | Attendance is a City Help feature (it's in the City Help DB, uses the City Help user model). The BFF proxies the City Help attendance API. The BFF does NOT manage attendance logic — it's a reverse proxy for API calls and an auth mediator. | 90% |
| Offline ticket queue: TanStack DB 0.6 vs custom IndexedDB? | TanStack DB 0.6 is new (2026). It's designed for exactly this use case — durable IndexedDB-backed mutation queue. But if it's immature or buggy, a custom IndexedDB solution (via `idb` library) is safer. I'll evaluate maturity during the recommendation. | 70% |

---

## 3. Options

### 3A — Repo structure: Monorepo (spec §11) vs Two repos

**Monorepo** (`apps/pwa` + `apps/bff` + `packages/schemas` + `packages/ui`):
- One repo, one CI, one PR for cross-cutting changes
- Shared schemas live in `packages/schemas` (Zod exported for both TS and JSON Schema → Python)
- Shared UI primitives in `packages/ui`
- Turbo (or Nx) for build orchestration

**Two repos** (separate `city-os-mobile-pwa` and `city-os-mobile-bff`):
- Independent deployment (PWA is static assets, BFF is a service)
- No shared schema risk (schemas drift independently)
- Simpler setup (no monorepo tooling)

**Complexity:** Monorepo = Medium; Two repos = Low

---

### 3B — BFF language: FastAPI (Python) vs Fastify (TypeScript)

**FastAPI (Python):**
- Matches existing City OS stack (City Help, City Nexus, City Guard all FastAPI)
- Can reuse `city_guard` SDK for token verification, permission checks
- Team already writes Python for the backend — no context switch
- Phase 2 Kafka→SSE is easy with `asyncio` + `aiokafka` / `python-json-logger`
- **Cons:** Can't share types with the frontend (Zod → Python via JSON Schema export is possible but adds a step)

**Fastify (TypeScript):**
- TypeScript → TypeScript: shared Zod schemas directly importable between BFF and PWA
- Spec §2 recommends it for type sharing
- Smaller runtime (Bun/Node) than Python for a thin proxy layer
- **Cons:** New language for our team, no city-guard SDK (need to implement Keycloak token verification from scratch), Kafka library maturity in Node is lower

**Complexity:** FastAPI = Low; Fastify = Medium

---

### 3C — Attendance model extension

**Existing attendance table** (`app/models/attendance.py`):
- Stores shift clock-in/out with lat/lng
- **Extend** with: `ticket_id` (nullable), `distance_from_site_meters` (nullable), `is_manual_override` (boolean), `role` (field_staff by default)
- Pro: single table, simple queries for daily summaries
- Con: shift records and per-ticket GPS logs have different semantics (one clock-in per day vs one per ticket) — mixing them creates sparse rows

**New `ticket_attendance_logs` table** (separate):
- `id`, `ticket_id`, `user_id`, `action` (start_handling, complete, etc.), `lat`, `lng`, `distance_from_site_meters`, `is_manual_override`, `created_at`
- Pro: clean separation of concerns, shift table stays simple, per-ticket logs are an append-only log
- Con: daily summary query joins two tables

**Single table with type discriminator:**
- `attendance` table gets a `record_type` column: `shift_in`, `shift_out`, `ticket_gps`
- Pro: one table, one query, flexible
- Con: violates YAGNI — mixing types in one table is a smell

**Complexity:** Separate table = Low; Extended = Medium; Discriminator = Medium

---

### 3D — Offline queue: TanStack DB 0.6 vs custom IndexedDB via `idb`

**TanStack DB 0.6:**
- Built-in persistence + offline mutation queue
- Same author as TanStack Query — integrates naturally
- Auto-sync on reconnect with exponential backoff
- **But:** v0.6 is very new (released 2026). The API may still be unstable. Documentation is limited.

**Custom IndexedDB via `idb` library:**
- Proven library (~1KB, 12M+ weekly downloads)
- Full control over the queue shape and retry logic
- Combine with TanStack Query's `onMutate` for optimistic updates
- `navigator.onLine` + `visibilitychange` + `online` event for sync triggers
- **Con:** More code to write, test, and maintain

**TanStack Query + Workbox Background Sync:**
- TanStack Query's `onMutate` for optimistic UI
- Workbox Background Sync plugin for Android
- No custom IndexedDB at all
- **Con:** iOS lacks Background Sync; only works on Android. Retry logic is in Workbox's hands, not the app's.

**Complexity:** TanStack DB = Medium (new, unstable); Custom `idb` = Medium (proven, more code); Workbox BG Sync = Low (Android only)

---

### 3E — PWA ↔ BFF build order

**Sequential (BFF first, then PWA):**
- Build BFF auth + proxy first, test with curl/Postman, then build PWA against it
- Pro: PWA has a stable backend to develop against
- Con: Frontend team waits for BFF

**Parallel (PWA uses mock data, BFF built simultaneously):**
- PWA developed with mock API responses (TanStack Query mock adapter or MSW)
- BFF built in parallel
- Pro: No waiting, faster total time
- Con: Integration bugs surface later

**Tandem (PWA against City Help API directly, BFF slotted in later):**
- PWA talks to City Help FastAPI directly (bypassing BFF for Phase 1)
- BFF wraps City Help API when ready, PWA changes one base URL
- Pro: Fastest to start, PWA is functional early
- Con: BFF addition is a refactor, not a config change — auth flow changes, token handling changes

**Complexity:** Sequential = Low; Parallel = Low (with MSW); Tandem = Medium

---

## 4. Evaluation

| Option | Simplicity | Fits Team | Testability | Maintainability | Speed to Ship |
|---|---|---|---|---|---|
| **3A: Monorepo** | ⭐⭐⭐ | ⭐⭐⭐⭐⭐ | ⭐⭐⭐⭐ | ⭐⭐⭐⭐⭐ | ⭐⭐⭐⭐ |
| **3A: Two repos** | ⭐⭐⭐⭐⭐ | ⭐⭐⭐⭐ | ⭐⭐⭐⭐ | ⭐⭐⭐ | ⭐⭐⭐⭐⭐ |
| **3B: FastAPI (Python)** | ⭐⭐⭐⭐⭐ | ⭐⭐⭐⭐⭐ | ⭐⭐⭐⭐⭐ | ⭐⭐⭐⭐⭐ | ⭐⭐⭐⭐⭐ |
| **3B: Fastify (TS)** | ⭐⭐⭐ | ⭐⭐⭐ | ⭐⭐⭐ | ⭐⭐⭐ | ⭐⭐⭐ |
| **3C: Separate tables** | ⭐⭐⭐⭐⭐ | ⭐⭐⭐⭐⭐ | ⭐⭐⭐⭐⭐ | ⭐⭐⭐⭐⭐ | ⭐⭐⭐⭐⭐ |
| **3C: Extended table** | ⭐⭐⭐⭐ | ⭐⭐⭐⭐ | ⭐⭐⭐ | ⭐⭐⭐ | ⭐⭐⭐⭐ |
| **3D: TanStack DB 0.6** | ⭐⭐⭐⭐ | ⭐⭐⭐⭐ | ⭐⭐⭐ (new) | ⭐⭐⭐ (new) | ⭐⭐⭐ (risk) |
| **3D: Custom `idb`** | ⭐⭐⭐ | ⭐⭐⭐⭐⭐ | ⭐⭐⭐⭐ | ⭐⭐⭐⭐ | ⭐⭐⭐⭐ |
| **3D: Workbox BG Sync** | ⭐⭐⭐⭐⭐ | ⭐⭐⭐⭐ | ⭐⭐⭐ | ⭐⭐⭐ | ⭐⭐⭐⭐⭐ |
| **3E: Sequential** | ⭐⭐⭐⭐⭐ | ⭐⭐⭐⭐ | ⭐⭐⭐⭐⭐ | ⭐⭐⭐⭐ | ⭐⭐⭐ |
| **3E: Parallel (MSW)** | ⭐⭐⭐⭐ | ⭐⭐⭐⭐ | ⭐⭐⭐⭐ | ⭐⭐⭐⭐ | ⭐⭐⭐⭐⭐ |
| **3E: Tandem** | ⭐⭐⭐ | ⭐⭐⭐ | ⭐⭐ (refactor) | ⭐⭐ | ⭐⭐⭐⭐⭐ |

---

## 5. Recommendation

### Repo structure: Monorepo (3A)

The spec §11's monorepo layout is the right choice. One repo, one CI, shared schemas, shared UI primitives. Turbo is lightweight (zero config for a 2-app monorepo). When the team grows to 2+ engineers, monorepo prevents cross-repo drift without adding overhead.

### BFF language: FastAPI — Python (3B)

Stay in the Python lane. The BFF for Phase 1 is ~5 endpoints, ~200–300 lines. The team already writes FastAPI, already has the `city_guard` SDK for Keycloak token verification, and the Phase 2 Kafka→SSE path is a solved problem in Python (`aiokafka` + `sse-starlette`). Type sharing with the frontend (Zod → JSON Schema → Python) is a one-time setup per release, not a daily friction — QuickType or `zod-to-json-schema` + `pydantic` can generate Python types from the Zod schemas on build.

Fastify would mean: (a) learning a new framework, (b) rewriting Keycloak OIDC verification (no city-guard in JS), (c) maintaining two-language auth logic. For a 200-line BFF, the overhead of a second language is not worth the type-sharing benefit.

### Attendance model: Separate `ticket_attendance_logs` table (3C)

Clean separation. The existing `attendance` table handles shift records (clock-in/out, daily summary, late/early/absent). The new `ticket_attendance_logs` table is an append-only log of per-ticket GPS readings. The daily summary query is a simple `JOIN` — not complex enough to justify a single table with a discriminator.

**New table:**
```sql
CREATE TABLE ticket_attendance_logs (
    id SERIAL PRIMARY KEY,
    ticket_id INTEGER REFERENCES tickets(id),
    user_id VARCHAR(100) NOT NULL,
    action VARCHAR(50) NOT NULL,          -- 'start_handling', 'complete', 'site_visit'
    lat FLOAT,
    lng FLOAT,
    distance_from_site_meters FLOAT,      -- calculated from (lat,lng) vs ticket's (lat,lng)
    is_manual_override BOOLEAN DEFAULT false,  -- true if ticket had no coordinates
    created_at TIMESTAMP DEFAULT NOW()
);
```

### Offline queue: Custom `idb` + TanStack Query `onMutate` (3D, middle ground)

TanStack DB 0.6 is too new for a production government app. Workbox Background Sync is Android-only. The safest path: use TanStack Query's built-in `onMutate` for optimistic UI, and persist the mutation queue to IndexedDB via the `idb` library (lightweight, proven). On reconnect (`online` event), replay the queue. This is the pattern the spec §8 describes, just with `idb` instead of the now-deprecated Workbox Background Sync.

The `idb` library is ~1KB, has 12M+ weekly downloads, and gives us full control over the queue shape. If TanStack DB 0.6 stabilizes in 6 months, we can migrate — the interface is the same (IndexedDB-backed queue); only the library changes.

### Build order: Parallel (3E) — PWA with MSW mock data, BFF built simultaneously

The PWA should not wait for the BFF. Use Mock Service Worker (MSW) to intercept API calls in the browser during development, returning realistic mock data. The PWA team builds against the mock API, the BFF is built in parallel against the real City Help API. When both are ready, the PWA changes one import (MSW → real `fetch`) and connects to the BFF.

MSW is already a standard tool for this pattern — it intercepts at the network level (not the component level), so the PWA code is written against real `fetch` calls with real types, just with a mock server responding. When the BFF is ready, you remove the MSW setup and the PWA talks to the real BFF without any code changes.

### Recommend file structure

```
city-os-mobile/
├── .github/workflows/ci.yml
├── turbo.json
├── package.json                    # workspace root
├── apps/
│   ├── pwa/                        # Vite + React 19 + TanStack + Radix
│   │   ├── public/
│   │   │   ├── sw.ts               # Service worker (injectManifest)
│   │   │   └── manifest.webmanifest.json
│   │   └── src/
│   │       ├── main.tsx
│   │       ├── router.tsx
│   │       ├── routes/
│   │       │   ├── login.tsx
│   │       │   ├── tickets.tsx
│   │       │   ├── ticket.$id.tsx
│   │       │   ├── new-ticket.tsx
│   │       │   ├── attendance.tsx
│   │       │   └── settings.tsx
│   │       ├── components/
│   │       ├── hooks/
│   │       ├── lib/
│   │       │   ├── api.ts          # fetch wrapper → BFF
│   │       │   ├── auth.ts         # oidc-client-ts
│   │       │   └── offline.ts      # idb queue + sync
│   │       └── mocks/              # MSW handlers
│   └── bff/                        # FastAPI (Python)
│       ├── pyproject.toml
│       ├── Dockerfile
│       └── src/
│           ├── main.py
│           ├── auth.py             # OIDC PKCE code exchange, token refresh
│           ├── proxy.py            # HTTP reverse proxy to City Help API
│           └── settings.py
├── packages/
│   ├── schemas/                    # Zod → JSON Schema → shared
│   │   ├── package.json
│   │   └── src/
│   │       ├── index.ts
│   │       ├── ticket.ts
│   │       ├── attendance.ts
│   │       └── user.ts
│   └── ui/                         # Radix-based primitives
│       ├── package.json
│       └── src/
│           ├── Button.tsx
│           ├── Card.tsx
│           ├── Badge.tsx
│           └── Sheet.tsx
└── README.md
```

### Risks and assumptions

1. **MSW maturity in build.** MSW 2.x works with Vite 7 and React 19, but we should verify on the first day of development. If MSW doesn't work (framework compatibility issue), fall back to hardcoded mock data in TanStack Query's `queryClient.setQueryDefaults`.

2. **TanStack DB 0.6 is not used.** The recommendation is to use `idb` instead. If `idb` proves insufficient for the offline queue shape (complex mutation ordering, conflict resolution), we can switch to TanStack DB 0.6 at that point — it's the same IndexedDB under the hood.

3. **Zod → Python type generation.** The `packages/schemas` package exports Zod schemas. On build, we run `zod-to-json-schema` → generate a JSON Schema file → `datamodel-code-generator` generates Python Pydantic models. This is a one-command CI step. If the pipeline is too fragile, we can fall back to manually maintained Pydantic models in the BFF (the schema is small for Phase 1 — ~5–10 types).

4. **BFF deployment.** The BFF is a FastAPI service that needs to be deployed alongside the PWA (or on the same server). The City OS deployment pattern (Docker Compose on the main server) works. Add a `city-os-mobile-bff` service to the existing `deploy` docker-compose stack. The PWA is served via nginx (static files, per spec §10).

5. **iOS PWA limitations.** iOS push notifications, service worker lifetime, and the install process are all degraded compared to Android. The spec §4.3, §5, §7.2 document the specific workarounds. We can't fully fix these — it's Apple's platform limitation. The PWA works on iOS but with caveats. Field staff should prefer Android devices.
