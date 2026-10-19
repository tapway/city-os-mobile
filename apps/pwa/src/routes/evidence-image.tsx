import { useEffect, useState } from 'react';
import { ImageOff } from 'lucide-react';
import { defaultEvidenceDeps, evidenceSource, loadEvidenceImage, type EvidenceImageDeps } from '../lib/evidence-image';
import { storageUrl } from '../lib/help-api';
import { useLang } from '../i18n/react';

export type EvidenceThumbState =
  | { status: 'loading' }
  | { status: 'ready'; src: string }
  | { status: 'unavailable'; retryable: boolean };

const BOX_STYLE = {
  width: 84, height: 84, borderRadius: 2, border: '1px solid var(--border)', boxSizing: 'border-box' as const,
};

/** One evidence thumbnail: the photo, a loading box, or a tap-to-retry "Photo not available" box. */
export function EvidenceThumbView({
  state, alt, unavailable, retry, onRetry, onError,
}: {
  state: EvidenceThumbState;
  alt: string;
  unavailable: string;
  retry: string;
  onRetry: () => void;
  onError?: () => void;
}) {
  if (state.status === 'ready') {
    return (
      <a href={state.src} target="_blank" rel="noreferrer">
        <img src={state.src} alt={alt} onError={onError} style={{ ...BOX_STYLE, objectFit: 'cover', display: 'block' }} />
      </a>
    );
  }
  if (state.status === 'loading') {
    return <div aria-busy="true" data-testid="evidence-loading" style={{ ...BOX_STYLE, background: 'var(--glass-weak)' }} />;
  }
  return (
    <button
      type="button"
      onClick={onRetry}
      data-testid="evidence-unavailable"
      style={{
        ...BOX_STYLE, minHeight: 84, height: 'auto', display: 'flex', flexDirection: 'column', alignItems: 'center',
        justifyContent: 'center', gap: 4, padding: 4, textAlign: 'center', cursor: 'pointer',
        background: 'var(--glass-weak)', color: 'var(--ink-dim)', fontSize: 12, lineHeight: 1.2,
      }}
    >
      <ImageOff size={18} aria-hidden="true" />
      <span>{unavailable}</span>
      <span style={{ color: 'var(--cyan)' }}>{retry}</span>
    </button>
  );
}

/**
 * A stored evidence photo. Jira-imported photos sit behind the bearer token, so
 * they are fetched and shown from a blob: URL. A failure ends in a placeholder
 * that can be tapped to retry; a transient failure (offline, 5xx, timeout) also
 * retries once by itself when the device comes back online.
 */
export function EvidenceImage({ url, deps = defaultEvidenceDeps }: { url: string; deps?: EvidenceImageDeps }) {
  const { t } = useLang();
  const [state, setState] = useState<EvidenceThumbState>({ status: 'loading' });
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let cancelled = false;
    let objectUrl: string | null = null;
    if (evidenceSource(url) === 'direct') {
      setState({ status: 'ready', src: storageUrl(url) });
      return;
    }
    setState({ status: 'loading' });
    void loadEvidenceImage(url, deps).then((result) => {
      if (result.status === 'ready') {
        if (cancelled) {
          deps.revokeObjectURL(result.src); // arrived after unmount / url change
          return;
        }
        objectUrl = result.src;
      } else if (cancelled) {
        return;
      }
      setState(result);
    });
    return () => {
      cancelled = true;
      if (objectUrl) deps.revokeObjectURL(objectUrl);
    };
  }, [url, attempt, deps]);

  const retryable = state.status === 'unavailable' && state.retryable;
  useEffect(() => {
    if (!retryable) return;
    const onOnline = () => setAttempt((n) => n + 1);
    window.addEventListener('online', onOnline);
    return () => window.removeEventListener('online', onOnline);
  }, [retryable]);

  return (
    <EvidenceThumbView
      state={state}
      alt={t('detail.evidenceAlt')}
      unavailable={t('detail.photoUnavailable')}
      retry={t('detail.photoRetry')}
      onRetry={() => setAttempt((n) => n + 1)}
      onError={() => setState({ status: 'unavailable', retryable: false })}
    />
  );
}
