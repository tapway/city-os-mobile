/**
 * Send a field update (status change + evidence), or keep it queued.
 *
 * Dependencies are injected so the decision logic runs in node tests without a
 * network. Every path preserves the officer's work: offline and 401 queue it
 * (blobs included), a server rejection (other 4xx) deletes evidence this call
 * uploaded and rethrows.
 */
import { ApiError, shouldQueue } from './api';
import type { QueuedMutation, QueuedPhoto } from './offline-queue';

export interface SubmitDeps {
  hasQueued: (uid: string) => Promise<boolean>;
  upload: (file: File, uid: string) => Promise<{ url: string }>;
  patch: (request: { path: string; body: Record<string, unknown> }) => Promise<unknown>;
  remove: (url: string) => Promise<void>;
  enqueue: (m: Omit<QueuedMutation, 'id' | 'created_at'>) => Promise<number>;
}

export type SubmitOutcome = 'saved' | 'queued' | 'queuedAuth';

const toQueued = (f: File): QueuedPhoto => ({ blob: f, name: f.name });

export async function submitStatusUpdate(
  deps: SubmitDeps,
  input: { uid: string; request: { path: string; body: Record<string, unknown> }; photos: File[] },
): Promise<{ outcome: SubmitOutcome; result?: unknown }> {
  const { uid, request, photos } = input;

  const queue = async (urls: string[], unsent: File[], auth: boolean) => {
    await deps.enqueue({
      url: request.path,
      method: 'PATCH',
      body: urls.length ? { ...request.body, image_urls: urls } : request.body,
      ...(unsent.length ? { photos: unsent.map(toQueued) } : {}),
    });
    return { outcome: (auth ? 'queuedAuth' : 'queued') as SubmitOutcome };
  };
  const isAuth = (err: unknown) => err instanceof ApiError && err.status === 401;

  // An update already waiting for this ticket goes first; sending this one live
  // would overtake it (Start before Accept → 409 → the field update is lost).
  if (await deps.hasQueued(uid)) return queue([], photos, false);

  // Evidence first, so a failed upload never leaves a half-written update.
  const urls: string[] = [];
  for (const [i, file] of photos.entries()) {
    try {
      urls.push((await deps.upload(file, uid)).url);
    } catch (err) {
      if (shouldQueue(err)) return queue(urls, photos.slice(i), isAuth(err));
      await Promise.all(urls.map((u) => deps.remove(u).catch(() => undefined)));
      throw err;
    }
  }

  const body = urls.length ? { ...request.body, image_urls: urls } : request.body;
  try {
    return { outcome: 'saved', result: await deps.patch({ path: request.path, body }) };
  } catch (err) {
    if (shouldQueue(err)) return queue(urls, [], isAuth(err));
    // Only a permanent rejection orphans the evidence; a 5xx is retried by the caller.
    if (err instanceof ApiError && err.status >= 400 && err.status < 500) {
      await Promise.all(urls.map((u) => deps.remove(u).catch(() => undefined)));
    }
    throw err;
  }
}
