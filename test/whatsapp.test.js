// The WhatsApp messages: the pure helpers shared with the browser (shared/whatsapp.js), then
// what the server hands the browser to build the message (the club's number setting, the member's first name
// and phone in a booking's detail). The club's real number is never written in the repository: the examples
// use +242 06 000 00 00, and the other numbers are made up.
import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { waDigits, waLink } from '../shared/whatsapp.js';
import { Server, Client, ok } from './harness.js';

// ---------------------------------------------------------------- waDigits

test('waDigits : un numéro local à 9 chiffres commençant par 0 reçoit l’indicatif 242', () => {
  assert.equal(waDigits('06 000 00 00'), '242060000000');
  assert.equal(waDigits('06.000.00.00'), '242060000000');
  assert.equal(waDigits('06-000-00-00'), '242060000000');
  assert.equal(waDigits('(06) 000 00 00'), '242060000000');
  assert.equal(waDigits('  060000000 '), '242060000000');
});

test('waDigits : un numéro international garde ses chiffres', () => {
  assert.equal(waDigits('+242 06 000 00 00'), '242060000000');
  assert.equal(waDigits('00242060000000'), '242060000000');
  assert.equal(waDigits('00 242 06 000 00 00'), '242060000000');
  assert.equal(waDigits('242 06 000 00 00'), '242060000000');
  assert.equal(waDigits('+33 6 12 34 56 78'), '33612345678');
  assert.equal(waDigits('0033 6 12 34 56 78'), '33612345678');
});

test('waDigits : un numéro vide, sans chiffres ou inutilisable donne null', () => {
  for (const phone of ['', '   ', 'abc', '+', '-', null, undefined, {}]) {
    assert.equal(waDigits(phone), null, JSON.stringify(phone));
  }
  // Too short or too long to be an international number: 8 to 15 digits.
  assert.equal(waDigits('+1234567'), null);
  assert.equal(waDigits('+12345678'), '12345678');
  assert.equal(waDigits('+123456789012345'), '123456789012345');
  assert.equal(waDigits('+1234567890123456'), null);
  assert.equal(waDigits('06'), null);
  // An international number never starts with 0: what still does is a national number of an unknown
  // country, which WhatsApp could not find; the link then opens without a recipient.
  assert.equal(waDigits('06 00 00 00 00'), null);
  assert.equal(waDigits('+06 000 00 00'), null);
  assert.equal(waDigits('+000 000000'), null);
});

// ---------------------------------------------------------------- waLink

test('waLink : le lien wa.me, avec ou sans destinataire', () => {
  assert.equal(waLink(null, 'a b'), 'https://wa.me/?text=a%20b');
  assert.equal(waLink('', 'a b'), 'https://wa.me/?text=a%20b');
  assert.equal(waLink(undefined, 'a b'), 'https://wa.me/?text=a%20b');
  assert.equal(waLink('242060000000', 'a b'), 'https://wa.me/242060000000?text=a%20b');
});

test('waLink : le texte est encodé, accents, deux-points, esperluette et plus compris', () => {
  const text = 'Bonjour Zoé, rendez-vous à 18:00 (Salon & Cave) : 2 + 1 personnes #1 ?';
  const link = waLink('242060000000', text);
  assert.equal(link, `https://wa.me/242060000000?text=${encodeURIComponent(text)}`);
  assert.equal(new URL(link).searchParams.get('text'), text);
});

test('numéro du membre au format libre : le lien reste toujours ouvrable', () => {
  const text = 'Bonjour Jean-Pierre,\nVotre réservation au Salon Principal est confirmée pour le ven. 23/10/2026 de 18:00 à 20:00 (2 personnes).';
  const forms = ['06 000 00 00', '+242 06 000 00 00', '00242060000000', '(242) 06-000-00-00', '+33 6 12 34 56 78',
    '06 00 00 00 00', '06', 'abc', '', '   ', null, undefined];
  for (const phone of forms) {
    const url = new URL(waLink(waDigits(phone), text));
    assert.equal(url.origin, 'https://wa.me', JSON.stringify(phone));
    assert.match(url.pathname, /^\/(\d{8,15})?$/, JSON.stringify(phone));
    assert.equal(url.searchParams.get('text'), text, JSON.stringify(phone));
  }
});

// ---------------------------------------------------------------- what the server hands the browser

let server, admin, manager, today, monthly, room;

beforeEach(async () => {
  server = new Server({}, { lenientTariffs: true });
  await server.start();
  await server.addUser('admin', 'Admin', 'admin', 'whatsapp-admin-password');
  await server.addUser('gerant', 'Gérant', 'gerant', 'whatsapp-manager-password');
  admin = new Client(server);
  manager = new Client(server);
  await admin.login('admin', 'whatsapp-admin-password');
  const bundle = await manager.login('gerant', 'whatsapp-manager-password');
  today = bundle.biz_today;
  monthly = bundle.plans.find((p) => p.code === 'MENSUELLE').id;
  room = bundle.rooms[0];
});
afterEach(() => server.destroy());

const setNumber = (club_whatsapp) => admin.put('/api/settings', { club_whatsapp });
const clubNumber = async () => ok(await manager.get('/api/me')).settings.club_whatsapp;

