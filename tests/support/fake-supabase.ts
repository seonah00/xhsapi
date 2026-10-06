/**
 * TEST ONLY: a local stand-in for the Supabase Auth (GoTrue) and Storage endpoints
 * this app uses. Users are written to the test database's auth.users so foreign keys
 * and RLS behave as with real Supabase. It models the documented request/response
 * shapes; it is not proof that a real project behaves identically.
 *
 *   DATABASE_URL=... FAKE_SUPABASE_PORT=54331 tsx tests/support/fake-supabase.ts
 */
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { randomBytes, randomUUID, scryptSync, timingSafeEqual } from 'node:crypto';
import type { AddressInfo } from 'node:net';
import pg from 'pg';

export const FAKE_ANON_KEY = 'fake-anon-key-for-tests-only';
export const FAKE_SERVICE_KEY = 'fake-service-role-key-for-tests-only';

type Started = { url: string; close: () => Promise<void>; requests: { method: string; path: string }[] };

export async function startFakeSupabase(databaseUrl: string, port = 0): Promise<Started> {
  const db = new pg.Pool({ connectionString: databaseUrl, max: 2 });
  const passwords = new Map<string, Buffer>(); // userId -> salt|hash
  const recovery = new Map<string, string>(); // token hash -> userId (one-time)
  const objects = new Map<string, Buffer>();
  const requests: Started['requests'] = [];

  const hash = (pw: string) => { const salt = randomBytes(16); return Buffer.concat([salt, scryptSync(pw, salt, 32)]); };
  const matches = (stored: Buffer | undefined, pw: string) => !!stored && timingSafeEqual(stored.subarray(16), scryptSync(pw, stored.subarray(0, 16), 32));
  const send = (res: ServerResponse, status: number, body: unknown) => { res.writeHead(status, { 'content-type': 'application/json' }); res.end(JSON.stringify(body)); };
  const body = async (req: IncomingMessage) => { const chunks: Buffer[] = []; for await (const c of req) chunks.push(c as Buffer); return Buffer.concat(chunks); };
  const userById = async (id: string) => (await db.query(`select id, email from auth.users where id = $1`, [id])).rows[0];

  const server = createServer(async (req, res) => {
    try {
      const url = new URL(req.url ?? '/', 'http://x');
      requests.push({ method: req.method ?? '', path: url.pathname });
      const apikey = req.headers.apikey;
      const bearer = String(req.headers.authorization ?? '').replace(/^Bearer /, '');
      const admin = apikey === FAKE_SERVICE_KEY && bearer === FAKE_SERVICE_KEY;
      if (apikey !== FAKE_ANON_KEY && apikey !== FAKE_SERVICE_KEY) return send(res, 401, { message: 'Invalid API key' });
      const p = url.pathname;

      if (p === '/auth/v1/token' && req.method === 'POST' && url.searchParams.get('grant_type') === 'password') {
        const { email, password } = JSON.parse((await body(req)).toString() || '{}');
        const u = (await db.query(`select id, email from auth.users where lower(email) = lower($1)`, [email ?? ''])).rows[0];
        if (!u || !matches(passwords.get(u.id), String(password ?? ''))) return send(res, 400, { code: 400, error_code: 'invalid_credentials', msg: 'Invalid login credentials' });
        return send(res, 200, { access_token: randomUUID(), token_type: 'bearer', expires_in: 3600, refresh_token: randomUUID(), user: u });
      }
      if (p === '/auth/v1/admin/users' && req.method === 'POST') {
        if (!admin) return send(res, 401, { msg: 'not admin' });
        const { email, password } = JSON.parse((await body(req)).toString() || '{}');
        if ((await db.query(`select 1 from auth.users where lower(email) = lower($1)`, [email])).rowCount) {
          return send(res, 422, { code: 422, error_code: 'email_exists', msg: 'A user with this email address has already been registered' });
        }
        if (password !== undefined && String(password).length < 6) return send(res, 422, { code: 422, error_code: 'weak_password', msg: 'Password should be at least 6 characters.' });
        const id = randomUUID();
        await db.query(`insert into auth.users (id, email) values ($1, $2)`, [id, String(email).toLowerCase()]);
        if (password) passwords.set(id, hash(String(password)));
        return send(res, 200, { id, email: String(email).toLowerCase(), email_confirmed_at: new Date().toISOString() });
      }
      const m = /^\/auth\/v1\/admin\/users\/([0-9a-f-]{36})$/.exec(p);
      if (m && req.method === 'PUT') {
        if (!admin) return send(res, 401, { msg: 'not admin' });
        const { password } = JSON.parse((await body(req)).toString() || '{}');
        const u = await userById(m[1]!);
        if (!u) return send(res, 404, { msg: 'User not found' });
        if (String(password ?? '').length < 6) return send(res, 422, { error_code: 'weak_password', msg: 'Password should be at least 6 characters.' });
        passwords.set(u.id, hash(String(password)));
        return send(res, 200, u);
      }
      if (p === '/auth/v1/admin/generate_link' && req.method === 'POST') {
        if (!admin) return send(res, 401, { msg: 'not admin' });
        const { type, email } = JSON.parse((await body(req)).toString() || '{}');
        const u = (await db.query(`select id, email from auth.users where lower(email) = lower($1)`, [email ?? ''])).rows[0];
        if (type !== 'recovery' || !u) return send(res, 404, { msg: 'User not found' });
        const hashed = randomBytes(28).toString('hex');
        recovery.set(hashed, u.id);
        return send(res, 200, { ...u, properties: { action_link: `http://fake/verify?token=${hashed}`, email_otp: '000000', hashed_token: hashed, verification_type: 'recovery', redirect_to: '' } });
      }
      if (p === '/auth/v1/verify' && req.method === 'POST') {
        const { type, token_hash } = JSON.parse((await body(req)).toString() || '{}');
        const uid = recovery.get(String(token_hash ?? ''));
        if (type !== 'recovery' || !uid) return send(res, 403, { code: 403, error_code: 'otp_expired', msg: 'Email link is invalid or has expired' });
        recovery.delete(String(token_hash));
        return send(res, 200, { access_token: randomUUID(), user: await userById(uid) });
      }

      const obj = /^\/storage\/v1\/object\/(authenticated\/)?([a-z0-9-]+)\/(.+)$/.exec(p);
      if (obj) {
        if (!admin) return send(res, 400, { statusCode: '403', error: 'Unauthorized' });
        const key = `${obj[2]}/${obj[3]}`;
        if (req.method === 'POST' && !obj[1]) {
          if (objects.has(key) && req.headers['x-upsert'] !== 'true') return send(res, 400, { statusCode: '409', error: 'Duplicate' });
          objects.set(key, await body(req));
          return send(res, 200, { Key: key });
        }
        if (req.method === 'GET' && obj[1]) {
          const b = objects.get(key);
          if (!b) return send(res, 400, { statusCode: '404', error: 'not_found' });
          res.writeHead(200, { 'content-type': 'application/octet-stream' });
          return res.end(b);
        }
      }
      const del = /^\/storage\/v1\/object\/([a-z0-9-]+)$/.exec(p);
      if (del && req.method === 'DELETE') {
        if (!admin) return send(res, 400, { statusCode: '403', error: 'Unauthorized' });
        const { prefixes } = JSON.parse((await body(req)).toString() || '{}');
        for (const k of prefixes ?? []) objects.delete(`${del[1]}/${k}`);
        return send(res, 200, []);
      }
      return send(res, 404, { msg: 'not implemented in fake' });
    } catch (e) {
      return send(res, 500, { msg: e instanceof Error ? e.message : 'error' });
    }
  });
  await new Promise<void>((r) => server.listen(port, '127.0.0.1', r));
  return {
    url: `http://127.0.0.1:${(server.address() as AddressInfo).port}`,
    requests,
    close: async () => { await new Promise((r) => server.close(r)); await db.end(); },
  };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const s = await startFakeSupabase(process.env.DATABASE_URL!, Number(process.env.FAKE_SUPABASE_PORT ?? 54331));
  console.info(`fake supabase listening on ${s.url}`);
}
