# 사전·글쓰기 모바일 회귀 근거

사용자 요구: 공용사전·내 사전·글쓰기·작성 이력 모바일 사용성과 기능 재검증. 예산·신규유료·정기수집 보류.

- 운영375px 읽기 전용 입력 측정: 사전38px/14px, 내 사전38px/14px, 글쓰기38px/14px, 작성 이력38px/14px. 콘솔오류0.
- RED: CUA DOM 기반 작성 이력 입력44px/16px assertion이 의도한 크기 부족으로 실패. 첫 진단은 제한된 evaluate의 parseFloat 미지원이므로 RED로 세지 않음. 수정된 DOM 측정 후 REPL Number 변환 assertion 실패만 유효 근거.
- d5605fe: 네 경로 E2E의 실제 computedStyle/height/overflow 회귀 추가. 개인사전 뜻·분류·즐겨찾기·중/한 예문 저장/재조회→글쓰기→임시저장복원 여정을 모바일 프로젝트에도 실행.
- 077179c: 최소 CSS/배치 수정. 로컬 타입/린트/단위255 PASS. CI39908823968 SUCCESS: DB208/학생E2E53, 타입/린트/단위255=총516PASS. web/worker 모의 외부연결0. Node22.23.2 운영빌드PASS(기존pg-config추적경고2개).
- 기존 writing-library: 글 버전저장/복원/복제/보관/검색/페이지/axe/콘솔. route layout 추가에 맞춰 버전 details locator의 불필요한 main 직계 의존 제거.
- 범위: UI 회귀이므로 새 사업로직 단위·DB 테스트를 중복 작성하지 않는다. 기존 DB 격리·저장 테스트를 실행한다. 수치 커버리지 계측은 없으며80% 달성으로 보고하지 않는다.
