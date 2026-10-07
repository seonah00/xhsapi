import { REFERENCE_SECTIONS } from '@xhs/core';
export function detailedAiFixture(field:'title'|'userText'='title',text='테스트 제목') {
  return {sections:REFERENCE_SECTIONS.map(key=>({key,status:key==='tags'||key==='structure'&&field==='title'?'insufficient':'analyzed',claims:key==='tags'||key==='structure'&&field==='title'?[]:[{kind:key==='audience'?'inference':key==='adaptation'?'suggestion':'observation',textKo:'합성 자료를 근거로 한 설명입니다.',evidenceIds:[field],uncertainty:key==='audience'?'실제 독자는 확인하지 않았습니다.':null}],quotes:key==='wording'?[{field,text,meaningKo:'테스트 표현',explanationKo:'입력 문구에 대한 설명'}]:[],missingReason:key==='tags'||key==='structure'&&field==='title'?'자료가 제공되지 않았습니다.':null})),missingFacts:['실제 촬영 방식은 확인할 수 없습니다.']};
}
