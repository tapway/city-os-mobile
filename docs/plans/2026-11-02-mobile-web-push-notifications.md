# City OS Mobile — Web Push Notifications Implementation Plan

**Status:** proposed, not started
**Date:** 2026-11-02
**Repos touched:** `tapway/city-help-2.0` (platform: storage, API, sender) and `tapway/city-os-mobile` (PWA + SW)
**Branch convention:** `feat/mobile-web-push` in both repos, one PR each, mobile PR depends on the platform PR being merged first

---

## 1. Summary

Field officers get a push notification on the installed PWA when a ticket is assigned to their
department, an approval is requested of them, or an SLA breach escalates. Tapping the notification
opens the ticket detail. An **in-app bell ships first** (phase 0), so an alert missed while the phone was
off is still visible when the officer opens the app.

There is **no push infrastructure today**. The platform already produces in-app notifications through
the transactional outbox (`notify` topic → `notifications` table), so the work is: store a browser push
subscription per user/device, add a second outbox topic that sends to those subscriptions, and add the
service-worker + permission UX on the phone.

**Estimate:** ~6 dev-days including the in-app bell; Android push working end of day 4, iOS verified in phase 4.
(The 6 h figure in `docs/brainstorming/pwa-field-officer-readiness.md` covers client plumbing only and
assumes the platform already stores subscriptions and sends. It does not.)

## 1a. Decisions (2026-11-02, CH Lim)

| Question | Decision |
|---|---|
| Which kinds get a push | `assigned`, `approval_requested`, `approval_approved`, `approval_rejected`, SLA breach/escalation. Suppress `unrouted` and routine status changes. Implemented as an **allow-list**, so a new kind stays silent until added. |
| Quiet hours | **None — always on** for field staff. No server-side time window; do not add one that would silently drop a 02:00 assignment. Per-user mute is a later setting, not part of this work. |
| In-app bell | **Yes, and first.** A missed push must be recoverable in-app. Phase 0 ships the bell against the existing `/api/v1/notifications` API; push follows. |
| VAPID subject | `mailto:` on an MBJB role mailbox (see §13). Must be a mailbox the team actually monitors. |

---

## 2. Current state (verified in the repos, 2026-11-02)

### Mobile — `city-os-mobile@9749af2`

| Piece | State |
|---|---|
| Service worker | `apps/pwa/src/sw.ts`, Workbox `injectManifest`; precache + navigation fallback + cache bypass for `/api/` and `/auth/`. **No `push` or `notificationclick` listener.** |
| SW registration | `apps/pwa/src/main.tsx:19` — `registerSW({ immediate: true })` |
| Subscribe UI / permission | none |
| BFF | `apps/bff/src/main.py:35` — `proxy_router` at `/api`; every `/api/*` call requires `Authorization: Bearer` and is forwarded to `CITY_HELP_API_URL`. **No database, no queue, no worker.** |
| Dependencies | BFF: fastapi, httpx, pydantic, minio. No `pywebpush`. PWA: no `push` usage anywhere. |
| Docs | `README.md:23` claims "Push notifications: Web Push (VAPID)" — aspirational, not implemented. Readiness doc lists it as P0, 6 h. |

### Platform — `city-help-2.0@e179bc3`

| Piece | State |
|---|---|
| Notifications | `notifications` table (`app/models/notification.py`): `recipient_type` in (`user`,`role`,`department`,`citizen`), `recipient_ref`, `ticket_id`, `kind`, bilingual title/body (`TEXT_MAX=500`), `read_at`. |
| Bell API | `app/api/notifications.py` — `GET /api/v1/notifications`, mark-read, read-all. |
| Producer | `notify` outbox topic written at `app/api/supervisions.py:81,143`, `app/core/routing.py:30`, `app/core/handlers/approvals.py:22,108`, `app/core/handlers/dispatch.py:59`, `app/core/sla_clock.py:97`, `app/services/sla_monitor.py:108`. |
| Consumer | `app/core/handlers/notify_consumer.py:23` — renders text via `app/core/notification_texts.py` and inserts the row. |
| Outbox | `app/core/outbox.py`: 10 s handler timeout, 5 attempts, exponential backoff, SAVEPOINT per handler, singleton sweeper. Handlers must be idempotent and must not commit. |
| Keycloak | `app/services/keycloak_admin.py:113` `_role_members(role)` can resolve role holders, but it is an admin API call — not suitable per send without caching. |
| SSE | `deploy-sse-gateway-1` (:8200) is Terra's **Stellio → browser** stream (`city-terra-subs/sse-gateway`), **not** a ticket notification channel. Do not build on it. |

