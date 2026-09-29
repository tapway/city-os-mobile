# Brainstorming: PWA Field Officer Readiness + Terra HUD Theme

## 1. Problem Restatement

The PWA (`city-os-mobile/apps/pwa`) currently has 4 screens:
- Login (dark background, basic)
- Ticket list (read-only, flat list)
- Ticket detail (read-only + Start Handling → Submit Resolution → Close)
- Attendance (GPS clock-in/out)

**Goal:** Make the PWA a field-officer-ready Smart Operations App that:
- Looks like the Terra HUD (dark glass-morphism, cyan/indigo accents)
- Lets officers do their full workflow from the field
- Competes with Jira/Zendesk mobile experience

## 2. What's Missing — Priority Ranked

| Priority | Feature | Why | Effort |
|----------|---------|-----|--------|
| **P0** | **Terra HUD Theme** | Visual identity. Dark glass-morphism, cyan/indigo, monospace labels. Login page already has dark bg — extend to all screens. | 2h |
| **P0** | **Create Ticket from Field** | Officers can't report incidents. Needs: GPS location, photo capture, incident type, description, urgency. | 4h |
| **P0** | **Push Notifications** | No Web Push (VAPID). Field officers need real-time alerts for new assignments, SLA breaches, supervision requests. | 6h |
| **P1** | **Camera/Photo Capture** | Attach evidence photos when creating or handling tickets. Uses `navigator.mediaDevices` or file input. | 3h |
| **P1** | **Offline Ticket Queue** | Offline queue currently only handles attendance. Must queue ticket mutations (create, transition) when offline. | 3h |
| **P1** | **Map View** | Show nearby tickets on a map. Navigate to ticket location (open in Maps). | 4h |
| **P1** | **Search + Filter** | Search by UID, title, status. Filter by assignment, date range. | 2h |
| **P2** | **Pull-to-Refresh** | Mobile-standard refresh gesture. | 1h |
| **P2** | **Offline Status Indicator** | Visual banner when offline, queued work count badge. | 1h |
| **P2** | **Navigation to Location** | "Open in Maps" button on ticket detail. | 1h |
| **P2** | **Ticket History (Assigned)** | Filter "My Tickets" vs "All Tickets". Show past assigned tickets. | 2h |
| **P3** | **Pagination** | Lazy-load ticket list, infinite scroll. | 2h |
| **P3** | **Haptics** | Vibrate on successful clock-in, transition, error. | 0.5h |

## 3. Theme Approach

**Option A: Tailwind CSS variables (recommended)**
Replace the light Tailwind colors (`bg-gray-50`, `text-gray-900`, `border-gray-200`, `bg-white`) with CSS custom properties defined in `styles.css`. The `@city-os/ui` Button/Card/Badge components use `cn()` utility — we update the base classes to use the HUD tokens.

**Why this wins over Option B (inline styles):**
- The entire existing codebase uses Tailwind — switching to inline styles would be a full rewrite
- Tailwind dark mode variants (`dark:bg-gray-900`) let us keep the light theme as fallback
- The `@city-os/ui` package already uses `cva()` (class-variance-authority) — we update the variant definitions
- CSS custom properties cascade through the component tree

**Token mapping:**
| Light Tailwind | HUD Custom Property |
|---------------|-------------------|
| `bg-gray-50` | `var(--bg)` |
| `bg-white` | `var(--glass)` |
| `border-gray-200` | `var(--border)` |
| `text-gray-900` | `var(--ink)` |
| `text-gray-500` | `var(--ink-dim)` |
| `text-blue-600` | `var(--cyan)` |
| `bg-blue-600` | `var(--cyan)` |
| `bg-gray-900` | `var(--bg-deep)` |

## 4. Implementation Plan

### Phase 1: Theme Foundation (2h)
1. Add HUD CSS custom properties to `styles.css`
2. Update `@city-os/ui` Button, Card, Badge components to use HUD tokens
3. Update root layout background + bottom nav
4. Update login page to full HUD
5. Update tickets list page
6. Update ticket detail page
7. Update attendance page

### Phase 2: Create Ticket (4h)
1. Add create ticket form to PWA
2. GPS location capture
3. Photo capture / file upload
4. Incident type selector
5. Submit with offline queue support

### Phase 3: Map + Search (4h)
1. Map view with nearby tickets
2. Search/filter bar
3. "Open in Maps" navigation

### Phase 4: Offline + Notifications (4h)
1. Offline queue for ticket mutations
2. Offline status indicator
3. Push notification setup

## 5. Recommendation

