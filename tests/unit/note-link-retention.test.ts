import { expect, it, vi } from 'vitest';
import { storeNoteAccessLink, type Db } from '@xhs/core';

it('stores a shared link for the lifetime of its note rather than 24 hours', async () => {
  const query = vi.fn().mockResolvedValue({ rows: [], rowCount: 1 });
  await storeNoteAccessLink({ query } as unknown as Db, 'org', 'note', 'a'.repeat(24), `https://www.xiaohongshu.com/explore/${'a'.repeat(24)}?xsec_token=fixture`);
  expect(query.mock.calls[0]![0]).not.toContain("interval '24 hours'");
  expect(query.mock.calls[0]![0]).toContain('null');
});
