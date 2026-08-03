import { useState } from 'react';
import { useNavigate } from '@tanstack/react-router';
import { useMutation, useQuery } from '@tanstack/react-query';
import { ArrowLeft, MapPin, Camera } from 'lucide-react';
import { Button } from '@city-os/ui';
import { apiJson } from '../lib/api';
import { useGeolocation } from '../hooks/useGeolocation';

interface IncidentType {
  id: number;
  code: string;
  name_en: string;
  group_type: string;
}

export function CreateTicketPage() {
  const navigate = useNavigate();
  const geo = useGeolocation();

  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [incidentTypeCode, setIncidentTypeCode] = useState('');
  const [urgency, setUrgency] = useState<'low' | 'medium' | 'high' | 'critical'>('medium');
  const [reporterName, setReporterName] = useState('');
  const [reporterContact, setReporterContact] = useState('');
  const [photo, setPhoto] = useState<string | null>(null);
  const [error, setError] = useState('');

  // Fetch incident types
  const { data: incidentTypes } = useQuery({
    queryKey: ['incident-types'],
    queryFn: async () => {
      const raw = await apiJson('/api/v1/incident-types');
      return Array.isArray(raw) ? (raw as IncidentType[]) : [];
    },
  });

  // Group by domain
  const groupedTypes = (incidentTypes || []).reduce<Record<string, IncidentType[]>>((acc, t) => {
    (acc[t.group_type] = acc[t.group_type] || []).push(t);
    return acc;
  }, {});

  const createMutation = useMutation({
    mutationFn: async () => {
      if (!geo.lat || !geo.lng) throw new Error('GPS position required');
      if (!title.trim()) throw new Error('Title is required');

      const body: Record<string, any> = {
        title: title.trim(),
        description: description.trim(),
        source: 'mobile',
        lat: geo.lat,
        lng: geo.lng,
        urgency,
        incident_type_code: incidentTypeCode || undefined,
        reporter_name: reporterName.trim() || undefined,
        reporter_contact: reporterContact.trim() || undefined,
      };

      const raw = await apiJson('/api/v1/events', {
        method: 'POST',
        body: JSON.stringify(body),
      });
      return raw;
    },
    onSuccess: (data: any) => {
      // Navigate to the new ticket detail
      const ticketId = data?.id || data?.ticket_uid;
      if (ticketId) {
        navigate({ to: `/tickets/${ticketId}` });
      } else {
        navigate({ to: '/tickets' });
      }
    },
    onError: (err: Error) => setError(err.message),
  });

  const handlePhotoCapture = () => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'image/*';
    input.capture = 'environment';
    input.onchange = (e) => {
      const file = (e.target as HTMLInputElement).files?.[0];
      if (file) {
        const reader = new FileReader();
        reader.onload = () => setPhoto(reader.result as string);
        reader.readAsDataURL(file);
      }
    };
    input.click();
  };

  const canSubmit = title.trim() && geo.lat && geo.lng;

  return (
    <div className="app-content" style={{ padding: '16px' }}>
      {/* Back button */}
      <button
        onClick={() => navigate({ to: '/tickets' })}
        style={{
          display: 'flex', alignItems: 'center', gap: 6, marginBottom: 12,
          background: 'none', border: 'none', color: 'var(--cyan)', cursor: 'pointer',
          fontFamily: 'var(--font-label)', fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.08em',
        }}
      >
        <ArrowLeft size={16} /> Cancel
      </button>

      <h1 style={{ fontSize: 18, fontWeight: 600, color: 'var(--ink)', marginBottom: 16 }}>
        Report Incident
      </h1>

      {/* GPS Card */}
      <div className="glass-panel" style={{ padding: '14px', marginBottom: 12 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
          <MapPin size={16} style={{ color: 'var(--cyan)' }} />
          <span className="hud-label">Location</span>
        </div>
        <p style={{ fontSize: 12, color: 'var(--ink-dim)', marginBottom: 8 }}>
          {geo.lat
            ? `${geo.lat.toFixed(6)}, ${geo.lng?.toFixed(6)}`
            : 'GPS not acquired'}
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

      {/* Title */}
      <div className="glass-panel" style={{ padding: '14px', marginBottom: 12 }}>
        <span className="hud-label" style={{ marginBottom: 6, display: 'block' }}>Title *</span>
        <input
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="Describe the incident..."
          style={{
            width: '100%', background: 'var(--bg-deep)', border: '1px solid var(--border)',
            borderRadius: 2, padding: '10px', color: 'var(--ink)', fontSize: 13,
            fontFamily: 'var(--font-body)', outline: 'none',
          }}
        />
      </div>

      {/* Description */}
      <div className="glass-panel" style={{ padding: '14px', marginBottom: 12 }}>
        <span className="hud-label" style={{ marginBottom: 6, display: 'block' }}>Description</span>
        <textarea
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          placeholder="Provide details about the incident..."
          style={{
            width: '100%', background: 'var(--bg-deep)', border: '1px solid var(--border)',
            borderRadius: 2, padding: '10px', color: 'var(--ink)', fontSize: 12,
            fontFamily: 'var(--font-body)', resize: 'vertical', minHeight: 80, outline: 'none',
          }}
        />
      </div>

      {/* Incident Type */}
      <div className="glass-panel" style={{ padding: '14px', marginBottom: 12 }}>
        <span className="hud-label" style={{ marginBottom: 6, display: 'block' }}>Incident Type</span>
        <select
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
                <option key={t.code} value={t.code}>{t.name_en || t.code}</option>
              ))}
            </optgroup>
          ))}
        </select>
      </div>

      {/* Urgency */}
      <div className="glass-panel" style={{ padding: '14px', marginBottom: 12 }}>
        <span className="hud-label" style={{ marginBottom: 6, display: 'block' }}>Urgency</span>
        <div style={{ display: 'flex', gap: 6 }}>
          {(['low', 'medium', 'high', 'critical'] as const).map((u) => (
            <button
              key={u}
              onClick={() => setUrgency(u)}
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
      </div>

      {/* Photo */}
      <div className="glass-panel" style={{ padding: '14px', marginBottom: 12 }}>
        <span className="hud-label" style={{ marginBottom: 6, display: 'block' }}>Photo</span>
        <Button onClick={handlePhotoCapture} variant="outline" size="sm">
          <Camera size={14} /> Capture Photo
        </Button>
        {photo && (
          <div style={{ marginTop: 8 }}>
            <img src={photo} alt="Captured" style={{ width: '100%', borderRadius: 2, maxHeight: 200, objectFit: 'cover' }} />
            <button
              onClick={() => setPhoto(null)}
              style={{
                marginTop: 4, background: 'none', border: 'none', color: 'var(--danger)',
                fontSize: 10, fontFamily: 'var(--font-label)', textTransform: 'uppercase', cursor: 'pointer',
              }}
            >
              Remove Photo
            </button>
          </div>
        )}
      </div>

      {/* Reporter info */}
      <div className="glass-panel" style={{ padding: '14px', marginBottom: 12 }}>
        <span className="hud-label" style={{ marginBottom: 6, display: 'block' }}>Reporter Info</span>
        <input
          value={reporterName}
          onChange={(e) => setReporterName(e.target.value)}
          placeholder="Your name"
          style={{
            width: '100%', background: 'var(--bg-deep)', border: '1px solid var(--border)',
            borderRadius: 2, padding: '10px', color: 'var(--ink)', fontSize: 12,
            fontFamily: 'var(--font-body)', outline: 'none', marginBottom: 6,
          }}
        />
        <input
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

      {/* Error */}
      {error && (
        <div className="glass-panel" style={{ padding: '10px', marginBottom: 12, borderColor: 'rgba(239,68,68,0.4)' }}>
          <p style={{ color: 'var(--danger)', fontSize: 11 }}>{error}</p>
        </div>
      )}

      {/* Submit */}
      <Button
        onClick={() => createMutation.mutate()}
        disabled={!canSubmit || createMutation.isPending}
        size="lg"
        className="w-full"
        style={{ width: '100%', marginBottom: 24 }}
      >
        {createMutation.isPending ? 'Submitting...' : 'Submit Report'}
      </Button>
    </div>
  );
}