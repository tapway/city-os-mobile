import { useMutation, useQuery } from '@tanstack/react-query';
import { useNavigate } from '@tanstack/react-router';
import { useEffect, useState } from 'react';
import { Clock, MapPin } from 'lucide-react';
import { Button, Badge } from '@city-os/ui';
import { clockIn, clockOut, getAttendanceToday } from '../lib/help-api';
import { getAccessToken } from '../lib/auth';
import { useGeolocation, formatFixAge } from '../hooks/useGeolocation';
import { useLang } from '../i18n/react';
import { MsgError, msgOf, type Msg } from '../i18n';

export function AttendancePage() {
  const { t, tm } = useLang();
  const navigate = useNavigate();
  const geo = useGeolocation({ auto: true });
  const [error, setError] = useState<Msg | null>(null);

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
        throw new MsgError('att.err.gpsIn');
      }
      return clockIn(geo.lat, geo.lng);
    },
    onSuccess: () => {
      setError(null);
      todayQuery.refetch();
    },
    onError: (err: Error) => setError(msgOf(err)),
  });

  const clockOutMutation = useMutation({
    mutationFn: async () => {
      if (!geo.isFresh || typeof geo.lat !== 'number' || typeof geo.lng !== 'number') {
        throw new MsgError('att.err.gpsOut');
      }
      return clockOut(geo.lat, geo.lng);
    },
    onSuccess: () => {
      setError(null);
      todayQuery.refetch();
    },
    onError: (err: Error) => setError(msgOf(err)),
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
        <h1 className="hud-title" style={{ margin: 0 }}>{t('att.title')}</h1>
      </div>

      {/* GPS */}
      <div className="glass-panel" style={{ padding: '14px', marginBottom: 12 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
          <MapPin size={16} style={{ color: geo.isFresh ? 'var(--cyan)' : 'var(--ink-dim)' }} />
          <span className="hud-label">{t('att.gpsPosition')}</span>
        </div>
        <p style={{ fontSize: 12, color: 'var(--ink-dim)', marginBottom: 8 }}>
          {geo.fix
            ? `${geo.fix.lat.toFixed(6)}, ${geo.fix.lng.toFixed(6)}${geo.accuracy ? ` (±${Math.round(geo.accuracy)} m)` : ''} · ${formatFixAge(geo.ageMs)}`
            : t('att.noGps')}
        </p>
        <Button onClick={() => geo.getPosition()} variant="outline" size="sm" disabled={geo.loading}>
          {geo.loading ? t('detail.gpsLocating') : t('detail.gpsGet')}
        </Button>
        {geo.error && <p role="alert" style={{ color: 'var(--danger)', fontSize: 11, marginTop: 6 }}>{tm(geo.error)}</p>}
      </div>

      {/* Shift */}
      <div className="glass-panel" style={{ padding: '14px' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
          <span className="hud-label">{t('att.shift')}</span>
          <Badge variant={isClockedOut ? 'default' : isClockedIn ? 'success' : 'warning'}>
            {isClockedOut
              ? t('att.completed')
              : isClockedIn
                ? t('att.active')
                : status === 'not_clocked_in'
                  ? t('att.notClockedIn')
                  : status || '—'}
          </Badge>
        </div>

        {todayQuery.isLoading && (
          <div className="glass-panel" style={{ padding: 12, opacity: 0.3, height: 32 }} />
        )}

        {todayQuery.error && (
          <p role="alert" style={{ color: 'var(--danger)', fontSize: 11, marginBottom: 10 }}>
            {t('att.loadError', { message: (todayQuery.error as Error).message })}
          </p>
        )}

        {todayQuery.data && !todayQuery.isLoading && (
          <div style={{ marginBottom: 12, fontSize: 12, color: 'var(--ink-dim)' }}>
            {todayQuery.data.clock_in && (
              <p style={{ marginBottom: 4 }}>{t('att.clockInAt', { time: new Date(todayQuery.data.clock_in).toLocaleTimeString() })}</p>
            )}
            {todayQuery.data.clock_out && (
              <p>{t('att.clockOutAt', { time: new Date(todayQuery.data.clock_out).toLocaleTimeString() })}</p>
            )}
          </div>
        )}

        {error && <p role="alert" style={{ color: 'var(--danger)', fontSize: 11, marginBottom: 10 }}>{tm(error)}</p>}

        <div style={{ display: 'flex', gap: 8 }}>
          {!isClockedIn && !todayQuery.isLoading && (
            <Button
              onClick={() => clockInMutation.mutate()}
              disabled={!geo.isFresh || clockInMutation.isPending}
              size="md"
            >
              <Clock size={16} />
              {clockInMutation.isPending ? t('att.clockingIn') : t('att.clockIn')}
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
              {clockOutMutation.isPending ? t('att.clockingOut') : t('att.clockOut')}
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}