export const PLAN_STATUS: Record<string, string> = {
  draft: '초안', planned: '기획 완료', filming: '촬영 중', ready: '발행 준비', user_marked_published: '발행함(직접 표시)', archived: '보관',
};
export const SUBMISSION_STATUS: Record<string, [string, 'neutral' | 'info' | 'warn' | 'ok' | 'accent']> = {
  submitted: ['제출됨', 'info'], in_review: ['검토 중', 'info'], changes_requested: ['수정 요청', 'warn'], feedback_complete: ['피드백 완료', 'ok'], withdrawn: ['철회됨', 'neutral'],
};
export const FINDING_LABEL: Record<string, string> = {
  absolute_or_exaggerated_claim: '단정·과장 표현', unsupported_health_claim: '근거 없는 효능·건강 주장', fact_mismatch: '사실 불일치', title_body_mismatch: '제목-본문 불일치',
  sponsorship_review_needed: '광고·협찬 확인 필요', personal_information: '개인정보', child_privacy: '아동 개인정보', unrelated_tag: '관련 약한 태그',
  language_awkwardness: '어색한 표현', source_uncertain: '출처 불확실',
};
export const SEVERITY: Record<string, [string, 'accent' | 'warn' | 'info' | 'neutral']> = {
  high: ['높음', 'accent'], medium: ['중간', 'warn'], low: ['낮음', 'info'], info: ['참고', 'neutral'],
};
export const FIELD_LABEL: Record<string, string> = { title: '제목', cover: '표지 문구', body: '본문', tags: '해시태그', subtitles: '자막', document: '문서 전체' };
