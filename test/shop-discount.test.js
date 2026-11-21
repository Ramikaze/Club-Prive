// A Boutique sale with the lot price and a discount (spec docs/superpowers/specs/2026-11-21-remise-prix-par-lot-design.md):
// net lines with the catalogue price kept, the card and the credit on the net total, cancellation and profit at the
// net amount, the manager's cap, refusals that leave nothing behind, and the total the screen shows checked.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { Server, Client, ok, UM, postSale } from './harness.js';

const server = new Server({});
let admin;
let ger;
let cig;
let today;
let COUPE;
let BARREDA;
let firstSale;

const LOT = { lot_qty: 3, lot_price: 10000 * UM, extra_price: 3000 * UM };
const count = (table) => server.club.get(`SELECT COUNT(*) AS n FROM ${table}`).n;
const counts = () => [count('shop_sales'), count('charges'), count('payments')];
const stockOf = (id) => server.club.get('SELECT stock_qty FROM products WHERE id = ?', id).stock_qty;
const refused = (r, status, code) => {
  assert.equal(r.status, status, JSON.stringify(r.data));
  if (code) assert.equal(r.data.error.code, code);
};
const walkIn = { account: 'cigares', buyer: { kind: 'journalier' }, method: 'Espèces' };

before(async () => {
  await server.start();
  await server.addUser('admin', 'Propriétaire', 'admin', 'disc-admin-password');
  await server.addUser('ger', 'Gérant', 'gerant', 'disc-ger-password');
  await server.addUser('cig', 'Associé cigares', 'associe', 'disc-cig-password', 'cigares');
  admin = new Client(server);
  ger = new Client(server);
  cig = new Client(server);
  await admin.login('admin', 'disc-admin-password');
  today = (await ger.login('ger', 'disc-ger-password')).biz_today;
  await cig.login('cig', 'disc-cig-password');
  COUPE = ok(await admin.post('/api/products', { category: 'cigare', name: 'Coupe-cigare', reference: 'COUPE', price: 5000 * UM, initial_stock: 100, ...LOT })).id;
  BARREDA = ok(await admin.post('/api/products', { category: 'cigare', name: 'Barreda O21', reference: 'BAR', price: 12500 * UM, initial_stock: 50 })).id;
});
after(() => server.destroy());

test('lot et remise : lignes nettes, prix catalogue gardé', async () => {
  const stock = stockOf(COUPE);
  const r = ok(await postSale(ger, {
    ...walkIn, lines: [{ product_id: COUPE, quantity: 4 }, { product_id: BARREDA, quantity: 1 }], discount: { kind: 'pourcentage', value: 10 },
  }));
  assert.equal(r.sale.amount, 22950 * UM);
  assert.equal(r.payment.amount, 22950 * UM);
  assert.equal(r.sale.subtotal, 25500 * UM);
  assert.equal(r.sale.discount, 2550 * UM);
  assert.equal(r.sale.discount_kind, 'pourcentage');
  assert.equal(r.sale.discount_value, 10);
  const line = r.sale.lines.find((l) => l.product_id === COUPE);
  assert.equal(line.price, 13000 * UM);
  assert.equal(line.lot, true);
  assert.equal(r.sale.lines.find((l) => l.product_id === BARREDA).lot, false);
  const coupe = server.club.get('SELECT unit_price, quantity, amount, discount FROM charges WHERE shop_sale_id = ? AND product_id = ?', r.sale.id, COUPE);
  assert.equal(coupe.unit_price, 5000 * UM);
  assert.equal(coupe.quantity, 4);
  assert.equal(coupe.amount + coupe.discount, 13000 * UM);
  assert.deepEqual({ ...server.club.get('SELECT discount_kind, discount_value FROM shop_sales WHERE id = ?', r.sale.id) },
    { discount_kind: 'pourcentage', discount_value: 10 });
  assert.equal(stockOf(COUPE), stock - 4);
  const audit = JSON.parse(server.club.get("SELECT details FROM audit_log WHERE action = 'boutique.vente' AND entity_id = ?", r.sale.id).details);
  assert.equal(audit.montant, 22950 * UM);
  assert.equal(audit.sous_total, 25500 * UM);
  assert.deepEqual(audit.remise, { type: 'pourcentage', valeur: 10, montant: 2550 * UM });
  assert.deepEqual(audit.prix_par_lot, ['Coupe-cigare']);
  firstSale = r.sale;
});

test('même produit deux fois : une ligne de 4, prix par lot', async () => {
  const r = ok(await postSale(ger, { ...walkIn, lines: [{ product_id: COUPE, quantity: 2 }, { product_id: COUPE, quantity: 2 }] }));
  assert.equal(r.sale.lines.length, 1);
  assert.equal(r.sale.lines[0].quantity, 4);
  assert.equal(r.sale.amount, 13000 * UM);
  assert.equal(r.sale.discount, 0);
  assert.equal(r.sale.discount_kind, null);
});

test('carte du membre : paie le total net', async () => {
  const m = ok(await admin.post('/api/members', { first_name: 'jean', last_name: 'remise', phone: '00 00 04 01' }));
  ok(await admin.post(`/api/members/${m.id}/wallet/recharge`, { amount: 30000 * UM, method: 'Espèces' }));
  const r = ok(await postSale(ger, { account: 'cigares', buyer: { kind: 'membre', member_id: m.id }, lines: [{ product_id: COUPE, quantity: 4 }], card: true }));
  assert.equal(r.payment.card_amount, 13000 * UM);
  assert.equal(ok(await admin.get(`/api/members/${m.id}`)).wallet.balance, 17000 * UM);
});

