import { z } from 'zod';
import { classifyNote, CLASSIFIER_VERSION } from '@xhs/domain';
import type { Db } from './context.ts';

/** Operator-only bounded batch. Caller owns the transaction; existing/manual labels are never overwritten. */
export async function backfillTaxonomy(db: Db, input: { orgId: string; after?: string; limit?: number; apply?: boolean }) {
  const opts = z.object({ orgId: z.string().uuid(), after: z.string().uuid().optional(), limit: z.number().int().min(1).max(500).default(100), apply: z.boolean().default(false) }).parse(input);
  const notes = (await db.query(`select n.id,n.title,n.body_excerpt,n.provider_tags from notes n
    where n.org_id=$1 and n.data_mode='live' and (n.expires_at is null or n.expires_at>now())
      and ($2::uuid is null or n.id>$2::uuid)
      and not exists(select 1 from note_taxonomy nt where nt.note_id=n.id)
    order by n.id limit $3 for update of n skip locked`, [opts.orgId,opts.after??null,opts.limit])).rows;
  const terms = (await db.query(`select id,kind,slug from taxonomy_terms where org_id is null`)).rows;
  const ids = new Map(terms.map(t=>[`${t.kind}:${t.slug}`,t.id]));
  let matched = 0, inserted = 0;
  for (const n of notes) {
    const labels = classifyNote({title:n.title,body:n.body_excerpt,tags:n.provider_tags??[]});
    const matches = [...labels.topics.map(s=>ids.get(`topic:${s}`)),...labels.formats.map(s=>ids.get(`format:${s}`))].filter(Boolean);
    if (matches.length) matched++;
    if (opts.apply) for (const id of matches) {
      inserted += (await db.query(`insert into note_taxonomy(note_id,taxonomy_id,classifier_version,confidence)
        values($1,$2,$3,'low') on conflict do nothing`,[n.id,id,CLASSIFIER_VERSION])).rowCount??0;
    }
  }
  return { scanned:notes.length, matched, inserted, nextCursor:notes.at(-1)?.id??null, applied:opts.apply };
}
