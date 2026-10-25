// End-to-end scenarios through the API, on a throwaway database.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { addDays } from '../shared/time.js';
import { Server, Client, ok, UM } from './harness.js';

const server = new Server({}, { lenientTariffs: true });
let today;
let plans;
let manager;
let admin;

async function newMember(first, { plan = 'MENSUELLE', start: startDate = today } = {}) {
  const m = ok(await manager.post('/api/members', { first_name: first, last_name: 'Test', phone: '+000 00 00 00 00' }));
  if (plan) {
    const planId = plans.find((p) => p.code === plan).id;
    ok(await manager.post(`/api/members/${m.id}/subscriptions`, { plan_id: planId, start_date: startDate }));
  }
  return m.id;
}

const book = (memberId, date, time, minutes, extra = {}) => manager.post('/api/reservations', {
  member_id: memberId, date, start_time: time, duration_min: minutes, ...extra,
});

let whisky;
let robusto;
const day = (n) => addDays(today, n);

before(async () => {
  await server.start();
  await server.addUser('admin', 'Admin TEST', 'admin', 'admin-password-1');
  await server.addUser('gerant', 'Gérant TEST', 'gerant', 'gerant-password-1');
  admin = new Client(server);
  manager = new Client(server);
  await admin.login('admin', 'admin-password-1');
  const bundle = await manager.login('gerant', 'gerant-password-1');
  ok(await admin.put('/api/settings', { timezone: 'Africa/Brazzaville' }));
  today = bundle.biz_today;
  plans = bundle.plans;
  whisky = ok(await admin.post('/api/products', {
    category: 'bouteille', name: 'Whisky test', reference: 'T-WHI', price: 40000 * UM, initial_stock: 10,
  })).id;
  robusto = ok(await admin.post('/api/products', {
    category: 'cigare', name: 'Robusto test', reference: 'T-ROB', price: 10000 * UM, initial_stock: 10,
  })).id;
});

after(() => server.destroy());

let memberA;

test('1. réservation d’une heure', async () => {
  memberA = await newMember('Alice');
  const d = ok(await book(memberA, day(1), '14:00', 60));
  assert.equal(d.reservation.status, 'reservee');
  assert.equal(d.reservation.duration_min, 60);
  assert.equal(d.reservation.included_minutes, 60);
  assert.equal(d.reservation.paid_minutes, 0);
  assert.equal(d.reservation.supplement_amount, 0);
  assert.equal(d.reservation.created_by_name, 'Gérant TEST');
  assert.equal(d.subscription.credit.committed, 60);
  assert.equal(d.subscription.credit.available, 60);
  const short = await book(memberA, day(1), '17:00', 30);
  assert.equal(short.status, 400);
  assert.equal(short.data.error.code, 'DUREE_MINIMALE');
  const misaligned = await book(memberA, day(1), '17:15', 60);
  assert.equal(misaligned.status, 400);
});

test('2. utilisation puis épuisement d’un crédit de deux heures', async () => {
  const second = ok(await book(memberA, day(1), '16:00', 60));
  assert.equal(second.reservation.included_minutes, 60);
  assert.equal(second.subscription.credit.available, 0);
  const quote = ok(await manager.post('/api/reservations/quote', { member_id: memberA, date: day(1), start_time: '18:00', duration_min: 60 }));
  assert.equal(quote.included_minutes, 0);
  assert.equal(quote.paid_minutes, 60);
  assert.equal(quote.supplement_amount, 25000 * UM);
  const third = ok(await book(memberA, day(1), '18:00', 60));
  assert.equal(third.reservation.included_minutes, 0);
  assert.equal(third.reservation.supplement_amount, 25000 * UM);
  assert.equal(third.charges.length, 1);
  assert.equal(third.charges[0].account, 'reservations');
  // Finishing the first session turns its committed minutes into consumed minutes.
  const list = ok(await manager.get(`/api/reservations?from=${day(1)}&to=${day(1)}`));
  const first = list.find((r) => r.start_time === '14:00');
  const done = ok(await manager.post(`/api/reservations/${first.id}/finish`));
  assert.equal(done.reservation.status, 'terminee');
  assert.equal(done.subscription.credit.consumed, 60);
  assert.equal(done.subscription.credit.committed, 60);
  assert.equal(done.subscription.credit.available, 0);
  const again = await manager.post(`/api/reservations/${first.id}/finish`);
  assert.equal(again.status, 409);
});

