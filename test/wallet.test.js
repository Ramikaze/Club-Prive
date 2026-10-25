// Member card, CFA credit: recharges at the till, the administrator's cancellation, the balance that never goes
// below zero and follows the member, the treasury (cash in at the recharge, never revenue), the members' credit
// frozen in the monthly closing, notes and the room paid with the card (refunds and cancellations back to the
// card), the V15 migration and the data reset.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { addDays, addMonths, localToUtcMs } from '../shared/time.js';
import { CARD_METHOD } from '../shared/rules.js';
import { nodeDb } from '../worker/db-node.js';
import { MIGRATIONS } from '../worker/schema.js';
import { Server, Client, ok, UM } from './harness.js';

const server = new Server({});
let admin;
let manager;
let today;
let gerant; // the manager's user row, the actor of direct calls to the business layer

const newMember = async (first_name) => ok(await manager.post('/api/members', { first_name, last_name: 'Carte', phone: '+000 00 00 00 00' }));
const recharge = (memberId, body) => manager.post(`/api/members/${memberId}/wallet/recharge`, body);
const balance = (memberId) => server.club.walletBalance(memberId);
const treasury = async () => ok(await admin.get(`/api/treasury?from=${today}&to=${today}`));
const cash = (t) => t.accounts.find((a) => a.method === 'Espèces') ?? { in: 0, out: 0 };
const refused = (r, status, code) => {
  assert.equal(r.status, status, JSON.stringify(r.data));
  if (code) assert.equal(r.data.error.code, code);
};

before(async () => {
  await server.start();
  await server.addUser('admin', 'Admin', 'admin', 'wallet-admin-password');
  await server.addUser('gerant', 'Gérant', 'gerant', 'wallet-manager-password');
  admin = new Client(server);
  manager = new Client(server);
  await admin.login('admin', 'wallet-admin-password');
  today = (await manager.login('gerant', 'wallet-manager-password')).biz_today;
  gerant = server.club.userByLogin('gerant');
});
after(() => server.destroy());

let alice; // recharged 100 000 FCFA in the first test

test('recharge : le gérant crédite la carte, un encaissement « recharge » sans ligne, avec ticket et journal', async () => {
  alice = await newMember('Alice');
  assert.deepEqual(ok(await manager.get(`/api/members/${alice.id}`)).wallet, { balance: 0, last_recharge: null, movements: [] });
  const r = ok(await recharge(alice.id, { amount: 100000 * UM, method: 'Espèces', reference: 'Reçu 12' }));
  assert.equal(r.wallet.balance, 100000 * UM);
  assert.equal(r.payment.kind, 'recharge');
  assert.equal(r.payment.amount, 100000 * UM);
  assert.equal(r.payment.card_amount, 0);
  assert.equal(r.payment.method, 'Espèces');
  assert.equal(r.payment.cancelled_at, null);
  assert.match(r.payment.ticket_code, /^[A-Z0-9]+$/);
  assert.deepEqual(r.payment.allocations, []);
  assert.equal(server.club.get('SELECT COUNT(*) AS n FROM payment_allocations WHERE payment_id = ?', r.payment.id).n, 0);
  assert.equal(r.wallet.last_recharge.amount, 100000 * UM);
  assert.equal(r.wallet.movements.length, 1);
  const [move] = r.wallet.movements;
  assert.equal(move.kind, 'recharge');
  assert.equal(move.amount, 100000 * UM);
  assert.equal(move.balance_after, 100000 * UM);
  assert.equal(move.by_name, 'Gérant');
  assert.equal(move.payment_id, r.payment.id);

  const detail = ok(await manager.get(`/api/members/${alice.id}`));
  assert.equal(detail.wallet.balance, 100000 * UM);
  assert.equal(detail.payments.find((p) => p.id === r.payment.id).kind, 'recharge');
  const entry = ok(await admin.get('/api/audit')).find((a) => a.action === 'carte.recharger');
  assert.equal(entry.entity_id, alice.id);
  assert.equal(entry.details.montant, 100000 * UM);

  for (const amount of [0, -5000 * UM, 1.5, 'abc', null]) {
    refused(await recharge(alice.id, { amount, method: 'Espèces' }), 400);
  }
  refused(await recharge(alice.id, { amount: 1000 * UM, method: CARD_METHOD }), 400);
  refused(await recharge(alice.id, { amount: 1000 * UM, method: 'Coffre inconnu' }), 400);
  refused(await recharge(alice.id, { amount: 1000 * UM }), 400);
  const gone = await newMember('Bertrand');
  ok(await manager.post(`/api/members/${gone.id}/deactivate`, { reason: 'Parti du club' }));
  refused(await recharge(gone.id, { amount: 1000 * UM, method: 'Espèces' }), 409, 'MEMBRE_DESACTIVE');
  assert.equal(balance(alice.id), 100000 * UM);
});

test('trésorerie : la recharge entre en caisse le jour même, sans être une recette', async () => {
  const member = await newMember('Chloé');
  const before = await treasury();
  const sales = ok(await admin.get(`/api/finance/summary?from=${today}`));
  ok(await recharge(member.id, { amount: 20000 * UM, method: 'Espèces' }));
  const afterwards = await treasury();
  assert.equal(cash(afterwards).in, cash(before).in + 20000 * UM);
  assert.equal(afterwards.total.closing, before.total.closing + 20000 * UM);
  const salesAfter = ok(await admin.get(`/api/finance/summary?from=${today}`));
  assert.equal(salesAfter.total.collected, sales.total.collected);
  assert.equal(afterwards.result.revenue, before.result.revenue);
  // The general ledger agrees with the treasury.
  const book = ok(await admin.get(`/api/ledger/book?from=${today}&to=${today}`));
  assert.equal(book.closing, afterwards.total.closing);
});

test('annulation : réservée à un administrateur, avec motif, sortie de caisse le jour de l’annulation', async () => {
  const member = await newMember('Damien');
  const { payment } = ok(await recharge(member.id, { amount: 30000 * UM, method: 'Espèces' }));
  const before = await treasury();
  refused(await manager.post(`/api/payments/${payment.id}/cancel-recharge`, { reason: 'Erreur de saisie' }), 403);
  refused(await admin.post(`/api/payments/${payment.id}/cancel-recharge`, {}), 400);
  const r = ok(await admin.post(`/api/payments/${payment.id}/cancel-recharge`, { reason: 'Erreur de saisie' }));
  assert.equal(r.wallet.balance, 0);
  assert.equal(r.wallet.movements[0].kind, 'annulation_recharge');
  assert.equal(r.wallet.movements[0].amount, -30000 * UM);
  assert.equal(r.wallet.movements[0].balance_after, 0);
  assert.equal(r.wallet.movements[0].reason, 'Erreur de saisie');
  assert.equal(r.wallet.last_recharge, null); // a cancelled recharge is not the last one
  const afterwards = await treasury();
  assert.equal(cash(afterwards).out, cash(before).out + 30000 * UM);
  assert.equal(cash(afterwards).in, cash(before).in);
  const book = ok(await admin.get(`/api/ledger/book?from=${today}&to=${today}`));
  assert.equal(book.closing, afterwards.total.closing);
  const p = ok(await manager.get(`/api/members/${member.id}`)).payments.find((x) => x.id === payment.id);
  assert.ok(p.cancelled_at);
  assert.equal(p.cancel_reason, 'Erreur de saisie');
  refused(await admin.post(`/api/payments/${payment.id}/cancel-recharge`, { reason: 'Encore' }), 409, 'DEJA_ANNULEE');
  assert.ok(ok(await admin.get('/api/audit')).some((a) => a.action === 'carte.annuler_recharge'));
});

