// The profit taking (« Prendre des bénéfices »): money out of the till and out of one caisse, never an expense nor a
// cut in the club's result. An associé takes only from his own caisse or the common one; never more than the caisse.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { addMonths } from '../shared/time.js';
import { Server, Client, ok, UM } from './harness.js';

const server = new Server({}, { lenientTariffs: true });
let admin;
let cig;
let cha;
let ger;
let today;

const refused = (r, status, code) => {
  assert.equal(r.status, status, JSON.stringify(r.data));
  if (code) assert.equal(r.data.error.code, code);
};
const caisses = async () => ok(await admin.get('/api/caisses'));
const take = (who, body) => who.post('/api/caisses/retrait', { method: 'Espèces', ...body });
const entries = () => server.club.get('SELECT COUNT(*) AS n FROM ledger_entries').n;

before(async () => {
  await server.start();
  await server.addUser('admin', 'Propriétaire', 'admin', 'retrait-admin-password');
  await server.addUser('cig', 'Associé cigares', 'associe', 'retrait-cig-password', 'cigares');
  await server.addUser('cha', 'Associé champagne', 'associe', 'retrait-cha-password', 'alcool');
  await server.addUser('ger', 'Gérant', 'gerant', 'retrait-ger-password');
  admin = new Client(server);
  cig = new Client(server);
  cha = new Client(server);
  ger = new Client(server);
  today = (await admin.login('admin', 'retrait-admin-password')).biz_today;
  await cig.login('cig', 'retrait-cig-password');
  await cha.login('cha', 'retrait-cha-password');
  await ger.login('ger', 'retrait-ger-password');
  const CIG = ok(await admin.post('/api/products', { category: 'cigare', name: 'Cigare test', reference: 'CIG', price: 50000 * UM, initial_stock: 10 })).id;
  ok(await ger.post('/api/shop/sales', { account: 'cigares', buyer: { kind: 'journalier' }, lines: [{ product_id: CIG, quantity: 2 }], method: 'Espèces' }));
});
after(() => server.destroy());

test('l’associé prend ses bénéfices : la caisse et le solde en caisse baissent, pas le résultat', async () => {
  const before = await caisses();
  const treasury = ok(await admin.get(`/api/treasury?from=${today}`));
  const out = ok(await take(cig, { account: 'cigares', amount: 40000 * UM }));
  assert.equal(out.entry.kind, 'retrait');
  assert.equal(out.entry.kind_label, 'Prise de bénéfices');
  const after = await caisses();
  assert.equal(after.caisses.cigares.taken, 40000 * UM);
  assert.equal(after.caisses.cigares.balance, before.caisses.cigares.balance - 40000 * UM);
  assert.equal(after.till, before.till - 40000 * UM);
  const tiles = after.fund.amount + after.cards + after.caisses.reservations.balance + after.caisses.alcool.balance + after.caisses.cigares.balance;
  assert.equal(tiles, after.till);
  const t = ok(await admin.get(`/api/treasury?from=${today}`));
  assert.equal(t.result.expenses, treasury.result.expenses);
  assert.equal(t.result.result, treasury.result.result);
  const listed = ok(await admin.get(`/api/ledger/entries?from=${today}`)).entries.find((e) => e.id === out.entry.id);
  assert.equal(listed.kind_label, 'Prise de bénéfices');
});

test('jamais plus que la caisse', async () => {
  const balance = (await caisses()).caisses.cigares.balance;
  const n = entries();
  refused(await take(cig, { account: 'cigares', amount: balance + 1 }), 409, 'CAISSE_INSUFFISANTE');
  assert.equal(entries(), n);
});

test('un associé ne prend pas dans la caisse de l’autre ; la caisse commune, si', async () => {
  refused(await take(cig, { account: 'alcool', amount: 1 }), 403);
  const apport = ok(await admin.get('/api/ledger/categories')).find((c) => c.code === 'apport');
  ok(await admin.post('/api/ledger/entries', { kind: 'recette', category_id: apport.id, amount: 10000 * UM, method: 'Espèces' }));
  ok(await take(cig, { account: 'reservations', amount: 10000 * UM }));
  assert.equal((await caisses()).caisses.reservations.taken, 10000 * UM);
});

test('le gérant ne prend pas de bénéfices', async () => {
  refused(await take(ger, { account: 'reservations', amount: 1 }), 403);
});

test('annulée avec un motif, la caisse remonte ; un mois clôturé refuse', async () => {
  const before = (await caisses()).caisses.cigares;
  const out = ok(await take(cig, { account: 'cigares', amount: 5000 * UM }));
  ok(await admin.post(`/api/ledger/entries/${out.entry.id}/cancel`, { reason: 'Erreur de montant' }));
  assert.equal((await caisses()).caisses.cigares.taken, before.taken);
  const month = addMonths(`${today.slice(0, 7)}-01`, -1).slice(0, 7);
  ok(await admin.post('/api/closings', { month }));
  refused(await take(admin, { account: 'cigares', amount: 1000 * UM, biz_date: `${month}-15` }), 409, 'PERIODE_CLOTUREE');
});

test('grand livre : une prise de bénéfices, jamais une dépense', async () => {
  const book = ok(await admin.get(`/api/ledger/book?from=${today}`));
  const rows = book.rows.filter((r) => r.type === 'retrait');
  assert.ok(rows.length > 0);
  for (const r of rows) {
    assert.ok(r.label.startsWith('Prise de bénéfices'), r.label);
    assert.equal(r.type_label, 'Prise de bénéfices');
    assert.ok(r.out > 0);
  }
});

test('trésorerie et clôture : les bénéfices pris à part, hors résultat', async () => {
  const t = ok(await admin.get(`/api/treasury?from=${today}`));
  const taken = server.club.get("SELECT COALESCE(SUM(amount), 0) AS n FROM ledger_entries WHERE kind = 'retrait' AND status = 'active' AND biz_date = ?", today).n;
  assert.ok(taken > 0);
  assert.equal(t.result.taken, taken);
});
