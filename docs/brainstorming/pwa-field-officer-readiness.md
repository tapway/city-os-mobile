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