test('jamais négatif : un débit au-delà du solde est refusé, une recharge dépensée ne s’annule pas', async () => {
  const member = await newMember('Émile');
  const { payment } = ok(await recharge(member.id, { amount: 10000 * UM, method: 'Espèces' }));
  server.club.tx(() => server.club.walletMove(gerant, member.id, 'paiement', -6000 * UM, { reason: 'Cigare' }));
  assert.throws(
    () => server.club.tx(() => server.club.walletMove(gerant, member.id, 'paiement', -6000 * UM, { reason: 'Cigare' })),
    (err) => err.code === 'SOLDE_INSUFFISANT',
  );
  assert.equal(balance(member.id), 4000 * UM);
  refused(await admin.post(`/api/payments/${payment.id}/cancel-recharge`, { reason: 'Erreur de saisie' }), 409, 'SOLDE_INSUFFISANT');
  assert.equal(balance(member.id), 4000 * UM);
  assert.equal(server.club.get('SELECT cancelled_at FROM payments WHERE id = ?', payment.id).cancelled_at, null);
});

test('le solde suit le membre : une carte remplacée garde le crédit', async () => {
  const before = ok(await manager.get(`/api/members/${alice.id}`)).wallet;
  const first = ok(await manager.post(`/api/members/${alice.id}/cards`, { kind: 'physique' }));
  ok(await manager.post(`/api/cards/${first.card_id}/deactivate`, { reason: 'Carte perdue' }));
  ok(await manager.post(`/api/members/${alice.id}/cards`, { kind: 'physique' }));
  const afterwards = ok(await manager.get(`/api/members/${alice.id}`)).wallet;
  assert.deepEqual(afterwards, before);
  assert.equal(afterwards.balance, 100000 * UM);
});

test('mois clôturé : une recharge tombant dans un mois clôturé est refusée', async () => {
  server.club.run("INSERT INTO closed_periods (month, closed_at, summary) VALUES (?, ?, '{}')", today.slice(0, 7), new Date().toISOString());
  try {
    refused(await recharge(alice.id, { amount: 1000 * UM, method: 'Espèces' }), 409, 'PERIODE_CLOTUREE');
  } finally {
    server.club.run('DELETE FROM closed_periods WHERE month = ?', today.slice(0, 7));
  }
  assert.equal(balance(alice.id), 100000 * UM);
});

test('réglage : « Carte membre » ne peut pas être un moyen de paiement configuré', async () => {
  refused(await admin.put('/api/settings', { payment_methods: ['Espèces', CARD_METHOD] }), 400);
  refused(await admin.put('/api/settings', { payment_methods: ['Espèces', 'carte MEMBRE'] }), 400);
});

test('crédits des membres : le total dû en consommations, en trésorerie et figé à la clôture', async () => {
  const liabilityBefore = (await treasury()).wallet_liability;
  assert.equal(liabilityBefore, server.club.walletLiability());
  // The two members are recharged in the middle of last month, so that its closing has something to freeze.
  const lastMonth = addMonths(`${today.slice(0, 8)}01`, -1);
  const mid = addDays(lastMonth, 14);
  const first = await newMember('Fanny');
  const second = await newMember('Gilles');
  server.club.at = localToUtcMs(mid, '12:00', server.club.settings().timezone);
  try {
    ok(await recharge(first.id, { amount: 100000 * UM, method: 'Espèces' }));
    ok(await recharge(second.id, { amount: 30000 * UM, method: 'MTN MoMo' }));
    server.club.tx(() => server.club.walletMove(gerant, first.id, 'paiement', -20000 * UM, { reason: 'Consommations' }));
  } finally {
    server.club.at = null;
  }
  assert.equal((await treasury()).wallet_liability, liabilityBefore + 110000 * UM);
  const closings = ok(await admin.post('/api/closings', { month: lastMonth.slice(0, 7) }));
  const closed = closings.closed.find((c) => c.month === lastMonth.slice(0, 7));
  assert.equal(closed.summary.wallet_liability, 110000 * UM);
  // A later recharge does not change the frozen figure.
  ok(await recharge(first.id, { amount: 5000 * UM, method: 'Espèces' }));
  const again = ok(await admin.get('/api/closings')).closed.find((c) => c.month === lastMonth.slice(0, 7));
  assert.equal(again.summary.wallet_liability, 110000 * UM);
  assert.equal((await treasury()).wallet_liability, liabilityBefore + 115000 * UM);
});

// ---------------------------------------------------------------------------- paying a note with the card

// A due line on the member's note, typed straight into the business layer (a bottle or a cigar).
const line = (memberId, account, amount, label = 'Consommation') => server.club.tx(() => server.club.insertCharge(gerant, {
  account, kind: 'produit', member_id: memberId, label, quantity: 1, unit_price: amount,
}));
const pay = (body) => manager.post('/api/payments', body);
const sales = async () => ok(await admin.get(`/api/finance/summary?from=${today}`));
const collected = (s, account) => s.accounts.find((x) => x.account === account).collected;
const byMethod = (s, method) => s.methods.find((x) => x.method === method)?.total ?? 0;
const bookClosing = async () => ok(await admin.get(`/api/ledger/book?from=${today}&to=${today}`)).closing;

test('tout par la carte : la note est réglée par « Carte membre », sans entrée d’argent, recettes sur leurs sous-comptes', async () => {
  const member = await newMember('Fanny');
  ok(await recharge(member.id, { amount: 50000 * UM, method: 'Espèces' }));
  const bottle = line(member.id, 'alcool', 20000 * UM, 'Bouteille');
  const cigar = line(member.id, 'cigares', 10000 * UM, 'Cigare');
  const before = await treasury();
  const salesBefore = await sales();
  const { payment } = ok(await pay({ charge_ids: [bottle, cigar], card: true, method: 'Espèces' }));
  assert.equal(payment.method, CARD_METHOD);
  assert.equal(payment.amount, 30000 * UM);
  assert.equal(payment.card_amount, 30000 * UM);
  assert.equal(balance(member.id), 20000 * UM);
  const move = ok(await manager.get(`/api/members/${member.id}`)).wallet.movements[0];
  assert.equal(move.kind, 'paiement');
  assert.equal(move.amount, -30000 * UM);
  assert.equal(move.payment_id, payment.id);
  const afterwards = await treasury();
  assert.equal(afterwards.total.in, before.total.in);
  assert.equal(afterwards.total.closing, before.total.closing);
  const salesAfter = await sales();
  assert.equal(collected(salesAfter, 'alcool'), collected(salesBefore, 'alcool') + 20000 * UM);
  assert.equal(collected(salesAfter, 'cigares'), collected(salesBefore, 'cigares') + 10000 * UM);
  assert.equal(byMethod(salesAfter, CARD_METHOD), byMethod(salesBefore, CARD_METHOD) + 30000 * UM);
  assert.equal(byMethod(salesAfter, 'Espèces'), byMethod(salesBefore, 'Espèces'));
  assert.equal(await bookClosing(), afterwards.total.closing);
  const entry = ok(await admin.get('/api/audit')).find((a) => a.action === 'carte.payer');
  assert.equal(entry.entity_id, member.id);
  assert.equal(entry.details.payment_id, payment.id);
  assert.equal(entry.details.montant, 30000 * UM);
});

test('carte puis espèces : la carte prend tout son solde, le reste entre en caisse ; sans moyen, rien n’est enregistré', async () => {
  const member = await newMember('Gaston');
  ok(await recharge(member.id, { amount: 5000 * UM, method: 'Espèces' }));
  const bottle = line(member.id, 'alcool', 20000 * UM, 'Bouteille');
  const payments = server.club.get('SELECT COUNT(*) AS n FROM payments').n;
  refused(await pay({ charge_ids: [bottle], card: true }), 400);
  assert.equal(server.club.get('SELECT COUNT(*) AS n FROM payments').n, payments);
  assert.equal(server.club.get('SELECT status FROM charges WHERE id = ?', bottle).status, 'due');
  assert.equal(balance(member.id), 5000 * UM);
  const before = await treasury();
  const salesBefore = await sales();
  const { payment } = ok(await pay({ charge_ids: [bottle], card: true, method: 'Espèces' }));
  assert.equal(payment.method, 'Espèces');
  assert.equal(payment.amount, 20000 * UM);
  assert.equal(payment.card_amount, 5000 * UM);
  assert.equal(balance(member.id), 0);
  const afterwards = await treasury();
  assert.equal(cash(afterwards).in, cash(before).in + 15000 * UM);
  assert.equal(afterwards.total.closing, before.total.closing + 15000 * UM);
  const salesAfter = await sales();
  assert.equal(byMethod(salesAfter, 'Espèces'), byMethod(salesBefore, 'Espèces') + 15000 * UM);
  assert.equal(byMethod(salesAfter, CARD_METHOD), byMethod(salesBefore, CARD_METHOD) + 5000 * UM);
  assert.equal(await bookClosing(), afterwards.total.closing);
});

