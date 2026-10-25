// « Compter la caisse » on the cash page: the first cash fund (opening balances dated today), then counts that record
// the gap between the till and the books as an « Écart de caisse » entry, a surplus as an other receipt and a
// shortage as an expense, so that the balance becomes what was counted. Administrators only; a closed month refuses.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { addDays } from '../shared/time.js';
import { Server, Client, ok, UM } from './harness.js';

const server = new Server({});
let admin;
let manager;
let today;

const refused = (r, status, code) => {
  assert.equal(r.status, status, JSON.stringify(r.data));
  if (code) assert.equal(r.data.error.code, code);
};

before(async () => {
  await server.start();
  await server.addUser('admin', 'Admin', 'admin', 'cash-count-admin-password');
  await server.addUser('gerant', 'Gérant', 'gerant', 'cash-count-manager-password');
  admin = new Client(server);
  manager = new Client(server);
  today = (await admin.login('admin', 'cash-count-admin-password')).biz_today;
  await manager.login('gerant', 'cash-count-manager-password');
});
after(() => server.destroy());

const balance = async (method) => ok(await admin.get(`/api/treasury?from=${today}&to=${today}`)).accounts.find((a) => a.method === method).closing;
const entryCount = () => server.club.get('SELECT COUNT(*) AS n FROM ledger_entries').n;
const entry = (id) => server.club.entryRows('e.id = ?', id)[0];

test('le fond de caisse de départ fixe la date du jour et les montants, une seule fois', async () => {
  // A movement before the fund: once the fund is dated today, it no longer counts in the balances.
  const categories = ok(await admin.get('/api/ledger/categories'));
  const income = categories.find((c) => c.kind === 'recette' && c.active && c.name !== 'Écart de caisse');
  ok(await admin.post('/api/ledger/entries', { kind: 'recette', category_id: income.id, amount: 9000 * UM, method: 'Espèces', biz_date: addDays(today, -1) }));
  assert.equal(await balance('Espèces'), 9000 * UM);
  const res = ok(await admin.post('/api/treasury/fund', { amounts: { 'Espèces': 50000 * UM, Virement: 200000 * UM, 'MTN MoMo': 0 } }));
  assert.deepEqual(server.club.settings().opening_balances, { date: today, amounts: { 'Espèces': 50000 * UM, Virement: 200000 * UM } });
  assert.deepEqual(res.bundle.settings.opening_balances, server.club.settings().opening_balances);
  assert.equal(res.treasury.accounts.find((a) => a.method === 'Espèces').closing, 50000 * UM);
  assert.equal(await balance('Virement'), 200000 * UM);
  // Once set, the fund is adjusted by counting, not set again.
  refused(await admin.post('/api/treasury/fund', { amounts: { 'Espèces': 1 } }), 409, 'FOND_EXISTANT');
  refused(await admin.post('/api/treasury/fund', {}), 409, 'FOND_EXISTANT');
});

test('un surplus devient une entrée diverse « Écart de caisse » et le solde vaut le montant compté', async () => {
  const expected = await balance('Espèces');
  const before = entryCount();
  const res = ok(await admin.post('/api/treasury/count', { method: 'Espèces', counted: expected + 1500 * UM, reason: '' }));
  assert.equal(res.expected, expected);
  assert.equal(res.counted, expected + 1500 * UM);
  assert.equal(res.gap, 1500 * UM);
  assert.equal(entryCount(), before + 1);
  const e = entry(res.entry_id);
  assert.equal(e.kind, 'recette');
  assert.equal(e.category_name, 'Écart de caisse');
  assert.equal(e.method, 'Espèces');
  assert.equal(e.amount, 1500 * UM);
  assert.equal(e.biz_date, today);
  assert.equal(e.label, 'Comptage de caisse');
  assert.equal(await balance('Espèces'), expected + 1500 * UM);
  assert.equal(res.treasury.accounts.find((a) => a.method === 'Espèces').closing, expected + 1500 * UM);
});

test('un manque devient une dépense « Écart de caisse » sur le bon compte', async () => {
  const expected = await balance('Virement');
  const res = ok(await admin.post('/api/treasury/count', { method: 'Virement', counted: expected - 700 * UM, reason: 'Frais non saisis' }));
  assert.equal(res.gap, -700 * UM);
  const e = entry(res.entry_id);
  assert.equal(e.kind, 'depense');
  assert.equal(e.category_name, 'Écart de caisse');
  assert.equal(e.method, 'Virement');
  assert.equal(e.amount, 700 * UM);
  assert.equal(e.label, 'Frais non saisis');
  assert.equal(await balance('Virement'), expected - 700 * UM);
});

test('un comptage renvoyé avec la même clé n’enregistre qu’un écart', async () => {
  const expected = await balance('Espèces');
  const before = entryCount();
  const body = { method: 'Espèces', counted: expected + 200 * UM };
  const first = ok(await admin.post('/api/treasury/count', body, { 'idempotency-key': 'count-retry-0001' }));
  const again = ok(await admin.post('/api/treasury/count', body, { 'idempotency-key': 'count-retry-0001' }));
  assert.equal(again.entry_id, first.entry_id);
  assert.equal(entryCount(), before + 1);
  assert.equal(await balance('Espèces'), expected + 200 * UM);
});

test('une caisse juste n’enregistre rien', async () => {
  const expected = await balance('Espèces');
  const before = entryCount();
  const res = ok(await admin.post('/api/treasury/count', { method: 'Espèces', counted: expected }));
  assert.equal(res.gap, 0);
  assert.equal(res.entry_id, null);
  assert.equal(entryCount(), before);
  assert.equal(await balance('Espèces'), expected);
});

test('le gérant ne compte pas la caisse et ne fixe pas le fond', async () => {
  refused(await manager.post('/api/treasury/count', { method: 'Espèces', counted: 0 }), 403);
  refused(await manager.post('/api/treasury/fund', { amounts: { 'Espèces': 0 } }), 403);
});

test('un compte inconnu ou un montant invalide est refusé', async () => {
  refused(await admin.post('/api/treasury/count', { method: 'Coffre', counted: 0 }), 400);
  refused(await admin.post('/api/treasury/count', { method: 'Espèces', counted: -1 }), 400);
  refused(await admin.post('/api/treasury/count', { method: 'Espèces', counted: 'beaucoup' }), 400);
});

test('les catégories « Écart de caisse » ne se renomment ni ne se désactivent', async () => {
  const gaps = ok(await admin.get('/api/ledger/categories')).filter((c) => c.name === 'Écart de caisse');
  assert.deepEqual(gaps.map((c) => c.kind).sort(), ['depense', 'recette']);
  for (const c of gaps) {
    refused(await admin.put(`/api/ledger/categories/${c.id}`, { name: 'Autre' }), 409, 'CATEGORIE_PROTEGEE');
    refused(await admin.put(`/api/ledger/categories/${c.id}`, { active: false }), 409, 'CATEGORIE_PROTEGEE');
  }
});

test('un mois clôturé refuse le comptage', async () => {
  const expected = await balance('Espèces');
  const before = entryCount();
  server.club.run("INSERT INTO closed_periods (month, closed_at, summary) VALUES (?, ?, '{}')", today.slice(0, 7), new Date().toISOString());
  try {
    refused(await admin.post('/api/treasury/count', { method: 'Espèces', counted: expected + 100 * UM }), 409, 'PERIODE_CLOTUREE');
    assert.equal(entryCount(), before);
  } finally {
    server.club.run('DELETE FROM closed_periods WHERE month = ?', today.slice(0, 7));
  }
});
