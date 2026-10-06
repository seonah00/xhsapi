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
5. **마이그레이션 적용**(운영자 PC에서, Supabase CLI):
   ```bash
   supabase link --project-ref <프로젝트 ref>
   supabase db push          # supabase/migrations/* 를 순서대로 적용 (seed.sql은 적용하지 않음)
   ```
6. **DB 연결 문자열**: Railway는 IPv4를 쓰므로 Supabase의 **Session pooler(포트 5432)** 주소를 씁니다. 트랜잭션 단위로 `set local`을 쓰므로 Transaction pooler(6543)도 동작할 수 있지만, 검증 전까지는 Session pooler를 권장합니다.
   - TLS: Supabase에서 받은 CA 인증서를 `deploy/certs/supabase-ca.crt`로 넣고 `?sslmode=verify-full&sslrootcert=/app/deploy/certs/supabase-ca.crt`를 붙이는 것을 권장합니다(인증서는 공개 파일).
7. **점검**: `DATABASE_URL=<연결 문자열> pnpm verify:db` → 모두 `OK`여야 합니다. 특히 "authenticated로 전환 가능", "auth.uid()가 세션 claim을 읽음", "모든 테이블에 RLS", "데모 계정 없음"을 확인합니다.

## 2. Railway

1. 프로젝트를 만들고 GitHub 저장소를 연결합니다. 서비스 두 개를 같은 저장소·브랜치로 만듭니다.
   - `web`: Settings → Config-as-code 경로 `deploy/railway/web.json`. Networking에서 도메인을 생성합니다(나중에 자체 도메인으로 바꿀 수 있음).
   - `worker`: 설정 경로 `deploy/railway/worker.json`. 도메인은 만들지 않습니다(외부 접속 불필요).
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
| `DATABASE_URL` | ✓ 비밀 | ✓ 비밀 | 1-6의 연결 문자열 |
| `SESSION_SECRET` | ✓ 비밀 | ✓ | 48자 이상 무작위(예: `openssl rand -base64 48`) |
| `APP_BASE_URL` | ✓ | ✓ | web 도메인, 예 `https://studio.example.com` (빌드 시에도 필요: HSTS) |
| `WORKER_ENABLED` | | ✓ | `true` |
| `LIVE_PROVIDER_CALLS_ENABLED` | ✓ | ✓ | 실측 때만 `true` |
| `REDFOX_API_KEY` | ✗ | ✓ 비밀 | **워커에만**(웹은 공급자를 호출하지 않음). 실측 때만 |

3. 배포 후 web의 `/api/health`가 `{"ok":true}`인지 확인합니다.
4. 로그 확인: 시작 시 `… mode: outbound network guard active (web|worker)`가 보여야 하고, `[network-guard] blocked`가 있으면 원인을 조사합니다(Supabase·DB·redfox.hk 외 접속 시도).

## 3. 첫 조직과 관리자

운영자 PC에서 운영 DB·Supabase 변수를 잠깐 환경에 넣고 실행합니다(또는 `railway run`):
```bash
pnpm bootstrap:org --org-name "<조직 이름>" --admin-email <관리자 이메일>
```
출력된 **1회용 비밀번호 설정 링크**를 관리자 본인에게만 전달합니다(메일 발송 없음). 관리자가 비밀번호를 설정한 뒤:
- 관리자 → 초대: 학생·강사 초대 링크를 만들어 직접 전달합니다(이메일을 적으면 그 이메일로만 가입 가능).
- 비밀번호를 잊은 사용자: 관리자 → 멤버 → "비밀번호 설정 링크". **다른 조직에도 속한 사용자는 여기서 만들 수 없습니다**(조직 간 계정 탈취 방지). 그런 경우와 관리자 본인은 운영자가 Supabase 대시보드에서 처리합니다.

## 4. 배포 직후 점검표

1. `pnpm verify:db` 전부 OK
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
