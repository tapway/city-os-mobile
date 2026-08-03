import { useQuery } from '@tanstack/react-query';
import { useNavigate } from '@tanstack/react-router';
import { apiJson } from '../lib/api';
import { getAccessToken } from '../lib/auth';
import { useEffect } from 'react';
import { Badge } from '@city-os/ui';

interface TicketItem {
  id: number;
  ticket_uid: string;
  title: string;
  status: string;
  lat: number | null;
  lng: number | null;
  location_desc: string | null;
  assigned_to: string | null;
  created_at: string | null;
}

const STATUS_CLASSES: Record<string, 'default' | 'success' | 'warning' | 'danger'> = {
  OPEN: 'warning',
  VERIFIED: 'default',
  ASSIGNED: 'default',
  IN_PROGRESS: 'warning',
  RESOLVED: 'success',
  CLOSED: 'default',
};

export function TicketsPage() {
  const navigate = useNavigate();

  useEffect(() => {
    if (!getAccessToken()) {
      navigate({ to: '/login' });
    }
  }, [navigate]);

  const { data, isLoading, error } = useQuery({
    queryKey: ['tickets'],
    queryFn: async () => {
      const raw = await apiJson('/api/v1/events?limit=50');
      return Array.isArray(raw) ? (raw as TicketItem[]) : [];
    },
    enabled: !!getAccessToken(),
  });

  if (isLoading) {
    return (
      <div className="app-content" style={{ padding: '16px' }}>
        <div className="app-header" style={{ padding: '12px 16px', marginBottom: 16 }}>
          <div className="hud-title">My Tickets</div>
        </div>
        <div style={{ padding: '0 16px', display: 'flex', flexDirection: 'column', gap: 8 }}>
          {[1, 2, 3].map((i) => (
            <div key={i} className="glass-panel" style={{ padding: 16, height: 80, opacity: 0.3 }}>
              <div style={{ fontSize: 12, color: 'var(--ink-dim)' }}>Loading...</div>
            </div>
          ))}
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="app-content" style={{ padding: '16px', display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%' }}>
        <p style={{ color: 'var(--danger)', fontSize: 13 }}>Failed to load tickets. Pull down to retry.</p>
      </div>
    );
  }

  return (
    <div className="app-content" style={{ padding: '16px' }}>
      <div className="app-header" style={{ padding: '12px 16px', marginBottom: 16, marginTop: -16, marginLeft: -16, marginRight: -16 }}>
        <div className="hud-title">My Tickets</div>
        <div style={{ fontSize: 10, color: 'var(--ink-dim)', fontFamily: 'var(--font-label)', marginTop: 4 }}>
          {data?.length || 0} assigned
        </div>
      </div>

      {!data || data.length === 0 ? (
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: '60%', gap: 12 }}>
          <div style={{ fontSize: 36, opacity: 0.3 }}>📋</div>
          <p style={{ color: 'var(--ink-dim)', fontSize: 13 }}>No tickets assigned</p>
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {data.map((ticket) => (
            <div
              key={ticket.id}
              className="glass-panel"
              style={{ padding: '14px', cursor: 'pointer' }}
              onClick={() => navigate({ to: `/tickets/${ticket.id}` })}
            >
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 6 }}>
                <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--ink)', flex: 1, marginRight: 8 }}>
                  {ticket.title}
                </div>
                <Badge variant={STATUS_CLASSES[ticket.status] || 'default'}>
                  {ticket.status}
                </Badge>
              </div>
              <div style={{ display: 'flex', gap: 8, fontSize: 11, color: 'var(--ink-faint)' }}>
                <span style={{ fontFamily: 'var(--font-label)', color: 'var(--cyan)' }}>{ticket.ticket_uid}</span>
                {ticket.location_desc && <span>{ticket.location_desc}</span>}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}