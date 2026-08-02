# Mobile PWA + GPS Attendance Implementation Plan

> **For Hermes:** Use subagent-driven-development skill to implement this plan task-by-task.

**Goal:** Build a new `city-os-mobile` repo with a PWA (installable on Android + iOS) for field handling staff, starting with City Help ticket handling + GPS attendance. BFF in Phase 1 for secure auth token management.

**Architecture:** Monorepo (`apps/pwa` + `apps/bff` + `packages/schemas` + `packages/ui`). PWA = Vite 7 + React 19 + TanStack Router + TanStack Query + Radix + Tailwind v4 + vite-plugin-pwa. BFF = FastAPI (Python) with OIDC PKCE against Keycloak (City Guard) + reverse proxy to City Help API. Access token in-memory, refresh token as HttpOnly cookie. Offline ticket queue via `idb` + TanStack Query `onMutate`. Parallel build: PWA uses MSW mocks while BFF is built.

**Tech Stack:** React 19, Vite 7, TanStack Router/Query, Radix UI, Tailwind v4, TypeScript strict, vite-plugin-pwa (Workbox injectManifest), `idb` for IndexedDB, MSW for dev mocks, FastAPI + httpx + city-guard for BFF, Pydantic for BFF schemas, Vitest for PWA unit tests, Playwright for E2E, pytest for BFF tests.

