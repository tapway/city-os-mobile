import { useQuery } from '@tanstack/react-query';
import { Link, useNavigate } from '@tanstack/react-router';
import { useEffect, useState } from 'react';
import { Search, RefreshCw, MapPin, X } from 'lucide-react';
import { Badge } from '@city-os/ui';
import { listTickets, type TicketListItem } from '../lib/help-api';
import { getAccessToken, getSessionUser } from '../lib/auth';
import { TICKET_FILTERS as FILTERS, defaultTicketFilter } from '../lib/ticket-filters';
import { useOnlineStatus } from '../hooks/useOnlineStatus';
import { useDebouncedValue } from '../hooks/useDebouncedValue';
import { formatDateTime } from '../i18n/format';
import { useLang } from '../i18n/react';
import { statusLabel } from '../i18n/labels';

const STATUS_VARIANT: Record<string, 'default' | 'success' | 'warning' | 'danger'> = {
  OPEN: 'warning',
  VERIFIED: 'default',
  ASSIGNED: 'default',
  IN_PROGRESS: 'warning',
  RESOLVED: 'success',
  CLOSED: 'default',
};

export function TicketsPage() {
  const { t, lang } = useLang();
  const navigate = useNavigate();
  const online = useOnlineStatus();
  const [search, setSearch] = useState('');
  // null = the user has not chosen: Mine for handling staff, All for others.
  const [chosenFilter, setChosenFilter] = useState<string | null>(null);
  const debouncedSearch = useDebouncedValue(search, 300);
  const roles = getSessionUser()?.roles;
  const isStaff = !!roles?.includes('handling_staff');

  // The engineer's default depends on whether anything is waiting to be accepted.
  // This is the To accept list itself, so choosing it afterwards reuses the cache.
  const toAcceptFilter = FILTERS.find((f) => f.id === 'to_accept')!;
  const probe = useQuery({
    queryKey: ['tickets', '', toAcceptFilter.id],
    queryFn: () => listTickets({ state: toAcceptFilter.state, limit: 50 }),
    enabled: isStaff && chosenFilter === null && !!getAccessToken(),
  });
  const probing = isStaff && chosenFilter === null && probe.isPending && !!getAccessToken();

  const activeId = chosenFilter ?? defaultTicketFilter(roles, probe.data?.total);
  const activeFilter = FILTERS.find((f) => f.id === activeId) ?? FILTERS[0]!;

  useEffect(() => {
    if (!getAccessToken()) {
      navigate({ to: '/login' });
    }
  }, [navigate]);

  const { data, isLoading: listLoading, isFetching, error, refetch } = useQuery({
    queryKey: ['tickets', debouncedSearch, activeFilter.id],
    queryFn: () =>
      listTickets({
        q: debouncedSearch,
        status: activeFilter.statuses,
        assignee: activeFilter.assignee,
        state: activeFilter.state,
        limit: 50,
      }),
    enabled: !!getAccessToken() && !probing,
  });

  const isLoading = listLoading || probing;
  const tickets = data?.items ?? [];
  const total = data?.total ?? 0;
  const searching = debouncedSearch.trim().length > 0;

  const header = (
    <div
      className="app-header"
      style={{ padding: '12px 16px', marginBottom: 12, marginTop: -16, marginLeft: -16, marginRight: -16 }}
    >
      <div className="flex items-center justify-between">
        <h1 className="hud-title" style={{ margin: 0 }}>{t('tickets.title')}</h1>
        <button
          type="button"
          onClick={() => refetch()}
          disabled={isFetching}
          aria-label={t('tickets.refreshAria')}
          style={{
            display: 'flex', alignItems: 'center', gap: 6, background: 'transparent',
            border: '1px solid var(--border)', color: 'var(--cyan)', borderRadius: 2,
            padding: '6px 10px', fontSize: 10, fontFamily: 'var(--font-label)',
            textTransform: 'uppercase', letterSpacing: '0.08em', cursor: 'pointer',
          }}
        >
          <RefreshCw size={13} className={isFetching ? 'animate-spin' : undefined} />
          {isFetching ? t('tickets.loading') : t('tickets.refresh')}
        </button>
      </div>
      <div style={{ fontSize: 10, color: 'var(--ink-dim)', fontFamily: 'var(--font-label)', marginTop: 4 }}>
        {isLoading ? t('tickets.loading') : t('tickets.count', { shown: tickets.length, total })}
      </div>
    </div>
  );

  return (
    <div className="app-content" style={{ padding: '16px' }}>
      {header}

      {!online && (
        <div
          role="status"
          className="glass-panel"
          style={{ padding: '8px 12px', marginBottom: 12, borderColor: 'rgba(239,68,68,0.4)' }}
        >
          <p style={{ color: 'var(--danger)', fontSize: 11 }}>
            {t('offline.listNotice')}
          </p>
        </div>
      )}

      {/* Search */}
      <div className="glass-panel" style={{ padding: '10px 12px', marginBottom: 10 }}>
        <label htmlFor="ticket-search" className="hud-label" style={{ display: 'block', marginBottom: 6 }}>
          {t('tickets.searchLabel')}
        </label>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <Search size={15} style={{ color: 'var(--ink-dim)', flexShrink: 0 }} />
          <input
            id="ticket-search"
            type="search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder={t('tickets.searchPlaceholder')}
            autoComplete="off"
            style={{
              flex: 1, background: 'var(--bg-deep)', border: '1px solid var(--border)',
              borderRadius: 2, padding: '8px 10px', color: 'var(--ink)', fontSize: 13,
              fontFamily: 'var(--font-body)',
            }}
          />
          {search && (
            <button
              type="button"
              onClick={() => setSearch('')}
              aria-label={t('tickets.searchClear')}
              style={{ background: 'none', border: 'none', color: 'var(--ink-dim)', cursor: 'pointer' }}
            >
              <X size={16} />
            </button>
          )}
        </div>
      </div>

      {/* Status filters */}
      <div
        role="group"
        aria-label={t('tickets.filterAria')}
        style={{ display: 'flex', gap: 6, overflowX: 'auto', paddingBottom: 8, marginBottom: 4 }}
      >
        {FILTERS.map((f) => (
          <button
            key={f.id}
            type="button"
            onClick={() => setChosenFilter(f.id)}
            data-testid={`tickets-filter-${f.id}`}
            aria-pressed={f.id === activeFilter.id}
            style={{
              flexShrink: 0, padding: '6px 12px', fontSize: 10, fontFamily: 'var(--font-label)',
              textTransform: 'uppercase', letterSpacing: '0.05em', cursor: 'pointer', borderRadius: 2,
              border: `1px solid ${f.id === activeFilter.id ? 'var(--cyan)' : 'var(--border)'}`,
              background: f.id === activeFilter.id ? 'rgba(61,232,255,0.1)' : 'transparent',
              color: f.id === activeFilter.id ? 'var(--cyan)' : 'var(--ink-dim)',
            }}
          >
            {t(f.labelKey)}
          </button>
        ))}
      </div>

      {isLoading && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {[1, 2, 3].map((i) => (
            <div key={i} className="glass-panel" style={{ padding: 16, height: 80, opacity: 0.3 }}>
              <div style={{ fontSize: 12, color: 'var(--ink-dim)' }}>{t('tickets.loading')}</div>
            </div>
          ))}
        </div>
      )}

      {error && !isLoading && (
        <div className="glass-panel" style={{ padding: 16, borderColor: 'rgba(239,68,68,0.4)' }}>
          <p role="alert" style={{ color: 'var(--danger)', fontSize: 13, marginBottom: 10 }}>
            {t('tickets.loadError', { message: (error as Error).message })}
          </p>
          <button
            type="button"
            onClick={() => refetch()}
            style={{
              padding: '8px 14px', fontSize: 11, fontFamily: 'var(--font-label)',
              textTransform: 'uppercase', letterSpacing: '0.06em', cursor: 'pointer',
              border: '1px solid var(--cyan)', color: 'var(--cyan)', background: 'transparent', borderRadius: 2,
            }}
          >
            {t('tickets.retry')}
          </button>
        </div>
      )}

      {!isLoading && !error && tickets.length === 0 && (
        <div
          style={{
            display: 'flex', flexDirection: 'column', alignItems: 'center',
            justifyContent: 'center', height: '50%', gap: 12,
          }}
        >
          <div style={{ fontSize: 36, opacity: 0.3 }} aria-hidden="true">📋</div>
          <p style={{ color: 'var(--ink-dim)', fontSize: 13, textAlign: 'center' }}>
            {searching
              ? t('tickets.emptySearch', { query: debouncedSearch.trim() })
              : activeFilter.state
                ? t('tickets.emptyToAccept')
                : activeFilter.assignee
                ? t('tickets.emptyMine')
                : activeFilter.statuses
                ? t('tickets.emptyFilter', { status: t(activeFilter.labelKey).toLowerCase() })
                : t('tickets.empty')}
          </p>
        </div>
      )}

      {!isLoading && tickets.length > 0 && (
        <ul style={{ display: 'flex', flexDirection: 'column', gap: 8, listStyle: 'none', margin: 0, padding: 0 }}>
          {tickets.map((ticket: TicketListItem) => (
            <li key={ticket.id}>
              <Link
                to="/tickets/$id"
                params={{ id: ticket.ticket_uid }}
                data-testid="ticket-card"
                className="glass-panel"
                style={{ padding: '14px', display: 'block', textDecoration: 'none', color: 'inherit' }}
              >
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 6 }}>
                  <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--ink)', flex: 1, marginRight: 8 }}>
                    {ticket.title}
                  </div>
                  <Badge variant={STATUS_VARIANT[ticket.status] || 'default'}>
                    {statusLabel(ticket.status, lang)}
                  </Badge>
                </div>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, fontSize: 11, color: 'var(--ink-faint)' }}>
                  <span style={{ fontFamily: 'var(--font-label)', color: 'var(--cyan)' }}>
                    {ticket.ticket_uid}
                  </span>
                  {ticket.location_desc && (
                    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 3 }}>
                      <MapPin size={11} />
                      {ticket.location_desc}
                    </span>
                  )}
                  {ticket.created_at && <span>{formatDateTime(ticket.created_at, lang)}</span>}
                </div>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}