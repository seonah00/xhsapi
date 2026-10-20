import {it,expect} from 'vitest';
import {pageWindow} from '@xhs/core';
it('bounds page numbers and exposes every older item without empty out-of-range pages',()=>{
 expect(pageWindow(201,11,20)).toEqual({page:11,pages:11,total:201,limit:20,offset:200});
 expect(pageWindow(21,999,20)).toMatchObject({page:2,pages:2,offset:20});
 expect(pageWindow(0,-1,20)).toMatchObject({page:1,pages:1,offset:0,total:0});
 expect(pageWindow(21,Number.NaN,20).page).toBe(1);
});
