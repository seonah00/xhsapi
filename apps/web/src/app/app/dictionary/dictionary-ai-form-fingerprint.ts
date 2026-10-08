import type { DictionaryAiInput } from '@xhs/core';

export function dictionaryAiFormFingerprint(input: DictionaryAiInput): string {
  return JSON.stringify({
    entryIds: [...input.entryIds].sort(),
    category: input.category,
    notes: input.notes,
    mode: input.mode,
    tone: input.tone,
    disclosure: input.disclosure,
    experienceConfirmed: input.experienceConfirmed,
  });
}
