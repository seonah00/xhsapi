'use server';
import { createReport } from '@xhs/core';
import { AppError } from '@xhs/domain';
import { ZodError } from 'zod';
import { withPageCtx } from '@/server/ctx';

export type ReportState = { done?: boolean; error?: string };

/** Spec 11: sends only the target id and a short reason, never the student's full text. */
export async function reportAction(_prev: ReportState, f: FormData): Promise<ReportState> {
  const idx = String(f.get('findingIndex') ?? '');
  try {
    await withPageCtx((ctx) => createReport(ctx, {
      targetType: String(f.get('targetType')), targetId: String(f.get('targetId')), reason: String(f.get('reason')),
      ...(idx ? { findingIndex: Number(idx) } : {}), ...(String(f.get('note') ?? '').trim() ? { note: String(f.get('note')).trim() } : {}),
    }));
    return { done: true };
  } catch (e) {
    if (e instanceof AppError) return { error: e.messageKo };
    if (e instanceof ZodError) return { error: '신고 사유를 확인하세요(메모 200자 이내).' };
    throw e;
  }
}
