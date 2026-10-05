# Xiaohongshu Content Studio

한국어 수강생이 샤오홍슈 계정 방향을 잡고, 레퍼런스·해시태그·중국어 표현을 찾아 본인의 기획과 문안을 만들고, 표현 점검·강사 피드백·성과 기록까지 진행하는 교육용 웹서비스입니다.

- 명세: [`docs/XHS_STUDIO_DEVELOPMENT_SPEC.md`](docs/XHS_STUDIO_DEVELOPMENT_SPEC.md) (v1.1)
- 결정 기록: [`docs/adr/`](docs/adr/)
- 기본은 **mock 모드**입니다. 외부 데이터 API·AI·메일·결제 호출은 하지 않습니다. API 키가 있어도 live로 바뀌지 않습니다.

## 진행 상태

| 단계 | 상태 |
|---|---|
| M0 기초·권한 경계 | 완료: 패키지 골격, DB 마이그레이션·RLS, 데모 시드, mock provider, live 게이트, 테스트 |
| M1 발견·저장 | 예정 (Next.js 웹앱, 온보딩·탐색·레퍼런스·표현) |
| M2 기획·검사·검수 | 예정 |
| M3 운영·성과 | 예정 |
| M4 전체 P0 검수 | 예정 |

## 구조

```text
apps/worker/            # 백그라운드 작업 (M0: 환경 검증 골격)
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
pnpm db:local      # 임시 DB를 띄운 채로 두고 접속 URL 출력
```

`test:db`는 실제 Supabase 대신 `supabase/test/00_supabase_shim.sql`로 `auth.users`, `auth.uid()`, 역할(anon/authenticated/service_role)을 흉내 냅니다. 마이그레이션은 실제 Supabase에도 그대로 적용됩니다. root로 실행하면 `postgres` OS 사용자로 DB를 띄웁니다.

## 데모 계정 (시드)

모두 가상 데이터이며 이메일은 예약 도메인 `.invalid`를 씁니다. 비밀번호는 시드에 넣지 않습니다(로그인 화면은 M1).

| 사용자 | 역할 |
|---|---|
| student-a@demo.invalid | 학생, 데모 조직, 1기 |
| student-b@demo.invalid | 학생, 데모 조직, 1기 |
| reviewer@demo.invalid | 강사, 1기 검수 |
| reviewer-other-cohort@demo.invalid | 강사, 2기 검수 (1기 제출물 접근 불가) |
| admin@demo.invalid | 조직 관리자 (학생 초안 접근 불가) |
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
- 웹앱(Next.js), 작업 큐 dispatcher, 실제 Supabase 로컬 스택 연동은 M1 이후입니다.
