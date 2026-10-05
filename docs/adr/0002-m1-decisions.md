# ADR 0002 — M1 decisions

Date: 2026-10-05. Status: accepted.

| # | Decision | Reason |
|---|---|---|
| 1 | Local login is a **demo login** (mock mode only, seeded `.invalid` users) with an HMAC-signed httpOnly session cookie. Every request re-checks membership in the DB and runs as `authenticated` with `auth.uid()` set, so RLS applies exactly as with Supabase sessions. | Supabase CLI/Auth is not available in the dev environment. Swapping in Supabase Auth only changes how the user id is obtained. `SESSION_SECRET` is required outside mock mode. |
| 2 | Business logic lives in `@xhs/core` (no Next imports) and takes a per-request `Ctx` (RLS transaction). Server-owned writes (quotes, ingestion, worker results) use a separate service runner. | Lets the same services be tested against Postgres without Next.js. |
| 3 | The worker polls `app_jobs` directly and claims rows with `app.claim_job` leases. pg-boss is not used yet. | `app_jobs` is already the source of truth (spec 9.1); polling avoids a second queue in P0. Revisit when job volume needs it. |
| 4 | Paid-style actions are two steps: server quote (scope, max cost, daily usage, 5-minute expiry) → confirm with a server-generated idempotency key. Mock quotes cost 0 and write `demo` ledger rows. | Spec F04 step 3, 9.2. |
| 5 | F15 transcripts are stored per reference (owner-only). Cross-user reuse of a paid result is deferred to P1. Live access URLs (with `xsec_token`) are never stored; mock uses the canonical demo URL. | Owner-only RLS; keeping tokens out of storage (spec F15). |
| 6 | Transcript UI polls the transcript run, not the submit job, because results arrive through a later `transcript_result` job. | Submit finishing ≠ result ready. |
| 7 | Editorial example sentences stay in `explanations.example` and are labelled “작성 예시”; `expression_evidence` holds only observed quotes (“관찰 사례”). | Spec F07. |
| 8 | Reference analysis in mock mode is a deterministic rule-based generator that reports scope and limitations; it is labelled “규칙 기반 데모 분석(AI 아님)”. | No AI calls in P0 mock; spec F05 scope rules. |
| 9 | “외부 자료 새로 조회” is shown but disabled in mock mode. Demo notes are loaded by `scripts/seed-demo.ts` through the same ingestion code the `provider_search` job uses. | Spec F04: external refresh needs admin approval and cost checks. |
| 10 | Production CSP forbids `eval`; development allows it for React dev tooling only. | React dev mode needs eval. |
