// Reservation requests of the client space: a member asks for a slot, the staff confirms it with the usual booking
// (gap, deposit for 3 h or more, tariffs) or refuses it with a message. A client never learns who holds a slot.
import { test, before, beforeEach, after } from 'node:test';
import assert from 'node:assert/strict';
import { Server, Client, ok, UM } from './harness.js';
import { addDays, localParts } from '../shared/time.js';

const server = new Server({}, { lenientTariffs: true });
const PASSWORD = 'mon-mot-de-passe-client';
let admin;
let ger;
let cig;
let plan;
let today;
let day; // the day requests are made for: far enough from now for the one-hour lead never to matter
let dayNo = 2;
let n = 0;

const refused = (r, status, code) => {
  assert.equal(r.status, status, JSON.stringify(r.data));
  assert.equal(r.data.error.code, code);
};
const row = (id) => server.club.get('SELECT * FROM reservation_requests WHERE id = ?', id);
const ask = (who, patch = {}) => who.client.post('/api/client/reservation-requests', { date: day, start_time: '15:00', duration_min: 60, party_size: 2, ...patch });
const slotsOf = async (who, query) => ok(await who.client.get(`/api/client/slots?${new URLSearchParams({ date: day, duration_min: 60, party_size: 1, ...query })}`)).slots;

// A member (or regular client) with a client access, signed in on a client of his own; members get a card, 2 h of plan.
async function person(kind = 'membre', { balance = 0 } = {}) {
  n += 1;
  const phone = `06 6${String(n).padStart(2, '0')} 00 00`;
  const m = ok(await ger.post(kind === 'client' ? '/api/clients' : '/api/members', { first_name: 'awa', last_name: `demande${n}`, phone }));
  if (kind === 'membre' && balance) ok(await ger.post(`/api/members/${m.id}/wallet/recharge`, { amount: balance, method: 'Espèces' }));
  const { code } = ok(await admin.post(`/api/members/${m.id}/client-access`, {}));
  const client = new Client(server);
  ok(await client.post('/api/client/login', { login: phone, password: code }));
  ok(await client.post('/api/client/password', { new_password: PASSWORD }));
  return { member: m, client };
}
const confirm = (who, request, patch = {}) => ger.post('/api/reservations', {
  member_id: who.member.id, date: request.date, start_time: request.start_time, duration_min: request.duration_min,
  party_size: request.party_size, request_id: request.id, pay_with_card: true, ...patch,
});

before(async () => {
  await server.start();
  await server.addUser('admin', 'Propriétaire', 'admin', 'req-admin-password');
  await server.addUser('ger', 'Gérant', 'gerant', 'req-ger-password');
  await server.addUser('cig', 'Associé cigares', 'associe', 'req-cig-password', 'cigares');
  admin = new Client(server);
  ger = new Client(server);
  cig = new Client(server);
  const bundle = await admin.login('admin', 'req-admin-password');
  await ger.login('ger', 'req-ger-password');
  await cig.login('cig', 'req-cig-password');
  today = bundle.biz_today;
  plan = bundle.plans.find((p) => p.code === 'MENSUELLE');
});
after(() => server.destroy());
// The only room is shared by every test: each one takes a day of its own.
beforeEach(() => {
  dayNo += 1;
  day = addDays(today, dayNo);
});

test('créneaux : le battement et les réservations existantes sont exclus', async () => {
  const holder = await person('membre', { balance: 1000000 * UM });
  const asker = await person();
  const booking = ok(await ger.post('/api/reservations', {
    member_id: holder.member.id, date: day, start_time: '20:00', duration_min: 120, pay_with_card: true,
  }));
  assert.ok(booking.reservation.id);
  const slots = await slotsOf(asker, {});
  for (const t of ['19:00', '19:30', '20:00', '21:00', '22:00']) assert.equal(slots.includes(t), false, t);
  for (const t of ['15:00', '18:30', '22:30', '23:00']) assert.equal(slots.includes(t), true, t);
  // Nothing about the holder: the answer is the list of times, nothing else.
  const answer = ok(await asker.client.get(`/api/client/slots?date=${day}&duration_min=60&party_size=1`));
  assert.deepEqual(Object.keys(answer), ['slots']);
  assert.equal(JSON.stringify(answer).includes('demande'), false);
});

