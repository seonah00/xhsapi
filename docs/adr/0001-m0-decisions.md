# ADR 0001 — M0 decisions

Date: 2026-10-05. Status: accepted.

| # | Decision | Reason |
|---|---|---|
| 1 | Workspace packages export TypeScript sources directly (no build step) and are typechecked by one root `tsc -p tsconfig.json`. | Keeps M0 simple; Next.js (M1) can transpile workspace packages. |
| 2 | DB tests run on a throwaway local PostgreSQL 16 with `supabase/test/00_supabase_shim.sql` (auth.users, auth.uid(), anon/authenticated/service_role). | Supabase CLI is not installed in the dev environment. Migrations use only objects that real Supabase also provides, so they apply unchanged there. |
| 3 | Org isolation is enforced by composite `(org_id, id)` foreign keys plus RLS, not only API checks. | Spec 7: cross-org references must fail at the DB level. |
| 4 | Authorization helpers live in a private `app` schema as `SECURITY DEFINER` functions answering only for `auth.uid()`. | Avoids recursive RLS on membership tables. |
| 5 | Org admins have no policy on private student tables. | Spec 1.2: role alone never grants draft access. |
| 6 | Reviewer reads go through `app.reviewer_can_see_version/check` (active submission + active cohort reviewer). | Spec F10 explicit join; withdrawal revokes immediately. |
| 7 | Submissions have no UPDATE grant; state changes only via `app.withdraw_submission` / `app.add_feedback`. Withdrawal is allowed from every non-withdrawn state, including `feedback_complete`. | Spec F10 lists `→ withdrawn` without restricting the source state; withdrawing is the safer reading for the student. |
| 8 | `app.reserve_and_enqueue` performs quote consumption, budget locking (org row then user row), ledger, job and idempotency in one transaction; a per-key advisory lock serializes duplicates so replays return the same job. | Spec 7 / 9.1 / 9.2. |
| 9 | Live budget absent = zero; mock reservations write `demo` ledger rows with amount 0. | Spec 9.2. |
| 10 | Abbreviated metrics (`1.2万`) are stored as `estimated` with their rounding interval, not as an exact number. | Spec 5.3 / principle 5. |
| 11 | RF13/RF14 live adapter is implemented against the provider doc, but every RedFox endpoint ships with `priceStatus: unknown`, so the gate blocks all live calls. RF01/RF09 live methods refuse until a verified contract fixture exists. | Spec 5.2, 6.3. |
| 12 | RFX1 (video download) is registered only as `not_implemented / excluded`; no adapter, mock or UI. | Spec 1.1 change, 1.4 non-goal. |
| 13 | Demo fixtures use the reserved `.invalid` TLD for all URLs and emails. | Spec 12.1: nothing may look like a real account or note. |
