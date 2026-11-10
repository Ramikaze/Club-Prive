// Products given away (« Offert », spec docs/superpowers/specs/2026-11-10-offert-design.md): only an associé gives,
// only in his rayon; the stock goes down, no money moves, each gift keeps the cost price of its day and the name of
// whoever gave it; the gifts are listed per associé, the cancelled ones apart.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { Server, Client, ok, UM } from './harness.js';
import { MIGRATIONS } from '../worker/schema.js';

const server = new Server({});
let admin;
let ger;
let cig;
let cha;
let CIG;
let CHP;
let today;
let member;

const refused = (r, status, code) => {
  assert.equal(r.status, status, JSON.stringify(r.data));
  if (code) assert.equal(r.data.error.code, code);
};

before(async () => {
  await server.start();
  await server.addUser('admin', 'Propriétaire', 'admin', 'gifts-admin-password');
  await server.addUser('ger', 'Gérant', 'gerant', 'gifts-ger-password');
  await server.addUser('cig', 'Associé cigares', 'associe', 'gifts-cig-password', 'cigares');
  await server.addUser('cha', 'Associé boissons', 'associe', 'gifts-cha-password', 'alcool');
  admin = new Client(server);
  ger = new Client(server);
  cig = new Client(server);
  cha = new Client(server);
  today = (await admin.login('admin', 'gifts-admin-password')).biz_today;
  await ger.login('ger', 'gifts-ger-password');
  await cig.login('cig', 'gifts-cig-password');
  await cha.login('cha', 'gifts-cha-password');
  CIG = ok(await admin.post('/api/products', { category: 'cigare', name: 'Cigare cadeau', reference: 'CIG-K', price: 5000 * UM, initial_stock: 10 })).id;
  CHP = ok(await admin.post('/api/products', { category: 'bouteille', name: 'Champagne cadeau', reference: 'CHP-K', price: 20000 * UM, initial_stock: 10 })).id;
});
after(() => server.destroy());

test('prix de revient : l’associé du rayon le saisit, le gérant ne le voit pas', async () => {
  const p = ok(await cig.put(`/api/products/${CIG}`, { cost_price: 3000 * UM }));
  assert.equal(p.cost_price, 3000 * UM);
  refused(await cha.put(`/api/products/${CIG}`, { cost_price: 1 * UM }), 403);
  // Empty means « not known yet ».
  assert.equal(ok(await cha.put(`/api/products/${CHP}`, { cost_price: '' })).cost_price, null);
  for (const item of ok(await ger.get('/api/products'))) assert.ok(!('cost_price' in item), 'le gérant reçoit un prix de revient');
  assert.equal(ok(await admin.get('/api/products')).find((x) => x.id === CIG).cost_price, 3000 * UM);
  refused(await cig.put(`/api/products/${CIG}`, { cost_price: -1 }), 400);
});

test('V28 : les mouvements de stock existants sont gardés', async () => {
  assert.ok(MIGRATIONS.length >= 28);
  const moves = ok(await admin.get(`/api/stock-movements?product_id=${CIG}`));
  assert.ok(moves.some((m) => m.kind === 'stock_initial' && m.quantity === 10));
});

const stockOf = (id) => server.club.get('SELECT stock_qty FROM products WHERE id = ?', id).stock_qty;
const money = () => server.club.get(`SELECT (SELECT COUNT(*) FROM payments) AS payments, (SELECT COUNT(*) FROM charges) AS charges,
  (SELECT COUNT(*) FROM ledger_entries) AS ledger, (SELECT COUNT(*) FROM wallet_movements) AS wallet`);
const gifts = (who) => who.get(`/api/gifts?from=${today}&to=${today}`);

test('offrir : stock baissé, nom et prix de revient copiés, aucune caisse ne bouge', async () => {
  member = ok(await ger.post('/api/members', { first_name: 'invite', last_name: 'cadeau', phone: '00 00 08 01' }));
  const caisses = ok(await admin.get('/api/caisses'));
  const before = money();
  const r = ok(await cig.post(`/api/products/${CIG}/offer`, { quantity: 2, member_id: member.id, reason: 'Anniversaire' }));
  assert.equal(r.product.stock_qty, 8);
  assert.equal(stockOf(CIG), 8);
  assert.equal(r.gift.given_by_name, 'Associé cigares');
  assert.equal(r.gift.unit_cost, 3000 * UM);
  assert.equal(r.gift.unit_price, 5000 * UM);
  assert.equal(r.gift.total_cost, 6000 * UM);
  assert.equal(r.gift.account, 'cigares');
  assert.equal(r.gift.member_id, member.id);
  assert.equal(r.gift.reason, 'Anniversaire');
  assert.equal(r.gift.biz_date, today);
  assert.deepEqual(money(), before);
  assert.deepEqual(ok(await admin.get('/api/caisses')), caisses);
  const [move] = ok(await admin.get(`/api/stock-movements?product_id=${CIG}`));
  assert.deepEqual([move.kind, move.quantity, move.kind_label, move.gift_id], ['offert', -2, 'Offert', r.gift.id]);
});