**Confirmed decisions (from interview + brainstorming):**
- New `city-os-mobile` repo (NOT extending City Help's existing frontend)
- BFF in Phase 1 (was deferred, now included for security)
- FastAPI (Python) for BFF — matches team stack, reuses city-guard SDK
- React 19 + Vite 7 + TanStack stack (no Preact/Solid)
- GPS validation: ticket-location-based (staff prove they're at the ticket's site)
- No-coordinate tickets: manual override with supervisor-visible flag
- Role-based field-staff determination: `handling_staff` Keycloak role only
- Parallel record with warning badge (not a hard gate on ticket transitions)
- Hybrid attendance: shift clock-in/out once per day + per-ticket GPS auto-logged
- Single global on-site radius (200m default), configurable by admin
- Per-person work hours (admin sets each user's shift start/end)
- Keycloak public exposure assumed handled separately
- Separate `ticket_attendance_logs` table (clean separation from shift records)
- Build order: Parallel (PWA with MSW mocks, BFF simultaneously)
- `idb` library for offline queue (TanStack DB 0.6 too new)

**Branch:** `SAM-MOB-01-pwa-gps-attendance` (in new `city-os-mobile` repo)

---

## Phase 0 — Repo + Infrastructure Setup

### Task 1: Create city-os-mobile repo scaffold

**Objective:** Create the monorepo with turbo, workspace config, and CI.

**Files:**
- Create: `/home/dev-testing/city-os/city-os-mobile/` (new repo root)
- Create: `package.json` (workspace root)
- Create: `turbo.json`
- Create: `.github/workflows/ci.yml`
- Create: `README.md`
- Create: `.gitignore`

**Step 1: Create directory + git init**

```bash
mkdir -p /home/dev-testing/city-os/city-os-mobile
cd /home/dev-testing/city-os/city-os-mobile
git init
```

**Step 2: Create root `package.json`**

```json
{
  "name": "city-os-mobile",
  "private": true,
  "workspaces": ["apps/*", "packages/*"],
  "scripts": {
    "dev": "turbo dev",
    "build": "turbo build",
    "test": "turbo test",
    "lint": "turbo lint",
    "typecheck": "turbo typecheck"
  },
  "devDependencies": {
    "turbo": "^2.0.0"
  },
  "packageManager": "pnpm@9.0.0"
}
```

**Step 3: Create `turbo.json`**

```json
{
  "$schema": "https://turbo.build/schema.json",
  "tasks": {
    "dev": { "cache": false, "persistent": true },
    "build": { "dependsOn": ["^build"], "outputs": ["dist/**"] },
    "test": { "dependsOn": ["^build"] },
    "lint": {},
    "typecheck": {}
  }
}
```

**Step 4: Create `.gitignore`**

```gitignore
node_modules/
dist/
.turbo/
.env
.env.local
*.log
.DS_Store
coverage/
playwright-report/
test-results/
```

**Step 5: Create `README.md`**

```markdown
# City OS Mobile

Mobile PWA for City OS field operations staff.

## Structure
- `apps/pwa` — React 19 + Vite 7 PWA
- `apps/bff` — FastAPI backend-for-frontend
- `packages/schemas` — shared Zod schemas
- `packages/ui` — shared Radix-based component primitives

## Phase 1 scope
- Ticket list, detail, handling actions (acknowledge, start handling, submit closure)
- Shift clock-in/out with GPS validation against ticket location
- Per-ticket GPS auto-logging on IN_PROGRESS transition
- Offline ticket queue via IndexedDB
- Push notifications (Web Push VAPID)
```

**Step 6: Commit + push**

```bash
cd /home/dev-testing/city-os/city-os-mobile
git add -A
git commit -m "chore: scaffold city-os-mobile monorepo with turbo + pnpm workspaces"
gh repo create tapway/city-os-mobile --public --source=. --push
```

---

### Task 2: Create packages/schemas (shared Zod)

**Objective:** Shared Zod schemas for ticket, attendance, user — used by PWA (direct) and BFF (via JSON Schema → Pydantic).

**Files:**
- Create: `packages/schemas/package.json`
- Create: `packages/schemas/tsconfig.json`
- Create: `packages/schemas/src/index.ts`
- Create: `packages/schemas/src/ticket.ts`
- Create: `packages/schemas/src/attendance.ts`
- Create: `packages/schemas/src/user.ts`

**Step 1: Init package**

```bash
cd /home/dev-testing/city-os/city-os-mobile
mkdir -p packages/schemas/src
```

`packages/schemas/package.json`:
```json
{
  "name": "@city-os/schemas",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "main": "./src/index.ts",
  "scripts": {
    "typecheck": "tsc --noEmit",
    "generate-json-schema": "tsx src/export-schemas.ts"
  },
  "dependencies": {
    "zod": "^4.0.0"
  },
  "devDependencies": {
    "typescript": "^5.5.0",
    "tsx": "^4.0.0"
  }
}
```

`packages/schemas/tsconfig.json`:
```json
{
  "compilerOptions": {
    "strict": true,
    "noUncheckedIndexedAccess": true,
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "bundler",
    "esModuleInterop": true
  }
}
```

**Step 2: Write ticket schema**

`packages/schemas/src/ticket.ts`:
```typescript
import { z } from 'zod';

export const TicketStatus = z.enum([
  'OPEN', 'VERIFIED', 'ASSIGNED', 'IN_PROGRESS', 'RESOLVED', 'CLOSED',
]);
export type TicketStatus = z.infer<typeof TicketStatus>;

export const Ticket = z.object({
  id: z.number(),
  ticket_uid: z.string(),
  title: z.string(),
  description: z.string().nullable(),
  status: TicketStatus,
  lat: z.number().nullable(),
  lng: z.number().nullable(),
  location_desc: z.string().nullable(),
  assigned_to: z.string().nullable(),
  department_id: z.number().nullable(),
  created_at: z.string().datetime().nullable(),
  updated_at: z.string().datetime().nullable(),
});
export type Ticket = z.infer<typeof Ticket>;

export const TicketList = z.array(Ticket);
export type TicketList = z.infer<typeof TicketList>;

export const CreateTicketInput = z.object({
  title: z.string().min(1).max(500),
  description: z.string().optional(),
  lat: z.number().optional(),
  lng: z.number().optional(),
  source: z.literal('mobile'),
  lane: z.literal('A'),
});
export type CreateTicketInput = z.infer<typeof CreateTicketInput>;
```

**Step 3: Write attendance schema**

`packages/schemas/src/attendance.ts`:
```typescript
import { z } from 'zod';

export const AttendanceStatus = z.enum([
  'present', 'late', 'early_leave', 'absent',
]);
export type AttendanceStatus = z.infer<typeof AttendanceStatus>;

export const ShiftAttendance = z.object({
  id: z.number(),
  user_id: z.string(),
  clock_in: z.string().datetime().nullable(),
  clock_in_lat: z.number().nullable(),
  clock_in_lng: z.number().nullable(),
  clock_out: z.string().datetime().nullable(),
  clock_out_lat: z.number().nullable(),
  clock_out_lng: z.number().nullable(),
  date: z.string(),
  status: AttendanceStatus.nullable(),
});
export type ShiftAttendance = z.infer<typeof ShiftAttendance>;

export const ClockInInput = z.object({
  lat: z.number(),
  lng: z.number(),
  ticket_id: z.number().optional(),  // optional: validates against ticket location
});
export type ClockInInput = z.infer<typeof ClockInInput>;

export const ClockOutInput = z.object({
  lat: z.number(),
  lng: z.number(),
});
export type ClockOutInput = z.infer<typeof ClockOutInput>;

export const TicketAttendanceLog = z.object({
  id: z.number(),
  ticket_id: z.number(),
  user_id: z.string(),
  action: z.string(),
  lat: z.number().nullable(),
  lng: z.number().nullable(),
  distance_from_site_meters: z.number().nullable(),
  is_manual_override: z.boolean(),
  created_at: z.string().datetime(),
});
export type TicketAttendanceLog = z.infer<typeof TicketAttendanceLog>;
```

**Step 4: Write user schema**

`packages/schemas/src/user.ts`:
```typescript
import { z } from 'zod';

export const UserRole = z.enum([
  'intake_officer', 'dispatch_officer', 'handling_staff',
  'reviewer', 'management', 'admin',
]);
export type UserRole = z.infer<typeof UserRole>;

export const User = z.object({
  id: z.string(),
  username: z.string(),
  full_name: z.string().nullable(),
  email: z.string().email().nullable(),
  role: UserRole,
  department_id: z.number().nullable(),
  is_field_staff: z.boolean(),  // derived from role === 'handling_staff'
  shift_start: z.string().nullable(),  // 'HH:MM' format, configurable per user
  shift_end: z.string().nullable(),
});
export type User = z.infer<typeof User>;
```

**Step 5: Write index**

`packages/schemas/src/index.ts`:
```typescript
export * from './ticket';
export * from './attendance';
export * from './user';
```

**Step 6: Commit**

```bash
git add packages/schemas
git commit -m "feat(schemas): shared Zod schemas for ticket, attendance, user"
```

---

### Task 3: Create packages/ui (Radix-based primitives)

**Objective:** Shared unstyled component primitives for the PWA.

**Files:**
- Create: `packages/ui/package.json`
- Create: `packages/ui/tsconfig.json`
- Create: `packages/ui/src/Button.tsx`
- Create: `packages/ui/src/Card.tsx`
- Create: `packages/ui/src/Badge.tsx`
- Create: `packages/ui/src/index.ts`

**Step 1: Init package**

```bash
mkdir -p packages/ui/src
```

`packages/ui/package.json`:
```json
{
  "name": "@city-os/ui",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "main": "./src/index.ts",
  "scripts": { "typecheck": "tsc --noEmit" },
  "dependencies": {
    "@radix-ui/react-dialog": "^1.1.0",
    "@radix-ui/react-slot": "^1.1.0",
    "class-variance-authority": "^0.7.0",
    "clsx": "^2.1.0",
    "tailwind-merge": "^3.0.0"
  },
  "peerDependencies": {
    "react": "^19.0.0"
  },
  "devDependencies": {
    "typescript": "^5.5.0",
    "@types/react": "^19.0.0"
  }
}
```

**Step 2: Write Button (Radix Slot + CVA)**

`packages/ui/src/Button.tsx`:
```tsx
import { Slot } from '@radix-ui/react-slot';
import { cva, type VariantProps } from 'class-variance-authority';
import { forwardRef } from 'react';
import { cn } from './utils';

const buttonVariants = cva(
  'inline-flex items-center justify-center gap-2 rounded-lg font-medium transition-colors disabled:pointer-events-none disabled:opacity-50',
  {
    variants: {
      variant: {
        primary: 'bg-blue-600 text-white hover:bg-blue-700',
        secondary: 'bg-gray-200 text-gray-900 hover:bg-gray-300',
        outline: 'border border-gray-300 bg-transparent hover:bg-gray-100',
        ghost: 'bg-transparent hover:bg-gray-100',
        danger: 'bg-red-600 text-white hover:bg-red-700',
      },
      size: {
        sm: 'h-9 px-3 text-sm',
        md: 'h-11 px-4 text-base',
        lg: 'h-14 px-6 text-lg',
        icon: 'h-11 w-11',
      },
    },
    defaultVariants: { variant: 'primary', size: 'md' },
  }
);

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {
  asChild?: boolean;
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, asChild = false, ...props }, ref) => {
    const Comp = asChild ? Slot : 'button';
    return (
      <Comp
        className={cn(buttonVariants({ variant, size }), className)}
        ref={ref}
        {...props}
      />
    );
  }
);
Button.displayName = 'Button';
```

**Step 3: Write `utils.ts` (cn helper)**

`packages/ui/src/utils.ts`:
```typescript
import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}
```

**Step 4: Write Card + Badge + index**

`packages/ui/src/Card.tsx`:
```tsx
import { forwardRef, type HTMLAttributes } from 'react';
import { cn } from './utils';

export const Card = forwardRef<HTMLDivElement, HTMLAttributes<HTMLDivElement>>(
  ({ className, ...props }, ref) => (
    <div
      ref={ref}
      className={cn('rounded-xl border border-gray-200 bg-white shadow-sm', className)}
      {...props}
    />
  )
);
Card.displayName = 'Card';
```

`packages/ui/src/Badge.tsx`:
```tsx
import { cva, type VariantProps } from 'class-variance-authority';
import { forwardRef, type HTMLAttributes } from 'react';
import { cn } from './utils';

const badgeVariants = cva(
  'inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium',
  {
    variants: {
      variant: {
        default: 'bg-gray-100 text-gray-800',
        success: 'bg-green-100 text-green-800',
        warning: 'bg-yellow-100 text-yellow-800',
        danger: 'bg-red-100 text-red-800',
      },
    },
    defaultVariants: { variant: 'default' },
  }
);

export interface BadgeProps
  extends HTMLAttributes<HTMLSpanElement>,
    VariantProps<typeof badgeVariants> {}

export const Badge = forwardRef<HTMLSpanElement, BadgeProps>(
  ({ className, variant, ...props }, ref) => (
    <span ref={ref} className={cn(badgeVariants({ variant }), className)} {...props} />
  )
);
Badge.displayName = 'Badge';
```

`packages/ui/src/index.ts`:
```typescript
export * from './Button';
export * from './Card';
export * from './Badge';
export * from './utils';
```

**Step 5: Commit**

```bash
git add packages/ui
git commit -m "feat(ui): shared Radix-based Button, Card, Badge primitives"
```

---

## Phase 1 — PWA Scaffolding

### Task 4: Create apps/pwa Vite + React 19 project

**Objective:** Scaffold the PWA app with Vite, React 19, TypeScript strict, Tailwind v4, vite-plugin-pwa.

**Files:**
- Create: `apps/pwa/package.json`
- Create: `apps/pwa/vite.config.ts`
- Create: `apps/pwa/tsconfig.json`
- Create: `apps/pwa/index.html`
- Create: `apps/pwa/src/main.tsx`
- Create: `apps/pwa/src/App.tsx`
- Create: `apps/pwa/public/manifest.webmanifest`
- Create: `apps/pwa/public/sw.ts` (service worker source)

**Step 1: Init pwa package**

`apps/pwa/package.json`:
```json
{
  "name": "@city-os/pwa",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "scripts": {
    "dev": "vite",
    "build": "tsc -b && vite build",
    "preview": "vite preview",
    "test": "vitest run",
    "test:watch": "vitest",
    "typecheck": "tsc --noEmit",
    "lint": "oxlint src"
  },
  "dependencies": {
    "@city-os/schemas": "workspace:*",
    "@city-os/ui": "workspace:*",
    "@radix-ui/react-dialog": "^1.1.0",
    "@radix-ui/react-slot": "^1.1.0",
    "@tanstack/react-query": "^5.50.0",
    "@tanstack/react-router": "^1.50.0",
    "class-variance-authority": "^0.7.0",
    "clsx": "^2.1.0",
    "idb": "^8.0.0",
    "react": "^19.0.0",
    "react-dom": "^19.0.0",
    "tailwind-merge": "^3.0.0",
    "zod": "^4.0.0"
  },
  "devDependencies": {
    "@tailwindcss/vite": "^4.0.0",
    "@types/react": "^19.0.0",
    "@types/react-dom": "^19.0.0",
    "@vitejs/plugin-react-swc": "^4.0.0",
    "msw": "^2.0.0",
    "tailwindcss": "^4.0.0",
    "typescript": "^5.5.0",
    "vite": "^7.0.0",
    "vite-plugin-pwa": "^1.0.0",
    "vitest": "^2.0.0"
  }
}
```

**Step 2: Vite config**

`apps/pwa/vite.config.ts`:
```typescript
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react-swc';
import tailwindcss from '@tailwindcss/vite';
import { VitePWA } from 'vite-plugin-pwa';

export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
    VitePWA({
      strategies: 'injectManifest',
      srcDir: 'src',
      filename: 'sw.ts',
      registerType: 'prompt',  // show "new version ready" bar, don't auto-reload
      injectManifest: {
        swSrc: 'src/sw.ts',
        swDest: 'dist/sw.js',
        maximumFileSizeToCacheInBytes: 5 * 1024 * 1024,
      },
      manifest: {
        name: 'City OS Operations',
        short_name: 'City OS',
        id: '/',
        start_url: '/?source=pwa',
        scope: '/',
        display: 'standalone',
        orientation: 'portrait-primary',
        background_color: '#0B0F14',
        theme_color: '#0B0F14',
        categories: ['utilities', 'productivity'],
        icons: [
          { src: '/icons/192.png', sizes: '192x192', type: 'image/png' },
          { src: '/icons/512.png', sizes: '512x512', type: 'image/png' },
          { src: '/icons/maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
        shortcuts: [
          { name: 'Tickets', url: '/tickets' },
          { name: 'Clock In', url: '/attendance' },
        ],
      },
    }),
  ],
  server: {
    port: 5173,
    proxy: {
      '/api': { target: 'http://localhost:8002', changeOrigin: true },
      '/auth': { target: 'http://localhost:8002', changeOrigin: true },
    },
  },
  build: {
    target: 'es2022',
    sourcemap: true,
    rollupOptions: {
      output: {
        manualChunks: {
          'tanstack': ['@tanstack/react-query', '@tanstack/react-router'],
        },
      },
    },
  },
});
```

**Step 3: TypeScript config (strict)**

`apps/pwa/tsconfig.json`:
```json
{
  "compilerOptions": {
    "target": "ES2022",
    "useDefineForClassFields": true,
    "lib": ["ES2022", "DOM", "DOM.Iterable"],
    "module": "ESNext",
    "moduleResolution": "bundler",
    "skipLibCheck": true,
    "allowSyntheticDefaultImports": true,
    "esModuleInterop": true,
    "resolveJsonModule": true,
    "isolatedModules": true,
    "noEmit": true,
    "jsx": "react-jsx",
    "strict": true,
    "noUnusedLocals": true,
    "noUnusedParameters": true,
    "noFallthroughCasesInSwitch": true,
    "noUncheckedIndexedAccess": true,
    "verbatimModuleSyntax": true,
    "paths": {
      "@city-os/schemas": ["../../packages/schemas/src"],
      "@city-os/ui": ["../../packages/ui/src"]
    }
  },
  "include": ["src"]
}
```

**Step 4: index.html with viewport + safe areas**

`apps/pwa/index.html`:
```html
<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport"
          content="width=device-width, initial-scale=1, viewport-fit=cover" />
    <link rel="manifest" href="/manifest.webmanifest" />
    <meta name="theme-color" content="#0B0F14" />
    <title>City OS Operations</title>
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="/src/main.tsx"></script>
  </body>
</html>
```

**Step 5: main.tsx + App.tsx (minimal)**

`apps/pwa/src/main.tsx`:
```typescript
import React from 'react';
import ReactDOM from 'react-dom/client';
import { App } from './App';
import './styles.css';

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
```

`apps/pwa/src/App.tsx`:
```typescript
export function App() {
  return (
    <div className="min-h-screen bg-gray-50 p-4">
      <h1 className="text-2xl font-bold">City OS Operations</h1>
      <p className="text-gray-600">PWA scaffold</p>
    </div>
  );
}
```

`apps/pwa/src/styles.css`:
```css
@import "tailwindcss";

/* Native-feel globals — spec §9 */
body {
  overscroll-behavior: none;
  overflow: hidden;
  -webkit-tap-highlight-color: transparent;
}

* {
  touch-action: manipulation;
}

@media (prefers-reduced-motion: reduce) {
  *, *::before, *::after {
    animation-duration: 0.01ms !important;
    transition-duration: 0.01ms !important;
  }
}
```

**Step 6: Service worker (injectManifest)**

`apps/pwa/src/sw.ts`:
```typescript
import { precacheAndRoute } from 'workbox-precache';
import { registerRoute } from 'workbox-routing';
import { NetworkFirst, CacheFirst } from 'workbox-strategies';
import { ExpirationPlugin } from 'workbox-expiration';

// Precache the app shell
precacheAndRoute(self.__WB_MANIFEST || []);

// API GET — stale-while-revalidate, 24h
registerRoute(
  ({ url }) => url.pathname.startsWith('/api/'),
  new NetworkFirst({
    cacheName: 'api-cache',
    plugins: [new ExpirationPlugin({ maxAgeSeconds: 24 * 60 * 60 })],
  })
);

// Skip caching for HLS / WHEP (future camera work)
registerRoute(
  ({ url }) => url.pathname.includes('/stream') || url.pathname.includes('/hls'),
  ({ request }) => fetch(request)  // bypass SW
);
```

**Step 7: Verify build**

```bash
cd /home/dev-testing/city-os/city-os-mobile
pnpm install
pnpm --filter @city-os/pwa build
```
Expected: build succeeds, `dist/` created with `sw.js`, `index.html`, manifest.

**Step 8: Commit**

```bash
git add apps/pwa
git commit -m "feat(pwa): scaffold Vite + React 19 + Tailwind v4 + vite-plugin-pwa"
```

---

### Task 5: Create apps/bff FastAPI project

**Objective:** Scaffold the BFF FastAPI service with OIDC PKCE stubs and proxy to City Help.

**Files:**
- Create: `apps/bff/pyproject.toml`
- Create: `apps/bff/Dockerfile`
- Create: `apps/bff/src/main.py`
- Create: `apps/bff/src/settings.py`
- Create: `apps/bff/src/auth.py`
- `apps/bff/src/proxy.py`
- Create: `apps/bff/tests/test_health.py`

**Step 1: Init bff package**

`apps/bff/pyproject.toml`:
```toml
[build-system]
requires = ["setuptools>=64.0", "wheel"]
build-backend = "setuptools.build_meta"

[project]
name = "city-os-mobile-bff"
version = "0.1.0"
requires-python = ">=3.11"
dependencies = [
    "fastapi>=0.115.0",
    "uvicorn[standard]>=0.30.0",
    "httpx>=0.27.0",
    "pydantic>=2.0.0",
    "pydantic-settings>=2.0.0",
    "city-guard @ git+https://github.com/tapway/city-guard.git@main",
]

[project.optional-dependencies]
dev = [
    "pytest>=8.0.0",
    "pytest-asyncio>=0.24.0",
    "respx>=0.21.0",
]

[tool.pytest.ini_options]
asyncio_mode = "auto"
testpaths = ["tests"]
```

**Step 2: Settings**

`apps/bff/src/settings.py`:
```python
from pydantic_settings import BaseSettings

class Settings(BaseSettings):
    # Keycloak (public OIDC, PKCE)
    keycloak_url: str = "http://localhost:8080/realms/city-os"
    keycloak_client_id: str = "city-os-mobile"
    keycloak_client_secret: str = ""  # PKCE — no secret in browser, but BFF holds it for token exchange
    keycloak_redirect_uri: str = "http://localhost:5173/auth/callback"

    # City Help API (proxied)
    city_help_api_url: str = "http://localhost:8001"

    # BFF
    cookie_domain: str = "localhost"
    cookie_secure: bool = False  # True in prod (TLS required)
    access_token_ttl_minutes: int = 5
    refresh_token_ttl_hours: int = 12

    class Config:
        env_file = ".env"

settings = Settings()
```

**Step 3: main.py (FastAPI app)**

`apps/bff/src/main.py`:
```python
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from .auth import router as auth_router
from .proxy import router as proxy_router

app = FastAPI(
    title="City OS Mobile BFF",
    version="0.1.0",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173"],  # PWA dev
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(auth_router, prefix="/auth")
app.include_router(proxy_router, prefix="/api")


@app.get("/health")
async def health():
    return {"status": "ok"}
```

**Step 4: Auth router (stubs for Task 6 to implement)**

`apps/bff/src/auth.py`:
```python
from fastapi import APIRouter

router = APIRouter()


@router.get("/login")
async def login():
    """Redirect to Keycloak OIDC + PKCE."""
    # TODO Task 6: implement PKCE code challenge + redirect
    return {"todo": "implement PKCE login"}


@router.get("/callback")
async def callback(code: str):
    """Exchange code for tokens, set HttpOnly cookie, return access token."""
    # TODO Task 6
    return {"todo": "implement token exchange"}


@router.post("/refresh")
async def refresh():
    """Silent renew using HttpOnly refresh cookie."""
    # TODO Task 6
    return {"todo": "implement refresh"}


@router.post("/logout")
async def logout():
    """Revoke tokens at Keycloak, clear cookie."""
    # TODO Task 6
    return {"todo": "implement logout"}
```

**Step 5: Proxy router (stub for Task 7)**

`apps/bff/src/proxy.py`:
```python
from fastapi import APIRouter, Request, HTTPException

router = APIRouter()


@router.api_route("/{path:path}", methods=["GET", "POST", "PATCH", "PUT", "DELETE"])
async def proxy(path: str, request: Request):
    """Forward to City Help API with access token injected."""
    # TODO Task 7: read access token from request, inject into upstream call
    raise HTTPException(501, "Proxy not implemented — see Task 7")
```

**Step 6: Health test**

`apps/bff/tests/test_health.py`:
```python
from fastapi.testclient import TestClient
from src.main import app


def test_health():
    client = TestClient(app)
    resp = client.get("/health")
    assert resp.status_code == 200
    assert resp.json() == {"status": "ok"}
```

**Step 7: Install + verify**

```bash
cd /home/dev-testing/city-os/city-os-mobile/apps/bff
pip install -e ".[dev]"
pytest tests/test_health.py -v
```
Expected: 1 passed.

**Step 8: Commit**

```bash
git add apps/bff
git commit -m "feat(bff): scaffold FastAPI BFF with auth + proxy stubs"
```

---

### Task 6: Implement BFF auth (OIDC PKCE)

**Objective:** Implement Keycloak OIDC Authorization Code + PKCE flow in the BFF.

**Files:**
- Modify: `apps/bff/src/auth.py` (full implementation)
- Create: `apps/bff/tests/test_auth.py`
- Create: `apps/bff/src/pkce.py` (PKCE code verifier/challenge generator)

**Step 1: Write failing test**

`apps/bff/tests/test_auth.py`:
```python
"""Tests for BFF auth — OIDC PKCE against Keycloak."""
import respx
import httpx
from fastapi.testclient import TestClient
from src.main import app
from src.settings import settings


def test_login_redirects_to_keycloak():
    """GET /auth/login must redirect to Keycloak auth endpoint with PKCE params."""
    client = TestClient(app)
    resp = client.get("/auth/login", follow_redirects=False)
    assert resp.status_code in (302, 307)
    assert "keycloak" in resp.headers["location"] or "localhost:8080" in resp.headers["location"]
    # PKCE params in redirect URL
    loc = resp.headers["location"]
    assert "client_id=" in loc
    assert "response_type=code" in loc
    assert "code_challenge=" in loc
    assert "code_challenge_method=S256" in loc


@respx.mock
def test_callback_exchanges_code_for_tokens():
    """GET /auth/callback exchanges code for tokens, sets HttpOnly cookie."""
    respx.post(f"{settings.keycloak_url}/protocol/openid-connect/token").mock(
        return_value=httpx.Response(200, json={
            "access_token": "test-access",
            "refresh_token": "test-refresh",
            "expires_in": 300,
        })
    )
    client = TestClient(app)
    resp = client.get("/auth/callback", params={"code": "test-code"}, follow_redirects=False)
    assert resp.status_code in (200, 302)
    # HttpOnly cookie set
    set_cookie = resp.headers.get("set-cookie", "")
    assert "refresh_token" in set_cookie
    assert "HttpOnly" in set_cookie


@respx.mock
def test_refresh_returns_new_access_token():
    """POST /auth/refresh uses HttpOnly cookie to get new access token."""
    respx.post(f"{settings.keycloak_url}/protocol/openid-connect/token").mock(
        return_value=httpx.Response(200, json={
            "access_token": "new-access",
            "refresh_token": "new-refresh",
            "expires_in": 300,
        })
    )
    client = TestClient(app)
    resp = client.post("/auth/refresh", cookies={"refresh_token": "test-refresh"})
    assert resp.status_code == 200
    assert "access_token" in resp.json()
```

**Step 2: Run to verify failure**

```bash
cd apps/bff
pytest tests/test_auth.py -v
```
Expected: FAIL — endpoints return stubs.

**Step 3: Implement PKCE helper**

`apps/bff/src/pkce.py`:
```python
"""PKCE (Proof Key for Code Exchange) helpers for OIDC."""
import base64
import hashlib
import os
from typing import Optional

import httpx

from .settings import settings


def generate_verifier_and_challenge() -> tuple[str, str]:
    """Generate PKCE code_verifier + code_challenge (S256).

    Returns (verifier, challenge) — verifier is 43-128 chars random string,
    challenge is base64url(sha256(verifier)) without padding.
    """
    verifier_bytes = os.urandom(32)
    verifier = base64.urlsafe_b64encode(verifier_bytes).rstrip(b"=").decode()
    challenge_bytes = hashlib.sha256(verifier.encode()).digest()
    challenge = base64.urlsafe_b64encode(challenge_bytes).rstrip(b"=").decode()
    return verifier, challenge


def build_auth_url(state: str, code_challenge: str) -> str:
    """Build Keycloak authorization URL with PKCE params."""
    from urllib.parse import urlencode
    params = {
        "client_id": settings.keycloak_client_id,
        "redirect_uri": settings.keycloak_redirect_uri,
        "response_type": "code",
        "scope": "openid profile",
        "state": state,
        "code_challenge": code_challenge,
        "code_challenge_method": "S256",
    }
    return f"{settings.keycloak_url}/protocol/openid-connect/auth?{urlencode(params)}"


async def exchange_code_for_tokens(
    code: str, code_verifier: str
) -> Optional[dict]:
    """Exchange authorization code for tokens (server-side, holds refresh token)."""
    data = {
        "grant_type": "authorization_code",
        "client_id": settings.keycloak_client_id,
        "code": code,
        "redirect_uri": settings.keycloak_redirect_uri,
        "code_verifier": code_verifier,
    }
    if settings.keycloak_client_secret:
        data["client_secret"] = settings.keycloak_client_secret

    async with httpx.AsyncClient() as client:
        resp = await client.post(
            f"{settings.keycloak_url}/protocol/openid-connect/token",
            data=data,
        )
        resp.raise_for_status()
        return resp.json()


async def refresh_access_token(refresh_token: str) -> Optional[dict]:
    """Use refresh token to get a new access token."""
    data = {
        "grant_type": "refresh_token",
        "client_id": settings.keycloak_client_id,
        "refresh_token": refresh_token,
    }
    if settings.keycloak_client_secret:
        data["client_secret"] = settings.keycloak_client_secret

    async with httpx.AsyncClient() as client:
        resp = await client.post(
            f"{settings.keycloak_url}/protocol/openid-connect/token",
            data=data,
        )
        resp.raise_for_status()
        return resp.json()
```

**Step 4: Implement auth router**

`apps/bff/src/auth.py`:
```python
"""OIDC PKCE auth endpoints — BFF holds refresh token, PWA gets access token in-memory."""
import logging
from typing import Optional

import httpx
from fastapi import APIRouter, HTTPException, Request, Response
from fastapi.responses import RedirectResponse

from .pkce import (
    build_auth_url, exchange_code_for_tokens, refresh_access_token,
    generate_verifier_and_challenge,
)
from .settings import settings

logger = logging.getLogger(__name__)
router = APIRouter()


@router.get("/login")
async def login(request: Request):
    """Redirect to Keycloak OIDC + PKCE. Stores verifier in short-lived cookie."""
    verifier, challenge = generate_verifier_and_challenge()
    state = os.urandom(16).hex()
    auth_url = build_auth_url(state=state, code_challenge=challenge)

    response = RedirectResponse(auth_url, status_code=302)
    # Store verifier + state in short-lived HttpOnly cookies (10 min)
    response.set_cookie(
        key="pkce_verifier", value=verifier,
        httponly=True, max_age=600, samesite="lax",
        secure=settings.cookie_secure,
    )
    response.set_cookie(
        key="oauth_state", value=state,
        httponly=True, max_age=600, samesite="lax",
        secure=settings.cookie_secure,
    )
    return response


@router.get("/callback")
async def callback(
    request: Request,
    code: str = "",
    state: str = "",
):
    """Exchange code for tokens. Sets refresh_token as HttpOnly cookie.

    PWA reads the access_token from the JSON response and holds it in-memory.
    """
    cookies = request.cookies
    expected_state = cookies.get("oauth_state", "")
    verifier = cookies.get("pkce_verifier", "")

    if state != expected_state or not verifier:
        raise HTTPException(400, "OAuth state mismatch or missing PKCE verifier")

    tokens = await exchange_code_for_tokens(code=code, code_verifier=verifier)
    if not tokens or "access_token" not in tokens:
        raise HTTPException(400, "Token exchange failed")

    response = RedirectResponse(url="/?authed=1", status_code=302)
    # Refresh token: HttpOnly, 12 hours, SameSite=Lax
    response.set_cookie(
        key="refresh_token", value=tokens["refresh_token"],
        httponly=True, max_age=settings.refresh_token_ttl_hours * 3600,
        samesite="lax", secure=settings.cookie_secure,
    )
    # Clear PKCE cookies
    response.delete_cookie("pkce_verifier")
    response.delete_cookie("oauth_state")

    # Access token: returned in JSON body — PWA stores in-memory
    # (We can't put it in a query param for security — instead use a fragment)
    access_token = tokens["access_token"]
    expires_in = tokens.get("expires_in", settings.access_token_ttl_minutes * 60)
    # Redirect to PWA with token in URL fragment (not sent to server on subsequent requests)
    response = RedirectResponse(
        url=f"/auth/success#access_token={access_token}&expires_in={expires_in}",
        status_code=302,
    )
    response.set_cookie(
        key="refresh_token", value=tokens["refresh_token"],
        httponly=True, max_age=settings.refresh_token_ttl_hours * 3600,
        samesite="lax", secure=settings.cookie_secure,
    )
    return response


@router.post("/refresh")
async def refresh(request: Request):
    """Silent renew using HttpOnly refresh cookie. Returns new access token."""
    refresh_token = request.cookies.get("refresh_token")
    if not refresh_token:
        raise HTTPException(401, "No refresh token cookie")

    tokens = await refresh_access_token(refresh_token)
    if not tokens or "access_token" not in tokens:
        raise HTTPException(401, "Token refresh failed")

    return {
        "access_token": tokens["access_token"],
        "expires_in": tokens.get("expires_in", settings.access_token_ttl_minutes * 60),
    }


@router.post("/logout")
async def logout(request: Request):
    """Revoke refresh token at Keycloak + clear cookie."""
    refresh_token = request.cookies.get("refresh_token")
    response = Response(status_code=200)
    response.delete_cookie("refresh_token")

    if refresh_token:
        try:
            async with httpx.AsyncClient() as client:
                await client.post(
                    f"{settings.keycloak_url}/protocol/openid-connect/logout",
                    data={
                        "client_id": settings.keycloak_client_id,
                        "refresh_token": refresh_token,
                    },
                )
        except Exception as exc:
            logger.warning("Keycloak logout failed: %s", exc)

    return response
```

**Step 5: Run tests**

```bash
pytest tests/test_auth.py -v
```
Expected: 3 passed.

**Step 6: Commit**

```bash
git add apps/bff/src/auth.py apps/bff/src/pkce.py apps/bff/tests/test_auth.py
git commit -m "feat(bff): implement OIDC PKCE auth (login, callback, refresh, logout)"
```

---

### Task 7: Implement BFF proxy to City Help API

**Objective:** Reverse-proxy PWA API calls to City Help FastAPI with access token injected.

**Files:**
- Modify: `apps/bff/src/proxy.py` (full implementation)
- Create: `apps/bff/tests/test_proxy.py`

**Step 1: Write failing test**

`apps/bff/tests/test_proxy.py`:
```python
"""Tests for BFF proxy — forwards to City Help API with access token."""
import respx
import httpx
from fastapi.testclient import TestClient
from src.main import app
from src.settings import settings


@respx.mock
def test_proxy_forwards_get_with_auth_header():
    """Proxy must forward GET requests with Bearer token."""
    respx.get(f"{settings.city_help_api_url}/api/v1/events").mock(
        return_value=httpx.Response(200, json={"data": "test"})
    )
    client = TestClient(app)
    resp = client.get("/api/v1/events", headers={"Authorization": "Bearer test-token"})
    assert resp.status_code == 200
    assert resp.json() == {"data": "test"}


@respx.mock
def test_proxy_preserves_path_and_query():
    """Proxy must preserve path + query params."""
    respx.get(url__regex=f"{settings.city_help_api_url}/api/v1/events.*").mock(
        return_value=httpx.Response(200, json={"data": "test"})
    )
    client = TestClient(app)
    resp = client.get("/api/v1/events?status=OPEN&limit=10",
                      headers={"Authorization": "Bearer test-token"})
    assert resp.status_code == 200


def test_proxy_rejects_no_auth_header():
    """Proxy must 401 without Authorization header."""
    client = TestClient(app)
    resp = client.get("/api/v1/events")
    assert resp.status_code == 401
```

**Step 2: Run to verify failure**

```bash
pytest tests/test_proxy.py -v
```
Expected: FAIL — proxy returns 501.

**Step 3: Implement proxy**

`apps/bff/src/proxy.py`:
```python
"""Reverse proxy: BFF → City Help API with access token injection.

PWA sends `Authorization: Bearer <access_token>` (in-memory). BFF forwards
the same header to City Help. The access token is never persisted server-side.
"""
import logging

import httpx
from fastapi import APIRouter, HTTPException, Request, Response

from .settings import settings

logger = logging.getLogger(__name__)
router = APIRouter()


@router.api_route("/{path:path}", methods=["GET", "POST", "PATCH", "PUT", "DELETE"])
async def proxy(path: str, request: Request):
    """Forward to City Help API with the access token from the request."""
    auth_header = request.headers.get("Authorization")
    if not auth_header or not auth_header.startswith("Bearer "):
        raise HTTPException(401, "Missing Bearer token")

    # Build upstream URL
    upstream_url = f"{settings.city_help_api_url}/{path}"
    if request.url.query:
        upstream_url += f"?{request.url.query}"

    # Forward request with same method, headers, body
    headers = {
        "Authorization": auth_header,
        "Content-Type": request.headers.get("Content-Type", "application/json"),
    }

    body = await request.body()

    async with httpx.AsyncClient(timeout=30.0) as client:
        try:
            resp = await client.request(
                method=request.method,
                url=upstream_url,
                headers=headers,
                content=body,
            )
        except httpx.RequestError as exc:
            logger.error("BFF proxy upstream error: %s", exc)
            raise HTTPException(502, f"Upstream error: {exc}")

    # Return upstream response, preserving status + content type
    return Response(
        content=resp.content,
        status_code=resp.status_code,
        media_type=resp.headers.get("Content-Type", "application/json"),
    )
```

**Step 4: Run tests**

```bash
pytest tests/test_proxy.py -v
```
Expected: 3 passed.

**Step 5: Commit**

```bash
git add apps/bff/src/proxy.py apps/bff/tests/test_proxy.py
git commit -m "feat(bff): implement reverse proxy to City Help API with token injection"
```

---

## Phase 2 — PWA Auth + Shell

### Task 8: Implement PWA auth client (oidc-client-ts alternative — manual)

**Objective:** PWA-side auth: redirect to BFF `/auth/login`, capture access token from callback URL fragment, store in-memory, silent refresh via BFF `/auth/refresh`.

**Files:**
- Create: `apps/pwa/src/lib/auth.ts`
- Create: `apps/pwa/src/lib/api.ts`
- Create: `apps/pwa/src/hooks/useAuth.ts`
- Create: `apps/pwa/tests/auth.test.ts`

**Step 1: Write failing test**

`apps/pwa/tests/auth.test.ts`:
```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { getAccessToken, setAccessToken, clearAccessToken } from '../src/lib/auth';

describe('auth token management (in-memory only)', () => {
  beforeEach(() => clearAccessToken());

  it('setAccessToken stores token in memory, getAccessToken returns it', () => {
    setAccessToken('test-token-123', 300);
    expect(getAccessToken()).toBe('test-token-123');
  });

  it('clearAccessToken removes the token', () => {
    setAccessToken('test-token-123', 300);
    clearAccessToken();
    expect(getAccessToken()).toBeNull();
  });

  it('getAccessToken returns null when no token set', () => {
    expect(getAccessToken()).toBeNull();
  });
});
```

**Step 2: Implement auth (in-memory token)**

`apps/pwa/src/lib/auth.ts`:
```typescript
/**
 * In-memory access token storage. NEVER persisted to localStorage/sessionStorage.
 * Refresh happens via BFF /auth/refresh (HttpOnly cookie).
 */

let accessToken: string | null = null;
let expiresAt: number = 0;

export function setAccessToken(token: string, expiresInSec: number): void {
  accessToken = token;
  expiresAt = Date.now() + expiresInSec * 1000;
}

export function getAccessToken(): string | null {
  if (!accessToken) return null;
  if (Date.now() >= expiresAt) return null;
  return accessToken;
}

export function clearAccessToken(): void {
  accessToken = null;
  expiresAt = 0;
}

export async function refreshAccessToken(): Promise<string | null> {
  try {
    const resp = await fetch('/auth/refresh', { method: 'POST', credentials: 'include' });
    if (!resp.ok) return null;
    const data = await resp.json();
    if (data.access_token) {
      setAccessToken(data.access_token, data.expires_in ?? 300);
      return data.access_token;
    }
    return null;
  } catch {
    return null;
  }
}

export function initFromCallbackFragment(): boolean {
  /** Parse `#access_token=...&expires_in=...` from URL fragment (set by BFF callback). */
  const hash = window.location.hash.slice(1);
  if (!hash) return false;

  const params = new URLSearchParams(hash);
  const token = params.get('access_token');
  const expiresIn = params.get('expires_in');

  if (token && expiresIn) {
    setAccessToken(token, Number(expiresIn));
    window.history.replaceState(null, '', window.location.pathname);  // clear fragment
    return true;
  }
  return false;
}

export function loginRedirect(): void {
  /** Redirect to BFF /auth/login which redirects to Keycloak PKCE. */
  window.location.href = '/auth/login';
}

export async function logout(): Promise<void> {
  await fetch('/auth/logout', { method: 'POST', credentials: 'include' });
  clearAccessToken();
  window.location.href = '/login';
}
```

**Step 3: Run tests**

```bash
cd apps/pwa
pnpm test
```
Expected: 3 passed.

**Step 4: Commit**

```bash
git add apps/pwa/src/lib/auth.ts apps/pwa/tests/auth.test.ts
git commit -m "feat(pwa): in-memory access token + BFF refresh flow"
```

---

### Task 9: API client (TanStack Query + auth-aware fetch)

**Objective:** Typed fetch wrapper that injects Bearer token, auto-refreshes on 401, integrates with TanStack Query.

**Files:**
- Create: `apps/pwa/src/lib/api.ts`
- Create: `apps/pwa/tests/api.test.ts`

**Step 1: Write failing test**

`apps/pwa/tests/api.test.ts`:
```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { apiFetch } from '../src/lib/api';
import { setAccessToken, clearAccessToken } from '../src/lib/auth';

// Mock global fetch
const mockFetch = vi.fn();
globalThis.fetch = mockFetch as any;

describe('apiFetch', () => {
  beforeEach(() => {
    clearAccessToken();
    mockFetch.mockReset();
  });

  it('injects Bearer token when available', async () => {
    setAccessToken('test-token', 300);
    mockFetch.mockResolvedValue(new Response('{"ok":true}', { status: 200 }));
    await apiFetch('/api/v1/events');
    expect(mockFetch).toHaveBeenCalledWith(
      '/api/v1/events',
      expect.objectContaining({
        headers: expect.objectContaining({
          Authorization: 'Bearer test-token',
        }),
      })
    );
  });

  it('throws 401 when no token and refresh fails', async () => {
    mockFetch.mockResolvedValue(new Response('', { status: 401 }));
    await expect(apiFetch('/api/v1/events')).rejects.toThrow();
  });
});
```

**Step 2: Implement api**

`apps/pwa/src/lib/api.ts`:
```typescript
import { getAccessToken, refreshAccessToken } from './auth';

export class ApiError extends Error {
  constructor(public status: number, message: string) {
    super(message);
    this.name = 'ApiError';
  }
}

export async function apiFetch(input: string, init: RequestInit = {}): Promise<Response> {
  let token = getAccessToken();
  const headers = new Headers(init.headers);
  if (token) {
    headers.set('Authorization', `Bearer ${token}`);
  }
  headers.set('Content-Type', 'application/json');

  const resp = await fetch(input, { ...init, headers, credentials: 'include' });

  // 401 → try refresh once
  if (resp.status === 401) {
    const newToken = await refreshAccessToken();
    if (newToken) {
      headers.set('Authorization', `Bearer ${newToken}`);
      return fetch(input, { ...init, headers, credentials: 'include' });
    }
    throw new ApiError(401, 'Session expired — please log in again');
  }

  if (!resp.ok) {
    throw new ApiError(resp.status, `API error ${resp.status}`);
  }

  return resp;
}

export async function apiJson<T>(input: string, init?: RequestInit): Promise<T> {
  const resp = await apiFetch(input, init);
  return resp.json() as Promise<T>;
}
```

**Step 3: Run tests**

```bash
pnpm test
```
Expected: 2 passed.

**Step 4: Commit**

```bash
git add apps/pwa/src/lib/api.ts apps/pwa/tests/api.test.ts
git commit -m "feat(pwa): auth-aware fetch wrapper with auto-refresh"
```

---

### Task 10: TanStack Query + Router setup + routes

**Objective:** Wire TanStack Query provider, TanStack Router with typed routes, app shell layout.

**Files:**
- Modify: `apps/pwa/src/main.tsx` (providers)
- Create: `apps/pwa/src/router.tsx`
- Create: `apps/pwa/src/routes/__root.tsx` (layout)
- Create: `apps/pwa/src/routes/login.tsx`
- Create: `apps/pwa/src/routes/tickets.tsx`
- Create: `apps/pwa/src/routes/index.tsx` (redirect)

**Step 1: Router + Query provider**

`apps/pwa/src/main.tsx`:
```typescript
import React from 'react';
import ReactDOM from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { RouterProvider, createRouter } from '@tanstack/react-router';
import { routeTree } from './routeTree.gen';
import './styles.css';

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 60_000,  // 1 min stale-while-revalidate
      retry: 1,
      refetchOnWindowFocus: false,
    },
  },
});

