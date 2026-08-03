import { useQuery, useMutation } from '@tanstack/react-query';
import { useNavigate } from '@tanstack/react-router';
import { useEffect } from 'react';
import { Clock, MapPin } from 'lucide-react';
import { Button, Badge } from '@city-os/ui';
import { apiJson } from '../lib/api';
import { getAccessToken } from '../lib/auth';
import { useGeolocation } from '../hooks/useGeolocation';

interface TodayAttendance {
  status: string;
  clock_in: string | null;
  clock_out: string | null;
  clock_in_lat?: number | null;
  clock_in_lng?: number | null;
}

export function AttendancePage() {
  const navigate = useNavigate();
  const geo = useGeolocation();

  useEffect(() => {
    if (!getAccessToken()) {
      navigate({ to: '/login' });
    }
  }, [navigate]);

  const todayQuery = useQuery({
    queryKey: ['attendance', 'today'],
    queryFn: async () => {
      const raw = await apiJson('/api/v1/attendance/today');
      return raw as unknown as TodayAttendance;
    },
    enabled: !!getAccessToken(),
  });

  const clockInMutation = useMutation({
    mutationFn: async () => {
      if (!geo.lat || !geo.lng) throw new Error('GPS position required');
      await apiJson('/api/v1/attendance/clock-in', {
        method: 'POST',
        body: JSON.stringify({ lat: geo.lat, lng: geo.lng }),
      });
    },
    onSuccess: () => {
      todayQuery.refetch();
    },
  });

  const clockOutMutation = useMutation({
    mutationFn: async () => {
      if (!geo.lat || !geo.lng) throw new Error('GPS position required');
      await apiJson('/api/v1/attendance/clock-out', {
        method: 'POST',
        body: JSON.stringify({ lat: geo.lat, lng: geo.lng }),
      });
    },
    onSuccess: () => {
      todayQuery.refetch();
    },
  });

  const isClockedIn = todayQuery.data?.status === 'present' || todayQuery.data?.status === 'late';
  const isClockedOut = !!todayQuery.data?.clock_out;

  return (
    <div className="app-content" style={{ padding: '16px' }}>
      <div className="app-header" style={{ padding: '12px 16px', marginBottom: 16, marginTop: -16, marginLeft: -16, marginRight: -16 }}>
        <div className="hud-title">Attendance</div>
      </div>

      {/* GPS Card */}
      <div className="glass-panel" style={{ padding: '14px', marginBottom: 12 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
          <MapPin size={16} style={{ color: 'var(--cyan)' }} />
          <span className="hud-label">GPS Position</span>
        </div>
        <p style={{ fontSize: 12, color: 'var(--ink-dim)', marginBottom: 8 }}>
          {geo.lat
            ? `GPS: ${geo.lat.toFixed(6)}, ${geo.lng?.toFixed(6)}`
            : 'No GPS position'}
        </p>
        <Button
          onClick={() => geo.getPosition()}
          variant="outline"
          size="sm"
          disabled={geo.loading}
        >
          {geo.loading ? 'Getting GPS...' : 'Get GPS Position'}
        </Button>
        {geo.error && <p style={{ color: 'var(--danger)', fontSize: 11, marginTop: 6 }}>{geo.error}</p>}
      </div>

      {/* Shift Card */}
      <div className="glass-panel" style={{ padding: '14px' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
          <span className="hud-label">Today's Shift</span>
          <Badge
            variant={
              isClockedOut
                ? 'default'
                : isClockedIn
                  ? 'success'
                  : 'warning' as any
            }
          >
            {isClockedOut
              ? 'Completed'
              : isClockedIn
                ? 'Active'
                : todayQuery.data?.status === 'not_clocked_in'
                  ? 'Not Clocked In'
                  : todayQuery.data?.status || '—'}
          </Badge>
        </div>

        {todayQuery.isLoading && (
          <div className="glass-panel" style={{ padding: 12, opacity: 0.3, height: 32 }} />
        )}

        {todayQuery.data && !todayQuery.isLoading && (
          <div style={{ marginBottom: 12, fontSize: 12, color: 'var(--ink-dim)' }}>
            {todayQuery.data.clock_in && (
              <p style={{ marginBottom: 4 }}>
                Clock in: {new Date(todayQuery.data.clock_in).toLocaleTimeString()}
              </p>
            )}
            {todayQuery.data.clock_out && (
              <p>Clock out: {new Date(todayQuery.data.clock_out).toLocaleTimeString()}</p>
            )}
          </div>
        )}

        <div style={{ display: 'flex', gap: 8 }}>
          {!isClockedIn && !todayQuery.isLoading && (
            <Button
              onClick={() => clockInMutation.mutate()}
              disabled={!geo.lat || clockInMutation.isPending}
              size="md"
            >
              <Clock size={16} />
              {clockInMutation.isPending ? 'Clocking in...' : 'Clock In'}
            </Button>
          )}
          {isClockedIn && !isClockedOut && !todayQuery.isLoading && (
            <Button
              onClick={() => clockOutMutation.mutate()}
              variant="secondary"
              disabled={clockOutMutation.isPending}
              size="md"
            >
              <Clock size={16} />
              {clockOutMutation.isPending ? 'Clocking out...' : 'Clock Out'}
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}