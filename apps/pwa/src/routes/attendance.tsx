import { useMutation, useQuery } from '@tanstack/react-query';
import { useNavigate } from '@tanstack/react-router';
import { useEffect, useState } from 'react';
import { Clock, MapPin } from 'lucide-react';
import { Button, Badge } from '@city-os/ui';
import { clockIn, clockOut, getAttendanceToday } from '../lib/help-api';
import { getAccessToken } from '../lib/auth';
import { useGeolocation, formatFixAge } from '../hooks/useGeolocation';

export function AttendancePage() {
  const navigate = useNavigate();
  const geo = useGeolocation({ auto: true });
  const [error, setError] = useState('');

  useEffect(() => {
    if (!getAccessToken()) {
      navigate({ to: '/login' });
    }
  }, [navigate]);

  const todayQuery = useQuery({
    queryKey: ['attendance', 'today'],
    queryFn: getAttendanceToday,
    enabled: !!getAccessToken(),
  });

  const clockInMutation = useMutation({
    mutationFn: async () => {
      if (!geo.isFresh || typeof geo.lat !== 'number' || typeof geo.lng !== 'number') {
        throw new Error('A fresh GPS fix is required to clock in');
      }
      return clockIn(geo.lat, geo.lng);
    },
    onSuccess: () => {
      setError('');
      todayQuery.refetch();
    },
    onError: (err: Error) => setError(err.message),
  });

  const clockOutMutation = useMutation({
    mutationFn: async () => {
      if (!geo.isFresh || typeof geo.lat !== 'number' || typeof geo.lng !== 'number') {
        throw new Error('A fresh GPS fix is required to clock out');
      }
      return clockOut(geo.lat, geo.lng);
    },
    onSuccess: () => {
      setError('');
      todayQuery.refetch();
    },
    onError: (err: Error) => setError(err.message),
  });

  const status = todayQuery.data?.status;
  const isClockedIn = status === 'present' || status === 'late';
  const isClockedOut = Boolean(todayQuery.data?.clock_out);

  return (
    <div className="app-content" style={{ padding: '16px' }}>
      <div
        className="app-header"
        style={{ padding: '12px 16px', marginBottom: 16, marginTop: -16, marginLeft: -16, marginRight: -16 }}
      >
        <h1 className="hud-title" style={{ margin: 0 }}>Attendance</h1>
      </div>

      {/* GPS */}
      <div className="glass-panel" style={{ padding: '14px', marginBottom: 12 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
          <MapPin size={16} style={{ color: geo.isFresh ? 'var(--cyan)' : 'var(--ink-dim)' }} />
          <span className="hud-label">GPS position</span>
        </div>
        <p style={{ fontSize: 12, color: 'var(--ink-dim)', marginBottom: 8 }}>
          {geo.fix
            ? `${geo.fix.lat.toFixed(6)}, ${geo.fix.lng.toFixed(6)}${geo.accuracy ? ` (±${Math.round(geo.accuracy)} m)` : ''} · ${formatFixAge(geo.ageMs)}`
            : 'No GPS position yet'}
        </p>
        <Button onClick={() => geo.getPosition()} variant="outline" size="sm" disabled={geo.loading}>
          {geo.loading ? 'Locating…' : 'Get GPS'}
        </Button>
        {geo.error && <p role="alert" style={{ color: 'var(--danger)', fontSize: 11, marginTop: 6 }}>{geo.error}</p>}
      </div>

      {/* Shift */}
      <div className="glass-panel" style={{ padding: '14px' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
          <span className="hud-label">Today&apos;s shift</span>
          <Badge variant={isClockedOut ? 'default' : isClockedIn ? 'success' : 'warning'}>
            {isClockedOut
              ? 'Completed'
              : isClockedIn
                ? 'Active'
                : status === 'not_clocked_in'
                  ? 'Not clocked in'
                  : status || '—'}
          </Badge>
        </div>

        {todayQuery.isLoading && (
          <div className="glass-panel" style={{ padding: 12, opacity: 0.3, height: 32 }} />
        )}

        {todayQuery.error && (
          <p role="alert" style={{ color: 'var(--danger)', fontSize: 11, marginBottom: 10 }}>
            Could not load today&apos;s shift: {(todayQuery.error as Error).message}
          </p>
        )}

        {todayQuery.data && !todayQuery.isLoading && (
          <div style={{ marginBottom: 12, fontSize: 12, color: 'var(--ink-dim)' }}>
            {todayQuery.data.clock_in && (
              <p style={{ marginBottom: 4 }}>Clock in: {new Date(todayQuery.data.clock_in).toLocaleTimeString()}</p>
            )}
            {todayQuery.data.clock_out && (
              <p>Clock out: {new Date(todayQuery.data.clock_out).toLocaleTimeString()}</p>
            )}
          </div>
        )}

        {error && <p role="alert" style={{ color: 'var(--danger)', fontSize: 11, marginBottom: 10 }}>{error}</p>}

        <div style={{ display: 'flex', gap: 8 }}>
          {!isClockedIn && !todayQuery.isLoading && (
            <Button
              onClick={() => clockInMutation.mutate()}
              disabled={!geo.isFresh || clockInMutation.isPending}
              size="md"
            >
              <Clock size={16} />
              {clockInMutation.isPending ? 'Clocking in…' : 'Clock in'}
            </Button>
          )}
          {isClockedIn && !isClockedOut && !todayQuery.isLoading && (
            <Button
              onClick={() => clockOutMutation.mutate()}
              variant="secondary"
              disabled={!geo.isFresh || clockOutMutation.isPending}
              size="md"
            >
              <Clock size={16} />
              {clockOutMutation.isPending ? 'Clocking out…' : 'Clock out'}
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}