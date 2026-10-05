import { describe, expect, it } from 'vitest';
import { FileRejectedError, inspectUpload, safeFileName, sniffMime } from '@xhs/security';

const bytes = (...parts: (number[] | string)[]) => new Uint8Array(parts.flatMap((p) => (typeof p === 'string' ? [...p].map((c) => c.charCodeAt(0)) : p)));
const u32 = (n: number) => [(n >>> 24) & 255, (n >>> 16) & 255, (n >>> 8) & 255, n & 255];
const u16 = (n: number) => [(n >>> 8) & 255, n & 255];
const pngChunk = (type: string, data: number[]) => [...u32(data.length), ...[...type].map((c) => c.charCodeAt(0)), ...data, 0, 0, 0, 0];

function png(w: number, h: number, withText = true) {
  return bytes([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a],
    pngChunk('IHDR', [...u32(w), ...u32(h), 8, 2, 0, 0, 0]),
    withText ? pngChunk('tEXt', [...'Author\0student-a'].map((c) => c.charCodeAt(0))) : [],
    pngChunk('IDAT', [1, 2, 3]), pngChunk('IEND', []));
}
function jpeg(w: number, h: number) {
  const exif = [...'Exif\0\0GPS:37.5,127.0'].map((c) => c.charCodeAt(0));
  return bytes([0xff, 0xd8], [0xff, 0xe1, ...u16(exif.length + 2), ...exif], [0xff, 0xfe, ...u16(6), 0x68, 0x69, 0x21, 0x21],
    [0xff, 0xc0, ...u16(11), 8, ...u16(h), ...u16(w), 1, 1, 0x11, 0], [0xff, 0xda, ...u16(8), 1, 1, 0, 0, 63, 0], [9, 9, 9], [0xff, 0xd9]);
}

describe('inspectUpload', () => {
  it('strips PNG text metadata and reads dimensions', () => {
    const r = inspectUpload(png(640, 480), 'image/png', ['image/png']);
    expect(r).toMatchObject({ mime: 'image/png', width: 640, height: 480, metadataStripped: true });
    expect(Buffer.from(r.bytes).includes('student-a')).toBe(false);
  });

  it('strips JPEG EXIF (GPS) and comments', () => {
    const src = jpeg(1200, 800);
    expect(Buffer.from(src).includes('GPS')).toBe(true);
    const r = inspectUpload(src, 'image/jpeg', ['image/jpeg']);
    expect(r).toMatchObject({ width: 1200, height: 800 });
    expect(Buffer.from(r.bytes).includes('GPS')).toBe(false);
    expect(Buffer.from(r.bytes).includes('hi!!')).toBe(false);
    expect(sniffMime(r.bytes)).toBe('image/jpeg');
  });

  it('strips WebP EXIF/XMP chunks and clears VP8X flags', () => {
    const le32 = (n: number) => [n & 255, (n >>> 8) & 255, (n >>> 16) & 255, (n >>> 24) & 255];
    const le24 = (n: number) => [n & 255, (n >>> 8) & 255, (n >>> 16) & 255];
    const chunk = (cc: string, data: number[]) => [...[...cc].map((c) => c.charCodeAt(0)), ...le32(data.length), ...data, ...(data.length % 2 ? [0] : [])];
    const vp8x = chunk('VP8X', [0x0c, 0, 0, 0, ...le24(299), ...le24(199)]);
    const exif = chunk('EXIF', [...'GPS-LOCATION'].map((c) => c.charCodeAt(0)));
    const img = chunk('VP8L', [0x2f, 0, 0, 0, 0]);
    const body = [...[...'WEBP'].map((c) => c.charCodeAt(0)), ...vp8x, ...exif, ...img];
    const src = bytes('RIFF', le32(body.length), body);
    const r = inspectUpload(src, 'image/webp', ['image/webp']);
    expect(r).toMatchObject({ width: 300, height: 200 });
    expect(Buffer.from(r.bytes).includes('GPS-LOCATION')).toBe(false);
    expect(r.bytes[20]! & 0x0c).toBe(0);
    expect(Buffer.from(r.bytes).readUInt32LE(4)).toBe(r.bytes.length - 8);
  });

  it('rejects decompression bombs by header dimensions', () => {
    expect(() => inspectUpload(png(20000, 20000, false), 'image/png', ['image/png'])).toThrow(FileRejectedError);
  });

  it('rejects SVG/HTML, mismatched declared types, empty and oversized files', () => {
    expect(() => inspectUpload(bytes('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>'), 'image/svg+xml', ['image/png'])).toThrow(/unsupported_type/);
    expect(() => inspectUpload(bytes('<html><body>x</body></html>'), 'image/png', ['image/png'])).toThrow(/unsupported_type/);
    expect(() => inspectUpload(png(10, 10), 'image/jpeg', ['image/png', 'image/jpeg'])).toThrow(/type_mismatch/);
    expect(() => inspectUpload(new Uint8Array(), 'image/png', ['image/png'])).toThrow(/empty/);
    expect(() => inspectUpload(new Uint8Array(10 * 1024 * 1024 + 1), 'image/png', ['image/png'])).toThrow(/too_large/);
  });

  it('accepts PDF only where allowed', () => {
    const pdf = bytes('%PDF-1.4\n1 0 obj\n<<>>\nendobj\n%%EOF');
    expect(inspectUpload(pdf, 'application/pdf', ['application/pdf']).mime).toBe('application/pdf');
    expect(() => inspectUpload(pdf, 'application/pdf', ['image/png'])).toThrow(/unsupported_type/);
  });

  it('sanitizes file names', () => {
    expect(safeFileName('../../etc/passwd')).toBe('passwd');
    expect(safeFileName('<img src=x onerror=1>.png')).not.toMatch(/[<>=]/);
    expect(safeFileName('영수증 증빙.pdf')).toBe('영수증 증빙.pdf');
  });
});
