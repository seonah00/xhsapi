export const TOPIC_LABEL: Record<string, string> = {
  beauty: '뷰티', 'daily-life': '일상', parenting: '육아', 'food-places': '맛집·카페', 'travel-outing': '여행·외출', fashion: '패션',
};
export const FORMAT_LABEL: Record<string, string> = {
  vlog: '브이로그', review: '리뷰', comparison: '비교', routine: '루틴', 'how-to': '방법 소개', 'information-list': '정보 정리', story: '이야기', 'photo-diary': '사진 일기',
};
export const PROVENANCE_LABEL: Record<string, string> = {
  observed_tag: '관찰된 해시태그', observed_phrase: '관찰된 표현', provider_related_term: '공급자 연관어', editorial_seed: '편집 시드',
  ai_suggestion: 'AI 제안(미검수)', official_search_metric: '공식 검색 지표',
};
export const EXPR_TYPE_LABEL: Record<string, string> = { basic: '기본 표현', observed_recent: '관찰된 최근 표현', trend_unverified: '유행 여부 미확인' };
export const TRANSCRIPT_STATUS_LABEL: Record<string, string> = {
  queued: '대기 중', submitted: '제출됨', processing: '처리 중', succeeded: '완료', failed: '실패', no_speech: '말소리 없음', unknown_outcome: '결과 확인 필요',
};
export const FAIL_LABEL: Record<string, string> = {
  provider_failed: '공급자 처리 실패', not_video: '영상 노트가 아님', no_speech_detected: '말소리를 찾지 못함', unknown: '원인 미확인', permission_revoked: '권한 철회',
};

export function topicLabel(s: string) { return TOPIC_LABEL[s] ?? s; }
export function formatLabel(s: string) { return FORMAT_LABEL[s] ?? s; }

export function fmtDate(iso: string | null | undefined, withTime = false): string {
  if (!iso) return '미확인';
  const d = new Date(iso);
  return new Intl.DateTimeFormat('ko-KR', { timeZone: 'Asia/Seoul', year: 'numeric', month: 'short', day: 'numeric', ...(withTime ? { hour: '2-digit', minute: '2-digit' } : {}) }).format(d);
}
