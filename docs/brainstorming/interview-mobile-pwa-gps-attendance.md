# Mobile PWA + GPS Attendance — Interview

**Date:** 2026-08-02
**Participants:** CH Lim (user), Hermes Agent
**Source spec:** `pwa-ops-app-spec.md` (shared by user)

---

## Confirmed Intent

**Outcome:** A new `city-os-mobile` repo with an installable PWA for field operations staff, starting with City Help features (ticket handling + GPS attendance) and architected to extend to the full City OS mobile surface (cameras, alerts, map, push) in later phases.

### Architecture decisions (all locked)

| # | Decision | Choice |
|---|---|---|
| 1 | Scope | Full City OS mobile ops app (north star), but Phase 1 = City Help only (tickets + GPS attendance). Camera/alerts/map layers deferred. |
| 2 | Repo | New `city-os-mobile` repo, monorepo (`apps/pwa` + `apps/bff` + `packages/`), per spec §11 |
| 3 | BFF | **Built in Phase 1** (was deferred, then updated for security). FastAPI, ~5 endpoints. Holds refresh token as HttpOnly cookie; PWA sees only short-lived access tokens in memory. |
| 4 | Frontend stack | React 19 + Vite 7 + TanStack Router + TanStack Query + TanStack DB 0.6 (offline persistence) + Radix UI + Tailwind v4 + vite-plugin-pwa (Workbox injectManifest). Strict TypeScript. |
| 5 | Auth | OIDC Authorization Code + PKCE against Keycloak (City Guard). Access token **in-memory only**. Refresh via **BFF-mediated HttpOnly cookie** (not browser storage). |
| 6 | GPS validation | Ticket-location-based — staff prove they're at the assigned ticket's site by clocking in within the configured radius of the ticket's coordinates. |
| 7 | No-coordinate tickets | Manual override — staff tap "I'm on-site, confirm," supervisor sees a "no GPS validation" flag on the attendance record. |
| 8 | Field-staff determination | Role-based — anyone with `handling_staff` Keycloak role is field-based and subject to GPS attendance. All other roles (intake, dispatch, reviewer, management, admin) are excluded. |
| 9 | Workflow integration | Parallel record with warning badge — staff can transition to IN_PROGRESS without clocking in, but the ticket shows a "not clocked in" warning visible to supervisors. Not a hard gate. |
| 10 | Attendance model | Hybrid — shift clock-in/out once per day (daily/monthly summaries, late/early/absent) + per-ticket GPS auto-logged on each ticket transition to IN_PROGRESS (passive, no separate action). |
| 11 | On-site radius | Single global setting (default 200m), configurable by admin. Per-incident-type radius deferred to v2. |
| 12 | Work hours | Configurable per person — admins set each user's scheduled shift start/end. Late = clock-in after shift_start + 30min grace. Early = clock-out before shift_end. Absent = no clock-in by shift_start + 2h. |
| 13 | Code origin | Build PWA from scratch in the new repo. Do NOT adapt City Help's existing `frontend/` (different router, state layer, component library, performance budget). |
| 14 | Keycloak public exposure | Assumed handled separately — does not block this workstream. |

### Phase 1 scope (City Help portion)
- PWA shell: manifest, service worker, offline app shell, install flow (Android `beforeinstallprompt`, iOS custom sheet)
- Auth: Keycloak OIDC PKCE, in-memory token, silent renew
- Ticket list: assigned-to-me tickets, status tabs, pull-to-refresh
- Ticket detail: view details, location map pin, timeline, attachments
- Ticket actions: acknowledge, start handling (IN_PROGRESS with auto GPS log), submit closure request, return with comments
- Ticket create: report new event (photo + description + GPS) — offline queue via TanStack DB
- Shift attendance: clock-in (validates against first assigned ticket or office), clock-out, daily summary
- Per-ticket GPS: auto-logged on IN_PROGRESS transition, shows distance-from-ticket-site badge
- Manual override: for no-coordinate tickets, staff confirms on-site, supervisor sees flag
- Push notifications: Web Push (VAPID) for new assignments, SLA warnings, supervisor alerts
- Native-feel: View Transitions API, 44pt targets, skeleton screens, safe areas, dark-first palette, wake lock during live view