test('solde nul : « carte » cochée sans crédit, tout passe par le moyen choisi', async () => {
  const member = await newMember('Hélène');
  const bottle = line(member.id, 'alcool', 8000 * UM);
  const moves = server.club.get('SELECT COUNT(*) AS n FROM wallet_movements').n;
  const { payment } = ok(await pay({ charge_ids: [bottle], card: true, method: 'Espèces' }));
  assert.equal(payment.method, 'Espèces');
  assert.equal(payment.card_amount, 0);
  assert.equal(server.club.get('SELECT COUNT(*) AS n FROM wallet_movements').n, moves);
  assert.equal(balance(member.id), 0);
});

test('remboursement : la part payée par la carte retourne sur la carte, le reste sort de la caisse', async () => {
  // A line paid entirely with the card: the balance goes back up, no cash goes out.
  const member = await newMember('Igor');
  ok(await recharge(member.id, { amount: 10000 * UM, method: 'Espèces' }));
  const glass = line(member.id, 'alcool', 6000 * UM, 'Verre');
  ok(await pay({ charge_ids: [glass], card: true }));
  assert.equal(balance(member.id), 4000 * UM);
  let before = await treasury();
  ok(await admin.post(`/api/charges/${glass}/refund`, { reason: 'Verre renversé' }));
  assert.equal(balance(member.id), 10000 * UM);
  let afterwards = await treasury();
  assert.equal(afterwards.total.out, before.total.out);
  assert.equal(afterwards.total.closing, before.total.closing);
  const refund = server.club.get('SELECT * FROM refunds WHERE charge_id = ?', glass);
  assert.equal(refund.card_amount, 6000 * UM);
  assert.equal(refund.method, CARD_METHOD);
  const move = ok(await manager.get(`/api/members/${member.id}`)).wallet.movements[0];
  assert.equal(move.kind, 'remboursement');
  assert.equal(move.amount, 6000 * UM);
  assert.equal(await bookClosing(), afterwards.total.closing);

  // A mixed payment, 5 000 by card and 15 000 in cash over two lines of 10 000.
  const mixed = await newMember('Jeanne');
  ok(await recharge(mixed.id, { amount: 5000 * UM, method: 'Espèces' }));
  const first = line(mixed.id, 'alcool', 10000 * UM, 'Bouteille 1');
  const second = line(mixed.id, 'alcool', 10000 * UM, 'Bouteille 2');
  ok(await pay({ charge_ids: [first, second], card: true, method: 'Espèces' }));
  assert.equal(balance(mixed.id), 0);
  refused(await admin.post(`/api/charges/${first}/refund`, { reason: 'Bouchonnée' }), 400); // the cash part needs a method
  assert.equal(balance(mixed.id), 0);
  before = await treasury();
  ok(await admin.post(`/api/charges/${first}/refund`, { reason: 'Bouchonnée', method: 'Espèces' }));
  assert.equal(balance(mixed.id), 5000 * UM);
  afterwards = await treasury();
  assert.equal(cash(afterwards).out, cash(before).out + 5000 * UM);
  assert.equal(server.club.get('SELECT card_amount FROM refunds WHERE charge_id = ?', first).card_amount, 5000 * UM);
  before = afterwards;
  ok(await admin.post(`/api/charges/${second}/refund`, { reason: 'Bouchonnée', method: 'Espèces' }));
  assert.equal(balance(mixed.id), 5000 * UM);
  afterwards = await treasury();
  assert.equal(cash(afterwards).out, cash(before).out + 10000 * UM);
  assert.equal(server.club.get('SELECT card_amount FROM refunds WHERE charge_id = ?', second).card_amount, 0);
  // The general ledger books only the cash part of the mixed payment and of its refunds.
  assert.equal(await bookClosing(), afterwards.total.closing);
});

test('mois clôturé : un mouvement de carte hors recharge est refusé aussi', async () => {
  const member = await newMember('Karim');
  ok(await recharge(member.id, { amount: 3000 * UM, method: 'Espèces' }));
  server.club.run("INSERT INTO closed_periods (month, closed_at, summary) VALUES (?, ?, '{}')", today.slice(0, 7), new Date().toISOString());
  try {
    assert.throws(
      () => server.club.tx(() => server.club.walletMove(gerant, member.id, 'paiement', -1000 * UM)),
      (err) => err.code === 'PERIODE_CLOTUREE',
    );
  } finally {
    server.club.run('DELETE FROM closed_periods WHERE month = ?', today.slice(0, 7));
  }
  assert.equal(balance(member.id), 3000 * UM);
});

// ---------------------------------------------------------------- the room paid with the card

let roomId;
const book = (body) => manager.post('/api/reservations', { room_id: roomId, start_time: '15:00', ...body });
const quote = (body) => manager.post('/api/reservations/quote', { room_id: roomId, start_time: '15:00', ...body });
const timeLines = (detail) => detail.charges.filter((c) => c.kind === 'temps_supplementaire');
const withPlan = async (first_name) => {
  const member = await newMember(first_name);
  const plan = server.club.get("SELECT id FROM plans WHERE code = 'MENSUELLE'");
  ok(await admin.put(`/api/plans/${plan.id}`, { price_validated: true }));
  ok(await manager.post(`/api/members/${member.id}/subscriptions`, { plan_id: plan.id, start_date: today }));
  return member;
};

test('salle : tarif non validé, la réservation payée par la carte est refusée et la carte intacte', async () => {
  roomId = ok(await manager.get('/api/rooms'))[0].id;
  const member = await newMember('Lucie');
  ok(await recharge(member.id, { amount: 100000 * UM, method: 'Espèces' }));
  refused(await book({ member_id: member.id, date: addDays(today, 1), duration_min: 120, pay_with_card: true }), 409, 'TARIF_NON_VALIDE');
  assert.equal(balance(member.id), 100000 * UM);
  assert.equal(server.club.get('SELECT COUNT(*) AS n FROM reservations WHERE member_id = ?', member.id).n, 0);
  // From here the administrator has validated the tariff: 25 000 FCFA the hour, 15 000 FCFA the half hour left.
  ok(await admin.put('/api/settings', { overtime_tariff: { hour: 25000 * UM, half: 15000 * UM, validated: true } }));
});

test('salle avec abonnement : les heures de la formule d’abord, le reste payé par la carte', async () => {
  const member = await withPlan('Mathis');
  ok(await recharge(member.id, { amount: 100000 * UM, method: 'Espèces' }));
  const body = { member_id: member.id, date: addDays(today, 2), duration_min: 180, pay_with_card: true };
  const q = ok(await quote(body));
  assert.equal(q.included_minutes, 120);
  assert.equal(q.supplement_amount, 25000 * UM);
  assert.equal(q.card_balance, 100000 * UM);
  assert.equal(q.card_amount, 25000 * UM);
  assert.equal(q.rest_amount, 0);
  const d = ok(await book(body));
  assert.equal(d.reservation.included_minutes, 120);
  assert.equal(d.reservation.paid_minutes, 60);
  assert.equal(d.reservation.paid_by_card, 25000 * UM);
  assert.equal(d.reservation.due_amount, 0);
  assert.ok(d.reservation.subscription_id);
  assert.ok(timeLines(d).every((c) => c.status === 'payee'));
  assert.equal(timeLines(d).reduce((sum, c) => sum + c.amount, 0), 25000 * UM);
  assert.equal(balance(member.id), 75000 * UM);
  assert.equal(d.payments.length, 1);
  assert.equal(d.payments[0].method, CARD_METHOD);
  assert.ok(d.credit_movements.some((m) => m.kind === 'engagement' && m.minutes === 120));
});

let nora; // booked 2 hours without a plan, paid by the card; extended in the last test of the room
let noraBooking;

