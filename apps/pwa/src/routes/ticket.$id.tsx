import { useEffect, useMemo, useState } from 'react';
import { useParams, useNavigate } from '@tanstack/react-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, MapPin, Clock, AlertTriangle, MessageSquare, Camera, X } from 'lucide-react';
import { Button, Badge } from '@city-os/ui';
import {
  getTicket,
  getTimeline,
  statusUpdateRequest,
  updateTicketStatus,
  deleteImage,
  uploadImage,
  storageUrl,
  type StatusUpdate,
  type TicketDetail,
} from '../lib/help-api';
import { getActor } from '../lib/auth';
import { ApiError, isOfflineError } from '../lib/api';
import { enqueueMutation } from '../lib/offline-queue';
import { useGeolocation, formatFixAge } from '../hooks/useGeolocation';

const STATUS_VARIANT: Record<string, 'default' | 'success' | 'warning' | 'danger'> = {
  OPEN: 'warning',
  VERIFIED: 'default',
  ASSIGNED: 'default',
  IN_PROGRESS: 'warning',
  RESOLVED: 'success',
  CLOSED: 'default',
};

/** Field-officer shortcuts: label → the status they move the ticket to. */
const QUICK_ACTIONS = [
  { label: 'Start work', status: 'IN_PROGRESS', note: 'Started handling on site' },
  { label: 'Submit resolution', status: 'RESOLVED', note: 'Work completed on site' },
  { label: 'Close ticket', status: 'CLOSED', note: 'Closed after verification' },
] as const;

const ALL_STATUSES = ['OPEN', 'VERIFIED', 'ASSIGNED', 'IN_PROGRESS', 'RESOLVED', 'CLOSED'];

interface PendingImage {
  file: File;
  preview: string;
}

function formatWhen(value: string | null): string {
  if (!value) return '—';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '—';
  return date.toLocaleString(undefined, {
    day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit',
  });
}

function humaniseEvent(eventType: string): string {
  return eventType.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
}