const router = createRouter({
  routeTree,
  context: { queryClient },
  defaultPreload: 'intent',
});

declare module '@tanstack/react-router' {
  interface Register {
    router: typeof router;
  }
}

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
    </QueryClientProvider>
  </React.StrictMode>
);
```

**Step 2: Root route (layout with bottom nav)**

`apps/pwa/src/routes/__root.tsx`:
```typescript
import { Outlet, Link } from '@tanstack/react-router';
import { List, Clock } from 'lucide-react';

export const RootRoute = () => (
  <div className="flex h-screen flex-col bg-gray-50">
    <main className="flex-1 overflow-y-auto overscroll-contain">
      <Outlet />
    </main>
    <nav
      className="flex justify-around border-t border-gray-200 bg-white"
      style={{ paddingBottom: 'max(0.5rem, env(safe-area-inset-bottom))' }}
    >
      <Link to="/tickets" className="flex flex-col items-center py-2 text-blue-600">
        <List size={24} />
        <span className="text-xs">Tickets</span>
      </Link>
      <Link to="/attendance" className="flex flex-col items-center py-2 text-gray-500">
        <Clock size={24} />
        <span className="text-xs">Attendance</span>
      </Link>
    </nav>
  </div>
);
```

**Step 3: Index redirect + login + tickets routes**

`apps/pwa/src/routes/index.tsx`:
```typescript
import { createFileRoute, redirect } from '@tanstack/react-router';
import { getAccessToken } from '../lib/auth';