test('offrir : refus du gérant, de l’administrateur, de l’autre rayon, du stock, d’un produit désactivé, d’un mois clos', async () => {
  const count = () => server.club.get('SELECT COUNT(*) AS n FROM gifts').n;
  const n = count();
  const stock = stockOf(CIG);
  refused(await ger.post(`/api/products/${CIG}/offer`, { quantity: 1 }), 403);
  refused(await admin.post(`/api/products/${CIG}/offer`, { quantity: 1 }), 403);
  refused(await cha.post(`/api/products/${CIG}/offer`, { quantity: 1 }), 403);
  refused(await cig.post(`/api/products/${CIG}/offer`, { quantity: 99 }), 409, 'STOCK_INSUFFISANT');
  refused(await cig.post(`/api/products/${CIG}/offer`, { quantity: 0 }), 400);
  const off = ok(await admin.post('/api/products', { category: 'cigare', name: 'Cigare retiré', reference: 'CIG-R', price: 1000 * UM, initial_stock: 5, active: false })).id;
  refused(await cig.post(`/api/products/${off}/offer`, { quantity: 1 }), 409, 'PRODUIT_INACTIF');
  server.club.run("INSERT INTO closed_periods (month, closed_at, summary) VALUES (?, ?, '{}')", today.slice(0, 7), new Date().toISOString());
  try {
    refused(await cig.post(`/api/products/${CIG}/offer`, { quantity: 1 }), 409, 'PERIODE_CLOTUREE');
  } finally {
    server.club.run('DELETE FROM closed_periods WHERE month = ?', today.slice(0, 7));
  }
  assert.equal(count(), n);
  assert.equal(stockOf(CIG), stock);
});

test('prix de revient modifié ensuite : le cadeau garde sa valeur', async () => {
  ok(await cig.put(`/api/products/${CIG}`, { cost_price: 9000 * UM }));
  const list = ok(await gifts(admin));
  assert.equal(list.gifts.find((g) => g.product_id === CIG).unit_cost, 3000 * UM);
  assert.equal(list.by_associate.find((a) => a.account === 'cigares').total_cost, 6000 * UM);
});

test('annuler : stock rendu, plus compté ; refus des autres ; pas deux fois ; l’associé changé de rayon ne peut plus', async () => {
  const first = ok(await gifts(admin)).gifts.find((g) => g.product_id === CIG);
  const stock = stockOf(CIG);
  refused(await cha.post(`/api/gifts/${first.id}/cancel`, { reason: 'Erreur de saisie' }), 403);
  refused(await ger.post(`/api/gifts/${first.id}/cancel`, { reason: 'Erreur de saisie' }), 403);
  refused(await cig.post(`/api/gifts/${first.id}/cancel`, {}), 400);
  const r = ok(await cig.post(`/api/gifts/${first.id}/cancel`, { reason: 'Erreur de saisie' }));
  assert.ok(r.gift.cancelled_at);
  assert.equal(r.gift.can_cancel, false);
  assert.equal(stockOf(CIG), stock + 2);
  refused(await cig.post(`/api/gifts/${first.id}/cancel`, { reason: 'Encore' }), 409, 'DEJA_ANNULE');
  assert.equal(ok(await gifts(admin)).by_associate.find((a) => a.account === 'cigares')?.total_cost ?? 0, 0);
  const [move] = ok(await admin.get(`/api/stock-movements?product_id=${CIG}`));
  assert.deepEqual([move.kind, move.quantity], ['annulation_offert', 2]);
  // Moved to the other rayon, the giver no longer cancels his gifts: the administrator does.
  const second = ok(await cig.post(`/api/products/${CIG}/offer`, { quantity: 1 })).gift;
  assert.equal(second.can_cancel, true);
  const cigId = server.club.get("SELECT id FROM users WHERE login = 'cig'").id;
  ok(await admin.put(`/api/users/${cigId}`, { rayon: 'alcool' }));
  // A changed rayon closes the account's sessions: he signs in again, now as the associé of the other rayon.
  await cig.login('cig', 'gifts-cig-password');
  try {
    refused(await cig.post(`/api/gifts/${second.id}/cancel`, { reason: 'Erreur de saisie' }), 403);
    ok(await admin.post(`/api/gifts/${second.id}/cancel`, { reason: 'Erreur de saisie' }));
  } finally {
    ok(await admin.put(`/api/users/${cigId}`, { rayon: 'cigares' }));
    await cig.login('cig', 'gifts-cig-password');
  }
});

test('liste Offerts : chacun son rayon, l’administrateur tout, le gérant refusé', async () => {
  ok(await cha.post(`/api/products/${CHP}/offer`, { quantity: 1, reason: 'Fidélité' }));
  const mine = ok(await gifts(cha));
  assert.ok(mine.gifts.length > 0 && mine.gifts.every((g) => g.account === 'alcool'));
  const a = mine.by_associate.find((x) => x.account === 'alcool');
  assert.deepEqual([a.name, a.quantity, a.total_cost, a.missing_cost], ['Associé boissons', 1, 0, 1]);
  const all = ok(await gifts(admin));
  assert.deepEqual([...new Set(all.gifts.map((g) => g.account))].sort(), ['alcool', 'cigares']);
  refused(await gifts(ger), 403);
});
