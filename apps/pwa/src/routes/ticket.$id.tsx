import { useParams, useNavigate } from '@tanstack/react-router';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, MapPin, Clock } from 'lucide-react';
import { Button, Badge } from '@city-os/ui';
import { apiJson } from '../lib/api';
import { useGeolocation } from '../hooks/useGeolocation';
import { useState } from 'react';

interface TicketDetail {
  id: number;
  ticket_uid: string;
  title: string;
  description: string | null;
  status: string;
  lat: number | null;
  lng: number | null;
  location_desc: string | null;
  assigned_to: string | null;
  created_at: string | null;
  updated_at: string | null;
}

export function TicketDetailPage() {
  const { id } = useParams({ from: '/tickets/$id' as any });
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const geo = useGeolocation();
  const [error, setError] = useState('');
  const [resolutionComments, setResolutionComments] = useState('');
  const [closureComments, setClosureComments] = useState('');
  const [resError, setResError] = useState('');
  const [closeError, setCloseError] = useState('');

  const ticketId = Number(id);

  const { data: ticket, isLoading } = useQuery({
    queryKey: ['ticket', ticketId],
    queryFn: async () => {
      const raw = await apiJson(`/api/v1/events/${ticketId}`);
      return raw as unknown as TicketDetail;
    },
    enabled: !isNaN(ticketId),
  });

  const startHandlingMutation = useMutation({
    mutationFn: async () => {
      if (!geo.lat || !geo.lng) throw new Error('GPS position required');
      await apiJson(`/api/v1/events/${ticketId}/transition`, {
        method: 'PATCH',
        body: JSON.stringify({
          status: 'IN_PROGRESS',
          actor: 'mobile',
          note: 'Started handling via mobile app',
          lat: geo.lat,
          lng: geo.lng,
        }),
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['ticket', ticketId] });
      queryClient.invalidateQueries({ queryKey: ['tickets'] });
    },
    onError: (err: Error) => {
      setError(err.message);
    },
  });

  const resolveMutation = useMutation({
    mutationFn: async () => {
      if (!geo.lat || !geo.lng) throw new Error('GPS position required for resolution');
      await apiJson(`/api/v1/events/${ticketId}/transition`, {
        method: 'PATCH',
        body: JSON.stringify({
          status: 'RESOLVED',
          actor: 'mobile',
          note: resolutionComments,
          lat: geo.lat,
          lng: geo.lng,
        }),
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['ticket', ticketId] });
      queryClient.invalidateQueries({ queryKey: ['tickets'] });
      setResolutionComments('');
    },
    onError: (err: Error) => setResError(err.message),
  });

  const closeMutation = useMutation({
    mutationFn: async () => {
      await apiJson(`/api/v1/events/${ticketId}/transition`, {
        method: 'PATCH',
        body: JSON.stringify({
          status: 'CLOSED',
          actor: 'mobile',
          note: closureComments,
        }),
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['ticket', ticketId] });
      queryClient.invalidateQueries({ queryKey: ['tickets'] });
      setClosureComments('');
    },
    onError: (err: Error) => setCloseError(err.message),
  });

  const canStartHandling = ticket && ['OPEN', 'VERIFIED', 'ASSIGNED'].includes(ticket.status);
  const canResolve = ticket?.status === 'IN_PROGRESS';
  const canClose = ticket?.status === 'RESOLVED';

  if (isLoading) {
    return (
      <div className="app-content" style={{ padding: '16px' }}>
        <div className="glass-panel" style={{ padding: 16, opacity: 0.3, height: 120 }} />
      </div>
    );
  }

  if (!ticket) {
    return (
      <div className="app-content" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }}>
        <p style={{ color: 'var(--ink-dim)' }}>Ticket not found</p>
      </div>
    );
  }

  return (
    <div className="app-content" style={{ padding: '16px' }}>
      {/* Back button */}
      <button
        onClick={() => navigate({ to: '/tickets' })}
        style={{
          display: 'flex', alignItems: 'center', gap: 6, marginBottom: 12,
          background: 'none', border: 'none', color: 'var(--cyan)', cursor: 'pointer',
          fontFamily: 'var(--font-label)', fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.08em',
        }}
      >
        <ArrowLeft size={16} /> Back
      </button>

      {/* Ticket header */}
      <div className="glass-panel" style={{ padding: '16px', marginBottom: 12 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 8 }}>
          <h1 style={{ fontSize: 16, fontWeight: 600, color: 'var(--ink)', flex: 1, marginRight: 8, lineHeight: 1.3 }}>
            {ticket.title}
          </h1>
          <Badge variant={ticket.status === 'CLOSED' ? 'success' : ticket.status === 'IN_PROGRESS' ? 'warning' : 'default'}>
            {ticket.status}
          </Badge>
        </div>
        <p style={{ fontFamily: 'var(--font-label)', fontSize: 10, color: 'var(--cyan)', marginBottom: 8 }}>
          {ticket.ticket_uid}
        </p>
        {ticket.description && (
          <p style={{ fontSize: 12, color: 'var(--ink-dim)', lineHeight: 1.5 }}>{ticket.description}</p>
        )}
      </div>

      {/* Location card */}
      {ticket.lat && ticket.lng && (
        <div className="glass-panel" style={{ padding: '14px', marginBottom: 12 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
            <MapPin size={16} style={{ color: 'var(--cyan)' }} />
            <span className="hud-label">Location</span>
          </div>
          <p style={{ fontSize: 12, color: 'var(--ink)' }}>
            {ticket.location_desc || `${ticket.lat.toFixed(6)}, ${ticket.lng.toFixed(6)}`}
          </p>
          <button
            onClick={() => {
              const url = `https://maps.google.com/?q=${ticket.lat},${ticket.lng}`;
              window.open(url, '_blank');
            }}
            style={{
              marginTop: 8, padding: '6px 12px', fontSize: 10, fontFamily: 'var(--font-label)',
              textTransform: 'uppercase', letterSpacing: '0.05em', cursor: 'pointer',
              border: '1px solid var(--border)', color: 'var(--cyan)', background: 'transparent', borderRadius: 2,
            }}
          >
            Open in Maps
          </button>
        </div>
      )}

      {/* Start Handling */}
      {canStartHandling && (
        <div className="glass-panel" style={{ padding: '14px', marginBottom: 12 }}>
          <h3 className="hud-label" style={{ marginBottom: 8 }}>Start Handling</h3>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 8, fontSize: 11, color: 'var(--ink-dim)' }}>
            <Clock size={14} />
            <span>
              {geo.lat
                ? `GPS: ${geo.lat.toFixed(6)}, ${geo.lng?.toFixed(6)}`
                : 'GPS not acquired yet'}
            </span>
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            <Button
              onClick={() => geo.getPosition()}
              variant="outline"
              size="sm"
              disabled={geo.loading}
            >
              {geo.loading ? 'Getting GPS...' : 'Get GPS'}
            </Button>
            <Button
              onClick={() => startHandlingMutation.mutate()}
              disabled={!geo.lat || startHandlingMutation.isPending}
              size="sm"
            >
              {startHandlingMutation.isPending ? 'Starting...' : 'Start Handling'}
            </Button>
          </div>
          {error && <p style={{ color: 'var(--danger)', fontSize: 11, marginTop: 6 }}>{error}</p>}
        </div>
      )}

      {/* Submit Resolution */}
      {canResolve && (
        <div className="glass-panel" style={{ padding: '14px', marginBottom: 12 }}>
          <h3 className="hud-label" style={{ marginBottom: 8 }}>Submit Resolution</h3>
          <textarea
            value={resolutionComments}
            onChange={(e) => setResolutionComments(e.target.value)}
            placeholder="Describe what was done to resolve this issue..."
            style={{
              width: '100%', background: 'var(--bg-deep)', border: '1px solid var(--border)',
              borderRadius: 2, padding: '10px', color: 'var(--ink)', fontSize: 12,
              fontFamily: 'var(--font-body)', resize: 'vertical', minHeight: 60, marginBottom: 8,
            }}
          />
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 8, fontSize: 11, color: 'var(--ink-dim)' }}>
            <Clock size={14} />
            <span>
              {geo.lat
                ? `GPS: ${geo.lat.toFixed(6)}, ${geo.lng?.toFixed(6)}`
                : 'GPS not acquired yet'}
            </span>
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            <Button
              onClick={() => geo.getPosition()}
              variant="outline"
              size="sm"
              disabled={geo.loading}
            >
              {geo.loading ? 'Getting GPS...' : 'Get GPS'}
            </Button>
            <Button
              onClick={() => resolveMutation.mutate()}
              disabled={!geo.lat || !resolutionComments.trim() || resolveMutation.isPending}
              size="sm"
            >
              {resolveMutation.isPending ? 'Submitting...' : 'Submit Resolution'}
            </Button>
          </div>
          {resError && <p style={{ color: 'var(--danger)', fontSize: 11, marginTop: 6 }}>{resError}</p>}
        </div>
      )}

      {/* Close Ticket */}
      {canClose && (
        <div className="glass-panel" style={{ padding: '14px', marginBottom: 12 }}>
          <h3 className="hud-label" style={{ marginBottom: 8 }}>Close Ticket</h3>
          <textarea
            value={closureComments}
            onChange={(e) => setClosureComments(e.target.value)}
            placeholder="Final verification notes (optional)"
            style={{
              width: '100%', background: 'var(--bg-deep)', border: '1px solid var(--border)',
              borderRadius: 2, padding: '10px', color: 'var(--ink)', fontSize: 12,
              fontFamily: 'var(--font-body)', resize: 'vertical', minHeight: 40, marginBottom: 8,
            }}
          />
          <Button
            onClick={() => closeMutation.mutate()}
            disabled={closeMutation.isPending}
            size="sm"
            variant="danger"
          >
            {closeMutation.isPending ? 'Closing...' : 'Close Ticket'}
          </Button>
          {closeError && <p style={{ color: 'var(--danger)', fontSize: 11, marginTop: 6 }}>{closeError}</p>}
        </div>
      )}

      {/* Closed state */}
      {ticket.status === 'CLOSED' && (
        <div className="glass-panel" style={{ padding: '14px', textAlign: 'center' }}>
          <div style={{ fontSize: 24, marginBottom: 8 }}>✅</div>
          <p style={{ color: 'var(--safe)', fontSize: 12, fontFamily: 'var(--font-label)', textTransform: 'uppercase', letterSpacing: '0.08em' }}>
            Ticket Closed
          </p>
        </div>
      )}
    </div>
  );
}