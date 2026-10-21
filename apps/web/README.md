# XHS web deployment

Production UI builds are triggered by changes under `/apps/web/**` on the connected
`claude/vigilant-planck-61yogr` branch. Shared operational procedures are in
[DEPLOY.md](../../docs/DEPLOY.md).

When Railway pauses builds, first check the current incident report. The
[2026-10-20 build incident](https://status.railway.com/incident/JUA1PC5H) explicitly
requires a new deployment trigger after recovery; pushes during that pause were
not queued. Do not redeploy an older active deployment to release newer UI code.

The student writing UI in commit `31c017c` passed type checks, lint, 230 unit,
201 database and 45 browser tests in
[CI 39533865480](https://github.com/seonah00/xhsapi/actions/runs/39533865480).
After retrying that release, confirm the new commit is active, check
`/api/health`, and inspect the dictionary, writing and results screens at desktop
and mobile widths. Production UI checks should not generate AI requests or
collect new posts.

Deployment recovery does not authorize changes to provider budgets, recurring
collection, subscription plans, or payment settings.