test('3. supplément de 15 000 pour une demi-heure (2 h 30 avec 2 h disponibles)', async () => {
  const b = await newMember('Bruno');
  const d = ok(await book(b, day(2), '14:00', 150));
  assert.equal(d.reservation.included_minutes, 120);
  assert.equal(d.reservation.paid_minutes, 30);
  assert.equal(d.reservation.supplement_amount, 15000 * UM);
});

test('4. 90 minutes entièrement payantes = 40 000', async () => {
  const d = ok(await book(memberA, day(2), '17:00', 90));
  assert.equal(d.reservation.included_minutes, 0);
  assert.equal(d.reservation.paid_minutes, 90);
  assert.equal(d.reservation.supplement_amount, 40000 * UM);
});

test('5. refus d’un chevauchement, y compris en accès simultané et en prolongation', async () => {
  const c = await newMember('Chloé');
  const d = await newMember('David');
  const clash = await book(c, day(2), '15:00', 60);
  assert.equal(clash.status, 409);
  assert.equal(clash.data.error.code, 'CHEVAUCHEMENT');
  const [r1, r2] = await Promise.all([book(c, day(3), '14:00', 60), book(d, day(3), '14:30', 60)]);
  assert.deepEqual([r1.status, r2.status].sort(), [200, 409]);
  const bruno = ok(await manager.get(`/api/reservations?from=${day(2)}&to=${day(2)}`)).find((r) => r.start_time === '14:00');
  const ext = await manager.post(`/api/reservations/${bruno.id}/extend`, { minutes: 60 });
  assert.equal(ext.status, 409);
  assert.equal(ext.data.error.code, 'CHEVAUCHEMENT');
});

test('5 bis. le crédit n’est jamais compté deux fois en accès simultané', async () => {
  const m = await newMember('Inès');
  const [r1, r2] = await Promise.all([book(m, day(6), '12:00', 120), book(m, day(6), '15:00', 120)]);
  const included = [ok(r1).reservation.included_minutes, ok(r2).reservation.included_minutes].sort((x, y) => x - y);
  assert.deepEqual(included, [0, 120]);
});

test('6. prolongation au-delà de minuit jusqu’à la fermeture, et réservation le matin, sans autorisation', async () => {
  const e = await newMember('Émile');
  // The time beyond the credit is paid by the card when the session is extended.
  ok(await manager.post(`/api/members/${e}/wallet/recharge`, { amount: 100000 * UM, method: 'Espèces' }));
  const d = ok(await book(e, day(4), '22:00', 90));
  const id = d.reservation.id;
  const quote = ok(await manager.post(`/api/reservations/${id}/extend/quote`, { minutes: 120 }));
  assert.equal(quote.included_minutes, 30);
  assert.equal(quote.paid_minutes, 90);
  assert.equal(quote.supplement_delta, 40000 * UM);
  assert.deepEqual([quote.card_amount, quote.card_balance, quote.balance_after, quote.card_enough], [40000 * UM, 100000 * UM, 60000 * UM, true]);
  const ext = ok(await manager.post(`/api/reservations/${id}/extend`, { minutes: 120 }));
  assert.equal(ext.reservation.end_time, '01:30');
  assert.equal(ext.reservation.end_date, day(5));
  assert.equal(ext.reservation.biz_day, day(4));
  assert.equal(ext.reservation.duration_min, 210);
  assert.equal(ext.reservation.off_hours, false);
  assert.equal(ext.reservation.supplement_amount, 40000 * UM);
  // Not past the club's closing time (02:30 by default): until then, still the same session.
  const dawn = await manager.post(`/api/reservations/${id}/extend`, { minutes: 300 });
  assert.equal(dawn.status, 409);
  assert.equal(dawn.data.error.code, 'FERMETURE');
  const closing = ok(await manager.post(`/api/reservations/${id}/extend`, { minutes: 60 }));
  assert.equal(closing.reservation.end_time, '02:30');
  assert.equal(closing.reservation.biz_day, day(4));
  const tooLong = await manager.post(`/api/reservations/${id}/extend`, { minutes: 1440 });
  assert.equal(tooLong.status, 400);
  assert.equal(tooLong.data.error.code, 'DUREE_MAXIMALE');
  // A morning booking, once refused outside opening hours, is accepted.
  const f = await newMember('Fanny');
  const morning = ok(await book(f, day(6), '08:00', 60));
  assert.equal(morning.reservation.start_time, '08:00');
  assert.equal(morning.reservation.biz_day, day(6));
});

