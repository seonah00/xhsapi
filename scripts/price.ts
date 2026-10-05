/**
 * Operator tool for provider unit prices (spec 6.3: an unknown price blocks live calls).
 * Prices are global facts about the provider, so they are registered with server rights,
 * never from an org admin screen. Every version keeps its evidence and verifier.
 *
 *   pnpm price list
 *   pnpm price register --endpoint RF13 --unit call --unit-cost 0.05 --currency CNY \
 *        --evidence "RedFox 견적서 2026-10-10" --verified-by admin@example.com [--effective-at 2026-10-10T00:00:00Z]
 *   pnpm price unverify --endpoint RF13      # future quotes are blocked again; history is kept
 */
import pg from 'pg';
import { REDFOX_CAPABILITIES } from '@xhs/providers';

export function parseArgs(argv: string[]): { cmd: string; opts: Record<string, string> } {
  const [cmd = 'help', ...rest] = argv;
  const opts: Record<string, string> = {};
  for (let i = 0; i < rest.length; i += 2) {
    const k = rest[i]!;
    if (!k.startsWith('--') || rest[i + 1] === undefined) throw new Error(`잘못된 인자: ${k}`);
    opts[k.slice(2)] = rest[i + 1]!;
  }
  return { cmd, opts };
}

export function validateRegister(o: Record<string, string>) {
  const errors: string[] = [];
  if (!o.endpoint || !(o.endpoint in REDFOX_CAPABILITIES)) errors.push('--endpoint: RF01~RF14 중 하나');
  if (!o.unit || !/^[a-z_]{2,20}$/.test(o.unit)) errors.push('--unit: 예) call, page, minute');
  if (!o['unit-cost'] || !/^\d{1,12}(\.\d{1,8})?$/.test(o['unit-cost'])) errors.push('--unit-cost: 0 이상 숫자(소수 8자리까지)');
  if (!o.currency || !/^[A-Z]{3}$/.test(o.currency)) errors.push('--currency: 예) CNY, USD');
  if (!o.evidence || o.evidence.trim().length < 5) errors.push('--evidence: 근거(견적서·계약서 등) 설명 5자 이상');
  if (!o['verified-by']) errors.push('--verified-by: 확인한 사람의 이메일');
  if (o['effective-at'] && Number.isNaN(Date.parse(o['effective-at']))) errors.push('--effective-at: ISO 날짜');
  return errors;
}

async function main() {
  const { cmd, opts } = parseArgs(process.argv.slice(2));
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error('DATABASE_URL is required');
  const db = new pg.Client({ connectionString: url });
  await db.connect();
  try {
    if (cmd === 'list') {
      const rows = (await db.query(
        `select c.endpoint, c.price_status, v.unit, v.unit_cost::text, v.currency, v.effective_at, v.evidence, u.email as verified_by
         from provider_capabilities c
         left join lateral (select * from provider_price_versions p where p.provider = c.provider and p.endpoint = c.endpoint order by effective_at desc limit 1) v on true
         left join auth.users u on u.id = v.verified_by
         where c.provider = 'redfox' order by c.endpoint`,
      )).rows;
      console.table(rows.map((r) => ({ endpoint: r.endpoint, status: r.price_status, price: r.unit_cost ? `${r.unit_cost} ${r.currency}/${r.unit}` : '-', since: r.effective_at?.toISOString() ?? '-', by: r.verified_by ?? '-' })));
    } else if (cmd === 'register') {
      const errors = validateRegister(opts);
      if (errors.length) throw new Error(`입력 오류:\n- ${errors.join('\n- ')}`);
      const user = (await db.query(`select id from auth.users where email = $1`, [opts['verified-by']])).rows[0];
      if (!user) throw new Error('--verified-by 사용자를 찾을 수 없습니다.');
      await db.query('begin');
      await db.query(
        `insert into provider_price_versions (provider, endpoint, currency, unit, unit_cost, effective_at, verified_by, evidence)
         values ('redfox', $1, $2, $3, $4::numeric, coalesce($5::timestamptz, now()), $6, $7)`,
        [opts.endpoint, opts.currency, opts.unit, opts['unit-cost'], opts['effective-at'] ?? null, user.id, (opts.evidence ?? '').trim()],
      );
      await db.query(`update provider_capabilities set price_status = 'verified' where provider = 'redfox' and endpoint = $1`, [opts.endpoint]);
      await db.query('commit');
      console.info(`등록: ${opts.endpoint} ${opts['unit-cost']} ${opts.currency}/${opts.unit}`);
    } else if (cmd === 'unverify') {
      if (!opts.endpoint || !(opts.endpoint in REDFOX_CAPABILITIES)) throw new Error('--endpoint 필요');
      await db.query(`update provider_capabilities set price_status = 'unknown' where provider = 'redfox' and endpoint = $1`, [opts.endpoint]);
      console.info(`${opts.endpoint}: 단가 미확인으로 되돌림(새 견적 차단, 기록 유지)`);
    } else {
      console.info('사용법: pnpm price list | register --endpoint .. --unit .. --unit-cost .. --currency .. --evidence .. --verified-by .. | unverify --endpoint ..');
    }
  } catch (e) {
    await db.query('rollback').catch(() => undefined);
    throw e;
  } finally {
    await db.end();
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((e) => { console.error(e instanceof Error ? e.message : e); process.exit(1); });
}
