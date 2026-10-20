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

/** Compare publication cohorts in the same collected sample, not platform-wide search volume.
 * Excludes the incomplete current Korean calendar day and missing/future publication dates. */
export function keywordTrend(term:string,notes:readonly NoteCard[],now=new Date()) {
  const day=86400_000;
  const end=Math.floor((now.getTime()+9*3600_000)/day)*day-9*3600_000;
  const recentStart=end-7*day,previousStart=end-14*day;
  const sample=uniqueKeywordNotes(notes);
  const cohort=(start:number,stop:number)=>sample.filter(n=>{
    const time=n.publishedAt?Date.parse(n.publishedAt):NaN;
    return Number.isFinite(time) && time>=start && time<stop;
  });
  const recent=keywordEvidence(term,cohort(recentStart,end));
  const previous=keywordEvidence(term,cohort(previousStart,recentStart));
  const enough=recent.sampleSize>=10 && previous.sampleSize>=10 && recent.noteCount>=3 && previous.noteCount>=3;
  const recentShare=recent.sampleSize?recent.noteCount/recent.sampleSize:null;
  const previousShare=previous.sampleSize?previous.noteCount/previous.sampleSize:null;
  const changePoints=enough?(recentShare!-previousShare!)*100:null;
  return {recent:{count:recent.noteCount,total:recent.sampleSize,share:recentShare},previous:{count:previous.noteCount,total:previous.sampleSize,share:previousShare},
    previousStart:new Date(previousStart).toISOString(),recentStart:new Date(recentStart).toISOString(),end:new Date(end).toISOString(),
    changePoints,status:!enough?'insufficient' as const:Math.abs(changePoints!)<0.01?'stable' as const:changePoints!>0?'increase' as const:'decrease' as const};
}
