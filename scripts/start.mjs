#!/usr/bin/env node
/**
 * Single production entry point, whatever builds the image (Dockerfile or Railway Railpack):
 *   node scripts/start.mjs web     → apply pending DB migrations, then `next start` on $PORT
 *   node scripts/start.mjs worker  → job worker
 * Without an argument, XHS_SERVICE=worker selects the worker; anything else starts the web.
 * SKIP_MIGRATIONS=true skips the migration step (e.g. when a pre-deploy command already ran it).
 */
import { spawn, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const mode = process.argv[2] ?? (process.env.XHS_SERVICE === 'worker' ? 'worker' : 'web');
const tsx = join(root, 'node_modules', '.bin', 'tsx');

function run(cmd, args, cwd) {
  const child = spawn(cmd, args, { cwd, stdio: 'inherit', env: process.env });
  for (const sig of ['SIGTERM', 'SIGINT']) process.on(sig, () => child.kill(sig));
  child.on('exit', (code, signal) => process.exit(code ?? (signal ? 1 : 0)));
}

if (mode === 'worker') {
  run(tsx, ['apps/worker/src/index.ts'], root);
} else if (mode === 'web') {
  if (process.env.SKIP_MIGRATIONS !== 'true') {
    const m = spawnSync(tsx, ['scripts/db-migrate.ts'], { cwd: root, stdio: 'inherit', env: process.env });
    if (m.status !== 0) {
      console.error('DB 마이그레이션 실패: 웹을 시작하지 않습니다.');
      process.exit(m.status ?? 1);
    }
  }
  run(join(root, 'apps', 'web', 'node_modules', '.bin', 'next'), ['start', '-p', process.env.PORT ?? '3000'], join(root, 'apps', 'web'));
} else {
  console.error(`unknown mode: ${mode} (web | worker)`);
  process.exit(2);
}
