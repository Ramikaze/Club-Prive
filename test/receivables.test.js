// What is owed to the club (owner's request, 2026-11-19: the tiles of « Membres / Clients »): the regular clients'
// credit and the members' open notes, each with its total and how many owe.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { Server, Client, ok, UM, postSale } from './harness.js';

const server = new Server({}, { lenientTariffs: true });
let admin;
let ger;
let cha;
let bundle;
let today;
let CHP;

before(async () => {
  await server.start();
  await server.addUser('admin', 'Propriétaire', 'admin', 'recv-admin-password');
  await server.addUser('ger', 'Gérant', 'gerant', 'recv-ger-password');
  await server.addUser('cha', 'Associé boissons', 'associe', 'recv-cha-password', 'alcool');
  admin = new Client(server);
  ger = new Client(server);
  cha = new Client(server);
  bundle = await admin.login('admin', 'recv-admin-password');
  today = bundle.biz_today;
  await ger.login('ger', 'recv-ger-password');
  await cha.login('cha', 'recv-cha-password');
  CHP = ok(await admin.post('/api/products', { category: 'bouteille', name: 'Champagne dû', reference: 'CHP-R', price: 50000 * UM, initial_stock: 20 })).id;
});
after(() => server.destroy());

test('créances : clients réguliers et membres, chacun avec son total et le nombre de débiteurs', async () => {
  assert.deepEqual(ok(await ger.get('/api/receivables')), { clients: { total: 0, count: 0 }, members: { total: 0, count: 0 } });
  // A regular client buys on credit, then settles part of it.
  const client = ok(await ger.post('/api/clients', { first_name: 'awa', last_name: 'creance', phone: '00 00 10 01' }));
  ok(await cha.put(`/api/clients/${client.id}/credit-limit`, { credit_limit: 100000 * UM }));
  ok(await postSale(ger, {
    account: 'alcool', buyer: { kind: 'client', member_id: client.id }, lines: [{ product_id: CHP, quantity: 1 }], credit: true,
  }));
  ok(await ger.post(`/api/clients/${client.id}/settlements`, { amount: 20000 * UM, method: 'Espèces' }));
  // A member has a bottle on his open session note.
  const m = ok(await ger.post('/api/members', { first_name: 'bob', last_name: 'creance', phone: '00 00 10 02' }));
  ok(await ger.post(`/api/members/${m.id}/subscriptions`, { plan_id: bundle.plans.find((x) => x.code === 'MENSUELLE').id, start_date: today }));
  const r = ok(await ger.post('/api/reservations', { member_id: m.id, room_id: bundle.rooms[0].id, date: today, start_time: '18:00', duration_min: 60 }));
  ok(await ger.post(`/api/reservations/${r.reservation.id}/items`, { product_id: CHP, quantity: 1 }));
  const recv = ok(await ger.get('/api/receivables'));
  assert.deepEqual(recv.clients, { total: 30000 * UM, count: 1 });
  assert.equal(recv.members.count, 1);
  assert.ok(recv.members.total >= 50000 * UM, JSON.stringify(recv.members)); // the bottle, plus the session if billed
  // The same figures as the home page's.
  const home = ok(await admin.get('/api/dashboard'));
  assert.equal(recv.clients.total, home.credit_total);
  assert.equal(recv.members.total, home.outstanding_total);
});
