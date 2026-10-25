// The member's statement (relevé de compte): the card's balance at both ends of the period (a movement made
// before it counts in the opening balance), what moved it, the payments and refunds, the bookings and the plan,
// an empty period, and the errors.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { addDays, localToUtcMs } from '../shared/time.js';
import { CARD_METHOD } from '../shared/rules.js';
import { Server, Client, ok, UM } from './harness.js';

// Unvalidated tariffs are usable (as in the demo space): the plan and the paid time need no administrator here.
const server = new Server({}, { lenientTariffs: true });
let admin;
let manager;
let today;

before(async () => {
  await server.start();
  await server.addUser('admin', 'Admin', 'admin', 'statement-admin-password');
  await server.addUser('gerant', 'Gérant', 'gerant', 'statement-manager-password');
  admin = new Client(server);
  manager = new Client(server);
  await admin.login('admin', 'statement-admin-password');
  today = (await manager.login('gerant', 'statement-manager-password')).biz_today;
});
after(() => server.destroy());

const statement = (id, from, to) => manager.get(`/api/members/${id}/statement?from=${from}&to=${to}`);

let sami;
let paid; // what the scenario paid: the plan by card, the paid time in cash (refunded)

test('relevé : soldes, totaux et détail d’une période avec carte, espèces, remboursement et réservation', async () => {
  sami = ok(await manager.post('/api/members', { first_name: 'Sami', last_name: 'Relevé', phone: '+000 00 00 00 00' }));
  // Three days ago, before the period: a first recharge of 10 000 FCFA.
  server.club.at = localToUtcMs(addDays(today, -3), '12:00', server.club.settings().timezone);
  try {
    ok(await manager.post(`/api/members/${sami.id}/wallet/recharge`, { amount: 10000 * UM, method: 'Espèces' }));
  } finally {
    server.club.at = null;
  }

  // Today: a recharge of 60 000 FCFA, the monthly plan paid by the card, a booking of 2 h 30 (2 h from the plan,
  // 30 min paid in cash), then that paid time refunded in cash.
  const { payment: recharge } = ok(await manager.post(`/api/members/${sami.id}/wallet/recharge`, { amount: 60000 * UM, method: 'Espèces' }));
  const plan = server.club.get("SELECT id FROM plans WHERE code = 'MENSUELLE'");
  const sub = ok(await manager.post(`/api/members/${sami.id}/subscriptions`, { plan_id: plan.id, start_date: today }));
  const planPrice = server.club.get('SELECT amount FROM charges WHERE id = ?', sub.charge_id).amount;
  const { payment: byCard } = ok(await manager.post('/api/payments', { charge_ids: [sub.charge_id], card: true }));
  assert.equal(byCard.method, CARD_METHOD);
  const roomId = ok(await manager.get('/api/rooms'))[0].id;
  const day = addDays(today, 1);
  const booked = ok(await manager.post('/api/reservations', {
    member_id: sami.id, room_id: roomId, date: day, start_time: '15:00', duration_min: 150,
  }));
  const timeLine = booked.charges.find((c) => c.kind === 'temps_supplementaire' && c.status === 'due');
  const { payment: inCash } = ok(await manager.post('/api/payments', { charge_ids: [timeLine.id], method: 'Espèces' }));
  ok(await admin.post(`/api/charges/${timeLine.id}/refund`, { reason: 'Geste commercial', method: 'Espèces' }));
  paid = { planPrice, time: timeLine.amount };

  const from = addDays(today, -1);
  const to = addDays(today, 2);
  const s = ok(await statement(sami.id, from, to));
  assert.equal(s.member.id, sami.id);
  assert.equal(s.member.member_no, sami.member_no);
  assert.equal(s.member.phone, sami.phone);
  assert.deepEqual([s.period.from, s.period.to], [from, to]);
  assert.ok(s.issued_at);

  const opening = 10000 * UM;
  const closing = opening + 60000 * UM - planPrice;
  assert.deepEqual(s.summary, {
    balance_start: opening,
    balance_end: closing,
    recharged: 60000 * UM,
    recharge_cancelled: 0,
    card_paid: planPrice,
    card_refunded: 0,
    collected: 60000 * UM + planPrice + timeLine.amount,
    collected_card: planPrice,
    refunded: timeLine.amount,
    due_now: 0,
  });
  assert.equal(closing, server.club.walletBalance(sami.id));

  // The card: the two movements of the period, in order, each with the balance it left and its ticket.
  assert.deepEqual(s.wallet.map((w) => [w.kind, w.amount, w.balance_after, w.number]), [
    ['recharge', 60000 * UM, opening + 60000 * UM, `T-${String(recharge.id).padStart(6, '0')}`],
    ['paiement', -planPrice, closing, `T-${String(byCard.id).padStart(6, '0')}`],
  ]);

  // The payments: the recharge, the plan by card, the paid time in cash, each with its lines.
  assert.deepEqual(s.payments.map((p) => p.id), [recharge.id, byCard.id, inCash.id]);
  assert.equal(s.payments[0].kind, 'recharge');
  assert.equal(s.payments[0].lines.length, 1);
  assert.equal(s.payments[1].card_amount, planPrice);
  assert.match(s.payments[1].lines[0].label, /^Abonnement /);
  assert.equal(s.payments[2].method, 'Espèces');
  assert.equal(s.payments[2].lines[0].charge_id, timeLine.id);
  assert.equal(s.payments[2].number, `T-${String(inCash.id).padStart(6, '0')}`);

  // The refund of the paid time, in cash.
  assert.equal(s.refunds.length, 1);
  assert.deepEqual(
    [s.refunds[0].payment_id, s.refunds[0].amount, s.refunds[0].card_amount, s.refunds[0].method, s.refunds[0].reason],
    [inCash.id, timeLine.amount, 0, 'Espèces', 'Geste commercial'],
  );

  // The booking of tomorrow: 2 h from the plan, 30 min paid.
  assert.equal(s.reservations.length, 1);
  const r = s.reservations[0];
  assert.deepEqual([r.id, r.biz_day, r.duration_min, r.included_minutes, r.paid_minutes, r.status],
    [booked.reservation.id, day, 150, 120, 30, 'reservee']);

  // The plan: attributed, engaged by the booking, still available.
  assert.equal(s.subscription.state, 'active');
  assert.equal(s.subscription.credit.granted, 120);
  assert.equal(s.subscription.credit.available, 0);
  assert.equal(s.subscriptions.length, 1);
  assert.equal(s.subscriptions[0].id, sub.subscription_id);
});

