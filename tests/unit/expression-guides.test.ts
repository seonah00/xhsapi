import { expect, it } from 'vitest';
import { appendPractice, expressionGuide } from '../../apps/web/src/app/app/dictionary/expression-guides.ts';

it('offers original examples for supported terms and does not invent examples for unknown terms', () => {
  expect(expressionGuide('清透感')?.zh).toContain('清透感');
  expect(expressionGuide('7刷')?.avoid).toContain('일곱 번째');
  expect(expressionGuide('grwm')).toEqual(expressionGuide('GRWM'));
  expect(expressionGuide('미등록 표현')).toBeUndefined();
  expect(expressionGuide('constructor')).toBeUndefined();
});

it('appends practice without replacing existing body text', () => {
  expect(appendPractice('기존 본문', '  새 문장  ')).toBe('기존 본문\n새 문장');
  expect(appendPractice('', '새 문장')).toBe('새 문장');
});
