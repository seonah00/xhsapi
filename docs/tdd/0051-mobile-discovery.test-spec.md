# 모바일 탐색 회귀 검증

- 사용자 목표: 게시물 우선, 키워드 분석 기본 접힘/필요 시 펼침, 현재 페이지·이전/다음, 검색조건 유지, 입력16px/터치44px, 학생 불필요 문구 숨김. 배포 후 운영 읽기 전용 점검. 유료호출·예산·정기수집 보류.
- RED64f7355: 새 discoveryPageLinks를 참조하는 단위 테스트가 미구현 모듈로 compile-time RED. 실행된 런타임 테스트0이며 이 결과를 런타임 RED로 세지 않는다. 새 학생 E2E도 먼저 작성했다(로컬 PostgreSQL16이 없어 CI 검증 예정).
- GREEN044b3a5: 같은 pagination target6개 PASS. 첫/중간/마지막 페이지·잘못된 cursor·반복 terms/검색조건 보존을 검사한다. 전체 첫 로컬 실행은 network-guard localhost listen EPERM으로252pass/3skip 실패. 네트워크 권한을 받은 후 타입/린트/전체 단위255개 PASS. 초기 전체 실패를 통과로 보고하지 않는다.
- Node22.23.2 Next 프로덕션 빌드 PASS. 기존 pg-config 동적 파일 추적 경고는 별도이며 이번 기능 경고로 숨기지 않는다.
- 새 @mobile E2E: 합성55개 게시물+주제, 학생 desktop/mobile 로그인, 첫 카드가780px 안에 있음, 기본 접힘·펼침·닫힘,1→2(5건)→1, 검색/카테고리/정렬 유지, 숨김 문구,44px/16px, overflow, axe, consoleerror0. 실제 공급자/학생 데이터는 사용하지 않고 테스트 fixture는 finally삭제한다.
- 기존 표현/키워드/날짜 회귀는 native details를 명시적으로 펼친 후 검사하도록 수정했다. 관찰 시각은 관리자 전용이 되어 날짜 회귀는 모의 관리자, 이모지 회귀는 모의 학생을 사용한다.
- CI/운영 결과는 후속 기록. 별도 커버리지 계측은 아직 수행하지 않았고 미실행 로컬 DB/E2E를 통과로 세지 않는다.

CI39897017650은 타입/린트/단위255/DB208 이후 Azure Ubuntu 폰트 미러 설치에서 지연되어 최종 터치 링크44px 수정본 b6ddfb6 CI39897572877로 대체했다. 두 번째도 같은 미러 다운로드에서 지연됨을 GitHub live log로 확인했다. 검증 워크플로에만 공식 archive.ubuntu.com HTTPS 미러·20초/1회 다운로드 제한 및 해당 단계5분 timeout을 추가했다. 서명·TLS 검증을 해제하지 않고 운영 설정은 변경하지 않는다. 앞선 CI를 성공으로 세지 않으며 최종 실행 결과를 별도 기록한다.

CI39897879051: type/lint/unit255/DB208 PASS, browser dependencies20s로 설치 성공. E2E46pass/4fail: 새 테스트 준비 SQL에서 classifier_version/confidence 누락으로 desktop/mobile2개 실패; 기존 학생 카드에서 숨긴 조회수 안내를 계속 요구하던 assertion1개; 검색 후보 이동 후 새 기본 접힘을 열지 않던 assertion1개. 준비 SQL과 의도한 새 동선에 맞춰 테스트를 수정했으며 앱 제품 코드의 실패로 혼동하지 않는다. 모든 검사를 다시 실행한 뒤에만 배포한다.
