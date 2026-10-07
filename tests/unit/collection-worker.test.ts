import { beforeEach, describe, expect, it, vi } from 'vitest';
import { loadEnv, parseMetricValue } from '@xhs/domain';
import { MockXhsProvider, type ProviderNote } from '@xhs/providers';
import { runJob, type JobRow, type Runner } from '../../packages/core/src/jobs.ts';
import { enrichmentOptions, storeEnrichment } from '../../packages/core/src/note-enrichment.ts';
import { ingestSearchResult } from '../../packages/core/src/ingest.ts';

vi.mock('../../packages/core/src/note-enrichment.ts', () => ({ enrichmentOptions:vi.fn(),storeEnrichment:vi.fn() }));
vi.mock('../../packages/core/src/ingest.ts', () => ({ ingestSearchResult:vi.fn() }));
vi.mock('../../packages/core/src/live.ts', async importOriginal => ({...await importOriginal<typeof import('../../packages/core/src/live.ts')>(),liveGateForJob:vi.fn(async()=>({}))}));
const ids = ['00000000-0000-4000-a000-000000000001','00000000-0000-4000-a000-000000000002'];
const note: ProviderNote = { platformNoteId:'aaaaaaaaaaaaaaaaaaaaaaaa',canonicalUrl:'https://www.xiaohongshu.com/explore/aaaaaaaaaaaaaaaaaaaaaaaa',title:'synthetic',bodyExcerpt:null,noteType:'image',author:{ref:null,displayName:'synthetic',followers:parseMetricValue(null)},publishedAt:null,providerSnapshotAt:null,providerTags:[],topics:[],formats:[],metrics:{likes:parseMetricValue(1),saves:parseMetricValue(null),comments:parseMetricValue(null),shares:parseMetricValue(null),views:parseMetricValue(null)},coverUrl:'https://sns-na-i4.xhscdn.com/synthetic.jpg'};
function harness(kind: 'provider_search'|'note_enrichment') {
  const job: JobRow & {provider_task_id?:string|null;state?:string} = {id:'job',org_id:'org',owner_user_id:'user',kind,data_mode:'live',input_ref:kind==='provider_search'?{query:'test',targetCount:50}:{noteIds:ids},attempts:0,reserved_usage_id:'ledger',created_at:new Date()};
  let killed = false;
  const settlements: unknown[][] = [];
  const query = vi.fn(async (sql:string,args:unknown[] = []) => {
    let rows: unknown[] = [];
    if (sql.includes('app.claim_job')) rows=[{ok:true}];
    else if (sql.startsWith('select * from app_jobs')) rows=[structuredClone(job)];
    else if (sql.startsWith('select provider_task_id')) rows=[{provider_task_id:job.provider_task_id}];
    else if (sql.startsWith('select result_ref')) rows=[{result_ref:job.result_ref}];
    else if (sql.includes('select settings')) rows=[{settings:{provider_switches:{kill:killed}}}];
    else if (sql.startsWith('select n.id from notes')) rows = (args[1] as string[]).filter(id=>Number(id)%2===0).map(id=>({id}));
    else if (sql.includes('from memberships')) rows=[{}];
    else if (sql.includes('from provider_permissions')) rows=[{id:'permission',allow_excerpt_display:true,allow_media_display:true}];
    else if (sql.includes('app.settle_usage')) settlements.push(args);
    else if (sql.includes("provider_task_id='")) job.provider_task_id='started';
    else if (sql.includes('provider_task_id=null')) { job.provider_task_id=null; job.result_ref=args[1] as Record<string,unknown>; }
    else if (sql.includes("state = 'waiting_external'")) job.state='waiting_external';
    else if (sql.includes('set state = $2')) { job.state=String(args[1]); if(args[3])job.result_ref=args[3] as Record<string,unknown>; }
    else throw new Error(`Unexpected test SQL: ${sql}`);
    return {rows,rowCount:rows.length};
  });
  const service:Runner=fn=>fn({query} as never);
  return {job,service,settlements,kill:()=>{killed=true;}};
}
beforeEach(()=>vi.clearAllMocks());

