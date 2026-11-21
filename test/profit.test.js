// Real profit (spec docs/superpowers/specs/2026-11-18-benefice-reel-design.md): each sale keeps the cost price of its
// day (charges.unit_cost, V30), a cost entered later fills the sales and gifts that had none, and the report counts
// sales − purchase cost − gifts per caisse and per product, every undo on the day it happens.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { Server, Client, ok, UM, fundCaisse, postSale } from './harness.js';
import { MIGRATIONS } from '../worker/schema.js';

const server = new Server({}, { lenientTariffs: true });
let bundle;
let admin;
let ger;
let cig;
let cha;
let CHP;
let DRK;
let CIG;

before(async () => {
  await server.start();
  await server.addUser('admin', 'Propriétaire', 'admin', 'profit-admin-password');
  await server.addUser('ger', 'Gérant', 'gerant', 'profit-ger-password');
  await server.addUser('cig', 'Associé cigares', 'associe', 'profit-cig-password', 'cigares');
  await server.addUser('cha', 'Associé boissons', 'associe', 'profit-cha-password', 'alcool');
  admin = new Client(server);
  ger = new Client(server);
  cig = new Client(server);
  cha = new Client(server);
  bundle = await admin.login('admin', 'profit-admin-password');
  await ger.login('ger', 'profit-ger-password');
  await cig.login('cig', 'profit-cig-password');
  await cha.login('cha', 'profit-cha-password');
  const product = async (category, reference, price, cost) => ok(await admin.post('/api/products', {
    category, name: `${reference} test`, reference, price: price * UM, cost_price: cost === null ? '' : cost * UM, initial_stock: 50,
  })).id;
  CHP = await product('bouteille', 'CHP-P', 50000, 30000);
  DRK = await product('bouteille', 'CHX-P', 20000, null); // no cost yet (autres boissons are not sold at the Boutique)
  CIG = await product('cigare', 'CIG-P', 10000, 4000);
  await fundCaisse(admin, 'alcool', 1000000 * UM);
  await fundCaisse(admin, 'cigares', 1000000 * UM);
});
after(() => server.destroy());

const sell = async (account, product_id, quantity) => ok(await postSale(ger, {
  account, buyer: { kind: 'journalier' }, lines: [{ product_id, quantity }], method: 'Espèces',
}));
const chargeOf = (sale) => server.club.get('SELECT * FROM charges WHERE shop_sale_id = ?', sale.sale.id);
const unitCost = (table, id) => server.club.get(`SELECT unit_cost FROM ${table} WHERE id = ?`, id).unit_cost;

test('V30 : les ventes passées prennent le prix de revient actuel', async () => {
  const line = chargeOf(await sell('alcool', CHP, 1));
  // A line from before V30: no cost yet. The migration's second statement fills it from the product.
  server.club.run('UPDATE charges SET unit_cost = NULL WHERE id = ?', line.id);
  server.club.run(MIGRATIONS[29][1]);
  assert.equal(unitCost('charges', line.id), 30000 * UM);
  // Lines that are not products keep none.
  assert.equal(server.club.get("SELECT COUNT(*) AS n FROM charges WHERE kind <> 'produit' AND unit_cost IS NOT NULL").n, 0);
});

test('le prix de revient est copié sur la vente', async () => {
  assert.equal(chargeOf(await sell('alcool', CHP, 2)).unit_cost, 30000 * UM);
});

test('prix saisi plus tard : les ventes et offerts sans prix le prennent, les autres non', async () => {
  const line = chargeOf(await sell('alcool', DRK, 1));
  assert.equal(line.unit_cost, null);
  ok(await cha.post(`/api/products/${DRK}/offer`, { quantity: 1, reason: 'Dégustation' }));
  const giftId = server.club.get('SELECT MAX(id) AS id FROM gifts WHERE product_id = ?', DRK).id;
  assert.equal(unitCost('gifts', giftId), null);
  ok(await admin.put(`/api/products/${DRK}`, { cost_price: 12000 * UM }));
  assert.equal(unitCost('charges', line.id), 12000 * UM);
  assert.equal(unitCost('gifts', giftId), 12000 * UM);
  // Changed again: what already had a cost keeps it; a new sale copies the new one.
  ok(await admin.put(`/api/products/${DRK}`, { cost_price: 15000 * UM }));
  assert.equal(unitCost('charges', line.id), 12000 * UM);
  assert.equal(unitCost('gifts', giftId), 12000 * UM);
  assert.equal(chargeOf(await sell('alcool', DRK, 1)).unit_cost, 15000 * UM);
  ok(await admin.put(`/api/products/${DRK}`, { cost_price: '' }));
});

