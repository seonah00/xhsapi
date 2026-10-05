# P0 완료 보고 (M0~M4, mock 모드)

작성일: 2026-10-05 · 브랜치: `claude/vigilant-planck-61yogr` · 기준: `docs/XHS_STUDIO_DEVELOPMENT_SPEC.md` v1.1

`XHS_STUDIO_ACCEPTANCE_TESTS.md`는 저장소에 없습니다. 그래서 명세 F01~F15와 10~12장을 기준으로 대조했습니다(ADR 0005).

## 1. 구현된 기능 ID / 화면 / API

| ID | 내용 | 화면 | API·작업 |
|---|---|---|---|
| F01 | 데모 로그인(mock 전용), 조직 선택, 초대 링크(1회용·최대 7일·해시 저장), 역할(학생·강사·관리자) | `/login`, `/app/select-organization`, `/invite/[token]` | `GET /api/v1/me` |
| F02 | 내 계정 온보딩·계정 방향 버전 | `/app/accounts`, `/app/accounts/new`, `/app/accounts/[id]/settings` | `GET·POST /api/v1/accounts`, `GET·PATCH /api/v1/accounts/[id]` |
| F03 | 기본 주제·형식(고정) + 조직 분류 추가·비활성화 | `/admin/taxonomy` | `GET /api/v1/taxonomy` |
| F04 | 홈 맞춤 추천(이유 표시), 저장 자료 탐색(한→중 확장), 비교(최대 3), **외부 자료 새로 조회(견적→확인→작업, mock)** | `/app`, `/app/discover`, `/app/discover/compare` | `GET /api/v1/discover`, `POST /api/v1/saves`, `POST /api/v1/cost-quotes`, 작업 `provider_search` |
| F05 | 레퍼런스(노트·링크·텍스트), 분석(mock, 분석 범위 표시), 이미지 첨부, 공통 자료실(동의·검토·철회) | `/app/references`, `/app/references/new`, `/app/references/[id]`, `/app/library`, `/review/library` | `/api/v1/references*`, `/api/v1/assets*`, 작업 `reference_analysis` |
| F06 | 해시태그·키워드(출처·기간·표본 크기 표시) | `/app/keywords` | `GET /api/v1/keywords` |
| F07 | 중국어 표현 사전(문장 분석, 개인 표현, 강사 검수) | `/app/expressions`, `/review/expressions` | `GET /api/v1/expressions` |
| F08 | 기획실: 사실 입력, 자동 저장(충돌 감지), 버전, AI 제안(mock)·되돌리기, 최종본 전달·내보내기 | `/app/plans`, `/app/plans/new`, `/app/plans/[id]`, `/app/plans/[id]/handoff` | `PATCH /api/v1/plans/[id]/draft`, `GET·POST /api/v1/plans/[id]/versions`, `GET /api/v1/plans/[id]/export`, 작업 `plan_generation` |
| F09 | 발행 전 점검: 편집 규칙 + 기본 탐지기(UTF-16 위치) + AI 문맥(mock), 수정 제안 적용, 내용 바뀌면 stale | `/app/check`, 기획 화면 점검 탭, `/review/rules` | 작업 `contextual_check` |
| F10 | 강사 제출(제출한 버전만 공유), 공동 검토함, 피드백, 철회 | `/app/submissions`, `/app/submissions/[id]`, `/review/submissions`, `/review/submissions/[id]` | 서버 액션 |
| F11 | 발행 기록·지표 스냅샷(미확인≠0), 내 계정 안 비교, 회고(mock) | `/app/results`, `/app/results/[id]` | 작업 `results_reflection` |
| F12 | 관리자: 개요·멤버·초대·기수·감사, 공급자 허가·스위치·kill, 사용량·한도·예산·정산, 작업·취소 | `/admin/*` | `POST /api/v1/jobs/[id]/cancel`, `GET /api/v1/jobs/[id]` |
| F13 | P1 확장(OCR·댓글·CSV·자동 갱신) | — | 기본 비활성(계약만) |
| F14 | **참고 계정: 저장 자료 작성자 후보, 저장(내 계정과 분리), 상세(주제·형식 분포), 비교(최대 3)**. 공급자 성장 데이터는 "제공하지 않음" | `/app/reference-accounts`, `/app/reference-accounts/[id]` | 서버 액션 |
| F15 | 영상 음성 문안 추출(mock): 견적·작업·상태·말소리 없음·개인정보 가림·표현 저장. live 차단 | `/app/references/[id]/transcript` | `POST /api/v1/references/[id]/transcript-jobs`, `GET·DELETE /api/v1/references/[id]/transcript`, 작업 `transcript_submit/result` |
| 11장 | **오류·권리 신고**(대상 ID·사유·짧은 메모만), 권리·원본 신고 시 자료실 즉시 비공개, 강사 신고함(규칙별 오탐 집계) | 점검 결과·분석·음성 문안·자료실의 "신고", `/review/reports` | 서버 액션, `app.report_library_item` |
| 10장 | 데이터 삭제 요청(즉시 차단→삭제 작업), 만료 정리, 비공개 파일 메타데이터 제거 | `/app/privacy` | 작업 `user_deletion`, 매시간 `purgeExpired` |

