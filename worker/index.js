// Cloudflare entry point. The interface (dist/) is served by Workers static assets; every /api/*
// request goes to a Durable Object that owns a SQLite database: the real club's, or the demo space's,
// a second club with fictitious data (worker/space.js chooses). Writes are applied one at a time, in a
// single place, with nothing else to host or pay for.
import { DurableObject } from 'cloudflare:workers';
import { createApi } from './api.js';
import { durableDb } from './db.js';
import { routeApi } from './space.js';

export class ClubDO extends DurableObject {
  constructor(ctx, env) {
    super(ctx, env);
    this.api = createApi({ db: durableDb(ctx.storage), env });
    ctx.blockConcurrencyWhile(() => this.api.init());
  }

  fetch(request) {
    return this.api.handle(request);
  }

  // RPC, first step of a request made in the demo space: sessions live here, so the session is checked
  // here. Gives null, or the account's identity and the configuration the demo space copies.
  demoContext(tokenHash) {
    return this.api.demoContext(tokenHash);
  }
}

// The demo space: the same API on its own database. Its one entry point is the RPC below, which serves a
// request as an account the real club has vouched for. There is deliberately no fetch(): nothing can reach
// this object with a cookie to read, and no session is ever looked up here.
export class DemoDO extends DurableObject {
  constructor(ctx, env) {
    super(ctx, env);
    this.api = createApi({ db: durableDb(ctx.storage), env, demo: true });
  }

  handleDemo(request, context) {
    return this.api.handleDemo(request, context);
  }
}

// Safari plays a video only when it can ask for byte ranges, which static assets answer with the
// whole file: the sign-in smoke loop goes through here and is served piece by piece (206).
async function withRanges(request, env) {
  const res = await env.ASSETS.fetch(new Request(request.url, { method: request.method === 'HEAD' ? 'HEAD' : 'GET' }));
  const range = /^bytes=(\d*)-(\d*)$/.exec(request.headers.get('range') ?? '');
  const headers = new Headers(res.headers);
  headers.set('accept-ranges', 'bytes');
  if (!range || !res.ok || request.method === 'HEAD' || (range[1] === '' && range[2] === '')) {
    return new Response(res.body, { status: res.status, headers });
  }
  const body = await res.arrayBuffer();
  const size = body.byteLength;
  const start = range[1] === '' ? Math.max(0, size - Number(range[2])) : Number(range[1]);
  const end = range[1] === '' || range[2] === '' ? size - 1 : Math.min(Number(range[2]), size - 1);
  if (start >= size || start > end) return new Response(null, { status: 416, headers: { 'content-range': `bytes */${size}` } });
  headers.set('content-range', `bytes ${start}-${end}/${size}`);
  headers.set('content-length', String(end - start + 1));
  return new Response(body.slice(start, end + 1), { status: 206, headers });
}

export default {
  fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname.startsWith('/api/')) {
      const club = env.CLUB.get(env.CLUB.idFromName('club'));
      const demo = env.DEMO.get(env.DEMO.idFromName('demo'));
      return routeApi(request, {
        real: { handle: (r) => club.fetch(r), demoContext: (hash) => club.demoContext(hash) },
        demo: { handleDemo: (r, context) => demo.handleDemo(r, context) },
      });
    }
    if (url.pathname === '/login-smoke.mp4') return withRanges(request, env);
    return env.ASSETS.fetch(request);
  },
};
