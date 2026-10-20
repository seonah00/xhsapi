import { expect,it } from 'vitest';
import { keywordTrend,type NoteCard } from '@xhs/core';
const now=new Date('2026-10-20T01:00:00Z');
const note=(id:string,date:string|null,tag=true):NoteCard=>({id,platformNoteId:id,title:null,bodyExcerpt:null,canonicalUrl:'',coverUrl:null,noteType:null,authorName:null,authorRef:id,authorFollowers:null,publishedAt:date,observedAt:now.toISOString(),dataMode:'mock',topics:[],formats:[],tags:tag?['防晒']:[],metrics:{},saved:false});
it('compares exact tag shares rather than unequal raw sample sizes',()=>{
 const previous=Array.from({length:10},(_,i)=>note('p'+i,'2026-10-09T00:00:00Z',i<3));
 const recent=Array.from({length:20},(_,i)=>note('r'+i,'2026-10-17T00:00:00Z',i<12));
 const result=keywordTrend('防晒',[...previous,...recent],now);
 expect(result.status).toBe('increase');expect(result.changePoints).toBeCloseTo(30);
 expect(result.previous).toMatchObject({count:3,total:10});expect(result.recent).toMatchObject({count:12,total:20});
});
it('excludes today, missing/future dates and duplicate posts at Korean midnight boundaries',()=>{
 const sample=[note('a','2026-10-19T14:59:59Z'),note('b','2026-10-19T15:00:00Z'),note('c',null),note('d','bad'),note('e','2026-10-21T00:00:00Z')];
 const result=keywordTrend('防晒',[...sample,{...sample[0]!,id:'duplicate'}],now);
 expect(result.recent.total).toBe(1);expect(result.previous.total).toBe(0);expect(result.status).toBe('insufficient');expect(result.changePoints).toBeNull();
});
it('never reports infinite growth from zero or insufficient baselines',()=>{
 const rows=Array.from({length:20},(_,i)=>note(String(i),i<10?'2026-10-09T00:00:00Z':'2026-10-17T00:00:00Z',i>=10));
 expect(keywordTrend('防晒',rows,now)).toMatchObject({status:'insufficient',changePoints:null});
});
