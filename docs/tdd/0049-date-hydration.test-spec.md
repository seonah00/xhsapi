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