마이그레이션: `supabase/migrations/20261005000001` ~ `20261005000011` (11개, 전부 RLS 적용). 결정 기록: `docs/adr/0001`~`0005`.

## 2. 로컬 실행과 데모 계정

```bash
pnpm install
pnpm db:local      # 임시 PostgreSQL(54329) + 마이그레이션 + 시드 + 합성 콘텐츠
pnpm dev:worker    # 다른 터미널
pnpm dev:web       # http://localhost:3000 → 로그인 화면에서 데모 계정 클릭(비밀번호 없음, mock 전용)
```

데모 계정: `student-a@demo.invalid`(설정 완료), `student-b@demo.invalid`(처음 시작), `reviewer@demo.invalid`(1기 강사), `reviewer-other-cohort@demo.invalid`(2기 강사), `admin@demo.invalid`(관리자), 다른 조직의 `student-c@other-org.demo.invalid`·`admin@other-org.demo.invalid`. 모두 가상 계정입니다.

운영·복구·삭제·live 전환 조건은 `docs/OPERATIONS.md`에 있습니다.

## 3. 실제 실행한 테스트 결과 (2026-10-05, 이 브랜치 최종 커밋 직전 실행)

| 명령 | 결과 |
|---|---|
| `pnpm typecheck` (TypeScript strict, exactOptionalPropertyTypes) | 통과 |
| `pnpm test` (단위·계약) | **85 통과** / 8 파일 |
| `pnpm test:db` (임시 PostgreSQL, RLS/IDOR·예산·idempotency·제약·서비스) | **103 통과** / 11 파일 |
| `pnpm test:e2e` (`next build` + `next start`, 워커, Chromium) | **11 통과** / 8 스펙 (접근성 포함) |
| E2E 외부 연결 검사 | 웹·워커 가드 활성 확인, 차단 시도 **0건**, 브라우저 요청은 모두 앱 출처 |
| `next build` (프로덕션) | 성공. 클라이언트 번들에서 비밀 변수명·DB URL·서버 전용 모듈이 검출되지 않음 |
| axe-core WCAG 2.1 A/AA | 화면 34개 + 어두운 테마 4개(총 38회 검사) 위반 0건 |
| `pnpm perf` (노트 10,033건) | 아래 표 |

범주별 검증 내용(명세 12.2):
- unit: 지표 파싱(`4w+` 하한·범위·미확인), 정규화, 규칙 검사·UTF-16 위치, 생성 결과의 근거 없는 숫자 탐지, 성과 비교(저장률은 조회수 있을 때만).
- contract: RedFox 레지스트리, RF14 응답 매핑, 문서에 없는 status 거부, 200+비정상 code 처리, 영상 다운로드(RFX1) 미등록.
- integration: 다른 학생·조직·미배정 강사·관리자의 비공개 초안 접근 차단, 제출 버전만 공유, 공유 철회, 견적 1회용·만료, 예산 잠금, idempotency 재생, 작업 임대, 삭제 작업, 신고 규칙 키 스냅샷.
- security: SSRF URL 검사, 샤오홍슈 URL 정규화(토큰 제거), 키·개인정보 마스킹, 위험 링크 스킴 제거, 신뢰할 수 없는 텍스트 경계 처리(프롬프트 인젝션), 업로드 검증(매직 바이트, EXIF/XMP/텍스트 제거, 압축 폭탄, SVG/HTML 거부), 사후 리다이렉트 동일 출처 검사.
- no-network: 키가 있어도 mock provider의 외부 요청 0건(단위), 런타임 가드로 fetch·http 차단(단위), E2E 전체에서 차단 로그 0건.

성능(명세 11장 파일럿 목표: 저장된 탐색 p95 2초, CRUD p95 1초, 노트 1만·동시 20명):