test('salle sans abonnement : réservée si payée par la carte, refusée sinon', async () => {
  nora = await newMember('Nora');
  ok(await recharge(nora.id, { amount: 100000 * UM, method: 'Espèces' }));
  const body = { member_id: nora.id, date: addDays(today, 3), duration_min: 120 };
  refused(await quote(body), 409, 'ABONNEMENT_INVALIDE');
  refused(await book(body), 409, 'ABONNEMENT_INVALIDE');
  const q = ok(await quote({ ...body, pay_with_card: true }));
  assert.equal(q.subscription, null);
  assert.equal(q.included_minutes, 0);
  assert.equal(q.supplement_amount, 50000 * UM);
  assert.equal(q.card_amount, 50000 * UM);
  const d = ok(await book({ ...body, pay_with_card: true }));
  noraBooking = d.reservation;
  assert.equal(d.reservation.subscription_id, null);
  assert.equal(d.subscription, null);
  assert.equal(d.reservation.paid_minutes, 120);
  assert.equal(d.reservation.paid_by_card, 50000 * UM);
  assert.equal(d.reservation.due_amount, 0);
  assert.equal(balance(nora.id), 50000 * UM);
  assert.equal(server.club.get('SELECT COUNT(*) AS n FROM credit_movements WHERE reservation_id = ?', d.reservation.id).n, 0);
  assert.ok(ok(await admin.get('/api/audit')).some((a) => a.action === 'carte.payer' && a.entity_id === nora.id));
});

test('salle, solde insuffisant : la carte paie ce qu’elle a, le reste est à encaisser ou payé par le moyen choisi', async () => {
  const member = await newMember('Oscar');
  ok(await recharge(member.id, { amount: 30000 * UM, method: 'Espèces' }));
  const q = ok(await quote({ member_id: member.id, date: addDays(today, 4), duration_min: 120, pay_with_card: true }));
  assert.equal(q.card_amount, 30000 * UM);
  assert.equal(q.rest_amount, 20000 * UM);
  const d = ok(await book({ member_id: member.id, date: addDays(today, 4), duration_min: 120, pay_with_card: true }));
  assert.equal(balance(member.id), 0);
  assert.equal(d.reservation.paid_by_card, 30000 * UM);
  assert.equal(d.reservation.due_amount, 20000 * UM);
  const lines = timeLines(d);
  assert.deepEqual(lines.map((c) => [c.status, c.amount]), [['payee', 30000 * UM], ['due', 20000 * UM]]);
  assert.match(lines[0].label, / — payé par carte$/);
  assert.match(lines[1].label, / — reste à encaisser$/);
  assert.ok(lines.every((c) => c.quantity === 1 && c.amount === c.unit_price));

  // With a method for the rest, nothing is left to collect.
  ok(await recharge(member.id, { amount: 30000 * UM, method: 'Espèces' }));
  const before = await treasury();
  const paid = ok(await book({ member_id: member.id, date: addDays(today, 5), duration_min: 120, pay_with_card: true, deposit_method: 'Espèces' }));
  assert.equal(paid.reservation.due_amount, 0);
  assert.equal(paid.reservation.paid_by_card, 30000 * UM);
  assert.equal(balance(member.id), 0);
  assert.equal(cash(await treasury()).in, cash(before).in + 20000 * UM);
});

test('salle 3 h ou plus : acompte et solde payés par la carte ; annulée la veille ou absence, l’acompte reste au club, le solde revient', async () => {
  const early = await newMember('Paul');
  ok(await recharge(early.id, { amount: 100000 * UM, method: 'Espèces' }));
  const booked = ok(await book({ member_id: early.id, date: addDays(today, 6), duration_min: 180, pay_with_card: true }));
  assert.equal(booked.reservation.deposit_amount, 37500 * UM);
  assert.deepEqual(timeLines(booked).map((c) => [!!c.deposit, c.status, c.amount]), [[true, 'payee', 37500 * UM], [false, 'payee', 37500 * UM]]);
  assert.equal(balance(early.id), 25000 * UM);
  const before = await treasury();
  const cancelled = ok(await manager.post(`/api/reservations/${booked.reservation.id}/cancel`, { reason: 'Changement de programme' }));
  assert.equal(cancelled.reservation.status, 'annulee');
  // The deposit stays with the club, as when it is paid at the till; only the balance goes back to the card.
  assert.equal(cancelled.deposit_kept, 37500 * UM);
  assert.equal(balance(early.id), 62500 * UM);
  assert.deepEqual(timeLines(cancelled).map((c) => [!!c.deposit, c.status]), [[true, 'payee'], [false, 'remboursee']]);
  assert.equal(cash(await treasury()).out, cash(before).out); // nothing leaves the till
  const moves = ok(await manager.get(`/api/members/${early.id}`)).wallet.movements.filter((m) => m.kind === 'remboursement');
  assert.equal(moves.reduce((sum, m) => sum + m.amount, 0), 37500 * UM);
  assert.ok(ok(await admin.get('/api/audit')).some((a) => a.action === 'carte.rembourser' && a.entity_id === early.id));

  // A card that cannot take the deposit needs a method for the rest, or the booking is not recorded.
  const short = await newMember('Rose');
  ok(await recharge(short.id, { amount: 20000 * UM, method: 'Espèces' }));
  refused(await book({ member_id: short.id, date: addDays(today, 7), duration_min: 180, pay_with_card: true }), 400, 'ACOMPTE_REQUIS');
  assert.equal(balance(short.id), 20000 * UM);

  const absent = await newMember('Quentin');
  ok(await recharge(absent.id, { amount: 100000 * UM, method: 'Espèces' }));
  const tonight = ok(await book({ member_id: absent.id, date: today, start_time: '23:30', duration_min: 180, pay_with_card: true }));
  assert.equal(tonight.reservation.late_cancellation, true);
  assert.equal(balance(absent.id), 25000 * UM);
  const gone = ok(await manager.post(`/api/reservations/${tonight.reservation.id}/cancel`, { reason: 'Membre absent', no_show: true }));
  assert.equal(gone.deposit_kept, 37500 * UM);
  assert.equal(balance(absent.id), 62500 * UM);
  assert.deepEqual(timeLines(gone).map((c) => [!!c.deposit, c.status]), [[true, 'payee'], [false, 'remboursee']]);
});

test('salle, prolongation payée par la carte : la demi-heure en plus est prise sur la carte', async () => {
  const q = ok(await manager.post(`/api/reservations/${noraBooking.id}/extend/quote`, { minutes: 30, pay_with_card: true }));
  assert.equal(q.supplement_delta, 15000 * UM);
  assert.equal(q.card_amount, 15000 * UM);
  refused(await manager.post(`/api/reservations/${noraBooking.id}/extend`, { minutes: 30 }), 409, 'ABONNEMENT_INVALIDE');
  const d = ok(await manager.post(`/api/reservations/${noraBooking.id}/extend`, { minutes: 30, pay_with_card: true }));
  assert.equal(balance(nora.id), 35000 * UM);
  assert.equal(d.reservation.duration_min, 150);
  assert.equal(d.reservation.due_amount, 0);
  assert.equal(d.reservation.paid_by_card, 65000 * UM);
  // The session ends normally: no plan, no credit to consume.
  const done = ok(await manager.post(`/api/reservations/${noraBooking.id}/finish`));
  assert.equal(done.reservation.status, 'terminee');
  assert.equal(done.credit_movements.length, 0);
});

// A database at version 14 holding the harness's own records: built with the first 14 migrations, then filled
// with every row of a database made through the API (the V14 columns of each table).
function v14Copy(sourceFile, file) {
  const db = nodeDb(file);
  db.exec('CREATE TABLE meta (key TEXT PRIMARY KEY, value TEXT NOT NULL)');
  db.transaction(() => {
    for (const statements of MIGRATIONS.slice(0, 14)) for (const statement of statements) db.exec(statement);
    db.run("INSERT INTO meta (key, value) VALUES ('schema_version', '14')");
  });
  db.exec('PRAGMA foreign_keys = OFF');
  db.exec(`ATTACH DATABASE '${sourceFile.replaceAll("'", "''")}' AS src`);
  const tables = db.all("SELECT name FROM main.sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' AND name <> 'meta'");
  db.transaction(() => {
    for (const { name } of tables) {
      const columns = db.all(`PRAGMA main.table_info(${name})`).map((c) => `"${c.name}"`).join(', ');
      db.exec(`INSERT INTO main."${name}" (${columns}) SELECT ${columns} FROM src."${name}"`);
    }
  });
  db.exec('DETACH DATABASE src');
  db.close();
}