test('7. expiration d’une carte : réservation refusée, puis acceptée après renouvellement', async () => {
  const f = await newMember('Fanny', { start: addDays(today, -45) });
  const detail = ok(await manager.get(`/api/members/${f}`));
  assert.equal(detail.subscription.state, 'expiree');
  const r = await book(f, day(1), '20:00', 60);
  assert.equal(r.status, 409);
  assert.equal(r.data.error.code, 'ABONNEMENT_INVALIDE');
  assert.match(r.data.error.message, /expiré/);
  const planId = plans.find((p) => p.code === 'MENSUELLE').id;
  ok(await manager.post(`/api/members/${f}/subscriptions`, { plan_id: planId, start_date: today }));
  const renewed = ok(await manager.get(`/api/members/${f}`));
  assert.equal(renewed.subscription.state, 'active');
  assert.equal(renewed.subscriptions.length, 2);
  ok(await book(f, day(1), '20:00', 60));
});

test('8. libération du crédit après annulation', async () => {
  const g = await newMember('Gilles');
  const d = ok(await book(g, day(5), '14:00', 120));
  assert.equal(d.subscription.credit.available, 0);
  const noReason = await manager.post(`/api/reservations/${d.reservation.id}/cancel`, {});
  assert.equal(noReason.status, 400);
  const c = ok(await manager.post(`/api/reservations/${d.reservation.id}/cancel`, { reason: 'Empêchement' }));
  assert.equal(c.reservation.status, 'annulee');
  assert.equal(c.released_minutes, 120);
  assert.equal(c.subscription.credit.available, 120);
  assert.equal(c.subscription.credit.committed, 0);
  assert.ok(c.credit_movements.some((m) => m.kind === 'liberation' && m.minutes === 120));
  // The freed slot can be booked again.
  ok(await book(g, day(5), '14:00', 60));
});

test('9. vente mixte correctement ventilée (25 000 + 40 000 + 10 000 = 75 000)', async () => {
  const h = await newMember('Hugo');
  ok(await book(h, day(7), '12:00', 120));
  const d = ok(await book(h, day(7), '16:00', 60));
  const id = d.reservation.id;
  const half = await manager.post(`/api/reservations/${id}/items`, { product_id: whisky, quantity: 1.5 });
  assert.equal(half.status, 400);
  ok(await manager.post(`/api/reservations/${id}/items`, { product_id: whisky, quantity: 1 }));
  const withItems = ok(await manager.post(`/api/reservations/${id}/items`, { product_id: robusto, quantity: 1 }));
  const due = withItems.charges.filter((c) => c.status === 'due');
  assert.equal(due.length, 3);
  const before = ok(await admin.get(`/api/finance/summary?from=${today}&to=${today}`));
  const pay = ok(await manager.post('/api/payments', { charge_ids: due.map((c) => c.id), method: 'Espèces', reference: 'T-1' }));
  assert.equal(pay.payment.amount, 75000 * UM);
  assert.deepEqual(pay.payment.by_account, { reservations: 25000 * UM, alcool: 40000 * UM, cigares: 10000 * UM });
  const afterSum = ok(await admin.get(`/api/finance/summary?from=${today}&to=${today}`));
  const delta = (k) => afterSum.accounts.find((a) => a.account === k).collected - before.accounts.find((a) => a.account === k).collected;
  assert.equal(delta('reservations'), 25000 * UM);
  assert.equal(delta('alcool'), 40000 * UM);
  assert.equal(delta('cigares'), 10000 * UM);
  assert.equal(afterSum.total.collected - before.total.collected, 75000 * UM);
  const twice = await manager.post('/api/payments', { charge_ids: due.map((c) => c.id), method: 'Espèces' });
  assert.equal(twice.status, 409);
});

