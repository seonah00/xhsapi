import { describe, expect, it, vi } from 'vitest';
import { callLanguageAi, ExpandedKeywords, LanguageScope, mergeExpandedKeywords, recommendKeywords, type LanguageInput } from '@xhs/core';
const keywords=[
 {term:'低糖便当',group:'core',meaningKo:'저당 도시락',reasonKo:'검색 주제'},
 {term:'便当食谱',group:'related',meaningKo:'도시락 레시피',reasonKo:'연관 소재'},
 {term:'上班族低糖便当',group:'longTail',meaningKo:'직장인 저당 도시락',reasonKo:'직장인 대상이라는 선택 가능한 가설'},
];
describe('general keyword expansion',()=>{
 it('supports a new topic through a distinct structured AI contract',async()=>{
  const input:LanguageInput={task:'expand',query:'저당 도시락',notes:[],dictionary:[]};
  const fake=vi.fn(async()=>new Response(JSON.stringify({choices:[{finish_reason:'stop',message:{content:JSON.stringify({keywords})}}]})));
  const result=await callLanguageAi(input,{key:'fixture',model:'fixture'},fake as typeof fetch);
  expect(result.keywords).toEqual(keywords);
  const body=JSON.parse(String((fake.mock.calls as unknown as [string,RequestInit][])[0]![1].body));
  expect(body.response_format.json_schema.schema.required).toEqual(['keywords']);
  expect(body.store).toBe(false);
  expect(LanguageScope.parse({task:'expand',query:'저당 도시락'})).toMatchObject({noteIds:[]});
 });
 it('cannot promote AI suggestions into observed counts, dictionary evidence or popularity',()=>{
  const result=mergeExpandedKeywords(recommendKeywords('低糖便当',[],[]),keywords);
  expect(result.items.find(k=>k.term==='上班族低糖便当')).toMatchObject({noteCount:0,evidence:[],dictionaryIds:[],suggested:true,group:'longTail'});
  expect(()=>mergeExpandedKeywords(result,[{...keywords[0],noteCount:999},...keywords.slice(1)])).toThrow();
 });
 it('rejects duplicate, missing-group, URL and Korean keyword output',()=>{
  for(const bad of [[keywords[0],keywords[0],keywords[2]],[keywords[0],keywords[1],{...keywords[2],term:'한국어'}],[keywords[0],keywords[1],{...keywords[2],term:'https://example.com'}]]) expect(ExpandedKeywords.safeParse(bad).success).toBe(false);
 });
});
