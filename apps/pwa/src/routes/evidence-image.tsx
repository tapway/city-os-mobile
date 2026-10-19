import { useEffect, useState } from 'react';
import { ImageOff } from 'lucide-react';
import { evidenceSource, loadEvidenceImage } from '../lib/evidence-image';
import { storageUrl } from '../lib/help-api';
import { useLang } from '../i18n/react';

export type EvidenceThumbState =
  | { status: 'loading' }
  | { status: 'ready'; src: string }
  | { status: 'unavailable' };

const BOX_STYLE = {
  width: 84, height: 84, borderRadius: 2, border: '1px solid var(--border)', boxSizing: 'border-box' as const,
};

/** One evidence thumbnail: the photo, a loading box, or a labelled "Photo not available" box. */
export function EvidenceThumbView({
  state, alt, unavailable, onError,
}: {
  state: EvidenceThumbState;
  alt: string;
  unavailable: string;
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
    <div
      data-testid="evidence-unavailable"
      style={{
        ...BOX_STYLE, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
        gap: 4, padding: 4, textAlign: 'center', background: 'var(--glass-weak)', color: 'var(--ink-dim)',
        fontSize: 12, lineHeight: 1.2,
      }}
    >
      <ImageOff size={18} aria-hidden="true" />
      <span>{unavailable}</span>
    </div>
  );
}

/**
 * A stored evidence photo. Jira-imported photos sit behind the bearer token, so
 * they are fetched and shown from a blob: URL; any failure ends in a clear
 * placeholder rather than a broken image.
 */
export function EvidenceImage({ url }: { url: string }) {
  const { t } = useLang();
  const [state, setState] = useState<EvidenceThumbState>({ status: 'loading' });

  useEffect(() => {
    let cancelled = false;
    let objectUrl: string | null = null;
    if (evidenceSource(url) === 'direct') {
      setState({ status: 'ready', src: storageUrl(url) });
      return;
    }
    setState({ status: 'loading' });
    void loadEvidenceImage(url).then((loaded) => {
      if (cancelled) {
        if (loaded) URL.revokeObjectURL(loaded);
        return;
      }
      objectUrl = loaded;
      setState(loaded ? { status: 'ready', src: loaded } : { status: 'unavailable' });
    });
    return () => {
      cancelled = true;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [url]);

  return (
    <EvidenceThumbView
      state={state}
      alt={t('detail.evidenceAlt')}
      unavailable={t('detail.photoUnavailable')}
      onError={() => setState({ status: 'unavailable' })}
    />
  );
}
