/** Operator CLI: pnpm tsx scripts/backfill-taxonomy.ts --org UUID [--after UUID] [--apply]. Dry-run by default. */
import pg from 'pg';
import { pgConfig } from '@xhs/core';
import { backfillTaxonomy } from '../packages/core/src/backfill-taxonomy.ts';
const args=process.argv.slice(2);
const value=(key:string)=>{ const i=args.indexOf(key); return i<0?undefined:args[i+1]; };
const db=new pg.Pool(pgConfig());
const c=await db.connect();
try {
  await c.query('begin');
  const after=value('--after');
  const result=await backfillTaxonomy(c,{orgId:value('--org')??'',...(after?{after}:{}),apply:args.includes('--apply')});
  await c.query('commit');
  console.log(JSON.stringify(result));
} catch {
  await c.query('rollback');
  console.error('소급 분류 실패: 조직 UUID, 커서, DB 연결을 확인하세요.');
  process.exitCode=1;
} finally { c.release(); await db.end(); }
