// The owner's rules on a session's end. An extension asked for (« Prolonger ») stops at the closing time and at
// the next booking, and its paid part (beyond the plan's credit, which stays free) is paid by the member's card,
// in full, at once: an extension the card cannot pay is refused. A session that goes on past its planned end
// without one runs on the holder's time credit, taken at the exit to the minute; what the credit does not cover
// is priced by the minute, paid by the card as far as it goes, the rest left to collect.
import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { Server, Client, ok, UM } from './harness.js';

const MIN = 60000;
let server, admin, manager, today, monthly, room;

beforeEach(async () => {
  server = new Server({}, { lenientTariffs: true });
  await server.start();
  await server.addUser('admin', 'Admin', 'admin', 'ext-admin-password');
  await server.addUser('gerant', 'Gérant', 'gerant', 'ext-manager-password');
  admin = new Client(server);
  manager = new Client(server);
  await admin.login('admin', 'ext-admin-password');
  const bundle = await manager.login('gerant', 'ext-manager-password');
  today = bundle.biz_today;
  monthly = bundle.plans.find((p) => p.code === 'MENSUELLE').id; // 2 hours of credit
  room = bundle.rooms[0];
});
afterEach(() => {
  server.club.at = null;
  server.destroy();
});

// A member with the monthly plan (2 hours of credit) and `card` FCFA on the card.
const enroll = async (first_name, card = 0) => {
  const m = ok(await manager.post('/api/members', { first_name, last_name: 'Test', phone: '+000 000000' }));
  ok(await manager.post(`/api/members/${m.id}/subscriptions`, { plan_id: monthly, start_date: today }));
  if (card) ok(await manager.post(`/api/members/${m.id}/wallet/recharge`, { amount: card * UM, method: 'Espèces' }));
  return m;
};
const book = async (member, duration_min, patch = {}) => ok(await manager.post('/api/reservations', {
  member_id: member.id, room_id: room.id, date: today, start_time: '15:00', duration_min, ...patch,
})).reservation;
const wallet = (m) => server.club.walletBalance(m.id);
const detail = async (id) => ok(await manager.get(`/api/reservations/${id}`));
const refused = (r, code) => {
  assert.equal(r.status, 409, JSON.stringify(r.data));
  assert.equal(r.data.error.code, code);
  return r.data.error;
};
// The holder's credit consumed by a booking, in minutes.
const consumed = (id, subId) => server.club.get(
  "SELECT COALESCE(SUM(minutes), 0) AS n FROM credit_movements WHERE reservation_id = ? AND subscription_id = ? AND kind = 'consommation'", id, subId,
).n;
// Amounts are printed with narrow no-break spaces between thousands.
const plain = (text) => text?.replace(/\s/g, ' ');
const subOf = (m) => server.club.get('SELECT id FROM subscriptions WHERE member_id = ?', m.id).id;

// ---------------------------------------------------------------- « Prolonger »: the card pays

test('prolongation : refusée si la carte ne peut pas la payer, la fenêtre s’arrête à ce que la carte paie', async () => {
  const ana = await enroll('Ana', 15000); // exactly one half hour (15 000 FCFA)
  const r = await book(ana, 120); // all of the credit
  const w = server.club.extensionWindow(r.id);
  assert.deepEqual([w.possible, w.max_minutes, w.until_time, w.reason], [true, 30, '17:30', null]);
  const q = ok(await manager.post(`/api/reservations/${r.id}/extend/quote`, { minutes: 60 }));
  assert.deepEqual([q.card_amount, q.card_balance, q.balance_after, q.card_enough], [25000 * UM, 15000 * UM, -10000 * UM, false]);
  const err = refused(await manager.post(`/api/reservations/${r.id}/extend`, { minutes: 60 }), 'SOLDE_INSUFFISANT');
  assert.equal(plain(err.message), 'Crédit CFA insuffisant sur la carte : 15 000 FCFA disponibles, 25 000 FCFA nécessaires.');
  assert.equal(wallet(ana), 15000 * UM);
  assert.equal((await detail(r.id)).reservation.end_time, '17:00');
  // The half hour the card can pay goes through; then nothing more.
  ok(await manager.post(`/api/reservations/${r.id}/extend`, { minutes: 30 }));
  assert.equal(wallet(ana), 0);
  const after = (await detail(r.id)).extension_window;
  assert.equal(after.possible, false);
  // The next half hour completes the hour: 25 000 less the 15 000 already paid.
  assert.equal(plain(after.reason), 'Prolongation impossible : crédit CFA insuffisant (0 FCFA sur la carte, 10 000 FCFA pour 30 min).');
});

