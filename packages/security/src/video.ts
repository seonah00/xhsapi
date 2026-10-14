/** Provider-supplied transcoded stream only; never fetch or proxy media on the server. */
export function safeVideoStreamUrl(value: unknown): string | null {
  if (typeof value !== 'string' || value.length > 4000) return null;
  try {
    const u = new URL(value);
    if (!['http:', 'https:'].includes(u.protocol) || u.username || u.password || u.port || u.hash) return null;
    if (!/^sns-v[0-9]+\.rednotecdn\.com$/.test(u.hostname) || !/^\/stream\/[a-zA-Z0-9/_-]+\.mp4$/.test(u.pathname)) return null;
    // HTTPS only in our HTTPS app; an unavailable secure rendition fails visibly.
    u.protocol = 'https:';
    return u.href;
  } catch { return null; }
}
