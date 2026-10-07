# 인계 문서 (2026-10-07 기준)

다른 에이전트(Codex 등)나 사람이 이어서 작업할 때 먼저 읽는 문서입니다. 규칙은 `AGENTS.md`, 제품 명세는 `docs/XHS_STUDIO_DEVELOPMENT_SPEC.md`, 최초 지시는 `docs/CODEX_START_PROMPT.md`, 결정 기록은 `docs/adr/0001~0010`에 있습니다.

## 1. 현재 상태

- 브랜치: `claude/vigilant-planck-61yogr`. 원격 브랜치는 이것 하나이고 `main`은 없습니다.
- 배포: 운영자가 직접 배포했습니다(Railway web + worker, Supabase Postgres·Auth·Storage). 절차는 `docs/DEPLOY.md`에 있습니다. 이 브랜치에 푸시하면 Railway가 자동으로 재배포합니다.
- 운영자가 실제로 확인한 것:
  - 배포·DB: 마이그레이션 적용, `verify.sql` 전부 ok
  - 계정: 첫 관리자 생성, 로그인, 초대 가입
  - 파일: 비공개 Storage 업로드
  - 외부 호출: worker live 모드에서 RF01 검색 1건, RF02 검색 1건 성공(정산 0.06 CNY/회)
- live 설정(운영 DB):
  - 단가: RF01과 RF02가 0.06 CNY/call로 verified
  - 허가: 승인된 허가는 RF02 하나이고, 수집·메타데이터 표시·미디어 표시가 켜져 있음
  - 예산: 조직 1 CNY/월
  - 키: `REDFOX_API_KEY`는 worker 서비스 변수에만 있음
- 테스트(마지막 실행 기준):

  | 명령 | 결과 |
  |---|---|
  | `pnpm test` (단위) | 102개 통과 |
  | `pnpm test:db` | 128개 통과 |
  | `pnpm test:e2e` (기본) | 12개 통과 |
  | `E2E_AUTH=supabase bash scripts/e2e.sh` | 1개 통과 |

  모두 외부 연결 시도 0건입니다.

## 2. 구조 요약

| 위치 | 내용 |
|---|---|
| `apps/web` | Next.js 16 App Router. 화면·서버 액션·`/api/v1`. CSP는 `src/proxy.ts`(nonce) |
| `apps/worker` | `app_jobs` 폴링·임대 실행. live면 RedFox 어댑터 사용 |
| `packages/core` | 도메인 서비스(견적·예약·작업·정산·live 게이트 상태·탐색·업로드·삭제 등) |
| `packages/providers` | mock/RedFox 어댑터, 엔드포인트 목록(`capabilities.ts`), 게이트(`gate.ts`), 응답 스키마 |
| `packages/domain` | env 검증(`env.ts`), 지표 파싱, 분류 |
| `packages/security` | URL 안전성(`safeCoverUrl`, `coverExpired` 포함), 마스킹, 외부 연결 가드 |
| `supabase/migrations` | 스키마·RLS·함수. 새 마이그레이션 뒤에는 `pnpm db:sql`로 `deploy/supabase/initial-schema.sql`을 재생성(테스트가 검사함) |
| `scripts/start.mjs` | 운영 진입점. web은 마이그레이션 → 서버, worker는 `XHS_SERVICE=worker` 또는 Railway 서비스 이름에 worker |

비용이 드는 작업은 항상 **견적(5분·1회용) → 학생 동의 → `app.reserve_and_enqueue`(예산 예약) → worker 실행 → 정산** 순서입니다. 성공은 settled, 보내기 전 실패나 non-2xx는 released, 응답 유실은 unknown_outcome(재전송 금지)입니다.

## 3. 알려진 문제와 보완 후보 (우선순위 순)

