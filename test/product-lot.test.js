// The lot price of a product (spec docs/superpowers/specs/2026-11-21-remise-prix-par-lot-design.md, § 7): set on its
// sheet as « lot de 3 pour 10 000, puis 3 000 par unité en plus », read by every seller, cleared by emptying it.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { Server, Client, ok, UM } from './harness.js';

const server = new Server({});
let admin;
let ger;
let n = 0;
const LOT = { lot_qty: 3, lot_price: 10000 * UM, extra_price: 3000 * UM };
const newCutter = (extra = {}) => admin.post('/api/products', {
  category: 'cigare', name: `Coupe-cigare ${++n}`, reference: `COUPE${n}`, price: 5000 * UM, initial_stock: 10, ...extra,
});
const lotOf = (p) => ({ lot_qty: p.lot_qty, lot_price: p.lot_price, extra_price: p.extra_price });

before(async () => {
  await server.start();
  await server.addUser('admin', 'Propriétaire', 'admin', 'lot-admin-password');
  await server.addUser('ger', 'Gérant', 'gerant', 'lot-ger-password');
  admin = new Client(server);
  ger = new Client(server);
  await admin.login('admin', 'lot-admin-password');
  await ger.login('ger', 'lot-ger-password');
});
after(() => server.destroy());

test('prix par lot : enregistré, lu par le gérant, effacé', async () => {
  const p = ok(await newCutter(LOT));
  assert.deepEqual(lotOf(p), LOT);
  const seen = ok(await ger.get('/api/products')).find((x) => x.id === p.id);
  assert.deepEqual(lotOf(seen), LOT);
  // Left out of a change, the lot stays.
  assert.deepEqual(lotOf(ok(await admin.put(`/api/products/${p.id}`, { name: 'Coupe-cigare double lame' }))), LOT);
  // Emptied, it goes.
  const cleared = ok(await admin.put(`/api/products/${p.id}`, { lot_qty: null, lot_price: null, extra_price: null }));
  assert.deepEqual(lotOf(cleared), { lot_qty: null, lot_price: null, extra_price: null });
  const blank = ok(await newCutter({ lot_qty: '', lot_price: '', extra_price: '' }));
  assert.deepEqual(lotOf(blank), { lot_qty: null, lot_price: null, extra_price: null });
});

test('prix par lot : refus', async () => {
  for (const lot of [
    { lot_qty: 3 },
    { ...LOT, lot_qty: 1 },
    { ...LOT, lot_price: 15000 * UM },
    { ...LOT, extra_price: 6000 * UM },
    { ...LOT, lot_price: 50 },
  ]) {
    const r = await newCutter(lot);
    assert.equal(r.status, 400, JSON.stringify(lot));
  }
});

test('prix par lot : noté au journal', async () => {
  const p = ok(await newCutter());
  ok(await admin.put(`/api/products/${p.id}`, LOT));
  const row = server.club.get("SELECT details FROM audit_log WHERE action = 'produit.modifier' AND entity_id = ? ORDER BY id DESC LIMIT 1", p.id);
  const { avant, apres } = JSON.parse(row.details);
  assert.deepEqual(lotOf(avant), { lot_qty: null, lot_price: null, extra_price: null });
  assert.deepEqual(lotOf(apres), LOT);
});