const outside = (memberId, body) => manager.post(`/api/members/${memberId}/outside-meal`, body);
const flow = (t, method) => t.accounts.find((a) => a.method === method) ?? { in: 0, out: 0 };

test('repas extérieur couvert : le club paie le livreur, la carte rembourse le même montant, sans recette', async () => {
  const member = await newMember('Ivan');
  ok(await recharge(member.id, { amount: 50000 * UM, method: 'Espèces' }));
  const before = await treasury();
  const salesBefore = await sales();
  const charges = server.club.get('SELECT COUNT(*) AS n FROM charges').n;
  const r = ok(await outside(member.id, { amount: 18500 * UM, label: 'Pizzeria Roma', courier_method: 'Espèces' }));
  assert.equal(r.payment.kind, 'repas');
  assert.equal(r.payment.amount, 18500 * UM);
  assert.equal(r.payment.card_amount, 18500 * UM);
  assert.equal(r.payment.method, CARD_METHOD);
  assert.equal(r.payment.label, 'Pizzeria Roma');
  assert.match(r.payment.ticket_code, /^[A-Z0-9]+$/);
  assert.deepEqual(r.payment.allocations, []);
  assert.equal(r.wallet.balance, 31500 * UM);
  assert.equal(balance(member.id), 31500 * UM);
  assert.equal(r.wallet.movements[0].kind, 'paiement');
  assert.equal(r.wallet.movements[0].amount, -18500 * UM);
  assert.equal(server.club.get('SELECT COUNT(*) AS n FROM charges').n, charges);
  const expense = server.club.get("SELECT e.*, c.name AS cat FROM ledger_entries e JOIN categories c ON c.id = e.category_id ORDER BY e.id DESC LIMIT 1");
  assert.equal(expense.kind, 'depense');
  assert.equal(expense.cat, 'Avance repas client');
  assert.equal(expense.method, 'Espèces');
  assert.equal(expense.amount, 18500 * UM);
  assert.equal(expense.label, 'Repas extérieur — Pizzeria Roma — Ivan Carte');
  const afterwards = await treasury();
  assert.equal(flow(afterwards, 'Espèces').out, flow(before, 'Espèces').out + 18500 * UM);
  assert.equal(flow(afterwards, 'Espèces').in, flow(before, 'Espèces').in);
  assert.equal(afterwards.total.closing, before.total.closing - 18500 * UM);
  const salesAfter = await sales();
  assert.equal(salesAfter.total.collected, salesBefore.total.collected);
  assert.equal(byMethod(salesAfter, CARD_METHOD), byMethod(salesBefore, CARD_METHOD));
  // An advance is no club expense: the result does not move.
  assert.equal(afterwards.result.expenses, before.result.expenses);
  assert.equal(await bookClosing(), afterwards.total.closing);
  const entry = ok(await admin.get('/api/audit')).find((a) => a.action === 'carte.repas');
  assert.equal(entry.entity_id, member.id);
  assert.equal(entry.details.montant, 18500 * UM);
});

test('repas extérieur en partie : la carte paie son solde, le reste par un autre moyen', async () => {
  const member = await newMember('Jeanne');
  ok(await recharge(member.id, { amount: 10000 * UM, method: 'Espèces' }));
  const before = await treasury();
  const payments = server.club.get('SELECT COUNT(*) AS n FROM payments').n;
  const entries = server.club.get('SELECT COUNT(*) AS n FROM ledger_entries').n;
  const body = { amount: 18500 * UM, label: 'Chez Fatou', courier_method: 'Espèces' };
  refused(await outside(member.id, body), 400);
  refused(await outside(member.id, { ...body, rest_method: CARD_METHOD }), 400);
  refused(await outside(member.id, { ...body, rest_method: 'Coffre inconnu' }), 400);
  assert.equal(server.club.get('SELECT COUNT(*) AS n FROM payments').n, payments);
  assert.equal(server.club.get('SELECT COUNT(*) AS n FROM ledger_entries').n, entries);
  assert.equal(balance(member.id), 10000 * UM);
  const r = ok(await outside(member.id, { ...body, rest_method: 'MTN MoMo' }));
  assert.equal(r.payment.method, 'MTN MoMo');
  assert.equal(r.payment.card_amount, 10000 * UM);
  assert.equal(r.payment.amount, 18500 * UM);
  assert.equal(r.wallet.balance, 0);
  const afterwards = await treasury();
  assert.equal(flow(afterwards, 'MTN MoMo').in, flow(before, 'MTN MoMo').in + 8500 * UM);
  assert.equal(flow(afterwards, 'Espèces').out, flow(before, 'Espèces').out + 18500 * UM);
  assert.equal(afterwards.total.closing, before.total.closing - 10000 * UM);
  assert.equal(await bookClosing(), afterwards.total.closing);
});

test('repas extérieur : montant nul ou négatif, moyen du livreur inconnu, membre désactivé sont refusés', async () => {
  const member = await newMember('Karim');
  ok(await recharge(member.id, { amount: 20000 * UM, method: 'Espèces' }));
  const payments = server.club.get('SELECT COUNT(*) AS n FROM payments').n;
  for (const amount of [0, -1000 * UM, 1.5, 'abc', null]) {
    refused(await outside(member.id, { amount, label: 'Test', courier_method: 'Espèces' }), 400);
  }
  refused(await outside(member.id, { amount: 1000 * UM, label: 'Test', courier_method: CARD_METHOD }), 400);
  refused(await outside(member.id, { amount: 1000 * UM, label: 'Test' }), 400);
  refused(await outside(member.id, { amount: 1000 * UM, courier_method: 'Espèces' }), 400);
  assert.equal(server.club.get('SELECT COUNT(*) AS n FROM payments').n, payments);
  assert.equal(balance(member.id), 20000 * UM);
  ok(await manager.post(`/api/members/${member.id}/deactivate`, { reason: 'Parti du club' }));
  refused(await outside(member.id, { amount: 1000 * UM, label: 'Test', courier_method: 'Espèces' }), 409, 'MEMBRE_DESACTIVE');
});

test('catégorie des repas : elle ne se renomme ni ne se désactive, aucune dépense à la main dessus, et son absence est une erreur claire', async () => {
  const cat = server.club.get("SELECT * FROM categories WHERE name = 'Avance repas client'");
  assert.ok(cat);
  refused(await admin.put(`/api/ledger/categories/${cat.id}`, { name: 'Autre nom' }), 409, 'CATEGORIE_PROTEGEE');
  refused(await admin.put(`/api/ledger/categories/${cat.id}`, { active: false }), 409, 'CATEGORIE_PROTEGEE');
  refused(await admin.post('/api/ledger/entries', { kind: 'depense', category_id: cat.id, method: 'Espèces', amount: 1000 * UM }), 400);
  assert.equal(server.club.get('SELECT name, active FROM categories WHERE id = ?', cat.id).name, 'Avance repas client');
  const member = await newMember('Lucie');
  ok(await recharge(member.id, { amount: 5000 * UM, method: 'Espèces' }));
  server.club.run('UPDATE categories SET name = ? WHERE id = ?', 'Renommée de force', cat.id);
  try {
    refused(await outside(member.id, { amount: 1000 * UM, label: 'Test', courier_method: 'Espèces' }), 409, 'CATEGORIE_REPAS_ABSENTE');
    assert.equal(balance(member.id), 5000 * UM);
  } finally {
    server.club.run('UPDATE categories SET name = ? WHERE id = ?', 'Avance repas client', cat.id);
  }
});