export function TicketDetailPage() {
  const { id: ticketUid } = useParams({ from: '/tickets/$id' });
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const geo = useGeolocation({ auto: true });

  const [status, setStatus] = useState('');
  const [comment, setComment] = useState('');
  const [images, setImages] = useState<PendingImage[]>([]);
  const [formError, setFormError] = useState('');
  const [notice, setNotice] = useState('');

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

  const currentStatus = ticket?.status ?? '';
  const statusOptions = useMemo(
    () => ALL_STATUSES.filter((s) => s !== currentStatus),
    [currentStatus],
  );

  const updateMutation = useMutation({
    mutationFn: async () => {
      if (!ticketUid) throw new Error('Missing ticket reference');
      if (!status) throw new Error('Choose the new status');
      if (!geo.isFresh || typeof geo.lat !== 'number' || typeof geo.lng !== 'number') {
        throw new Error('A fresh GPS fix is required — tap “Get GPS” and try again');
      }

      // Upload evidence first so a failed upload never leaves a half-written update.
      const uploaded = await Promise.all(images.map((i) => uploadImage(i.file, ticketUid)));

      const request: StatusUpdate = {
        status,
        actor: getActor(),
        note: comment.trim() || undefined,
        lat: geo.lat,
        lng: geo.lng,
        image_urls: uploaded.map((u) => u.url),
        // One key per logical update: a queued replay, or the officer pressing
        // save again, carries the same key and the server applies it once.
        client_request_id: crypto.randomUUID(),
      };

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
        return null;
      }
    },
    onSuccess: (saved) => {
      setComment('');
      images.forEach((i) => URL.revokeObjectURL(i.preview));
      setImages([]);
      setStatus('');
      setFormError('');
      setNotice(
        saved === null
          ? 'No connection — update saved on this device and sent automatically.'
          : 'Ticket updated with your GPS position.',
      );
      queryClient.invalidateQueries({ queryKey: ['ticket', ticketUid] });
      queryClient.invalidateQueries({ queryKey: ['timeline', ticketUid] });
      queryClient.invalidateQueries({ queryKey: ['tickets'] });
      geo.getPosition();
    },
    onError: (err: Error) => {
      setNotice('');
      setFormError(err.message);
    },
  });

  const handleCapture = () => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'image/*';
    input.capture = 'environment';
    input.multiple = true;
    input.setAttribute('aria-label', 'Add photo evidence');
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
          <ArrowLeft size={16} /> Back
        </button>
        <div className="glass-panel" style={{ padding: 16, borderColor: 'rgba(239,68,68,0.4)' }}>
          <p role="alert" style={{ color: 'var(--danger)', fontSize: 13 }}>
            {error ? `Could not load ticket: ${(error as Error).message}` : 'Ticket not found.'}
          </p>
        </div>
      </div>
    );
  }

  const detail: TicketDetail = ticket;
  const gpsLabel = geo.fix
    ? `${geo.fix.lat.toFixed(6)}, ${geo.fix.lng.toFixed(6)}${geo.accuracy ? ` (±${Math.round(geo.accuracy)} m)` : ''} · ${formatFixAge(geo.ageMs)}`
    : 'No GPS fix yet';

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
        <ArrowLeft size={16} /> Back
      </button>

      {/* Header */}
      <div className="glass-panel" style={{ padding: '16px', marginBottom: 12 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 8 }}>
          <h1 style={{ fontSize: 16, fontWeight: 600, color: 'var(--ink)', flex: 1, marginRight: 8, lineHeight: 1.3 }}>
            {detail.title}
          </h1>
          <Badge variant={STATUS_VARIANT[detail.status] || 'default'}>
            {detail.status?.replace('_', ' ')}
          </Badge>
        </div>
        <p style={{ fontFamily: 'var(--font-label)', fontSize: 10, color: 'var(--cyan)', marginBottom: 8 }}>
          {detail.ticket_uid}
        </p>
        {detail.description && (
          <p style={{ fontSize: 12, color: 'var(--ink-dim)', lineHeight: 1.5 }}>{detail.description}</p>
        )}
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10, marginTop: 10, fontSize: 10, color: 'var(--ink-faint)', fontFamily: 'var(--font-label)' }}>
          {detail.workflow_state && <span>Stage: {detail.workflow_state.replace(/_/g, ' ')}</span>}
          {detail.source && <span>Source: {detail.source}</span>}
          {detail.assigned_to && <span>Assigned: {detail.assigned_to}</span>}
          {detail.jira_issue_key && <span>Jira: {detail.jira_issue_key}</span>}
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
            <span className="hud-label">SLA</span>
            <span style={{ fontSize: 11, color: detail.sla_breached ? 'var(--danger)' : 'var(--ink-dim)', marginLeft: 'auto' }}>
              {detail.sla_breached ? 'Breached' : 'Due'} {formatWhen(detail.sla_deadline)}
            </span>
          </div>
        </div>
      )}

      {/* Location */}
      {detail.lat !== null && detail.lng !== null && (
        <div className="glass-panel" style={{ padding: '14px', marginBottom: 12 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
            <MapPin size={16} style={{ color: 'var(--cyan)' }} />
            <span className="hud-label">Ticket location</span>
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
            Open in Maps
          </a>
        </div>
      )}

      {/* Existing evidence */}
      {detail.image_urls && detail.image_urls.length > 0 && (
        <div className="glass-panel" style={{ padding: '14px', marginBottom: 12 }}>
          <span className="hud-label" style={{ display: 'block', marginBottom: 8 }}>Attached images</span>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            {detail.image_urls.map((url) => (
              <a key={url} href={storageUrl(url)} target="_blank" rel="noreferrer">
                <img
                  src={storageUrl(url)}
                  alt="Ticket evidence"
                  style={{ width: 84, height: 84, objectFit: 'cover', borderRadius: 2, border: '1px solid var(--border)' }}
                />
              </a>
            ))}
          </div>
        </div>
      )}

      {/* Update form */}
      {!['CLOSED'].includes(detail.status) && (
        <div className="glass-panel" style={{ padding: '14px', marginBottom: 12 }}>
          <h2 className="hud-label" style={{ marginBottom: 10 }}>Update ticket</h2>

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
            <Button onClick={() => geo.getPosition()} variant="outline" size="sm" disabled={geo.loading}>
              {geo.loading ? 'Locating…' : 'Get GPS'}
            </Button>
          </div>
          {geo.error && (
            <p role="alert" style={{ color: 'var(--danger)', fontSize: 11, marginBottom: 8 }}>{geo.error}</p>
          )}
          {!geo.isFresh && !geo.error && (
            <p style={{ color: 'var(--ink-faint)', fontSize: 11, marginBottom: 8 }}>
              Your GPS position is recorded with the update — a fix within the last 5 minutes is required.
            </p>
          )}

          {/* Quick actions */}
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 10 }}>
            {QUICK_ACTIONS.filter((a) => a.status !== currentStatus).map((action) => (
              <button
                key={action.status}
                type="button"
                onClick={() => {
                  setStatus(action.status);
                  setComment((prev) => prev || action.note);
                }}
                style={{
                  padding: '7px 11px', fontSize: 10, fontFamily: 'var(--font-label)',
                  textTransform: 'uppercase', letterSpacing: '0.05em', cursor: 'pointer', borderRadius: 2,
                  border: `1px solid ${status === action.status ? 'var(--cyan)' : 'var(--border)'}`,
                  background: status === action.status ? 'rgba(61,232,255,0.1)' : 'transparent',
                  color: status === action.status ? 'var(--cyan)' : 'var(--ink-dim)',
                }}
              >
                {action.label}
              </button>
            ))}
          </div>

          {/* Status */}
          <label htmlFor="update-status" className="hud-label" style={{ display: 'block', marginBottom: 6 }}>
            New status
          </label>
          <select
            id="update-status"
            value={status}
            onChange={(e) => setStatus(e.target.value)}
            style={{
              width: '100%', background: 'var(--bg-deep)', border: '1px solid var(--border)',
              borderRadius: 2, padding: '10px', color: 'var(--ink)', fontSize: 12,
              fontFamily: 'var(--font-body)', marginBottom: 10,
            }}
          >
            <option value="">— Select status —</option>
            {statusOptions.map((s) => (
              <option key={s} value={s}>{s.replace('_', ' ')}</option>
            ))}
          </select>

          {/* Comment */}
          <label htmlFor="update-comment" className="hud-label" style={{ display: 'block', marginBottom: 6 }}>
            Comment
          </label>
          <textarea
            id="update-comment"
            value={comment}
            onChange={(e) => setComment(e.target.value)}
            placeholder="What did you find or do on site?"
            style={{
              width: '100%', background: 'var(--bg-deep)', border: '1px solid var(--border)',
              borderRadius: 2, padding: '10px', color: 'var(--ink)', fontSize: 12,
              fontFamily: 'var(--font-body)', resize: 'vertical', minHeight: 64, marginBottom: 10,
            }}
          />

          {/* Evidence */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
            <Button onClick={handleCapture} variant="outline" size="sm">
              <Camera size={14} /> Add photo
            </Button>
            <span style={{ fontSize: 10, color: 'var(--ink-faint)' }}>
              {images.length > 0 ? `${images.length} photo(s) attached` : 'Optional evidence'}
            </span>
          </div>
          {images.length > 0 && (
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 10 }}>
              {images.map((img, index) => (
                <div key={img.preview} style={{ position: 'relative' }}>
                  <img
                    src={img.preview}
                    alt={`Evidence ${index + 1}`}
                    style={{ width: 72, height: 72, objectFit: 'cover', borderRadius: 2, border: '1px solid var(--border)' }}
                  />
                  <button
                    type="button"
                    onClick={() => removeImage(index)}
                    aria-label={`Remove photo ${index + 1}`}
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
            <p role="alert" style={{ color: 'var(--danger)', fontSize: 11, marginBottom: 8 }}>{formError}</p>
          )}
          {notice && (
            <p role="status" style={{ color: 'var(--safe, #34d399)', fontSize: 11, marginBottom: 8 }}>{notice}</p>
          )}

          <Button
            onClick={() => updateMutation.mutate()}
            disabled={!status || !geo.isFresh || updateMutation.isPending}
            size="md"
            style={{ width: '100%' }}
          >
            {updateMutation.isPending ? 'Saving…' : 'Save update'}
          </Button>
        </div>
      )}

      {/* Activity / comments */}
      <div className="glass-panel" style={{ padding: '14px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
          <MessageSquare size={15} style={{ color: 'var(--cyan)' }} />
          <span className="hud-label">Activity</span>
          <span style={{ fontSize: 10, color: 'var(--ink-faint)', marginLeft: 'auto' }}>
            {timeline?.length ?? 0} entries
          </span>
        </div>
        {!timeline || timeline.length === 0 ? (
          <p style={{ fontSize: 12, color: 'var(--ink-dim)' }}>No activity recorded yet.</p>
        ) : (
          <ol data-testid="timeline" style={{ listStyle: 'none', margin: 0, padding: 0, display: 'flex', flexDirection: 'column', gap: 10 }}>
            {timeline.map((event) => (
              <li key={event.id} style={{ borderLeft: '2px solid var(--border)', paddingLeft: 10 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8 }}>
                  <span style={{ fontSize: 11, color: 'var(--ink)', fontWeight: 600 }}>
                    {humaniseEvent(event.event_type)}
                  </span>
                  <span style={{ fontSize: 10, color: 'var(--ink-faint)', flexShrink: 0 }}>
                    {formatWhen(event.created_at)}
                  </span>
                </div>
                <div style={{ fontSize: 10, color: 'var(--ink-dim)', marginTop: 2 }}>
                  {event.actor || 'system'}
                  {event.old_status && event.new_status ? ` · ${event.old_status} → ${event.new_status}` : ''}
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