test('prolongation : payée en entier par la carte, rien à encaisser', async () => {
  const ben = await enroll('Ben', 100000);
  const r = await book(ben, 120);
  // An older screen asking for the note is ignored: the card pays.
  const d = ok(await manager.post(`/api/reservations/${r.id}/extend`, { minutes: 60, pay_with_card: false, method: 'Espèces' }));
  assert.equal(wallet(ben), 75000 * UM);
  assert.equal(d.reservation.due_amount, 0);
  assert.equal(d.charges.filter((c) => c.status === 'due').length, 0);
  const line = d.charges.find((c) => c.label.startsWith('Prolongation'));
  assert.equal(line.status, 'payee');
  const payment = d.payments.find((p) => p.allocations.some((a) => a.charge_id === line.id));
  assert.deepEqual([payment.amount, payment.card_amount, payment.method], [25000 * UM, 25000 * UM, 'Carte membre']);
});

test('prolongation : dans le crédit de la formule, gratuite et sans carte', async () => {
  const cleo = await enroll('Cléo'); // nothing on the card
  const r = await book(cleo, 60); // an hour of credit left
  const w = server.club.extensionWindow(r.id);
  assert.deepEqual([w.possible, w.max_minutes, w.credit_minutes, w.credit_until_at], [true, 60, 60, new Date(r.end_ms + 60 * MIN).toISOString()]);
  // Beyond the credit, the empty card is what stops it.
  assert.match(plain(w.beyond_credit_reason), /crédit CFA insuffisant \(0 FCFA sur la carte, 15 000 FCFA pour 30 min\)/);
  const q = ok(await manager.post(`/api/reservations/${r.id}/extend/quote`, { minutes: 60 }));
  assert.deepEqual([q.included_minutes, q.card_amount, q.card_enough], [60, 0, true]);
  const d = ok(await manager.post(`/api/reservations/${r.id}/extend`, { minutes: 60 }));
  assert.deepEqual([d.reservation.end_time, d.reservation.included_minutes, d.reservation.due_amount], ['17:00', 120, 0]);
  assert.equal(d.payments.length, 0);
  refused(await manager.post(`/api/reservations/${r.id}/extend`, { minutes: 30 }), 'SOLDE_INSUFFISANT');
});

test('prolongation : l’heure de fermeture arrête la fenêtre sans un mot', async () => {
  const dan = await enroll('Dan', 1000000);
  const r = await book(dan, 120, { start_time: '22:00' }); // until midnight
  ok(await manager.post(`/api/reservations/${r.id}/extend`, { minutes: 150 })); // until 02:30
  const w = server.club.extensionWindow(r.id);
  assert.deepEqual([w.possible, w.reason], [false, null]);
  refused(await manager.post(`/api/reservations/${r.id}/extend`, { minutes: 30 }), 'FERMETURE');
});

// ---------------------------------------------------------------- past the planned end, at the exit

// Starts the booking at its start time, then finishes it `late` ms after its planned end.
const runAndFinish = async (r, late) => {
  server.club.at = r.start_ms + MIN;
  ok(await manager.post(`/api/reservations/${r.id}/start`));
  server.club.at = r.end_ms + late;
  return ok(await manager.post(`/api/reservations/${r.id}/finish`));
};

