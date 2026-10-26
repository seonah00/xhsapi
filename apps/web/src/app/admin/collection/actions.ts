'use server';
import {z} from 'zod';
import {createQuote,reserveJob} from '@xhs/core';
import {redirect} from 'next/navigation';
import {withAdmin} from '../forbidden-guard';
import {orRedirectWithError} from '@/server/actions-util';
import {service} from '@/server/ctx';
const terms=['韩国美妆','韩国穿搭','首尔咖啡店','首尔vlog','首尔美食'] as const;
function scope(f:FormData){return {source:'apify' as const,query:z.enum(terms).parse(f.get('term')),targetCount:50 as const,days:7 as const};}
export async function quoteCollection(f:FormData){const input=scope(f);const quote=await orRedirectWithError('/admin/collection',()=>withAdmin(ctx=>createQuote(ctx,service,'provider_search',input)));redirect(`/admin/collection?term=${encodeURIComponent(input.query)}&quote=${quote.id}`);}
export async function confirmCollection(f:FormData){const input=scope(f),quoteId=z.string().uuid().parse(f.get('quoteId'));const {jobId}=await orRedirectWithError('/admin/collection',()=>withAdmin(ctx=>reserveJob(ctx,{quoteId,route:'POST /admin/collection',idempotencyKey:z.string().uuid().parse(f.get('idem')),operation:'provider_search',scope:input,jobKind:'provider_search',dedupeKey:`provider_search:${quoteId}`,consent:f.get('consent')==='on',inputRef:input})));redirect(`/admin/collection?term=${encodeURIComponent(input.query)}&job=${jobId}`);}