export const Route = createFileRoute('/')({
  beforeLoad: () => {
    if (!getAccessToken()) throw redirect({ to: '/login' });
    throw redirect({ to: '/tickets' });
  },
});
```

`apps/pwa/src/routes/login.tsx`:
```typescript
import { createFileRoute } from '@tanstack/react-router';
import { loginRedirect, initFromCallbackFragment } from '../lib/auth';
import { Button } from '@city-os/ui';

export const Route = createFileRoute('/login')({
  component: () => {
    // Check if returning from BFF callback (URL fragment has access_token)
    if (initFromCallbackFragment()) {
      window.location.href = '/tickets';
      return null;
    }

    return (
      <div className="flex h-screen flex-col items-center justify-center bg-gray-900 text-white">
        <h1 className="mb-2 text-3xl font-bold">City OS Operations</h1>
        <p className="mb-8 text-gray-400">Sign in to continue</p>
        <Button onClick={() => loginRedirect()} size="lg">
          Sign in with City Guard
        </Button>
      </div>
    );
  },
});
```

`apps/pwa/src/routes/tickets.tsx`:
```typescript
import { createFileRoute } from '@tanstack/react-router';
import { useQuery } from '@tanstack/react-query';
import { TicketList } from '@city-os/schemas';
import { apiJson } from '../lib/api';

