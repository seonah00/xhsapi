import { describe,it,expect,vi } from 'vitest';
import { FactSheet, PlanContent, sectionsOf, validateContextualAi, validatePlanAi, validateReflectionAi, callTextWorkflow, type PlanAiInput, type ReflectionAiRow } from '@xhs/core';
import { validateRegister } from '../../scripts/price.ts';
const input:PlanAiInput={facts:FactSheet.parse({subject:'散步',confirmedFacts:['走过公园'],shootableScenes:['公园入口'],sponsorship:'no'}),profile:{mainTopic:'travel',tone:'plain',formats:['vlog'],audience:'散步爱好者'},references:[{id:'ref1',title:'路线',tags:['散步'],insights:['설명한 순서대로 전개']} ]};
const proposal=()=>({candidates:[{angle:'산책 순서',difference:'내 동선',neededFacts:[],difficulty:'low'}],titleOptions:['公园散步','散步记录'],content:PlanContent.parse({title:'公园散步',body:'走过公园',shots:[{scene:'公园入口',note:'입구 촬영 제안'}]}),evidenceRefs:['ref1'],missingFacts:[],notes:[]});
const rows:ReflectionAiRow[]=[{id:'post1',title:'산책',topic:'travel',format:'vlog',metrics:{likes:8,saves:2},paid:'unknown',sponsorship:'unknown',publishedAt:null,observedAt:'2026-10-07T00:00:00Z'}];
const reflection=()=>({hypotheses:[{textKo:'같은 경과 시간에 수치를 기록해 보세요.',evidenceIds:['post1'],uncertainty:'하나의 게시물로 원인을 알 수 없습니다.'}],experiments:[{change:'제목에 주제 먼저 넣기',keepConstant:'게시 주제',measure:'저장 수',when:'발행 후 같은 경과 시간',evidenceIds:['post1']}]});
describe('paid text workflows (fake API only)',()=>{
  it('creates a proposal from supplied facts and rejects invented references or numbers',()=>{
    expect(validatePlanAi(proposal(),input)).toMatchObject({kind:'proposal',evidenceRefs:['ref1']});
    expect(()=>validatePlanAi({...proposal(),titleOptions:['效果提高99%','另一个标题']},input)).toThrow('AI_INVENTED_NUMBERS');
    expect(()=>validatePlanAi({...proposal(),evidenceRefs:['ref99']},input)).toThrow('AI_EVIDENCE_INVALID');
    expect(()=>validatePlanAi(proposal(),{...input,facts:{...input.facts,sponsorship:'yes'}})).toThrow('AI_SPONSORSHIP_MISSING');
  });
  it('keeps observations deterministic, missing views missing, and links experiments to evidence',()=>{
    const out=validateReflectionAi(reflection(),rows,['snapshot-fixture']);
    expect(out.generator).toBe('openai-reflection-v1');
    expect(out.observations.join(' ')).toContain('비교하지 않았습니다');
    expect(out.experiments?.length).toBe(1);
    expect(out.limitations.join(' ')).toContain('표본이 매우 적습니다');
    const invalid=reflection(); invalid.experiments[0]!.evidenceIds=['post99'];
    expect(()=>validateReflectionAi(invalid,rows,[])).toThrow('AI_EVIDENCE_INVALID');
  });
  it('bounds and redacts payloads and never retries failed or incomplete responses',async()=>{
    const fetch=vi.fn(async()=>Response.json({choices:[{finish_reason:'stop',message:{content:JSON.stringify(proposal())}}]}));
    await callTextWorkflow({...input,profile:{...input.profile,audience:'person@example.com'}},'plan_generation',{key:'fake',model:'fixture'},fetch);
    const request=JSON.parse(String((fetch.mock.calls as unknown[][])[0]?.[1] && ((fetch.mock.calls as unknown[][])[0]![1] as RequestInit).body));
    expect(request.max_completion_tokens).toBe(6000);expect(request.store).toBe(false);
    expect(JSON.stringify(request)).not.toContain('person@example.com');
    const fail=vi.fn(async()=>new Response('',{status:500}));
    await expect(callTextWorkflow(input,'plan_generation',{key:'fake',model:'fixture'},fail)).rejects.toThrow('AI_RESPONSE_UNAVAILABLE');
    expect(fail).toHaveBeenCalledTimes(1);
    await expect(callTextWorkflow('x'.repeat(13000),'results_reflection',{key:'fake',model:'fixture'},fail)).rejects.toThrow();
    expect(fail).toHaveBeenCalledTimes(1);
  });
  it('does not allow registration of the old output ceiling',()=>{
    const opts={provider:'openai',endpoint:'AI01',model:'fixture',unit:'run','unit-cost':'0.1',currency:'USD',evidence:'synthetic evidence','verified-by':'admin@demo.invalid'};
    expect(validateRegister({...opts,'output-token-limit':'2000'}).length).toBeGreaterThan(0);
    expect(validateRegister({...opts,'output-token-limit':'6000'})).toEqual([]);
  });
});

it('anchors contextual suggestions only to unique exact text and rejects invented numbers',()=>{
 const input={sections:sectionsOf(PlanContent.parse({body:'今天很开心。今天很开心。',title:'我去公园了'})),facts:FactSheet.parse({})};
 const f={fieldKey:'title',originalSpan:'我去公园了',suggestionZh:'今天去了公园',rationaleKo:'시간 흐름을 자연스럽게 표현합니다.'};
 expect(validateContextualAi({findings:[f]},input)[0]).toMatchObject({anchored:true,start:0,end:5,ruleKey:'openai-contextual-v1'});
 expect(validateContextualAi({findings:[{...f,fieldKey:'body',originalSpan:'今天很开心。'}]},input)[0]?.anchored).toBe(false);
 expect(()=>validateContextualAi({findings:[{...f,originalSpan:'不存在'}]},input)).toThrow('AI_SPAN_INVALID');
 expect(()=>validateContextualAi({findings:[{...f,suggestionZh:'只需99元'}]},input)).toThrow('AI_INVENTED_NUMBERS');
});