test('annulation d’un repas extérieur : réservée à un administrateur, la carte et la caisse reviennent, les clôtures restent égales', async () => {
  const member = await newMember('Marc');
  ok(await recharge(member.id, { amount: 10000 * UM, method: 'Espèces' }));
  const { payment } = ok(await outside(member.id, { amount: 18500 * UM, label: 'Chez Awa', courier_method: 'Espèces', rest_method: 'MTN MoMo' }));
  assert.equal(balance(member.id), 0);
  const before = await treasury();
  refused(await manager.post(`/api/payments/${payment.id}/cancel-meal`, { reason: 'Erreur de saisie' }), 403);
  refused(await admin.post(`/api/payments/${payment.id}/cancel-meal`, {}), 400);
  const recharged = server.club.get("SELECT id FROM payments WHERE member_id = ? AND kind = 'recharge'", member.id).id;
  refused(await admin.post(`/api/payments/${recharged}/cancel-meal`, { reason: 'Erreur de saisie' }), 409, 'PAS_UN_REPAS');
  const r = ok(await admin.post(`/api/payments/${payment.id}/cancel-meal`, { reason: 'Erreur de saisie' }));
  assert.equal(r.wallet.balance, 10000 * UM);
  assert.equal(balance(member.id), 10000 * UM);
  assert.ok(r.payment.cancelled_at);
  assert.equal(r.wallet.movements[0].kind, 'remboursement');
  refused(await admin.post(`/api/payments/${payment.id}/cancel-meal`, { reason: 'Encore' }), 409, 'DEJA_ANNULEE');
  const expense = server.club.get("SELECT status, cancel_reason FROM ledger_entries WHERE reference = ?", `ENC-${payment.id}`);
  assert.equal(expense.status, 'annulee');
  assert.equal(expense.cancel_reason, 'Erreur de saisie');
  const afterwards = await treasury();
  // The courier's pay is back in the till and the MoMo share leaves on the cancellation day.
  assert.equal(afterwards.total.closing, before.total.closing + 18500 * UM - 8500 * UM);
  assert.equal(await bookClosing(), afterwards.total.closing);
  assert.equal(afterwards.result.expenses, before.result.expenses);
  assert.ok(ok(await admin.get('/api/audit')).some((a) => a.action === 'carte.annuler_repas' && a.entity_id === member.id));
});

// ---------------------------------------------------------------------------- automatic renewal from the card

// The business clock moved to `day` at noon, the club's time: what the scheduled run or a request made that day sees.
const atDay = (day) => { server.club.at = localToUtcMs(day, '12:00', server.club.settings().timezone); };
const planId = (code) => server.club.get('SELECT id FROM plans WHERE code = ?', code).id;
// A new member whose subscription to the plan `code` starts today: the member and the subscription's last day.
const subscribed = async (first_name, code = 'MENSUELLE') => {
  const member = await newMember(first_name);
  const r = ok(await manager.post(`/api/members/${member.id}/subscriptions`, { plan_id: planId(code), start_date: today }));
  return { member, end: r.end_date };
};
// The renewal run for one member, in its transaction, on the business day of the clock.
const renew = (memberId) => server.club.tx(() => server.club.runRenewals(undefined, memberId));
const subscriptionsOf = (memberId) => server.club.all('SELECT * FROM subscriptions WHERE member_id = ? ORDER BY start_date', memberId);
const renewalOf = async (memberId) => ok(await manager.get(`/api/members/${memberId}`)).renewal;

test('renouvellement à l’heure : la formule finie hier est reprise sur la carte, sans action du gérant', async () => {
  ok(await admin.put(`/api/plans/${planId('MENSUELLE')}`, { price: 50000 * UM, price_validated: true }));
  const { member, end } = await subscribed('Nadia');
  ok(await recharge(member.id, { amount: 60000 * UM, method: 'Espèces' }));
  const day = addDays(end, 1);
  atDay(day);
  try {
    const r = renew(member.id);
    assert.equal(r.renewed.length, 1);
    assert.deepEqual(r.blocked, []);
    const sub = server.club.get('SELECT * FROM subscriptions WHERE id = ?', r.renewed[0]);
    assert.equal(sub.member_id, member.id);
    assert.equal(sub.start_date, day);
    assert.equal(sub.end_date, addDays(addMonths(day, 1), -1));
    assert.equal(sub.plan_id, planId('MENSUELLE'));
    assert.equal(sub.included_minutes, 120);
    assert.equal(sub.price, 50000 * UM);
    assert.equal(sub.created_by, null);
    assert.equal(balance(member.id), 10000 * UM);
    const charge = server.club.get('SELECT * FROM charges WHERE subscription_id = ?', sub.id);
    assert.equal(charge.status, 'payee');
    assert.equal(charge.amount, 50000 * UM);
    assert.equal(charge.created_by, null);
    const payment = server.club.get(
      'SELECT p.* FROM payments p JOIN payment_allocations pa ON pa.payment_id = p.id WHERE pa.charge_id = ?', charge.id,
    );
    assert.equal(payment.method, CARD_METHOD);
    assert.equal(payment.card_amount, 50000 * UM);
    assert.equal(payment.created_by, null);
    assert.match(payment.ticket_code, /^[A-Z0-9]+$/);
    const detail = ok(await manager.get(`/api/members/${member.id}`));
    assert.equal(detail.subscription.state, 'active');
    assert.equal(detail.subscription.id, sub.id);
    assert.equal(detail.subscription.credit.available, 120);
    assert.equal(detail.renewal, null);
    const entry = ok(await admin.get('/api/audit')).find((a) => a.action === 'abonnement.renouveler_auto' && a.entity_id === member.id);
    assert.equal(entry.user_id, null);
    assert.equal(entry.details.subscription_id, sub.id);
    assert.equal(entry.details.payment_id, payment.id);
    assert.equal(entry.details.solde, 10000 * UM);
  } finally {
    server.club.at = null;
  }
});

test('renouvellement idempotent : trois passages, un seul abonnement et un seul débit', async () => {
  const { member, end } = await subscribed('Octave');
  ok(await recharge(member.id, { amount: 120000 * UM, method: 'Espèces' }));
  atDay(addDays(end, 1));
  try {
    assert.equal(renew(member.id).renewed.length, 1);
    assert.deepEqual(renew(member.id), { renewed: [], blocked: [] });
    // The scheduled run goes through the API's own entry point, in its own transaction, for every member.
    server.api.runRenewals();
    assert.equal(subscriptionsOf(member.id).length, 2);
    assert.equal(server.club.get("SELECT COUNT(*) AS n FROM wallet_movements WHERE member_id = ? AND kind = 'paiement'", member.id).n, 1);
    assert.equal(balance(member.id), 70000 * UM);
  } finally {
    server.club.at = null;
  }
});

test('renouvellement bloqué : rien n’est pris, alerte sur la fiche et l’accueil ; la recharge suivante renouvelle du jour même', async () => {
  const { member, end } = await subscribed('Pauline');
  ok(await recharge(member.id, { amount: 30000 * UM, method: 'Espèces' }));
  atDay(addDays(end, 1));
  try {
    assert.deepEqual(renew(member.id), { renewed: [], blocked: [member.id] });
    assert.equal(subscriptionsOf(member.id).length, 1);
    assert.equal(balance(member.id), 30000 * UM);
    assert.deepEqual(await renewalOf(member.id), {
      state: 'bloque', plan_name: 'Mensuelle — 2 heures', price: 50000 * UM, balance: 30000 * UM, missing: 20000 * UM, end_date: end,
    });
    // The home page runs the renewals itself (the demo space has no scheduled run) and lists the alert.
    const alert = ok(await manager.get('/api/dashboard')).renewal_alerts.find((a) => a.member_id === member.id);
    assert.equal(alert.state, 'bloque');
    assert.equal(alert.missing, 20000 * UM);
    assert.equal(alert.member_name, 'Pauline Carte');
    assert.equal(alert.phone_ok, false);
    assert.equal(subscriptionsOf(member.id).length, 1);

    // Nine days later the member tops up what was missing: the new subscription starts on the day of the recharge.
    const day = addDays(end, 10);
    atDay(day);
    const r = ok(await recharge(member.id, { amount: 20000 * UM, method: 'Espèces' }));
    assert.equal(r.wallet.balance, 0);
    assert.equal(balance(member.id), 0);
    const subs = subscriptionsOf(member.id);
    assert.equal(subs.length, 2);
    assert.equal(subs[1].start_date, day);
    assert.equal(subs[1].end_date, addDays(addMonths(day, 1), -1));
    assert.equal(await renewalOf(member.id), null);
    assert.ok(!ok(await manager.get('/api/dashboard')).renewal_alerts.some((a) => a.member_id === member.id));
  } finally {
    server.club.at = null;
  }
});