export const Route = createFileRoute('/tickets')({
  component: TicketsPage,
});

function TicketsPage() {
  const { data, isLoading } = useQuery({
    queryKey: ['tickets'],
    queryFn: async () => TicketList.parse(await apiJson('/api/v1/events?assigned_to=me')),
  });

  if (isLoading) return <SkeletonList />;
  if (!data?.length) return <EmptyState />;

  return (
    <div className="p-4">
      <h1 className="mb-4 text-xl font-bold">My Tickets</h1>
      <div className="space-y-2">
        {data.map(t => (
          <div key={t.id} className="rounded-lg border border-gray-200 bg-white p-3">
            <div className="flex justify-between">
              <span className="font-medium">{t.title}</span>
              <span className="text-xs text-gray-500">{t.status}</span>
            </div>
            <span className="text-xs text-gray-500">{t.ticket_uid}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function SkeletonList() {
  return (
    <div className="space-y-2 p-4">
      {[1, 2, 3].map(i => (
        <div key={i} className="h-16 animate-pulse rounded-lg bg-gray-200" />
      ))}
    </div>
  );
}

function EmptyState() {
  return (
    <div className="flex h-full items-center justify-center text-gray-500">
      <p>No tickets assigned</p>
    </div>
  );
}
```

**Step 4: Verify build**

```bash
pnpm --filter @city-os/pwa build
```
Expected: TypeScript compiles, build succeeds.

**Step 5: Commit**

```bash
git add apps/pwa/src
git commit -m "feat(pwa): TanStack Query + Router setup, root layout, login + tickets routes"
```

---

## Phase 3 — Attendance Backend (City Help)

### Task 11: Add ticket_attendance_logs table + migration (City Help)

**Objective:** Add the new `ticket_attendance_logs` table in City Help for per-ticket GPS logs.

**Files:**
- Create: `/home/dev-testing/city-os/city-help-2.0/app/models/ticket_attendance_log.py`
- Modify: `app/models/__init__.py`
- Create: `alembic/versions/012_add_ticket_attendance_logs.py`
- Create: `tests/test_migration_012.py`

**Step 1: Write failing test**

`tests/test_migration_012.py`:
```python
"""Tests for Alembic migration 012: ticket_attendance_logs table."""
import importlib.util, os

REPO_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
MIGRATION_PATH = os.path.join(REPO_ROOT, "alembic", "versions", "012_add_ticket_attendance_logs.py")

def test_migration_file_exists():
    assert os.path.isfile(MIGRATION_PATH)

def _load():
    spec = importlib.util.spec_from_file_location("m12", MIGRATION_PATH)
    m = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(m)
    return m

def test_has_upgrade_downgrade():
    m = _load()
    assert callable(getattr(m, "upgrade", None))
    assert callable(getattr(m, "downgrade", None))

def test_revision_chain():
    m = _load()
    assert m.revision == "012"
    assert m.down_revision == "011"
```

**Step 2: Model**

`app/models/ticket_attendance_log.py`:
```python
"""Per-ticket GPS attendance log — append-only record of field staff on-site visits."""
from datetime import datetime, timezone
from sqlalchemy import Column, Integer, String, Float, Boolean, ForeignKey, TIMESTAMP, Index
from app.database import Base


class TicketAttendanceLog(Base):
    """Auto-logged when a field staff transitions a ticket to IN_PROGRESS.

    Stores GPS coordinates at the moment of transition + distance from the
    ticket's coordinates. Used for supervisor audit + 'on-site verified' badge.
    """
    __tablename__ = "ticket_attendance_logs"
    __table_args__ = (
        Index("ix_ticket_attendance_log_ticket", "ticket_id"),
        Index("ix_ticket_attendance_log_user", "user_id"),
    )

    id = Column(Integer, primary_key=True)
    ticket_id = Column(Integer, ForeignKey("tickets.id"), nullable=False)
    user_id = Column(String(100), nullable=False)
    action = Column(String(50), nullable=False)  # 'start_handling', 'complete', 'site_visit'
    lat = Column(Float, nullable=True)
    lng = Column(Float, nullable=True)
    distance_from_site_meters = Column(Float, nullable=True)
    is_manual_override = Column(Boolean, default=False)
    created_at = Column(
        TIMESTAMP(timezone=True), default=lambda: datetime.now(timezone.utc)
    )
```

**Step 3: Migration**

`alembic/versions/012_add_ticket_attendance_logs.py`:
```python
"""Migration 012: ticket_attendance_logs — per-ticket GPS attendance."""
from alembic import op
import sqlalchemy as sa

revision = "012"
down_revision = "011"
branch_labels = None
depends_on = None


def upgrade():
    op.create_table(
        "ticket_attendance_logs",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("ticket_id", sa.Integer(), sa.ForeignKey("tickets.id"), nullable=False),
        sa.Column("user_id", sa.String(100), nullable=False),
        sa.Column("action", sa.String(50), nullable=False),
        sa.Column("lat", sa.Float(), nullable=True),
        sa.Column("lng", sa.Float(), nullable=True),
        sa.Column("distance_from_site_meters", sa.Float(), nullable=True),
        sa.Column("is_manual_override", sa.Boolean(), server_default=sa.text("false")),
        sa.Column("created_at", sa.TIMESTAMP(timezone=True), server_default=sa.func.now()),
    )
    op.create_index("ix_ticket_attendance_log_ticket", "ticket_attendance_logs", ["ticket_id"])
    op.create_index("ix_ticket_attendance_log_user", "ticket_attendance_logs", ["user_id"])


def downgrade():
    op.drop_index("ix_ticket_attendance_log_ticket", table_name="ticket_attendance_logs")
    op.drop_index("ix_ticket_attendance_log_user", table_name="ticket_attendance_logs")
    op.drop_table("ticket_attendance_logs")
```

**Step 4: Export from `app/models/__init__.py`**

Add:
```python
from app.models.ticket_attendance_log import TicketAttendanceLog
```

And add `"TicketAttendanceLog"` to `__all__`.

**Step 5: Run tests**

```bash
cd /home/dev-testing/city-os/city-help-2.0
pytest tests/test_migration_012.py -v
```
Expected: 4 passed.

**Step 6: Run migration against dev DB**

```bash
POSTGRES_HOST=<db_ip> POSTGRES_PORT=5432 POSTGRES_PASSWORD=changeme alembic upgrade head
```

**Step 7: Commit**

```bash
git add app/models/ticket_attendance_log.py app/models/__init__.py alembic/versions/012_*.py tests/test_migration_012.py
git commit -m "feat: add ticket_attendance_logs table (migration 012)"
```

---

### Task 12: Attendance service (City Help) — clock-in/out + per-ticket GPS log

**Objective:** City Help service for shift clock-in/out + per-ticket GPS auto-log + late/early/absent calculation.

**Files:**
- Create: `app/services/attendance_service.py`
- Create: `tests/test_attendance_service.py`

**Step 1: Write failing test**

`tests/test_attendance_service.py`:
```python
"""Tests for AttendanceService — shift + per-ticket GPS."""
import pytest
from unittest.mock import AsyncMock
from datetime import datetime, timezone, date

from app.services.attendance_service import AttendanceService, haversine_meters
from app.models.attendance import Attendance
from app.models.ticket import Ticket, TicketStatus


def test_haversine_returns_zero_for_same_point():
    assert haversine_meters(1.5, 103.7, 1.5, 103.7) == 0.0

def test_haversine_returns_positive_for_different_points():
    d = haversine_meters(1.4920, 103.7410, 1.4925, 103.7415)
    assert 50 < d < 100  # ~55m

def test_haversine_handles_antipode():
    d = haversine_meters(0, 0, 0, 180)
    assert d > 20_000_000  # ~half earth circumference


@pytest.mark.asyncio
async def test_clock_in_validates_against_ticket_location(db_session):
    """Clock-in within 200m of ticket → attendance record + 'on-site' status."""
    svc = AttendanceService(db_session, on_site_radius_m=200)
    ticket = Ticket(
        id=1, ticket_uid="EV-1", lane="A", source="AI", title="x",
        status=TicketStatus.OPEN.value, lat=1.4920, lng=103.7410,
    )
    db_session.add(ticket)
    await db_session.commit()

    result = await svc.clock_in(
        user_id="user1", lat=1.4925, lng=103.7415, ticket_id=1,
    )
    assert result.status == "present"
    assert result.clock_in_lat == 1.4925
    assert result.distance_from_site_meters is not None
    assert result.distance_from_site_meters < 200


@pytest.mark.asyncio
async def test_clock_in_outside_radius_marks_late_warning(db_session):
    """Clock-in >200m from ticket → record but distance flag set."""
    svc = AttendanceService(db_session, on_site_radius_m=200)
    ticket = Ticket(
        id=2, ticket_uid="EV-2", lane="A", source="AI", title="x",
        status=TicketStatus.OPEN.value, lat=1.4920, lng=103.7410,
    )
    db_session.add(ticket)
    await db_session.commit()

    result = await svc.clock_in(
        user_id="user1", lat=1.50, lng=103.75, ticket_id=2,  # ~10km away
    )
    assert result.distance_from_site_meters > 200


@pytest.mark.asyncio
async def test_clock_in_no_coordinates_ticket_uses_manual_override(db_session):
    """Ticket with no lat/lng → manual override flag set, supervisor sees it."""
    svc = AttendanceService(db_session, on_site_radius_m=200)
    ticket = Ticket(
        id=3, ticket_uid="EV-3", lane="A", source="MAJ", title="x",
        status=TicketStatus.OPEN.value, lat=None, lng=None,
    )
    db_session.add(ticket)
    await db_session.commit()

    result = await svc.clock_in(
        user_id="user1", lat=1.5, lng=103.7, ticket_id=3,
    )
    assert result.is_manual_override is True


@pytest.mark.asyncio
async def test_log_ticket_gps_records_action(db_session):
    """log_ticket_gps creates a ticket_attendance_log row."""
    svc = AttendanceService(db_session, on_site_radius_m=200)
    ticket = Ticket(
        id=4, ticket_uid="EV-4", lane="A", source="AI", title="x",
        status=TicketStatus.IN_PROGRESS.value, lat=1.4920, lng=103.7410,
    )
    db_session.add(ticket)
    await db_session.commit()

    log = await svc.log_ticket_gps(
        ticket_id=4, user_id="user1", action="start_handling",
        lat=1.4925, lng=103.7415,
    )
    assert log.action == "start_handling"
    assert log.distance_from_site_meters < 200
    assert log.is_manual_override is False


@pytest.mark.asyncio
async def test_clock_out_records_end_of_shift(db_session):
    svc = AttendanceService(db_session, on_site_radius_m=200)
    # Pre-create shift record
    att = Attendance(
        user_id="user1", date=date.today(), clock_in=datetime.now(timezone.utc),
        clock_in_lat=1.5, clock_in_lng=103.7, status="present",
    )
    db_session.add(att)
    await db_session.commit()

    result = await svc.clock_out(user_id="user1", lat=1.5, lng=103.7)
    assert result.clock_out is not None
    assert result.clock_out_lat == 1.5
```

**Step 2: Run to verify failure**

```bash
pytest tests/test_attendance_service.py -v
```
Expected: FAIL — module not found.

**Step 3: Implement service**

`app/services/attendance_service.py`:
```python
"""AttendanceService — shift clock-in/out + per-ticket GPS logging.

Hybrid model (per interview):
- Shift clock-in/out: once per day, validates against ticket or office location,
  computes late/early/absent from per-user shift hours.
- Per-ticket GPS: auto-logged on ticket transition to IN_PROGRESS.
"""
import logging
import math
from datetime import datetime, timezone, date
from typing import Optional

from sqlalchemy import select, and_
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.attendance import Attendance
from app.models.ticket import Ticket
from app.models.ticket_attendance_log import TicketAttendanceLog

logger = logging.getLogger(__name__)


def haversine_meters(lat1: float, lng1: float, lat2: float, lng2: float) -> float:
    """Distance between two GPS points in meters."""
    R = 6_371_000  # Earth radius in meters
    phi1 = math.radians(lat1)
    phi2 = math.radians(lat2)
    dphi = math.radians(lat2 - lat1)
    dlam = math.radians(lng2 - lng1)
    a = (
        math.sin(dphi / 2) ** 2
        + math.cos(phi1) * math.cos(phi2) * math.sin(dlam / 2) ** 2
    )
    return 2 * R * math.atan2(math.sqrt(a), math.sqrt(1 - a))


class AttendanceService:
    def __init__(self, db: AsyncSession, on_site_radius_m: float = 200.0):
        self.db = db
        self.on_site_radius_m = on_site_radius_m

    async def clock_in(
        self, user_id: str, lat: float, lng: float,
        ticket_id: Optional[int] = None,
    ) -> Attendance:
        """Shift clock-in. Validates against ticket location if provided."""
        distance = None
        is_manual_override = False

        if ticket_id:
            result = await self.db.execute(
                select(Ticket).where(Ticket.id == ticket_id)
            )
            ticket = result.scalar_one_or_none()
            if ticket and ticket.lat is not None and ticket.lng is not None:
                distance = haversine_meters(lat, lng, ticket.lat, ticket.lng)
            elif ticket:
                is_manual_override = True

        record = Attendance(
            user_id=user_id,
            clock_in=datetime.now(timezone.utc),
            clock_in_lat=lat,
            clock_in_lng=lng,
            date=date.today(),
            status="present",  # late/early/absent computed in daily_summary
        )
        self.db.add(record)
        await self.db.commit()
        await self.db.refresh(record)

        # Stash distance + override on the record (via attributes, not columns —
        # they're informational, supervisor sees them in the per-ticket log)
        record.distance_from_site_meters = distance
        record.is_manual_override = is_manual_override
        return record

    async def clock_out(self, user_id: str, lat: float, lng: float) -> Optional[Attendance]:
        """Shift clock-out."""
        result = await self.db.execute(
            select(Attendance).where(
                and_(
                    Attendance.user_id == user_id,
                    Attendance.date == date.today(),
                    Attendance.clock_out.is_(None),
                )
            )
        )
        record = result.scalar_one_or_none()
        if not record:
            return None

        record.clock_out = datetime.now(timezone.utc)
        record.clock_out_lat = lat
        record.clock_out_lng = lng
        await self.db.commit()
        await self.db.refresh(record)
        return record

    async def log_ticket_gps(
        self, ticket_id: int, user_id: str, action: str,
        lat: Optional[float], lng: Optional[float],
    ) -> TicketAttendanceLog:
        """Auto-log GPS on ticket transition (e.g., start_handling)."""
        distance = None
        is_manual_override = False

        result = await self.db.execute(
            select(Ticket).where(Ticket.id == ticket_id)
        )
        ticket = result.scalar_one_or_none()
        if ticket and ticket.lat is not None and ticket.lng is not None and lat is not None and lng is not None:
            distance = haversine_meters(lat, lng, ticket.lat, ticket.lng)
        elif ticket:
            is_manual_override = True

        log = TicketAttendanceLog(
            ticket_id=ticket_id,
            user_id=user_id,
            action=action,
            lat=lat,
            lng=lng,
            distance_from_site_meters=distance,
            is_manual_override=is_manual_override,
        )
        self.db.add(log)
        await self.db.commit()
        await self.db.refresh(log)
        return log
```

**Step 4: Run tests**

```bash
pytest tests/test_attendance_service.py -v
```
Expected: 8 passed.

**Step 5: Commit**

```bash
git add app/services/attendance_service.py tests/test_attendance_service.py
git commit -m "feat: AttendanceService — shift clock-in/out + per-ticket GPS logging"
```

---

### Task 13: Attendance API endpoints (City Help)

**Objective:** REST API for clock-in/out, daily summary, ticket GPS log.

**Files:**
- Create: `app/api/attendance.py`
- Modify: `app/main.py` (register router)
- Create: `tests/test_attendance_api.py`

**Step 1: Write failing test**

`tests/test_attendance_api.py`:
```python
"""Tests for attendance API."""
import pytest
from fastapi.testclient import TestClient
from app.database import get_db
from app.main import app


@pytest.fixture
def client(db_session):
    app.dependency_overrides[get_db] = lambda: db_session
    yield TestClient(app, headers={"Authorization": "Bearer test-token"})
    app.dependency_overrides.clear()


def test_clock_in_endpoint(client):
    resp = client.post("/api/v1/attendance/clock-in", json={
        "lat": 1.4925, "lng": 103.7415,
    })
    assert resp.status_code in (200, 201)
    assert resp.json()["status"] == "present"


def test_clock_out_endpoint(client, db_session):
    # First clock in
    client.post("/api/v1/attendance/clock-in", json={"lat": 1.5, "lng": 103.7})
    # Then clock out
    resp = client.post("/api/v1/attendance/clock-out", json={"lat": 1.5, "lng": 103.7})
    assert resp.status_code == 200
    assert resp.json()["clock_out"] is not None


def test_today_endpoint(client):
    client.post("/api/v1/attendance/clock-in", json={"lat": 1.5, "lng": 103.7})
    resp = client.get("/api/v1/attendance/today")
    assert resp.status_code == 200
    assert resp.json()["status"] == "present"
```

**Step 2: Implement API**

`app/api/attendance.py`:
```python
"""Attendance API — clock-in/out, daily summary, per-ticket GPS log."""
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.services.attendance_service import AttendanceService
from city_guard import get_current_user

router = APIRouter(prefix="/api/v1/attendance", tags=["attendance"])


class ClockInRequest(BaseModel):
    lat: float
    lng: float
    ticket_id: int | None = None


class ClockOutRequest(BaseModel):
    lat: float
    lng: float


@router.post("/clock-in")
async def clock_in(
    payload: ClockInRequest,
    db: AsyncSession = Depends(get_db),
    user: dict = Depends(get_current_user),
):
    svc = AttendanceService(db)
    record = await svc.clock_in(
        user_id=user.get("preferred_username", "unknown"),
        lat=payload.lat, lng=payload.lng,
        ticket_id=payload.ticket_id,
    )
    return {
        "id": record.id,
        "status": record.status,
        "clock_in": record.clock_in.isoformat() if record.clock_in else None,
        "clock_in_lat": record.clock_in_lat,
        "clock_in_lng": record.clock_in_lng,
        "distance_from_site_meters": getattr(record, "distance_from_site_meters", None),
        "is_manual_override": getattr(record, "is_manual_override", False),
    }


@router.post("/clock-out")
async def clock_out(
    payload: ClockOutRequest,
    db: AsyncSession = Depends(get_db),
    user: dict = Depends(get_current_user),
):
    svc = AttendanceService(db)
    record = await svc.clock_out(
        user_id=user.get("preferred_username", "unknown"),
        lat=payload.lat, lng=payload.lng,
    )
    if not record:
        raise HTTPException(404, "No active shift to clock out")
    return {
        "id": record.id,
        "clock_out": record.clock_out.isoformat() if record.clock_out else None,
        "clock_out_lat": record.clock_out_lat,
        "clock_out_lng": record.clock_out_lng,
    }


@router.get("/today")
async def today(
    db: AsyncSession = Depends(get_db),
    user: dict = Depends(get_current_user),
):
    from sqlalchemy import select, and_
    from app.models.attendance import Attendance
    from datetime import date

    result = await db.execute(
        select(Attendance).where(
            and_(
                Attendance.user_id == user.get("preferred_username", "unknown"),
                Attendance.date == date.today(),
            )
        )
    )
    record = result.scalar_one_or_none()
    if not record:
        return {"status": "not_clocked_in"}
    return {
        "id": record.id,
        "status": record.status,
        "clock_in": record.clock_in.isoformat() if record.clock_in else None,
        "clock_out": record.clock_out.isoformat() if record.clock_out else None,
    }
```

**Step 3: Register in main.py**

Add to `app/main.py`:
```python
from app.api.attendance import router as attendance_router
# ...
app.include_router(attendance_router, dependencies=[Depends(get_current_user)])
```

**Step 4: Run tests**

```bash
pytest tests/test_attendance_api.py -v
```
Expected: 3 passed.

**Step 5: Commit**

```bash
git add app/api/attendance.py app/main.py tests/test_attendance_api.py
git commit -m "feat: attendance API — clock-in/out + today summary"
```

---

### Task 14: Wire ticket GPS log into ticket transition

**Objective:** When a ticket transitions to IN_PROGRESS, auto-log GPS via the attendance service.

**Files:**
- Modify: `app/services/ticket_engine.py` (in `transition_status` IN_PROGRESS branch)
- Modify: `app/api/events.py` (accept optional `lat`/`lng` on transition)
- Create: `tests/test_ticket_gps_logging.py`

**Step 1: Write failing test**

`tests/test_ticket_gps_logging.py`:
```python
"""Tests for GPS logging on ticket transition to IN_PROGRESS."""
import pytest
from app.services.ticket_engine import TicketEngine
from app.schemas.ticket import TicketStatusUpdate
from app.models.ticket import Ticket, TicketStatus


@pytest.mark.asyncio
async def test_transition_to_in_progress_logs_gps(db_session):
    """Transition to IN_PROGRESS must create a ticket_attendance_log entry."""
    ticket = Ticket(
        id=1, ticket_uid="EV-1", lane="A", source="AI", title="x",
        status=TicketStatus.OPEN.value, lat=1.4920, lng=103.7410,
    )
    db_session.add(ticket)
    await db_session.commit()

    engine = TicketEngine(db_session)
    await engine.transition_status(
        1,
        TicketStatusUpdate(status="IN_PROGRESS", actor="user1", note=""),
        lat=1.4925, lng=103.7415,  # 55m from ticket site
    )

    from app.models.ticket_attendance_log import TicketAttendanceLog
    from sqlalchemy import select
    result = await db_session.execute(select(TicketAttendanceLog))
    logs = list(result.scalars().all())
    assert len(logs) == 1
    assert logs[0].action == "start_handling"
    assert logs[0].distance_from_site_meters < 200
```

**Step 2: Implement — modify ticket_engine.transition_status**

Add optional `lat`/`lng` params to `transition_status`, log GPS when transitioning to IN_PROGRESS:

```python
async def transition_status(
    self, ticket_id: int, update: TicketStatusUpdate,
    lat: Optional[float] = None, lng: Optional[float] = None,
) -> Ticket:
    # ... existing logic ...
    if update.status == TicketStatus.IN_PROGRESS.value and lat is not None and lng is not None:
        from app.services.attendance_service import AttendanceService
        att_svc = AttendanceService(self.db)
        await att_svc.log_ticket_gps(
            ticket_id=ticket_id, user_id=update.actor,
            action="start_handling", lat=lat, lng=lng,
        )
    # ... rest of existing logic ...
```

**Step 3: Modify events.py to accept lat/lng**

In the workflow transition endpoint, accept optional lat/lng from the PWA:
```python
class WorkflowTransitionWithGPS(WorkflowTransitionRequest):
    lat: Optional[float] = None
    lng: Optional[float] = None
```

**Step 4: Run tests**

```bash
pytest tests/test_ticket_gps_logging.py -v
```
Expected: 1 passed.

**Step 5: Commit**

```bash
git add app/services/ticket_engine.py app/api/events.py tests/test_ticket_gps_logging.py
git commit -m "feat: auto-log GPS on ticket transition to IN_PROGRESS"
```

---

## Phase 4 — PWA Screens

### Task 15: PWA attendance screen (clock-in/out + today summary)

**Objective:** PWA screen for shift clock-in/out + today's status + GPS capture.

**Files:**
- Create: `apps/pwa/src/routes/attendance.tsx`
- Create: `apps/pwa/src/hooks/useGeolocation.ts`

**Step 1: Implement useGeolocation hook**

`apps/pwa/src/hooks/useGeolocation.ts`:
```typescript
import { useState, useEffect } from 'react';

interface GeoState {
  lat: number | null;
  lng: number | null;
  loading: boolean;
  error: string | null;
}

export function useGeolocation() {
  const [state, setState] = useState<GeoState>({
    lat: null, lng: null, loading: false, error: null,
  });

  const getPosition = () => {
    setState(s => ({ ...s, loading: true, error: null }));
    if (!navigator.geolocation) {
      setState(s => ({ ...s, loading: false, error: 'Geolocation not supported' }));
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (pos) => setState({
        lat: pos.coords.latitude,
        lng: pos.coords.longitude,
        loading: false,
        error: null,
      }),
      (err) => setState(s => ({ ...s, loading: false, error: err.message })),
      { enableHighAccuracy: true, timeout: 10_000, maximumAge: 30_000 }
    );
  };

  return { ...state, getPosition };
}
```

**Step 2: Implement attendance screen**

`apps/pwa/src/routes/attendance.tsx`:
```typescript
import { createFileRoute } from '@tanstack/react-router';
import { useQuery, useMutation } from '@tanstack/react-query';
import { Clock, MapPin } from 'lucide-react';
import { Button, Card, Badge } from '@city-os/ui';
import { apiJson } from '../lib/auth';
import { useGeolocation } from '../hooks/useGeolocation';

export const Route = createFileRoute('/attendance')({
  component: AttendancePage,
});

function AttendancePage() {
  const geo = useGeolocation();
  const todayQ = useQuery({
    queryKey: ['attendance', 'today'],
    queryFn: () => apiJson<{ status: string; clock_in: string | null; clock_out: string | null }>('/api/v1/attendance/today'),
  });

  const clockInM = useMutation({
    mutationFn: async () => {
      await apiJson('/api/v1/attendance/clock-in', {
        method: 'POST',
        body: JSON.stringify({ lat: geo.lat, lng: geo.lng }),
      });
    },
    onSuccess: () => todayQ.refetch(),
  });

  const clockOutM = useMutation({
    mutationFn: async () => {
      await apiJson('/api/v1/attendance/clock-out', {
        method: 'POST',
        body: JSON.stringify({ lat: geo.lat, lng: geo.lng }),
      });
    },
    onSuccess: () => todayQ.refetch(),
  });

  return (
    <div className="p-4">
      <h1 className="mb-4 text-xl font-bold">Attendance</h1>
      <Card className="mb-4 p-4">
        <div className="mb-2 flex items-center gap-2">
          <MapPin size={16} />
          <span className="text-sm">
            {geo.lat ? `${geo.lat.toFixed(4)}, ${geo.lng?.toFixed(4)}` : 'No GPS'}
          </span>
        </div>
        <Button onClick={geo.getPosition} variant="outline" disabled={geo.loading}>
          {geo.loading ? 'Getting GPS...' : 'Get GPS'}
        </Button>
      </Card>

      <Card className="p-4">
        <div className="mb-4 flex justify-between">
          <span>Today's Shift</span>
          <Badge variant={todayQ.data?.status === 'present' ? 'success' : 'default'}>
            {todayQ.data?.status || '—'}
          </Badge>
        </div>
        {todayQ.data?.clock_in && (
          <p className="text-sm text-gray-600">
            Clock in: {new Date(todayQ.data.clock_in).toLocaleTimeString()}
          </p>
        )}
        {todayQ.data?.clock_out && (
          <p className="text-sm text-gray-600">
            Clock out: {new Date(todayQ.data.clock_out).toLocaleTimeString()}
          </p>
        )}
        <div className="mt-4 flex gap-2">
          {!todayQ.data?.clock_in && (
            <Button onClick={() => clockInM.mutate()} disabled={!geo.lat || clockInM.isPending}>
              <Clock size={16} /> Clock In
            </Button>
          )}
          {todayQ.data?.clock_in && !todayQ.data?.clock_out && (
            <Button onClick={() => clockOutM.mutate()} variant="secondary" disabled={clockOutM.isPending}>
              <Clock size={16} /> Clock Out
            </Button>
          )}
        </div>
      </Card>
    </div>
  );
}
```

**Step 3: Verify build**

```bash
pnpm --filter @city-os/pwa build
```

**Step 4: Commit**

```bash
git add apps/pwa/src/routes/attendance.tsx apps/pwa/src/hooks/useGeolocation.ts
git commit -m "feat(pwa): attendance screen with clock-in/out + GPS capture"
```

---

### Task 16: PWA ticket detail + handling action with GPS

**Objective:** PWA ticket detail screen with "Start Handling" button that captures GPS + transitions ticket.

**Files:**
- Create: `apps/pwa/src/routes/ticket.$id.tsx`

**Step 1: Implement**

`apps/pwa/src/routes/ticket.$id.tsx`:
```typescript
import { createFileRoute, useParams } from '@tanstack/react-router';
import { useQuery, useMutation } from '@tanstack/react-query';
import { Clock, MapPin, ArrowLeft } from 'lucide-react';
import { Ticket } from '@city-os/schemas';
import { Button, Card, Badge } from '@city-os/ui';
import { apiJson } from '../lib/api';
import { useGeolocation } from '../hooks/useGeolocation';

export const Route = createFileRoute('/tickets/$id')({
  component: TicketDetailPage,
});

function TicketDetailPage() {
  const { id } = useParams({ from: '/tickets/$id' });
  const geo = useGeolocation();

  const ticketQ = useQuery({
    queryKey: ['ticket', id],
    queryFn: async () => {
      const data = await apiJson(`/api/v1/events/${id}`);
      return Ticket.parse(data);
    },
  });

  const startHandlingM = useMutation({
    mutationFn: async () => {
      await apiJson(`/api/v1/events/${id}/transition`, {
        method: 'PATCH',
        body: JSON.stringify({
          status: 'IN_PROGRESS', actor: 'me', note: '',
          lat: geo.lat, lng: geo.lng,
        }),
      });
    },
    onSuccess: () => ticketQ.refetch(),
  });

  if (ticketQ.isLoading) return <div className="p-4">Loading...</div>;
  if (!ticketQ.data) return <div className="p-4">Ticket not found</div>;

  const t = ticketQ.data;
  return (
    <div className="p-4">
      <Button variant="ghost" onClick={() => window.history.back()} className="mb-4">
        <ArrowLeft size={16} /> Back
      </Button>

      <Card className="mb-4 p-4">
        <div className="mb-2 flex justify-between">
          <h1 className="text-lg font-bold">{t.title}</h1>
          <Badge>{t.status}</Badge>
        </div>
        <p className="text-sm text-gray-600">{t.description}</p>
      </Card>

      {t.lat && t.lng && (
        <Card className="mb-4 p-4">
          <div className="mb-2 flex items-center gap-2">
            <MapPin size={16} />
            <span className="text-sm">{t.location_desc || `${t.lat.toFixed(4)}, ${t.lng?.toFixed(4)}`}</span>
          </div>
        </Card>
      )}

      {t.status === 'OPEN' || t.status === 'VERIFIED' || t.status === 'ASSIGNED' && (
        <Card className="p-4">
          <div className="mb-4 flex items-center gap-2">
            <Clock size={16} />
            <span className="text-sm">
              {geo.lat ? `GPS: ${geo.lat.toFixed(4)}, ${geo.lng?.toFixed(4)}` : 'Need GPS to start'}
            </span>
          </div>
          <Button
            onClick={() => { geo.getPosition(); }}
            variant="outline"
            disabled={geo.loading}
            className="mb-2"
          >
            {geo.loading ? 'Getting GPS...' : 'Get GPS'}
          </Button>
          <Button
            onClick={() => startHandlingM.mutate()}
            disabled={!geo.lat || startHandlingM.isPending}
            className="w-full"
            size="lg"
          >
            Start Handling
          </Button>
        </Card>
      )}
    </div>
  );
}
```

**Step 2: Verify build + commit**

```bash
pnpm --filter @city-os/pwa build
git add apps/pwa/src/routes/ticket.$id.tsx
git commit -m "feat(pwa): ticket detail with GPS-aware Start Handling"
```

---

### Task 17: Offline ticket queue (IndexedDB via `idb`)

**Objective:** Queue ticket creation when offline, sync on reconnect.

**Files:**
- Create: `apps/pwa/src/lib/offline-queue.ts`
- Create: `apps/pwa/src/hooks/useOnlineStatus.ts`
- Create: `apps/pwa/tests/offline-queue.test.ts`

**Step 1: Write failing test**

`apps/pwa/tests/offline-queue.test.ts`:
```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { enqueueMutation, getQueue, clearQueue } from '../src/lib/offline-queue';

// Mock IndexedDB via fake-indexeddb
import 'fake-indexeddb/auto';

describe('offline queue', () => {
  beforeEach(async () => {
    await clearQueue();
  });

  it('enqueues a mutation when offline', async () => {
    await enqueueMutation({
      url: '/api/v1/events',
      method: 'POST',
      body: { title: 'Test' },
    });
    const queue = await getQueue();
    expect(queue).toHaveLength(1);
    expect(queue[0]?.url).toBe('/api/v1/events');
  });

  it('clears queue after successful sync', async () => {
    await enqueueMutation({
      url: '/api/v1/events',
      method: 'POST',
      body: { title: 'Test' },
    });
    await clearQueue();
    const queue = await getQueue();
    expect(queue).toHaveLength(0);
  });
});
```

**Step 2: Implement offline-queue**

`apps/pwa/src/lib/offline-queue.ts`:
```typescript
import { openDB, type IDBPDatabase } from 'idb';

interface QueuedMutation {
  id?: number;
  url: string;
  method: string;
  body: unknown;
  created_at: number;
}

let dbPromise: Promise<IDBPDatabase> | null = null;

function getDB() {
  if (!dbPromise) {
    dbPromise = openDB('city-os-mobile', 1, {
      upgrade(db) {
        if (!db.objectStoreNames.contains('mutation-queue')) {
          db.createObjectStore('mutation-queue', { keyPath: 'id', autoIncrement: true });
        }
      },
    });
  }
  return dbPromise;
}

export async function enqueueMutation(m: Omit<QueuedMutation, 'id' | 'created_at'>): Promise<void> {
  const db = await getDB();
  await db.add('mutation-queue', { ...m, created_at: Date.now() });
}

export async function getQueue(): Promise<QueuedMutation[]> {
  const db = await getDB();
  return db.getAll('mutation-queue');
}

export async function clearQueue(): Promise<void> {
  const db = await getDB();
  await db.clear('mutation-queue');
}

export async function removeFromQueue(id: number): Promise<void> {
  const db = await getDB();
  await db.delete('mutation-queue', id);
}

export async function syncQueue(fetchFn: (url: string, init: RequestInit) => Promise<Response>): Promise<void> {
  const queue = await getQueue();
  for (const item of queue) {
    try {
      const resp = await fetchFn(item.url, {
        method: item.method,
        body: JSON.stringify(item.body),
        headers: { 'Content-Type': 'application/json' },
      });
      if (resp.ok && item.id) {
        await removeFromQueue(item.id);
      }
    } catch (e) {
      console.warn('Queue sync failed for item', item.id, e);
    }
  }
}
```

**Step 3: useOnlineStatus hook**

`apps/pwa/src/hooks/useOnlineStatus.ts`:
```typescript
import { useEffect, useState } from 'react';

export function useOnlineStatus() {
  const [online, setOnline] = useState(navigator.onLine);

  useEffect(() => {
    const on = () => setOnline(true);
    const off = () => setOnline(false);
    window.addEventListener('online', on);
    window.addEventListener('offline', off);
    return () => {
      window.removeEventListener('online', on);
      window.removeEventListener('offline', off);
    };
  }, []);

  return online;
}
```

**Step 4: Run tests**

```bash
cd apps/pwa
pnpm test
```
Expected: 2 passed (plus the auth + api tests from before).

**Step 5: Commit**

```bash
git add apps/pwa/src/lib/offline-queue.ts apps/pwa/src/hooks/useOnlineStatus.ts apps/pwa/tests/offline-queue.test.ts
git commit -m "feat(pwa): offline ticket queue via IndexedDB + online status hook"
```

---

### Task 18: MSW mock handlers + dev setup

**Objective:** MSW intercepts API calls in dev, returns mock data so PWA works without BFF.

**Files:**
- Create: `apps/pwa/src/mocks/handlers.ts`
- Create: `apps/pwa/src/mocks/browser.ts`
- Modify: `apps/pwa/src/main.tsx` (enable MSW in dev)

**Step 1: Implement handlers**

`apps/pwa/src/mocks/handlers.ts`:
```typescript
import { http, HttpResponse } from 'msw';

const tickets = [
  { id: 1, ticket_uid: 'EV-001', title: 'Pothole on Jalan Skudai', description: 'Large pothole', status: 'ASSIGNED', lat: 1.4920, lng: 103.7410, location_desc: 'Jalan Skudai', assigned_to: 'me', department_id: 1, created_at: new Date().toISOString(), updated_at: new Date().toISOString() },
];

export const handlers = [
  http.get('/api/v1/events', () => HttpResponse.json(tickets)),
  http.get('/api/v1/events/:id', ({ params }) => {
    const t = tickets.find(t => t.id === Number(params.id));
    return t ? HttpResponse.json(t) : new HttpResponse(null, { status: 404 });
  }),
  http.patch('/api/v1/events/:id/transition', ({ params }) => {
    const t = tickets.find(t => t.id === Number(params.id));
    if (t) t.status = 'IN_PROGRESS';
    return HttpResponse.json(t);
  }),
  http.get('/api/v1/attendance/today', () => HttpResponse.json({ status: 'not_clocked_in' })),
  http.post('/api/v1/attendance/clock-in', () => HttpResponse.json({ id: 1, status: 'present', clock_in: new Date().toISOString() })),
  http.post('/api/v1/attendance/clock-out', () => HttpResponse.json({ id: 1, clock_out: new Date().toISOString() })),
];
```

**Step 2: Browser setup**

`apps/pwa/src/mocks/browser.ts`:
```typescript
import { setupWorker } from 'msw/browser';
import { handlers } from './handlers';

export const worker = setupWorker(...handlers);
```

**Step 3: Enable in main.tsx (dev only)**

```typescript
// At top of main.tsx, before React.render:
if (import.meta.env.DEV) {
  const { worker } = await import('./mocks/browser');
  await worker.start({ onUnhandledRequest: 'bypass' });
}
```

(Make `main.tsx` async or use top-level await via Vite.)

**Step 4: Verify dev server**

```bash
pnpm --filter @city-os/pwa dev
# Open http://localhost:5173 — should see ticket list from mocks
```

**Step 5: Commit**

```bash
git add apps/pwa/src/mocks
git commit -m "feat(pwa): MSW mock handlers for dev (tickets, attendance)"
```

---

## Phase 5 — Polish + Ship

### Task 19: Native-feel CSS + View Transitions + install prompt

**Objective:** Polish PWA for native feel per spec §9.

**Files:**
- Modify: `apps/pwa/src/styles.css`
- Create: `apps/pwa/src/components/InstallPrompt.tsx`
- Create: `apps/pwa/src/hooks/useInstallPrompt.ts`

**Step 1: Native-feel CSS**

Update `apps/pwa/src/styles.css`:
```css
@import "tailwindcss";

body {
  overscroll-behavior: none;
  overflow: hidden;
  -webkit-tap-highlight-color: transparent;
  font-family: -apple-system, BlinkMacSystemFont, Roboto, sans-serif;
}

* { touch-action: manipulation; }

.app-bottom-nav { padding-bottom: max(0.5rem, env(safe-area-inset-bottom)); }
.app-header { padding-top: env(safe-area-inset-top); }

@media (hover: hover) {
  .btn:hover { opacity: 0.9; }
}

@media (prefers-reduced-motion: reduce) {
  *, *::before, *::after {
    animation-duration: 0.01ms !important;
    transition-duration: 0.01ms !important;
  }
}

::view-transition-old(root), ::view-transition-new(root) {
  animation: none; mix-blend-mode: normal;
}
```

**Step 2: Install prompt hook (Android) + iOS sheet**

`apps/pwa/src/hooks/useInstallPrompt.ts`:
```typescript
import { useState, useEffect } from 'react';

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

export function useInstallPrompt() {
  const [deferred, setDeferred] = useState<BeforeInstallPromptEvent | null>(null);
  const [isIOS, setIsIOS] = useState(false);
  const [isStandalone, setIsStandalone] = useState(false);

  useEffect(() => {
    setIsIOS(/iP(ad|hone|od)/.test(navigator.userAgent));
    setIsStandalone(
      window.matchMedia('(display-mode: standalone)').matches ||
      (navigator as any).standalone === true
    );

    const handler = (e: Event) => {
      e.preventDefault();
      setDeferred(e as BeforeInstallPromptEvent);
    };
    window.addEventListener('beforeinstallprompt', handler);
    return () => window.removeEventListener('beforeinstallprompt', handler);
  }, []);

  return { deferred, isIOS, isStandalone };
}
```

**Step 3: Commit**

```bash
git add apps/pwa/src/styles.css apps/pwa/src/hooks/useInstallPrompt.ts
git commit -m "feat(pwa): native-feel CSS + install prompt hook"
```

---

### Task 20: BFF Dockerfile + docker-compose for deploy

**Objective:** Package BFF for deployment alongside City Help.

**Files:**
- Create: `apps/bff/Dockerfile`
- Create: `apps/bff/docker-compose.yml` (or add to City OS deploy stack)

**Step 1: Dockerfile**

`apps/bff/Dockerfile`:
```dockerfile
FROM python:3.11-slim
WORKDIR /app

# Install city-guard from local clone (avoid git credential issues in build)
COPY city-guard /tmp/city-guard
RUN pip install --no-cache-dir /tmp/city-guard && rm -rf /tmp/city-guard

# Copy BFF source
COPY . /app
RUN pip install --no-cache-dir .

EXPOSE 8002
CMD ["uvicorn", "src.main:app", "--host", "0.0.0.0", "--port", "8002"]
```

**Step 2: Commit**

```bash
git add apps/bff/Dockerfile
git commit -m "feat(bff): Dockerfile for deployment"
```

---

### Task 21: E2E Playwright tests (PWA)

**Objective:** End-to-end tests for the critical PWA flows.

**Files:**
- Create: `apps/pwa/playwright.config.ts`
- Create: `apps/pwa/e2e/tickets.spec.ts`
- Create: `apps/pwa/e2e/attendance.spec.ts`

**Step 1: Install Playwright**

```bash
cd apps/pwa
pnpm add -D @playwright/test
npx playwright install
```

**Step 2: Config**

`apps/pwa/playwright.config.ts`:
```typescript
import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './e2e',
  use: {
    baseURL: 'http://localhost:5173',
    viewport: { width: 375, height: 667 },  // iPhone SE
  },
  projects: [
    { name: 'mobile-chrome', use: { ...devices['Pixel 5'] } },
    { name: 'mobile-safari', use: { ...devices['iPhone 13'] } },
  ],
  webServer: {
    command: 'pnpm dev',
    url: 'http://localhost:5173',
    reuseExistingServer: !process.env.CI,
  },
});
```

**Step 3: Tests**

`apps/pwa/e2e/tickets.spec.ts`:
```typescript
import { test, expect } from '@playwright/test';

test('ticket list loads with mock data', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('text=My Tickets')).toBeVisible();
  await expect(page.locator('text=Pothole on Jalan Skudai')).toBeVisible();
});

test('ticket detail opens and shows Start Handling', async ({ page }) => {
  await page.goto('/');
  await page.click('text=Pothole on Jalan Skudai');
  await expect(page.locator('text=Start Handling')).toBeVisible();
});
```

`apps/pwa/e2e/attendance.spec.ts`:
```typescript
import { test, expect } from '@playwright/test';

test('attendance screen shows clock-in button', async ({ page }) => {
  await page.goto('/attendance');
  await expect(page.locator('text=Clock In')).toBeVisible();
});
```

**Step 4: Run E2E**

```bash
pnpm --filter @city-os/pwa exec playwright test
```

**Step 5: Commit**

```bash
git add apps/pwa/playwright.config.ts apps/pwa/e2e
git commit -m "test(pwa): Playwright E2E for tickets + attendance"
```

---

### Task 22: README + CI workflow + push PR

**Objective:** Documentation + CI gates + push branch.

**Files:**
- Modify: `README.md` (root)
- Create: `.github/workflows/ci.yml`

**Step 1: CI workflow**

`.github/workflows/ci.yml`:
```yaml
name: CI
on: [push, pull_request]

jobs:
  pwa:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: pnpm/action-setup@v4
        with: { version: 9 }
      - uses: actions/setup-node@v4
        with: { node-version: 22, cache: pnpm }
      - run: pnpm install --frozen-lockfile
      - run: pnpm typecheck
      - run: pnpm --filter @city-os/pwa build
      - run: pnpm --filter @city-os/pwa test

  bff:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-python@v5
        with: { python-version: '3.11' }
      - run: pip install -e "apps/bff[dev]"
      - run: cd apps/bff && pytest
```

**Step 2: Push PR**

```bash
cd /home/dev-testing/city-os/city-os-mobile
git add -A
git commit -m "chore: CI workflow + README"
git push -u origin main
gh pr create --title "Mobile PWA + GPS Attendance v1" --body "..."
```

**Step 3: Code review (dispatch subagent)**

Per workflow, dispatch a code-review subagent. Fix ALL findings before merge.

**Step 4: Merge + release**

```bash
gh pr merge --squash --delete-branch
gh release create v0.1.0 --notes "..."
```

---

## Summary

| Phase | Tasks | Est. Time |
|-------|-------|-----------|
| 0 — Setup | 1-3 (repo, schemas, ui) | 1-2h |
| 1 — PWA + BFF scaffold | 4-7 | 2-3h |
| 2 — PWA auth + shell | 8-10 | 2-3h |
| 3 — Attendance backend | 11-14 | 3-4h |
| 4 — PWA screens | 15-18 | 3-4h |
| 5 — Polish + ship | 19-22 | 2-3h |
| **Total** | **22 tasks** | **~13-19h** |

### Parallelization
- Phase 0-2 (PWA scaffold + BFF) can be parallelized: PWA uses MSW while BFF is built
- Phase 3 (attendance backend) blocks Phase 4 (PWA attendance screen) — do sequentially
- Phase 4 (PWA screens) can be parallelized across different screens

### Risks

1. **MSW compatibility with Vite 7 + React 19.** Verify on day 1. Fallback: hardcoded mock data in TanStack Query defaults.
2. **TanStack Router file-based routing codegen.** Need to run codegen before first build.
3. **iOS PWA limitations** (push, install, SW lifetime) — document & accept, not fixable.
4. **BFF deployment** — add to existing Docker Compose stack, alongside City Help.
5. **Keycloak public exposure** — assumed handled separately. Blocks real auth testing until done.
6. **Zod → Python schema sync** — for Phase 1, manually maintain Pydantic models in BFF (schema is small). Add generator later if drift becomes a problem.
