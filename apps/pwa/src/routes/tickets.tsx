import { useQuery } from '@tanstack/react-query';
import { useNavigate } from '@tanstack/react-router';
import { apiJson } from '../lib/api';
import { getAccessToken } from '../lib/auth';
import { useEffect } from 'react';

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

  const statusColors: Record<string, string> = {
    OPEN: 'bg-blue-100 text-blue-800',
    VERIFIED: 'bg-purple-100 text-purple-800',
    ASSIGNED: 'bg-yellow-100 text-yellow-800',
    IN_PROGRESS: 'bg-orange-100 text-orange-800',
    RESOLVED: 'bg-green-100 text-green-800',
    CLOSED: 'bg-gray-100 text-gray-800',
  };

  if (isLoading) {
    return (
      <div className="space-y-2 p-4">
        <h1 className="mb-4 text-xl font-bold text-gray-900">My Tickets</h1>
        {[1, 2, 3].map((i) => (
          <div key={i} className="h-20 animate-pulse rounded-lg bg-gray-200" />
        ))}
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex h-full items-center justify-center p-4">
        <p className="text-red-500">Failed to load tickets. Pull down to retry.</p>
      </div>
    );
  }

  return (
    <div className="p-4">
      <h1 className="mb-4 text-xl font-bold text-gray-900">My Tickets</h1>
      {!data || data.length === 0 ? (
        <div className="flex h-40 items-center justify-center text-gray-500">
          <p>No tickets assigned</p>
        </div>
      ) : (
        <div className="space-y-2">
          {data.map((ticket) => (
            <div
              key={ticket.id}
              className="cursor-pointer rounded-lg border border-gray-200 bg-white p-3 transition-colors hover:bg-gray-50"
              onClick={() => navigate({ to: `/tickets/${ticket.id}` })}
            >
              <div className="mb-1 flex items-start justify-between">
                <span className="font-medium text-gray-900">{ticket.title}</span>
                <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${statusColors[ticket.status] || 'bg-gray-100 text-gray-800'}`}>
                  {ticket.status}
                </span>
              </div>
              <div className="flex items-center gap-2 text-xs text-gray-500">
                <span>{ticket.ticket_uid}</span>
                {ticket.location_desc && (
                  <>
                    <span>·</span>
                    <span>{ticket.location_desc}</span>
                  </>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}