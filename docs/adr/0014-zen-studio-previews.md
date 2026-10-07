# ADR 0014: Zen Studio 미리보기로 표지 보완

2026-10-07. 사용자가 전환 개발을 승인했습니다.

SocialDataX 표지는 GET 404였고 image_items도 같은 URL이었습니다. 동일 게시물의 Zen Studio 응답에서 images[0].url_pre는 GET 200 및 유효 WebP였습니다. RedFox 검색은 유지하고 AP01만 Zen Studio 상세 Actor로 전환합니다.

요청은 노트 ID 1개, 모든 다운로드 옵션 false입니다. url_pre를 우선하고 안전하고 만료되지 않은 url을 차선으로 사용합니다. url_original, 영상, 위치, 액세스 토큰은 저장하지 않습니다. 날짜는 밀리초입니다. 이미지의 실행 중 네트워크 가용성은 보장하지 않으며 기존 onError 대체 표시를 유지합니다.

이전 Actor 견적은 actor 비교로 거부하고 동의 버전을 분리합니다. 마이그레이션 17은 단가를 unknown으로 변경합니다. 운영자는 새 빌드 및 비용 근거를 검증해야 합니다. 자동 재시도·자동 다운로드·live 게이트 완화는 추가하지 않습니다.

- 추가 실검증: 미리보기 URL의 t 시각이 지난 뒤에도 GET 200/WebP가 확인됐습니다. 기존 t 기반 만료 판정은 근거가 부족해 제거했습니다. URL 서명은 그대로 유지하고, 실제 로딩 실패는 CoverThumb로 처리하며 DB TTL은 계속 적용합니다.
