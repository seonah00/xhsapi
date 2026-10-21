import { expect,it,vi } from 'vitest';
import { recoverStoredNoteLinks,type Ctx,type Db,type ServiceRunner } from '@xhs/core';

const pid='a'.repeat(24),at='2026-01-01T00:00:00.000Z';
function setup() {
  const query=vi.fn().mockResolvedValue({rows:[{id:'local-note',platform_note_id:pid}],rowCount:1});
  const db={query} as unknown as Db;
  const ctx={db,orgId:'org',uid:'admin',role:'org_admin',mode:'live'} as Ctx;
  const service:ServiceRunner=async fn=>fn(db);
  const fetchImpl=vi.fn().mockResolvedValueOnce(Response.json({data:{items:[{status:'SUCCEEDED',finishedAt:at,defaultDatasetId:'fixtureDataset'}],total:1}}))
    .mockResolvedValueOnce(Response.json([{id:pid,url:`https://www.xiaohongshu.com/explore/${pid}`,xsec_token:'synthetic'}]));
  return {ctx,query,service,fetchImpl};
}
it('reads existing results with GET only, binds exact IDs, retains original observation time and returns counts only',async()=>{
  const s=setup();
  const result=await recoverStoredNoteLinks(s.ctx,s.service,{source:'search',offset:0},'fixture-key',s.fetchImpl);
  expect(result).toMatchObject({runs:1,rows:1,linked:1,matched:1,nextOffset:null});
  expect(JSON.stringify(result)).not.toMatch(/synthetic|fixture-key|xsec_token/);
  for(const [url,options] of s.fetchImpl.mock.calls) {
    expect(options.method).toBe('GET');expect(options.redirect).toBe('error');
    expect(url).not.toMatch(/run-sync|resurrect|restart|token=/);
  }
  expect(s.query.mock.calls[0]![1]).toEqual(['org','live',[pid]]);
  expect(s.query.mock.calls[1]![1]).toContain(at);
  expect(s.query.mock.calls[1]![0]).toContain('note_access_links.observed_at<excluded.observed_at');
});
it('rejects students, mock mode, missing server key and arbitrary sources before any request',async()=>{
  const s=setup();
  for(const [ctx,token,input] of [[{...s.ctx,role:'student'},'x',{source:'search'}],[{...s.ctx,mode:'mock'},'x',{source:'search'}],[s.ctx,undefined,{source:'search'}],[s.ctx,'x',{source:'https://evil.invalid'}]] as const) {
    await expect(recoverStoredNoteLinks(ctx as Ctx,s.service,input,token,s.fetchImpl)).rejects.toThrow();
  }
  expect(s.fetchImpl).not.toHaveBeenCalled();
});
it('rejects other-note, tokenless and hostile URLs without writing them',async()=>{
  const s=setup();s.fetchImpl.mockReset().mockResolvedValueOnce(Response.json({data:{items:[{status:'SUCCEEDED',finishedAt:at,defaultDatasetId:'fixture'}],total:1}}))
    .mockResolvedValueOnce(Response.json([{id:pid,url:`https://www.xiaohongshu.com/explore/${'b'.repeat(24)}?xsec_token=synthetic`},{id:pid,url:`https://www.xiaohongshu.com/explore/${pid}`},{id:pid,url:'https://evil.invalid/?xsec_token=synthetic'}]));
  s.query.mockResolvedValue({rows:[],rowCount:0});
  expect(await recoverStoredNoteLinks(s.ctx,s.service,{source:'detail'},'x',s.fetchImpl)).toMatchObject({rejected:3,linked:0});
  expect(s.query).toHaveBeenCalledTimes(1);
});
it('does not retry a failed read or partially write results',async()=>{
  const s=setup();s.fetchImpl.mockReset().mockResolvedValue(new Response(null,{status:403}));
  await expect(recoverStoredNoteLinks(s.ctx,s.service,{source:'search'},'x',s.fetchImpl)).rejects.toMatchObject({code:'VALIDATION_FAILED'});
  expect(s.fetchImpl).toHaveBeenCalledTimes(1);expect(s.query).not.toHaveBeenCalled();
});
it('keeps newer links and exposes pagination without claiming that matched notes were recovered',async()=>{
  const s=setup();s.query.mockResolvedValueOnce({rows:[{id:'note',platform_note_id:pid}]}).mockResolvedValueOnce({rows:[],rowCount:0});
  expect(await recoverStoredNoteLinks(s.ctx,s.service,{source:'search'},'x',s.fetchImpl)).toMatchObject({matched:1,linked:0,unchanged:1});
});
