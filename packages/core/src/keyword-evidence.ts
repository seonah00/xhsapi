import { canonicalTerm, extractHashtags } from '@xhs/domain';
import type { NoteCard } from './discover.ts';

/** A provider duplicate must not count as another post or inflate engagement. */
export function uniqueKeywordNotes(notes: readonly NoteCard[]) {
  const unique=new Map<string,NoteCard>();
  for(const note of notes) {
    const key=note.platformNoteId||note.id;
    const previous=unique.get(key);
    if(!previous || (note.observedAt??'')>(previous.observedAt??'')) unique.set(key,note);
  }
  return [...unique.values()];
}
const tagKey=(term:string)=>canonicalTerm(term.normalize('NFKC').replace(/^#+|#+$/g,'').replace(/\[话题\]$/,'').trim());
function exactMedian(notes:readonly NoteCard[],key:'likes'|'saves'|'comments'|'views') {
  const values=notes.flatMap(n=>{
    const metric=n.metrics[key];
    return metric?.precision==='exact' && metric.exact!==null && Number.isFinite(metric.exact) && metric.exact>=0 ? [metric.exact] : [];
  }).sort((a,b)=>a-b);
  const middle=Math.floor(values.length/2);
  return {median:values.length?(values.length%2?values[middle]!:(values[middle-1]!+values[middle]!)/2):null,sampleSize:values.length};
}
/** Describes posts carrying this exact hashtag, never keyword search volume or causal lift. */
export function keywordEvidence(term:string,notes:readonly NoteCard[]) {
  const key=tagKey(term);
  const sample=uniqueKeywordNotes(notes);
  const matching=sample.filter(n=>{
    const text=[n.title,n.bodyExcerpt].filter(Boolean).join('\n').normalize('NFKC').replace(/https?:\/\/\S+/gi,'[링크]');
    return [...n.tags,...extractHashtags(text)].some(t=>tagKey(t)===key);
  });
  const authorCount=new Set(matching.flatMap(n=>n.authorRef?[n.authorRef]:[])).size;
  const saves=exactMedian(matching,'saves');
  const dates=matching.flatMap(n=>n.observedAt?[n.observedAt]:[]).sort();
  const published=matching.flatMap(n=>n.publishedAt?[n.publishedAt]:[]).sort();
  return {noteCount:matching.length,authorCount,sampleSize:sample.length,
    likes:exactMedian(matching,'likes'),saves,comments:exactMedian(matching,'comments'),views:exactMedian(matching,'views'),
    observedFrom:dates[0]??null,observedTo:dates.at(-1)??null,publishedFrom:published[0]??null,publishedTo:published.at(-1)??null,
    strength:matching.length>=3 && authorCount>=2 && saves.sampleSize>=3?'comparable' as const:'limited' as const};
}