test('le gérant ne reçoit jamais le prix de revient', async () => {
  const list = ok(await ger.get('/api/products'));
  assert.ok(list.every((p) => !('cost_price' in p) && !('unit_cost' in p)));
  const sale = await sell('cigares', CIG, 1);
  assert.ok(!JSON.stringify(sale).includes('unit_cost'));
});

// ---------------------------------------------------------------- the report (GET /api/finance/profit)

// The club's clock at noon of a business day; every scenario below has days of its own.
const at = (day) => { server.club.at = Date.parse(server.club.dayStartIso(day)) + 12 * 3600 * 1000; };
const release = () => { server.club.at = null; };
const report = async (from, to = from) => ok(await admin.get(`/api/finance/profit?from=${from}&to=${to}`));
const acc = (r, key) => r.accounts.find((a) => a.account === key);
const figures = (f) => ({ sales: f.sales, cost: f.cost, gifts_cost: f.gifts_cost, profit: f.profit });

test('bénéfice du jour : ventes − prix d’achat − offerts, par caisse', async () => {
  at('2027-01-08');
  try {
    await sell('alcool', CHP, 2);
    await sell('cigares', CIG, 3);
    ok(await cig.post(`/api/products/${CIG}/offer`, { quantity: 1, reason: 'Anniversaire' }));
    const r = await report('2027-01-08');
    assert.deepEqual(figures(acc(r, 'alcool')), { sales: 100000 * UM, cost: 60000 * UM, gifts_cost: 0, profit: 40000 * UM });
    assert.deepEqual(figures(acc(r, 'cigares')), { sales: 30000 * UM, cost: 12000 * UM, gifts_cost: 4000 * UM, profit: 14000 * UM });
    assert.equal(r.total.profit, 54000 * UM);
    assert.equal(r.complete, true);
    const cigar = r.products.find((p) => p.product_id === CIG);
    assert.equal(cigar.quantity, 3);
    assert.equal(cigar.gifts_quantity, 1);
    assert.equal(cigar.margin, 14000 / 30000);
  } finally { release(); }
});

test('vente sans prix de revient : hors bénéfice, signalée, puis comptée quand le prix est saisi', async () => {
  at('2027-01-09');
  try {
    await sell('alcool', DRK, 1);
    let r = await report('2027-01-09');
    assert.equal(acc(r, 'alcool').sales, 0);
    assert.deepEqual(r.total.missing, { sales_count: 1, sales_amount: 20000 * UM, gifts_count: 0 });
    assert.equal(r.complete, false);
    ok(await admin.put(`/api/products/${DRK}`, { cost_price: 12000 * UM }));
    r = await report('2027-01-09');
    assert.deepEqual(figures(acc(r, 'alcool')), { sales: 20000 * UM, cost: 12000 * UM, gifts_cost: 0, profit: 8000 * UM });
    assert.equal(r.complete, true);
  } finally { release(); }
});

test('remboursement un autre jour : compté ce jour-là, le jour de la vente ne bouge pas', async () => {
  at('2027-01-11');
  try {
    // Two bottles served during a session (a Boutique sale is cancelled whole, never refunded line by line), paid.
    const m = ok(await ger.post('/api/members', { first_name: 'bob', last_name: 'benefice', phone: '00 00 09 02' }));
    ok(await ger.post(`/api/members/${m.id}/subscriptions`, { plan_id: bundle.plans.find((x) => x.code === 'MENSUELLE').id, start_date: '2027-01-11' }));
    const r = ok(await ger.post('/api/reservations', { member_id: m.id, room_id: bundle.rooms[0].id, date: '2027-01-11', start_time: '18:00', duration_min: 60 }));
    const serve = async () => ok(await ger.post(`/api/reservations/${r.reservation.id}/items`, { product_id: CHP, quantity: 1 }))
      .charges.filter((c) => c.status === 'due' && c.kind === 'produit').at(-1).id;
    const a = await serve();
    const b = await serve();
    ok(await ger.post('/api/payments', { charge_ids: [a, b], method: 'Espèces' }));
    assert.equal(acc(await report('2027-01-11'), 'alcool').profit, 40000 * UM);
    at('2027-01-12');
    ok(await admin.post(`/api/charges/${a}/refund`, { reason: 'Bouteille cassée', method: 'Espèces', restock: false }));
    ok(await admin.post(`/api/charges/${b}/refund`, { reason: 'Bouteille bouchonnée', method: 'Espèces', restock: true }));
    assert.equal(acc(await report('2027-01-11'), 'alcool').profit, 40000 * UM);
    // The broken bottle is lost (its cost stays); the other one is back in stock (its cost comes back).
    assert.deepEqual(figures(acc(await report('2027-01-12'), 'alcool')),
      { sales: -100000 * UM, cost: -30000 * UM, gifts_cost: 0, profit: -70000 * UM });
  } finally { release(); }
});

