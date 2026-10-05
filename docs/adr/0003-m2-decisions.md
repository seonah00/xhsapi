# ADR 0003 — M2 decisions (plans, checks, review)

Date: 2026-10-05. Status: accepted.

| # | Decision | Reason |
|---|---|---|
| 1 | Plans have a mutable **working draft** (`plans.draft_json`, autosaved with a 1 s debounce and guarded by `plans.revision`). Immutable `plan_versions` are created by "버전 저장", by AI proposals (`kind = ai_proposal`) and when a proposal is applied. | Autosave every second must not create hundreds of immutable versions; checks and submissions need stable versions (spec F08, F10). |
| 2 | A proposal never changes the draft. Applying it replaces the draft and freezes a new edit version; older versions can be restored into the draft. | Spec F08: user must apply explicitly; undo stays possible. |
| 3 | Mock plan generation only recombines the student's facts and scenes. A guard rejects outputs with numbers not present in the facts or evidence ids not in the inputs; missing facts return questions instead of a draft. | Spec 0.9, 5.4. |
| 4 | Checks run on saved versions (or on ad-hoc text in `/app/check`). Rule + builtin detectors run synchronously; the AI contextual layer is a separate quoted job. If it fails the run stays `partial` and submission requires acknowledgement. | Spec F09, F10. |
| 5 | Builtin detectors (`builtin-v1`): phone/email, named school/kindergarten, numbers absent from the fact sheet, sponsorship mark missing/unknown. Digits inside a detected phone number are not reported twice. | Independent, explainable detectors; no copied third-party word lists. |
| 6 | `/app/check` returns results through the server-action response; the text is never placed in a URL (would reach logs/history) and only the hash + findings are stored. | Spec 10, 11: no private text in logs. |
| 7 | Suggestions apply only if the flagged span is still at the same offsets in the draft; otherwise the student edits manually. | Prevents silent wrong replacements. |
| 8 | Reviewer tools live under `/review/*` (queue, dictionary review, rules) so reviewers and admins share them; `/admin` nav links there. Students get 404. | Spec lists `/admin/expressions|rules`, but reviewers also curate (F07/F09); one location avoids exposing admin-only screens to reviewers. |
| 9 | Dictionary publishing is two-step (draft → reviewer_checked → published). Student personal entries stay private and are not in the review queue. | Spec F05/F07: no automatic sharing of private material. |
| 10 | Org rules start as drafts; activation sets `reviewed_at` and a 30-day `review_due_at`. Official/law classes need source URL + date (DB constraint). Built-in rules cannot be changed by orgs. | Spec F09 rule management. |
| 11 | Export is a GET download of the student's own version (ownership re-checked), labelled demo and "not a publish approval". | Spec F08 handoff. |