test('créneau trop proche : moins d’une heure', async () => {
  const a = await person();
  const tz = server.club.settings().timezone;
  const step = 30 * 60000;
  const soon = Math.ceil((Date.now() + 20 * 60000) / step) * step;
  const date = server.club.bizDayOf(soon);
  const start_time = localParts(soon, tz).time;
  refused(await ask(a, { date, start_time }), 409, 'CRENEAU_INDISPONIBLE');
  assert.equal(server.club.get('SELECT COUNT(*) AS n FROM reservation_requests WHERE member_id = ?', a.member.id).n, 0);
  // Too far ahead as well.
  refused(await ask(a, { date: addDays(today, 40) }), 409, 'CRENEAU_INDISPONIBLE');
});

test('un client régulier ne peut pas demander', async () => {
  const c = await person('client');
  for (const r of [
    await c.client.get(`/api/client/slots?date=${day}&duration_min=60`),
    await c.client.post('/api/client/reservation-requests/quote', { date: day, start_time: '15:00', duration_min: 60 }),
    await ask(c),
  ]) refused(r, 403, 'RESERVATION_NON_OUVERTE');
});

test('devis : la part incluse, le payant, la carte et l’acompte', async () => {
  const a = await person('membre', { balance: 30000 * UM });
  ok(await ger.post(`/api/members/${a.member.id}/subscriptions`, { plan_id: plan.id, start_date: today }));
  const quote = ok(await a.client.post('/api/client/reservation-requests/quote', { date: day, start_time: '15:00', duration_min: 240, party_size: 2 }));
  assert.deepEqual(Object.keys(quote).sort(), ['card_amount', 'deposit_amount', 'included_minutes', 'paid_minutes', 'supplement_amount']);
  assert.equal(quote.included_minutes, 120);
  assert.equal(quote.paid_minutes, 120);
  assert.equal(quote.deposit_amount, quote.supplement_amount / 2);
  assert.equal(quote.card_amount, Math.min(30000 * UM, quote.supplement_amount));
});

test('confirmer une demande crée la réservation et la lie', async () => {
  const a = await person();
  const q = ok(await ask(a));
  assert.equal(q.status, 'en_attente');
  const staff = ok(await cig.get('/api/orders'));
  assert.equal(staff.counts.requests, 1 + server.club.get("SELECT COUNT(*) AS n FROM reservation_requests WHERE status = 'en_attente' AND id <> ?", q.id).n);
  const seen = staff.requests.find((r) => r.id === q.id);
  assert.deepEqual([seen.member.name, seen.date, seen.start_time, seen.party_size], [`${a.member.first_name} ${a.member.last_name}`, day, '15:00', 2]);
  assert.equal(seen.estimate.paid_minutes, 60);
  const booked = ok(await confirm(a, q)).reservation;
  const answered = row(q.id);
  assert.equal(answered.status, 'confirmee');
  assert.equal(answered.reservation_id, booked.id);
  assert.ok(answered.decided_at && answered.decided_by);
  const account = ok(await a.client.get('/api/client/account'));
  assert.ok(account.reservations.some((r) => r.id === booked.id && r.start_time === '15:00'));
  assert.deepEqual(account.requests, []);
  // Answered once only.
  refused(await confirm(a, q, { start_time: '17:00' }), 409, 'DEMANDE_TRAITEE');
  refused(await ger.post(`/api/reservation-requests/${q.id}/refuse`, { message: 'Trop tard' }), 409, 'DEMANDE_TRAITEE');
});

test('confirmer pour un autre membre est refusé', async () => {
  const a = await person();
  const b = await person();
  const q = ok(await ask(a));
  refused(await confirm(b, q), 409, 'DEMANDE_AUTRE_MEMBRE');
  assert.equal(row(q.id).status, 'en_attente');
});

