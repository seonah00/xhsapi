import { describe, expect, it } from 'vitest';
import { DICTIONARY_UPLOAD_BODY_LIMIT, readDictionaryUpload } from '../../packages/core/src/dictionary-upload.ts';

const origin = 'https://studio.example.invalid';
function request(extra: Record<string, string> = {}) {
  const body = new FormData();
  body.set('label', 'synthetic import');
  body.set('dictionaryFile', new File(['{"tags":[],"expressions":[]}'], 'dictionary.json', { type: 'application/json' }));
  return new Request(`${origin}/admin/dictionary/import`, { method: 'POST', body, headers: { origin, ...extra } });
}

describe('bounded dictionary upload', () => {
  it('parses a same-origin multipart upload', async () => {
    const form = await readDictionaryUpload(request(), origin);
    expect(form.get('label')).toBe('synthetic import');
    expect((form.get('dictionaryFile') as File).name).toBe('dictionary.json');
  });
  it('rejects missing, cross-site, malformed and cross-protocol origins', async () => {
    for (const value of ['', 'https://other.invalid', 'not-an-origin', 'http://studio.example.invalid']) {
      await expect(readDictionaryUpload(request({ origin: value }), origin)).rejects.toMatchObject({ code: 'FORBIDDEN' });
    }
    await expect(readDictionaryUpload(request({ 'sec-fetch-site': 'cross-site' }), origin)).rejects.toMatchObject({ code: 'FORBIDDEN' });
  });
  it('rejects oversized declared or streamed request bodies before multipart parsing', async () => {
    await expect(readDictionaryUpload(request({ 'content-length': String(DICTIONARY_UPLOAD_BODY_LIMIT + 1) }), origin)).rejects.toMatchObject({ code: 'VALIDATION_FAILED' });
    const large = new Request(`${origin}/admin/dictionary/import`, {
      method: 'POST',
      headers: { origin, 'content-type': 'multipart/form-data; boundary=fixture' },
      body: new Uint8Array(DICTIONARY_UPLOAD_BODY_LIMIT + 1),
    });
    await expect(readDictionaryUpload(large, origin)).rejects.toMatchObject({ code: 'VALIDATION_FAILED' });
  });
});
