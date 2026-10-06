Supabase 데이터베이스 TLS 인증서(공개 인증서, 비밀 아님)를 `supabase-ca.crt` 이름으로 여기에 두면
`DATABASE_URL`에 `sslmode=verify-full&sslrootcert=/app/deploy/certs/supabase-ca.crt`를 붙여 서버 인증서까지 검증할 수 있습니다.
인증서는 Supabase 대시보드의 Database 설정(SSL Configuration)에서 받습니다. 자세한 내용은 docs/DEPLOY.md 참고.