test('10. le stock ne diminue qu’une fois, même si la requête est rejouée', async () => {
  const m = await newMember('Jade');
  const r = ok(await book(m, day(8), '14:00', 60)).reservation;
  const stockOf = async (pid) => ok(await manager.get('/api/products')).find((p) => p.id === pid).stock_qty;
  const movementsOf = async (pid) => ok(await manager.get(`/api/stock-movements?product_id=${pid}`)).length;
  const s0 = await stockOf(whisky);
  const m0 = await movementsOf(whisky);
  const headers = { 'idempotency-key': 'retry-test-key-0001' };
  const first = await manager.post(`/api/reservations/${r.id}/items`, { product_id: whisky, quantity: 1 }, headers);
  const retry = await manager.post(`/api/reservations/${r.id}/items`, { product_id: whisky, quantity: 1 }, headers);
  assert.equal(first.status, 200);
  assert.equal(retry.status, 200);
  assert.equal(retry.headers.get('idempotent-replayed'), 'true');
  assert.deepEqual(retry.data, first.data);
  const [p1, p2] = await Promise.all([
    manager.post(`/api/reservations/${r.id}/items`, { product_id: whisky, quantity: 1 }, { 'idempotency-key': 'retry-test-key-0002' }),
    manager.post(`/api/reservations/${r.id}/items`, { product_id: whisky, quantity: 1 }, { 'idempotency-key': 'retry-test-key-0002' }),
  ]);
  assert.equal(p1.status, 200);
  assert.equal(p2.status, 200);
  assert.equal(await stockOf(whisky), s0 - 2);
  assert.equal(await movementsOf(whisky), m0 + 2);
  const tooMany = await manager.post(`/api/reservations/${r.id}/items`, { product_id: whisky, quantity: 99 });
  assert.equal(tooMany.status, 409);
  assert.equal(tooMany.data.error.code, 'STOCK_INSUFFISANT');
  // A retried payment does not create a second payment.
  const due = ok(await manager.get(`/api/reservations/${r.id}`)).charges.filter((c) => c.status === 'due').map((c) => c.id);
  const payHeaders = { 'idempotency-key': 'retry-test-pay-0001' };
  const pay1 = ok(await manager.post('/api/payments', { charge_ids: due, method: 'Espèces' }, payHeaders));
  const pay2 = ok(await manager.post('/api/payments', { charge_ids: due, method: 'Espèces' }, payHeaders));
  assert.equal(pay1.payment.id, pay2.payment.id);
  const payments = ok(await manager.get(`/api/reservations/${r.id}`)).payments;
  assert.equal(payments.length, 1);
  // Cancelling an unpaid product line puts the bottle back in stock, traceably.
  const line = ok(await manager.post(`/api/reservations/${r.id}/items`, { product_id: robusto, quantity: 2 }))
    .charges.find((c) => c.status === 'due' && c.product_id === robusto);
  const before = await stockOf(robusto);
  ok(await manager.post(`/api/charges/${line.id}/cancel`, { reason: 'Erreur de saisie' }));
  assert.equal(await stockOf(robusto), before + 2);
});

