import { useQuery, useMutation } from '@tanstack/react-query';
import { useNavigate } from '@tanstack/react-router';
import { useEffect } from 'react';
import { Clock, MapPin } from 'lucide-react';
import { Button, Card, Badge } from '@city-os/ui';
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
    <div className="p-4">
      <h1 className="mb-4 text-xl font-bold text-gray-900">Attendance</h1>

      <Card className="mb-4 p-4">
        <div className="mb-3 flex items-center gap-2">
          <MapPin size={16} className="text-blue-600" />
          <span className="text-sm">
            {geo.lat
              ? `GPS: ${geo.lat.toFixed(6)}, ${geo.lng?.toFixed(6)}`
              : 'No GPS position'}
          </span>
        </div>
        <Button
          onClick={() => geo.getPosition()}
          variant="outline"
          size="sm"
          disabled={geo.loading}
        >
          {geo.loading ? 'Getting GPS...' : 'Get GPS Position'}
        </Button>
        {geo.error && <p className="mt-1 text-xs text-red-500">{geo.error}</p>}
      </Card>

      <Card className="p-4">
        <div className="mb-4 flex items-center justify-between">
          <span className="font-medium text-gray-900">Today's Shift</span>
          <Badge
            variant={
              isClockedOut
                ? 'default'
                : isClockedIn
                  ? 'success'
                  : 'warning'
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
          <div className="h-10 animate-pulse rounded bg-gray-200" />
        )}

        {todayQuery.data && !todayQuery.isLoading && (
          <div className="mb-4 space-y-1 text-sm text-gray-600">
            {todayQuery.data.clock_in && (
              <p>Clock in: {new Date(todayQuery.data.clock_in).toLocaleTimeString()}</p>
            )}
            {todayQuery.data.clock_out && (
              <p>Clock out: {new Date(todayQuery.data.clock_out).toLocaleTimeString()}</p>
            )}
          </div>
        )}

        <div className="flex gap-2">
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
      </Card>
    </div>
  );
}