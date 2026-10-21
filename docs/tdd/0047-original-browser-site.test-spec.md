# 원문 브라우저 목적지 검증

- RED 43eb479: 신규 unit 8개 모두 originalBrowserUrl 부재로 실패.
- GREEN: 기존 저장소 검증을 통과한 URL에서만 rednote 목적지를 만들고 동일 게시물 ID·토큰·출처를 유지한다. 기존 중국 사이트 선택 가능. 공격자 목적지/계정/로그인/토큰 없는 주소는 거절한다.
- E2E 기존 인증된 원문 테스트: 기본302→rednote, site=xiaohongshu→보관 원문, 임의 site→400, 공유토큰HTML비노출, no-store/no-referrer, 링크 소실 시 로컬안내. mock 외부 호출0.
- 실제 브라우저 사전 검증: 문제 표본 두 개의 기존 링크 사용. 중국 사이트와 explore 경로는 로그인에 머물렀으나 국제 사이트에서 제목·본문 일치, 영상 paused=false/readyState4/재생시각 진행 확인. 신규 유료 수집 없음. 배포 후 동일 내부 버튼으로 다시 확인해야 한다.
