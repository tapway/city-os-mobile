import { useParams, useNavigate } from '@tanstack/react-router';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, MapPin, Clock } from 'lucide-react';
import { Button, Card, Badge } from '@city-os/ui';
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

  const canStartHandling = ticket && ['OPEN', 'VERIFIED', 'ASSIGNED'].includes(ticket.status);

  if (isLoading) {
    return (
      <div className="space-y-2 p-4">
        <div className="h-6 w-24 animate-pulse rounded bg-gray-200" />
        <div className="h-32 animate-pulse rounded-lg bg-gray-200" />
      </div>
    );
  }

  if (!ticket) {
    return (
      <div className="flex h-full items-center justify-center p-4">
        <p className="text-gray-500">Ticket not found</p>
      </div>
    );
  }

  return (
    <div className="p-4">
      <button
        onClick={() => navigate({ to: '/tickets' })}
        className="mb-4 flex items-center gap-1 text-sm text-gray-600 hover:text-gray-900"
      >
        <ArrowLeft size={16} /> Back to tickets
      </button>

      <Card className="mb-4 p-4">
        <div className="mb-2 flex items-start justify-between">
          <h1 className="text-lg font-bold text-gray-900">{ticket.title}</h1>
          <Badge>{ticket.status}</Badge>
        </div>
        <p className="mb-2 text-xs text-gray-500">{ticket.ticket_uid}</p>
        {ticket.description && (
          <p className="text-sm text-gray-700">{ticket.description}</p>
        )}
      </Card>

      {ticket.lat && ticket.lng && (
        <Card className="mb-4 p-4">
          <div className="mb-2 flex items-center gap-2">
            <MapPin size={16} className="text-blue-600" />
            <span className="text-sm font-medium">Location</span>
          </div>
          <p className="text-xs text-gray-500">
            {ticket.location_desc || `${ticket.lat.toFixed(6)}, ${ticket.lng.toFixed(6)}`}
          </p>
        </Card>
      )}

      {canStartHandling && (
        <Card className="p-4">
          <h3 className="mb-3 text-sm font-medium text-gray-900">Start Handling</h3>
          <div className="mb-3 flex items-center gap-2 text-xs text-gray-500">
            <Clock size={14} />
            <span>
              {geo.lat
                ? `GPS: ${geo.lat.toFixed(6)}, ${geo.lng?.toFixed(6)}`
                : 'GPS not acquired yet'}
            </span>
          </div>
          <div className="flex gap-2">
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
          {error && <p className="mt-2 text-xs text-red-500">{error}</p>}
        </Card>
      )}
    </div>
  );
}