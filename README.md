# Xiaohongshu Content Studio

한국어 수강생이 샤오홍슈 계정 방향을 잡고, 레퍼런스·해시태그·중국어 표현을 찾아 본인의 기획과 문안을 만들고, 표현 점검·강사 피드백·성과 기록까지 진행하는 교육용 웹서비스입니다.

- 명세: [`docs/XHS_STUDIO_DEVELOPMENT_SPEC.md`](docs/XHS_STUDIO_DEVELOPMENT_SPEC.md) (v1.1)
- 결정 기록: [`docs/adr/`](docs/adr/)
- 기본은 **mock 모드**입니다. 외부 데이터 API·AI·메일·결제 호출은 하지 않습니다. API 키가 있어도 live로 바뀌지 않습니다.

## 진행 상태

| 단계 | 상태 |
|---|---|
| M0 기초·권한 경계 | 완료: 패키지 골격, DB 마이그레이션·RLS, 데모 시드, mock provider, live 게이트, 테스트 |
| M1 발견·저장 | 완료: 데모 로그인, 계정 온보딩, 홈 추천, 탐색·비교, 레퍼런스·분석, F15 음성 문안(mock), 해시태그, 표현 사전 |
| 관리자 1단계 | 완료: `/admin` 개요, 멤버(역할 변경·중지, 확인 필수), 초대 링크(1회용·최대 7일·해시 저장), 기수(생성·보관·학생/강사 배정), 감사 기록 |
| M2 기획·검사·검수 | 완료: 기획실(사실 입력·자동 저장·버전·AI 제안(mock)·되돌리기), 발행 전 점검(규칙·탐지기·AI 문맥(mock)·수정 제안 적용), 강사 제출·검토함·피드백·철회, 최종본 전달·내보내기, 표현 사전 검수, 점검 규칙 관리 |
| M3 운영·성과 | 완료: 성과 기록·비교·회고(mock), 비공개 파일 업로드(메타데이터 제거·게이트웨이), 공급자 허가·기능/중지 스위치·한도·예산·정산·작업 화면, 공통 자료실(동의·검토·철회), 데이터 삭제 요청·만료 정리 |
| M4 전체 P0 검수 | 예정 |

## 구조

```text
apps/web/               # Next.js 웹앱 (화면 + /api/v1)
apps/worker/            # app_jobs 폴링 워커 (검색 적재·분석·음성 문안 추출)
packages/core/          # 서비스 로직 (RLS 트랜잭션 위에서 동작, Next 의존 없음)
packages/domain/        # Zod 스키마, 상태 전이, 지표 파싱, 해시, 환경변수 검증
packages/providers/     # RedFox 엔드포인트 레지스트리, live 게이트, mock/live 어댑터
packages/security/      # SSRF 방어 URL 검사, 샤오홍슈 URL 정규화, 로그 마스킹
supabase/migrations/    # SQL 마이그레이션 (RLS 포함)
supabase/seed.sql       # 데모 조직·사용자·분류·테스트용 편집 규칙
supabase/test/          # 로컬 테스트용 Supabase 호환 shim
tests/unit/             # 단위·계약·외부 호출 0건 테스트
tests/integration/      # DB RLS/IDOR·예산·idempotency·제약 테스트
```

## 실행

요구: Node 22+, pnpm 10, PostgreSQL 16 바이너리(`initdb`, `pg_ctl`).

```bash
pnpm install
pnpm typecheck     # TypeScript strict
pnpm test          # 단위 테스트 (DB 불필요)
pnpm test:db       # 임시 PostgreSQL을 띄워 마이그레이션+시드 적용 후 DB 테스트, 종료 시 삭제
pnpm test:all      # 위 세 가지
pnpm test:e2e      # 새 DB+시드+워커+웹(3100)을 띄워 Playwright 실행 후 정리. 화면 캡처는 docs/screenshots/
```

### 로컬에서 직접 써 보기

```bash
pnpm db:local      # 임시 DB(54329) + 데모 콘텐츠 시드
pnpm dev:worker    # 다른 터미널: 작업 워커
pnpm dev:web       # 다른 터미널: http://localhost:3000 → 데모 계정 선택
```

DB 중지: `pg_ctl -D .tmp/pg/data stop` (root면 `runuser -u postgres --` 앞에 붙임).

`test:db`는 실제 Supabase 대신 `supabase/test/00_supabase_shim.sql`로 `auth.users`, `auth.uid()`, 역할(anon/authenticated/service_role)을 흉내 냅니다. 마이그레이션은 실제 Supabase에도 그대로 적용됩니다. root로 실행하면 `postgres` OS 사용자로 DB를 띄웁니다.

## 데모 계정 (시드)

모두 가상 데이터이며 이메일은 예약 도메인 `.invalid`를 씁니다. 로그인 화면에서 계정을 눌러 들어갑니다(데모 모드 전용, 비밀번호 없음). student-a는 계정 설정이 끝난 상태, student-b는 처음 시작하는 상태입니다.

| 사용자 | 역할 |
|---|---|
| student-a@demo.invalid | 학생, 데모 조직, 1기 |
| student-b@demo.invalid | 학생, 데모 조직, 1기 |
| reviewer@demo.invalid | 강사, 1기 검수 |
| reviewer-other-cohort@demo.invalid | 강사, 2기 검수 (1기 제출물 접근 불가) |
| admin@demo.invalid | 조직 관리자 — 상단 메뉴 “관리자”로 `/admin` 진입 (학생 초안 접근 불가) |
| student-c@other-org.demo.invalid | 다른 조직 학생 |
| admin@other-org.demo.invalid | 다른 조직 관리자 |

## live 차단 이유

외부 호출은 명세 6.3의 조건이 **모두** 참일 때만 실행됩니다. 지금은 다음 이유로 막혀 있습니다.

- 모든 RedFox 엔드포인트의 실제 단가가 확인되지 않았습니다(`price_unknown`).
- 공급자 이용 허가가 `pending`이고 증빙이 없습니다.
- live 예산 기본값이 0입니다.
- RF08·RF10은 파라미터 이름이 확인되지 않았습니다(`parameter_unverified`).
- RF13·RF14(F15 영상 음성 문안 추출)는 P1 기능이며 `TRANSCRIPT_ENABLED=false`입니다.
- RedFox 영상 다운로드 API(RFX1)는 명세상 제외 항목이라 구현하지 않습니다.

## 알려진 제한

- `docs/XHS_STUDIO_ACCEPTANCE_TESTS.md`는 아직 저장소에 없습니다. 받으면 테스트 매트릭스를 맞춥니다.
- RedFox 문서 사이트(redfox.hk)는 개발 환경에서 접근이 막혀 있어, 공유받은 문서 ID 중 DCZW5V7A, 9UHXOXSF, tool/QPNFJRG1은 내용을 확인하지 못했습니다.
- 로그인은 데모 로그인입니다. 실제 Supabase Auth 연동은 배포 환경 결정 후 진행합니다(ADR 0002).
- 파일은 개발 환경에서 로컬 비공개 디렉터리(`.data/assets`, `ASSET_STORAGE_DIR`)에 저장됩니다. 배포 시 Supabase 비공개 Storage로 교체합니다.
- P1 기능(이미지 OCR, 댓글 분석, CSV 가져오기, 자동 갱신)과 live 연결은 별도 승인 전까지 비활성입니다.