test('dépassement : pris sur le crédit temps à la minute, sans rien à payer', async () => {
  const eve = await enroll('Ève');
  const r = await book(eve, 60); // 15:00-16:00, an hour of credit left
  const d = await runAndFinish(r, 39 * MIN + 20000); // 39 min 20 s: a minute started counts, 40 minutes
  assert.deepEqual([d.reservation.end_time, d.reservation.duration_min, d.reservation.included_minutes], ['16:40', 100, 100]);
  assert.deepEqual([d.reservation.paid_minutes, d.reservation.supplement_amount, d.reservation.due_amount], [0, 0, 0]);
  assert.equal(consumed(r.id, subOf(eve)), 100);
  assert.equal(d.charges.length, 0);
  const audit = d.history.find((h) => h.action === 'reservation.depassement');
  assert.deepEqual([audit.details.minutes, audit.details.minutes_incluses, audit.details.montant], [40, 40, 0]);
});

test('dépassement : le crédit d’abord, puis la carte, à la minute', async () => {
  const fay = await enroll('Fay', 100000);
  const r = await book(fay, 90); // 15:00-16:30, 30 minutes of credit left
  const d = await runAndFinish(r, 50 * MIN); // 30 minutes on the credit, 20 paid
  assert.deepEqual([d.reservation.end_time, d.reservation.included_minutes, d.reservation.paid_minutes], ['17:20', 120, 20]);
  // 25 000 FCFA an hour, 20 minutes: 8 333 FCFA, to the franc.
  const price = 8333 * UM;
  assert.equal(wallet(fay), 100000 * UM - price);
  const line = d.charges.find((c) => c.label === 'Dépassement +20 min (temps supplémentaire)');
  assert.deepEqual([line.amount, line.status, line.payment_method], [price, 'payee', 'Carte membre']);
  assert.equal(d.reservation.due_amount, 0);
  assert.equal(consumed(r.id, subOf(fay)), 120);
});

test('dépassement : carte insuffisante, le reste est à encaisser', async () => {
  const gil = await enroll('Gil', 5000);
  const r = await book(gil, 120); // no credit left
  const d = await runAndFinish(r, 20 * MIN); // 8 333 FCFA, 5 000 on the card
  assert.equal(wallet(gil), 0);
  const byCard = d.charges.find((c) => c.label === 'Dépassement +20 min (temps supplémentaire) — payé par carte');
  const rest = d.charges.find((c) => c.label === 'Dépassement +20 min (temps supplémentaire) — reste à encaisser');
  assert.deepEqual([byCard.amount, byCard.status], [5000 * UM, 'payee']);
  assert.deepEqual([rest.amount, rest.status], [3333 * UM, 'due']);
  assert.equal(d.reservation.due_amount, 3333 * UM);
});

test('dépassement : rien quand la séance se termine avant sa fin prévue', async () => {
  const hal = await enroll('Hal', 100000);
  const r = await book(hal, 60);
  const d = await runAndFinish(r, -10 * MIN);
  assert.deepEqual([d.reservation.end_time, d.reservation.duration_min, d.charges.length], ['16:00', 60, 0]);
  assert.equal(wallet(hal), 100000 * UM);
  assert.equal(d.history.some((h) => h.action === 'reservation.depassement'), false);
});

test('dépassement : pris sur le crédit du titulaire, ses invités compris', async () => {
  const ivy = await enroll('Ivy');
  const r = await book(ivy, 60, { party_size: 3 });
  const d = await runAndFinish(r, 30 * MIN);
  assert.equal(d.reservation.end_time, '16:30');
  // The holder is the session's only member: the overtime of the whole party is on the holder's credit.
  assert.equal(consumed(r.id, subOf(ivy)), 90);
  assert.equal(d.reservation.party_size, 3);
});

test('dépassement : arrêté à la séance suivante de la salle, la sortie n’échoue pas', async () => {
  const kim = await enroll('Kim', 100000);
  const lou = await enroll('Lou');
  const r = await book(kim, 120); // 15:00-17:00
  await book(lou, 60, { start_time: '17:30' });
  const d = await runAndFinish(r, 50 * MIN); // stayed until 17:50: recorded until 17:30
  assert.equal(d.reservation.status, 'terminee');
  assert.equal(d.reservation.end_time, '17:30');
  assert.equal(d.reservation.paid_minutes, 30);
});
