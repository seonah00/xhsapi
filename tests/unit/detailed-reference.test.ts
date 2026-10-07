import { describe, it, expect, vi } from 'vitest';
import { callReferenceAi, analyzeReference, REFERENCE_SECTIONS, type AnalysisInput } from '@xhs/core';

const input: AnalysisInput = {title:'首尔散步路线｜收藏备用',body:'先去公园，再去咖啡店。你喜欢哪里？',tags:['首尔','散步'],userText:null,userMemo:null,noteType:'video',transcript:null};
const response = () => ({ sections: REFERENCE_SECTIONS.map(key => ({key, status:'analyzed', claims:[{kind:key==='adaptation'?'suggestion':key==='audience'?'inference':'observation',textKo:'입력 문구를 근거로 구성과 적용 방법을 설명합니다.',evidenceIds:['title'],uncertainty:key==='audience'?'독자의 실제 특성은 확인되지 않았습니다.':null}], quotes:key==='wording'?[{field:'title',text:'收藏备用',meaningKo:'나중에 쓰도록 저장',explanationKo:'저장 행동을 유도하는 표현입니다.'}]:[], missingReason:null})),missingFacts:['촬영 방식은 확인할 수 없습니다.']});
const fake=(data:unknown)=>vi.fn(async()=>Response.json({choices:[{finish_reason:'stop',message:{content:JSON.stringify(data)}}]}));

describe('detailed text reference analysis',()=>{
  it('returns all eight sections and literal phrases with Korean explanations',async()=>{
    const fetch=fake(response());
    const result=await callReferenceAi(input,{key:'fake',model:'fixture'},fetch);
    expect(result.sections?.map(s=>s.key)).toEqual(REFERENCE_SECTIONS);
    expect(result.generator).toBe('openai-reference-v2');
    expect(result.sections?.find(s=>s.key==='wording')?.quotes[0]?.text).toBe('收藏备用');
    expect(result.suggestions.length).toBeGreaterThan(0);
    const req=JSON.parse(String((fetch.mock.calls as unknown[][])[0]?.[1] && ((fetch.mock.calls as unknown[][])[0]![1] as RequestInit).body));
    expect(req.max_completion_tokens).toBe(6000);
    expect(result.limitations.join(' ')).toContain('촬영');
  });
  it('rejects invented quotes, duplicate sections, missing evidence, and empty applications',async()=>{
    const invented=response(); invented.sections.find(s=>s.key==='wording')!.quotes[0]!.text='不存在的文案';
    await expect(callReferenceAi(input,{key:'fake',model:'fixture'},fake(invented))).rejects.toThrow('AI_QUOTE_INVALID');
    const duplicate=response(); duplicate.sections[1]=duplicate.sections[0]!;
    await expect(callReferenceAi(input,{key:'fake',model:'fixture'},fake(duplicate))).rejects.toThrow('AI_SECTIONS_INVALID');
    const absent=response(); absent.sections[0]!.claims[0]!.evidenceIds=['userText'];
    await expect(callReferenceAi(input,{key:'fake',model:'fixture'},fake(absent))).rejects.toThrow('AI_EVIDENCE_INVALID');
    const empty=response(); empty.sections.find(s=>s.key==='adaptation')!.claims=[];
    await expect(callReferenceAi(input,{key:'fake',model:'fixture'},fake(empty))).rejects.toThrow();
  });
  it('requires absent body and tags to be marked insufficient instead of inventing them',async()=>{
    await expect(callReferenceAi({...input,body:null,tags:[]},{key:'fake',model:'fixture'},fake(response()))).rejects.toThrow('AI_SOURCE_MISSING');
  });
  it('has honest detailed demo sections and uses the correct pasted-text evidence id',()=>{
    const result=analyzeReference({...input,title:null,body:null,userText:'这是正文',tags:[]});
    expect(result.sections?.find(s=>s.key==='tags')?.status).toBe('insufficient');
    expect(result.observations.flatMap(s=>s.evidenceIds)).not.toContain('body');
    expect(result.sections?.find(s=>s.key==='wording')?.quotes[0]?.field).toBe('userText');
  });
});
