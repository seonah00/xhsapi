import { z } from 'zod';
import { extractHashtags } from '@xhs/domain';
import { evaluateLiveGate, LiveCallBlockedError } from '../gate.ts';
import type { EndpointCapability } from '../capabilities.ts';
import type { SearchResult } from '../types.ts';
import { ProviderNotReadyError } from '../redfox/redfox-provider.ts';
import { ApifyBuild, parseZenStudioNote, type ApifyDetailOptions } from './note-detail.ts';

export const APIFY_SEARCH_ACTOR = 'zen-studio/rednote-search-scraper';
export const APIFY_SEARCH_CAPABILITY: EndpointCapability = {
  id: 'AP02', method: 'POST', path: '/v2/actors/zen-studio~rednote-search-scraper/run-sync-get-dataset-items',
  purpose: 'keyword search with original sharing links', paramsStatus: 'documented', verificationStatus: 'documented',
  priceStatus: 'unknown', phase: 'P0', nonIdempotentSubmit: true,
  docUrl: 'https://apify.com/zen-studio/rednote-search-scraper/input-schema',
};
export const ApifySearchScope = z.object({
  source: z.literal('apify'), query: z.string().trim().min(1).max(50), targetCount: z.union([z.literal(50), z.literal(100)]),
  topic: z.enum(['beauty','daily-life','parenting','food-places','travel-outing','fashion']).optional(),
  days: z.union([z.literal(7),z.literal(14),z.literal(30)]).optional(),
}).strict();
export type ApifySearchInput = z.infer<typeof ApifySearchScope>;

/** Search timestamps are seconds; detail timestamps are milliseconds. Share credentials stay out of provenance. */
export function parseZenSearch(data: unknown, limit: number, now = new Date()): SearchResult {
  if (!Array.isArray(data) || data.length > limit) throw new Error('APIFY_SEARCH_CONTRACT');
  const seen = new Set<string>();
  const notes = data.map(raw => {
    const n = z.object({timestamp:z.number().finite().nonnegative().nullable().optional(),type:z.string(),desc:z.string().nullable().optional()}).passthrough().parse(raw);
    const note = parseZenStudioNote([{...n,type:n.type==='live'?'normal':n.type,timestamp:n.timestamp==null?null:n.timestamp*1000}],null,now);
    if(n.type==='live') note.noteType=null;
    note.providerTags=extractHashtags(n.desc ?? '').slice(0,30);
    return note;
  }).filter(n => {if(seen.has(n.platformNoteId)) return false; seen.add(n.platformNoteId); return true;});
  return {mode:'live',endpoint:'AP02',fetchedAt:now.toISOString(),notes,latestHotArticles:[],relatedTerms:[],coverage:{requestedPages:1,fetchedPages:1,postFilters:[]}};
}
export class ApifySearchProvider {
  constructor(private readonly options: ApifyDetailOptions, private readonly fetchImpl: typeof fetch = fetch) {}
  assertReady(input: ApifySearchInput) {
    ApifySearchScope.parse(input);
    const o=this.options;
    if (!o.token.trim() || !ApifyBuild.safeParse(o.build).success || !/^\d{1,6}(\.\d{1,8})?$/.test(o.maxChargeUsd) || Number(o.maxChargeUsd)<=0 || o.gate.endpoint.id!=='AP02') throw new ProviderNotReadyError('APIFY_SEARCH_CONFIG');
    const g=evaluateLiveGate(o.gate); if(!g.allowed) throw new LiveCallBlockedError(g.reasons);
  }
  async search(input: ApifySearchInput): Promise<SearchResult> {
    this.assertReady(input);
    const o=this.options, url=new URL(APIFY_SEARCH_CAPABILITY.path,'https://api.apify.com');
    url.search=new URLSearchParams({build:o.build,memory:'256',timeout:'120',maxTotalChargeUsd:o.maxChargeUsd,maxItems:String(input.targetCount),restartOnError:'false',format:'json'}).toString();
    // Exactly one bounded submission. Never retry a billable request after uncertain delivery.
    let res: Response;
    try {res=await this.fetchImpl(url,{method:'POST',headers:{Authorization:`Bearer ${o.token}`,'Content-Type':'application/json'},body:JSON.stringify({keywords:[input.query],maxResults:input.targetCount,topUpFromOtherSorts:input.days!==7,sortType:input.days===7?'time_descending':'general',noteType:'all',timeFilter:input.days===7?'1w':'all'}),redirect:'error',signal:AbortSignal.timeout(150_000)});} catch {throw new Error('APIFY_SEARCH_RESPONSE_UNKNOWN');}
    if(!res.ok) throw new Error(`APIFY_SEARCH_HTTP_${res.status}`);
    try {return parseZenSearch(await res.json(),input.targetCount);} catch {throw new Error('APIFY_SEARCH_CONTRACT');}
  }
}
