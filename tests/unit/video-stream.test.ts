import { expect,it } from 'vitest';
import { safeVideoStreamUrl } from '@xhs/security';
import { parseZenStudioNote } from '../../packages/providers/src/apify/note-detail.ts';
const id='aaaaaaaaaaaaaaaaaaaaaaaa';
it('only permits provider transcoded MP4 streams over HTTPS',()=>{
 expect(safeVideoStreamUrl('http://sns-v11.rednotecdn.com/stream/1/test.mp4')).toBe('https://sns-v11.rednotecdn.com/stream/1/test.mp4');
 for(const url of ['https://evil.test/stream/a.mp4','https://sns-v11.rednotecdn.com.evil.test/stream/a.mp4','https://user:pass@sns-v11.rednotecdn.com/stream/a.mp4','https://sns-v11.rednotecdn.com:444/stream/a.mp4','https://sns-v11.rednotecdn.com/original/a.mp4','javascript:alert(1)']) expect(safeVideoStreamUrl(url)).toBeNull();
});
it('selects only validated h264 and accepts missing video metadata',()=>{
 const parse=(video:unknown,type='video')=>parseZenStudioNote([{id,type,video}],id).videoStreamUrl;
 expect(parse({streams:[{codec:'h265',url:'https://sns-v11.rednotecdn.com/stream/a.mp4'},{codec:'h264',url:'https://evil.test/a.mp4'},{codec:'h264',url:'https://sns-v11.rednotecdn.com/stream/b.mp4'}]})).toBe('https://sns-v11.rednotecdn.com/stream/b.mp4');
 expect(parse(undefined)).toBeNull();expect(parse({streams:'invalid'})).toBeNull();
 expect(parse({streams:[{codec:'h264',url:'https://sns-v11.rednotecdn.com/stream/b.mp4'}]},'image')).toBeNull();
});
