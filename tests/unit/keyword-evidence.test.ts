import { describe, expect, it } from 'vitest';
import { parseMetricValue } from '@xhs/domain';
import { keywordEvidence, type NoteCard } from '@xhs/core';
const note=(id:string,tags:string[],saves:unknown,authorRef:string|null=id):NoteCard=>({id,platformNoteId:id,title:null,bodyExcerpt:null,canonicalUrl:'',coverUrl:null,noteType:'video',authorName:null,authorRef,authorFollowers:null,publishedAt:'2026-01-01T00:00:00Z',observedAt:'2026-01-02T00:00:00Z',dataMode:'mock',topics:[],formats:[],tags,metrics:{saves:parseMetricValue(saves)},saved:false});
describe('keyword performance evidence',()=>{
 it('uses exact tags, distinct platform posts and distinct known authors',()=>{
  const a=note('a',['防晒','防晒'],10,'same');
  const r=keywordEvidence('防晒',[a,{...a,id:'duplicate'},note('b',['防晒霜'],999),note('c',[],20)]);
  expect(r.noteCount).toBe(1);expect(r.authorCount).toBe(1);expect(r.saves).toEqual({median:10,sampleSize:1});expect(r.strength).toBe('limited');
 });
 it('counts body hashtags but never ordinary prose as hashtag evidence',()=>{
  expect(keywordEvidence('敏感肌',[{...note('a',[],1),bodyExcerpt:'＃敏感肌[话题]＃'}, {...note('b',[],99),title:'敏感肌的日常'}]).noteCount).toBe(1);
 });
 it('keeps unknown and rounded metrics out of exact medians; zero remains valid',()=>{
  const r=keywordEvidence('防晒',[note('a',['防晒'],0),note('b',['防晒'],null),note('c',['防晒'],'1.2万'),note('d',['防晒'],20)]);
  expect(r.saves).toEqual({median:10,sampleSize:2});expect(r.views).toEqual({median:null,sampleSize:0});expect(r.strength).toBe('limited');
 });
 it('uses medians and only declares a comparable sample with enough posts, authors and exact save counts',()=>{
  const rows=[note('a',['防晒'],10),note('b',['防晒'],20),note('c',['防晒'],999999)];
  expect(keywordEvidence('防晒',rows)).toMatchObject({strength:'comparable',noteCount:3,authorCount:3,saves:{median:20,sampleSize:3},observedTo:'2026-01-02T00:00:00Z'});
  expect(keywordEvidence('防晒',rows.map(n=>({...n,authorRef:null}))).strength).toBe('limited');
 });
 it('prefers the newest observation when a post exists in multiple providers',()=>{
  const a=note('a',['防晒'],10);
  const newer={...a,id:'newer',observedAt:'2026-02-01T00:00:00Z',metrics:{saves:parseMetricValue(30)}};
  expect(keywordEvidence('防晒',[a,newer]).saves.median).toBe(30);
  expect(keywordEvidence('防晒',[newer,a]).saves.median).toBe(30);
 });
});
