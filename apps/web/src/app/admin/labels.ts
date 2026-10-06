export const ROLE_LABEL: Record<string, string> = { student: '학생', reviewer: '강사', org_admin: '관리자' };
export const ACTION_LABEL: Record<string, string> = {
  'membership.insert': '멤버 추가', 'membership.update': '멤버 변경', 'membership.delete': '멤버 삭제', 'membership.left': '조직 탈퇴', 'member.password_link_issued': '비밀번호 설정 링크 발급',
  'invitations.insert': '초대 생성', 'invitations.update': '초대 사용/취소', 'invitation.redeemed': '초대 수락',
  'cohorts.insert': '기수 생성', 'cohorts.update': '기수 변경', 'cohort_members.insert': '기수 배정', 'cohort_members.update': '기수 배정 변경',
  'submission.withdrawn': '제출 철회',
};
export const INVITE_STATE: Record<string, [string, 'ok' | 'neutral' | 'warn' | 'accent']> = {
  active: ['사용 가능', 'ok'], used: ['사용됨', 'neutral'], expired: ['만료', 'warn'], revoked: ['취소됨', 'accent'],
};
