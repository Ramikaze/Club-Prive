// The inventory script (scripts/import-inventaire.mjs): it checks the owner's local count (references, quantities, the
// expected total), then asks the inventory door for a dry run or sends it. Every name and figure here is made up: the
// real count (inventaire.local) is the owner's and never enters the repository.
import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Server, Client, ok, UM } from './harness.js';
import { main } from '../scripts/import-inventaire.mjs';

const TOKEN = 'code-import-fictif';
const BASE = 'http://localhost:8787';
const servers = [];
const folders = [];
afterEach(() => {
  for (const s of servers.splice(0)) s.destroy();
  for (const d of folders.splice(0)) fs.rmSync(d, { recursive: true, force: true });
});

const DATA = {
  reason: 'Inventaire du 17/11/2026',
  expected_total: 103,
  items: [
    { reference: 'CIG-901', count: 30, source: 'alpha' },
    { create: { name: 'Coupe-cigare fictif', price: 0 }, count: 73, source: 'coupe' },
  ],
};

function dataFile(data = DATA) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'inventaire-'));
  folders.push(dir);
  const file = path.join(dir, 'inventaire.local');
  fs.writeFileSync(file, JSON.stringify(data));
  return { dir, file };
}

async function site() {
  const server = new Server({ IMPORT_TOKEN: TOKEN });
  servers.push(server);
  await server.start();
  await server.addUser('admin', 'Propriétaire', 'admin', 'inv-admin-password');
  const admin = new Client(server);
  await admin.login('admin', 'inv-admin-password');
  ok(await admin.post('/api/products', { category: 'cigare', name: 'Cigare Alpha', reference: 'CIG-901', price: 10000 * UM, initial_stock: 12 }));
  const calls = [];
  const fetch = async (url, init) => {
    calls.push({ body: JSON.parse(init.body), token: new Headers(init.headers).get('x-import-token') });
    return server.fetch(new URL(url).pathname, init);
  };
  return { server, fetch, calls };
}

const run = async (argv, { fetch, env = {}, cwd } = {}) => {
  const lines = [];
  const code = await main(argv, { env, cwd: cwd ?? process.cwd(), log: (l = '') => lines.push(String(l)), fetch: fetch ?? (() => { throw new Error('aucun envoi attendu'); }) });
  return { code, text: lines.join('\n') };
};

test('vérification seule : lignes et total, rien n’est envoyé', async () => {
  const { file } = dataFile();
  const r = await run(['--data', file]);
  assert.equal(r.code, 0, r.text);
  assert.match(r.text, /2 lignes, 103 pièces/);
  assert.match(r.text, /Rien n'a été envoyé/);
});

test('total faux : refusé avant tout envoi', async () => {
  const { file } = dataFile({ ...DATA, expected_total: 100 });
  const r = await run(['--data', file, '--url', BASE, '--send'], { env: { IMPORT_TOKEN: TOKEN } });
  assert.equal(r.code, 1);
  assert.match(r.text, /total/i);
});

test('essai à blanc puis envoi, puis relance : rien ne bouge', async () => {
  const { file } = dataFile();
  const { server, fetch, calls } = await site();
  const dry = await run(['--data', file, '--url', BASE, '--dry-run'], { fetch, env: { IMPORT_TOKEN: TOKEN } });
  assert.equal(dry.code, 0, dry.text);
  assert.equal(calls[0].body.dry_run, true);
  assert.equal(calls[0].body.items[0].source, undefined);
  assert.equal(calls[0].token, TOKEN);
  assert.ok(!dry.text.includes(TOKEN));
  assert.match(dry.text, /Cigare Alpha \(CIG-901\) : 12 → 30/);
  assert.equal(server.club.get("SELECT stock_qty FROM products WHERE reference = 'CIG-901'").stock_qty, 12);
  const sent = await run(['--data', file, '--url', BASE, '--send'], { fetch, env: { IMPORT_TOKEN: TOKEN } });
  assert.equal(sent.code, 0, sent.text);
  assert.equal(server.club.get("SELECT stock_qty FROM products WHERE reference = 'CIG-901'").stock_qty, 30);
  const again = await run(['--data', file, '--url', BASE, '--send'], { fetch, env: { IMPORT_TOKEN: TOKEN } });
  assert.equal(again.code, 0, again.text);
  assert.match(again.text, /0 stock à ajuster/);
});