test('numéro WhatsApp du club : vide au départ, réglé par un administrateur, relu dans /api/me', async () => {
  assert.equal(await clubNumber(), '');
  const saved = ok(await setNumber('+242 06 000 00 00'));
  assert.equal(saved.settings.club_whatsapp, '+242 06 000 00 00');
  assert.equal(await clubNumber(), '+242 06 000 00 00');
  // The value is stored: it survives a restart of the club.
  await server.restart();
  assert.equal(await clubNumber(), '+242 06 000 00 00');
  // Saving another setting leaves it alone.
  ok(await admin.put('/api/settings', { club_name: 'Cercle Test' }));
  assert.equal(await clubNumber(), '+242 06 000 00 00');
});

test('numéro WhatsApp du club : 30 caractères au plus', async () => {
  const thirty = '+242 06 000 00 00'.padEnd(30, '0');
  assert.equal(thirty.length, 30);
  assert.equal((await setNumber(thirty)).status, 200);
  assert.equal(await clubNumber(), thirty);
  const tooLong = `${thirty}0`;
  assert.equal(tooLong.length, 31);
  const refused = await setNumber(tooLong);
  assert.equal(refused.status, 400, JSON.stringify(refused.data));
  assert.match(refused.data.error.message, /30 caractères maximum/);
  assert.equal(await clubNumber(), thirty);
  // Not text at all.
  for (const value of [{}, [], true]) assert.equal((await setNumber(value)).status, 400, JSON.stringify(value));
  assert.equal(await clubNumber(), thirty);
});

test('numéro WhatsApp du club : vide ou blanc, il s’efface ; les espaces autour sont retirés', async () => {
  ok(await setNumber('  +242 06 000 00 00  '));
  assert.equal(await clubNumber(), '+242 06 000 00 00');
  for (const empty of ['', '   ', null]) {
    ok(await setNumber('+242 06 000 00 00'));
    ok(await setNumber(empty));
    assert.equal(await clubNumber(), '', JSON.stringify(empty));
  }
});

test('numéro WhatsApp du club : réservé à un administrateur', async () => {
  ok(await setNumber('+242 06 000 00 00'));
  const refused = await manager.put('/api/settings', { club_whatsapp: '+242 06 000 00 09' });
  assert.equal(refused.status, 403);
  assert.equal(await clubNumber(), '+242 06 000 00 00');
});

test('numéro WhatsApp du club : un réglage enregistré avant son existence se lit vide', async () => {
  server.club.run("DELETE FROM settings WHERE key = 'club_whatsapp'");
  server.club.cachedSettings = null;
  assert.equal(await clubNumber(), '');
  await server.restart();
  assert.equal(await clubNumber(), '');
  assert.equal(ok(await manager.get('/api/me')).settings.club_name, 'Limen');
});

// A member with the monthly plan, booked from 18:00 to 20:00 today.
const bookFor = async (first_name, phone, patch = {}) => {
  const member = ok(await manager.post('/api/members', { first_name, last_name: 'Test', phone }));
  ok(await manager.post(`/api/members/${member.id}/subscriptions`, { plan_id: monthly, start_date: today }));
  return ok(await manager.post('/api/reservations', {
    member_id: member.id, room_id: room.id, date: today, start_time: '18:00', duration_min: 120, ...patch,
  }));
};

test('le détail d’une réservation porte le prénom et le numéro du membre, pas les listes', async () => {
  const created = await bookFor('Jean-Pierre', '06 000 00 00');
  // The answer to the booking is the detail, so the browser has what it needs right after the booking.
  assert.equal(created.member_first_name, 'Jean-Pierre');
  assert.equal(created.member_phone, '06 000 00 00');
  const id = created.reservation.id;
  const detail = ok(await manager.get(`/api/reservations/${id}`));
  assert.equal(detail.member_first_name, 'Jean-Pierre');
  assert.equal(detail.member_phone, '06 000 00 00');
  // The detail answers every action on the booking; the record inside it stays as the lists have it.
  const started = ok(await manager.post(`/api/reservations/${id}/start`, {}));
  assert.equal(started.member_phone, '06 000 00 00');
  assert.equal('member_phone' in detail.reservation, false);
  assert.equal('member_first_name' in detail.reservation, false);
  // Nothing else that lists bookings carries them: no phone number spread around.
  const list = ok(await manager.get(`/api/reservations?from=${today}&to=${today}`));
  assert.equal(list.length, 1);
  assert.equal(list[0].id, id);
  const dashboard = ok(await manager.get('/api/dashboard'));
  const agenda = ok(await manager.get(`/api/reservations?from=${today}&to=${today}&room_id=${room.id}`));
  for (const payload of [list, agenda, dashboard.rooms_status]) {
    const json = JSON.stringify(payload);
    assert.equal(json.includes('member_phone'), false);
    assert.equal(json.includes('member_first_name'), false);
    assert.equal(json.includes('06 000 00 00'), false);
  }
});

test('le détail d’une réservation annulée ou terminée porte aussi le prénom et le numéro', async () => {
  const cancelled = await bookFor('Aline', '+242 06 000 00 01');
  const answer = ok(await manager.post(`/api/reservations/${cancelled.reservation.id}/cancel`, { reason: 'Test du message' }));
  assert.equal(answer.reservation.status, 'annulee');
  assert.equal(answer.member_first_name, 'Aline');
  assert.equal(answer.member_phone, '+242 06 000 00 01');
  const done = await bookFor('Bruno', '06 000 00 02', { start_time: '21:00' });
  ok(await manager.post(`/api/reservations/${done.reservation.id}/start`, {}));
  const finished = ok(await manager.post(`/api/reservations/${done.reservation.id}/finish`, {}));
  assert.equal(finished.reservation.status, 'terminee');
  assert.equal(finished.member_first_name, 'Bruno');
  assert.equal(finished.member_phone, '06 000 00 02');
});
