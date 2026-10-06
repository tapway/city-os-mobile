/**
 * "Add evidence": photos -> BFF upload -> register -> upload_evidence action.
 *
 * Same contract as submit-update.ts: dependencies injected, every path keeps the
 * officer's work. Offline / lapsed session queues the step that did not finish
 * (blobs for photos not yet uploaded, object URLs for ones that were, registered
 * attachment ids once register went through); a permanent rejection removes only
 * objects that no attachment row references.
 */
import { ApiError, isTicketLocked, shouldQueue } from './api';
import { MsgError } from '../i18n';
import { actionPath, keyOfUrl } from './help-api';
import type { QueuedMutation, QueuedPhoto } from './offline-queue';
import type { SubmitOutcome } from './submit-update';

export interface EvidenceDeps {
  hasQueued: (uid: string, user: string) => Promise<boolean>;
  upload: (file: File, uid: string) => Promise<{ url: string }>;
  register: (uid: string, keys: string[]) => Promise<number[]>;
  act: (uid: string, attachmentIds: number[], comment?: string) => Promise<unknown>;
  remove: (url: string) => Promise<void>;
  enqueue: (m: Omit<QueuedMutation, 'id' | 'created_at'>) => Promise<number>;
}

const toQueued = (f: File): QueuedPhoto => ({ blob: f, name: f.name });

export async function submitEvidence(
  deps: EvidenceDeps,
  input: { uid: string; photos: File[]; user: string; comment?: string },
): Promise<{ outcome: SubmitOutcome | 'queuedLocked'; result?: unknown }> {
  const { uid, photos, user, comment } = input;
  if (!user) throw new MsgError('err.sessionExpired');
  if (photos.length === 0) throw new MsgError('detail.err.needPhoto');

  const queue = async (urls: string[], unsent: File[], ids: number[] | undefined, auth: boolean, locked = false) => {
    await deps.enqueue({
      url: actionPath(uid, 'upload_evidence'),
      method: 'POST',
      kind: 'evidence',
      user,
      body: { image_urls: urls },
      ...(comment ? { comment } : {}),
      ...(locked ? { locked: true } : {}),
      ...(ids?.length ? { attachment_ids: ids } : {}),
      ...(unsent.length ? { photos: unsent.map(toQueued) } : {}),
    });
    return { outcome: (locked ? 'queuedLocked' : auth ? 'queuedAuth' : 'queued') as SubmitOutcome | 'queuedLocked' };
  };
  const isAuth = (err: unknown) => err instanceof ApiError && err.status === 401;
  const cleanup = (urls: string[]) => Promise.all(urls.map((u) => deps.remove(u).catch(() => undefined)));
  const permanent = (err: unknown) => err instanceof ApiError && err.status >= 400 && err.status < 500;

  // Something already waiting for this ticket goes first (order matters).
  if (await deps.hasQueued(uid, user)) return queue([], photos, undefined, false);

  const urls: string[] = [];
  for (const [i, file] of photos.entries()) {
    try {
      urls.push((await deps.upload(file, uid)).url);
    } catch (err) {
      if (shouldQueue(err)) return queue(urls, photos.slice(i), undefined, isAuth(err));
      await cleanup(urls);
      throw err;
    }
  }

  let ids: number[];
  try {
    ids = await deps.register(uid, urls.map(keyOfUrl));
  } catch (err) {
    if (shouldQueue(err)) return queue(urls, [], undefined, isAuth(err));
    if (permanent(err)) await cleanup(urls);
    throw err;
  }

  try {
    return { outcome: 'saved', result: await deps.act(uid, ids, comment) };
  } catch (err) {
    if (shouldQueue(err)) return queue(urls, [], ids, isAuth(err));
    // Locked: the objects are registered rows; keep them in the queue with their ids, sent once unlocked.
    if (isTicketLocked(err)) return queue(urls, [], ids, false, true);
    throw err; // objects are registered attachments now: never delete them
  }
}