### Deferred to Phase 2+ (full City OS mobile surface)
- Camera live view (WHEP/WebRTC) + camera wall (snapshots) + recorded playback (HLS)
- Alerts/incident feed (Kafka→SSE via BFF)
- Map view (MapLibre GL JS) with incident + camera layers
- Offline map tiles

**User:** Field handling staff (ticket handling + GPS attendance). Later phases: all City OS operations staff (control-room + field).

**Why now:** URS §P513–P547 Smart Operations App is the last major gap in the v1.4 spec roadmap. Knowledge Hub (v2.15.0) just shipped. This is the next priority.

**Success:** A field staff member installs the PWA on their phone, logs in via Keycloak, sees their assigned tickets, drives to the first site, opens the ticket, taps "Start Handling" — the system auto-logs their GPS position (320m from ticket site ✓), the ticket shows "IN_PROGRESS — on-site verified." At end of shift they clock out. The supervisor's dashboard shows the shift summary + per-ticket GPS validation results. When the staff loses signal in a tunnel, ticket creation queues offline and syncs on reconnect.

**Constraints:**
- New repo, no adaptation of City Help's existing frontend
- React 19 + Vite 7 + TanStack stack (no Preact/Solid)
- PWA installable on Android + iOS (no app store)
- TLS on a real domain (service workers + geolocation require it)
- Performance budget: ≤180 KB JS gzipped, LCP ≤ 2.0s, INP ≤ 200ms
- Configurable per-person work hours (not just global)
- Single global on-site radius (200m default)
- Role-based field-staff determination (handling_staff role only)
- Parallel attendance (not a hard gate on ticket transitions)
- TDD required (unit + E2E tests)
- Existing City Help attendance table + API (`POST /api/v1/attendance/clock-in`) — extend, don't rebuild

**Out of scope:**
- App store distribution (Bubblewrap/TWA escape hatch documented but not used)
- Turn-by-turn navigation, background location tracking, Bluetooth/NFC/USB
- Offline video
- Camera/alerts/map (Phase 2+)

---

## Interview Q&A Summary

### Q1: Combined or separate workstreams?
**A:** Full City OS mobile ops app is the north star, but start with the City Help portion (tickets + GPS attendance) and not be too ambitious.

### Q2: New repo or extend City Help's frontend?
**A:** New `city-os-mobile` repo, monorepo structure per spec §11, BFF deferred to phase 2 (later updated to Phase 1 for security).

### Q3: What does GPS validation validate against?
**A:** Ticket-location-based (option C) — staff prove they're at the assigned ticket's site by clocking in within the configured radius of the ticket's coordinates.

### Q4: Tickets with no coordinates? Desk-based staff?
**A:** No-coordinate tickets → manual override with supervisor-visible flag. Desk-based staff should be excluded from attendance entirely.

### Q5: Role-based or per-user field-staff flag?
**A:** Role-based — `handling_staff` Keycloak role = field-based, everyone else excluded.

### Q6: Hard gate or parallel record?
**A:** Parallel record with warning badge — staff can transition to IN_PROGRESS without clocking in, but ticket shows "not clocked in" warning visible to supervisors.

### Q7: Shift-based or per-ticket attendance?
**A:** Hybrid — shift clock-in/out once per day + per-ticket GPS auto-logged on ticket transitions, both stored.

### Q8: Radius + work hours defaults?
**A:** Single global radius (200m default). Work hours configurable by person (not global).

### Q9: From-scratch or adapt City Help frontend?
**A:** Build from scratch — researched best stack, confirmed React 19 + Vite 7 + TanStack.

### Q10: Accept spec stack + TanStack DB 0.6 for offline?
**A:** Accepted — with one change: use `idb` library instead of TanStack DB 0.6 (too new for production government app).

### Q11: Phase 1 security approach?
**A:** Build a thin BFF in Phase 1 (was deferred, updated for security). Keycloak public domain handled separately (assume open).
