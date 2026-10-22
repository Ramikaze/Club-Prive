// Test harness: the real API (worker/api.js) on a throwaway node:sqlite database, called with
// standard Request objects exactly as the Durable Object receives them.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createApi } from '../worker/api.js';
import { nodeDb } from '../worker/db-node.js';
import { hashPassword } from '../worker/auth.js';

export const UM = 100; // amounts are stored in hundredths
export const ORIGIN = 'http://club.test';

export class Server {
  constructor(env = {}) {
    this.env = env;
    this.dir = fs.mkdtempSync(path.join(os.tmpdir(), 'club-test-'));
    this.file = path.join(this.dir, 'test.sqlite');
  }

  async start() {
    this.db = nodeDb(this.file);
    this.api = createApi({ db: this.db, env: this.env });
    await this.api.init();
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
