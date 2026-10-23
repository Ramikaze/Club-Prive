// Test harness: the real API (worker/api.js) on a throwaway node:sqlite database, called with
// standard Request objects exactly as the Durable Object receives them.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createApi } from '../worker/api.js';
import { nodeDb } from '../worker/db-node.js';
import { hashPassword } from '../worker/auth.js';
import { routeApi } from '../worker/space.js';

export const UM = 100; // amounts are stored in hundredths
export const ORIGIN = 'http://club.test';

export class Server {
  // `demo`: the club runs as the demo space. `lenientTariffs`: see start().
  constructor(env = {}, { demo = false, lenientTariffs = false } = {}) {
    this.env = env;
    this.demo = demo;
    this.lenientTariffs = lenientTariffs;
    this.dir = fs.mkdtempSync(path.join(os.tmpdir(), 'club-test-'));
    this.file = path.join(this.dir, 'test.sqlite');
  }

  async start() {
    this.db = nodeDb(this.file);
    this.api = createApi({ db: this.db, env: this.env, demo: this.demo });
    await this.api.init();
    // The scenarios run with unvalidated tariffs usable, as in the demo space: the default tariffs
    // are unvalidated and the real club refuses to charge with them. Tests of the real club's own
    // rules leave this off.
    if (this.lenientTariffs) {
      this.club.demo = true;
      this.club.cachedSettings = null;
    }
    // Tests book on dates relative to today, whatever the weekday, so on a fresh database the
    // weekend minimum (2 h on Friday and Saturday from 18:00) starts equal to the weekday one; the
    // weekend test raises it. A restart keeps whatever the test set.
    if (!this.started) {
      this.db.run(
        "UPDATE settings SET value = json_set(value, '$.weekend_min_duration_min', json_extract(value, '$.min_duration_min')) WHERE key = 'booking'",
      );
      this.club.cachedSettings = null;
      this.started = true;
    }
  }

  // Same database file, fresh process state: what a Durable Object restart looks like.
  async restart() {
    this.db.close();
    await this.start();
  }

  destroy() {
    this.db.close();
    fs.rmSync(this.dir, { recursive: true, force: true });
  }

  get club() { return this.api.club; }

  async addUser(login, name, role, password) {
    const passwordHash = await hashPassword(password);
    this.club.tx(() => this.club.createUser(null, { login, name, role, password_hash: passwordHash }));
  }

  fetch(url, init) {
    return this.api.handle(new Request(ORIGIN + url, init));
  }
}

// The Worker in front of two clubs: every /api/* request goes through routeApi, as worker/index.js
// does with the two Durable Objects. The calls cross as an RPC does: always as promises, the real club
// reached through `handle` and `demoContext` only, the demo space through `handleDemo` only, and only
// data (a copy) going over with the request. A Client works on a Site as it does on a Server.
export class Site {
  constructor(real, demo) {
    this.real = real;
    this.demo = demo;
  }

  fetch(url, init) {
    return routeApi(new Request(ORIGIN + url, init), {
      real: {
        handle: (request) => this.real.api.handle(request),
        demoContext: async (tokenHash) => this.real.api.demoContext(tokenHash),
      },
      demo: { handleDemo: (request, context) => this.demo.api.handleDemo(request, structuredClone(context)) },
    });
  }
}

export class Client {
  constructor(server) {
    this.server = server;
    this.cookie = '';
  }

  async call(method, url, body, headers = {}) {
    const res = await this.server.fetch(url, {
      method,
      headers: { 'content-type': 'application/json', ...(this.cookie ? { cookie: this.cookie } : {}), ...headers },
      body: method === 'GET' ? undefined : JSON.stringify(body ?? {}),
    });
    const setCookie = res.headers.get('set-cookie');
    if (setCookie) this.cookie = setCookie.split(';')[0];
    const raw = await res.text();
    let data;
    try { data = JSON.parse(raw); } catch { data = raw; }
    return { status: res.status, data, headers: res.headers };
  }

  get(url) { return this.call('GET', url); }
  post(url, body, headers) { return this.call('POST', url, body, headers); }
  put(url, body) { return this.call('PUT', url, body); }
  del(url, body) { return this.call('DELETE', url, body); }

  async login(login, password) {
    const r = await this.post('/api/login', { login, password });
    assert.equal(r.status, 200, JSON.stringify(r.data));
    return r.data;
  }
}

export const ok = (r) => {
  assert.equal(r.status, 200, JSON.stringify(r.data));
  return r.data;
};