test('crédit : plafond comparé au total net, annulation au net', async () => {
  const c = ok(await admin.post('/api/clients', { first_name: 'awa', last_name: 'remise', phone: '00 00 04 02' }));
  ok(await admin.put(`/api/clients/${c.id}/credit-limit`, { credit_limit: 15000 * UM }));
  // 20 000 at the unit price, 13 000 with the lot, 12 000 after 1 000 off: under the 15 000 limit.
  const r = ok(await postSale(ger, {
    account: 'cigares', buyer: { kind: 'client', member_id: c.id }, lines: [{ product_id: COUPE, quantity: 4 }], credit: true,
    discount: { kind: 'montant', value: 1000 * UM },
  }));
  assert.equal(r.sale.amount, 12000 * UM);
  assert.equal(ok(await admin.get(`/api/clients/${c.id}/account`)).owed, 12000 * UM);
  ok(await admin.post(`/api/shop/sales/${r.sale.id}/cancel`, { reason: 'Test de remise' }));
  assert.equal(ok(await admin.get(`/api/clients/${c.id}/account`)).owed, 0);
});

test('annulation : rembourse le payé, remet toutes les pièces', async () => {
  const stock = stockOf(COUPE);
  ok(await cig.post(`/api/shop/sales/${firstSale.id}/cancel`, { reason: 'Test de remise' }));
  const refunded = server.club.get(
    'SELECT SUM(rf.amount) AS n FROM refunds rf JOIN charges c ON c.id = rf.charge_id WHERE c.shop_sale_id = ?', firstSale.id,
  ).n;
  assert.equal(refunded, 22950 * UM);
  assert.equal(stockOf(COUPE), stock + 4);
});

test('bénéfice réel : ventes nettes, coût de toutes les pièces', async () => {
  const p = ok(await admin.post('/api/products', {
    category: 'cigare', name: 'Coupe bénéfice', reference: 'COUPEB', price: 5000 * UM, cost_price: 1000 * UM, initial_stock: 10, ...LOT,
  }));
  ok(await postSale(ger, { ...walkIn, lines: [{ product_id: p.id, quantity: 4 }] }));
  const row = ok(await admin.get(`/api/finance/profit?from=${today}`)).products.find((x) => x.product_id === p.id);
  assert.equal(row.quantity, 4);
  assert.equal(row.sales, 13000 * UM);
  assert.equal(row.cost, 4000 * UM);
});

test('plafond du gérant', async () => {
  const body = (discount) => ({ ...walkIn, lines: [{ product_id: BARREDA, quantity: 1 }], discount });
  refused(await postSale(ger, body({ kind: 'pourcentage', value: 11 })), 409, 'PLAFOND_REMISE');
  ok(await postSale(ger, body({ kind: 'pourcentage', value: 10 })));
  // 10 % of 12 500 is 1 250.
  refused(await postSale(ger, body({ kind: 'montant', value: 1300 * UM })), 409, 'PLAFOND_REMISE');
  ok(await postSale(ger, body({ kind: 'montant', value: 1250 * UM })));
  ok(await postSale(cig, body({ kind: 'pourcentage', value: 50 })));
  ok(await postSale(admin, body({ kind: 'pourcentage', value: 50 })));
  ok(await admin.put('/api/settings', { gerant_discount_cap_pct: 0 }));
  refused(await postSale(ger, body({ kind: 'pourcentage', value: 1 })), 409, 'PLAFOND_REMISE');
  ok(await admin.put('/api/settings', { gerant_discount_cap_pct: 10 }));
  refused(await cig.put('/api/settings', { gerant_discount_cap_pct: 50 }), 403);
  refused(await admin.put('/api/settings', { gerant_discount_cap_pct: 100 }), 400);
});

test('remise refusée : rien n’est écrit', async () => {
  const before = counts();
  refused(await postSale(ger, { ...walkIn, lines: [{ product_id: BARREDA, quantity: 1 }], discount: { kind: 'pourcentage', value: 0 } }), 400, 'REMISE_INVALIDE');
  refused(await postSale(ger, { ...walkIn, lines: [{ product_id: BARREDA, quantity: 1 }], discount: 'dix' }), 400);
  refused(await postSale(admin, { ...walkIn, lines: [{ product_id: BARREDA, quantity: 1 }], discount: { kind: 'montant', value: 12500 * UM } }), 409, 'REMISE_TROP_FORTE');
  assert.deepEqual(counts(), before);
});

test('total contrôlé : manquant ou différent', async () => {
  const before = counts();
  const body = { ...walkIn, lines: [{ product_id: COUPE, quantity: 4 }] };
  refused(await ger.post('/api/shop/sales', body), 409, 'PAGE_A_RECHARGER');
  refused(await ger.post('/api/shop/sales', { ...body, expected_total: 20000 * UM }), 409, 'TOTAL_CHANGE');
  assert.deepEqual(counts(), before);
  ok(await ger.post('/api/shop/sales', { ...body, expected_total: 13000 * UM }));
});
