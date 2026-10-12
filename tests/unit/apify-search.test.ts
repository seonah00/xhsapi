import { expect,it,vi } from 'vitest';
import { loadEnv } from '@xhs/domain';
import { APIFY_SEARCH_CAPABILITY, ApifySearchProvider, parseZenSearch, type ApifyDetailOptions } from '@xhs/providers';
const id='a'.repeat(24), url=`https://www.xiaohongshu.com/discovery/item/${id}?xsec_token=synthetic&xsec_source=app_share`;
const row={id,type:'video',title:'合成标题',desc:'#美食',timestamp:1780000000,url,xsec_token:'synthetic',images:[{url:'https://sns-na-i4.xhscdn.com/fixture.jpg'}]};
const options=():ApifyDetailOptions=>({token:'test-only',build:'1.2.3',maxChargeUsd:'0.30',gate:{env:{...loadEnv({}),APP_DATA_MODE:'live' as const,LIVE_PROVIDER_CALLS_ENABLED:true,APIFY_ENABLED:true},endpoint:{...APIFY_SEARCH_CAPABILITY,priceStatus:'verified' as const},orgLiveEnabled:true,consentRecorded:true,budgetReserved:true,userApproved:true,purposes:[]}});
const scope={source:'apify' as const,query:'美食',targetCount:50 as const};
it('keeps supplied share path, separates canonical, interprets seconds and deduplicates',()=>{
 const r=parseZenSearch([row,row],50); expect(r.notes).toHaveLength(1);
 expect(r.notes[0]).toMatchObject({accessUrl:url,publishedAt:new Date(1780000000000).toISOString(),providerTags:['美食']});
 expect(r.notes[0]?.canonicalUrl).not.toContain('xsec_token');
 expect(parseZenSearch([],50).notes).toEqual([]);
 expect(()=>parseZenSearch([row],0)).toThrow();
 expect(parseZenSearch([{...row,url:url.replace(id,'b'.repeat(24)),xsec_token:'wrong'}],50).notes[0]?.accessUrl).toBeNull();
});
it('sends one bounded keyword search with pinned build and no media downloads',async()=>{
 const f=vi.fn(async()=>Response.json([row]));await new ApifySearchProvider(options(),f).search(scope);
 expect(f).toHaveBeenCalledTimes(1);
 const [u,init]=f.mock.calls[0] as unknown as [URL,RequestInit];
 expect(u.searchParams.get('maxTotalChargeUsd')).toBe('0.30');expect(u.searchParams.get('maxItems')).toBe('50');expect(u.searchParams.get('build')).toBe('1.2.3');
 expect(JSON.parse(String(init.body))).toEqual({keywords:['美食'],maxResults:50,topUpFromOtherSorts:true,sortType:'general',noteType:'all',timeFilter:'all'});
 expect(init.redirect).toBe('error');expect(u.searchParams.has('token')).toBe(false);
});
it.each(['flag','price','budget','consent','build'])('blocks %s before submitting',async key=>{
 const o=options();if(key==='flag')o.gate.env.APIFY_ENABLED=false;if(key==='price')o.gate.endpoint={...o.gate.endpoint,priceStatus:'unknown'} as typeof o.gate.endpoint;if(key==='budget')o.gate.budgetReserved=false;if(key==='consent')o.gate.consentRecorded=false;if(key==='build')o.build='latest';
 const f=vi.fn();await expect(new ApifySearchProvider(o,f).search(scope)).rejects.toThrow();expect(f).not.toHaveBeenCalled();
});
it('does not retry ambiguous responses or expose response bodies',async()=>{
 const f=vi.fn(async()=>new Response('private-response',{status:500}));await expect(new ApifySearchProvider(options(),f).search(scope)).rejects.toThrow('APIFY_SEARCH_HTTP_500');expect(f).toHaveBeenCalledTimes(1);
});
