# 촬영 가이드 검증

RED: shooting-guides 모듈 미구현으로 단위 테스트 로드 실패 확인. GREEN: 5분야 기본안·컷 중복/필수컷 제약 단위2 PASS. 전체 단위261 PASS(처음에는 샌드박스 loopback EPERM, 승인된 로컬 모의 테스트로 재실행 성공).

DB: 비공개 가이드 시작 차단, 검토 공개 후 시작, 소유자만 조회, 관리자 타인 메모 차단, optimistic revision, 가이드 수정 후 snapshot 유지, 기존 임시본문 보존, 중복 가져오기, 삭제 요청의 개인 촬영 기록 정리.

화면: 관리자 기본안 편집·비공개 저장·공개 → 학생 촬영 체크/메모 저장 → reload 유지 → 미촬영 필수 표시 → 기존 본문 보존 가져오기 → 다른 학생 차단. Desktop/mobile에서 axe·overflow·console 및 합성 스크린샷. CI 완료 전 DB/E2E 통과를 주장하지 않는다.
