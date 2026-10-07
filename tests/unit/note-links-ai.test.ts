import { describe,it,expect,vi } from 'vitest';
import { safeXhsAccessUrl } from '@xhs/security';
import { parseZenStudioNote } from '@xhs/providers';
import { callReferenceAi, type AnalysisInput } from '@xhs/core';
const id='aaaaaaaaaaaaaaaaaaaaaaaa';
const base=`https://www.xiaohongshu.com/explore/${id}`;
const input:AnalysisInput={title:'테스트 제목',body:'본문',tags:[],userText:null,userMemo:null,noteType:'video',transcript:null};
const output={observations:[{kind:'observation',textKo:'제목에 테스트가 있습니다.',evidenceIds:['title'],uncertainty:null}],inferences:[],suggestions:[],missingFacts:[]};
const fake=(o:unknown,finish='stop')=>vi.fn(async()=>Response.json({choices:[{finish_reason:finish,message:{content:JSON.stringify(o)}}]}));
describe('public sharing links',()=>{
  it('preserves supplied access parameters, strips tracking and rejects other identity/hosts',()=>{
    expect(safeXhsAccessUrl(`${base}?xsec_token=synthetic&xsec_source=pc_share&utm_source=x`,id)).toBe(`${base}?xsec_token=synthetic&xsec_source=pc_share`);
    for(const url of [base,`${base.replace(id,'b'.repeat(24))}?xsec_token=x`,'https://evil.invalid/explore/'+id+'?xsec_token=x',`https://user:pass@www.xiaohongshu.com/explore/${id}?xsec_token=x`]) expect(safeXhsAccessUrl(url,id)).toBeNull();
  });
  it('takes the documented Zen url and token without polluting canonical identity',()=>{
    const n=parseZenStudioNote([{id,type:'video',url:base,xsec_token:'synthetic'}],id);
    expect(n.canonicalUrl).toBe(base);expect(n.accessUrl).toBe(`${base}?xsec_token=synthetic`);
    expect(parseZenStudioNote([{id,type:'video',url:'https://evil.invalid',xsec_token:'synthetic'}],id).accessUrl).toBeNull();
  });
});
describe('actual AI adapter with fake fetch',()=>{
  it('sends only bounded redacted text, requests structured output and fixes scope on the server',async()=>{
    const fetch=fake(output);
    const result=await callReferenceAi({...input,userMemo:'person@example.com'}, {key:'fake',model:'test-model'},fetch);
    expect(result.generator).toBe('openai-reference-v1');expect(result.analysisScope).not.toContain('full_video');
    const request=JSON.parse(String((fetch.mock.calls as unknown[][])[0]![1] && ((fetch.mock.calls as unknown[][])[0]![1] as RequestInit).body));
    expect(request.store).toBe(false);expect(request.max_completion_tokens).toBe(2000);
    expect(JSON.stringify(request)).not.toContain('person@example.com');
  });
  it('rejects invented evidence and truncated output',async()=>{
    await expect(callReferenceAi(input,{key:'fake',model:'test'},fake({...output,observations:[{...output.observations[0],evidenceIds:['video']}] }))).rejects.toThrow('AI_EVIDENCE_INVALID');
    await expect(callReferenceAi(input,{key:'fake',model:'test'},fake(output,'length'))).rejects.toThrow('AI_INCOMPLETE');
  });
  it('does not send oversized inputs and never retries response failures',async()=>{
    const fetch=vi.fn(async()=>new Response('',{status:500}));
    await expect(callReferenceAi({...input,body:'x'.repeat(13000)},{key:'fake',model:'test'},fetch)).rejects.toThrow();expect(fetch).not.toHaveBeenCalled();
    await expect(callReferenceAi(input,{key:'fake',model:'test'},fetch)).rejects.toThrow('AI_RESPONSE_UNAVAILABLE');expect(fetch).toHaveBeenCalledTimes(1);
  });
});
