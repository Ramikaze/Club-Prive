// Cloudflare entry point. The interface (dist/) is served by Workers static assets; every /api/*
// request goes to one Durable Object that owns the club's SQLite database, so writes are applied
// one at a time, in a single place, with nothing else to host or pay for.
import { DurableObject } from 'cloudflare:workers';
import { createApi } from './api.js';
import { durableDb } from './db.js';

export class ClubDO extends DurableObject {
  constructor(ctx, env) {
    super(ctx, env);
    this.api = createApi({ db: durableDb(ctx.storage), env });
    ctx.blockConcurrencyWhile(() => this.api.init());
  }

  fetch(request) {
    return this.api.handle(request);
  }
}

export default {
  fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname.startsWith('/api/')) return env.CLUB.get(env.CLUB.idFromName('club')).fetch(request);
    return env.ASSETS.fetch(request);
  },
};
