# Apify 보완 구현 검증 (2026-10-07)

## 실행 결과

- TypeScript: `node node_modules/typescript/bin/tsc -p tsconfig.json --pretty false` 통과.
- ESLint: `node node_modules/eslint/bin/eslint.js . --max-warnings 0` 통과.
- 단위: `node node_modules/vitest/vitest.mjs run --project unit` — 15개 파일, 135개 테스트 통과.
- 프로덕션 빌드: `apps/web`에서 `NEXT_TELEMETRY_DISABLED=1 node node_modules/next/dist/bin/next build` 통과. 기존 `pg-config.ts`의 동적 파일 경로 추적 경고 2건은 남아 있습니다.
- 초기 SQL: `node node_modules/tsx/dist/cli.mjs scripts/db-migrate.ts --write-sql` 재생성 완료.
- `git diff --check` 통과.

pnpm 실행 파일의 의존성 설치 문제를 피하려고 설치된 도구 진입점을 직접 실행했습니다. 위 명령은 package.json의 typecheck/lint/test/build와 같은 도구·설정을 사용합니다.

## 프로세스 내부 PostgreSQL 핵심 SQL 검증

PGlite 0.5.8을 저장소 밖 임시 디렉터리에 설치하고 다음 smoke를 실행해 통과했습니다. 제품 의존성에는 추가하지 않았습니다.

```bash
PGLITE_MODULE=/absolute/path/to/@electric-sql/pglite/dist/index.js node --import tsx tests/support/pglite-collection-smoke.mjs
```

검증한 항목:

- 전체 마이그레이션(00016 포함)과 seed 적용
- 견적·작업 범위 변조 차단
- RF02 가짜 응답 3페이지(0/20/40)에서 60건 저장, 화면 쿼리 50+10건 조회
- 5페이지 예약 후 실제 3페이지 비용 정산 및 나머지 예약 해제
- Apify 2건 총견적·실행당 상한, 다음 노트부터 재개, 안전한 표지 URL 표시 쿼리
- 조직 RLS 격리, 학생의 직접 삭제 거부, 허가 철회 시 표지 숨김
- 전송 전 취소의 예약 해제, 처리 후 취소의 unknown_outcome 보존
- 동의 철회 시 미전송, USD 예산 초과 시 예약 거부

PGlite는 PostgreSQL을 프로세스 안에서 실행하므로 native 서버 공유 메모리나 외부 연결을 요구하지 않습니다. 이 스크립트는 사용자 SQL을 역할별 트랜잭션으로 실행하지만 실제 connection pool 동시성·전체 서비스 트랜잭션 구조·브라우저를 재현하지 않습니다. 전체 DB 통합 테스트와 E2E를 대체하지 않습니다.

## 아직 통과하지 않은 검증

로컬 PostgreSQL 16을 준비했지만 운영체제 sandbox가 공유 메모리 생성(`shmget`)을 거부했습니다. 다음 명령은 DB 초기화에서 종료되었으며 테스트 본문을 실행하지 못했습니다.

- `PGBIN=<로컬 PostgreSQL bin> bash scripts/with-test-db.sh node node_modules/vitest/vitest.mjs run --project db --no-file-parallelism`
- `PGBIN=<로컬 PostgreSQL bin> bash scripts/e2e.sh tests/e2e/apify-enrichment.spec.ts`

이번 50건 수집 작업에서도 native DB 실행은 같은 이유로 실패했습니다. 새 브라우저 테스트는 이 선행 조건 때문에 실행하지 못했습니다.

오류: `FATAL: could not create shared memory segment: Operation not permitted`.

사용 가능한 PostgreSQL 환경에서 **전체 `pnpm test:db`와 `pnpm test:e2e`를 실행하고 통과시킨 뒤 배포**해야 합니다. 통합 테스트에는 견적/동의/단일 예약, 원본 유지, RLS 조직 격리, 허가 만료·철회, TTL 삭제, 응답 유실 후 재전송 방지, 동의 철회, 예산 초과, 대상 변조 차단을 추가했습니다. 이 테스트들이 통과했다고 주장하지 않습니다.

## 외부 호출과 보존 범위

RedFox·Apify Actor·AI 등 실제 서비스 실행 API는 호출하지 않았습니다. 공급자 검증은 가짜 fetch와 합성 JSON만 사용했습니다. 전체 단위 테스트는 처음에 루프백 포트 권한으로 실패했으나 세션 네트워크 권한을 받은 뒤 135개 모두 재실행하여 통과했습니다. 공개 문서 확인과 개발 의존성 다운로드만 수행했습니다. 사용자 제공 원문 데이터·닉네임·접근 토큰은 저장소에 복사하지 않았습니다.

운영 DB 변경, API 키 등록, 실제 가격 등록, 푸시, 배포는 하지 않았습니다. 실제 표지 CDN 응답과 Actor 비용은 아직 확인하지 않았습니다. 현재 구현은 기본 비활성입니다.


## TDD 기록

새 페이지 offset 전달·잘못된 offset 차단, 중복 제거/목표/상한/빈 페이지 종료, 다중 보완 대상 검증에 대한 테스트를 먼저 추가했습니다. 처음에는 새 함수 미구현 및 offset이 항상 0인 동작으로 5개 실패를 확인했습니다. 구현 후 통과했고, 워커 진행 기록·응답 유실 시 재전송 차단·중간 중지 테스트를 더했습니다. 최종 135개 단위 테스트가 통과했습니다. native DB/E2E가 남아 있으므로 AGENTS의 매 커밋 검증 조건에 따라 커밋·푸시하지 않았습니다.

# Zen Studio 전환 검증 (2026-10-07)

- AP01을 zen-studio/rednote-note-detail-scraper로 변경했습니다.
- 노트 ID 1개, 미디어·자막 다운로드 옵션 모두 false, 고정 빌드·실행 비용 상한·재시도 금지 유지.
- 실제 사용자 응답 파싱 성공, images[0].url_pre 보존 확인. 원문 응답은 저장소에 넣지 않았습니다.
- 실제 미리보기 GET 200 / WebP 재확인. t가 지난 뒤에도 성공해 t를 만료 시각으로 단정하던 오류를 제거했습니다. DB TTL과 브라우저 실패 대체 표시는 유지합니다.
- TypeScript, ESLint, 단위 136개 통과. PGlite 전체 마이그레이션+수집·정산·RLS smoke 통과. Next.js 프로덕션 빌드 통과(기존 pg-config 파일 추적 경고 2개).
- PGlite는 native PostgreSQL 전체 통합 테스트를 대체하지 않습니다. native PostgreSQL/E2E는 기존 공유 메모리 실행 제한으로 미검증입니다.
- 운영 배포와 50개 실제 API 수집은 수행하지 않았습니다.

## 배포 준비 사항

마이그레이션 17 적용 시 AP01 가격은 unknown으로 돌아갑니다. 새 Actor의 고정 빌드를 web/worker APIFY_ACTOR_BUILD에 설정하고, 새 Actor 근거로 USD/run 상한을 재등록해야 합니다. 기존 SocialDataX 빌드 번호·가격을 재사용하지 마세요. 새 견적과 apify-zen-detail-v1 동의가 필요합니다. APIFY_TOKEN은 기존 worker secret을 사용합니다.
