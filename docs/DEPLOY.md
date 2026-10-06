# 배포 절차 (Railway + Supabase)

웹과 워커는 Railway에, DB·로그인·파일 저장소는 Supabase에 둡니다. **배포·학생 초대·결제는 별도 승인 항목**입니다. 이 문서는 준비 절차이며, 계정 생성과 비용 결제는 운영자가 직접 합니다. 비밀값(키·DB 주소·세션 비밀)은 채팅·문서·git에 넣지 말고 각 서비스의 비밀 설정에만 넣습니다.

> 이 저장소에서 검증한 범위: 로그인·초대·비밀번호 링크·파일 저장은 **로컬 가짜 Supabase 서버**로 E2E 검증했습니다(`E2E_AUTH=supabase bash scripts/e2e.sh`). 이미지 안에서 실행되는 단계(잠금 파일 그대로 설치, 비밀값 없이 웹 빌드)는 통과했습니다. **실제 Supabase 프로젝트와 Railway, Docker 이미지 빌드는 이 개발 환경에서 접속이 막혀 검증하지 못했습니다.** 그래서 배포 직후 아래 "점검" 단계를 꼭 실행하세요.

## 0. 구성

| 구성 | 위치 | 비고 |
|---|---|---|
| 웹 (Next.js) | Railway 서비스 `web` | `deploy/Dockerfile.web`, 설정 `deploy/railway/web.json`, 헬스체크 `/api/health` |
| 워커 | Railway 서비스 `worker` | `deploy/Dockerfile.worker`, 설정 `deploy/railway/worker.json`, 1개만 실행 |
| DB | Supabase Postgres | 마이그레이션 `supabase/migrations` (seed.sql·test shim은 **운영에 적용 금지**) |
| 로그인 | Supabase Auth (이메일+비밀번호) | 공개 가입 없음, 초대 링크로만 계정 생성, 메일 발송 없음 |
| 파일 | Supabase Storage 비공개 버킷 | 서버만 서비스 키로 접근, 브라우저에는 게이트웨이(`/api/v1/assets/...`)로만 전달 |

지역은 사용자(한국)와 RedFox(홍콩·중국)를 고려해 **싱가포르 또는 도쿄**를 권장합니다. Railway와 Supabase를 같은 지역에 두세요.

## 1. Supabase 프로젝트

1. 프로젝트를 만들고 지역을 고릅니다. DB 비밀번호는 비밀 저장소에만 보관합니다.
2. **Authentication → Sign In / Providers**
   - Email 로그인은 켜고, **"Allow new users to sign up"은 끕니다**(공개 가입 금지). 계정은 서버가 관리자 API로만 만듭니다.
   - 확인 메일 발송이 필요 없습니다. 초대 링크·관리자 링크로 대신합니다.
3. **Data API(PostgREST) 노출 제한**: 이 앱은 Data API를 쓰지 않고 서버가 DB에 직접 접속합니다. **Settings → Data API에서 `public` 스키마를 노출 목록에서 빼거나 Data API를 끕니다.** 모든 테이블에 RLS가 있지만, 브라우저나 외부에서 anon 키로 테이블에 직접 접근하는 경로 자체를 없애는 것이 안전합니다.
4. **Storage**: 비공개(Public 꺼짐) 버킷 `private-assets`를 만듭니다. 이름을 바꾸면 `SUPABASE_STORAGE_BUCKET`도 같이 바꿉니다.
5. **스키마는 Railway가 자동으로 적용합니다.** web 서비스는 배포할 때마다 시작 전에 `scripts/db-migrate.ts`를 실행합니다(`railway.json`의 preDeployCommand). 이때 아직 적용되지 않은 마이그레이션만 순서대로 넣고, `app.applied_migrations`에 기록합니다. SQL Editor에 붙여 넣을 필요가 없습니다.
   - 실패하면 web 배포가 중단되고, 로그에 `… 적용 실패: <원인>`이 남습니다(이전 버전은 계속 동작).
   - 예비 방법: 대신 SQL Editor에 `deploy/supabase/initial-schema.sql`을 붙여 넣을 수도 있습니다. 이때 Supabase가 "RLS를 켜고 실행할지" 묻는 창을 띄우면 **추가 문장 없이 그대로 실행**을 고르세요. 스크립트가 직접 RLS를 켭니다.
