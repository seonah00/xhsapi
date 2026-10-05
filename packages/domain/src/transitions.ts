import type { JobState, SubmissionStatus } from './enums.ts';

const JOB: Record<JobState, readonly JobState[]> = {
  queued: ['running', 'cancelled'],
  running: ['waiting_external', 'succeeded', 'partial', 'failed', 'unknown_outcome'],
  waiting_external: ['running', 'succeeded', 'partial', 'failed', 'cancelled', 'unknown_outcome'],
  succeeded: [],
  partial: [],
  failed: [],
  cancelled: [],
  // Only an operator reconciliation (with billing evidence) may resolve this.
  unknown_outcome: ['succeeded', 'failed'],
};

const SUBMISSION: Record<SubmissionStatus, readonly SubmissionStatus[]> = {
  submitted: ['in_review', 'withdrawn'],
  in_review: ['changes_requested', 'feedback_complete', 'withdrawn'],
  changes_requested: ['in_review', 'withdrawn'],
  feedback_complete: ['withdrawn'],
  withdrawn: [],
};

export function canTransitionJob(from: JobState, to: JobState): boolean {
  return JOB[from].includes(to);
}

export function canTransitionSubmission(from: SubmissionStatus, to: SubmissionStatus): boolean {
  return SUBMISSION[from].includes(to);
}
