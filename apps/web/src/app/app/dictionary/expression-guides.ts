/** Original teaching examples, not quotes, popularity claims, or user experiences. */
export type ExpressionGuide = { situation: string; nuance: string; avoid: string; zh: string; ko: string };
const GUIDES: Record<string, ExpressionGuide> = {
  '清透感': { situation: '메이크업의 맑고 가벼운 인상을 설명할 때', nuance: '투명하게 비치는 듯한 시각적 인상입니다. 피부 치료나 제품 효능을 뜻하지 않습니다.', avoid: '清透感을 치료 효과나 피부 개선 보장과 연결하지 마세요.', zh: '今天想尝试清透感妆容。', ko: '오늘은 맑고 가벼운 느낌의 메이크업을 시도해 보고 싶어요.' },
  '松弛感': { situation: '힘을 빼고 여유로운 옷차림·생활 분위기를 설명할 때', nuance: '태도나 연출에서 느껴지는 자연스러운 여유입니다. 무성의함과는 다릅니다.', avoid: '피부가 처진다는 뜻의 松弛와 같은 의미로 사용하지 마세요.', zh: '想记录一个有松弛感的周末。', ko: '여유로운 분위기의 주말을 기록해 보고 싶어요.' },
  '氛围感': { situation: '빛·색·배경이 만드는 전체 분위기를 설명할 때', nuance: '특정 사물 하나보다 전체적인 느낌에 초점이 있습니다.', avoid: '무엇이 분위기를 만드는지 없이 모든 문장에 반복하면 설명이 모호해집니다.', zh: '想用自然光拍出温柔的氛围感。', ko: '자연광으로 부드러운 분위기를 담아 보고 싶어요.' },
  'bb们': { situation: '친근한 말투로 독자들에게 말을 걸 때', nuance: '宝贝们을 줄인 친밀한 호칭입니다. 공식 안내보다 가벼운 소통에 어울립니다.', avoid: '공식 공지나 처음 만나는 업무 상대에게 무조건 쓰는 호칭은 아닙니다.', zh: 'bb们，你们周末有什么计划？', ko: '여러분, 주말에 어떤 계획이 있나요?' },
  '7刷': { situation: '같은 콘텐츠를 일곱 번 보거나 장소를 일곱 번째 방문한 실제 경험을 말할 때', nuance: '숫자에 반복 횟수라는 사실 주장이 들어 있습니다.', avoid: '단순히 좋다는 강조로 쓰지 마세요. 일곱 번째라는 사실을 확인해야 합니다.', zh: '这是我第七次来这家店。', ko: '이 가게에 일곱 번째로 왔어요. (실제 횟수가 맞을 때만 사용)' },
  'GRWM': { situation: '외출·출근 준비 과정을 순서대로 보여줄 때', nuance: 'Get Ready With Me, 함께 준비하는 형식입니다. 완성된 모습만 보여주는 것과 구분됩니다.', avoid: '준비 과정이 없는 콘텐츠에 형식과 무관하게 붙이지 마세요.', zh: 'GRWM｜一起准备出门吧。', ko: 'GRWM | 함께 외출 준비해요.' },
};

export function expressionGuide(term: string): ExpressionGuide | undefined {
  const key = term === 'grwm' ? 'GRWM' : term;
  return Object.hasOwn(GUIDES, key) ? GUIDES[key] : undefined;
}

export function appendPractice(body: string, sentence: string): string {
  return [body.trim(), sentence.trim()].filter(Boolean).join('\n');
}
