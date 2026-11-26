import { useEffect, useMemo, useState } from 'react';
import { Link } from '@tanstack/react-router';
import { Bell, CheckCheck } from 'lucide-react';
import {
  listNotifications, markAllRead, markRead,
  type NotificationItem, type NotificationPage,
} from '../lib/notifications-api';
import {
  currentSubscription, disableDeviceAlerts, enableDeviceAlerts, getPushConfig,
} from '../lib/push-api';
import { canEnable, pushState, PUSH_STATE_KEY, type PushEnv, type PushState } from '../lib/push-state';
import { formatDateTime } from '../i18n/format';
import { useLang } from '../i18n/react';
import { useUnreadAlerts, notifyAlertsChanged } from '../hooks/useUnreadAlerts';

const CARD = {
  background: 'var(--glass)',
  border: '1px solid var(--border)',
  borderRadius: 12,
  padding: '12px 14px',
  marginBottom: 10,
} as const;

const isIos = () =>
  /iPad|iPhone|iPod/.test(navigator.userAgent) ||
  (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);

function deviceEnv(serverEnabled: boolean, subscribed: boolean): PushEnv {
  return {
    secure: window.isSecureContext,
    standalone:
      window.matchMedia?.('(display-mode: standalone)').matches === true ||
      (navigator as unknown as { standalone?: boolean }).standalone === true,
    hasPushManager: 'PushManager' in window && 'serviceWorker' in navigator,
    permission: typeof Notification === 'undefined' ? 'denied' : Notification.permission,
    subscribed,
    serverEnabled,
    ios: isIos(),
  };
}

