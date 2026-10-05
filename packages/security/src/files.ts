export type SafeMime = 'image/jpeg' | 'image/png' | 'image/webp' | 'application/pdf';

export const MAX_FILE_BYTES = 10 * 1024 * 1024;
export const MAX_DIMENSION = 8000;
export const MAX_PIXELS = 40_000_000;

export class FileRejectedError extends Error {
  override name = 'FileRejectedError';
  constructor(readonly reason: 'too_large' | 'empty' | 'unsupported_type' | 'type_mismatch' | 'corrupt' | 'too_many_pixels') {
    super(reason);
  }
}

/** Detects type from magic bytes only; the declared MIME and file name are never trusted (spec 10.2). */
export function sniffMime(b: Uint8Array): SafeMime | null {
  if (b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return 'image/jpeg';
  if (b.length >= 8 && [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a].every((v, i) => b[i] === v)) return 'image/png';
  if (b.length >= 12 && ascii(b, 0, 4) === 'RIFF' && ascii(b, 8, 4) === 'WEBP') return 'image/webp';
  if (b.length >= 5 && ascii(b, 0, 5) === '%PDF-') return 'application/pdf';
  return null;
}

function ascii(b: Uint8Array, at: number, n: number): string {
  return String.fromCharCode(...b.subarray(at, at + n));
}
const u16be = (b: Uint8Array, i: number) => (b[i]! << 8) | b[i + 1]!;
const u32be = (b: Uint8Array, i: number) => ((b[i]! << 24) >>> 0) + (b[i + 1]! << 16) + (b[i + 2]! << 8) + b[i + 3]!;
const u32le = (b: Uint8Array, i: number) => b[i]! + (b[i + 1]! << 8) + (b[i + 2]! << 16) + ((b[i + 3]! << 24) >>> 0);
const u24le = (b: Uint8Array, i: number) => b[i]! + (b[i + 1]! << 8) + (b[i + 2]! << 16);

export type InspectedFile = { mime: SafeMime; bytes: Uint8Array; width: number | null; height: number | null; metadataStripped: boolean };

/**
 * Validates a user upload and returns a sanitized copy: images lose EXIF/XMP/text
 * metadata (location, device, author). Oversized dimensions are rejected before decoding.
 */
export function inspectUpload(input: Uint8Array, declared: string, allowed: readonly SafeMime[]): InspectedFile {
  if (input.length === 0) throw new FileRejectedError('empty');
  if (input.length > MAX_FILE_BYTES) throw new FileRejectedError('too_large');
  const mime = sniffMime(input);
  if (!mime || !allowed.includes(mime)) throw new FileRejectedError('unsupported_type');
  if (declared && declared !== mime) throw new FileRejectedError('type_mismatch');
  if (mime === 'application/pdf') return { mime, bytes: input, width: null, height: null, metadataStripped: false };
  const out = mime === 'image/jpeg' ? stripJpeg(input) : mime === 'image/png' ? stripPng(input) : stripWebp(input);
  if (!out.width || !out.height) throw new FileRejectedError('corrupt');
  if (out.width > MAX_DIMENSION || out.height > MAX_DIMENSION || out.width * out.height > MAX_PIXELS) throw new FileRejectedError('too_many_pixels');
  return { mime, bytes: out.bytes, width: out.width, height: out.height, metadataStripped: true };
}

type Stripped = { bytes: Uint8Array; width: number | null; height: number | null };

/** JPEG: drop APP1 (EXIF/XMP), APP13 (IPTC) and COM segments; read size from SOFn. */
function stripJpeg(b: Uint8Array): Stripped {
  const parts: Uint8Array[] = [b.subarray(0, 2)];
  let i = 2;
  let width: number | null = null;
  let height: number | null = null;
  while (i + 4 <= b.length) {
    if (b[i] !== 0xff) throw new FileRejectedError('corrupt');
    const marker = b[i + 1]!;
    if (marker === 0xd9) { parts.push(b.subarray(i)); i = b.length; break; }
    if (marker === 0xda) { parts.push(b.subarray(i)); i = b.length; break; } // start of scan: rest is image data
    if (marker >= 0xd0 && marker <= 0xd7) { parts.push(b.subarray(i, i + 2)); i += 2; continue; }
    const len = u16be(b, i + 2);
    if (len < 2 || i + 2 + len > b.length) throw new FileRejectedError('corrupt');
    const isSof = marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc;
    if (isSof && len >= 7) { height = u16be(b, i + 5); width = u16be(b, i + 7); }
    const drop = marker === 0xe1 || marker === 0xed || marker === 0xfe;
    if (!drop) parts.push(b.subarray(i, i + 2 + len));
    i += 2 + len;
  }
  return { bytes: concat(parts), width, height };
}

const PNG_DROP = new Set(['tEXt', 'zTXt', 'iTXt', 'eXIf', 'tIME']);
/** PNG: keep image chunks, drop text/EXIF/time chunks. */
function stripPng(b: Uint8Array): Stripped {
  const parts: Uint8Array[] = [b.subarray(0, 8)];
  let i = 8;
  let width: number | null = null;
  let height: number | null = null;
  while (i + 12 <= b.length) {
    const len = u32be(b, i);
    const type = ascii(b, i + 4, 4);
    const end = i + 12 + len;
    if (end > b.length) throw new FileRejectedError('corrupt');
    if (type === 'IHDR') { width = u32be(b, i + 8); height = u32be(b, i + 12); }
    if (!PNG_DROP.has(type)) parts.push(b.subarray(i, end));
    i = end;
    if (type === 'IEND') break;
  }
  return { bytes: concat(parts), width, height };
}

/** WebP: drop EXIF/XMP chunks, clear their VP8X flags and rewrite the RIFF size. */
function stripWebp(b: Uint8Array): Stripped {
  const chunks: Uint8Array[] = [];
  let i = 12;
  let width: number | null = null;
  let height: number | null = null;
  while (i + 8 <= b.length) {
    const fourcc = ascii(b, i, 4);
    const size = u32le(b, i + 4);
    const end = i + 8 + size + (size % 2);
    if (i + 8 + size > b.length) throw new FileRejectedError('corrupt');
    const chunk = b.slice(i, Math.min(end, b.length));
    if (fourcc === 'VP8X' && size >= 10) {
      chunk[8] = chunk[8]! & ~0x0c; // clear EXIF (0x08) and XMP (0x04) flags
      width = u24le(b, i + 12) + 1;
      height = u24le(b, i + 15) + 1;
    } else if (fourcc === 'VP8 ' && size >= 10 && width === null) {
      width = (b[i + 14]! | (b[i + 15]! << 8)) & 0x3fff;
      height = (b[i + 16]! | (b[i + 17]! << 8)) & 0x3fff;
    } else if (fourcc === 'VP8L' && size >= 5 && width === null) {
      const bits = u32le(b, i + 9);
      width = (bits & 0x3fff) + 1;
      height = ((bits >> 14) & 0x3fff) + 1;
    }
    if (fourcc !== 'EXIF' && fourcc !== 'XMP ') chunks.push(chunk);
    i = end;
  }
  const body = concat(chunks);
  const header = new Uint8Array(12);
  header.set(b.subarray(0, 12));
  const riffSize = body.length + 4;
  header[4] = riffSize & 0xff; header[5] = (riffSize >> 8) & 0xff; header[6] = (riffSize >> 16) & 0xff; header[7] = (riffSize >>> 24) & 0xff;
  return { bytes: concat([header, body]), width, height };
}

function concat(parts: Uint8Array[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let o = 0;
  for (const p of parts) { out.set(p, o); o += p.length; }
  return out;
}

/** Keeps only a harmless display name (no paths, control chars or HTML). */
export function safeFileName(name: string): string {
  const base = name.split(/[\\/]/).pop() ?? 'file';
  return base.replace(/[^\p{L}\p{N}._ -]/gu, '_').slice(0, 120) || 'file';
}
