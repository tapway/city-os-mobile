import { useEffect, useState } from 'react';
import { useParams, useNavigate } from '@tanstack/react-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, MapPin, Clock, AlertTriangle, MessageSquare, Camera, X } from 'lucide-react';
import { Button, Badge } from '@city-os/ui';
import {
  getTicket,
  getTimeline,
  statusUpdateRequest,
  updateTicketStatus,
  runTicketAction,
  deleteImage,
  uploadImage,
  storageUrl,
  type TicketDetail,
} from '../lib/help-api';
import { getActor } from '../lib/auth';
import { ApiError, isOfflineError } from '../lib/api';
import { enqueueMutation } from '../lib/offline-queue';
import { actionButtons, buildActionUpdate, staleConflictMessage, type FieldAction } from '../lib/ticket-actions';
import { useOnlineStatus } from '../hooks/useOnlineStatus';
import { useGeolocation, formatFixAge } from '../hooks/useGeolocation';
import { useLang } from '../i18n/react';
import { statusLabel, stateLabel, eventLabel, anyStateLabel, sourceLabel } from '../i18n/labels';
import { formatDateTime } from '../i18n/format';
import { MsgError, msgOf, type Msg } from '../i18n';

const STATUS_VARIANT: Record<string, 'default' | 'success' | 'warning' | 'danger'> = {
  OPEN: 'warning',
  VERIFIED: 'default',
  ASSIGNED: 'default',
  IN_PROGRESS: 'warning',
  RESOLVED: 'success',
  CLOSED: 'default',
};

interface PendingImage {
  file: File;
  preview: string;
}

