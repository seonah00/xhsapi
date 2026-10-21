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
# 기존 공유주소 복구

관리자 `/admin/original-links`는 기존 결과를 읽는 작업만 접수합니다. Apify 키는 기존 worker에 유지하며 웹에 복사하지 않습니다. 검색/상세 결과 종류별로 시작 위치0부터 진행하고, 표시된 다음 위치로 이어갑니다. 수집 실행·예산 예약·정기 수집 설정 변경은 하지 않습니다. 소스가 CI를 통과했어도 Railway의 Infrastructure Error로 빌더 시작 전에 실패하면 동일 검증 소스를 다시 배포하고 web/worker가 모두 최신 ACTIVE인지 확인합니다.

