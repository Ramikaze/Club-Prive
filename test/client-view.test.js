// What a signed-in client sees of his own file (spec « Espace client »): his account, his history, his tickets. Each
// answer is built field by field: no staff name, no staff note, no reason typed by staff, nothing of another member.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { Server, Client, ok, UM } from './harness.js';

const server = new Server({}, { lenientTariffs: true });
const PASSWORD = 'mon-mot-de-passe-client';
const STAFF_NAME = 'Gérante Secrète';
const FILE_NOTES = 'Note interne confidentielle sur Alice';
let admin;
let manager;
let today;
let bundle;
let bottle;
let alice; // { member, client, rechargeId, saleId }
let bruno;

const tomorrowOf = (day) => new Date(Date.parse(`${day}T12:00:00Z`) + 86400000).toISOString().slice(0, 10);

// Opens a client access for the member (the administrator), signs him in with his member number and the code, and lets
// him choose his identifier and a password of his own, on a client of his own.
async function signedIn(member, login) {
  const { code } = ok(await admin.post(`/api/members/${member.id}/client-access`, {}));
  const client = new Client(server);
  ok(await client.post('/api/client/login', { login: member.member_no, password: code }));
  ok(await client.post('/api/client/password', { login, new_password: PASSWORD }));
  return client;
}

const sell = async (memberId, extra = {}) => ok(await manager.post('/api/shop/sales', {
  account: 'alcool', buyer: { kind: 'membre', member_id: memberId }, lines: [{ product_id: bottle.id, quantity: 1 }], method: 'Espèces', ...extra,
}));

before(async () => {
  await server.start();
  await server.addUser('admin', 'Propriétaire', 'admin', 'view-admin-password');
  await server.addUser('ger', STAFF_NAME, 'gerant', 'view-ger-password');
  admin = new Client(server);
  manager = new Client(server);
  bundle = await admin.login('admin', 'view-admin-password');
  today = bundle.biz_today;
  await manager.login('ger', 'view-ger-password');
  bottle = ok(await admin.post('/api/products', { category: 'bouteille', name: 'Champagne vue', reference: 'CHV', price: 20000 * UM, initial_stock: 20 }));

  const plan = bundle.plans.find((p) => p.code === 'MENSUELLE');
  const a = ok(await manager.post('/api/members', { first_name: 'alice', last_name: 'vue', phone: '06 111 11 11', notes: FILE_NOTES }));
  ok(await manager.post(`/api/members/${a.id}/subscriptions`, { plan_id: plan.id, start_date: today }));
  const recharge = ok(await manager.post(`/api/members/${a.id}/wallet/recharge`, { amount: 50000 * UM, method: 'Espèces', reference: 'REF-INTERNE-77' }));
  const saleA = await sell(a.id, { card: true, method: undefined });
  const b = ok(await manager.post('/api/members', { first_name: 'bruno', last_name: 'autre', phone: '06 222 22 22' }));
  ok(await manager.post(`/api/members/${b.id}/wallet/recharge`, { amount: 10000 * UM, method: 'Espèces' }));
  const saleB = await sell(b.id);
  alice = { member: a, rechargeId: recharge.payment_id ?? recharge.payment?.id, saleId: saleA.payment?.id };
  bruno = { member: b, saleId: saleB.payment?.id };
  alice.client = await signedIn(a, 'alice.vue');
  bruno.client = await signedIn(b, 'bruno.autre');
});
after(() => server.destroy());

test('compte d’un membre : crédit carte, abonnement, séance en cours', async () => {
  const rooms = ok(await manager.get('/api/rooms'));
  const tomorrow = tomorrowOf(today);
  const running = ok(await manager.post('/api/reservations', { member_id: alice.member.id, room_id: rooms[0].id, date: today, start_time: '15:00', duration_min: 60 })).reservation;
  ok(await manager.post(`/api/reservations/${running.id}/start`));
  const later = ok(await manager.post('/api/reservations', { member_id: alice.member.id, room_id: rooms[0].id, date: tomorrow, start_time: '18:00', duration_min: 60, party_size: 2 })).reservation;

  const view = ok(await alice.client.get('/api/client/account'));
  const detail = ok(await manager.get(`/api/members/${alice.member.id}`));
  assert.deepEqual(view.member, { first_name: 'Alice', last_name: 'VUE', member_no: alice.member.member_no, kind: 'membre' });
  assert.ok(Date.parse(view.server_now));
  assert.equal(view.wallet.balance, detail.wallet.balance);
  assert.ok(view.wallet.balance > 0);
  assert.deepEqual(view.subscription, {
    plan_name: detail.subscription.plan_name, end_date: detail.subscription.end_date, available_min: detail.subscription.credit.available,
  });
  assert.equal(view.credit, null);
  assert.equal(view.in_session.room_name, running.room_name);
  assert.equal(view.in_session.start_at, running.start_at);
  assert.equal(view.in_session.end_at, running.end_at);
  assert.deepEqual(view.reservations.map((r) => r.id), [later.id]);
  assert.deepEqual(view.reservations[0], {
    id: later.id, date: tomorrow, start_time: '18:00', end_time: '19:00', duration_min: 60, party_size: 2, status: 'reservee',
  });
  assert.deepEqual(view.requests, []);
});

