# 0050. 표현 문맥의 이모지 경계를 보존

2026-10-23 · Accepted

날짜 표시 수정 후 운영 여행·외출에서 남은 React418은 표현 예문 자르기가 UTF-16 surrogate pair 중간에서 시작했기 때문이다. 로컬 Next 개발 화면은 RSC의 단독 low surrogate와 HTML UTF-8 인코딩의 대체 문자 차이를 보여 주었다.

analyzeSearchLanguage의 기존 앞35/뒤55 코드 단위 문맥 범위를 유지하되, 시작 또는 끝이 surrogate pair 중간이면 바깥으로 한 코드 단위 확장한다. 대소문자 무시 일치의 길이는 실제 match[0]을 사용한다. 경고 숨김 대신 원본 문자를 보존한다. grapheme 전체 분리는 범위를 넓혀야 하므로 이번 변경에 포함하지 않는다. 데이터베이스 원문·공유링크·빈도·비용 설정은 바꾸지 않는다.

합성 이모지가 양 끝에서 잘리는 단위 회귀와 모의 학생 E2E를 추가했다. 실제 저장 자료는 진단에만 사용하고 커밋하지 않는다. 상세 RED/GREEN 및 운영 결과는 docs/tdd/0049-date-hydration.test-spec.md에 기록한다.
