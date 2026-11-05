import "server-only";

type DownloadedMedia = { bytes: Uint8Array; mimeType: string; fileName: string };
/** Short-lived, bounded server memory. Call only AFTER checking access to the message. */
export function createMediaDownloadCache(maxBytes = 32 * 1024 * 1024, ttlMs = 60_000, now = Date.now) {
  const cache = new Map<string, { value: DownloadedMedia; expires: number }>();
  const pending = new Map<string, Promise<DownloadedMedia>>();
  let size = 0;
  const remove = (key: string) => { const entry = cache.get(key); if (entry) { size -= entry.value.bytes.byteLength; cache.delete(key); } };
  return async (key: string, download: () => Promise<DownloadedMedia>) => {
    for (const [id, entry] of cache) if (entry.expires <= now()) remove(id);
    const hit = cache.get(key);
    if (hit) return hit.value;
    const running = pending.get(key);
    if (running) return running;
    const request = download().then(value => {
      if (value.bytes.byteLength <= maxBytes) {
        remove(key);
        while (size + value.bytes.byteLength > maxBytes && cache.size) remove(cache.keys().next().value!);
        cache.set(key, { value, expires: now() + ttlMs }); size += value.bytes.byteLength;
      }
      return value;
    }).finally(() => { if (pending.get(key) === request) pending.delete(key); });
    if (pending.size < 32) pending.set(key, request);
    return request;
  };
}
