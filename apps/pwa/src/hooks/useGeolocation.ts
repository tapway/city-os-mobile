import { useCallback, useEffect, useRef, useState } from 'react';
import { t } from '../i18n';

export interface GeoFix {
  lat: number;
  lng: number;
  /** Accuracy in metres as reported by the device. */
  accuracy: number | null;
  /** Epoch ms when the fix was obtained. */
  at: number;
}

interface GeoState {
  fix: GeoFix | null;
  loading: boolean;
  error: string | null;
}

/** A fix older than this is not trusted for a "you were here" record. */
export const FIX_MAX_AGE_MS = 5 * 60 * 1000;

/**
 * Geolocation with freshness tracking.
 *
 * Field evidence is only meaningful if the position belongs to the moment of
 * the update, so we keep the timestamp and accuracy and refuse to submit a
 * stale fix rather than silently sending an old one.
 */
export function useGeolocation(options: { auto?: boolean } = {}) {
  const { auto = false } = options;
  const [state, setState] = useState<GeoState>({ fix: null, loading: false, error: null });
  const mounted = useRef(true);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  const getPosition = useCallback(() => {
    setState((s) => ({ ...s, loading: true, error: null }));

    if (typeof navigator === 'undefined' || !navigator.geolocation) {
      setState((s) => ({ ...s, loading: false, error: t('gps.unavailable') }));
      return;
    }

    navigator.geolocation.getCurrentPosition(
      (pos) => {
        if (!mounted.current) return;
        setState({
          fix: {
            lat: pos.coords.latitude,
            lng: pos.coords.longitude,
            accuracy: typeof pos.coords.accuracy === 'number' ? pos.coords.accuracy : null,
            at: Date.now(),
          },
          loading: false,
          error: null,
        });
      },
      (err) => {
        if (!mounted.current) return;
        const message =
          err.code === err.PERMISSION_DENIED
            ? t('gps.denied')
            : err.code === err.TIMEOUT
              ? t('gps.timeout')
              : err.message || t('gps.failed');
        setState((s) => ({ ...s, loading: false, error: message }));
      },
      { enableHighAccuracy: true, timeout: 15_000, maximumAge: 0 },
    );
  }, []);

  useEffect(() => {
    if (auto) getPosition();
  }, [auto, getPosition]);

  const ageMs = state.fix ? Date.now() - state.fix.at : null;
  const isFresh = ageMs !== null && ageMs <= FIX_MAX_AGE_MS;

  return {
    fix: state.fix,
    lat: state.fix?.lat ?? null,
    lng: state.fix?.lng ?? null,
    accuracy: state.fix?.accuracy ?? null,
    ageMs,
    isFresh,
    loading: state.loading,
    error: state.error,
    getPosition,
  };
}

/** Human-readable age of a fix ("just now", "2 min ago"). */
export function formatFixAge(ageMs: number | null): string {
  if (ageMs === null) return t('gps.noFix');
  const seconds = Math.floor(ageMs / 1000);
  if (seconds < 15) return t('gps.justNow');
  if (seconds < 60) return t('gps.secondsAgo', { n: seconds });
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return t('gps.minutesAgo', { n: minutes });
  return t('gps.hoursAgo', { n: Math.floor(minutes / 60) });
}