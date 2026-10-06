import { withService } from '@/server/db';

/** Liveness + database reachability for the platform health check. Reveals nothing else. */
export async function GET() {
  try {
    await withService((db) => db.query('select 1'));
    return Response.json({ ok: true }, { headers: { 'Cache-Control': 'no-store' } });
  } catch {
    return Response.json({ ok: false }, { status: 503, headers: { 'Cache-Control': 'no-store' } });
  }
}
