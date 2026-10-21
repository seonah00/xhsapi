# 0048 검증된 탐색 노출

- 요청: 404 게시물은 학생 탐색에서 숨김, 기존 데이터 보존, 외부 유료 호출/예산/정기수집 변경 없음.
- RED: 2dde295, Verify39577469296. 기존 discovery 그대로인 상태에서 새 DB fixture 52opened/19not_found/unknown/만료/fallback/mock을 추가했다. 다음 페이지 기대2/실제23 및 검색 결과의 비정상 항목 포함 두 실패를 실제 PostgreSQL에서 확인했다. DB206통과/2실패.
- GREEN: 4dedffe, Verify39577757415 SUCCESS. 열린 상태+공유주소 조건을 SQL LIMIT 앞에 적용. 단위244, DB208, E2E46=498 통과, 타입/린트/로컬 Next.js 빌드 통과. 실 외부 API 호출0.
- 회귀: 50+2 pagination/중복없음, 검색/카테고리/정렬/원문필터, fallback 제외, 원본75개/주소75개 유지, 직접 상세 유지, mock 호환, 비회원 조회0/학생 상태 변경과삭제 거부.
- 수동 검토: SQL은 고정 상수, 사용자 입력 보간 없음. org/mode/notes TTL RLS/기존 주소 TTL 모두 유지. 신규 definer/실제 공유토큰/실제 응답 fixture 없음. DB와 앱 배포 순서 확인. 검증 전에 opened로 자동 승격시키는 코드 없음.
- 운영 DB migration/정확한 점검 결과 이관 완료, opened1347/not_found19. 인증된 조회의 노출 예정1347/not_found0. notes1857/links1366/jobs96, 예산과 조직 설정 해시 불변.
- 미완: Railway 공식 장애 QH8L8B3E로 운영 앱 반영 및 운영 학생 탐색 최종 확인 불가. 운영브랜치4dedffe 푸시 완료, 현재 실제 화면은 이전 버전. 이 한계를 테스트 성공으로 가리지 않는다.
