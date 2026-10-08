'use server';

import { AppError } from '@xhs/domain';
import { generateDictionaryAi, previewDictionaryAi, importDictionaryPlan, type DictionaryAiInput } from '@xhs/core';
import { revalidatePath } from 'next/cache';
import { ZodError } from 'zod';
import { withPageCtx } from '@/server/ctx';
import { getDictionaryAiConfig } from '@/server/dictionary-ai-config';
import { dictionaryAiFormFingerprint } from './dictionary-ai-form-fingerprint';

type Preview = Awaited<ReturnType<typeof previewDictionaryAi>>;
type Generation = Awaited<ReturnType<typeof generateDictionaryAi>>;

export type DictionaryAiState = {
  error?: string;
  preview?: Preview;
  previewFingerprint?: string;
  requestRevision?: string;
  generation?: Generation;
};

function knownError(error: unknown): string | null {
  if (error instanceof AppError) return error.messageKo;
  if (error instanceof ZodError) return `입력값을 확인하세요: ${error.issues.map((issue) => issue.message).slice(0, 3).join(' / ')}`;
  return null;
}

function inputFrom(form: FormData): DictionaryAiInput {
  return {
    entryIds: form.getAll('entryIds').map(String),
    category: String(form.get('category')) as DictionaryAiInput['category'],
    notes: String(form.get('notes') ?? ''),
    mode: String(form.get('mode')) as DictionaryAiInput['mode'],
    tone: String(form.get('tone')) as DictionaryAiInput['tone'],
    disclosure: String(form.get('disclosure')) as DictionaryAiInput['disclosure'],
    experienceConfirmed: form.get('experienceConfirmed') === 'on',
  };
}

export async function dictionaryAiAction(previous: DictionaryAiState, form: FormData): Promise<DictionaryAiState> {
  const intent = String(form.get('intent') ?? 'preview');
  const requestRevision = String(form.get('formRevision') ?? '');
  try {
    const config = getDictionaryAiConfig();
    const input = inputFrom(form);
    const previewFingerprint = dictionaryAiFormFingerprint(input);
    if (intent === 'generate') {
      if (!previous.preview || previous.previewFingerprint !== previewFingerprint || previous.requestRevision !== requestRevision) {
        return { ...previous, error: '입력이 변경되었습니다. 전송 내용과 비용을 다시 미리보기해 주세요.' };
      }
      if (form.get('externalConsent') !== 'on') return { ...previous, error: '외부 AI 전송과 비용 발생에 동의해야 실행할 수 있습니다.' };
      const token = String(form.get('token') ?? '');
      // Core uses the authenticated runner to commit reservation before the
      // external call, then opens a fresh transaction for usage settlement.
      const generation = await generateDictionaryAi(withPageCtx, { token, confirmed: true }, config);
      revalidatePath('/app/dictionary');
      return { preview: previous.preview, previewFingerprint, requestRevision, generation };
    }
    const preview = await withPageCtx((ctx) => previewDictionaryAi(ctx, input, config));
    return { preview, previewFingerprint, requestRevision };
  } catch (error) {
    if (intent === 'generate') revalidatePath('/app/dictionary');
    const message = knownError(error);
    if (message) return { ...previous, error: message };
    throw error;
  }
}

export async function dictionaryPlanAction(_previous: { error?: string; planId?: string }, form: FormData): Promise<{ error?: string; planId?: string }> {
  try {
    const payload = String(form.get('payload') ?? '');
    if (payload.length > 30000) return { error: '초안이 너무 깁니다.' };
    const input = JSON.parse(payload);
    const planId = await withPageCtx(ctx => importDictionaryPlan(ctx, {
      ...input, accountId: String(form.get('accountId') ?? ''), name: String(form.get('name') ?? ''),
      content: { ...input.content, title: String(form.get('title') ?? ''), cover: String(form.get('cover') ?? '') },
    }));
    revalidatePath('/app/plans');
    return { planId };
  } catch (error) {
    if (error instanceof SyntaxError) return { error: '초안 형식을 확인해 주세요.' };
    const message = knownError(error);
    if (message) return { error: message };
    throw error;
  }
}
