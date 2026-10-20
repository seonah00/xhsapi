import {describe,it,expect} from 'vitest';
import {TemporaryWritingInput,PersonalEditInput} from '@xhs/core';
const id='40000000-0000-4000-8000-000000000001';
describe('private working copy validation',()=>{
 it('accepts partial writing but limits payloads and scopes',()=>{
  const input={scope:'new',version:0,content:{id,revision:0,title:'',cover:'',body:'未完成',meaningKo:'',tags:[],entryIds:[]}};
  expect(TemporaryWritingInput.parse(input).content.body).toBe('未完成');
  expect(()=>TemporaryWritingInput.parse({...input,scope:'another-user'})).toThrow();
  expect(()=>TemporaryWritingInput.parse({...input,content:{...input.content,body:'x'.repeat(10001)}})).toThrow();
 });
 it('validates personal usage and bilingual examples without changing provenance',()=>{
  const input={id,revision:1,meaning:'뜻 수정',note:'개인 메모',folder:'뷰티',favorite:true,usage:'일상 기록에 사용',examples:[{zh:'记录今天的小事。',ko:'오늘의 작은 일을 기록해요.'}]};
  expect(PersonalEditInput.parse(input).examples).toHaveLength(1);
  expect(()=>PersonalEditInput.parse({...input,sourceKind:'observed'})).toThrow();
  expect(()=>PersonalEditInput.parse({...input,examples:Array(11).fill(input.examples[0])})).toThrow();
 });
});
