import {it,expect} from 'vitest';
import {chineseReviewKey,restoreWithSelection} from '../../apps/web/src/components/writing-completion.ts';
it('invalidates Korean review on Chinese changes but not identical content',()=>{
 const a={title:'标题',cover:'封面',body:'正文',tags:['日常']};
 expect(chineseReviewKey(a)).not.toBe(chineseReviewKey({...a,body:'新正文'}));
 expect(chineseReviewKey(a)).toBe(chineseReviewKey({...a,title:' 标题 '}));
});
it('restores body and review state while preserving the current explicit selection',()=>{
 const old={id:'old',revision:0,title:'草稿',cover:'',body:'不丢失',meaningKo:'보존',tags:['旧'],entryIds:['old'],meaningReviewedFor:'old'};
 const next=restoreWithSelection(old,[{id:'new',term:'新',entryType:'tag'}]);
 expect(next.body).toBe('不丢失');expect(next.entryIds).toEqual(['new']);expect(next.tags).toEqual(['旧','新']);
 expect(restoreWithSelection(old,[]).entryIds).toEqual(['old']);
});
