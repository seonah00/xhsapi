import { z } from 'zod';

export const DataMode = z.enum(['mock', 'live']);
export type DataMode = z.infer<typeof DataMode>;

export const OrgRole = z.enum(['student', 'reviewer', 'org_admin']);
export type OrgRole = z.infer<typeof OrgRole>;

/** Spec F03 — topic slugs shown in the UI by default. */
export const TopicSlug = z.enum(['beauty', 'daily-life', 'parenting', 'food-places', 'travel-outing', 'fashion']);
export type TopicSlug = z.infer<typeof TopicSlug>;

export const FormatSlug = z.enum([
  'vlog', 'review', 'comparison', 'routine', 'how-to', 'information-list', 'story', 'photo-diary',
]);
export type FormatSlug = z.infer<typeof FormatSlug>;

/** Spec F05 + F15 (audio_transcript added in spec 1.1). */
export const AnalysisScope = z.enum([
  'metadata_only', 'body_only', 'cover_and_body', 'audio_transcript',
  'selected_frames', 'full_video', 'user_notes_only',
]);
export type AnalysisScope = z.infer<typeof AnalysisScope>;

/** Spec F06 keyword provenance. official_search_metric has no P0 creation path. */
export const KeywordProvenance = z.enum([
  'observed_tag', 'observed_phrase', 'provider_related_term', 'editorial_seed', 'ai_suggestion', 'official_search_metric',
]);
export type KeywordProvenance = z.infer<typeof KeywordProvenance>;

export const PlanStatus = z.enum(['draft', 'planned', 'filming', 'ready', 'user_marked_published', 'archived']);
export type PlanStatus = z.infer<typeof PlanStatus>;

export const CheckRunStatus = z.enum(['queued', 'running', 'completed', 'partial', 'failed']);
export type CheckRunStatus = z.infer<typeof CheckRunStatus>;

export const FindingType = z.enum([
  'absolute_or_exaggerated_claim', 'unsupported_health_claim', 'fact_mismatch', 'title_body_mismatch',
  'sponsorship_review_needed', 'personal_information', 'child_privacy', 'unrelated_tag',
  'language_awkwardness', 'source_uncertain',
]);
export type FindingType = z.infer<typeof FindingType>;

export const SubmissionStatus = z.enum(['submitted', 'in_review', 'changes_requested', 'feedback_complete', 'withdrawn']);
export type SubmissionStatus = z.infer<typeof SubmissionStatus>;

export const JobKind = z.enum([
  'provider_search', 'note_enrichment', 'rank_refresh', 'reference_analysis', 'query_expansion', 'plan_generation',
  'contextual_check', 'results_reflection', 'trend_aggregation', 'data_expiry', 'user_deletion',
  // P1 (F15 runs in mock during P0)
  'transcript_submit', 'transcript_result', 'ocr', 'comment_submit', 'comment_result', 'csv_import',
]);
export type JobKind = z.infer<typeof JobKind>;

export const JobState = z.enum([
  'queued', 'running', 'waiting_external', 'succeeded', 'partial', 'failed', 'cancelled', 'unknown_outcome',
]);
export type JobState = z.infer<typeof JobState>;

export const TranscriptStatus = z.enum([
  'queued', 'submitted', 'processing', 'succeeded', 'failed', 'no_speech', 'unknown_outcome',
]);
export type TranscriptStatus = z.infer<typeof TranscriptStatus>;

export const VerificationStatus = z.enum(['documented', 'sandbox_verified', 'live_verified', 'suspended', 'unavailable']);
export type VerificationStatus = z.infer<typeof VerificationStatus>;

export const ParamsStatus = z.enum(['documented', 'parameter_unverified', 'verified', 'not_implemented']);
export type ParamsStatus = z.infer<typeof ParamsStatus>;
