import { describe, expect, it } from 'vitest';
import { PlanContent, formatShot, sectionsOf, versionCheckHash, FactSheet } from '@xhs/core';

describe('shooting worksheet', () => {
  it('keeps old shots compatible and includes all preparation details in handoff text', () => {
    const old = PlanContent.parse({ shots: [{ scene: '입구', note: '낮에' }] });
    expect(old.shots[0]).toEqual({ scene: '입구', note: '낮에' });
    expect(formatShot(old.shots[0]!, 0)).toContain('[미촬영] 입구');
    const shot = PlanContent.parse({ shots: [{ scene: '입구', framing: '넓게', caption: '散步', supplies: '삼각대', completed: true }] }).shots[0]!;
    expect(formatShot(shot, 1)).toBe('2. [완료] 입구\n구도: 넓게\n자막: 散步\n준비물: 삼각대');
  });
  it('checks scene captions and invalidates checks when captions change, but not completion', () => {
    const a = PlanContent.parse({ subtitles: '본문 자막', shots: [{ scene: '입구', caption: '散步' }] });
    expect(sectionsOf(a).subtitles).toBe('본문 자막\n散步');
    const facts = FactSheet.parse({});
    const b = PlanContent.parse({ ...a, shots: [{ ...a.shots[0], completed: true }] });
    expect(versionCheckHash(a, facts)).toBe(versionCheckHash(b, facts));
    b.shots[0]!.caption = '바뀐 자막';
    expect(versionCheckHash(a, facts)).not.toBe(versionCheckHash(b, facts));
  });
  it('bounds preparation data and rejects nonboolean completion', () => {
    expect(PlanContent.safeParse({ shots: [{ scene: '', supplies: 'a'.repeat(501) }] }).success).toBe(false);
    expect(PlanContent.safeParse({ shots: [{ scene: '', completed: 'yes' }] }).success).toBe(false);
    expect(PlanContent.safeParse({ shots: Array.from({ length: 31 }, () => ({ scene: '' })) }).success).toBe(false);
  });
});