test('compte d’un client régulier : ce qu’il doit, plafond, disponible', async () => {
  const c = ok(await manager.post('/api/clients', { first_name: 'awa', last_name: 'credit', phone: '06 333 33 33' }));
  const client = await signedIn(c, 'awa.credit');
  assert.equal(ok(await client.get('/api/client/account')).credit, null);
  ok(await admin.put(`/api/clients/${c.id}/credit-limit`, { credit_limit: 60000 * UM }));
  ok(await manager.post('/api/shop/sales', {
    account: 'alcool', buyer: { kind: 'client', member_id: c.id }, lines: [{ product_id: bottle.id, quantity: 2 }], credit: true,
  }));
  const view = ok(await client.get('/api/client/account'));
  assert.deepEqual(view.credit, { owed: 40000 * UM, limit: 60000 * UM, available: 20000 * UM });
  assert.equal(view.member.kind, 'client');
  assert.equal(view.wallet, null);
  assert.equal(view.in_session, null);
  assert.equal(view.subscription, null);
});

test('demandes : en attente, et refusées des 30 derniers jours', async () => {
  const room = server.club.get('SELECT id FROM rooms LIMIT 1').id;
  const at = (days) => new Date(Date.now() - days * 86400000).toISOString();
  const insert = (status, created, message) => server.club.run(
    `INSERT INTO reservation_requests (member_id, room_id, date, start_time, duration_min, party_size, status, created_at, decided_at, message)
     VALUES (?, ?, ?, '16:00', 60, 2, ?, ?, ?, ?)`, bruno.member.id, room, today, status, created, status === 'en_attente' ? null : created, message,
  );
  const pending = insert('en_attente', at(1), null).lastId;
  const refused = insert('refusee', at(5), 'Salon complet ce soir.').lastId;
  insert('refusee', at(40), 'Trop ancienne.');
  insert('confirmee', at(2), null);
  // A request of 3 hours or more carries the deposit it will ask for; a short one, none.
  const long = server.club.run(
    `INSERT INTO reservation_requests (member_id, room_id, date, start_time, duration_min, party_size, status, created_at)
     VALUES (?, ?, ?, '15:00', 180, 2, 'en_attente', ?)`, bruno.member.id, room, tomorrowOf(today), at(0),
  ).lastId;
  const { requests } = ok(await bruno.client.get('/api/client/account'));
  assert.deepEqual(requests.map((r) => r.id).sort(), [pending, refused, long].sort());
  assert.ok(requests.find((r) => r.id === long).deposit_amount > 0);
  assert.equal(requests.find((r) => r.id === pending).deposit_amount, 0);
  assert.deepEqual(requests.find((r) => r.id === refused), {
    id: refused, date: today, start_time: '16:00', duration_min: 60, party_size: 2, status: 'refusee', message: 'Salon complet ce soir.', deposit_amount: 0,
  });
  // Nothing of Bruno's requests reaches Alice.
  assert.deepEqual(ok(await alice.client.get('/api/client/account')).requests, []);
});

test('historique : achats, recharge, séance, du plus récent au plus ancien', async () => {
  const history = ok(await alice.client.get('/api/client/history'));
  assert.equal(history.period.to, today);
  const kinds = history.items.map((i) => i.kind);
  for (const kind of ['achat', 'recharge', 'seance']) assert.ok(kinds.includes(kind), kind);
  const ats = history.items.map((i) => i.at);
  assert.deepEqual(ats, [...ats].sort().reverse());
  const recharge = history.items.find((i) => i.kind === 'recharge');
  assert.equal(recharge.amount, 50000 * UM);
  assert.equal(recharge.payment_id, alice.rechargeId);
  assert.match(recharge.ticket_number, /\d/);
  const purchase = history.items.find((i) => i.kind === 'achat');
  assert.equal(purchase.amount, 20000 * UM);
  assert.match(purchase.label, /Champagne vue/);
  assert.equal(purchase.payment_id, alice.saleId);
  for (const item of history.items) {
    assert.deepEqual(Object.keys(item).sort(), ['amount', 'at', 'kind', 'label', 'payment_id', 'status', 'ticket_number']);
  }
  // Nothing of Bruno's.
  assert.ok(!JSON.stringify(history).includes('autre'));
  assert.equal((await alice.client.get('/api/client/history?from=2026-13-40&to=2026-13-41')).status, 400);
});

