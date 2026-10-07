import { randomUUID } from 'node:crypto';
import { expect,it } from 'vitest';
import { pool } from './db.ts';
import { backfillTaxonomy } from '../../packages/core/src/backfill-taxonomy.ts';
it('backfills only unclassified live notes in the requested org, with dry-run and replay safety',async()=>{
  const c=await pool.connect();
  try {
    await c.query('begin');
    const org=randomUUID(),other=randomUUID();
    await c.query(`insert into organizations(id,name) values($1,'backfill test'),($2,'other')`,[org,other]);
    const ids=Array.from({length:5},()=>randomUUID());
    for (let i=0;i<5;i++) await c.query(`insert into notes(id,org_id,provider,platform_note_id,data_mode,canonical_url,title,provenance,expires_at) values($1,$2,'redfox',$3,$4,'https://example.invalid','美食 vlog','{}',$5)`,[ids[i],i===1?other:org,ids[i],i===2?'mock':'live',i===3?new Date(0):null]);
    const term=(await c.query("select id from taxonomy_terms where org_id is null and kind='topic' limit 1")).rows[0].id;
    await c.query("insert into note_taxonomy(note_id,taxonomy_id,classifier_version,confidence) values($1,$2,'manual','high')",[ids[4],term]);
    expect(await backfillTaxonomy(c,{orgId:org})).toMatchObject({scanned:1,matched:1,inserted:0,applied:false});
    expect(await backfillTaxonomy(c,{orgId:org,apply:true})).toMatchObject({scanned:1,matched:1,inserted:2});
    expect(await backfillTaxonomy(c,{orgId:org,apply:true})).toMatchObject({scanned:0,inserted:0});
    expect((await c.query("select classifier_version from note_taxonomy where note_id=$1",[ids[4]])).rows).toEqual([{classifier_version:'manual'}]);
  } finally { await c.query('rollback'); c.release(); }
});