test('11. persistance après redémarrage du serveur', async () => {
  const beforeRes = ok(await manager.get(`/api/reservations?from=${day(1)}&to=${day(8)}`));
  const beforeStock = ok(await manager.get('/api/products'));
  await server.restart();
  const afterRes = ok(await manager.get(`/api/reservations?from=${day(1)}&to=${day(8)}`));
  const afterStock = ok(await manager.get('/api/products'));
  assert.equal(afterRes.length, beforeRes.length);
  assert.deepEqual(afterRes.map((r) => [r.id, r.status, r.supplement_amount]), beforeRes.map((r) => [r.id, r.status, r.supplement_amount]));
  assert.deepEqual(afterStock.map((p) => p.stock_qty), beforeStock.map((p) => p.stock_qty));
});

test('12. restrictions du rôle gérant (contrôlées côté serveur)', async () => {
  const anonymous = new Client(server);
  assert.equal((await anonymous.get('/api/dashboard')).status, 401);
  const forbiddenCalls = [
    manager.put('/api/settings', { club_name: 'X' }),
    manager.put(`/api/plans/${plans[0].id}`, { price: 1 }),
    manager.get('/api/users'),
    manager.post('/api/users', { login: 'pirate', name: 'X', role: 'admin', password: 'xxxxxxxxxxxx' }),
    manager.get('/api/audit'),
    manager.get(`/api/finance/summary?from=${today}&to=${today}`),
    manager.get(`/api/export/lignes?from=${today}&to=${today}`),
    manager.post('/api/products', { category: 'cigare', name: 'X', reference: 'X-1', price: 1 }),
    manager.put(`/api/products/${whisky}`, { price: 1 }),
  ];
  for (const r of await Promise.all(forbiddenCalls)) assert.equal(r.status, 403, JSON.stringify(r.data));
  // Refunds and cancelling a time supplement are reserved to administrators.
  const paidLine = ok(await manager.get(`/api/reservations?from=${day(7)}&to=${day(7)}`)).find((r) => r.start_time === '16:00');
  const lines = ok(await manager.get(`/api/reservations/${paidLine.id}`)).charges;
  const refund = await manager.post(`/api/charges/${lines[0].id}/refund`, { reason: 'Test', method: 'Espèces' });
  assert.equal(refund.status, 403);
  const supplementLine = ok(await manager.get(`/api/reservations?from=${day(2)}&to=${day(2)}`)).find((r) => r.start_time === '17:00');
  const supp = ok(await manager.get(`/api/reservations/${supplementLine.id}`)).charges[0];
  assert.equal((await manager.post(`/api/charges/${supp.id}/cancel`, { reason: 'Geste commercial' })).status, 403);
  // The manager keeps the day-to-day operations.
  const added = ok(await manager.post(`/api/products/${whisky}/stock`, { kind: 'entree', quantity: 5 }));
  // An inventory adjustment by the manager may only add bottles; taking some away is an administrator's call.
  const fewer = await manager.post(`/api/products/${whisky}/stock`, { kind: 'ajustement', target_qty: added.stock_qty - 1, expected_qty: added.stock_qty, reason: 'Casse' });
  assert.equal(fewer.status, 403);
  const more = ok(await manager.post(`/api/products/${whisky}/stock`, { kind: 'ajustement', target_qty: added.stock_qty + 1, expected_qty: added.stock_qty, reason: 'Recompté' }));
  assert.equal(more.stock_qty, added.stock_qty + 1);
  assert.equal(ok(await admin.post(`/api/products/${whisky}/stock`, { kind: 'ajustement', target_qty: added.stock_qty, expected_qty: added.stock_qty + 1, reason: 'Casse' })).stock_qty, added.stock_qty);
  const journal = ok(await manager.get('/api/finance/journal?from=2020-01-01&to=2030-01-01'));
  assert.equal(journal.restricted, true);
  assert.equal(journal.from, today);
  // The administrator can do what the manager cannot.
  const adminRefund = ok(await admin.post(`/api/charges/${lines[0].id}/refund`, { reason: 'Test', method: 'Espèces' }));
  assert.equal(adminRefund.charges.find((c) => c.id === lines[0].id).status, 'remboursee');
  const csv = await admin.get(`/api/export/encaissements?from=${today}&to=${today}`);
  assert.equal(csv.status, 200);
  assert.match(csv.headers.get('content-type'), /text\/csv/);
});

