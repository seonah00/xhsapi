import { z } from 'zod';
import { describe, expect, it, vi } from 'vitest';
import { callLanguageAi, validateLanguageOutput, supportedLanguageOutput, languageFailureCode, LanguageScope, type LanguageInput } from '@xhs/core';
const input:LanguageInput={task:'interpret',notes:[{alias:'n1',title:'这家店绝绝子',body:'雨天遛娃YYDS',tags:['亲子游']}]};
const output={translations:[],expressions:[{term:'绝绝子',meaningKo:'아주 좋다는 감탄',usageKo:'가게를 칭찬하는 문맥',cautionKo:'반어적 용법도 있으므로 문맥 확인',confidence:'medium',evidence:[{alias:'n1',quote:'这家店绝绝子'}]}]};
describe('search language AI',()=>{
 it('requires actual term and quote from an authorized note alias',()=>{
  expect(validateLanguageOutput(output,input).expressions).toHaveLength(1);
  for(const evidence of [[{alias:'n2',quote:'这家店绝绝子'}],[{alias:'n1',quote:'假的绝绝子'}],[{alias:'n1',quote:'雨天遛娃YYDS'}]]) {
   expect(()=>validateLanguageOutput({...output,expressions:[{...output.expressions[0],evidence}]},input)).toThrow('AI_EVIDENCE_INVALID');
  }
 });
 it('rejects invented or duplicate terms and Korean search output',()=>{
  expect(()=>validateLanguageOutput({...output,expressions:[output.expressions[0],output.expressions[0]]},input)).toThrow();
  expect(()=>validateLanguageOutput({translations:[{zh:'한국 여행',meaningKo:'test'}],expressions:[]},{task:'translate',notes:[],query:'한국 여행'})).toThrow();
  expect(LanguageScope.safeParse({task:'interpret',noteIds:[]}).success).toBe(false);
 });
 it('accepts an honest empty interpretation and Chinese translation options',()=>{
  expect(validateLanguageOutput({translations:[],expressions:[]},input).expressions).toEqual([]);
  expect(validateLanguageOutput({translations:[{zh:'首尔 雨天 亲子 室内',meaningKo:'서울 비 오는 날 아이와 실내 활동'}],expressions:[]},{task:'translate',notes:[],query:'비 오는 날 서울에서 아이와 실내에서 할 것'}).translations).toHaveLength(1);
 });
 it('keeps independently grounded candidates and never fabricates evidence',()=>{
  const unsupported={...output.expressions[0],term:'假的',evidence:[{alias:'n1',quote:'假的文句'}]};
  expect(supportedLanguageOutput({...output,expressions:[unsupported,...output.expressions,output.expressions[0]]},input)).toEqual({...output,omittedExpressions:2});
  expect(()=>supportedLanguageOutput({...output,expressions:[unsupported]},input)).toThrow('AI_EVIDENCE_INVALID');
  expect(languageFailureCode(new Error('AI_INCOMPLETE'))).toBe('AI_INCOMPLETE');
  expect(languageFailureCode(new Error('private provider response'))).toBe('AI_RESULT_NEEDS_REVIEW');
 });
 it('uses a separate translation-only response schema',async()=>{
  const translations=[{zh:'防晒霜推荐',meaningKo:'선크림 추천'}];
  const fetcher=vi.fn(async()=>new Response(JSON.stringify({choices:[{finish_reason:'stop',message:{content:JSON.stringify({translations})}}]})));
  expect(await callLanguageAi({task:'translate',query:'선크림추천',notes:[]},{key:'synthetic',model:'fixture'},fetcher as typeof fetch)).toEqual({translations,expressions:[]});
  const args=fetcher.mock.calls as unknown as [string,RequestInit][];
  expect(JSON.parse(String(args[0]![1].body)).response_format.json_schema.schema.required).toEqual(['translations']);
 });
 it('uses injected fetch, structured output, no retention; rejects incomplete response',async()=>{
  const fetcher=vi.fn(async()=>new Response(JSON.stringify({choices:[{finish_reason:'stop',message:{content:JSON.stringify({expressions:output.expressions})}}]})));
  expect(await callLanguageAi(input,{key:'synthetic',model:'fixture'},fetcher as typeof fetch)).toEqual(output);
  const args=fetcher.mock.calls as unknown as [string,RequestInit][];
  const body=JSON.parse(String(args[0]![1].body));
  expect(body.response_format.json_schema.schema.required).toEqual(['expressions']);
  expect(body.messages[0].content).not.toContain('한국어 자유문장');
  expect(body.store).toBe(false);expect(body.response_format.json_schema.strict).toBe(true);
  await expect(callLanguageAi(input,{key:'synthetic',model:'fixture'},async()=>new Response(JSON.stringify({choices:[{finish_reason:'length',message:{content:JSON.stringify({expressions:output.expressions})}}]})))).rejects.toThrow('AI_INCOMPLETE');
 });
});

it('records only allowlisted schema paths and codes, never values or arbitrary field names',()=>{
 const error=new z.ZodError([{code:'custom',path:['keywords',0,'term'],message:'private output'}]);
 expect(languageFailureCode(error)).toBe('AI_OUTPUT_SCHEMA_INVALID:keywords.item.term:custom');
 const privatePath=new z.ZodError([{code:'custom',path:['secret@example.com'],message:'private output'}]);
 expect(languageFailureCode(privatePath)).toBe('AI_OUTPUT_SCHEMA_INVALID:field:custom');
});

it('isolates malformed expression candidates and constrains provider aliases',async()=>{
 const valid={term:'绝绝子',meaningKo:'감탄',usageKo:'칭찬',cautionKo:'문맥 확인',confidence:'medium',evidence:[{alias:'n1',quote:'这家店绝绝子'}]};
 const malformed={...valid,meaningKo:null};
 const fetcher=vi.fn(async()=>new Response(JSON.stringify({choices:[{finish_reason:'stop',message:{content:JSON.stringify({expressions:[malformed,valid]})}}]})));
 const result=await callLanguageAi(input,{key:'synthetic',model:'fixture'},fetcher as typeof fetch);
 expect(result.expressions).toEqual([valid]);expect(result.omittedExpressions).toBe(1);
 const args=fetcher.mock.calls as unknown as [string,RequestInit][];
 expect(JSON.parse(String(args[0]![1].body)).response_format.json_schema.schema.properties.expressions.items.properties.evidence.items.properties.alias.enum).toEqual(['n1']);
 expect(()=>supportedLanguageOutput({translations:[],expressions:[malformed]},input)).toThrow();
});