test('délai dépassé : une recharge 31 jours après l’échéance ne renouvelle plus, l’alerte a disparu', async () => {
  const { member, end } = await subscribed('Quentin');
  atDay(addDays(end, 31));
  try {
    assert.equal(await renewalOf(member.id), null);
    ok(await recharge(member.id, { amount: 60000 * UM, method: 'Espèces' }));
    assert.equal(subscriptionsOf(member.id).length, 1);
    assert.equal(balance(member.id), 60000 * UM);
    assert.equal(await renewalOf(member.id), null);
    assert.ok(!ok(await manager.get('/api/dashboard')).renewal_alerts.some((a) => a.member_id === member.id));
  } finally {
    server.club.at = null;
  }
});

test('bientôt : prévenu 3 jours avant l’échéance quand le crédit ne suffira pas', async () => {
  const { member, end } = await subscribed('Rose');
  try {
    atDay(addDays(end, -2));
    assert.deepEqual(await renewalOf(member.id), {
      state: 'bientot', plan_name: 'Mensuelle — 2 heures', price: 50000 * UM, balance: 0, missing: 50000 * UM, end_date: end,
    });
    assert.equal(ok(await manager.get('/api/dashboard')).renewal_alerts.find((a) => a.member_id === member.id).state, 'bientot');
    atDay(addDays(end, -4));
    assert.equal(await renewalOf(member.id), null);
    // Enough credit: nothing to warn about.
    atDay(addDays(end, -2));
    ok(await recharge(member.id, { amount: 50000 * UM, method: 'Espèces' }));
    assert.equal(await renewalOf(member.id), null);
    assert.equal(subscriptionsOf(member.id).length, 1);
  } finally {
    server.club.at = null;
  }
});

test('abonnement annulé par l’administrateur : jamais renouvelé', async () => {
  const { member, end } = await subscribed('Samuel');
  ok(await recharge(member.id, { amount: 60000 * UM, method: 'Espèces' }));
  const [sub] = subscriptionsOf(member.id);
  ok(await admin.post(`/api/subscriptions/${sub.id}/cancel`, { reason: 'Le membre arrête' }));
  atDay(addDays(end, 1));
  try {
    assert.deepEqual(renew(member.id), { renewed: [], blocked: [] });
    ok(await recharge(member.id, { amount: 1000 * UM, method: 'Espèces' }));
    assert.equal(subscriptionsOf(member.id).length, 1);
    assert.equal(balance(member.id), 61000 * UM);
    assert.equal(await renewalOf(member.id), null);
  } finally {
    server.club.at = null;
  }
});

test('formule annuelle : renouvelée en annuelle, à son prix', async () => {
  ok(await admin.put(`/api/plans/${planId('ANNUELLE')}`, { price: 500000 * UM, price_validated: true }));
  const { member, end } = await subscribed('Thierry', 'ANNUELLE');
  ok(await recharge(member.id, { amount: 500000 * UM, method: 'Espèces' }));
  const day = addDays(end, 1);
  atDay(day);
  try {
    const [id] = renew(member.id).renewed;
    const sub = server.club.get('SELECT * FROM subscriptions WHERE id = ?', id);
    assert.equal(sub.plan_id, planId('ANNUELLE'));
    assert.equal(sub.duration_months, 12);
    assert.equal(sub.included_minutes, 1440);
    assert.equal(sub.start_date, day);
    assert.equal(sub.end_date, addDays(addMonths(day, 12), -1));
    assert.equal(server.club.get('SELECT amount FROM charges WHERE subscription_id = ?', id).amount, 500000 * UM);
    assert.equal(balance(member.id), 0);
  } finally {
    server.club.at = null;
  }
});

// ---------------------------------------------------------------------------- the card's cash receipt

const ticketOf = async (paymentId) => ok(await manager.get(`/api/payments/${paymentId}/ticket`)).ticket;
const publicOf = (paymentId) => {
  const { ticket_code: code } = server.club.get('SELECT ticket_code FROM payments WHERE id = ?', paymentId);
  return server.club.publicTicket(paymentId, code);
};
const PUBLIC_KEYS = ['club_name', 'currency', 'initials', 'lines', 'method', 'number', 'paid_at', 'refunded_amount', 'status', 'timezone', 'total'];

test('ticket d’une recharge : une ligne, solde juste après elle, signature ; annulée, « annule » partout', async () => {
  const member = await newMember('Victor');
  const first = ok(await recharge(member.id, { amount: 100000 * UM, method: 'Espèces' })).payment;
  const second = ok(await recharge(member.id, { amount: 50000 * UM, method: 'Espèces' })).payment;
  const t = await ticketOf(first.id);
  assert.equal(t.kind, 'recharge');
  assert.equal(t.card_amount, 0);
  assert.equal(t.label, 'Recharge de la carte membre');
  assert.deepEqual(t.allocations, []);
  assert.equal(t.wallet_balance_after, 100000 * UM); // not the 150 000 of today
  assert.equal(t.time_available, null); // no subscription
  assert.equal(t.signature_required, true);
  assert.equal(t.status, 'valide');
  assert.equal((await ticketOf(second.id)).wallet_balance_after, 150000 * UM);

  const pub = publicOf(first.id);
  assert.deepEqual(Object.keys(pub).sort(), PUBLIC_KEYS);
  assert.deepEqual(pub.lines, [{ label: 'Recharge carte membre', quantity: 1, amount: 100000 * UM }]);
  assert.equal(pub.status, 'valide');
  assert.doesNotMatch(JSON.stringify(pub), /150000|Victor|\+000/);

  ok(await admin.post(`/api/payments/${second.id}/cancel-recharge`, { reason: 'Erreur de montant' }));
  const cancelled = await ticketOf(second.id);
  assert.equal(cancelled.status, 'annule');
  assert.ok(cancelled.cancelled_at);
  assert.equal(cancelled.wallet_balance_after, 150000 * UM); // the balance the recharge left, as printed then
  assert.equal(publicOf(second.id).status, 'annule');
  assert.equal((await ticketOf(first.id)).status, 'valide');
});

test('ticket d’un paiement mixte : part de la carte, reste et son moyen, solde et crédit temps ; espèces seules sans signature', async () => {
  const { member } = await subscribed('Wanda');
  ok(await recharge(member.id, { amount: 5000 * UM, method: 'Espèces' }));
  const bottle = line(member.id, 'alcool', 20000 * UM, 'Bouteille');
  const { payment } = ok(await pay({ charge_ids: [bottle], card: true, method: 'Espèces' }));
  ok(await recharge(member.id, { amount: 7000 * UM, method: 'Espèces' })); // later: not on this ticket
  const t = await ticketOf(payment.id);
  assert.equal(t.kind, 'encaissement');
  assert.equal(t.card_amount, 5000 * UM);
  assert.equal(t.amount, 20000 * UM);
  assert.equal(t.method, 'Espèces');
  assert.equal(t.wallet_balance_after, 0);
  const credit = ok(await manager.get(`/api/members/${member.id}`)).subscription.credit.available;
  assert.ok(credit > 0);
  assert.equal(t.time_available, credit);
  assert.equal(t.signature_required, true);
  assert.equal(t.allocations[0].label, 'Bouteille');
  assert.equal(publicOf(payment.id).method, 'Espèces');
  assert.deepEqual(Object.keys(publicOf(payment.id)).sort(), PUBLIC_KEYS);

  // Paid in cash only: the card is not involved, so no balance and nothing to sign.
  const glass = line(member.id, 'alcool', 3000 * UM, 'Verre');
  const cashOnly = ok(await pay({ charge_ids: [glass], method: 'Espèces' })).payment;
  const c = await ticketOf(cashOnly.id);
  assert.equal(c.card_amount, 0);
  assert.equal(c.wallet_balance_after, null);
  assert.equal(c.signature_required, false);
});

