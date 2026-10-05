'use server';
import { getCheck, runCheck, type Finding } from '@xhs/core';
import { AppError } from '@xhs/domain';
import { ZodError } from 'zod';
import { service, withPageCtx } from '@/server/ctx';

export type CheckState = { runId?: string; findings?: Finding[]; sections?: { title: string; cover: string; body: string; subtitles: string; tags: string[] }; error?: string };

/** Result returns in the action response; the student's text never goes into a URL or log. */
export async function checkAction(_prev: CheckState, f: FormData): Promise<CheckState> {
  const sections = {
    title: String(f.get('title') ?? ''), cover: String(f.get('cover') ?? ''), body: String(f.get('body') ?? ''), subtitles: String(f.get('subtitles') ?? ''),
    tags: String(f.get('tags') ?? '').split(/[,，\s]+/).map((t) => t.replace(/^#/, '')).filter(Boolean),
  };
  try {
    const { runId, findings } = await withPageCtx(async (ctx) => {
      const id = await runCheck(ctx, service, { sections, facts: { sponsorship: String(f.get('sponsorship') ?? 'unknown') } });
      return { runId: id, findings: (await getCheck(ctx, id)).findings };
    });
    return { runId, findings, sections };
  } catch (e) {
    if (e instanceof AppError) return { error: e.messageKo, sections };
    if (e instanceof ZodError) return { error: '입력 길이를 확인하세요(제목·표지 100자, 본문 10,000자).', sections };
    throw e;
  }
}