test('aucune donnée interne dans les réponses', async () => {
  // A cancelled sale with a reason typed by staff, and a refund with a reason, on Alice's file.
  const sale = await sell(alice.member.id);
  ok(await admin.post(`/api/shop/sales/${sale.sale.id}/cancel`, { reason: 'Motif interne du gérant' }));
  const account = ok(await alice.client.get('/api/client/account'));
  const history = ok(await alice.client.get('/api/client/history'));
  // The cancelled sale's own ticket: the staff's reasons are in the staff's view of it, not in the client's.
  const staffTicket = ok(await manager.get(`/api/payments/${sale.payment.id}/ticket`)).ticket;
  assert.equal(staffTicket.shop_cancel_reason, 'Motif interne du gérant');
  const ticket = ok(await alice.client.get(`/api/client/tickets/${sale.payment.id}`));
  const text = JSON.stringify({ account, history });
  for (const key of ['notes', 'by_name', 'created_by_name', 'cancel_reason', 'shop_cancel_reason', 'reason']) {
    assert.ok(!text.includes(`"${key}"`), `clé ${key}`);
  }
  // The history, built from the staff's statement, carries no payment reference either.
  assert.ok(!JSON.stringify(history).includes('"reference"'));
  for (const secret of [STAFF_NAME, FILE_NOTES, 'Motif interne du gérant', 'REF-INTERNE-77', 'Propriétaire']) {
    assert.ok(!text.includes(secret), secret);
  }
  // The ticket keeps the cashier and the reference (the paper ticket prints them) but none of the staff's reasons.
  const ticketText = JSON.stringify(ticket);
  for (const key of ['cancel_reason', 'shop_cancel_reason', 'next_copy_no', 'notes', 'by_name']) {
    assert.ok(!ticketText.includes(`"${key}"`), `ticket, clé ${key}`);
  }
  assert.ok(!ticketText.includes('Motif interne du gérant'));
  assert.equal(ticket.ticket.created_by_name, STAFF_NAME);
});

test('ticket : A ouvre le sien, pas celui de B (404), pas un numéro inconnu (404)', async () => {
  const mine = ok(await alice.client.get(`/api/client/tickets/${alice.saleId}`));
  assert.equal(mine.ticket.id, alice.saleId);
  for (const key of ['next_copy_no', 'cancel_reason', 'shop_cancel_reason']) assert.ok(!(key in mine.ticket), key);
  for (const id of [bruno.saleId, 999999, 'abc']) {
    const r = await alice.client.get(`/api/client/tickets/${id}`);
    assert.equal(r.status, 404, String(id));
    assert.equal(r.data.error.code, 'INTROUVABLE');
  }
  // A walk-in's ticket is nobody's.
  const walkIn = ok(await manager.post('/api/shop/sales', {
    account: 'alcool', buyer: { kind: 'journalier' }, lines: [{ product_id: bottle.id, quantity: 1 }], method: 'Espèces',
  }));
  assert.equal((await alice.client.get(`/api/client/tickets/${walkIn.payment.id}`)).status, 404);
});

test('copie client : notée à part, ne change pas les duplicatas', async () => {
  const events = () => server.club.get('SELECT COUNT(*) AS n FROM ticket_events').n;
  const next = async () => ok(await manager.get(`/api/payments/${alice.saleId}/ticket`)).ticket.next_copy_no;
  const before = { events: events(), next: await next() };
  ok(await alice.client.post(`/api/client/tickets/${alice.saleId}/copies`, { kind: 'impression' }));
  ok(await alice.client.post(`/api/client/tickets/${alice.saleId}/copies`, { kind: 'telechargement' }));
  assert.equal((await alice.client.post(`/api/client/tickets/${alice.saleId}/copies`, { kind: 'whatsapp' })).status, 400);
  assert.equal((await alice.client.post(`/api/client/tickets/${bruno.saleId}/copies`, { kind: 'impression' })).status, 404);
  assert.equal(events(), before.events);
  assert.equal(await next(), before.next);
  const rows = server.club.all('SELECT payment_id, member_id, kind FROM client_ticket_copies ORDER BY id').map((r) => ({ ...r }));
  assert.deepEqual(rows, [
    { payment_id: alice.saleId, member_id: alice.member.id, kind: 'impression' },
    { payment_id: alice.saleId, member_id: alice.member.id, kind: 'telechargement' },
  ]);
});

