import { describe,it,expect } from 'vitest';
import { originalBrowserUrl } from '@xhs/security';

const id='a'.repeat(24);
describe('original browser destination',()=>{
  it.each(['explore','discovery/item'])('opens the same %s note on rednote preserving supplied sharing credentials',path=>{
    expect(originalBrowserUrl(`https://www.xiaohongshu.com/${path}/${id}?xsec_token=synthetic%2Btoken%3D&xsec_source=app_share&utm_source=test`)).toBe(`https://www.rednote.com/discovery/item/${id}?xsec_token=synthetic%2Btoken%3D&xsec_source=app_share`);
  });
  it('keeps the validated original site available without accepting an arbitrary target',()=>{
    const link=`https://www.xiaohongshu.com/explore/${id}?xsec_token=synthetic`;
    expect(originalBrowserUrl(link,'xiaohongshu')).toBe(link);
    expect(originalBrowserUrl(link,'https://evil.invalid')).toBeNull();
  });
  it.each([
    `https://evil.invalid/explore/${id}?xsec_token=x`,
    `https://www.xiaohongshu.com/login?redirectPath=https://evil.invalid`,
    `https://user:pass@www.xiaohongshu.com/explore/${id}?xsec_token=x`,
    `https://www.xiaohongshu.com:444/explore/${id}?xsec_token=x`,
    `https://www.xiaohongshu.com/explore/${id}`,
  ])('rejects unvalidated or tokenless destinations',link=>expect(originalBrowserUrl(link)).toBeNull());
});
