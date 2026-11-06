// A product's category is locked once it has a charge (session or Boutique, any status); the Boutique never sells
// an « Autre boisson ».
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { Server, Client, ok, UM } from './harness.js';

const server = new Server({}, { lenientTariffs: true });
let admin;
let ger;
let cig;
let cha;
let bundle;
let n = 0;
let CHP;
let DRK;
let CIG;

const LOCKED = 'Ce produit a déjà été vendu : sa catégorie ne change plus. Créez un nouveau produit et désactivez celui-ci.';
const categoryOf = (id) => server.club.get('SELECT category FROM products WHERE id = ?', id).category;
const soldOf = async (id) => ok(await admin.get('/api/products')).find((x) => x.id === id).sold;

before(async () => {
  await server.start();
  await server.addUser('admin', 'Propriétaire', 'admin', 'lock-admin-password');
  await server.addUser('ger', 'Gérant', 'gerant', 'lock-ger-password');
  await server.addUser('cig', 'Associé cigares', 'associe', 'lock-cig-password', 'cigares');
  await server.addUser('cha', 'Associé champagne', 'associe', 'lock-cha-password', 'alcool');
  admin = new Client(server);
  ger = new Client(server);
  cig = new Client(server);
  cha = new Client(server);
  await admin.login('admin', 'lock-admin-password');
  bundle = await ger.login('ger', 'lock-ger-password');
  await cig.login('cig', 'lock-cig-password');
  await cha.login('cha', 'lock-cha-password');
  CHP = ok(await admin.post('/api/products', { category: 'bouteille', name: 'Champagne test', reference: 'CHP', price: 50000 * UM, initial_stock: 5 })).id;
  DRK = ok(await admin.post('/api/products', { category: 'boisson', name: 'Whisky test', reference: 'DRK', price: 30000 * UM, initial_stock: 5 })).id;
  CIG = ok(await admin.post('/api/products', { category: 'cigare', name: 'Cigare test', reference: 'CIG', price: 5000 * UM, initial_stock: 5 })).id;
});
after(() => server.destroy());

// Books a session for a new member (who needs a plan) and returns its id.
async function bookSession() {
  n += 1;
  const member = ok(await ger.post('/api/members', { first_name: 'awa', last_name: `verrou${n}`, phone: `00 00 09 ${String(n).padStart(2, '0')}` }));
  ok(await ger.post(`/api/members/${member.id}/subscriptions`, { plan_id: bundle.plans.find((p) => p.code === 'MENSUELLE').id, start_date: bundle.biz_today }));
  return ok(await ger.post('/api/reservations', {
    member_id: member.id, room_id: bundle.rooms[0].id, date: bundle.biz_today, start_time: `${String(6 + 2 * n).padStart(2, '0')}:00`, duration_min: 60,
  })).reservation.id;
}

test('jamais vendu : la catégorie change librement', async () => {
  const id = ok(await admin.post('/api/products', { category: 'bouteille', name: 'Libre', reference: 'FREE', price: 1000 * UM })).id;
  assert.equal(await soldOf(id), false);
  assert.equal(ok(await admin.put(`/api/products/${id}`, { category: 'boisson' })).category, 'boisson');
  assert.equal(ok(await admin.put(`/api/products/${id}`, { category: 'bouteille' })).category, 'bouteille');
});

test('vendu en séance : la catégorie ne change plus', async () => {
  const resId = await bookSession();
  ok(await ger.post(`/api/reservations/${resId}/items`, { product_id: DRK, quantity: 1 }));
  assert.equal(await soldOf(DRK), true);
  const r = await admin.put(`/api/products/${DRK}`, { category: 'bouteille' });
  assert.equal(r.status, 409, JSON.stringify(r.data));
  assert.equal(r.data.error.code, 'CATEGORIE_VENDUE');
  assert.equal(r.data.error.message, LOCKED);
  assert.equal(categoryOf(DRK), 'boisson');
});

test('vendu en Boutique : la catégorie ne change plus', async () => {
  ok(await admin.post('/api/shop/sales', { account: 'alcool', buyer: { kind: 'journalier' }, lines: [{ product_id: CHP, quantity: 1 }], method: 'Espèces' }));
  assert.equal(await soldOf(CHP), true);
  const r = await admin.put(`/api/products/${CHP}`, { category: 'boisson' });
  assert.equal(r.status, 409, JSON.stringify(r.data));
  assert.equal(r.data.error.code, 'CATEGORIE_VENDUE');
  assert.equal(categoryOf(CHP), 'bouteille');
});

test('une ligne annulée suffit à figer la catégorie', async () => {
  const id = ok(await admin.post('/api/products', { category: 'boisson', name: 'Annulée', reference: 'DRK-C', price: 20000 * UM, initial_stock: 3 })).id;
  const resId = await bookSession();
  const detail = ok(await ger.post(`/api/reservations/${resId}/items`, { product_id: id, quantity: 1 }));
  const line = detail.charges.find((c) => c.kind === 'produit' && c.status === 'due');
  ok(await admin.post(`/api/charges/${line.id}/cancel`, { reason: 'Erreur de saisie' }));
  assert.equal(await soldOf(id), true);
  const r = await admin.put(`/api/products/${id}`, { category: 'bouteille' });
  assert.equal(r.status, 409, JSON.stringify(r.data));
  assert.equal(r.data.error.code, 'CATEGORIE_VENDUE');
});

test('modifier un produit vendu reste possible sans changer sa catégorie', async () => {
  const r = ok(await admin.put(`/api/products/${DRK}`, { category: 'boisson', name: 'Whisky test 2', price: 31000 * UM, active: false }));
  assert.equal(r.name, 'Whisky test 2'); assert.equal(r.price, 31000 * UM); assert.equal(r.active, false); assert.equal(r.category, 'boisson');
  const audit = server.club.get("SELECT details FROM audit_log WHERE action = 'produit.modifier' ORDER BY id DESC LIMIT 1");
  assert.match(audit.details, /"category":"boisson"/);
});

test('la Boutique ne vend jamais une autre boisson', async () => {
  const id = ok(await admin.post('/api/products', { category: 'boisson', name: 'Rayon', reference: 'DRK-R', price: 10000 * UM, initial_stock: 4 })).id;
  const count = () => server.club.get('SELECT COUNT(*) AS n FROM shop_sales').n;
  const stock = () => server.club.get('SELECT stock_qty FROM products WHERE id = ?', id).stock_qty;
  const before = [count(), stock()];
  // Each seller tries the rayons they may sell in (another rayon is refused earlier, on rights).
  const tries = [[cha, 'alcool'], [cig, 'cigares'], [ger, 'alcool'], [ger, 'cigares'], [admin, 'alcool'], [admin, 'cigares']];
  for (const [who, account] of tries) {
    const r = await who.post('/api/shop/sales', { account, buyer: { kind: 'journalier' }, lines: [{ product_id: id, quantity: 1 }], method: 'Espèces' });
    assert.equal(r.status, 400, JSON.stringify(r.data));
    assert.equal(r.data.error.code, 'RAYON');
  }
  assert.deepEqual([count(), stock()], before);
});
