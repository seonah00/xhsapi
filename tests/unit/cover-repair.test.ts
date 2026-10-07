import { expect, it } from 'vitest';
import { repairableCoverIds } from '../../apps/web/src/components/cover-repair-state.ts';

it('includes missing URLs and browser failures, excludes working and stale failures', () => {
  expect(repairableCoverIds([
    {id:'missing',coverUrl:null}, {id:'broken',coverUrl:'https://cdn/broken'},
    {id:'ok',coverUrl:'https://cdn/ok'}, {id:'updated',coverUrl:'https://cdn/new'},
  ], {broken:'https://cdn/broken',updated:'https://cdn/old',other:'https://cdn/other'})).toEqual(['missing','broken']);
});
it('never selects more than the allowed 50 notes', () => {
  expect(repairableCoverIds(Array.from({length:60},(_,i)=>({id:String(i),coverUrl:null})),{})).toHaveLength(50);
});
