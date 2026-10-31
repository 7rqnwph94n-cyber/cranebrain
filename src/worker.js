
// Verifies the Cloudflare Access login token on every API and photo request.
// Fails closed: with no TEAM_DOMAIN / POLICY_AUD configured, nothing is served.
let jwks = null, jwksAt = 0;
const b64u = s => Uint8Array.from(atob(s.replace(/-/g, '+').replace(/_/g, '/').padEnd(Math.ceil(s.length / 4) * 4, '=')), c => c.charCodeAt(0));
const dec = s => JSON.parse(new TextDecoder().decode(b64u(s)));

async function keys(team) {
  if (jwks && Date.now() - jwksAt < 3600e3) return jwks;
  const r = await fetch(`https://${team}/cdn-cgi/access/certs`);
  if (!r.ok) throw new Error('certs ' + r.status);
  jwks = (await r.json()).keys || []; jwksAt = Date.now();
  return jwks;
}

async function auth(env, request) {
  if (env.DEV_EMAIL && env.DEV_MODE === 'yes') return env.DEV_EMAIL.toLowerCase(); // local `wrangler pages dev` only
  const team = (env.TEAM_DOMAIN || 'bold-frost-d6e2.cloudflareaccess.com').replace(/^https?:\/\//, '').replace(/\/$/, '');
  const aud = env.POLICY_AUD || '4252fbcc60fdf05ba9d57667eb276178126653cb1c01d4111b98150785aa473d';
  const tok = request.headers.get('Cf-Access-Jwt-Assertion');
  if (!team || !aud || !tok) return null;
  try {
    const [h, p, s] = tok.split('.');
    const head = dec(h), pl = dec(p);
    const auds = Array.isArray(pl.aud) ? pl.aud : [pl.aud];
    if (!auds.includes(aud)) return null;
    if (!pl.exp || pl.exp * 1000 < Date.now()) return null;
    if (pl.iss !== `https://${team}`) return null;
    let jwk = (await keys(team)).find(k => k.kid === head.kid);
    if (!jwk) { jwks = null; jwk = (await keys(team)).find(k => k.kid === head.kid); }
    if (!jwk) return null;
    const key = await crypto.subtle.importKey('jwk', jwk, { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['verify']);
    const ok = await crypto.subtle.verify('RSASSA-PKCS1-v1_5', key, b64u(s), new TextEncoder().encode(h + '.' + p));
    if (!ok) return null;
    const email = String(pl.email || '').toLowerCase();
    if (!email) return null;
    if (env.ALLOWED_EMAILS && !env.ALLOWED_EMAILS.toLowerCase().split(/[\s,]+/).includes(email)) return null;
    return email;
  } catch { return null; }
}

const json = (o, status = 200) => new Response(JSON.stringify(o), { status, headers: { 'content-type': 'application/json', 'cache-control': 'no-store' } });


const COL = /^(svc|rw)\/[a-z]{1,20}$/;
const ID = /^[A-Za-z0-9_-]{1,80}$/;
const isCopy = col => col.endsWith('/photos'); // PDF-ready photo copies live in R2, not the database

async function apiHandler({ request, env, params }) {
  const email = await auth(env, request);
  if (!email) return json({ error: 'unauthorised' }, 401);
  const url = new URL(request.url);
  const route = (params.path || []).join('/');
  const col = url.searchParams.get('col') || '';
  const id = url.searchParams.get('id') || '';
  const m = request.method;

  if (route === 'me') return json({ email, photos: !!env.PHOTOS });
  const needsPhotos = route === 'photo' || (route === 'doc' && col.endsWith('/photos'));
  if (needsPhotos && !env.PHOTOS) return json({ error: 'photo storage not set up yet' }, 503);

  if (route === 'list' && m === 'GET') {
    if (!COL.test(col) || isCopy(col)) return json({ error: 'bad collection' }, 400);
    const { results } = await env.DB.prepare('SELECT data FROM docs WHERE owner = ? AND col = ?').bind(email, col).all();
    return json(results.map(r => JSON.parse(r.data)));
  }

  if (route === 'doc') {
    if (!COL.test(col) || !ID.test(id)) return json({ error: 'bad path' }, 400);
    if (m === 'GET') {
      if (isCopy(col)) {
        const o = await env.PHOTOS.get(`${email}/copies/${id}.json`);
        return o ? new Response(o.body, { headers: { 'content-type': 'application/json', 'cache-control': 'no-store' } }) : json(null);
      }
      const row = await env.DB.prepare('SELECT data FROM docs WHERE owner = ? AND col = ? AND id = ?').bind(email, col, id).first();
      return row ? new Response(row.data, { headers: { 'content-type': 'application/json', 'cache-control': 'no-store' } }) : json(null);
    }
    if (m === 'PUT') {
      const text = await request.text();
      if (text.length > 1900000) return json({ error: 'too large' }, 413);
      let o; try { o = JSON.parse(text); } catch { return json({ error: 'bad json' }, 400); }
      if (!o || typeof o !== 'object') return json({ error: 'bad json' }, 400);
      if (isCopy(col)) {
        await env.PHOTOS.put(`${email}/copies/${id}.json`, text, { httpMetadata: { contentType: 'application/json' } });
        return json({ ok: true });
      }
      const upd = Number(o.updatedAt) || Date.now();
      // last write wins: an older copy never overwrites a newer one
      await env.DB.prepare(
        `INSERT INTO docs (owner, col, id, data, updated_at, deleted) VALUES (?1, ?2, ?3, ?4, ?5, ?6)
         ON CONFLICT (owner, col, id) DO UPDATE SET data = excluded.data, updated_at = excluded.updated_at, deleted = excluded.deleted
         WHERE excluded.updated_at >= docs.updated_at`
      ).bind(email, col, id, text, upd, o.deleted ? 1 : 0).run();
      return json({ ok: true });
    }
  }

  if (route === 'photo' && m === 'POST') {
    const type = request.headers.get('content-type') || 'image/jpeg';
    if (!/^image\//.test(type)) return json({ error: 'images only' }, 415);
    const pid = crypto.randomUUID().replace(/-/g, '');
    const o = await env.PHOTOS.put(`${email}/photos/${pid}`, request.body, { httpMetadata: { contentType: type } });
    return json({ id: pid, url: '/_blob/' + pid, sizeBytes: o ? o.size : 0, contentType: type });
  }

  if (route === 'export' && m === 'GET') {
    const { results } = await env.DB.prepare('SELECT col, data FROM docs WHERE owner = ?').bind(email).all();
    const out = { app: 'cranebrain-server', exportedAt: new Date().toISOString(), docs: results.map(r => ({ col: r.col, ...JSON.parse(r.data) })) };
    return new Response(JSON.stringify(out), { headers: { 'content-type': 'application/json', 'content-disposition': 'attachment; filename="cranebrain-server-export.json"' } });
  }

  return json({ error: 'not found' }, 404);
}


async function blobHandler({ request, env, params }) {
  const email = await auth(env, request);
  if (!email) return new Response('unauthorised', { status: 401 });
  if (!env.PHOTOS) return new Response('photo storage not set up yet', { status: 503 });
  if (!/^[a-f0-9]{32}$/.test(params.id)) return new Response('not found', { status: 404 });
  const o = await env.PHOTOS.get(`${email}/photos/${params.id}`);
  if (!o) return new Response('not found', { status: 404 });
  return new Response(o.body, { headers: { 'content-type': o.httpMetadata?.contentType || 'image/jpeg', 'cache-control': 'private, max-age=31536000, immutable' } });
}

import FILES from './files.generated.js';
const SEC={'x-content-type-options':'nosniff','referrer-policy':'same-origin','x-frame-options':'DENY'};
function asset(path){const f=FILES[path]||FILES['/index.html'];const body=f.b?Uint8Array.from(atob(f.b),c=>c.charCodeAt(0)):f.t;
 const cache=/\.png$/.test(path)&&FILES[path]?'public, max-age=86400':'no-cache';
 return new Response(body,{headers:{'content-type':f.ct,'cache-control':cache,...SEC}})}
export default {
 async fetch(request, env) {
  const url = new URL(request.url);
  if (url.pathname.startsWith('/api/')) return apiHandler({ request, env, params: { path: url.pathname.slice(5).split('/').filter(Boolean) } });
  const m = url.pathname.match(/^\/_blob\/([^/]+)$/);
  if (m) return blobHandler({ request, env, params: { id: m[1] } });
  if (request.method !== 'GET' && request.method !== 'HEAD') return new Response('method not allowed', { status: 405 });
  return asset(url.pathname === '/' ? '/index.html' : url.pathname);
 }
};