test('créneau pris entre-temps : la demande reste en attente', async () => {
  const a = await person();
  const other = await person('membre', { balance: 1000000 * UM });
  const q = ok(await ask(a, { start_time: '10:00' }));
  ok(await ger.post('/api/reservations', { member_id: other.member.id, date: day, start_time: '10:30', duration_min: 60, pay_with_card: true }));
  const r = await confirm(a, q);
  assert.equal(r.status, 409, JSON.stringify(r.data));
  assert.ok(['CHEVAUCHEMENT', 'BATTEMENT'].includes(r.data.error.code), r.data.error.code);
  assert.equal(row(q.id).status, 'en_attente');
  assert.equal(row(q.id).reservation_id, null);
  assert.equal(row(q.id).decided_at, null);
  // The slot is gone for new asks, and the pending one can still be refused.
  refused(await ask(a, { start_time: '10:00' }), 409, 'CRENEAU_INDISPONIBLE');
  ok(await ger.post(`/api/reservation-requests/${q.id}/refuse`, { message: 'Salle prise, désolé.' }));
});

test('3 h sans acompte couvert : refus ACOMPTE_REQUIS, demande toujours en attente', async () => {
  const a = await person('membre');
  const q = ok(await ask(a, { start_time: '12:00', duration_min: 180 }));
  assert.ok(q.deposit_amount > 0);
  refused(await confirm(a, q), 400, 'ACOMPTE_REQUIS');
  assert.equal(row(q.id).status, 'en_attente');
  assert.equal(server.club.get('SELECT COUNT(*) AS n FROM reservations WHERE member_id = ?', a.member.id).n, 0);
  assert.equal(ok(await a.client.get('/api/client/account')).requests[0].status, 'en_attente');
  ok(await ger.post(`/api/members/${a.member.id}/wallet/recharge`, { amount: 100000 * UM, method: 'Espèces' }));
  const booked = ok(await confirm(a, q)).reservation;
  assert.equal(row(q.id).status, 'confirmee');
  assert.equal(row(q.id).reservation_id, booked.id);
  assert.ok(server.club.walletBalance(a.member.id) <= 100000 * UM - q.deposit_amount);
});

test('refuser : le client voit le mot', async () => {
  const a = await person();
  const q = ok(await ask(a, { start_time: '16:30' }));
  refused(await ger.post(`/api/reservation-requests/${q.id}/refuse`, { message: 'ab' }), 400, 'INVALIDE');
  refused(await ger.post(`/api/reservation-requests/${q.id}/refuse`, { message: 'x'.repeat(301) }), 400, 'INVALIDE');
  assert.equal(row(q.id).status, 'en_attente');
  ok(await cig.post(`/api/reservation-requests/${q.id}/refuse`, { message: 'Le salon est privatisé ce soir.' }));
  const view = ok(await a.client.get('/api/client/account')).requests.find((r) => r.id === q.id);
  assert.equal(view.status, 'refusee');
  assert.equal(view.message, 'Le salon est privatisé ce soir.');
  assert.equal(ok(await ger.get('/api/orders')).requests.some((r) => r.id === q.id), false);
});

test('B ne voit pas la demande de A, ne l’annule pas', async () => {
  const a = await person();
  const b = await person();
  const q = ok(await ask(a, { start_time: '18:00' }));
  assert.deepEqual(ok(await b.client.get('/api/client/account')).requests, []);
  refused(await b.client.post(`/api/client/reservation-requests/${q.id}/cancel`, {}), 404, 'INTROUVABLE');
  refused(await b.client.post('/api/client/reservation-requests/999999/cancel', {}), 404, 'INTROUVABLE');
  assert.equal(row(q.id).status, 'en_attente');
  const cancelled = ok(await a.client.post(`/api/client/reservation-requests/${q.id}/cancel`, {}));
  assert.equal(cancelled.status, 'annulee');
  refused(await a.client.post(`/api/client/reservation-requests/${q.id}/cancel`, {}), 409, 'DEMANDE_TRAITEE');
});

test('trois demandes en attente au plus', async () => {
  const a = await person();
  for (const t of ['08:00', '09:00', '10:00']) ok(await ask(a, { start_time: t }));
  refused(await ask(a, { start_time: '11:00' }), 409, 'TROP_DE_DEMANDES');
  assert.equal(server.club.get("SELECT COUNT(*) AS n FROM reservation_requests WHERE member_id = ?", a.member.id).n, 3);
});
