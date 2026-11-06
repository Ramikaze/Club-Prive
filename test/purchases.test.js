// Purchase history of a file: Boutique and session product lines mixed, newest first.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { Server, Client, ok, UM } from './harness.js';

const server = new Server({}, { lenientTariffs: true });
let admin;
let ger;
let cha;
let CIG;
let BTL;
let bundle;
let n = 0;

before(async () => {
  await server.start();
  await server.addUser('admin', 'Propriétaire', 'admin', 'purch-admin-password');
  await server.addUser('ger', 'Gérant', 'gerant', 'purch-ger-password');
  await server.addUser('cha', 'Associé champagne', 'associe', 'purch-cha-password', 'alcool');
  admin = new Client(server);
  ger = new Client(server);
  cha = new Client(server);
  await admin.login('admin', 'purch-admin-password');
  bundle = await ger.login('ger', 'purch-ger-password');
  await cha.login('cha', 'purch-cha-password');
  CIG = ok(await admin.post('/api/products', { category: 'cigare', name: 'Cigare test', reference: 'CIG', price: 5000 * UM, initial_stock: 10 })).id;
  BTL = ok(await admin.post('/api/products', { category: 'bouteille', name: 'Bouteille test', reference: 'BTL', price: 50000 * UM, initial_stock: 10 })).id;
});
after(() => server.destroy());

const newClient = async () => ok(await ger.post('/api/clients', { first_name: 'awa', last_name: `achat${++n}`, phone: `00 00 06 ${String(n).padStart(2, '0')}` }));
const sell = async (client, product, method = 'Espèces') => ok(await ger.post('/api/shop/sales', {
  account: product === CIG ? 'cigares' : 'alcool', buyer: { kind: 'client', member_id: client.id },
  lines: [{ product_id: product, quantity: 1 }], method,
}));
const history = async (id) => ok(await ger.get(`/api/members/${id}/purchases`));
// Books a session for the member (who needs a plan) and returns its id.
async function bookSession(member) {
  ok(await ger.post(`/api/members/${member.id}/subscriptions`, { plan_id: bundle.plans.find((p) => p.code === 'MENSUELLE').id, start_date: bundle.biz_today }));
  return ok(await ger.post('/api/reservations', {
    member_id: member.id, room_id: bundle.rooms[0].id, date: bundle.biz_today, start_time: `${String(6 + 2 * n).padStart(2, '0')}:00`, duration_min: 60,
  })).reservation.id;
}

test('l’historique mêle Boutique et séance et survit au passage en membre', async () => {
  const c = await newClient();
  const s = await sell(c, CIG);
  ok(await ger.post(`/api/clients/${c.id}/convert`));
  const resId = await bookSession(c);
  const detail = ok(await ger.post(`/api/reservations/${resId}/items`, { product_id: BTL, quantity: 1 }));
  const line = detail.charges.find((x) => x.status === 'due' && x.kind === 'produit');
  const pay = ok(await ger.post('/api/payments', { charge_ids: [line.id], method: 'Espèces' })).payment;

  const h = await history(c.id);
  assert.equal(h.member_id, c.id);
  assert.equal(h.lines.length, 2);
  assert.equal(h.lines[0].origin, 'seance');
  assert.equal(h.lines[0].reservation_id, resId);
  assert.equal(h.lines[0].as_client, false);
  assert.equal(h.lines[0].payment_id, pay.id);
  assert.equal(h.lines[0].method, 'Espèces');
  assert.equal(h.lines[0].account, 'alcool');
  assert.equal(h.lines[1].origin, 'boutique');
  assert.equal(h.lines[1].as_client, true);
  assert.equal(h.lines[1].reservation_id, null);
  assert.equal(h.lines[1].payment_id, s.payment.id);
  assert.match(h.lines[1].ticket_number, /\S/);
  assert.equal(h.lines[1].status, 'payee');
  assert.equal(h.total, 55000 * UM);

  ok(await admin.post(`/api/shop/sales/${s.sale.id}/cancel`, { reason: 'Erreur de caisse' }));
  const after = await history(c.id);
  assert.equal(after.lines[1].status, 'remboursee');
  assert.equal(after.total, 50000 * UM);
});

test('une ligne de séance due n’a ni moyen ni paiement', async () => {
  const c = await newClient();
  ok(await ger.post(`/api/clients/${c.id}/convert`));
  const resId = await bookSession(c);
  ok(await ger.post(`/api/reservations/${resId}/items`, { product_id: CIG, quantity: 2 }));
  const h = await history(c.id);
  assert.equal(h.lines.length, 1);
  const l = h.lines[0];
  assert.equal(l.status, 'due');
  assert.equal(l.quantity, 2);
  assert.equal(l.method, null);
  assert.equal(l.card_amount, null);
  assert.equal(l.payment_id, null);
  assert.equal(l.ticket_number, null);
  assert.equal(h.total, 10000 * UM);
});

test('le client journalier n’a pas d’historique', async () => {
  ok(await ger.post('/api/shop/sales', { account: 'cigares', buyer: { kind: 'journalier' }, lines: [{ product_id: CIG, quantity: 1 }], method: 'Espèces' }));
  const id = server.club.get("SELECT id FROM members WHERE kind = 'journalier'").id;
  assert.equal((await ger.get(`/api/members/${id}/purchases`)).status, 404);
  assert.equal((await ger.get('/api/members/999999/purchases')).status, 404);
  assert.equal((await new Client(server).get(`/api/members/${id}/purchases`)).status, 401);
});
