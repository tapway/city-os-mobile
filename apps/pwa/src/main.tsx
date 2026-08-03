import React from 'react';
import ReactDOM from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { RouterProvider, createRouter, createRootRoute, createRoute } from '@tanstack/react-router';
import { initFromCallbackFragment } from './lib/auth';
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

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 60_000,
      retry: 1,
      refetchOnWindowFocus: false,
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
});

const indexRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/',
  component: TicketsPage,
});

const ticketsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/tickets',
  component: TicketsPage,
});

const ticketDetailRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/tickets/$id',
  component: TicketDetailPage,
});

const attendanceRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/attendance',
  component: AttendancePage,
});

const createTicketRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/create-ticket',
  component: CreateTicketPage,
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