| 조회 (학생 1명, 15회, ms) | p50 | p95 |
|---|---|---|
| 탐색: 최신 | 80.9 | 97.8 |
| 탐색: q=护肤 | 106.4 | 118.6 |
| 탐색: q=스킨케어(한→중 확장) | 106.5 | 107.8 |
| 탐색: 주제+7일 | 29.0 | 36.6 |
| 해시태그(30일) | 67.8 | 96.1 |
| 참고 계정 후보 | 276.0 | 327.3 |
| 홈 | 96.4 | 110.0 |

동시 20명 × 혼합 조회 5회(100요청): p50 461ms · **p95 596ms**. 측정은 로컬 단일 머신의 DB 서비스 계층 기준이며, HTTP·렌더링 시간과 실제 호스팅 성능은 포함하지 않습니다.

### 실행하지 않았거나 해당 없음

- **린트**: ESLint 구성이 없어 실행하지 않았습니다(TypeScript strict 타입 검사만 수행).
- **수용 테스트 문서 매트릭스**: 문서가 없어 대조하지 못했습니다. 받으면 맞추겠습니다.
- **수동 접근성 점검**(스크린리더 실사용, 확대 200%)은 하지 않았습니다. 자동 검사와 키보드 기반 E2E 조작만 했습니다.
- **live 어댑터 실호출**: 하지 않았습니다(미검증).
- **실제 Supabase(Auth·Storage) 환경**: 로컬 호환 shim으로만 검증했습니다.
- 이전 단계 dev 서버 E2E에서 원인 미상의 브라우저 콘솔 오류가 두 번 관찰됐습니다. 재현되지 않았고, 이번 프로덕션 빌드 전체 실행에서는 나오지 않았습니다. 콘솔 오류는 계속 E2E 실패 조건으로 둡니다.

## 4. 핵심 화면 캡처

`docs/screenshots/` (E2E가 매번 다시 생성, 31장):
- 학생(데스크톱·모바일 360px): 홈, 탐색, 해시태그, 표현 사전, 계정 설정, 레퍼런스, 음성 문안, 견적 확인, 기획실, 점검, 성과, 자료실, 참고 계정 — `m1-*`, `m2-*`, `m3-*`, `m4-*-reference-accounts`.
- 관리자·강사: 멤버, 감사, 공급자·스위치, 사용량·한도, 분류 체계, 신고함 — `admin-*`, `m3-admin-*`, `m4-admin-*`.

모든 화면 상단에 "데모 데이터 · 실제 샤오홍슈 데이터 아님" 표시가 있고, 카드·분석·내보내기에도 데모 배지가 유지됩니다.

## 5. 남은 live 전환 조건·미검증 API·알려진 제한

- live 차단 이유(README): 단가 미확인(`price_unknown`), 공급자 허가 `pending`, live 예산 0, RF08·RF10 파라미터 미확인(`parameter_unverified`), RF13·RF14는 `TRANSCRIPT_ENABLED=false`, RFX1(영상 다운로드)은 제외되어 미구현.
- 미확인 문서: DCZW5V7A, 9UHXOXSF, tool/QPNFJRG1. 개발 환경에서 redfox.hk 접근이 막혀 내용을 확인하지 못했습니다. 확인 전에는 어댑터가 없습니다.
- 워커의 live 모드 연결은 P0 범위 밖입니다(live로 시작하면 거부).
- 로그인은 데모 로그인입니다. 실제 Supabase Auth 연동, 비공개 Storage 교체, 호스팅·백업 자동화는 배포 결정 후 진행합니다.
- 자발적 조직 탈퇴는 P0에서 제외했습니다(ADR 0005). 관리자 중지와 "내 데이터 삭제"로 대체합니다.
- CSP `script-src`에 `'unsafe-inline'`이 남아 있습니다(Next.js 인라인 스크립트). 배포 전 nonce 기반 CSP를 권합니다.
- 성능 수치는 로컬 측정입니다. 보장 SLA가 아닙니다.
- P1 기능(OCR·댓글·CSV·자동 갱신·추세)은 기본 비활성입니다.

## 6. 외부 호출·배포·메일·결제

- 외부 데이터 API·AI·OCR 호출: **없음**. mock 모드만 사용했고, 런타임 가드와 테스트로 0건을 확인했습니다. API 키는 사용·저장하지 않았습니다.
- 배포: **없음**. 로컬에서만 실행했습니다.
- 메일 발송: **없음**. 초대는 링크 복사 방식입니다.
- 결제: **없음**. 비용 원장은 mock(`demo`, 0원)으로만 기록합니다.
- 실제 학생 데이터나 샤오홍슈 쿠키·비밀번호는 수집하지 않았습니다. 모든 데이터는 합성 데이터이고 `.invalid` 도메인을 씁니다.
