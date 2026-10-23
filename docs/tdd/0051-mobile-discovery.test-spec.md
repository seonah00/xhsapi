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

CI39898355739는255/208 PASS, E2E49pass/1fail. 새 학생 desktop/mobile회귀와 axe/console 검사는 통과했다. 한국어 검색 기존 테스트가 준비 화면에서 중국어 결과로 이동하기 전에 이전 details를 열어, 새 결과 key로 교체된 뒤 다시 접히는 순서 경쟁이 드러났다. 실제 중국어 q·prepare 해제 URL 도착을 기다린 다음 펼치도록 보완했다. 단순 재시도·실패 무시는 적용하지 않는다. 최종 전체 결과 대기.

최종 CI39898915466 /08380da: 타입·린트·단위255/DB208/E2E50 모두 PASS (총513). 새 학생 desktop/mobile회귀 각각 PASS, 모바일 첫 카드<780px/16px/44px·axe·콘솔 검사 PASS. web/worker mock outbound attempts0. 기존 한국어→중국어 검색 회귀도 새 URL 대기 후 PASS. 최종 운영 소스는 이 앱 코드와 동일한 문서 후속 커밋으로 배포하며 운영 검증은 후속 기록한다.

## 운영 배포·검증 완료

운영 d8fcc8b6194d332f541a4e7d16c97e15c1d08e4e /web ec7935cc-7a88-4573-8c41-c5127c49f4d0 ACTIVE/Deployment successful 및 소스 링크 확인. GitHub deployment7270038353 success. 앱은 CI 통과08380da와 동일하고 문서 후속만 추가됐다.

기존 관리자 세션에서375px 여행 분석 기본 접힘46px, 첫카드 y24721→795.5, 입력16px/44px·버튼44px 확인. 분석 펼침/닫힘,1→2→1 후 기본 접힘 초기화,6개카테고리·조합검색(防晒霜推荐+beauty+saves48건),전체27페이지마지막47건/다음링크0/이전→26페이지50건 확인.360/375/390/768px 및 desktop1280 가로넘침0, 펼친 분석도375px 넘침0, 최종consoleerror0. Native 화면 이동 후 이전 상태를 잠깐 읽는 도구 대기 timeout1회는 후속 주소/페이지표시로 전환완료를 확인했으며 성공을 추정하지 않았다.

운영은 관리자 세션이다. 학생 권한/불필요 문구 숨김·첫카드<780px은 CI 모의학생 desktop/mobile 증거로 구분한다. 실제폰 터치/가상키보드/Safari 엔진 검증은 미실행. 전후 jobs96/settings c449be4b67243c09444342cd107c361d/budgets 2d9bc5daec1abd537e95222874bb6900 동일. 신규유료/수집/정기수집/불명예약 변경0, paused heartbeat 유지.

증거: outputs/mobile-discovery-production-checks-20261023.json, mobile-discovery-production-improved-375-20261023.png, mobile-discovery-deployment-active-20261023.png, mobile-student-ui-final-20261023/discovery-mobile.png. viewport reset 및 임시 CI/배포 탭 정리 완료.