export function NotificationsPage() {
  const { t, lang } = useLang();
  // The header already polls; a second poller on this screen doubled the traffic.
  // Read receipts announce themselves so every mounted bell refreshes once.
  useUnreadAlerts(false);
  const [page, setPage] = useState<NotificationPage | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  // Device alerts
  const [state, setState] = useState<PushState | null>(null);
  const [busy, setBusy] = useState(false);
  const [alertError, setAlertError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    const load = () => {
      listNotifications({ limit: 50 })
        .then((p) => { if (alive) { setPage(p); setError(null); } })
        .catch(() => { if (alive) setError(t('err.server')); })
        .finally(() => { if (alive) setLoading(false); });
    };
    load();
    const onVisible = () => { if (document.visibilityState === 'visible') load(); };
    document.addEventListener('visibilitychange', onVisible);
    return () => { alive = false; document.removeEventListener('visibilitychange', onVisible); };
    // t is stable per language; re-running on language change is cheap and keeps the error text right.
  }, [t]);

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const cfg = await getPushConfig();
        if (alive) setState(pushState(deviceEnv(cfg.enabled, false)));
        const sub = await currentSubscription();
        if (alive) setState(pushState(deviceEnv(cfg.enabled, !!sub)));
      } catch {
        if (alive) setState(pushState(deviceEnv(false, false)));
      }
    })();
    return () => { alive = false; };
  }, []);

  const open = async (item: NotificationItem) => {
    if (!item.read_at) {
      try {
        await markRead(item.id);
        setPage((p) => p && {
          ...p,
          items: p.items.map((i) => (i.id === item.id ? { ...i, read_at: new Date().toISOString() } : i)),
          unread_count: Math.max(0, p.unread_count - 1),
        });
        notifyAlertsChanged();
      } catch {
        // Opening the ticket matters more than the read receipt; the bell catches up later.
      }
    }
  };

  const readAll = async () => {
    try {
      await markAllRead();
      setPage((p) => p && { items: p.items.map((i) => ({ ...i, read_at: i.read_at ?? new Date().toISOString() })), unread_count: 0 });
      notifyAlertsChanged();
    } catch {
      setError(t('err.server'));
    }
  };

  const toggleAlerts = async () => {
    setBusy(true);
    setAlertError(null);
    try {
      if (state === 'subscribed') {
        await disableDeviceAlerts();
        setState(pushState(deviceEnv(true, false)));
      } else {
        const result = await enableDeviceAlerts();
        setState(pushState(deviceEnv(result !== 'disabled', result === 'subscribed')));
      }
    } catch {
      setAlertError(t('alerts.err'));
    } finally {
      setBusy(false);
    }
  };

  const unread = page?.unread_count ?? 0;
  const stateLabel = useMemo(() => (state ? t(PUSH_STATE_KEY[state]) : ''), [state, t]);

  return (
    <div style={{ padding: 16 }} data-testid="notifications-page">
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
        <h1 style={{ fontFamily: 'var(--font-label)', fontSize: 14, letterSpacing: '0.12em', textTransform: 'uppercase', margin: 0 }}>
          {t('alerts.title')}
          {unread > 0 && (
            <span data-testid="alerts-unread" style={{ marginLeft: 8, color: 'var(--cyan)', fontSize: 12 }}>
              {t('alerts.unreadCount', { n: unread })}
            </span>
          )}
        </h1>
        {unread > 0 && (
          <button
            type="button"
            data-testid="alerts-mark-all"
            onClick={() => void readAll()}
            style={{ display: 'flex', gap: 6, alignItems: 'center', background: 'transparent', border: 0, color: 'var(--cyan)', fontFamily: 'var(--font-label)', fontSize: 12, textTransform: 'uppercase', letterSpacing: '0.08em' }}
          >
            <CheckCheck size={15} aria-hidden="true" />
            {t('alerts.markAll')}
          </button>
        )}
      </div>

      {error && <p role="alert" style={{ color: 'var(--danger)', fontSize: 13 }}>{error}</p>}
      {loading && !page && <p style={{ color: 'var(--ink-dim)', fontSize: 13 }}>{t('tickets.loading')}</p>}
      {page && page.items.length === 0 && <p style={{ color: 'var(--ink-dim)', fontSize: 13 }}>{t('alerts.empty')}</p>}

      {page?.items.map((item) => {
        const langTitle = lang === 'ms' ? (item.title_bm || item.title_en) : (item.title_en || item.title_bm);
        const langBody = lang === 'ms' ? (item.body_bm || item.body_en) : (item.body_en || item.body_bm);
        const inner = (
          <>
            <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
              {!item.read_at && <span aria-hidden="true" data-testid="notification-unread-dot" style={{ width: 8, height: 8, borderRadius: 4, background: 'var(--cyan)' }} />}
              <strong style={{ fontSize: 13, color: 'var(--ink)' }}>{langTitle || item.kind}</strong>
              <span style={{ marginLeft: 'auto', fontSize: 12, color: 'var(--ink-dim)' }}>{formatDateTime(item.created_at, lang)}</span>
            </div>
            {langBody && <p style={{ margin: '6px 0 0', fontSize: 12, color: 'var(--ink-dim)' }}>{langBody}</p>}
          </>
        );
        const testId = item.read_at ? 'notification-item' : 'notification-item-unread';
        return item.ticket_uid ? (
          <Link
            key={item.id}
            to="/tickets/$id"
            params={{ id: item.ticket_uid }}
            data-testid={testId}
            aria-label={t('alerts.openTicket', { uid: item.ticket_uid })}
            onClick={() => void open(item)}
            style={{ ...CARD, display: 'block', textDecoration: 'none' }}
          >
            {inner}
          </Link>
        ) : (
          <button
            key={item.id}
            type="button"
            data-testid={testId}
            onClick={() => void open(item)}
            style={{ ...CARD, display: 'block', width: '100%', textAlign: 'left', color: 'inherit' }}
          >
            {inner}
          </button>
        );
      })}

      <section style={{ ...CARD, marginTop: 18 }} aria-labelledby="device-alerts-title">
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <Bell size={16} aria-hidden="true" style={{ color: 'var(--cyan)' }} />
          <strong id="device-alerts-title" style={{ fontSize: 13 }}>{t('alerts.deviceTitle')}</strong>
        </div>
        <p style={{ fontSize: 12, color: 'var(--ink-dim)', margin: '6px 0 10px' }}>{t('alerts.deviceHint')}</p>
        <p data-testid="alerts-state" style={{ fontSize: 12, margin: '0 0 10px' }}>{stateLabel}</p>
        {state && (canEnable(state) || state === 'subscribed') ? (
          <button
            type="button"
            data-testid="alerts-toggle"
            disabled={busy}
            onClick={() => void toggleAlerts()}
            style={{
              padding: '10px 14px', borderRadius: 10, border: '1px solid var(--cyan)',
              background: state === 'subscribed' ? 'transparent' : 'var(--cyan)',
              color: state === 'subscribed' ? 'var(--cyan)' : 'var(--bg-deep)',
              fontFamily: 'var(--font-label)', fontSize: 12, textTransform: 'uppercase', letterSpacing: '0.08em',
            }}
          >
            {busy ? t('alerts.enabling') : state === 'subscribed' ? t('alerts.disable') : t('alerts.enable')}
          </button>
        ) : null}
        {alertError && <p role="alert" style={{ color: 'var(--danger)', fontSize: 12, marginTop: 8 }}>{alertError}</p>}
      </section>
    </div>
  );
}