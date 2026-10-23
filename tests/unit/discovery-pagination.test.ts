import { describe, expect, it } from 'vitest';
import { discoveryPageLinks } from '../../apps/web/src/components/discovery-pagination.ts';

describe('discovery page navigation', () => {
  const cursor = (n: number) => Buffer.from(String(n)).toString('base64url');
  it('starts on page one without inventing a previous or next page', () => {
    expect(discoveryPageLinks(new URLSearchParams(), undefined, null)).toEqual({ page: 1, previous: null, next: null });
  });
  it('returns to the first page and preserves repeated search terms and filters', () => {
    const params = new URLSearchParams('q=防晒&topic=beauty&sort=saves&format=review&days=30&terms=甲&terms=乙&original=1&job=example');
    const links = discoveryPageLinks(params, cursor(50), cursor(100));
    const previous = new URL(links.previous!, 'https://studio.invalid');
    const next = new URL(links.next!, 'https://studio.invalid');
    expect(links.page).toBe(2);
    expect(previous.pathname).toBe('/app/discover');
    expect(previous.searchParams.has('cursor')).toBe(false);
    for (const key of ['q','topic','sort','format','days','terms','original','job']) {
      expect(previous.searchParams.getAll(key)).toEqual(params.getAll(key));
      expect(next.searchParams.getAll(key)).toEqual(params.getAll(key));
    }
    expect(next.searchParams.get('cursor')).toBe(cursor(100));
    expect(params.has('cursor')).toBe(false);
  });
  it('has a previous link but no next link on a final page', () => {
    const links = discoveryPageLinks(new URLSearchParams(), cursor(100), null);
    expect(links.page).toBe(3);
    expect(new URL(links.previous!, 'https://studio.invalid').searchParams.get('cursor')).toBe(cursor(50));
    expect(links.next).toBeNull();
  });
  it.each(['garbage', cursor(-50), cursor(Number.MAX_SAFE_INTEGER + 1)])('ignores an invalid cursor %s', value => {
    expect(discoveryPageLinks(new URLSearchParams(), value, null).page).toBe(1);
  });
});
