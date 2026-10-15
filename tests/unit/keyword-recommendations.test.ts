import { describe, expect, it } from 'vitest';
import { recommendKeywords, type NoteCard, type SharedDictionaryEntry } from '@xhs/core';
const entry: SharedDictionaryEntry = { id: 'dictionary-id', entryType: 'tag', term: '防晒霜', meaning: '선크림', type: 'tag', categories: [], groups: [], cautions: ['확인'], observedCount: 999, unknownTrendNote: null };
describe('keyword recommendations', () => {
  it('includes dictionary definitions without turning historical counts into live evidence', () => {
    const result = recommendKeywords('선크림추천', [], [entry]);
    expect(result.items.find(t => t.term === '防晒霜')).toMatchObject({ dictionaryIds: ['dictionary-id'], meaning: '선크림', noteCount: 0, evidence: [] });
    expect(result.items.find(t => t.term === '敏感肌防晒霜推荐')).toMatchObject({ group: 'longTail', suggested: true, noteCount: 0 });
  });
  it('does not insert Korean destinations into unrelated travel searches', () => {
    expect(recommendKeywords('日本旅行', [], []).items.some(t => /韩国|首尔/.test(t.term))).toBe(false);
    expect(recommendKeywords('한국여행', [], []).items.some(t => t.term === '韩国亲子旅行攻略')).toBe(true);
  });
  it('classifies a longer observed topic phrase as long-tail without AI and attaches real metrics', () => {
    const note:NoteCard={id:'synthetic',platformNoteId:'synthetic',title:'真实标签',bodyExcerpt:null,canonicalUrl:'',coverUrl:null,noteType:'image',authorName:null,authorRef:'a',authorFollowers:null,publishedAt:null,observedAt:null,dataMode:'mock',topics:[],formats:[],tags:['上班族低糖便当'],metrics:{},saved:false};
    expect(recommendKeywords('低糖便当',[note],[]).items.find(t=>t.term==='上班族低糖便当')).toMatchObject({group:'longTail',noteCount:1,performance:{noteCount:1,views:{median:null,sampleSize:0}}});
  });
  it('does not fabricate a translation for unknown Korean input', () => {
    expect(recommendKeywords('아무단어', [], [entry]).items).toEqual([]);
  });
});
