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
  await admin.login('admin', 'gifts-admin-password');
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