test('vente payée par carte puis annulée : un seul remboursement dans l’historique', async () => {
  const c = ok(await manager.post('/api/members', { first_name: 'carla', last_name: 'rembourse', phone: '06 444 44 44' }));
  ok(await manager.post(`/api/members/${c.id}/wallet/recharge`, { amount: 100000 * UM, method: 'Espèces' }));
  const client = await signedIn(c, 'carla.rembourse');
  const sale = await sell(c.id, { card: true, method: undefined });
  assert.equal(sale.payment.card_amount, 20000 * UM);
  ok(await admin.post(`/api/shop/sales/${sale.sale.id}/cancel`, { reason: 'Erreur de rayon' }));
  const refunds = ok(await client.get('/api/client/history')).items.filter((i) => i.kind === 'remboursement');
  assert.equal(refunds.length, 1, JSON.stringify(refunds));
  assert.equal(refunds[0].amount, 20000 * UM);
  assert.equal(refunds[0].payment_id, sale.payment.id);
  assert.match(refunds[0].label, /Champagne vue/);
  // A cancelled outside meal has no refund row: its card part coming back is the card's own movement, still shown.
  const meal = ok(await manager.post(`/api/members/${c.id}/outside-meal`, { amount: 15000 * UM, label: 'Pizzeria Secrète' })).payment;
  ok(await admin.post(`/api/payments/${meal.id}/cancel-meal`, { reason: 'Commande perdue par le livreur' }));
  const items = ok(await client.get('/api/client/history')).items;
  const back = items.filter((i) => i.kind === 'remboursement' && i.payment_id === meal.id);
  assert.deepEqual(back.map((i) => [i.label, i.amount]), [['Remboursement sur la carte', 15000 * UM]]);
  assert.equal(items.filter((i) => i.kind === 'remboursement').length, 2);
});

test('repas commandé à l’extérieur payé par carte : dans l’historique, sans le libellé du personnel', async () => {
  const d = ok(await manager.post('/api/members', { first_name: 'dora', last_name: 'repas', phone: '06 555 55 55' }));
  ok(await manager.post(`/api/members/${d.id}/wallet/recharge`, { amount: 100000 * UM, method: 'Espèces' }));
  const client = await signedIn(d, 'dora.repas');
  const meal = ok(await manager.post(`/api/members/${d.id}/outside-meal`, { amount: 15000 * UM, label: 'Pizzeria Secrète' })).payment;
  assert.equal(ok(await client.get('/api/client/account')).wallet.balance, 85000 * UM);
  const history = ok(await client.get('/api/client/history'));
  const item = history.items.find((i) => i.kind === 'repas');
  assert.deepEqual(item, {
    at: meal.paid_at, kind: 'repas', label: 'Repas commandé à l’extérieur', amount: 15000 * UM,
    payment_id: meal.id, ticket_number: item.ticket_number, status: 'valide',
  });
  assert.match(item.ticket_number, /\d/);
  assert.deepEqual(history.items.map((i) => i.kind).sort(), ['recharge', 'repas']);
  // Its ticket opens, and names neither the restaurant nor the dish the staff typed.
  const { ticket } = ok(await client.get(`/api/client/tickets/${meal.id}`));
  assert.equal(ticket.kind, 'repas');
  assert.equal(ticket.label, 'Repas commandé à l’extérieur');
  assert.equal(ticket.amount, 15000 * UM);
  assert.ok(!JSON.stringify({ history, ticket }).includes('Pizzeria'));
  // Cancelled, it stays in the history as « annulé ».
  ok(await admin.post(`/api/payments/${meal.id}/cancel-meal`, { reason: 'Repas jamais livré' }));
  const after = ok(await client.get('/api/client/history')).items.find((i) => i.kind === 'repas');
  assert.equal(after.status, 'annule');
  assert.equal(after.payment_id, meal.id);
});

test('acompte d’une demande : rien à payer quand la carte le couvre', async () => {
  const room = server.club.get('SELECT id FROM rooms LIMIT 1').id;
  const e = ok(await manager.post('/api/members', { first_name: 'eva', last_name: 'acompte', phone: '06 666 66 66' }));
  const client = await signedIn(e, 'eva.acompte');
  const id = server.club.run(
    `INSERT INTO reservation_requests (member_id, room_id, date, start_time, duration_min, party_size, status, created_at)
     VALUES (?, ?, ?, '14:00', 180, 2, 'en_attente', ?)`, e.id, room, tomorrowOf(tomorrowOf(today)), new Date().toISOString(),
  ).lastId;
  const deposit = async () => ok(await client.get('/api/client/account')).requests.find((r) => r.id === id).deposit_amount;
  // An empty card: the whole deposit is due, at the club or by recharging the card.
  const due = await deposit();
  assert.ok(due > 0);
  // A card that covers the deposit pays it at the confirmation: nothing is left to pay.
  ok(await manager.post(`/api/members/${e.id}/wallet/recharge`, { amount: due, method: 'Espèces' }));
  assert.equal(await deposit(), 0);
});
