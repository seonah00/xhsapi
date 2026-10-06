#!/usr/bin/env node
/**
 * Single production entry point, whatever builds the image (Dockerfile or Railway Railpack):
 *   node scripts/start.mjs web     → apply pending DB migrations, then `next start` on $PORT
 *   node scripts/start.mjs worker  → job worker
 * XHS_SERVICE (web | worker) overrides the argument, so one image/config serves both Railway services:
 * the web image's CMD says `web`, and the worker service only sets XHS_SERVICE=worker.
 * In worker mode with $PORT set (Railway always sets it), a tiny listener answers GET /api/health so a
 * shared healthcheck config passes; it serves nothing else and exposes no data.
 * SKIP_MIGRATIONS=true skips the migration step (e.g. when a pre-deploy command already ran it).
 */
import { spawn, spawnSync } from 'node:child_process';
import { createServer } from 'node:http';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const mode = process.env.XHS_SERVICE || process.argv[2] || 'web';
const tsx = join(root, 'node_modules', '.bin', 'tsx');

function run(cmd, args, cwd) {
  const child = spawn(cmd, args, { cwd, stdio: 'inherit', env: process.env });
  for (const sig of ['SIGTERM', 'SIGINT']) process.on(sig, () => child.kill(sig));
  child.on('exit', (code, signal) => process.exit(code ?? (signal ? 1 : 0)));
}

if (mode === 'worker') {
  console.info('xhs service: worker');
  run(tsx, ['apps/worker/src/index.ts'], root);
  if (process.env.PORT) {
    createServer((req, res) => {
      const ok = req.method === 'GET' && req.url === '/api/health';
      res.writeHead(ok ? 200 : 404, { 'content-type': 'application/json', 'cache-control': 'no-store' });
      res.end(ok ? '{"ok":true,"service":"worker"}' : '{"error":"not_found"}');
    }).listen(Number(process.env.PORT));
  }
} else if (mode === 'web') {
  console.info('xhs service: web');
  if (process.env.SKIP_MIGRATIONS !== 'true') {
    const m = spawnSync(tsx, ['scripts/db-migrate.ts'], { cwd: root, stdio: 'inherit', env: process.env });
    if (m.status !== 0) {
      // Wait before exiting so the platform's automatic restarts do not hammer the database
      // (repeated auth failures make the Supabase pooler block new connections for a while).
      const waitS = Number(process.env.MIGRATION_RETRY_DELAY_S ?? 60);
      console.error(`DB 마이그레이션 실패: 웹을 시작하지 않습니다. ${waitS}초 뒤 종료합니다(재시작 간격 확보).`);
      setTimeout(() => process.exit(m.status ?? 1), waitS * 1000);
      await new Promise(() => {});
    }
  }
  // First-run admin (optional): BOOTSTRAP_ORG_NAME + BOOTSTRAP_ADMIN_EMAIL create the first org/admin only
  // while no organization exists, and print a one-time password link to the deploy log. Never blocks startup.
  if (process.env.BOOTSTRAP_ORG_NAME && process.env.BOOTSTRAP_ADMIN_EMAIL) {
    spawnSync(tsx, ['scripts/bootstrap-org.ts', '--org-name', process.env.BOOTSTRAP_ORG_NAME, '--admin-email', process.env.BOOTSTRAP_ADMIN_EMAIL, '--if-empty', 'true'],
      { cwd: root, stdio: 'inherit', env: process.env });
  }
  run(join(root, 'apps', 'web', 'node_modules', '.bin', 'next'), ['start', '-p', process.env.PORT ?? '3000'], join(root, 'apps', 'web'));
} else {
  console.error(`unknown mode: ${mode} (web | worker)`);
  process.exit(2);
}
