import { createHash } from 'node:crypto';

/** Canonical JSON with sorted object keys. String contents are not normalized (spec 7: offsets must survive). */
export function canonicalJson(value: unknown): string {
  return JSON.stringify(sortKeys(value));
}

function sortKeys(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortKeys);
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const key of Object.keys(value).sort()) {
      const v = (value as Record<string, unknown>)[key];
      if (v !== undefined) out[key] = sortKeys(v);
    }
    return out;
  }
  return value;
}

export function sha256Hex(input: string): string {
  return createHash('sha256').update(input, 'utf8').digest('hex');
}

export type CheckSections = {
  title?: string | undefined;
  cover?: string | undefined;
  body?: string | undefined;
  tags?: readonly string[] | undefined;
  subtitles?: string | undefined;
};

/** Spec 7: check_input_hash = checked fields + fact sheet + sponsorship flag. */
export function checkInputHash(sections: CheckSections, factSheet: unknown, sponsorship: 'yes' | 'no' | 'unknown'): string {
  const { title, cover, body, tags, subtitles } = sections;
  return sha256Hex(canonicalJson({ sections: { title, cover, body, tags, subtitles }, factSheet, sponsorship }));
}

export function contentHash(content: unknown): string {
  return sha256Hex(canonicalJson(content));
}