test('relevé : une période sans mouvement garde le solde d’avant, et le premier approvisionnement seul', async () => {
  const empty = ok(await statement(sami.id, addDays(today, -10), addDays(today, -8)));
  assert.deepEqual(empty.summary, {
    balance_start: 0, balance_end: 0, recharged: 0, recharge_cancelled: 0, card_paid: 0, card_refunded: 0,
    collected: 0, collected_card: 0, refunded: 0, due_now: 0,
  });
  for (const key of ['wallet', 'payments', 'refunds', 'reservations', 'subscriptions']) assert.deepEqual(empty[key], [], key);

  // The day of the first recharge alone: from nothing to 10 000 FCFA.
  const first = ok(await statement(sami.id, addDays(today, -3), addDays(today, -3)));
  assert.equal(first.summary.balance_start, 0);
  assert.equal(first.summary.balance_end, 10000 * UM);
  assert.equal(first.summary.recharged, 10000 * UM);
  assert.equal(first.wallet.length, 1);
  assert.equal(first.payments.length, 1);
  assert.equal(first.reservations.length, 0);

  // After the period nothing moved: the opening balance is the closing one of the scenario.
  const later = ok(await statement(sami.id, addDays(today, 5), addDays(today, 6)));
  assert.equal(later.summary.balance_start, 10000 * UM + 60000 * UM - paid.planPrice);
  assert.equal(later.summary.balance_end, later.summary.balance_start);
});

test('relevé : membre inconnu (404), période invalide (400), sans connexion (401)', async () => {
  assert.equal((await statement(999999, today, today)).status, 404);
  assert.equal((await statement(sami.id, today, addDays(today, -1))).status, 400);
  assert.equal((await statement(sami.id, 'hier', today)).status, 400);
  assert.equal((await new Client(server).get(`/api/members/${sami.id}/statement?from=${today}&to=${today}`)).status, 401);
  // Without dates: this month up to today.
  const s = ok(await manager.get(`/api/members/${sami.id}/statement`));
  assert.deepEqual([s.period.from, s.period.to], [`${today.slice(0, 8)}01`, today]);
});
