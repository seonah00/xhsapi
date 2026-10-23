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

보관·복구 변경은 CI39540149931에서 단위236/DB203/E2E46(485개) 및 모의 외부 연결0으로 검증했습니다. 운영에서는 기존 worker 콘솔의 동일 GET 전용 함수를 사용해 2026-10-21에1,366개 게시물 링크를 복구했고491개는 미확보로 남겼습니다. 주소 복구는 샤오홍슈 열림 보장이 아닙니다.

관리자 `/admin/original-links`는 기존 결과를 읽는 작업만 접수합니다. Apify 키는 기존 worker에 유지하며 웹에 복사하지 않습니다. 검색/상세 결과 종류별로 시작 위치0부터 진행하고, 표시된 다음 위치로 이어갑니다. 수집 실행·예산 예약·정기 수집 설정 변경은 하지 않습니다. 소스가 CI를 통과했어도 Railway의 Infrastructure Error로 빌더 시작 전에 실패하면 동일 검증 소스를 다시 배포하고 web/worker가 모두 최신 ACTIVE인지 확인합니다.


## Verified discovery release after the October 22 outage

Railway enabled Hobby builds at 2026-10-22 21:08 UTC. This documentation-only
trigger releases the already validated application commit `4dedffe` (ADR 0048).
CI 39577757415 and production-branch CI 39578473582 passed type checks, lint,
244 unit, 208 database and 46 browser tests. Confirm the new deployment becomes
ACTIVE before reporting that production discovery excludes unavailable originals.
Check all discovery pages and stored-search/category/sort filters using read-only
GET navigation. Preserve all notes and stored sharing links. Do not start paid
collection, change budgets, activate schedules, or retry unknown-outcome jobs.

## Console hydration fix (October 23)

Release validated core change `1fa1cac` together with stable Korean date rendering
from `84c75d5`. CI39885515498 passed type checks, lint, 249 unit, 208 database and
48 browser tests with no mock outbound attempts. Expression context clipping now
preserves emoji surrogate pairs across server HTML and RSC. This release record
triggers the web-only watch path because core changes alone do not match it.
Confirm fresh production category loads and reloads have no React418 errors.
No budget, collection, original-link data or scheduling policy changes.