export function TicketDetailPage() {
  const { t, tm, lang } = useLang();
  const { id: ticketUid } = useParams({ from: '/tickets/$id' });
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const geo = useGeolocation({ auto: true });
  const online = useOnlineStatus();

  const [comment, setComment] = useState('');
  const [images, setImages] = useState<PendingImage[]>([]);
  const [formError, setFormError] = useState<Msg | null>(null);
  const [notice, setNotice] = useState<Msg | null>(null);

  const { data: ticket, isLoading, error } = useQuery({
    queryKey: ['ticket', ticketUid],
    queryFn: () => getTicket(ticketUid),
    enabled: !!ticketUid,
  });

  const { data: timeline } = useQuery({
    queryKey: ['timeline', ticketUid],
    queryFn: () => getTimeline(ticketUid),
    enabled: !!ticketUid,
  });

  // Release object URLs when the component goes away or the list changes.
  useEffect(() => {
    return () => images.forEach((i) => URL.revokeObjectURL(i.preview));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const updateMutation = useMutation({
    mutationFn: async (action: FieldAction) => {
      if (!ticketUid) throw new MsgError('detail.err.missingTicket');
      if (action === 'need_support') {
        // No status mapping and not queueable: it is a workflow event, online only.
        if (!online) throw new MsgError('detail.err.needOnline');
        await runTicketAction(ticketUid, action, comment.trim() || undefined);
        return 'support' as const;
      }
      if (!geo.isFresh || typeof geo.lat !== 'number' || typeof geo.lng !== 'number') {
        throw new MsgError('detail.err.needGps');
      }

      const noteKey = actionButtons([{ action }])[0]?.noteKey ?? null;

      // Upload evidence first so a failed upload never leaves a half-written update.
      const uploaded = await Promise.all(images.map((i) => uploadImage(i.file, ticketUid)));

      // buildActionUpdate stamps a fresh client_request_id: a queued replay
      // carries the same key and the server applies it once.
      const request = buildActionUpdate(action, {
        actor: getActor(),
        note: comment.trim() || (noteKey ? t(noteKey) : undefined),
        lat: geo.lat,
        lng: geo.lng,
        image_urls: uploaded.map((u) => u.url),
      });

      try {
        return await updateTicketStatus(ticketUid, request);
      } catch (err) {
        if (!isOfflineError(err)) {
          // Evidence was uploaded before the update, so a rejected update leaves
          // the objects orphaned. Only a 4xx is permanent — a 5xx may be retried,
          // and the retry re-uploads anyway.
          if (err instanceof ApiError && err.status >= 400 && err.status < 500) {
            await Promise.all(
              uploaded.map((u) => deleteImage(u.url).catch(() => undefined)),
            );
          }
          throw err;
        }
        // Keep the officer's work. Evidence is already uploaded, so the queued
        // entry references stored URLs — never a File, which cannot be
        // re-serialised after the fact.
        const { path, body } = statusUpdateRequest(ticketUid, request);
        await enqueueMutation({ url: path, method: 'PATCH', body });
        return 'queued' as const;
      }
    },
    onSuccess: (saved) => {
      setComment('');
      images.forEach((i) => URL.revokeObjectURL(i.preview));
      setImages([]);
      setFormError(null);
      setNotice(
        msgOf(
          saved === 'queued'
            ? 'detail.notice.queued'
            : saved === 'support'
              ? 'detail.notice.supportRequested'
              : 'detail.notice.saved',
        ),
      );
      queryClient.invalidateQueries({ queryKey: ['ticket', ticketUid] });
      queryClient.invalidateQueries({ queryKey: ['timeline', ticketUid] });
      queryClient.invalidateQueries({ queryKey: ['tickets'] });
      geo.getPosition();
    },
    onError: (err: Error) => {
      setNotice(null);
      const stale = staleConflictMessage(err);
      if (stale) {
        // The ticket changed under us: refetch so the buttons match the server.
        queryClient.invalidateQueries({ queryKey: ['ticket', ticketUid] });
        queryClient.invalidateQueries({ queryKey: ['timeline', ticketUid] });
        setFormError(stale);
        return;
      }
      setFormError(msgOf(err));
    },
  });

  const handleCapture = () => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'image/*';
    input.capture = 'environment';
    input.multiple = true;
    input.setAttribute('aria-label', t('detail.addPhotoAria'));
    input.onchange = (e) => {
      const files = Array.from((e.target as HTMLInputElement).files ?? []);
      const next = files.map((file) => ({ file, preview: URL.createObjectURL(file) }));
      setImages((prev) => [...prev, ...next]);
    };
    input.click();
  };

  const removeImage = (index: number) => {
    setImages((prev) => {
      URL.revokeObjectURL(prev[index]!.preview);
      return prev.filter((_, i) => i !== index);
    });
  };

  if (isLoading) {
    return (
      <div className="app-content" style={{ padding: '16px' }}>
        <div className="glass-panel" style={{ padding: 16, opacity: 0.3, height: 120 }} />
      </div>
    );
  }

  if (error || !ticket) {
    return (
      <div className="app-content" style={{ padding: '16px' }}>
        <button
          type="button"
          onClick={() => navigate({ to: '/tickets' })}
          style={{
            display: 'flex', alignItems: 'center', gap: 6, marginBottom: 12, background: 'none',
            border: 'none', color: 'var(--cyan)', cursor: 'pointer', fontFamily: 'var(--font-label)',
            fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.08em',
          }}
        >
          <ArrowLeft size={16} /> {t('detail.back')}
        </button>
        <div className="glass-panel" style={{ padding: 16, borderColor: 'rgba(239,68,68,0.4)' }}>
          <p role="alert" style={{ color: 'var(--danger)', fontSize: 13 }}>
            {error ? t('detail.loadError', { message: (error as Error).message }) : t('detail.notFound')}
          </p>
        </div>
      </div>
    );
  }

  const detail: TicketDetail = ticket;
  const buttons = actionButtons(detail.available_actions);
  const gpsLabel = geo.fix
    ? `${geo.fix.lat.toFixed(6)}, ${geo.fix.lng.toFixed(6)}${geo.accuracy ? ` (±${Math.round(geo.accuracy)} m)` : ''} · ${formatFixAge(geo.ageMs)}`
    : t('detail.gpsNone');

  return (
    <div className="app-content" style={{ padding: '16px' }}>
      <button
        type="button"
        onClick={() => navigate({ to: '/tickets' })}
        style={{
          display: 'flex', alignItems: 'center', gap: 6, marginBottom: 12, background: 'none',
          border: 'none', color: 'var(--cyan)', cursor: 'pointer', fontFamily: 'var(--font-label)',
          fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.08em',
        }}
      >
        <ArrowLeft size={16} /> {t('detail.back')}
      </button>

      {/* Header */}
      <div className="glass-panel" style={{ padding: '16px', marginBottom: 12 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 8 }}>
          <h1 style={{ fontSize: 16, fontWeight: 600, color: 'var(--ink)', flex: 1, marginRight: 8, lineHeight: 1.3 }}>
            {detail.title}
          </h1>
          <Badge variant={STATUS_VARIANT[detail.status] || 'default'}>
            {statusLabel(detail.status ?? '', lang)}
          </Badge>
        </div>
        <p style={{ fontFamily: 'var(--font-label)', fontSize: 10, color: 'var(--cyan)', marginBottom: 8 }}>
          {detail.ticket_uid}
        </p>
        {detail.description && (
          <p style={{ fontSize: 12, color: 'var(--ink-dim)', lineHeight: 1.5 }}>{detail.description}</p>
        )}
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10, marginTop: 10, fontSize: 10, color: 'var(--ink-faint)', fontFamily: 'var(--font-label)' }}>
          {detail.workflow_state && <span>{t('detail.stage', { value: stateLabel(detail.workflow_state, lang) })}</span>}
          {detail.source && <span>{t('detail.source', { value: sourceLabel(detail.source, lang) })}</span>}
          {detail.assigned_to && <span>{t('detail.assigned', { value: detail.assigned_to })}</span>}
          {detail.jira_issue_key && <span>{t('detail.jira', { value: detail.jira_issue_key })}</span>}
        </div>
      </div>

      {/* SLA */}
      {detail.sla_deadline && (
        <div
          className="glass-panel"
          style={{
            padding: '12px 14px', marginBottom: 12,
            borderColor: detail.sla_breached ? 'rgba(239,68,68,0.4)' : undefined,
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            {detail.sla_breached ? (
              <AlertTriangle size={15} style={{ color: 'var(--danger)' }} />
            ) : (
              <Clock size={15} style={{ color: 'var(--cyan)' }} />
            )}
            <span className="hud-label">{t('detail.sla')}</span>
            <span style={{ fontSize: 11, color: detail.sla_breached ? 'var(--danger)' : 'var(--ink-dim)', marginLeft: 'auto' }}>
              {t(detail.sla_breached ? 'detail.slaBreached' : 'detail.slaDue', { when: formatDateTime(detail.sla_deadline, lang) || '—' })}
            </span>
          </div>
        </div>
      )}

      {/* Location */}
      {detail.lat !== null && detail.lng !== null && (
        <div className="glass-panel" style={{ padding: '14px', marginBottom: 12 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
            <MapPin size={16} style={{ color: 'var(--cyan)' }} />
            <span className="hud-label">{t('detail.location')}</span>
          </div>
          <p style={{ fontSize: 12, color: 'var(--ink)' }}>
            {detail.location_desc || `${detail.lat.toFixed(6)}, ${detail.lng.toFixed(6)}`}
          </p>
          <a
            href={`https://maps.google.com/?q=${detail.lat},${detail.lng}`}
            target="_blank"
            rel="noreferrer"
            style={{
              display: 'inline-block', marginTop: 8, padding: '6px 12px', fontSize: 10,
              fontFamily: 'var(--font-label)', textTransform: 'uppercase', letterSpacing: '0.05em',
              border: '1px solid var(--border)', color: 'var(--cyan)', background: 'transparent',
              borderRadius: 2, textDecoration: 'none',
            }}
          >
            {t('detail.openMaps')}
          </a>
        </div>
      )}

      {/* Existing evidence */}
      {detail.image_urls && detail.image_urls.length > 0 && (
        <div className="glass-panel" style={{ padding: '14px', marginBottom: 12 }}>
          <span className="hud-label" style={{ display: 'block', marginBottom: 8 }}>{t('detail.attachedImages')}</span>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            {detail.image_urls.map((url) => (
              <a key={url} href={storageUrl(url)} target="_blank" rel="noreferrer">
                <img
                  src={storageUrl(url)}
                  alt={t('detail.evidenceAlt')}
                  style={{ width: 84, height: 84, objectFit: 'cover', borderRadius: 2, border: '1px solid var(--border)' }}
                />
              </a>
            ))}
          </div>
        </div>
      )}

      {/* Update form */}
      {buttons.length > 0 && (
        <div className="glass-panel" style={{ padding: '14px', marginBottom: 12 }}>
          <h2 className="hud-label" style={{ marginBottom: 10 }}>{t('detail.updateTitle')}</h2>

          {/* GPS */}
          <div
            style={{
              display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10, padding: '8px 10px',
              border: `1px solid ${geo.isFresh ? 'rgba(61,232,255,0.35)' : 'var(--border)'}`,
              borderRadius: 2,
            }}
          >
            <MapPin size={14} style={{ color: geo.isFresh ? 'var(--cyan)' : 'var(--ink-dim)' }} />
            <span style={{ fontSize: 11, color: geo.isFresh ? 'var(--ink)' : 'var(--ink-dim)', flex: 1 }}>
              {gpsLabel}
            </span>
            <Button data-testid="ticket-gps-get" onClick={() => geo.getPosition()} variant="outline" size="sm" disabled={geo.loading}>
              {geo.loading ? t('detail.gpsLocating') : t('detail.gpsGet')}
            </Button>
          </div>
          {geo.error && (
            <p role="alert" style={{ color: 'var(--danger)', fontSize: 11, marginBottom: 8 }}>{tm(geo.error)}</p>
          )}
          {!geo.isFresh && !geo.error && (
            <p style={{ color: 'var(--ink-faint)', fontSize: 11, marginBottom: 8 }}>
              {t('detail.gpsHint')}
            </p>
          )}

          {/* Comment */}
          <label htmlFor="update-comment" className="hud-label" style={{ display: 'block', marginBottom: 6 }}>
            {t('detail.comment')}
          </label>
          <textarea
            id="update-comment"
            value={comment}
            onChange={(e) => setComment(e.target.value)}
            placeholder={t('detail.commentPlaceholder')}
            style={{
              width: '100%', background: 'var(--bg-deep)', border: '1px solid var(--border)',
              borderRadius: 2, padding: '10px', color: 'var(--ink)', fontSize: 12,
              fontFamily: 'var(--font-body)', resize: 'vertical', minHeight: 64, marginBottom: 10,
            }}
          />

          {/* Evidence */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
            <Button data-testid="ticket-add-photo" onClick={handleCapture} variant="outline" size="sm">
              <Camera size={14} /> {t('detail.addPhoto')}
            </Button>
            <span style={{ fontSize: 10, color: 'var(--ink-faint)' }}>
              {images.length > 0 ? t('detail.photosAttached', { count: images.length }) : t('detail.photosOptional')}
            </span>
          </div>
          {images.length > 0 && (
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 10 }}>
              {images.map((img, index) => (
                <div key={img.preview} style={{ position: 'relative' }}>
                  <img
                    src={img.preview}
                    alt={t('detail.evidenceN', { n: index + 1 })}
                    style={{ width: 72, height: 72, objectFit: 'cover', borderRadius: 2, border: '1px solid var(--border)' }}
                  />
                  <button
                    type="button"
                    onClick={() => removeImage(index)}
                    aria-label={t('detail.removePhoto', { n: index + 1 })}
                    style={{
                      position: 'absolute', top: -6, right: -6, width: 20, height: 20, borderRadius: '50%',
                      border: 'none', background: 'var(--danger)', color: '#fff', cursor: 'pointer',
                      display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 0,
                    }}
                  >
                    <X size={12} />
                  </button>
                </div>
              ))}
            </div>
          )}

          {formError && (
            <p role="alert" style={{ color: 'var(--danger)', fontSize: 11, marginBottom: 8 }}>{tm(formError)}</p>
          )}
          {notice && (
            <p role="status" style={{ color: 'var(--safe, #34d399)', fontSize: 11, marginBottom: 8 }}>{tm(notice)}</p>
          )}

          {/* Actions offered by the server for this ticket */}
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
            {buttons.map((b) => {
              const blocked = b.needsOnline ? !online : !geo.isFresh;
              return (
                <Button
                  key={b.action}
                  data-testid={b.testId}
                  onClick={() => updateMutation.mutate(b.action)}
                  disabled={blocked || updateMutation.isPending}
                  variant={b.action === 'need_support' ? 'outline' : undefined}
                  size="md"
                  style={{ flex: '1 1 40%' }}
                >
                  {updateMutation.isPending && updateMutation.variables === b.action ? t('detail.saving') : t(b.labelKey)}
                </Button>
              );
            })}
          </div>
          {buttons.some((b) => b.needsOnline) && !online && (
            <p style={{ color: 'var(--ink-faint)', fontSize: 11, marginTop: 8 }}>{t('detail.needSupportOffline')}</p>
          )}
        </div>
      )}

      {/* Activity / comments */}
      <div className="glass-panel" style={{ padding: '14px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
          <MessageSquare size={15} style={{ color: 'var(--cyan)' }} />
          <span className="hud-label">{t('detail.activity')}</span>
          <span style={{ fontSize: 10, color: 'var(--ink-faint)', marginLeft: 'auto' }}>
            {t('detail.entries', { count: timeline?.length ?? 0 })}
          </span>
        </div>
        {!timeline || timeline.length === 0 ? (
          <p style={{ fontSize: 12, color: 'var(--ink-dim)' }}>{t('detail.noActivity')}</p>
        ) : (
          <ol data-testid="timeline" style={{ listStyle: 'none', margin: 0, padding: 0, display: 'flex', flexDirection: 'column', gap: 10 }}>
            {timeline.map((event) => (
              <li key={event.id} style={{ borderLeft: '2px solid var(--border)', paddingLeft: 10 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8 }}>
                  <span style={{ fontSize: 11, color: 'var(--ink)', fontWeight: 600 }}>
                    {eventLabel(event.event_type, lang)}
                  </span>
                  <span style={{ fontSize: 10, color: 'var(--ink-faint)', flexShrink: 0 }}>
                    {formatDateTime(event.created_at, lang) || '—'}
                  </span>
                </div>
                <div style={{ fontSize: 10, color: 'var(--ink-dim)', marginTop: 2 }}>
                  {event.actor || t('detail.system')}
                  {event.old_status && event.new_status ? ` · ${anyStateLabel(event.old_status, lang)} → ${anyStateLabel(event.new_status, lang)}` : ''}
                </div>
                {event.note && (
                  <p style={{ fontSize: 12, color: 'var(--ink-dim)', marginTop: 4, lineHeight: 1.5 }}>
                    {event.note}
                  </p>
                )}
              </li>
            ))}
          </ol>
        )}
      </div>
    </div>
  );
}