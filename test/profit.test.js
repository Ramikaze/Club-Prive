// Real profit (spec docs/superpowers/specs/2026-11-18-benefice-reel-design.md): each sale keeps the cost price of its
// day (charges.unit_cost, V30), a cost entered later fills the sales and gifts that had none, and the report counts
// sales − purchase cost − gifts per caisse and per product, every undo on the day it happens.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { Server, Client, ok, UM, fundCaisse } from './harness.js';
import { MIGRATIONS } from '../worker/schema.js';

const server = new Server({});
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
  await admin.login('admin', 'profit-admin-password');
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

const sell = async (account, product_id, quantity) => ok(await ger.post('/api/shop/sales', {
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
