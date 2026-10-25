import {it,expect} from 'vitest';
import {restoreSelection,toggleSelection} from '../../apps/web/src/components/personal-selection-state.ts';
const tag=(n:number)=>({id:`00000000-0000-4000-a000-${String(n).padStart(12,'0')}`,term:'标签'+n,entryType:'tag' as const});
it('restores only bounded selections from the same user and organization',()=>{
 expect(restoreSelection(JSON.stringify({scope:'a',items:[tag(1),tag(1)]}),'a')).toEqual([tag(1)]);
 expect(restoreSelection(JSON.stringify({scope:'a',items:[tag(1)]}),'b')).toEqual([]);
 expect(restoreSelection('{','a')).toEqual([]);
 expect(restoreSelection(JSON.stringify({scope:'a',items:[{...tag(1),id:'invalid'}]}),'a')).toEqual([]);
});
it('keeps off-page items, toggles by id and enforces eight tags and three expressions',()=>{
 const selected=Array.from({length:8},(_,i)=>tag(i+1));
 expect(toggleSelection(selected,tag(9),true)).toEqual(selected);
 expect(toggleSelection(selected,tag(1),false)).toHaveLength(7);
 const expression={...tag(10),entryType:'expression' as const};
 expect(toggleSelection(selected,expression,true)).toHaveLength(9);
 expect(toggleSelection([expression,{...expression,id:tag(11).id},{...expression,id:tag(12).id}],{...expression,id:tag(13).id},true)).toHaveLength(3);
});