test('13. tarifs non validés bloqués hors démonstration ; pas de recalcul après changement de tarif', async () => {
  const k = await newMember('Karim');
  ok(await book(k, day(9), '12:00', 120));
  // Leave the demo mode the scenarios run in: the real club refuses tariffs nobody has validated.
  server.club.demo = false;
  server.club.cachedSettings = null;
  try {
    const paid = await book(k, day(9), '16:00', 60);
    assert.equal(paid.status, 409);
    assert.equal(paid.data.error.code, 'TARIF_NON_VALIDE');
    const monthly = plans.find((p) => p.code === 'MENSUELLE').id;
    const annual = plans.find((p) => p.code === 'ANNUELLE').id;
    const m = ok(await manager.post('/api/members', { first_name: 'Léa', last_name: 'Test', phone: '+000 00 00 00 00' }));
    assert.equal((await manager.post(`/api/members/${m.id}/subscriptions`, { plan_id: monthly })).data.error.code, 'TARIF_NON_VALIDE');
    const noPrice = await manager.post(`/api/members/${m.id}/subscriptions`, { plan_id: annual });
    assert.equal(noPrice.data.error.code, 'TARIF_NON_DEFINI');
    // The real site's refusal says what to do, and does not send anyone to the demo.
    assert.match(noPrice.data.error.message, /tant qu'un administrateur n'a pas fixé le prix dans Paramètres/);
    assert.doesNotMatch(noPrice.data.error.message, /démo/i);
    ok(await admin.put('/api/settings', { overtime_tariff: { hour: 25000 * UM, half: 15000 * UM, validated: true } }));
    const now = ok(await book(k, day(9), '16:00', 60));
    assert.equal(now.reservation.supplement_amount, 25000 * UM);
    ok(await admin.put('/api/settings', { overtime_tariff: { hour: 30000 * UM, half: 18000 * UM, validated: true } }));
    const unchanged = ok(await manager.get(`/api/reservations/${now.reservation.id}`));
    assert.equal(unchanged.reservation.supplement_amount, 25000 * UM);
    ok(await manager.post(`/api/members/${k}/wallet/recharge`, { amount: 15000 * UM, method: 'Espèces' }));
    const extended = ok(await manager.post(`/api/reservations/${now.reservation.id}/extend`, { minutes: 30 }));
    assert.equal(extended.reservation.supplement_amount, 40000 * UM); // still the booked tariff: 25 000 + 15 000
  } finally {
    server.club.demo = true;
    server.club.cachedSettings = null;
    ok(await admin.put('/api/settings', { overtime_tariff: { hour: 25000 * UM, half: 15000 * UM, validated: false } }));
  }
});

test('14. protections HTTP : JSON requis, origine étrangère refusée', async () => {
  const noJson = await server.fetch('/api/members', { method: 'POST', headers: { cookie: manager.cookie, 'content-type': 'text/plain' }, body: '{}' });
  assert.equal(noJson.status, 415);
  const foreign = await manager.post('/api/members', { first_name: 'X', last_name: 'Y', phone: '+000 000 000' }, { origin: 'https://evil.example' });
  assert.equal(foreign.status, 403);
  const sameSite = await manager.post('/api/members', { first_name: 'Même', last_name: 'Origine', phone: '+000 000 000' }, { origin: 'http://club.test' });
  assert.equal(sameSite.status, 200);
  assert.equal((await manager.get('/api/inconnu')).status, 404);
  assert.equal((await manager.call('DELETE', '/api/members')).status, 405);
  const loggedOut = new Client(server);
  loggedOut.cookie = manager.cookie;
  ok(await loggedOut.post('/api/logout'));
  assert.equal((await loggedOut.get('/api/me')).status, 401);
});
