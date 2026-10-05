# ADR 0004 — M3 decisions (results, files, operations, library, deletion)

Date: 2026-10-05. Status: accepted.

| # | Decision | Reason |
|---|---|---|
| 1 | Result snapshots are append-only; every metric is nullable and missing values display as "미확인". Comparisons use each post's latest snapshot, medians, and a save rate only where the same snapshot has both saves and views. | Spec F11: no save rate without views; no 0-filling. |
| 2 | Reflection is a mock rule job over the student's selected own snapshots; it states limitations and never changes the account profile. | Spec F11. |
| 3 | Uploads: magic-byte sniffing (JPEG/PNG/WebP, PDF only for evidence), header dimension limits, and metadata stripping implemented in pure TS (JPEG APP1/APP13/COM, PNG text/eXIf/tIME, WebP EXIF/XMP + VP8X flags). No native image library. | Spec 10.2; avoids decoding untrusted images on the server. |
| 4 | Files live in private storage (local disk in dev; Supabase private Storage behind the same `ObjectStorage` interface later) and are served only by the app gateway, which re-authorizes every request via `app.asset_meta` (owner, admin for evidence, cohort reviewer only while the attaching submission is active). `no-store`, `nosniff`, sandbox CSP. | Spec F10 "gateway by default"; withdrawal revokes access immediately. |
| 5 | Org feature switches (ai / transcript / provider_search), a provider live switch and a kill switch are stored in `organizations.settings` with revision checks. They can only narrow what the environment allows, and are enforced both when quoting and again when the worker runs the job. Housekeeping jobs (deletion) ignore the kill switch. | Spec F12, 6.3. |
| 6 | Daily per-student limits are org settings (0–100) falling back to app defaults. Budgets are per currency, entered as decimal strings and stored as numeric. | Spec 7, 9.2. |
| 7 | Provider permission records are always created `pending`; approval requires an uploaded evidence file, an explicit confirmation and a named approver (DB constraint). | Spec 6.2: no automatic approval. |
| 8 | Unknown-outcome charges are reconciled only by an org admin with a written evidence note (`app.reconcile_usage`), never released silently. | Spec 8 reconcile endpoint. |
| 9 | Library publications are created by a SQL function from the current source row (not client-supplied content). Third-party text (`reference_only`) is never copied into the snapshot: only title, link, the student's memo and tags. Revoking consent, trashing or deleting the source hides every publication immediately. | Spec F05: immutable snapshot, consent, no redistribution of others' content. |
| 10 | Deletion: the request immediately revokes library sharing and withdraws active submissions; a `user_deletion` job then deletes the user's data in that org (including private files) in one transaction with `app.allow_purge`. Cost ledger, security audit and contract evidence files are retained and the request is marked `partially_retained` with the reason. Membership is kept; leaving the org is an admin action. | Spec 10.4. |
| 11 | Expired provider content, transcripts, idempotency keys and stale quotes are purged hourly by the worker; reads already hide expired rows regardless. | Spec 10.4. |
| 12 | DB integration tests run serially (`--no-file-parallelism`); tests that change org-wide settings/budgets use the second (isolation) org so file order cannot change results. | Vitest orders files by previous duration; shared state caused order-dependent flakes. |