### Correction to an earlier statement

I previously described the SSE gateway as the realtime channel for City Help notifications. That was
wrong: it bridges Stellio NGSI-LD webhooks to `EventSource` for the Terra map. It carries no ticket
notifications and is not reusable here.

---

## 3. What Web Push requires

- **Secure context.** HTTPS with a trusted certificate. Tailscale `*.ts.net` qualifies; the MBJB field
  host must too. `http://<lan-ip>` will not work — the permission prompt never appears.
- **VAPID key pair.** Private key on the server only; public key handed to the browser at subscribe time.
- **Payload limit** ~4 KB. Existing titles/bodies are capped at 500 chars, so fine.
- **Platform support.** Chrome/Edge/Firefox on Android and desktop: work in the browser tab and in the
  installed app. **iOS/iPadOS 16.4+:** only for a PWA **added to the Home Screen**; no push in a Safari
  tab. Permission must be requested from a user gesture.
- **Service worker must stay registered and online-capable.** No push while the app is uninstalled.

Consequence: on iOS the permission button must first detect non-standalone mode and show
"Add to Home Screen first", not a dead prompt.

---

## 4. Architecture

```
Platform                                   Mobile
────────                                   ──────
ticket action
  └─ outbox "notify"  ──► notifications row  (unchanged)
       └─ outbox "push"  ──► push sender ──► push service (FCM/APNs/Mozilla)
                                              │
                                              ▼
                                       SW "push" listener
                                              │
                                       showNotification(data)
                                              │
                                       click → openWindow(/ticket/<uid>)
```

