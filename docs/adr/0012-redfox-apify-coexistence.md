# ADR 0012: RedFox 검색 유지와 Apify 상세 보완

날짜: 2026-10-07 · 상태: 구현, 운영 활성화 전 검증 대기

## 결정

사용자 지시로 스크래핑 일괄 금지를 해제하고 RedFox RF01/RF02 검색은 유지합니다. Apify의 `socialdatax/socialdatax-xhs-data-api`를 선택한 노트 1건의 상세·표지 보완에 사용합니다. 검색 실패나 이미지 로딩 실패가 자동 과금으로 이어지지 않도록 별도 견적·동의 화면을 둡니다. 자동 수집, 원본 영상 다운로드, 로그인·토큰 우회는 구현하지 않습니다.

## 계약과 데이터

- AP01: `POST /v2/actors/socialdatax~socialdatax-xhs-data-api/run-sync-get-dataset-items`
- 고정 숫자 빌드 `APIFY_ACTOR_BUILD`를 견적에 기록합니다. `latest`는 허용하지 않습니다.
- 입력: `operation=get_note_detail`, `note_id`, `auto_paginate=false`, `max_items=1`.
- 실행 옵션: `timeout=120`, `maxItems=1`, `restartOnError=false`, `maxTotalChargeUsd=견적의 최대 금액`.
- 결과는 1건이며 요청한 note ID와 일치해야 합니다. 사용자 제공 JSON의 형태를 확인했고 저장소에는 합성 fixture만 넣었습니다. `publish_time`은 UNIX 초입니다.
- 저장 항목: 제목, 본문 200자 이내, 안전한 표지 URL, 유형, 태그, 제공된 반응 지표. 영상·이미지 원본, 위치, 계정 포인트, 접근 토큰 URL은 저장하지 않습니다.
- `note_enrichments`에 별도 저장하고 기존 RedFox 노트와 지표는 수정하지 않습니다. 제공되지 않은 지표는 RedFox 값을 유지합니다. 탐색·비교 카드에 표시되는 보완이며 기존 검색 정렬·주제 분류·레퍼런스 분석 입력은 RedFox 자료를 유지합니다.
- 조직 RLS, 공급자별 허가, 보관 TTL을 적용합니다. 허가 철회·만료 시 보완 데이터를 숨기고 TTL 만료 데이터는 매시간 정리합니다. 표지 URL이 만료되면 기존 대체 썸네일을 사용합니다. 실제 CDN 표시 성공은 아직 검증하지 않았습니다.

## 비용과 재실행

API 키 등록만으로 활성화하지 않습니다. APIFY_ENABLED, 기존 live 게이트, AP01 허가(수집·메타데이터·발췌·미디어·캐시 및 TTL), 검증된 USD/run 비용 상한, USD 조직 예산, 개별 견적 동의가 모두 필요합니다. 웹에는 토큰을 주지 않으며 워커에서 Bearer 헤더로만 전송합니다.

상품 목록의 1,000건당 시작 가격이나 SocialDataX points를 실행 총비용으로 환산하지 않습니다. AP01의 초기 단가는 unknown입니다. 운영자가 모든 과금 항목을 확인한 실행 상한을 근거와 함께 등록해야 합니다.

POST 전에 DB에 발송 시작 표시를 남깁니다. 응답 유실·비정상 응답·저장 실패 또는 발송 표시가 있는 작업의 재인수는 unknown_outcome으로 남기고 재전송하지 않습니다. 예약 금액을 유지하며 운영자가 Apify 실행·청구 기록으로 정산합니다. 성공은 기존 원장 정책대로 최대 예약액으로 보수적으로 정산하며 실제 청구와 차이가 날 수 있습니다. 전송 전 게이트 차단은 예약을 해제합니다.

## 근거 및 검증 한계

2026-10-07 공개 문서 확인:
- [Actor 입력 계약](https://apify.com/socialdatax/socialdatax-xhs-data-api/input-schema)
- [동기 실행 API와 비용 제한 옵션](https://docs.apify.com/api/v2/actor-run-sync-get-dataset-items-post)

개발 검증은 합성 fixture·가짜 fetch만 사용합니다. 실제 Actor 실행·가격 검증·운영 DB 변경·배포는 하지 않았습니다. 이번 실행 환경은 PostgreSQL 공유 메모리 생성이 차단되어 DB 통합·E2E 검증을 마치지 못했습니다. 결과와 후속 명령은 HANDOFF를 따릅니다.