6. **DB 연결 문자열(`DATABASE_URL`)**: Supabase 대시보드 상단 **Connect** → **Direct (Connection string)** 탭 → 방식에서 **Session pooler**를 골라 URI를 복사합니다(IPv4, 포트 5432). `[YOUR-PASSWORD]` 자리에 DB 비밀번호를 넣습니다. Connect 창의 Framework 탭(npm install, .env.local)과 **Enable Data API** 버튼은 이 앱에 해당이 없습니다(누르지 않음).
   - **키**: Project Settings → **API Keys**. 새 형식(`sb_publishable_…` → `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `sb_secret_…` → `SUPABASE_SERVICE_ROLE_KEY`)과 Legacy 탭의 anon/service_role 키 모두 쓸 수 있습니다. 프로젝트 URL(`https://<ref>.supabase.co`)은 같은 화면이나 Project Settings → Data API의 URL입니다.
   - **TLS 인증서**: Project Settings → Database → **SSL Configuration → Download certificate**로 받은 파일을 저장소 `deploy/certs/supabase-ca.crt`에 넣으면(공개 인증서, 비밀 아님) 앱이 Supabase 주소일 때 자동으로 그 인증서로 DB 서버를 검증합니다. GitHub 웹에서 `deploy/certs` 폴더 → Add file → Upload files로 올려도 되고, 개발 담당자에게 파일을 전달해도 됩니다. 파일 대신 Railway 변수 `DATABASE_CA_CERT`에 인증서 내용(PEM)을 넣어도 됩니다(변수가 우선).
   - 인증서로 연결이 안 되면(로그에 `self-signed certificate` 등) 임시로 `DATABASE_URL` 끝에 `?sslmode=no-verify`를 붙이면 암호화는 되지만 서버 검증은 하지 않습니다. 원인을 확인한 뒤 되돌리세요.
7. **점검**: 첫 배포가 끝나면 SQL Editor에서 `deploy/supabase/verify.sql` 내용을 실행합니다. 7개 항목이 모두 `ok = true`여야 합니다(스키마가 없으면 오류 대신 false로 보입니다). PC에서 실행할 수 있으면 `pnpm verify:db`가 역할 전환·`auth.uid()`까지 더 자세히 확인합니다.

## 2. Railway

1. 프로젝트를 만들고 GitHub 저장소(배포할 브랜치)로 서비스 두 개를 만듭니다. **빌더가 Dockerfile이든 Railway 자동 빌더(Railpack)든 똑같이 동작**하도록 시작 스크립트(`scripts/start.mjs`)를 하나로 통일했습니다.
   - **web**: 시작할 때 아직 적용되지 않은 DB 마이그레이션을 먼저 적용합니다(동시 실행 잠금 포함). 실패하면 웹을 띄우지 않습니다. 그다음 Railway가 지정한 `PORT`로 서버를 엽니다. 배포 로그에 `완료: 13개 적용`(처음) 또는 `적용할 마이그레이션이 없습니다(최신)`가 보이면 정상입니다. Settings → Networking에서 도메인을 생성합니다.
   - **worker**: Variables에 `XHS_SERVICE=worker`를 넣습니다. Custom Start Command를 쓰고 있다면 `pnpm start:worker`로 바꿉니다. 도메인은 만들지 않습니다.
   - **Custom Start Command / Build Command는 비워 두는 것을 권장합니다.** 비워 두면 저장소 설정(`railway.json` → Dockerfile, 또는 Railpack이면 루트 `build`/`start` 스크립트)을 그대로 씁니다. web에 `cd apps/web && pnpm start` 같은 명령이 들어 있어도 동작은 하지만, 지우는 편이 단순합니다.
2. **변수**(Railway Variables, 공통은 Shared Variables로):

| 변수 | web | worker | 값 |
|---|---|---|---|
| `APP_DATA_MODE` | ✓ | ✓ | 처음엔 `mock`(실제 로그인 + 데모 데이터로 리허설), 실측 때 `live` |
| `AUTH_PROVIDER` | ✓ | ✓ | `supabase` |
| `STORAGE_BACKEND` | ✓ | ✓ | `supabase` |
| `SUPABASE_STORAGE_BUCKET` | ✓ | ✓ | `private-assets` |
| `NEXT_PUBLIC_SUPABASE_URL` | ✓ | ✓ | `https://<ref>.supabase.co` |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | ✓ | ✓ | anon 키(서버에서만 사용) |
| `SUPABASE_SERVICE_ROLE_KEY` | ✓ 비밀 | ✓ 비밀 | service_role 키 |
| `DATABASE_URL` | ✓ 비밀 | ✓ 비밀 | 1-6의 Session pooler 연결 문자열 |
| `DATABASE_CA_CERT` | (선택) | (선택) | `deploy/certs/supabase-ca.crt`가 저장소에 있으면 불필요 |
| `SESSION_SECRET` | ✓ 비밀 | ✓ | 48자 이상 무작위(예: `openssl rand -base64 48`) |
| `APP_BASE_URL` | ✓ | ✓ | web 도메인, 예 `https://studio.example.com` (빌드 시에도 필요: HSTS) |
| `WORKER_ENABLED` | | ✓ | `true` |
| `LIVE_PROVIDER_CALLS_ENABLED` | ✓ | ✓ | 실측 때만 `true` |
| `REDFOX_API_KEY` | ✗ | ✓ 비밀 | **워커에만**(웹은 공급자를 호출하지 않음). 실측 때만 |

3. 배포 후 web의 `/api/health`가 `{"ok":true}`인지 확인합니다.
4. 로그 확인: 시작 시 `… mode: outbound network guard active (web|worker)`가 보여야 하고, `[network-guard] blocked`가 있으면 원인을 조사합니다(Supabase·DB·redfox.hk 외 접속 시도).

## 3. 첫 조직과 관리자

**가장 쉬운 방법(PC 불필요)**: Railway web 변수에 `BOOTSTRAP_ORG_NAME`(조직 이름)과 `BOOTSTRAP_ADMIN_EMAIL`(관리자 이메일)을 넣고 다시 배포합니다. 웹이 시작할 때 **조직이 하나도 없을 때만** 조직·관리자를 만들고, 배포 로그에 `비밀번호 설정 링크(1회용 …)`를 출력합니다. 링크를 열어 비밀번호를 정한 뒤 두 변수는 지웁니다(남겨 둬도 다시 만들지는 않음). 로그를 볼 수 있는 사람은 링크도 볼 수 있으니 바로 사용하세요. 한 번 쓰면 무효가 됩니다.

PC에서 실행하는 방법:

운영자 PC에서 운영 DB·Supabase 변수를 잠깐 환경에 넣고 실행합니다(또는 `railway run`):
```bash
pnpm bootstrap:org --org-name "<조직 이름>" --admin-email <관리자 이메일>
```
출력된 **1회용 비밀번호 설정 링크**를 관리자 본인에게만 전달합니다(메일 발송 없음). 관리자가 비밀번호를 설정한 뒤:
- 관리자 → 초대: 학생·강사 초대 링크를 만들어 직접 전달합니다(이메일을 적으면 그 이메일로만 가입 가능).
- 비밀번호를 잊은 사용자: 관리자 → 멤버 → "비밀번호 설정 링크". **다른 조직에도 속한 사용자는 여기서 만들 수 없습니다**(조직 간 계정 탈취 방지). 그런 경우와 관리자 본인은 운영자가 Supabase 대시보드에서 처리합니다.

## 4. 배포 직후 점검표

1. web 배포 로그에 마이그레이션 적용(또는 "적용할 마이그레이션이 없습니다")이 보이고, `verify.sql`(또는 `pnpm verify:db`) 전부 OK
2. `/api/health` OK, 응답 헤더에 `Strict-Transport-Security`, 페이지에 nonce 기반 `Content-Security-Policy`
3. 로그인 화면에 데모 계정이 없음, 틀린 비밀번호는 같은 문구로 거절
4. 관리자 1회용 링크 → 비밀번호 설정 → 로그인 → 초대 → 학생 가입 → 이미지 업로드·표시
5. 관리자 → 공급자·스위치의 live 전환 점검표가 의도대로 "차단" 상태
6. 웹·워커 로그에 `[network-guard] blocked` 없음
7. Supabase 대시보드에서 공개 가입 꺼짐, Data API에서 `public` 미노출, 버킷 비공개 확인

## 5. 운영 메모

- 백업: Supabase의 기본 일일 백업 범위·보존 기간은 요금제마다 다릅니다. 복원 후에는 삭제 요청을 다시 적용해야 합니다(`docs/OPERATIONS.md` 5장).
- 로그인 시도 제한은 Supabase 자체 제한에 더해 웹 프로세스 메모리에서 계정별로 합니다. web을 여러 개로 늘리면 각자 따로 셉니다.
- live 실측 절차는 `docs/OPERATIONS.md` 8장을 따릅니다. `REDFOX_API_KEY`는 워커에만 넣습니다.
- 되돌리기: Railway에서 이전 배포로 롤백할 수 있습니다. DB 마이그레이션은 되돌리지 않는 방향(추가만)으로 작성되어 있습니다.
