/**
 * A one-way flag from the service worker to the app.
 *
 * A service worker cannot renew a push subscription on its own: the subscribe
 * call needs the user's access token, which lives in memory in the page. So
 * `pushsubscriptionchange` leaves this marker, and the app completes the work on
 * its next open. Cache Storage is shared by both contexts; localStorage is not.
 */
const CACHE = 'cityos-sw-state';
const KEY = '/__push_resubscribe';

export async function setResubscribeFlag(): Promise<void> {
  try {
    const cache = await caches.open(CACHE);
    await cache.put(KEY, new Response('1'));
  } catch {
    // Storage unavailable (private mode, quota): the device simply stays silent.
  }
}

export async function hasResubscribeFlag(): Promise<boolean> {
  try {
    const cache = await caches.open(CACHE);
    return (await cache.match(KEY)) !== undefined;
  } catch {
    return false;
  }
}

export async function clearResubscribeFlag(): Promise<void> {
  try {
    const cache = await caches.open(CACHE);
    await cache.delete(KEY);
  } catch {
    // Nothing to clear.
  }
}