test('ticket d’un repas extérieur : son libellé, la part de la carte, signature ; annulé, « annule »', async () => {
  const member = await newMember('Xavier');
  ok(await recharge(member.id, { amount: 10000 * UM, method: 'Espèces' }));
  const { payment } = ok(await outside(member.id, { amount: 18500 * UM, label: 'Chez Fatou', courier_method: 'Espèces', rest_method: 'MTN MoMo' }));
  const t = await ticketOf(payment.id);
  assert.equal(t.kind, 'repas');
  assert.equal(t.label, 'Chez Fatou');
  assert.equal(t.card_amount, 10000 * UM);
  assert.equal(t.method, 'MTN MoMo');
  assert.equal(t.wallet_balance_after, 0);
  assert.equal(t.time_available, null);
  assert.equal(t.signature_required, true);
  assert.equal(t.status, 'valide');
  assert.deepEqual(publicOf(payment.id).lines, [{ label: 'Chez Fatou', quantity: 1, amount: 18500 * UM }]);

  ok(await admin.post(`/api/payments/${payment.id}/cancel-meal`, { reason: 'Erreur de saisie' }));
  const cancelled = await ticketOf(payment.id);
  assert.equal(cancelled.status, 'annule');
  assert.equal(cancelled.wallet_balance_after, 0); // the card's money came back later, not on this receipt
  assert.equal(publicOf(payment.id).status, 'annule');

  // A meal the card could not pay at all still shows the card's balance then, and is signed.
  const broke = await newMember('Yvette');
  const meal = ok(await outside(broke.id, { amount: 5000 * UM, label: 'Chez Awa', courier_method: 'Espèces', rest_method: 'Espèces' })).payment;
  const m = await ticketOf(meal.id);
  assert.equal(m.card_amount, 0);
  assert.equal(m.wallet_balance_after, 0);
  assert.equal(m.signature_required, true);
});

test('ticket d’un renouvellement automatique : payé par la carte, solde après, sans signature', async () => {
  const { member, end } = await subscribed('Zoé');
  ok(await recharge(member.id, { amount: 60000 * UM, method: 'Espèces' }));
  atDay(addDays(end, 1));
  try {
    const [subscriptionId] = renew(member.id).renewed;
    const { id } = server.club.get(
      `SELECT p.id FROM payments p JOIN payment_allocations pa ON pa.payment_id = p.id
       JOIN charges c ON c.id = pa.charge_id WHERE c.subscription_id = ?`, subscriptionId,
    );
    const t = await ticketOf(id);
    assert.equal(t.method, CARD_METHOD);
    assert.equal(t.card_amount, 50000 * UM);
    assert.equal(t.created_by_name, null);
    assert.equal(t.wallet_balance_after, 10000 * UM);
    assert.equal(t.time_available, 120);
    assert.equal(t.signature_required, false);
  } finally {
    server.club.at = null;
  }
});

test('migration sans perte : V15 garde réservations, crédits et lignes, et rend l’abonnement facultatif', async () => {
  const source = new Server({}, { lenientTariffs: true });
  const old = new Server({});
  try {
    await source.start();
    await source.addUser('gerant', 'Gérant', 'gerant', 'wallet-manager-password');
    const g = new Client(source);
    const bundle = await g.login('gerant', 'wallet-manager-password');
    const day = addDays(bundle.biz_today, 1);
    const member = ok(await g.post('/api/members', { first_name: 'Hugo', last_name: 'Migration', phone: '+000 00 00 00 00' }));
    const plan = bundle.plans.find((p) => p.code === 'MENSUELLE');
    const sub = ok(await g.post(`/api/members/${member.id}/subscriptions`, { plan_id: plan.id, start_date: bundle.biz_today }));
    ok(await g.post('/api/payments', { charge_ids: [sub.charge_id], method: 'Espèces' }));
    const room = bundle.rooms[0];
    // 3 hours: 2 hours of credit engaged, 1 paid hour with its deposit taken now.
    ok(await g.post('/api/reservations', {
      member_id: member.id, room_id: room.id, date: day, start_time: '15:00', duration_min: 180, party_size: 3, deposit_method: 'Espèces',
    }));
    const snapshot = (db, table) => db.all(`SELECT * FROM ${table} ORDER BY id`);
    const tables = ['reservations', 'credit_movements', 'charges', 'payments', 'payment_allocations'];
    const expected = Object.fromEntries(tables.map((t) => [t, snapshot(source.db, t)]));
    assert.equal(expected.reservations.length, 1);
    assert.ok(expected.reservations[0].deposit_amount > 0);
    assert.equal(expected.reservations[0].party_size, 3);
    assert.ok(expected.credit_movements.some((m) => m.kind === 'engagement'));
    assert.ok(expected.charges.length >= 3);

    v14Copy(source.file, old.file);
    const v14 = nodeDb(old.file);
    assert.equal(v14.all('PRAGMA table_info(reservations)').find((c) => c.name === 'subscription_id').notnull, 1);
    v14.close();

    await old.start(); // migrates to the last version
    assert.equal(old.db.get("SELECT value FROM meta WHERE key = 'schema_version'").value, String(MIGRATIONS.length));
    assert.equal(old.db.all('PRAGMA table_info(reservations)').find((c) => c.name === 'subscription_id').notnull, 0);
    for (const t of ['reservations', 'credit_movements', 'charges']) assert.deepEqual(snapshot(old.db, t), expected[t], t);
    for (const p of snapshot(old.db, 'payments')) {
      assert.equal(p.kind, 'encaissement');
      assert.equal(p.card_amount, 0);
    }
    assert.deepEqual(old.db.all('PRAGMA foreign_key_check'), []);
    const indexes = old.db.all("SELECT name FROM sqlite_master WHERE type = 'index' AND tbl_name = 'reservations'").map((i) => i.name);
    for (const i of ['reservations_time', 'reservations_day', 'reservations_member', 'reservations_room']) assert.ok(indexes.includes(i), i);
    assert.equal(old.db.get("SELECT COUNT(*) AS n FROM sqlite_master WHERE name LIKE 'reservations_v1%'").n, 0);

    // A booking without a plan is now possible; the overlap triggers still guard the room.
    const r = expected.reservations[0];
    const insert = (startMs, endMs) => old.db.run(
      `INSERT INTO reservations (member_id, subscription_id, room_id, party_size, biz_day, start_ms, end_ms, duration_min, status,
         included_minutes, paid_minutes, supplement_amount, tariff_hour, tariff_half, tariff_validated, created_at)
       VALUES (?, NULL, ?, 1, ?, ?, ?, ?, 'reservee', 0, ?, 0, 0, 0, 1, ?)`,
      member.id, room.id, r.biz_day, startMs, endMs, (endMs - startMs) / 60000, (endMs - startMs) / 60000, new Date().toISOString(),
    );
    const later = insert(r.end_ms + 3600000, r.end_ms + 7200000).lastId;
    assert.equal(old.db.get('SELECT subscription_id FROM reservations WHERE id = ?', later).subscription_id, null);
    assert.throws(() => insert(r.start_ms + 1800000, r.start_ms + 5400000), /CHEVAUCHEMENT/);
    assert.throws(
      () => old.db.run('UPDATE reservations SET start_ms = ?, end_ms = ? WHERE id = ?', r.start_ms, r.end_ms, later),
      /CHEVAUCHEMENT/,
    );
  } finally {
    source.destroy();
    old.destroy();
  }
});

test('effacer toutes les données vide aussi les mouvements de carte', async () => {
  assert.ok(server.club.get('SELECT COUNT(*) AS n FROM wallet_movements').n > 0);
  ok(await admin.post('/api/admin/reset', { confirm: 'EFFACER' }));
  assert.equal(server.club.get('SELECT COUNT(*) AS n FROM wallet_movements').n, 0);
  assert.equal(server.club.walletLiability(), 0);
});
