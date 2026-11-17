// The Digibox accounts import script (scripts/import-reprise.mjs): it checks the owner's local file (clients, debts,
// suppliers), then asks the import door for a dry run or sends it for real. Every name and amount here is made up: the
// real file (reprise-digibox.local) is the owner's and never enters the repository.
import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Server } from './harness.js';
import { main } from '../scripts/import-reprise.mjs';

const TOKEN = 'code-import-fictif';
const BASE = 'http://localhost:8787';
const servers = [];
const folders = [];
afterEach(() => {
  for (const s of servers.splice(0)) s.destroy();
  for (const d of folders.splice(0)) fs.rmSync(d, { recursive: true, force: true });
});

const DATA = {
  expected_total_clients: 175500,
  clients: [
    { last_name: 'SOCIÉTÉ FICTIVE', debt: 150000 },
    { last_name: 'KEVIN', phone: '06 000 00 01', debt: 25500 },
    { first_name: 'Ali', last_name: 'FICTIF', phone: '06 000 00 02' },
  ],
  suppliers: [{ name: 'Fournisseur Fictif', account: 'cigares', currency: 'EUR', carried_over: 900000 }],
};

function dataFile(data = DATA) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'reprise-'));
  folders.push(dir);
  const file = path.join(dir, 'reprise.local');
  fs.writeFileSync(file, JSON.stringify(data));
  return { dir, file };
}

async function site() {
  const server = new Server({ IMPORT_TOKEN: TOKEN });
  servers.push(server);
  await server.start();
  const calls = [];
  const fetch = async (url, init) => {
    calls.push({ url, body: JSON.parse(init.body), token: new Headers(init.headers).get('x-import-token') });
    const { pathname } = new URL(url);
    return server.fetch(pathname, init);
  };
  return { server, fetch, calls };
}

const run = async (argv, { fetch, env = {}, cwd } = {}) => {
  const lines = [];
  const code = await main(argv, { env, cwd: cwd ?? process.cwd(), log: (l = '') => lines.push(String(l)), fetch: fetch ?? (() => { throw new Error('aucun envoi attendu'); }) });
  return { code, text: lines.join('\n') };
};

test('vérification seule : la liste, les totaux, rien n’est envoyé', async () => {
  const { file } = dataFile();
  const r = await run(['--data', file]);
  assert.equal(r.code, 0, r.text);
  assert.match(r.text, /3 clients, dont 2 avec une dette : 175 500 FCFA/);
  assert.match(r.text, /Fournisseur Fictif/);
  assert.match(r.text, /Rien n'a été envoyé/);
});

test('total faux ou fiche sans nom : refusé avant tout envoi', async () => {
  const wrong = dataFile({ ...DATA, expected_total_clients: 175000 });
  const r = await run(['--data', wrong.file, '--url', BASE, '--send'], { env: { IMPORT_TOKEN: TOKEN } });
  assert.equal(r.code, 1);
  assert.match(r.text, /total des dettes/i);
  const noName = dataFile({ ...DATA, clients: [...DATA.clients, { phone: '06 000 00 04' }], expected_total_clients: 175500 });
  const r2 = await run(['--data', noName.file]);
  assert.equal(r2.code, 1);
  assert.match(r2.text, /n° 4/);
});

test('essai à blanc puis envoi, puis relance : rien ne double', async () => {
  const { file } = dataFile();
  const { server, fetch, calls } = await site();
  const count = () => server.club.get('SELECT COUNT(*) AS n FROM members').n;
  const before = count();
  const dry = await run(['--data', file, '--url', BASE, '--dry-run'], { fetch, env: { IMPORT_TOKEN: TOKEN } });
  assert.equal(dry.code, 0, dry.text);
  assert.equal(calls[0].body.dry_run, true);
  assert.equal(calls[0].token, TOKEN);
  assert.ok(!dry.text.includes(TOKEN));
  assert.match(dry.text, /SOCIÉTÉ FICTIVE.*créer/);
  assert.equal(count(), before);
  const sent = await run(['--data', file, '--url', BASE, '--send'], { fetch, env: { IMPORT_TOKEN: TOKEN } });
  assert.equal(sent.code, 0, sent.text);
  assert.equal(calls[1].body.dry_run, false);
  assert.equal(count(), before + 3);
  assert.match(sent.text, /175 500 FCFA/);
  const again = await run(['--data', file, '--url', BASE, '--send'], { fetch, env: { IMPORT_TOKEN: TOKEN } });
  assert.equal(again.code, 0, again.text);
  assert.match(again.text, /déjà repris/);
  assert.equal(count(), before + 3);
});

test('sans code d’import : rien n’est envoyé', async () => {
  const { file, dir } = dataFile();
  const r = await run(['--data', file, '--url', BASE, '--send'], { cwd: dir });
  assert.equal(r.code, 1);
  assert.match(r.text, /Code d'import introuvable/);
});
