# Plan: PWA Terra HUD Theme + Create Ticket Form

**Branch:** `feat/pwa-hud-theme-create-ticket`
**Repo:** `/home/dev-testing/city-os/city-os-mobile`
**Goal:** Transform the PWA from light/white theme to Terra HUD dark glass-morphism, add create-ticket form for field officers.

## Phase 1: HUD Theme

### CSS Custom Properties (styles.css)
Add HUD tokens matching the console:
- `--bg-deep: #06080f`, `--bg: #0a0e1a`
- `--glass: rgba(14, 20, 36, 0.72)`, `--glass-strong: rgba(20, 28, 48, 0.88)`
- `--border: rgba(61, 232, 255, 0.12)`, `--border-bright: rgba(61, 232, 255, 0.35)`
- `--ink: #e2e8f0`, `--ink-dim: #64748b`, `--ink-faint: #475569`
- `--cyan: #3de8ff`, `--indigo: #5e6ad2`
- `--safe: #10b981`, `--warn: #eab308`, `--danger: #ef4444`
- `--font-display: 'SF Mono', monospace`

### UI Package Updates
- `Button.tsx`: Replace `bg-blue-600` → `bg-[var(--cyan)]`, `text-white` → `text-[var(--bg-deep)]`, `bg-gray-200` → `bg-[var(--glass)]`, etc.
- `Card.tsx`: Replace `bg-white border-gray-200 shadow-sm` → `bg-[var(--glass)] border-[var(--border)]`
- `Badge.tsx`: Replace light colors with HUD color tokens

### Page Updates
- `__root.tsx`: `bg-gray-50` → `bg-[var(--bg-deep)]`, bottom nav to HUD glass
- `login.tsx`: Already dark, polish with HUD logo + glass card
- `tickets.tsx`: All light classes → HUD tokens
- `ticket.$id.tsx`: All light classes → HUD tokens, all cards → glass panels
- `attendance.tsx`: All light classes → HUD tokens

## Phase 2: Create Ticket Form

### New Route
- `apps/pwa/src/routes/create-ticket.tsx` — full-page form or modal
- Add to bottom nav: "Create" tab with `Plus` icon
- Add to root layout routing

### Form Fields
- **Title** (required) — text input
- **Description** — textarea
- **Incident Type** — dropdown (fetched from `GET /api/v1/incident-types`)
- **Urgency** — Low/Medium/High/Critical
- **Location** — auto-captured from GPS, editable
- **Photo** — file input + preview (camera roll)
- **Reporter Name** — optional (auto-fill from logged-in user)
- **Reporter Contact** — optional

### API Flow
- BFF proxy: `POST /api/v1/events` → City Help API
- Include `reporter_name`, `reporter_contact`, `lat`, `lng`, `source: 'mobile'`
- Support offline: queue mutation if no connection

### Error Handling
- Validation errors shown inline
- Offline: save to IndexedDB, show "Queued" badge
- Retry on reconnect (service worker)

## Sequencing
1. CSS variables + UI package + pages (theme)
2. Create ticket route + form + API
3. Build + test + PR