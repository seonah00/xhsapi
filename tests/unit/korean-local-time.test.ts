import { it, expect } from 'vitest';
import { koreanLocalTimeToIso } from '../../apps/web/src/components/korean-local-time.ts';
it('interprets local input as Korean time regardless of the server timezone', () => {
  expect(koreanLocalTimeToIso('2026-10-11T12:00')).toBe('2026-10-11T03:00:00.000Z');
  expect(koreanLocalTimeToIso('2026-11-01T00:00:01')).toBe('2026-10-31T15:00:01.000Z');
  expect(koreanLocalTimeToIso('')).toBeUndefined();
});
it('rejects invalid dates and unexpected timezone suffixes', () => {
  for (const value of ['2026-02-30T12:00','2026-10-12T25:00','2026-10-12T12:00Z','bad']) expect(()=>koreanLocalTimeToIso(value)).toThrow();
});
