# 날짜 표시 hydration 회귀 검증

사용자 요청에서 도출한 여정: 수강생이 탐색을 열 때 게시물 날짜가 서버·브라우저에서 같고, 페이지가 React 오류 없이 상호작용 가능해야 한다. 유료 수집·예산·정기수집은 변경하지 않는다.

## RED → GREEN

- RED04b0118: Node22.23.2에서 date-labels 단위4개 중3개 실패. `2026년 10월 12일 PM 07:01` 대 `2026년 10월 12일 오후 07:01`; 자정AM/정오PM도 같은 원인으로 실패. 로컬 격리 SSR/hydrate 화면에서 NoteCard의 동일 텍스트 diff 확인. 재현용 실제 텍스트는 저장소에 커밋하지 않고 회귀 fixture는 합성 날짜만 사용했다.
- GREEN84c75d5: 동일 Node22 단위4개 통과. 로컬 Node22 SSR/브라우저 hydrate 재검사 recoverable error0. 전체 단위248개, 루트/웹 타입, lint, Node22 Next 프로덕션 빌드 통과. 빌드는 기존 pg-config 동적 파일 추적 경고2개를 출력했으며 이번 수정과 무관하다.
- 단위 명령: `npm_config_cache=/private/tmp/xhs-hydration-npm npm exec --yes --package=node@22.23.2 -- node node_modules/vitest/vitest.mjs run --project unit tests/unit/date-labels.test.ts`.
- 로컬 native PostgreSQL16 실행 파일이 없어 DB/E2E는 CI39883744411에서 검증했다. CI SUCCESS: 단위248/DB208/E2E47=503개, 외부 연결 시도0(web/worker). 새 학생 hydration 회귀도 통과. 실행되지 않은 로컬 DB/E2E 통과로 세지 않는다. RED 체크포인트의 확장자 없는 테스트 import는 이후 .ts 확장자로 수정했고 루트 타입 검사를 통과했다.

| 보장 | 검사 | 상태 |
| --- | --- | --- |
| Korean 오전/오후가 Node22에서도 동일 | date-labels.test.ts | PASS4 |
| 한국 날짜 경계·자정·정오·날짜 전용·미확인 | date-labels.test.ts | PASS |
| 영어 브라우저·미국 시간대의 학생 탐색에서 콘솔/페이지 오류 없음 | discovery-hydration.spec.ts | CI PASS |
| 입력 편집으로 실제 hydration 완료 확인, 외부 실행 없음 | discovery-hydration.spec.ts | CI PASS |

별도 커버리지 계측은 수행하지 않았다. 변경 함수의 날짜/시간·오전/오후·미확인 분기를 직접 검사한다. 배포 후 운영 카테고리 재검사 결과는 후속 기록으로 남긴다.

## 추가 운영 원인: 잘린 UTF-16 문자

날짜 수정 ed8b25c/web9fc5a4d0 배포 뒤에도 여행·외출에서 React418이 남았다. 저장 자료를 로컬 Next 개발 화면에 주입하여 SearchLanguage 표현 예문의 첫 글자가 단독 low surrogate(U+DDF7)인 diff를 확인했다. HTML UTF-8 인코딩은 이를 U+FFFD로 치환하지만 RSC는 원래 UTF-16 값을 유지하여 불일치했다. 이는 날짜와 독립적인 추가 원인이다.

- RED46b3191: 합성 이모지가 예문 시작·끝 경계에서 잘리는 단위 회귀1개 실패.
- GREEN: 정규식의 실제 일치 길이를 사용하고, 문맥 시작·끝이 surrogate pair 중간이면 바깥으로 한 코드 단위 확장한다. 기존 길이·문맥은 최대2코드 단위만 늘어나며 근거 내용/빈도는 그대로다.
- 단위 회귀5개 PASS. 실제 저장 자료를 사용한 로컬 Next22 개발 화면도 새 탭에서 console error0. 실제 자료·임시 진단 경로는 커밋하지 않았다.
- 학생 E2E에 독립적인 합성 note fixture를 추가했다. 무료 저장자료 GET, 예문 펼치기, client 입력 편집 뒤 오류0을 검사한다. 테스트 note는 로컬/CI DB에서만 만들고 finally로 제거한다. CI 결과는 후속 기록한다.

CI39885515498 SUCCESS (1fa1cac): 타입/린트/단위249/DB208/E2E48 = 총505개. 새 이모지 경계 학생 회귀도 PASS. 모의 web/worker outbound attempts0. Node22 프로덕션 빌드도 로컬 PASS. 운영 반영·fresh tab 재검사는 후속 기록한다.

## 운영 최종 검증

2026-10-23 web b869fb0d-5b21-4277-b2c5-6c89564f767a / df4e666 ACTIVE 및 Deployment successful, 해당 소스 링크 확인. 새 탭 여행·외출, 새로고침, client 입력 활성화에서 console error0. 6개 주제, 전체27페이지(1,347건, 마지막47건·다음 없음), 저장 검색 선크림추천/防晒霜推荐/ootd, 검색 다음 페이지1건, 빈 결과 안내, saves/recent 정렬도 오류0. 최초 클릭 반복 표본은 전환 완료를 기다리지 않아 폐기했고, 주소별 실제 GET 전환으로27페이지를 다시 점검했다. 실제 더 보기 클릭도 주소 cursor=NTA/다음MTAw 전환으로 확인했다.

운영 세션은 기존 관리자이며 실제 학생 계정 검증으로 주장하지 않는다. 학생은 모의 CI 회귀2개 포함48개 증빙으로 구분한다. 전후 jobs96/settings c449be4b67243c09444342cd107c361d/budgets 2d9bc5daec1abd537e95222874bb6900 동일. 새 유료 호출·수집·정기수집 활성화·불명 예약 재시도 없음. 증빙은 outputs/console-production-regression-20261023.json/png, console-unicode-deployment-active-20261023.png.
