import net from 'node:net';

/**
 * Mock-mode outbound guard (spec 12.2: no external requests in mock mode).
 * Patches net.Socket#connect, which fetch (undici), http/https, tls and pg all
 * go through, and refuses any TCP target that is not loopback, a unix socket
 * or an explicitly allowed host (the database). The refusal happens before DNS
 * resolution, so the host name never leaves the machine either.
 */
export type BlockedConnection = { host: string; port: number | null; at: string };
export type NetworkGuard = { blocked: readonly BlockedConnection[]; uninstall: () => void };

export const EXTERNAL_NETWORK_BLOCKED = 'EXTERNAL_NETWORK_BLOCKED';

let active: (NetworkGuard & { blocked: BlockedConnection[] }) | null = null;

export function isLoopbackHost(host: string): boolean {
  const h = host.toLowerCase().replace(/^\[|\]$/g, '');
  if (h === 'localhost' || h.endsWith('.localhost') || h === '::1' || h === '0:0:0:0:0:0:0:1') return true;
  const v4 = h.startsWith('::ffff:') ? h.slice(7) : h;
  return net.isIPv4(v4) && v4.startsWith('127.');
}

/** Hosts named in a connection string (`postgres://user@host:port/db` or `?host=/socket/dir`). */
export function hostsFromUrl(url: string | undefined): string[] {
  if (!url) return [];
  try {
    const u = new URL(url);
    const hosts = [u.hostname, ...u.searchParams.getAll('host')].filter((h) => h && !h.startsWith('/'));
    return [...new Set(hosts.map((h) => h.toLowerCase()))];
  } catch {
    return [];
  }
}

type Target = { host: string; port: number | null } | null; // null = unix socket / unknown shape → allowed

function targetOf(args: unknown[]): Target {
  let a = args[0];
  if (Array.isArray(a)) a = a[0]; // node-internal normalized args
  if (a && typeof a === 'object') {
    const o = a as { path?: string; host?: string; port?: number | string };
    if (o.path) return null;
    return { host: String(o.host ?? 'localhost'), port: o.port === undefined ? null : Number(o.port) };
  }
  if (typeof a === 'number' || (typeof a === 'string' && /^\d+$/.test(a))) {
    return { host: typeof args[1] === 'string' ? args[1] : 'localhost', port: Number(a) };
  }
  return null; // string path → unix socket
}

export function installMockNetworkGuard(opts: { allowHosts?: string[]; onBlock?: (c: BlockedConnection) => void } = {}): NetworkGuard {
  if (active) return active;
  const allow = new Set((opts.allowHosts ?? []).map((h) => h.toLowerCase()));
  const blocked: BlockedConnection[] = [];
  const original = net.Socket.prototype.connect;
  const patched = function (this: net.Socket, ...args: unknown[]) {
    const t = targetOf(args);
    if (t && !isLoopbackHost(t.host) && !allow.has(t.host.toLowerCase())) {
      const c = { host: t.host, port: t.port, at: new Date().toISOString() };
      blocked.push(c);
      opts.onBlock?.(c);
      const err = Object.assign(new Error(`외부 네트워크 차단(데모 모드): ${t.host}`), { code: EXTERNAL_NETWORK_BLOCKED });
      process.nextTick(() => this.destroy(err));
      return this;
    }
    return (original as (...a: unknown[]) => net.Socket).apply(this, args);
  };
  net.Socket.prototype.connect = patched as typeof original;
  active = {
    blocked,
    uninstall: () => {
      if (net.Socket.prototype.connect === (patched as typeof original)) net.Socket.prototype.connect = original;
      active = null;
    },
  };
  return active;
}
