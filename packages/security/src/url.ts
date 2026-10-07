import { isIP } from 'node:net';

export class UnsafeUrlError extends Error {
  override name = 'UnsafeUrlError';
}

/** Blocks loopback, private, link-local, CGNAT, multicast and unspecified ranges (spec 10.2). */
export function isPrivateAddress(address: string): boolean {
  const host = address.replace(/^\[|\]$/g, '').toLowerCase();
  const kind = isIP(host);
  if (kind === 4) {
    const [a = 0, b = 0] = host.split('.').map(Number);
    return a === 0 || a === 10 || a === 127 || a >= 224
      || (a === 100 && b >= 64 && b <= 127)
      || (a === 169 && b === 254)
      || (a === 172 && b >= 16 && b <= 31)
      || (a === 192 && b === 168)
      || (a === 198 && (b === 18 || b === 19));
  }
  if (kind === 6) {
    if (host === '::' || host === '::1') return true;
    const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/.exec(host);
    if (mapped?.[1]) return isPrivateAddress(mapped[1]);
    return /^(fc|fd|fe8|fe9|fea|feb|ff)/.test(host);
  }
  return false;
}

/**
 * Static checks before any server-side fetch. DNS results and every redirect hop
 * must be re-checked with isPrivateAddress by the caller's fetch wrapper.
 */
export function assertFetchableUrl(input: string, allowedHosts: readonly string[]): URL {
  let url: URL;
  try {
    url = new URL(input);
  } catch {
    throw new UnsafeUrlError('invalid_url');
  }
  if (url.protocol !== 'https:') throw new UnsafeUrlError('scheme_not_allowed');
  if (url.username || url.password) throw new UnsafeUrlError('credentials_in_url');
  const host = url.hostname.toLowerCase();
  if (host === 'localhost' || host.endsWith('.localhost') || isPrivateAddress(host)) throw new UnsafeUrlError('private_host');
  if (!allowedHosts.includes(host)) throw new UnsafeUrlError('host_not_allowed');
  return url;
}

const SAFE_LINK_SCHEMES = new Set(['https:', 'http:']);

/** For rendering user-supplied links: only http(s); anything else (javascript:, data:) is dropped. */
export function safeExternalHref(input: string): string | null {
  try {
    const url = new URL(input);
    return SAFE_LINK_SCHEMES.has(url.protocol) && !url.username && !url.password ? url.toString() : null;
  } catch {
    return null;
  }
}

/** Image CDNs Xiaohongshu serves note covers from. The CSP img-src must list the same domains. */
export const XHS_IMAGE_DOMAINS = ['rednotecdn.com', 'xhscdn.com', 'xhscdn.net'] as const;

/** A provider cover URL the browser may load directly (never fetched or stored by the server): https on an XHS image CDN. */
export function safeCoverUrl(input: string | null | undefined): string | null {
  if (!input || input.length > 2000) return null;
  try {
    const url = new URL(input);
    const host = url.hostname.toLowerCase();
    if (url.protocol !== 'https:' || url.username || url.password || url.port) return null;
    return XHS_IMAGE_DOMAINS.some((d) => host === d || host.endsWith(`.${d}`)) ? url.toString() : null;
  } catch {
    return null;
  }
}

const XHS_HOSTS = new Set(['www.xiaohongshu.com', 'xiaohongshu.com', 'xhslink.com']);
const NOTE_PATH = /^\/(?:explore|discovery\/item)\/([0-9a-f]{24})\/?$/i;
const TRACKING_PARAMS = /^(utm_|xsec_source$|source$|share_|app_platform$|app_version$|ignoreEngage$|author_share$|type$)/;
const ACCESS_PARAMS = new Set(['xsec_token']);

export type XhsNoteUrl = {
  noteId: string | null;
  /** Public identity: no tracking or access tokens. Safe for logs, keys and analytics. */
  canonicalUrl: string;
  /** Needed only for the provider request itself; never persist in logs or IDs. */
  accessUrl: string;
};

/** Spec F04/F15: strip tracking params; keep access tokens out of the canonical identity. */
export function normalizeXhsNoteUrl(input: string): XhsNoteUrl {
  const url = new URL(input);
  if (url.protocol !== 'https:' || !XHS_HOSTS.has(url.hostname.toLowerCase())) throw new UnsafeUrlError('not_xiaohongshu_url');
  const match = NOTE_PATH.exec(url.pathname);
  const noteId = match?.[1]?.toLowerCase() ?? null;

  const access = new URL(url.origin + url.pathname);
  for (const [k, v] of url.searchParams) if (!TRACKING_PARAMS.test(k)) access.searchParams.append(k, v);

  const canonical = noteId ? new URL(`https://www.xiaohongshu.com/explore/${noteId}`) : new URL(access.toString());
  for (const k of ACCESS_PARAMS) canonical.searchParams.delete(k);
  return { noteId, canonicalUrl: canonical.toString(), accessUrl: access.toString() };
}

/** Same-origin path under `prefix` for post-action redirects; anything else falls back (no open redirects). */
export function safeLocalPath(value: unknown, prefix: string): string {
  const v = typeof value === 'string' ? value : '';
  if (!v.startsWith('/') || v.startsWith('//') || v.includes('\\')) return prefix;
  const u = new URL(v, 'http://local.invalid');
  if (u.origin !== 'http://local.invalid' || !(u.pathname === prefix || u.pathname.startsWith(`${prefix}/`) || u.pathname.startsWith(`${prefix}?`))) return prefix;
  return u.pathname + u.search + u.hash;
}