Chosen split: **subscriptions and sending live on the platform**, because it owns the database, the
notification rows and the outbox. The BFF stays a stateless proxy; the new endpoints are reachable
through it with no BFF code change (`/api/v1/push/...` is already proxied with the user's token).

Rejected alternatives:

- **BFF-side sender.** Needs a DB or Redis in the BFF and a second copy of recipient/role logic; also
  duplicates the outbox retry semantics.
- **Browser polling the bell API every N seconds.** Battery drain, no wake-up when the app is closed,
  and does not solve the actual requirement (alert an officer who is not looking at the phone).
- **Reusing the Terra SSE gateway.** Wrong data source; would need a second bridge anyway.

---

## 5. Data model (platform, Alembic `022_add_push_subscriptions`)

```sql
CREATE TABLE push_subscriptions (
    id             bigserial PRIMARY KEY,
    username       varchar(128) NOT NULL,          -- Keycloak preferred_username, same ref as notifications.recipient_ref
    endpoint       text        NOT NULL,
    p256dh         text        NOT NULL,
    auth           text        NOT NULL,
    user_agent     varchar(255),
    roles          jsonb       NOT NULL DEFAULT '[]'::jsonb,   -- snapshot, refreshed on subscribe
    department     varchar(64),                                -- snapshot of department_code claim
    created_at     timestamptz NOT NULL DEFAULT now(),
    last_seen_at   timestamptz NOT NULL DEFAULT now(),
    failure_count  integer     NOT NULL DEFAULT 0,
    CONSTRAINT uq_push_subscriptions_endpoint UNIQUE (endpoint)
);
CREATE INDEX ix_push_subscriptions_username ON push_subscriptions (username);
```

Notes:

- `endpoint` is unique across the table: the same browser re-subscribing upserts rather than duplicates,
  and a second officer logging in on a shared handset replaces the row's `username` (see §8).
- `roles`/`department` are snapshots taken from the caller's token, so the sender never calls Keycloak on
  the hot path. `_role_members` exists but costs an admin API call per role per send. Staleness is bounded
  by refreshing the snapshot on every app open and on every resubscribe. If this proves insufficient for
  role-heavy deployments, add a 5-minute cache and resolve from Keycloak instead — a contained change.
- `endpoint`, `p256dh`, `auth` are credentials for that device. Never log them, never return them from an
  API, and exclude them from analytics/report exports.
- Retention: delete on `410 Gone` / `404`, and rows untouched for 90 days (a handset that never returns).

---

## 6. API contract (platform)

All under the existing auth (`city_guard.get_current_user`), reached through the BFF as `/api/v1/push/...`.

**`GET /api/v1/push/public-key`**
```json
{ "public_key": "BEl62i...", "enabled": true }
```
`enabled=false` when VAPID is not configured, so the PWA hides the setting instead of failing.

**`POST /api/v1/push/subscriptions`**
```json
{ "endpoint": "https://fcm.googleapis.com/...", "keys": { "p256dh": "...", "auth": "..." },
  "user_agent": "Mozilla/5.0 (Linux; Android 14) ..." }
```
Upsert on `endpoint`; sets `username` to the caller, refreshes `roles`/`department`, resets
`failure_count`, bumps `last_seen_at`. Returns `201` with the row id.

**`DELETE /api/v1/push/subscriptions`** — body `{ "endpoint": "..." }`, deletes only if the endpoint
belongs to the caller (a device cannot unsubscribe another user). `204` either way, so the endpoint
cannot be used to probe existence.

**`POST /api/v1/push/subscriptions/refresh`** — no body; re-reads roles/department from the token and
bumps `last_seen_at` for every endpoint of this user. Called on app open.

Validation: `endpoint` must be `https`, ≤ 2048 chars, host allow-list optional (FCM, `*.push.apple.com`,
`*.mozilla.com`, `*.windows.com`); `p256dh`/`auth` non-empty, ≤ 200 chars. Rate limit 10/min/user.

---

## 7. Delivery (platform)

1. `notify_consumer.store_notification` inserts the `Notification` row, then enqueues a second event in
   the same transaction:
   ```python
   await outbox.enqueue(db, "push", {"notification_id": n.id})
   ```
   Single change point — no need to touch the seven producer sites.
2. New handler `app/core/handlers/push_delivery.py` registered for topic `"push"`:
   - Load the notification row. Skip if already `read_at`, older than 15 min (a late push is noise), or
     **`kind` is not in the push allow-list** (below). Allow-list, not deny-list: `unrouted` and routine
     status changes stay silent by omission, and a kind added later does not surprise officers at 02:00.
     ```python
     # exact keys from app/core/notification_texts.py TEXTS (verified 2026-11-02)
     PUSH_KINDS = {"assigned", "approval_requested", "approval_approved", "approval_rejected",
                   "sla_breached"}
     ```
     Everything else stays silent, including `unrouted`, `approval_closed` (system-closed requests),
     `supervision_requested` and `supervision_responded`. SLA auto-escalation emits the same
     `sla_breached` kind, so breach and escalation are covered by one entry. If supervision alerts are
     wanted later, add two strings to this set — no other change.
   - No quiet hours: sending is unconditional in time. Only the stale check above suppresses a push.
   - Resolve targets:
     - `user` → subscriptions where `username = recipient_ref`
     - `department` → subscriptions where `department = recipient_ref`
     - `role` → subscriptions where `roles` contains `recipient_ref`
     - `citizen` → skip (citizen portal is out of scope)
   - Send with `pywebpush` (`webpush(..., ttl=300, urgency="high", timeout=5)`), payload:
     ```json
     { "title": "...", "body": "...", "url": "/ticket/CH-2026-000123", "tag": "ch-<notification_id>",
       "kind": "assigned", "lang": "bm" }
     ```
   - Concurrency capped (e.g. 20 in flight) and the whole handler kept under the outbox's 10 s timeout.
     A slow push service must not hold the outbox loop: use `asyncio.wait_for` per send.
   - `404`/`410` → delete the subscription. Other errors → increment `failure_count`; delete at 5.
   - Idempotency: the outbox may deliver the topic twice; `tag` uses the notification id, so the phone
     replaces rather than stacks. Delivery is at-least-once — accepted, notifications are advisory.
3. `push` events that fail are retried by the existing outbox sweeper. Permanent failure is logged and
   the ticket action is unaffected (handler runs in its own SAVEPOINT).

Language: the payload carries both languages? No — send `title`/`body` in the officer's app language is
not knowable server-side. Send the English text in `title`/`body` and include `title_bm`/`body_bm` in
`data`, letting the SW pick by the stored `lang` preference; default `bm` for MBJB. Keep total < 4 KB.

Config (env, platform):

```
VAPID_PUBLIC_KEY=...
VAPID_PRIVATE_KEY=...          # secret, never in the image or the repo
VAPID_SUBJECT=mailto:ops@mbjb.gov.my
PUSH_ENABLED=true              # false = accept subscriptions but send nothing
```

Key generation (once, then store in the secret manager):

```
python -c "from pywebpush import webpush; ..."   # or: npx web-push generate-vapid-keys
```

---

## 8. PWA changes

### 8.1 Service worker — `apps/pwa/src/sw.ts`

- `push` listener: parse `event.data.json()`, pick text by stored language, `showNotification(title,
  { body, icon, badge, tag, data: { url } })`. Never `waitUntil(fetch(...))` — the SW has no Bearer
  token (it lives in memory only), so an authenticated call from the SW would 401.
- `notificationclick`: `clients.matchAll({type:'window'})` → focus and `navigate(url)` if a window exists,
  else `clients.openWindow(url)`. Close the notification. Route via the app's existing
  `/ticket/$id` route; the cached app shell serves it offline.
- `pushsubscriptionchange`: **do not** try to resubscribe from the SW (needs auth). Set
  `idb`/`localStorage` flag `push:resubscribe-required`; the app re-subscribes on next open. The
  subscription is dead until then, which is acceptable and honest.

### 8.2 Permission UX

- New item on the existing settings screen: **"Ticket alerts"** toggle, plus a short line explaining
  what will arrive.
- Request permission **only** on tap (`Notification.requestPermission()` inside the click handler), never
  on load. A denied/ignored prompt on first visit is hard to recover from.
- States, all explicit:
  - Not installable / iOS Safari tab → "Add City OS Mobile to your Home Screen to enable alerts."
  - `Notification.permission === 'denied'` → "Blocked in browser settings" with per-platform re-enable
    steps; no retry button that can only fail.
  - `PushManager` unsupported → hide the toggle and say so.
- On enabling: fetch `/api/v1/push/public-key`, `registration.pushManager.subscribe({userVisibleOnly:true,
  applicationServerKey})`, POST to `/api/v1/push/subscriptions`.
- On disabling: `subscription.unsubscribe()` then DELETE; if DELETE fails, still unsubscribe locally and
  queue the DELETE in the existing `offline-queue.ts` so the server row is cleaned up later.

### 8.3 Shared handsets (must be handled)

Officers share devices; the existing cache policy already treats a handset as multi-user (see the
comment in `sw.ts` about one officer reading another's tickets).

- On logout: `subscription.unsubscribe()` + DELETE for that user, so the next officer does not receive
  their predecessor's alerts.
- On login: call `/api/v1/push/subscriptions/refresh`; if the device is already subscribed under the
  previous user, resubscribe to bind the endpoint to the new user (upsert on endpoint).
- Notification body must not contain sensitive free text (comments, citizen phone numbers). Use the
  generated title/body only — they are already ticket-UID level.

---

## 9. Phases and tasks

### Phase 0 — In-app bell (1 day, ships first)

Bell before push: a dropped push must be recoverable in-app, and the bell needs no platform change.

| # | Task | Files | Done when |
|---|---|---|---|
| 0.1 | API client | `apps/pwa/src/lib/notifications-api.ts` | `GET /api/v1/notifications?unread=`, `PATCH /api/v1/notifications/{id}/read`, `POST /api/v1/notifications/read-all`; 50-item page, `unread_count` |
| 0.2 | Bell + badge | `__root.tsx` header, new `/notifications` route | unread count on the bell; route lists newest first, bilingual by app language, tap opens `/ticket/<uid>`, mark-read on open |
| 0.3 | Polling | route mount + `visibilitychange` | refetch on focus and every 60 s while visible; **no background polling** (battery) — that is what push is for |
| 0.4 | Empty/error states | same | "No notifications" and a retry that does not loop |
| 0.5 | Tests | Vitest + Playwright with stubbed API | unread badge, read-all, deep link to ticket |

No platform work: the endpoints and table exist (`app/api/notifications.py`). Verify the department
"shared inbox" semantics on screen — the first reader marks it read for the team, so the UI must say
"read by your department", not "read by you".

### Phase 1 — Platform storage + API (1 day)

| # | Task | Files | Done when |
|---|---|---|---|
| 1.1 | Migration `022_add_push_subscriptions` | `alembic/versions/022_add_push_subscriptions.py` | `alembic upgrade head` on a scratch DB; downgrade works; `tests/pg/test_migrations.py` updated for the new table |
| 1.2 | Model + schemas | `app/models/push_subscription.py`, `app/schemas/push.py` | Model matches migration (column types, unique constraint) |
| 1.3 | Endpoints | `app/api/push.py`, `app/main.py` router include | `GET public-key`, `POST subscriptions` (upsert), `DELETE`, `POST refresh`; 401 unauthenticated; 400 on non-https endpoint |
| 1.4 | Tests | `tests/core/test_push_api.py` | per-user isolation (A cannot delete B's endpoint), upsert idempotency, role/department snapshot refresh |

### Phase 2 — PWA subscribe + SW (1.5 days)

| # | Task | Files | Done when |
|---|---|---|---|
| 2.1 | API client | `apps/pwa/src/lib/push-api.ts` | calls typed, errors surfaced |
| 2.2 | SW listeners | `apps/pwa/src/sw.ts` | `push` shows a notification; `notificationclick` focuses or opens `/ticket/<uid>` |
| 2.3 | Settings UI + states | settings route + i18n (`en`/`bm`) | all five states render correctly; permission requested only on tap |
| 2.4 | Lifecycle | login, logout, app open | subscribe on enable, unsubscribe on logout, refresh on open, pending-resubscribe flag consumed |
| 2.5 | Tests | `apps/pwa/src/lib/__tests__`, Playwright | unit: state machine + payload parsing; e2e: toggle renders per permission state, SW handler unit-tested via a synthetic `PushEvent` |

### Phase 3 — Sender (1.5 days)

| # | Task | Files | Done when |
|---|---|---|---|
| 3.1 | Enqueue `push` after insert | `app/core/handlers/notify_consumer.py` | one outbox row per notification, same transaction |
| 3.2 | Sender | `app/core/handlers/push_delivery.py` | user/role/department fan-out; `citizen` skipped; stale (>15 min) skipped |
| 3.3 | Pruning | same | 404/410 deletes; 5 failures deletes; 90-day sweep |
| 3.4 | Config | `app/config.py`, deploy env example | `PUSH_ENABLED=false` makes the sender a no-op and the API report `enabled:false` |
| 3.5 | Tests | `tests/core/test_push_delivery.py` | mocked `webpush`: correct recipients for each type, 410 deletes, one slow send does not exceed the handler timeout, double delivery does not duplicate UI (tag) |

### Phase 4 — Device matrix + rollout (1 day)

- Android Chrome, installed PWA: receive with app closed, tap opens the right ticket.
- iOS 17/18, installed from Safari: same; confirm the "add to Home Screen" gate.
- Desktop Chrome: optional, works with no extra code.
- Airplane mode / expired subscription: no crash, row pruned on next send.
- Shared handset: log out A, log in B — A's alerts stop.
- Load: 50 subscriptions, one assignment → 50 sends within the 10 s handler budget (raise the
  concurrency cap or split the event if not).

---

## 10. Test strategy

| Layer | How |
|---|---|
| Migration | `tests/pg/test_migrations.py` — table shape, unique constraint, cascade behaviour |
| API | `tests/core/test_push_api.py` with the existing `as_user` fixtures |
| Sender | `pywebpush.webpush` monkeypatched; assert call args and pruning, never hit a real push service |
| PWA logic | Vitest for permission state machine, payload → notification options, language choice |
| E2E | Playwright cannot receive a real push; drive the SW's `push` handler directly with a synthetic event, and stub `/api/v1/push/*` |
| Manual | one Android + one iPhone, evidence screenshots into `docs/qa/` |

---

## 11. Estimate

| Phase | Days |
|---|---|
| 0 In-app bell | 1.0 |
| 1 Platform storage + API | 1.0 |
| 2 PWA + SW | 1.5 |
| 3 Sender + pruning | 1.5 |
| 4 Device matrix + rollout | 1.0 |
| **Total** | **6.0** |

Bell ships as its own PR on day 1, independent of everything else. First end-to-end push on Android:
end of day 4. iOS adds verification time, not code.

---

## 12. Risks

| Risk | Mitigation |
|---|---|
| **iOS install requirement** is a UX cliff — officers who use the Safari tab get nothing | Detect non-standalone and explain before offering the toggle; include "install" in the field onboarding checklist |
| Push service unreachable from MBJB network (FCM/APNs blocked) | Verify on the target network in phase 4 before promising the feature; fall back to the in-app bell |
| Shared handset leaks an alert to the next officer | Unsubscribe on logout; no sensitive text in the payload; per-user binding on upsert |
| Role snapshot goes stale | Refresh on app open/subscribe; documented fallback to a 5-min-cached Keycloak lookup |
| Notification storm (department-wide role) | One push per notification row, not per ticket update; `unrouted` is already excluded |
| VAPID key loss = every existing subscription dies | Store the key pair in the secret manager and back it up with the deployment secrets, not in git |
| Duplicate delivery after outbox retry | `tag` collapses to one visible notification; at-least-once accepted |
| Always-on alerts wake officers at night | Accepted by decision. Per-user mute is a small follow-up (subscription column + settings toggle), not part of this work |

All four open decisions are resolved in §1a. One implementation detail remains: the exact SLA kind string
is `sla_breached` (verified in `app/core/notification_texts.py`), and auto-escalation emits the same kind —
no separate escalation entry is needed.

---

## 13. Deployment prerequisites

- HTTPS with a trusted certificate on the field host (not `http://<ip>`).
- Platform image gains `pywebpush` + `cryptography`; rebuild and redeploy City Help API.
- Secret `VAPID_PRIVATE_KEY` in the deploy environment; public key returned by the API.
- Alembic migration runs as part of the deploy (existing pipeline), not by hand.
- No nginx/CSP change expected: the SW is already served, and the browser talks to the push service
  directly. Verify `/sw.js` is cache-busted on release (it already is, via `registerType: autoUpdate`).

### VAPID subject — recommendation

`VAPID_SUBJECT` is the contact the push service (FCM, Mozilla, Apple) can use to reach the operator of
the sending server. RFC 8292 allows a `mailto:` URI or an `https:` URL; browsers accept both, `mailto:` is
the most widely supported.

**Recommended:** `mailto:cityhelp-ops@mbjb.gov.my`

- A **role mailbox**, not a person — the address outlives staff changes. If the City Help ops inbox
  already exists under another name, use that one instead; the requirement is that someone reads it.
- Must be a real, monitored mailbox. Push services may use it for abuse/contact mail about this sender,
  and placeholder domains (`example.com`) are rejected by some services.
- Fallback if MBJB IT prefers a URL: `https://cityhelp.mbjb.gov.my` — must resolve publicly.

This is the only value needed from MBJB. It goes in the deploy secrets next to the key pair; changing it
later does not invalidate existing subscriptions, but keep it stable so a push service can always reach
the team.

---

## 14. Out of scope

- Citizen-facing push (citizen portal is a separate surface and has `recipient_type='citizen'` rows).
- SMS / WhatsApp / email fallbacks.
- Background data sync of tickets (the offline queue already handles mutations).
- Push for Terra map events (that is the Stellio SSE gateway's job).