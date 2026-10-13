import { describe, expect, it } from 'vitest';
import { analyzeSearchLanguage, chineseSearchCandidate, isChineseSearch, type NoteCard, type SharedDictionaryEntry } from '@xhs/core';
const note = (id:string, text:string, tags:string[]=[], authorRef:string|null='author'): NoteCard => ({
 id, platformNoteId:id, title:text,bodyExcerpt:null,tags,authorRef,authorName:null,canonicalUrl:'',coverUrl:null,noteType:null,authorFollowers:null,publishedAt:null,observedAt:'2026-10-13T00:00:00Z',dataMode:'live',topics:[],formats:[],metrics:{},saved:false,
});
const definition: SharedDictionaryEntry = {id:'d',entryType:'expression',term:'YYDS',meaning:'최고라는 감탄 표현',type:'줄임말',categories:[],groups:[],cautions:['문맥 확인'],observedCount:999,unknownTrendNote:null};
describe('search language evidence',()=>{
 it('preserves combined intent and refuses partial Korean translation',()=>{
  expect(chineseSearchCandidate('성수동 카페').text).toBe('圣水洞 咖啡店');
  expect(chineseSearchCandidate('한국 여행').text).toBe('韩国 旅行');
  expect(chineseSearchCandidate('모르는단어 카페')).toEqual({text:'',unmatched:['모르는단어']});
  expect(isChineseSearch('한국')).toBe(false);
  expect(isChineseSearch('圣水洞 咖啡店')).toBe(true);
 });
 it('deduplicates platform IDs and counts notes, never dictionary popularity',()=>{
  const a=note('a','#咖啡[话题]# #咖啡[话题]# yyds yyds',['咖啡']);
  const data=analyzeSearchLanguage([a,{...a,id:'duplicate'},note('b','这家YYDS',['咖啡'],null)],[definition]);
  expect(data.sampleSize).toBe(2);
  expect(data.tags[0]).toMatchObject({term:'咖啡',noteCount:2,authorCount:1});
  expect(data.expressions[0]).toMatchObject({noteCount:2,meaning:definition.meaning});
  expect(data.expressions[0]?.examples).toHaveLength(2);
 });
 it('does not invent tags from prose or report unobserved dictionary expressions',()=>{
  const data=analyzeSearchLanguage([note('a','咖啡真的很好喝 AY YydsPlus')],[definition]);
  expect(data.tags).toHaveLength(0);
  expect(data.expressions.some(x=>x.term.toLowerCase()==='yyds')).toBe(false);
  expect(data.expressions.find(x=>x.term==='AY')?.meaning).toBeNull();
 });
 it('matches literal dictionary punctuation safely',()=>{
  const data=analyzeSearchLanguage([note('a','真的 A+B 太好了')],[{...definition,term:'A+B'}]);
  expect(data.expressions.find(x=>x.term==='A+B')?.noteCount).toBe(1);
 });
});
