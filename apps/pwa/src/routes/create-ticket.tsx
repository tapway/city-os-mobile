import { useState } from 'react';
import { useNavigate } from '@tanstack/react-router';
import { useMutation, useQuery } from '@tanstack/react-query';
import { ArrowLeft, MapPin, Camera, X } from 'lucide-react';
import { Button } from '@city-os/ui';
import { createTicket, listIncidentTypes, uploadImage, type IncidentType } from '../lib/help-api';
import { useGeolocation, formatFixAge } from '../hooks/useGeolocation';
import { useOnlineStatus } from '../hooks/useOnlineStatus';

interface PendingImage {
  file: File;
  preview: string;
}

export function CreateTicketPage() {
  const navigate = useNavigate();
  const geo = useGeolocation({ auto: true });
  const online = useOnlineStatus();

  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [incidentTypeCode, setIncidentTypeCode] = useState('');
  const [urgency, setUrgency] = useState<'low' | 'medium' | 'high' | 'critical'>('medium');
  const [reporterName, setReporterName] = useState('');
  const [reporterContact, setReporterContact] = useState('');
  const [images, setImages] = useState<PendingImage[]>([]);
  const [error, setError] = useState('');

  const { data: incidentTypes, error: typesError } = useQuery({
    queryKey: ['incident-types'],
    queryFn: listIncidentTypes,
  });

  const groupedTypes = (incidentTypes || []).reduce<Record<string, IncidentType[]>>((acc, t) => {
    const group = t.group_type || 'Other';
    (acc[group] = acc[group] || []).push(t);
    return acc;
  }, {});

  const createMutation = useMutation({
    mutationFn: async () => {
      if (!title.trim()) throw new Error('A title is required');
      if (!geo.isFresh || typeof geo.lat !== 'number' || typeof geo.lng !== 'number') {
        throw new Error('A fresh GPS fix is required — tap “Get GPS” and try again');
      }
      if (!online) throw new Error('You are offline — reconnect to report an incident');

      const uploaded = await Promise.all(images.map((i) => uploadImage(i.file)));

      return createTicket({
        title: title.trim(),
        description: description.trim() || undefined,
        source: 'mobile',
        lat: geo.lat,
        lng: geo.lng,
        urgency,
        incident_type_code: incidentTypeCode || undefined,
        reporter_name: reporterName.trim() || undefined,
        reporter_contact: reporterContact.trim() || undefined,
        reporting_method: 'mobile',
        image_urls: uploaded.length ? uploaded.map((u) => u.url) : undefined,
      });
    },
    onSuccess: (ticket) => {
      images.forEach((i) => URL.revokeObjectURL(i.preview));
      setImages([]);
      if (ticket?.ticket_uid) {
        navigate({ to: '/tickets/$id', params: { id: ticket.ticket_uid } });
      } else {
        navigate({ to: '/tickets' });
      }
    },
    onError: (err: Error) => setError(err.message),
  });

  const handleCapture = () => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'image/*';
    input.capture = 'environment';
    input.multiple = true;
    input.onchange = (e) => {
      const files = Array.from((e.target as HTMLInputElement).files ?? []);
      setImages((prev) => [...prev, ...files.map((file) => ({ file, preview: URL.createObjectURL(file) }))]);
    };
    input.click();
  };

  const removeImage = (index: number) => {
    setImages((prev) => {
      URL.revokeObjectURL(prev[index]!.preview);
      return prev.filter((_, i) => i !== index);
    });
  };

  const canSubmit = Boolean(title.trim()) && geo.isFresh && online;

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
        <ArrowLeft size={16} /> Cancel
      </button>

      <h1 style={{ fontSize: 18, fontWeight: 600, color: 'var(--ink)', marginBottom: 16 }}>
        Report Incident
      </h1>

      {/* GPS */}
      <div className="glass-panel" style={{ padding: '14px', marginBottom: 12 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
          <MapPin size={16} style={{ color: geo.isFresh ? 'var(--cyan)' : 'var(--ink-dim)' }} />
          <span className="hud-label">Location</span>
        </div>
        <p style={{ fontSize: 12, color: 'var(--ink-dim)', marginBottom: 8 }}>
          {geo.fix
            ? `${geo.fix.lat.toFixed(6)}, ${geo.fix.lng.toFixed(6)}${geo.accuracy ? ` (±${Math.round(geo.accuracy)} m)` : ''} · ${formatFixAge(geo.ageMs)}`
            : 'No GPS fix yet — required to report an incident'}
        </p>
        <Button onClick={() => geo.getPosition()} variant="outline" size="sm" disabled={geo.loading}>
          {geo.loading ? 'Locating…' : 'Get GPS'}
        </Button>
        {geo.error && <p role="alert" style={{ color: 'var(--danger)', fontSize: 11, marginTop: 6 }}>{geo.error}</p>}
      </div>

      {/* Title */}
      <div className="glass-panel" style={{ padding: '14px', marginBottom: 12 }}>
        <label htmlFor="incident-title" className="hud-label" style={{ marginBottom: 6, display: 'block' }}>
          Title *
        </label>
        <input
          id="incident-title"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="Describe the incident…"
          style={{
            width: '100%', background: 'var(--bg-deep)', border: '1px solid var(--border)',
            borderRadius: 2, padding: '10px', color: 'var(--ink)', fontSize: 13,
            fontFamily: 'var(--font-body)', outline: 'none',
          }}
        />
      </div>

      {/* Description */}
      <div className="glass-panel" style={{ padding: '14px', marginBottom: 12 }}>
        <label htmlFor="incident-description" className="hud-label" style={{ marginBottom: 6, display: 'block' }}>
          Description
        </label>
        <textarea
          id="incident-description"
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          placeholder="Provide details about the incident…"
          style={{
            width: '100%', background: 'var(--bg-deep)', border: '1px solid var(--border)',
            borderRadius: 2, padding: '10px', color: 'var(--ink)', fontSize: 12,
            fontFamily: 'var(--font-body)', resize: 'vertical', minHeight: 80, outline: 'none',
          }}
        />
      </div>

      {/* Incident type */}
      <div className="glass-panel" style={{ padding: '14px', marginBottom: 12 }}>
        <label htmlFor="incident-type" className="hud-label" style={{ marginBottom: 6, display: 'block' }}>
          Incident type
        </label>
        <select
          id="incident-type"
          value={incidentTypeCode}
          onChange={(e) => setIncidentTypeCode(e.target.value)}
          style={{
            width: '100%', background: 'var(--bg-deep)', border: '1px solid var(--border)',
            borderRadius: 2, padding: '10px', color: 'var(--ink)', fontSize: 12,
            fontFamily: 'var(--font-body)', outline: 'none',
          }}
        >
          <option value="">— Select type —</option>
          {Object.entries(groupedTypes).map(([group, types]) => (
            <optgroup key={group} label={group}>
              {types.map((t) => (
                <option key={t.code} value={t.code}>{t.name_en || t.name || t.code}</option>
              ))}
            </optgroup>
          ))}
        </select>
        {typesError && (
          <p role="alert" style={{ color: 'var(--danger)', fontSize: 11, marginTop: 6 }}>
            Could not load incident types: {(typesError as Error).message}
          </p>
        )}
      </div>

      {/* Urgency */}
      <fieldset className="glass-panel" style={{ padding: '14px', marginBottom: 12, border: '1px solid var(--border)' }}>
        <legend className="hud-label" style={{ padding: '0 4px' }}>Urgency</legend>
        <div style={{ display: 'flex', gap: 6 }}>
          {(['low', 'medium', 'high', 'critical'] as const).map((u) => (
            <button
              key={u}
              type="button"
              onClick={() => setUrgency(u)}
              aria-pressed={urgency === u}
              style={{
                flex: 1, padding: '8px 4px', fontSize: 10, fontFamily: 'var(--font-label)',
                textTransform: 'uppercase', letterSpacing: '0.05em', cursor: 'pointer',
                border: `1px solid ${urgency === u ? 'var(--cyan)' : 'var(--border)'}`,
                background: urgency === u ? 'rgba(61,232,255,0.1)' : 'transparent',
                color: urgency === u ? 'var(--cyan)' : 'var(--ink-dim)',
                borderRadius: 2, transition: 'all 0.2s',
              }}
            >
              {u}
            </button>
          ))}
        </div>
      </fieldset>

      {/* Photo */}
      <div className="glass-panel" style={{ padding: '14px', marginBottom: 12 }}>
        <span className="hud-label" style={{ marginBottom: 6, display: 'block' }}>Photo evidence</span>
        <Button onClick={handleCapture} variant="outline" size="sm">
          <Camera size={14} /> Capture photo
        </Button>
        {images.length > 0 && (
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 10 }}>
            {images.map((img, index) => (
              <div key={img.preview} style={{ position: 'relative' }}>
                <img
                  src={img.preview}
                  alt={`Captured evidence ${index + 1}`}
                  style={{ width: 84, height: 84, objectFit: 'cover', borderRadius: 2, border: '1px solid var(--border)' }}
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
      </div>

      {/* Reporter */}
      <div className="glass-panel" style={{ padding: '14px', marginBottom: 12 }}>
        <span className="hud-label" style={{ marginBottom: 6, display: 'block' }}>Reporter info</span>
        <label htmlFor="reporter-name" className="sr-only">Reporter name</label>
        <input
          id="reporter-name"
          value={reporterName}
          onChange={(e) => setReporterName(e.target.value)}
          placeholder="Your name"
          style={{
            width: '100%', background: 'var(--bg-deep)', border: '1px solid var(--border)',
            borderRadius: 2, padding: '10px', color: 'var(--ink)', fontSize: 12,
            fontFamily: 'var(--font-body)', outline: 'none', marginBottom: 8,
          }}
        />
        <label htmlFor="reporter-contact" className="sr-only">Reporter phone number</label>
        <input
          id="reporter-contact"
          value={reporterContact}
          onChange={(e) => setReporterContact(e.target.value)}
          placeholder="Phone number"
          style={{
            width: '100%', background: 'var(--bg-deep)', border: '1px solid var(--border)',
            borderRadius: 2, padding: '10px', color: 'var(--ink)', fontSize: 12,
            fontFamily: 'var(--font-body)', outline: 'none',
          }}
        />
      </div>

      {error && (
        <div className="glass-panel" style={{ padding: '10px', marginBottom: 12, borderColor: 'rgba(239,68,68,0.4)' }}>
          <p role="alert" style={{ color: 'var(--danger)', fontSize: 11 }}>{error}</p>
        </div>
      )}

      <Button
        onClick={() => createMutation.mutate()}
        disabled={!canSubmit || createMutation.isPending}
        size="lg"
        className="w-full"
        style={{ width: '100%', marginBottom: 24 }}
      >
        {createMutation.isPending ? 'Submitting…' : 'Submit report'}
      </Button>
    </div>
  );
}