test('vente Boutique annulée le lendemain : ventes et prix d’achat reviennent ce jour-là', async () => {
  at('2027-01-13');
  try {
    const sale = await sell('cigares', CIG, 2);
    at('2027-01-14');
    ok(await admin.post(`/api/shop/sales/${sale.sale.id}/cancel`, { reason: 'Erreur de produit' }));
    // A sale cancelled the same day nets to nothing on that day.
    const same = await sell('cigares', CIG, 1);
    ok(await admin.post(`/api/shop/sales/${same.sale.id}/cancel`, { reason: 'Erreur de quantité' }));
    const r = acc(await report('2027-01-14'), 'cigares');
    assert.deepEqual([r.sales, r.cost], [-20000 * UM, -8000 * UM]);
    assert.equal(acc(await report('2027-01-13'), 'cigares').sales, 20000 * UM);
  } finally { release(); }
});

test('annuler un règlement à crédit ne défait pas la vente', async () => {
  at('2027-01-15');
  try {
    const client = ok(await ger.post('/api/clients', { first_name: 'awa', last_name: 'benefice', phone: '00 00 09 01' }));
    ok(await cha.put(`/api/clients/${client.id}/credit-limit`, { credit_limit: 100000 * UM }));
    ok(await postSale(ger, {
      account: 'alcool', buyer: { kind: 'client', member_id: client.id }, lines: [{ product_id: CHP, quantity: 1 }], credit: true,
    }));
    const paid = ok(await ger.post(`/api/clients/${client.id}/settlements`, { amount: 20000 * UM, method: 'Espèces' }));
    at('2027-01-16');
    ok(await cha.post(`/api/payments/${paid.payment.id}/cancel-settlement`, { reason: 'Erreur de montant' }));
    assert.deepEqual(figures(acc(await report('2027-01-16'), 'alcool')), { sales: 0, cost: 0, gifts_cost: 0, profit: 0 });
    assert.deepEqual(figures(acc(await report('2027-01-15'), 'alcool')),
      { sales: 50000 * UM, cost: 30000 * UM, gifts_cost: 0, profit: 20000 * UM });
  } finally { release(); }
});

test('prix de revient changé après la vente : la vente garde le sien', async () => {
  at('2027-01-17');
  try {
    await sell('cigares', CIG, 1);
    ok(await admin.put(`/api/products/${CIG}`, { cost_price: 6000 * UM }));
    assert.equal(acc(await report('2027-01-17'), 'cigares').cost, 4000 * UM);
  } finally {
    ok(await admin.put(`/api/products/${CIG}`, { cost_price: 4000 * UM }));
    release();
  }
});

test('période sans vente de produit : zéros, complète', async () => {
  const r = await report('2027-02-01');
  assert.deepEqual(figures(r.total), { sales: 0, cost: 0, gifts_cost: 0, profit: 0 });
  assert.deepEqual(r.products, []);
  assert.equal(r.complete, true);
});

test('droits : le gérant est refusé, un associé voit les deux caisses', async () => {
  assert.equal((await ger.get('/api/finance/profit?from=2027-01-08')).status, 403);
  const r = ok(await cig.get('/api/finance/profit?from=2027-01-08'));
  assert.deepEqual(r.accounts.map((a) => a.account), ['alcool', 'cigares']);
});

// Final review: a product without a cost price still shows how many were sold and for how much; its profit is unknown.
test('produit sans prix de revient : quantité et ventes visibles, bénéfice inconnu', async () => {
  const id = ok(await admin.post('/api/products', { category: 'bouteille', name: 'Sans prix test', reference: 'CHZ-P', price: 30000 * UM, initial_stock: 10 })).id;
  at('2027-01-20');
  try {
    await sell('alcool', id, 2);
    const r = await report('2027-01-20');
    const row = r.products.find((p) => p.product_id === id);
    assert.deepEqual({ quantity: row.quantity, sales: row.sales, profit: row.profit, margin: row.margin, cost_missing: row.cost_missing },
      { quantity: 2, sales: 60000 * UM, profit: null, margin: null, cost_missing: true });
    // The caisse's profit still leaves it out.
    assert.equal(acc(r, 'alcool').sales, 0);
    assert.equal(r.products.at(-1).product_id, id); // unknown profits come last
  } finally { release(); }
});