describe('paid batch worker checkpoints (fake DB and fake provider)',()=>{
  it('continues at offsets 0/20/40 after checkpointing and settles only three units',async()=>{
    const h=harness('provider_search');
    const provider=new MockXhsProvider();
    const search=vi.spyOn(provider,'searchNotes').mockImplementation(async input=>({mode:'live',endpoint:'RF02',fetchedAt:new Date().toISOString(),notes:[note],latestHotArticles:[],relatedTerms:[],coverage:{requestedPages:1,fetchedPages:1,postFilters:[],hasMore:true,rawCount:20,pageFingerprint:String(input.offset)}}));
    vi.mocked(ingestSearchResult).mockImplementation(async()=>({runId:'run',noteIds:Array.from({length:20},(_,i)=>String((search.mock.calls.length-1)*20+i))}));
    const deps={service:h.service,provider,env:loadEnv({}),liveProvider:()=>provider};
    expect(await runJob(deps,'job','worker')).toMatchObject({state:'waiting_external'});
    expect(h.job.provider_task_id).toBeNull();
    expect(await runJob(deps,'job','restarted-worker')).toMatchObject({state:'waiting_external'});
    expect(await runJob(deps,'job','worker')).toMatchObject({state:'succeeded',result:{notes:60,pages:3}});
    expect(search.mock.calls.map(([i])=>i.offset)).toEqual([0,20,40]);
    expect(h.settlements.at(-1)).toEqual(['ledger',3]);
  });
  it('counts only matching category notes toward 50 and stays within five paid pages',async()=>{
    const h=harness('provider_search'); h.job.input_ref.topic='beauty';
    const provider=new MockXhsProvider();
    const search=vi.spyOn(provider,'searchNotes').mockImplementation(async input=>({mode:'live',endpoint:'RF02',fetchedAt:new Date().toISOString(),notes:[note],latestHotArticles:[],relatedTerms:[],coverage:{requestedPages:1,fetchedPages:1,postFilters:[],hasMore:true,rawCount:20,pageFingerprint:String(input.offset)}}));
    vi.mocked(ingestSearchResult).mockImplementation(async()=>({runId:'run',noteIds:Array.from({length:20},(_,i)=>String((search.mock.calls.length-1)*20+i))}));
    const deps={service:h.service,provider,env:loadEnv({}),liveProvider:()=>provider};
    for(let page=0;page<4;page++) expect(await runJob(deps,'job','worker')).toMatchObject({state:'waiting_external'});
    expect(await runJob(deps,'job','worker')).toMatchObject({state:'succeeded',result:{notes:50,pages:5,stopReason:'target_reached'}});
    expect(h.job.result_ref?.fetchedNoteIds).toHaveLength(100);
    expect(h.settlements.at(-1)).toEqual(['ledger',5]);
  });
  it('will not resend a page with an unresolved submission marker',async()=>{
    const h=harness('provider_search');h.job.provider_task_id='started';
    const provider=new MockXhsProvider();const search=vi.spyOn(provider,'searchNotes');
    expect(await runJob({service:h.service,provider},'job','worker')).toMatchObject({state:'unknown_outcome'});
    expect(search).not.toHaveBeenCalled();
  });
  it('runs Apify one note at a time, resumes on the next ID and counts available covers',async()=>{
    const h=harness('note_enrichment');
    vi.mocked(enrichmentOptions).mockImplementation(async(_db,_job,_env,index=0)=>({noteId:ids[index]!,platformNoteId:note.platformNoteId,permissionId:'p',ttl:60,total:2,token:'test',build:'1.2.3',maxChargeUsd:'0.05',gate:{} as never}));
    const detail=vi.fn(async()=>note);
    const deps={service:h.service,provider:new MockXhsProvider(),env:loadEnv({}),apifyDetailProvider:()=>({assertReady:vi.fn(),noteDetail:detail}) as never};
    expect(await runJob(deps,'job','worker')).toMatchObject({state:'waiting_external'});
    expect(await runJob(deps,'job','worker')).toMatchObject({state:'succeeded',result:{completed:2,total:2,covers:2}});
    expect(vi.mocked(enrichmentOptions).mock.calls.map(c=>c[3])).toEqual([0,1]);
    expect(vi.mocked(storeEnrichment).mock.calls.map(c=>c[2])).toEqual(ids);
    expect(h.settlements.at(-1)).toEqual(['ledger',2]);
  });
  it('keeps the reservation when the kill switch interrupts already-paid work',async()=>{
    const h=harness('note_enrichment');h.job.result_ref={completed:1,total:2};h.kill();
    expect(await runJob({service:h.service,provider:new MockXhsProvider()},'job','worker')).toMatchObject({state:'failed',sent:false});
    expect(h.settlements.at(-1)).toEqual(['ledger','unknown_outcome']);
    expect(h.job.result_ref?.completed).toBe(1);
  });
  it('keeps completed Apify results and never retries a lost second response',async()=>{
    const h=harness('note_enrichment');
    vi.mocked(enrichmentOptions).mockImplementation(async(_db,_job,_env,index=0)=>({noteId:ids[index]!,platformNoteId:note.platformNoteId,permissionId:'p',ttl:60,total:2,token:'test',build:'1.2.3',maxChargeUsd:'0.05',gate:{} as never}));
    const detail=vi.fn().mockResolvedValueOnce(note).mockRejectedValueOnce(new Error('lost response'));
    const deps={service:h.service,provider:new MockXhsProvider(),env:loadEnv({}),apifyDetailProvider:()=>({assertReady:vi.fn(),noteDetail:detail}) as never};
    expect(await runJob(deps,'job','worker')).toMatchObject({state:'waiting_external'});
    expect(await runJob(deps,'job','worker')).toMatchObject({state:'unknown_outcome'});
    expect(h.job.result_ref?.completed).toBe(1);
    expect(await runJob(deps,'job','reclaimed')).toMatchObject({state:'unknown_outcome'});
    expect(detail).toHaveBeenCalledTimes(2);
  });

});
