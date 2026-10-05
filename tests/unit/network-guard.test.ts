import { createServer, get } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { hostsFromUrl, installMockNetworkGuard, isLoopbackHost, type NetworkGuard } from '@xhs/security/network-guard';

describe('mock-mode outbound network guard (spec 12.2)', () => {
  let guard: NetworkGuard;
  const server = createServer((_req, res) => res.end('ok'));
  let port = 0;
  beforeAll(async () => {
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
    port = (server.address() as AddressInfo).port;
    guard = installMockNetworkGuard({ allowHosts: ['db.internal'] });
  });
  afterAll(() => { guard.uninstall(); server.close(); });

  it('blocks fetch to an external host before DNS', async () => {
    const err = await fetch('https://api.example.invalid/x').then(() => null, (e: Error & { cause?: { code?: string } }) => e);
    expect(err?.cause?.code).toBe('EXTERNAL_NETWORK_BLOCKED');
    expect(guard.blocked.some((b) => b.host === 'api.example.invalid')).toBe(true);
  });

  it('blocks node:http to external hosts and allows loopback', async () => {
    const ext = await new Promise<string>((r) => get('http://redfox.example.invalid/', () => r('connected')).on('error', (e: NodeJS.ErrnoException) => r(e.code ?? 'error')));
    expect(ext).toBe('EXTERNAL_NETWORK_BLOCKED');
    const res = await fetch(`http://127.0.0.1:${port}/`);
    expect(await res.text()).toBe('ok');
  });

  it('recognises loopback and database hosts', () => {
    expect(isLoopbackHost('localhost')).toBe(true);
    expect(isLoopbackHost('127.0.0.5')).toBe(true);
    expect(isLoopbackHost('[::1]')).toBe(true);
    expect(isLoopbackHost('10.0.0.1')).toBe(false);
    expect(hostsFromUrl('postgresql://u@db.internal:5432/x')).toEqual(['db.internal']);
    expect(hostsFromUrl('postgresql://postgres@localhost/x?host=/tmp/pg&port=1')).toEqual(['localhost']);
  });
});