1. **표지 이미지가 안 보임**: RF02(优质库)가 주는 `coverUrl`의 `t=`(서명 만료) 값이 이미 지나 있어 CDN이 403을 줍니다. 앱은 만료 표지를 요청하지 않고 내부 썸네일을 보여 줍니다(ADR 0010).
   - 남은 경로: RedFox에 최신 서명 주소를 받을 방법이 있는지 문의.
   - 하지 말 것: 우회, 스크래핑, `videoDownload/xhs`(워터마크 제거 다운로드).
2. **원문 링크 오류**: RF01/RF02 링크에 `xsec_token`이 없어 샤오홍슈가 막을 수 있습니다. 카드에 "제목으로 찾기"를 추가해 두었습니다.
3. **live 노트의 주제 분류가 비어 있음**: 어댑터가 `topics: []`를 반환하므로, 탐색의 "주제" 필터가 live 노트에서는 동작하지 않습니다. 분류 규칙(`packages/domain`)을 live 노트에도 적용할지 결정이 필요합니다.
4. **RF08(계정 노트 목록)·RF10(인기 계정)**: 파라미터 이름은 공식 Python SDK(`github.com/redfox-data/redfox-python-sdk`)에 나옵니다.
   - RF08: `redId|userid, offset, sortType, publishTimeStart/End`
   - RF10: `dateType, rankDate, type`

   응답 예시와 단가를 받기 전까지 `parameter_unverified`로 막아 둡니다.
5. **RF09(노트 상세)** 어댑터가 미구현이고 `ProviderNotReadyError`를 던집니다. 문서 기준 필드는 RF02와 같습니다.
6. **RF13/RF14(음성 문안) 단가 미확인**: 실행하려면 단가 등록과 `TRANSCRIPT_ENABLED=true`가 필요합니다. 이제 RF02가 노트 형식(영상/이미지)을 주므로 영상 노트를 고를 수 있습니다.
7. **배포 중 서버 액션 불일치**: 재배포 전에 열어 둔 페이지에서 버튼을 누르면 "Server Action not found"가 납니다. Next `deploymentId`(빌드 시 커밋 SHA)로 스큐 보호를 검토할 만합니다. 미구현입니다.
8. **지연**: Railway와 Supabase 지역이 다르면 요청마다 왕복 지연이 쌓입니다(운영 설정 문제). 탐색 페이지의 쿼리 수 줄이기도 후보입니다.
9. **운영 미확인 항목**: 보안 헤더, 관리자 비밀번호 재설정 링크, 학생 데이터 삭제를 실제 환경에서 아직 확인하지 않았습니다(`docs/DEPLOY.md` 점검 절차).
10. **백업 자동화 없음**: `docs/OPERATIONS.md` §5 권고만 있습니다.
11. **오래된 문서**: `docs/P0_REPORT.md` 일부(로컬 shim 기준 설명)는 배포 이전 시점의 서술입니다. 최신 사실은 이 문서와 ADR 0009·0010입니다.
12. **미확인 RedFox 문서**: DCZW5V7A, 9UHXOXSF, tool/QPNFJRG1. 수용 테스트 문서도 받지 못했습니다.

## 4. 작업 방법

- 로컬 DB: `pnpm db:local`(임시 Postgres). 웹 `pnpm dev:web`, 워커 `pnpm dev:worker`.
- 커밋 전에는 `pnpm typecheck && pnpm lint && pnpm test && pnpm test:db`를 실행합니다. 화면이 바뀌면 `pnpm test:e2e`도 실행합니다. E2E는 `docs/screenshots`를 다시 만들므로, 의도한 변경이 아니면 되돌립니다(`git checkout -- docs/screenshots`).
- 외부 응답 형식이 바뀌면 단위 계약 테스트(`tests/unit/rf0*-contract.test.ts`)와 `tests/integration/live-flow.test.ts`에 가짜 응답으로 반영합니다. 실제 응답 원문(닉네임·ID 포함)은 저장소에 넣지 않습니다. 가공한 fixture만 넣습니다.