Start with **Phase 1 (Theme)** + **Phase 2 (Create Ticket)** — this gives the most visible impact. The theme makes the PWA look like part of the City OS ecosystem, and create-ticket closes the biggest functional gap (officers can't report incidents from the field).

Do the PWA theme update first, then the ticket creation form, then the map, then offline/notifications. Each is a separate PR.

---

## 6. Resolution — field-officer readiness (2026-09-30)

Superseding note: the phasing above assumed the PWA's own screens were the work.
The actual blocker was underneath them.

### What was wrong

**The app was wired to an API contract that does not exist.** Ticket search,
detail, status updates and attendance all called paths the City Help API does
not serve (`/api/v1/tickets`, `/api/v1/tickets/{id}/comments`, and so on). Every
screen therefore failed its first fetch. The real contract — `/api/v1/events`
with `limit`/`offset`/`q`/`status`, `/api/v1/events/{uid}`, and
`PATCH /api/v1/events/{uid}/status` — is now expressed once, in
`apps/pwa/src/lib/help-api.ts`, and the screens import from it.

**The session could not survive a reload.** Tokens lived only in a module
variable, so a phone waking from sleep, or any refresh, silently signed the
officer out: the API returned 401 and the UI showed an empty list. The BFF now
exposes `/auth/refresh` against its HttpOnly refresh cookie, the app calls
`bootstrapSession()` before deciding a user is signed out, and a 401 triggers a
single-flight refresh-and-retry.

**The Keycloak client could not mint a usable token.** `city-os-mobile` had
neither the audience mapper nor the realm-roles mapper, so tokens carried no
`aud` and no `realm_access.roles` — City Help rejects the first outright. The
client now mirrors `city-help-web`'s mappers.

**Browser login was impossible, for a reason outside this repo.** The `city-os`
realm pins `attributes.frontendUrl` to `http://deploy-keycloak-1:8080`, the
Docker container name. Keycloak renders that origin into the sign-in form's
`action`, so the browser cannot resolve it and the form post dies with a network
error. Every City OS app using the password grant is unaffected because it never
follows a redirect; the PWA is the first to use the authorization-code flow and
walks straight into it. Locally this is worked around by sending the browser to
the same origin Keycloak renders (`KEYCLOAK_PUBLIC_URL`) and resolving that name
to the host-mapped port (`pnpm e2e:keycloak-alias`). **A field deployment needs a
platform decision** — either move the realm's `frontendUrl` to a
browser-reachable origin (which changes the `iss` claim, so every validating
service must move with it) or front Keycloak with a same-origin rewriting proxy.
Recorded in `docs/testing.md`; not applied.

### GPS on an update

The requirement is that a ticket update locks the officer's position. The
transition engine already stores latitude and longitude, but the status route
never accepted them, so the app had nothing to send. The app now requires a fix
taken within the last five minutes (`useGeolocation` tracks fix age and
accuracy), sends it with the update, and refuses to submit without a fresh one.
The route now accepts `lat`/`lng` as query parameters and forwards them to the
engine, which writes the position into `ticket_attendance_logs` for the
`IN_PROGRESS` transition.

### Evidence images

There was no upload path anywhere in the stack. The BFF now stores photos in the
City OS object store (MinIO) under `mobile-attachments/` and serves them back,
with the token verified upstream before anything is written. The status route now accepts `image_urls` and merges them onto the ticket, so
evidence accumulates across updates. The merge is idempotent, so a retried
update cannot duplicate a photo, and an update with no photos never clears the
ones already there.

### Defects found in review and fixed

- **The proxy could be walked out of its prefix.** httpx normalises `../` after
  the upstream URL is built, so with only a `Bearer ` check as a gate,
  `GET /api/../openapi.json` returned City Help's 121 KB OpenAPI schema with a
  junk token. Paths are validated segment by segment (encoded forms included)
  before any upstream call.
- **A Keycloak blip signed people out permanently.** Every refresh failure —
  5xx, timeout, unreachable — was treated as a dead token and deleted the
  cookie. Failures are classified now: a 4xx rejection clears it, anything
  transient returns 503 and keeps it.
- The OIDC error redirect is encoded rather than interpolated into a `Location`
  header; the proxy has a deliberate 30s upstream timeout and a body-size cap;
  the BFF carries a `.dockerignore` so `COPY . /app` no longer bakes `.env`
  (object-store keys, OIDC client secret) into the image.

### Verification

Unit tests (`pnpm test` in `apps/pwa`: 7; `pytest` in `apps/bff`: 29) plus a
Playwright suite that drives the real sign-in form and the real API, creating and
updating its own ticket — see `docs/testing.md`.