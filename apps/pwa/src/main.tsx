import React from 'react';
import ReactDOM from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { RouterProvider, createRouter, createRootRoute, createRoute, redirect } from '@tanstack/react-router';
import { ensureSession, initFromCallbackFragment } from './lib/auth';
import { RootLayout } from './routes/__root';
import { LoginPage } from './routes/login';
import { TicketsPage } from './routes/tickets';
import { TicketDetailPage } from './routes/ticket.$id';
import { AttendancePage } from './routes/attendance';
import { CreateTicketPage } from './routes/create-ticket';
import './styles.css';

// Start MSW in dev mode only when VITE_USE_MOCKS is set
if (import.meta.env.DEV && import.meta.env.VITE_USE_MOCKS === 'true') {
  const { worker } = await import('./mocks/browser');
  await worker.start({ onUnhandledRequest: 'bypass' });
}

// Check for OAuth callback fragment on first load
initFromCallbackFragment();

async function requireAuth(search: { returnTo?: string }): Promise<void> {
  const ok = await ensureSession();
  if (!ok) {
    throw redirect({ to: '/login', search: { returnTo: search.returnTo } as never });
  }
}

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 60_000,
      retry: 1,
      refetchOnWindowFocus: false,
    },
    mutations: {
      // React Query's default ('online') *pauses* a mutation while the device
      // reports no connection: the mutation function never runs, so the button
      // sits on "Saving…" until the network returns and nothing is queued. The
      // app keeps its own durable queue for exactly that case, which means the
      // mutation has to run and be allowed to fail so it can hand over.
      networkMode: 'always',
    },
  },
});

const rootRoute = createRootRoute({
  component: RootLayout,
});

const loginRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/login',
  component: LoginPage,
  validateSearch: (search: Record<string, unknown>): { returnTo?: string } => ({
    returnTo: typeof search.returnTo === 'string' ? search.returnTo : undefined,
  }),
});

const indexRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/',
  component: TicketsPage,
  beforeLoad: () => requireAuth({}),
});

const ticketsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/tickets',
  component: TicketsPage,
  beforeLoad: () => requireAuth({}),
});

const ticketDetailRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/tickets/$id',
  component: TicketDetailPage,
  beforeLoad: () => requireAuth({}),
});

const attendanceRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/attendance',
  component: AttendancePage,
  beforeLoad: () => requireAuth({}),
});

const createTicketRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/create-ticket',
  component: CreateTicketPage,
  beforeLoad: () => requireAuth({}),
});

const routeTree = rootRoute.addChildren([
  loginRoute,
  indexRoute,
  ticketsRoute,
  ticketDetailRoute,
  attendanceRoute,
  createTicketRoute,
]);

const router = createRouter({ routeTree });

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