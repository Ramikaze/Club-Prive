// The gap between two bookings of the same room (settings booking.gap_min, 30 minutes by default),
// checked on the server when a booking is created, extended or moved to another room.
import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { Server, Client, ok, UM } from './harness.js';
import { conflict } from '../worker/errors.js';

let server, admin, manager, rooms, members, today, monthly;

const MIN = 60000;

beforeEach(async () => {
  server = new Server({}, { lenientTariffs: true });
  await server.start();
  await server.addUser('admin', 'Admin', 'admin', 'gap-admin-password');
  await server.addUser('gerant', 'Gérant', 'gerant', 'gap-manager-password');
  admin = new Client(server);
  manager = new Client(server);
  await admin.login('admin', 'gap-admin-password');
  const bundle = await manager.login('gerant', 'gap-manager-password');
  today = bundle.biz_today;
  monthly = bundle.plans.find((p) => p.code === 'MENSUELLE').id;
  // The club opens with a single room; these scenarios add two more.
  for (const [name, capacity] of [['Salon VIP', 6], ['Petit Salon', 4]]) ok(await admin.post('/api/rooms', { name, capacity }));
  rooms = ok(await manager.get('/api/rooms'));
  members = [];
  for (const first_name of ['Alice', 'Bruno', 'Camille']) members.push(await enroll(first_name));
});
afterEach(() => server.destroy());

// A member with the monthly plan (2 hours of credit).
const enroll = async (first_name) => {
  const member = ok(await manager.post('/api/members', { first_name, last_name: 'Test', phone: '+000 000000' }));
  ok(await manager.post(`/api/members/${member.id}/subscriptions`, { plan_id: monthly, start_date: today }));
  return member;
};

const request = (patch = {}) => ({ member_id: members[0].id, room_id: rooms[0].id, date: today, start_time: '15:00', duration_min: 60, ...patch });
const attempt = (patch) => manager.post('/api/reservations', request(patch));
const book = async (patch) => ok(await attempt(patch)).reservation;
const rejected = (response, code) => {
  assert.equal(response.status, 409, JSON.stringify(response.data));
  assert.equal(response.data.error.code, code);
  return response.data.error;
};
const setBooking = (patch) => admin.put('/api/settings', { booking: { ...server.club.settings().booking, ...patch } }).then(ok);
const extend = (id, minutes) => manager.post(`/api/reservations/${id}/extend`, { minutes });

test('battement : refusé à 29 minutes, accepté à 30', async () => {
  await book({ start_time: '14:00', duration_min: 120 }); // 14:00-16:00
  // With the 30-minute slot, back to back is the closest start the form can offer; 30 minutes later is enough.
  const refused = rejected(await attempt({ member_id: members[1].id, start_time: '16:00' }), 'BATTEMENT');
  assert.equal(
    refused.message,
    'Il faut 30 minutes entre deux réservations : la séance précédente se termine à 16:00, celle-ci peut commencer à 16:30 au plus tôt.',
  );
  ok(await attempt({ member_id: members[1].id, start_time: '16:30' }));
});

test('battement : la borne se joue à la minute', async () => {
  const first = await book({ start_time: '14:00', duration_min: 120 }); // 14:00-16:00
  const near = (start, end, exclude = null, room = rooms[0].id) => server.club.gapConflicts(start, end, exclude, room).map((r) => r.id);
  // After it, 29 minutes is too close and 30 is enough; the same before it.
  assert.deepEqual(near(first.end_ms + 29 * MIN, first.end_ms + 89 * MIN), [first.id]);
  assert.deepEqual(near(first.end_ms + 30 * MIN, first.end_ms + 90 * MIN), []);
  assert.deepEqual(near(first.start_ms - 89 * MIN, first.start_ms - 29 * MIN), [first.id]);
  assert.deepEqual(near(first.start_ms - 90 * MIN, first.start_ms - 30 * MIN), []);
  // A strict overlap is CHEVAUCHEMENT's business, not the gap's, and a booking is never too close to itself.
  assert.deepEqual(near(first.start_ms + 30 * MIN, first.end_ms + 30 * MIN), []);
  assert.deepEqual(near(first.end_ms, first.end_ms + 60 * MIN, first.id), []);
  // Another room keeps its own timetable.
  assert.deepEqual(near(first.end_ms, first.end_ms + 60 * MIN, null, rooms[1].id), []);
});

test('battement : la suivante trop proche', async () => {
  await book({ start_time: '18:00', duration_min: 120 }); // 18:00-20:00
  const before = { member_id: members[1].id, start_time: '16:00' };
  const tooClose = rejected(await attempt({ ...before, duration_min: 120 }), 'BATTEMENT'); // 16:00-18:00, back to back
  assert.equal(
    tooClose.message,
    'Il faut 30 minutes entre deux réservations : la séance suivante commence à 18:00, celle-ci doit se terminer à 17:30 au plus tard.',
  );
  // A strict overlap keeps its own code.
  rejected(await attempt({ ...before, duration_min: 150 }), 'CHEVAUCHEMENT'); // 16:00-18:30
  // With a 15-minute slot, 15 minutes before it is still too close and 30 is enough.
  await setBooking({ slot_min: 15 });
  rejected(await attempt({ ...before, duration_min: 105 }), 'BATTEMENT'); // 16:00-17:45
  ok(await attempt({ ...before, duration_min: 90 })); // 16:00-17:30
});

test('battement : réglé à 0, désactivé', async () => {
  const saved = await setBooking({ gap_min: 0 });
  assert.equal(saved.settings.booking.gap_min, 0);
  const first = await book({ start_time: '14:00', duration_min: 120 });
  assert.deepEqual(server.club.gapConflicts(first.end_ms, first.end_ms + 60 * MIN, null, rooms[0].id), []);
  const quote = ok(await manager.post('/api/reservations/quote', request({ member_id: members[1].id, start_time: '16:00' })));
  assert.deepEqual(quote.gap_conflicts, []);
  assert.equal(quote.rooms_availability.every((rm) => rm.available), true);
  await book({ member_id: members[1].id, start_time: '16:00' }); // back to back is accepted
});

test('battement : validation du réglage', async () => {
  const booking = server.club.settings().booking;
  assert.equal(booking.gap_min, 30);
  for (const gap_min of [-1, 241, 1.5, 'abc', '']) {
    assert.equal((await admin.put('/api/settings', { booking: { ...booking, gap_min } })).status, 400, `gap_min ${JSON.stringify(gap_min)}`);
  }
  assert.equal(server.club.settings().booking.gap_min, 30);
  for (const gap_min of [0, 240]) {
    assert.equal((await setBooking({ gap_min })).settings.booking.gap_min, gap_min);
  }
  // A save that leaves the field out (the Settings page does until it knows it) keeps the value.
  await setBooking({ gap_min: 45 });
  const { gap_min: omitted, ...withoutGap } = booking;
  assert.equal(omitted, 30);
  ok(await admin.put('/api/settings', { booking: withoutGap }));
  assert.equal(server.club.settings().booking.gap_min, 45);
  assert.equal((await manager.put('/api/settings', { booking: { ...booking, gap_min: 10 } })).status, 403);
});

test('battement : un réglage enregistré avant le battement se lit avec 30', async () => {
  server.club.run("UPDATE settings SET value = json_remove(value, '$.gap_min') WHERE key = 'booking'");
  server.club.cachedSettings = null;
  assert.equal('gap_min' in JSON.parse(server.club.get("SELECT value FROM settings WHERE key = 'booking'").value), false);
  assert.equal(server.club.settings().booking.gap_min, 30);
  assert.equal(server.club.settings().booking.slot_min, 30);
  assert.equal(ok(await manager.get('/api/me')).settings.booking.gap_min, 30);
  await server.restart();
  assert.equal(server.club.settings().booking.gap_min, 30);
  await book({ start_time: '14:00', duration_min: 120 });
  rejected(await attempt({ member_id: members[1].id, start_time: '16:00' }), 'BATTEMENT');
  // Saving the section writes the value down.
  await setBooking({ slot_min: 30 });
  assert.equal(JSON.parse(server.club.get("SELECT value FROM settings WHERE key = 'booking'").value).gap_min, 30);
});

test('battement : prolongation', async () => {
  const first = await book({ start_time: '14:00', duration_min: 120 }); // 14:00-16:00
  await book({ member_id: members[1].id, start_time: '16:30', duration_min: 90 }); // 16:30-18:00
  const quote = ok(await manager.post(`/api/reservations/${first.id}/extend/quote`, { minutes: 30 }));
  assert.deepEqual(quote.conflicts, []);
  assert.deepEqual(quote.gap_conflicts.map((r) => r.member_name), ['Bruno Test']);
  const refused = rejected(await extend(first.id, 30), 'BATTEMENT');
  // Not even one step fits before the next session, and the message does not name the end it already has.
  assert.equal(
    refused.message,
    "Il faut 30 minutes entre deux réservations : la séance suivante commence à 16:30, aucune prolongation n'est possible.",
  );
  assert.deepEqual(refused.details.conflicts.map((r) => r.member_name), ['Bruno Test']);
  // The quote carries that very sentence, for the dialog to show before anything is sent.
  assert.equal(quote.gap_message, refused.message);
  assert.equal(ok(await manager.get(`/api/reservations/${first.id}`)).reservation.duration_min, 120);
});

test('battement : prolongation, le message donne la fin la plus tardive', async () => {
  await setBooking({ gap_min: 120 });
  const first = await book({ start_time: '14:00', duration_min: 60 }); // 14:00-15:00
  await book({ member_id: members[1].id, start_time: '18:00', duration_min: 60 }); // 18:00-19:00
  assert.equal(ok(await extend(first.id, 30)).reservation.end_time, '15:30');
  const quote = ok(await manager.post(`/api/reservations/${first.id}/extend/quote`, { minutes: 60 }));
  const refused = rejected(await extend(first.id, 60), 'BATTEMENT'); // would end at 16:30, 90 minutes before 18:00
  assert.equal(
    refused.message,
    "Il faut 2 h entre deux réservations : la séance suivante commence à 18:00, la prolongation peut aller jusqu'à 16:00 au plus tard.",
  );
  assert.equal(quote.gap_message, refused.message);
  // The time given is exactly the one the server accepts.
  assert.equal(ok(await extend(first.id, 30)).reservation.end_time, '16:00');
});

test('battement : prolongation, une séance déjà collée avant elle ne la gêne pas', async () => {
  await setBooking({ gap_min: 0 });
  await book({ start_time: '12:00', duration_min: 120 }); // 12:00-14:00
  const second = await book({ member_id: members[1].id, start_time: '14:00', duration_min: 60 }); // 14:00-15:00, glued to the first
  await setBooking({ gap_min: 120 });
  // The first session is within 120 minutes of the extra half hour, but the extension does not bring it closer.
  const quote = ok(await manager.post(`/api/reservations/${second.id}/extend/quote`, { minutes: 30 }));
  assert.deepEqual(quote.gap_conflicts, []);
  assert.equal(quote.gap_message, null);
  assert.equal(ok(await extend(second.id, 30)).reservation.end_time, '15:30');
});

test('battement : devis', async () => {
  const first = await book({ start_time: '14:00', duration_min: 120 }); // 14:00-16:00
  const quote = ok(await manager.post('/api/reservations/quote', request({ member_id: members[1].id, start_time: '16:00' })));
  assert.deepEqual(quote.conflicts, []);
  assert.deepEqual(quote.gap_conflicts.map((r) => r.id), [first.id]);
  // The quote carries the very sentence the refusal would, nearest time included, for the dialog to show before sending.
  const refused = rejected(await attempt({ member_id: members[1].id, start_time: '16:00' }), 'BATTEMENT');
  assert.equal(quote.gap_message, refused.message);
  const byRoom = Object.fromEntries(quote.rooms_availability.map((rm) => [rm.id, rm]));
  assert.equal(byRoom[rooms[0].id].available, false);
  assert.equal(byRoom[rooms[0].id].gap_conflict.id, first.id);
  assert.equal(byRoom[rooms[0].id].conflict, null);
  for (const room of [rooms[1], rooms[2]]) {
    assert.equal(byRoom[room.id].available, true);
    assert.equal(byRoom[room.id].gap_conflict, null);
  }

  // A strict overlap is reported as an overlap alone: the room is busy, not merely too close.
  const overlap = ok(await manager.post('/api/reservations/quote', request({ member_id: members[1].id, start_time: '15:00' })));
  assert.deepEqual(overlap.conflicts.map((r) => r.id), [first.id]);
  assert.deepEqual(overlap.gap_conflicts, []);
  assert.equal(overlap.gap_message, null);
  const busy = overlap.rooms_availability.find((rm) => rm.id === rooms[0].id);
  assert.deepEqual([busy.available, busy.conflict.id, busy.gap_conflict], [false, first.id, null]);

  // Overlapping one booking and touching another: the overlap alone is reported, for the room and for the quote.
  await book({ member_id: members[2].id, start_time: '18:00', duration_min: 120 }); // 18:00-20:00
  const both = ok(await manager.post('/api/reservations/quote', request({ member_id: members[1].id, start_time: '15:30', duration_min: 150 })));
  assert.deepEqual(both.conflicts.map((r) => r.id), [first.id]);
  assert.deepEqual(both.gap_conflicts, []);
  const bothRoom = both.rooms_availability.find((rm) => rm.id === rooms[0].id);
  assert.deepEqual([bothRoom.available, bothRoom.conflict.id, bothRoom.gap_conflict], [false, first.id, null]);

  const far = ok(await manager.post('/api/reservations/quote', request({ member_id: members[1].id, start_time: '16:30', duration_min: 60 })));
  assert.deepEqual(far.gap_conflicts, []);
  assert.equal(far.gap_message, null);
  assert.equal(far.rooms_availability.every((rm) => rm.available && rm.gap_conflict === null), true);
});

test('battement : réservations collées existantes intactes', async () => {
  const cigar = ok(await admin.post('/api/products', { category: 'cigare', name: 'Robusto test', reference: 'T-ROB', price: 1000000, initial_stock: 10 })).id;
  const method = server.club.settings().payment_methods[0];
  await setBooking({ gap_min: 0 });
  const a = await book({ start_time: '14:00', duration_min: 120 }); // 14:00-16:00
  const b = await book({ member_id: members[1].id, start_time: '16:00', duration_min: 150 }); // 16:00-18:30, half an hour of paid time
  const c = await book({ member_id: members[2].id, start_time: '18:30', duration_min: 60 }); // 18:30-19:30
  await setBooking({ gap_min: 30 });

  // Nothing but a booking, an extension or a move of room looks at the gap.
  ok(await manager.put(`/api/reservations/${b.id}/occupancy`, { party_size: 3 }));
  ok(await manager.post(`/api/reservations/${a.id}/start`));
  const withItem = ok(await manager.post(`/api/reservations/${a.id}/items`, { product_id: cigar, quantity: 1 }));
  ok(await manager.post(`/api/reservations/${a.id}/finish`));
  ok(await manager.post('/api/payments', { charge_ids: withItem.charges.filter((ch) => ch.status === 'due').map((ch) => ch.id), method }));
  ok(await manager.post(`/api/reservations/${b.id}/start`));
  const finished = ok(await manager.post(`/api/reservations/${b.id}/finish`));
  const supplement = finished.charges.filter((ch) => ch.kind === 'temps_supplementaire' && ch.status === 'due');
  assert.equal(supplement.length, 1);
  ok(await manager.post('/api/payments', { charge_ids: supplement.map((ch) => ch.id), method }));
  ok(await manager.post(`/api/reservations/${c.id}/cancel`, { reason: 'Annulation de test' }));
  const status = async (id) => ok(await manager.get(`/api/reservations/${id}`)).reservation.status;
  assert.deepEqual([await status(a.id), await status(b.id), await status(c.id)], ['terminee', 'terminee', 'annulee']);

  // The rule itself is back: a finished booking still counts, a cancelled one does not.
  rejected(await attempt({ member_id: members[2].id, start_time: '18:30' }), 'BATTEMENT');
  ok(await attempt({ member_id: members[2].id, start_time: '19:00' }));
});

test('battement : changement de salle', async () => {
  const vip = rooms[1];
  const a = await book({ start_time: '14:00', duration_min: 120 }); // main room, 14:00-16:00
  await book({ member_id: members[1].id, room_id: vip.id, start_time: '16:00', duration_min: 120 }); // VIP, 16:00-18:00
  const refused = rejected(await manager.put(`/api/reservations/${a.id}/occupancy`, { room_id: vip.id }), 'BATTEMENT');
  assert.equal(
    refused.message,
    'Il faut 30 minutes entre deux réservations : la salle « Salon VIP » a une réservation de 16:00 à 18:00.',
  );
  assert.deepEqual(refused.details.conflicts.map((r) => r.room_name), ['Salon VIP']);
  assert.equal(ok(await manager.get(`/api/reservations/${a.id}`)).reservation.room_id, rooms[0].id);
  // The head count alone is not a move, whether or not the room is named again.
  ok(await manager.put(`/api/reservations/${a.id}/occupancy`, { party_size: 3 }));
  ok(await manager.put(`/api/reservations/${a.id}/occupancy`, { room_id: rooms[0].id, party_size: 2 }));
  // A room with nothing nearby takes it.
  assert.equal(ok(await manager.put(`/api/reservations/${a.id}/occupancy`, { room_id: rooms[2].id })).reservation.room_id, rooms[2].id);
});

test('battement : une réservation annulée ou d’une autre salle ne compte pas', async () => {
  const first = await book({ start_time: '14:00', duration_min: 120 });
  ok(await attempt({ member_id: members[1].id, room_id: rooms[1].id, start_time: '16:00' })); // another room, back to back
  rejected(await attempt({ member_id: members[2].id, start_time: '16:00' }), 'BATTEMENT');
  ok(await manager.post(`/api/reservations/${first.id}/cancel`, { reason: 'Annulation de test' }));
  ok(await attempt({ member_id: members[2].id, start_time: '16:00' }));
});

test('battement : une réservation coincée entre deux autres reçoit les deux heures possibles', async () => {
  const earlier = await book({ start_time: '14:00', duration_min: 120 }); // 14:00-16:00
  const later = await book({ member_id: members[1].id, start_time: '18:00', duration_min: 120 }); // 18:00-20:00
  const refused = rejected(await attempt({ member_id: members[2].id, start_time: '16:00', duration_min: 120 }), 'BATTEMENT');
  assert.equal(
    refused.message,
    'Il faut 30 minutes entre deux réservations : la séance précédente se termine à 16:00, celle-ci peut commencer à 16:30 au plus tôt ; '
      + 'la séance suivante commence à 18:00, celle-ci doit se terminer à 17:30 au plus tard.',
  );
  const quote = ok(await manager.post('/api/reservations/quote', request({ member_id: members[2].id, start_time: '16:00', duration_min: 120 })));
  assert.equal(quote.gap_message, refused.message);
  assert.deepEqual(refused.details.conflicts.map((r) => r.id), [earlier.id, later.id]);
  ok(await attempt({ member_id: members[2].id, start_time: '16:30', duration_min: 60 })); // 16:30-17:30 fits exactly
});

test('battement : la salle d’arrivée avec deux réservations proches les nomme toutes les deux', async () => {
  const vip = rooms[1];
  const a = await book({ start_time: '16:00', duration_min: 60 }); // main room, 16:00-17:00
  await book({ member_id: members[1].id, room_id: vip.id, start_time: '14:00', duration_min: 120 }); // VIP, 14:00-16:00
  await book({ member_id: members[2].id, room_id: vip.id, start_time: '17:00', duration_min: 60 }); // VIP, 17:00-18:00
  const refused = rejected(await manager.put(`/api/reservations/${a.id}/occupancy`, { room_id: vip.id }), 'BATTEMENT');
  assert.equal(
    refused.message,
    'Il faut 30 minutes entre deux réservations : la salle « Salon VIP » a des réservations de 14:00 à 16:00 et de 17:00 à 18:00.',
  );
});

test('battement : l’heure proposée tombe sur un créneau de la salle', async () => {
  await setBooking({ slot_min: 60, extension_step_min: 60 });
  const first = await book({ start_time: '14:00', duration_min: 120 }); // 14:00-16:00
  await book({ member_id: members[1].id, start_time: '19:00', duration_min: 60 }); // 19:00-20:00
  // Half past four is no start of this room: the earliest start is five o'clock.
  const early = rejected(await attempt({ member_id: members[2].id, start_time: '16:00' }), 'BATTEMENT');
  assert.equal(
    early.message,
    'Il faut 30 minutes entre deux réservations : la séance précédente se termine à 16:00, celle-ci peut commencer à 17:00 au plus tôt.',
  );
  // Likewise for the end: half past six is no end of this room, six o'clock is.
  const late = rejected(await attempt({ member_id: members[2].id, start_time: '17:00', duration_min: 120 }), 'BATTEMENT'); // 17:00-19:00
  assert.equal(
    late.message,
    'Il faut 30 minutes entre deux réservations : la séance suivante commence à 19:00, celle-ci doit se terminer à 18:00 au plus tard.',
  );
  // An extension goes by whole steps from the end it has.
  assert.equal(ok(await extend(first.id, 120)).reservation.end_time, '18:00');
  const refused = rejected(await extend(first.id, 60), 'BATTEMENT');
  assert.equal(
    refused.message,
    "Il faut 30 minutes entre deux réservations : la séance suivante commence à 19:00, aucune prolongation n'est possible.",
  );
});

test('battement : le message reprend la durée réglée', async () => {
  await setBooking({ slot_min: 15, gap_min: 45 });
  await book({ start_time: '14:00', duration_min: 120 }); // 14:00-16:00
  const refused = rejected(await attempt({ member_id: members[1].id, start_time: '16:30' }), 'BATTEMENT'); // 30 minutes after: not enough
  assert.equal(
    refused.message,
    'Il faut 45 minutes entre deux réservations : la séance précédente se termine à 16:00, celle-ci peut commencer à 16:45 au plus tôt.',
  );
  ok(await attempt({ member_id: members[1].id, start_time: '16:45' })); // exactly 45: enough, and it ends at 17:45
  // From an hour on the duration is written as everywhere else in the application.
  await setBooking({ gap_min: 90 });
  const longer = rejected(await attempt({ member_id: members[2].id, start_time: '18:15' }), 'BATTEMENT');
  assert.equal(
    longer.message,
    'Il faut 1 h 30 entre deux réservations : la séance précédente se termine à 17:45, celle-ci peut commencer à 19:15 au plus tôt.',
  );
});

// ---------------------------------------------------------------- the extension window
// How far a session can still be extended (club.extensionWindow), for the alert shown before it ends.
// It has to be what the server accepts: these tests ask the server too.

const windowOf = (id) => server.club.extensionWindow(id);
const isoOf = (ms) => new Date(ms).toISOString();

// A session of a member of her own in `room`, so that scenarios do not share anyone's time.
const sessionIn = async (room, first_name, start_time, duration_min, patch = {}) => {
  const member = await enroll(first_name);
  return book({ room_id: room.id, member_id: member.id, start_time, duration_min, ...patch });
};
let roomsMade = 0;
const newRoom = async () => ok(await admin.post('/api/rooms', { name: `Salle d’essai ${++roomsMade}`, capacity: 6 })).room;

// What stops an extension, in the words of the window.
const OBSTACLE = {
  BATTEMENT: /la séance suivante commence à/,
  CHEVAUCHEMENT: /la séance suivante commence à/,
  MEMBRE_OCCUPE: /est déjà inscrit à une autre séance/,
  TARIF_NON_VALIDE: /tarif des heures supplémentaires/,
  DUREE_MAXIMALE: /24 heures/,
};

// The window and the server agree. One step beyond the longest extension the window names (the shortest, when it
// names none) is refused, with the code of the obstacle; the longest is accepted, ends at the time the window gave,
// and the session so extended has a closed window, stopped by the same obstacle.
async function agrees(club, client, id, { max, until = null, code, reason = null }) {
  const step = club.settings().booking.extension_step_min;
  const w = club.extensionWindow(id);
  assert.equal(w.max_minutes, max, 'max_minutes');
  assert.equal(w.possible, max > 0, 'possible');
  assert.equal(w.until_time, until, 'until_time');
  assert.equal(w.reason, reason, 'reason');
  const beyond = await client.post(`/api/reservations/${id}/extend`, { minutes: max + step });
  assert.equal(beyond.data.error?.code, code, JSON.stringify(beyond.data));
  if (!max) return;
  // The latest end the server quotes for a gap is the one the window gives.
  if (code === 'BATTEMENT') assert.ok(beyond.data.error.message.includes(`jusqu'à ${until} au plus tard`), beyond.data.error.message);
  const done = ok(await client.post(`/api/reservations/${id}/extend`, { minutes: max }));
  assert.equal(done.reservation.end_time, until);
  assert.equal(done.reservation.end_at, w.until_at);
  assert.equal(done.extension_window.possible, false);
  assert.match(done.extension_window.reason, OBSTACLE[code]);
}

test('fenêtre : suivante à fin + 90 min, battement 30', async () => {
  const first = await book({ start_time: '14:00', duration_min: 120 }); // 14:00-16:00
  await book({ member_id: members[1].id, start_time: '17:30', duration_min: 60 }); // 17:30-18:30, 90 minutes after the end
  // An hour more still leaves the half hour before 17:30; an hour and a half does not.
  assert.deepEqual(windowOf(first.id), {
    possible: true, max_minutes: 60, until_time: '17:00', until_at: isoOf(first.end_ms + 60 * MIN), reason: null,
    next: { member_name: 'Bruno Test', start_time: '17:30' },
  });
});

test('fenêtre : suivante à fin + 30 min', async () => {
  const first = await book({ start_time: '14:00', duration_min: 120 }); // 14:00-16:00
  await book({ member_id: members[1].id, start_time: '16:30', duration_min: 60 }); // 16:30-17:30
  assert.deepEqual(windowOf(first.id), {
    possible: false, max_minutes: 0, until_time: null, until_at: null,
    reason: 'Prolongation impossible : la séance suivante commence à 16:30 (Bruno Test).',
    next: { member_name: 'Bruno Test', start_time: '16:30' },
  });
});

test('fenêtre : sans suivante', async () => {
  const first = await book({ start_time: '14:00', duration_min: 120 }); // 14:00-16:00
  // Nothing follows: the 24 hours of a session are the only limit, 22 hours more.
  assert.deepEqual(windowOf(first.id), {
    possible: true, max_minutes: 1320, until_time: '14:00', until_at: isoOf(first.end_ms + 1320 * MIN), reason: null, next: null,
  });
  // It goes by whole steps, rounded down: 4 hours at a time, 20 hours more is the longest.
  await setBooking({ extension_step_min: 240 });
  assert.equal(windowOf(first.id).max_minutes, 1200);
  // 1 h 30 booked and 1 h steps: 22 h 30 would be left, and 22 h is the longest.
  await setBooking({ extension_step_min: 60 });
  const second = await book({ member_id: members[1].id, room_id: rooms[1].id, start_time: '18:00', duration_min: 90 });
  assert.equal(windowOf(second.id).max_minutes, 1320);
});

test('fenêtre : la suivante est celle de la même salle, une réservation annulée mise à part', async () => {
  const first = await book({ start_time: '14:00', duration_min: 120 }); // 14:00-16:00
  const cancelled = await book({ member_id: members[1].id, start_time: '16:30', duration_min: 60 });
  ok(await manager.post(`/api/reservations/${cancelled.id}/cancel`, { reason: 'Annulation de test' }));
  await book({ member_id: members[2].id, room_id: rooms[1].id, start_time: '16:30', duration_min: 60 }); // another room
  assert.deepEqual(
    [windowOf(first.id).next, windowOf(first.id).max_minutes],
    [null, 1320],
  );
  await book({ member_id: members[1].id, start_time: '21:00', duration_min: 60 });
  await book({ member_id: members[2].id, start_time: '19:00', duration_min: 60 }); // the nearest of the two
  const w = windowOf(first.id);
  assert.deepEqual(w.next, { member_name: 'Camille Test', start_time: '19:00' });
  assert.deepEqual([w.possible, w.max_minutes, w.until_time], [true, 150, '18:30']); // 19:00 less the half hour
});

test('fenêtre : un membre de la séance déjà inscrit à une autre séance', async () => {
  const first = await book({ start_time: '14:00', duration_min: 120, attendee_ids: [members[2].id] }); // Alice and Camille, 14:00-16:00
  await book({ member_id: members[2].id, room_id: rooms[1].id, start_time: '17:00', duration_min: 60 }); // Camille elsewhere, 17:00-18:00
  // Nothing is asked between two sessions of one person: she is free until 17:00.
  const w = windowOf(first.id);
  assert.deepEqual([w.possible, w.max_minutes, w.until_time, w.reason, w.next], [true, 60, '17:00', null, null]);
});

test('fenêtre : une séance terminée ou annulée n’a rien à prolonger', async () => {
  const done = await book({ start_time: '14:00', duration_min: 60 });
  ok(await manager.post(`/api/reservations/${done.id}/finish`));
  const cancelled = await book({ member_id: members[1].id, start_time: '18:00', duration_min: 60 });
  ok(await manager.post(`/api/reservations/${cancelled.id}/cancel`, { reason: 'Annulation de test' }));
  const nothing = { possible: false, max_minutes: 0, until_time: null, until_at: null, reason: null, next: null };
  for (const id of [done.id, cancelled.id]) {
    assert.deepEqual(windowOf(id), nothing);
    assert.deepEqual(ok(await manager.get(`/api/reservations/${id}`)).extension_window, nothing);
  }
});

test('fenêtre : une règle que la fenêtre ne connaît pas garde son message, une panne n’est pas avalée', async () => {
  const first = await book({ start_time: '14:00', duration_min: 60 });
  // A rule added to extendReservation later is told with its own words rather than hidden...
  server.club.extensionRefusal = () => conflict('REGLE_NOUVELLE', 'Le message de la règle.');
  const w = windowOf(first.id);
  assert.deepEqual([w.possible, w.reason], [false, 'Prolongation impossible : Le message de la règle.']);
  // ...and a failure that is not a refusal reaches the caller.
  server.club.planExtension = () => { throw new Error('base de données indisponible'); };
  assert.throws(() => windowOf(first.id), /base de données indisponible/);
});

test("fenêtre et prolongation d'accord", async () => {
  const cases = [
    {
      name: 'suivante à fin + 90 min',
      build: async (room) => {
        const session = await sessionIn(room, 'Zoé', '14:00', 120); // 14:00-16:00
        await sessionIn(room, 'Yann', '17:30', 60);
        return session;
      },
      expect: { max: 60, until: '17:00', code: 'BATTEMENT' },
    },
    {
      name: 'suivante à fin + 60 min',
      build: async (room) => {
        const session = await sessionIn(room, 'Zoé', '14:00', 120);
        await sessionIn(room, 'Yann', '17:00', 60);
        return session;
      },
      expect: { max: 30, until: '16:30', code: 'BATTEMENT' }, // a single step fits
    },
    {
      name: 'suivante à fin + 30 min',
      build: async (room) => {
        const session = await sessionIn(room, 'Zoé', '14:00', 120);
        await sessionIn(room, 'Yann', '16:30', 60);
        return session;
      },
      expect: {
        max: 0, code: 'BATTEMENT', reason: 'Prolongation impossible : la séance suivante commence à 16:30 (Yann Test).',
      },
    },
    {
      name: 'suivante collée, posée quand le battement était à 0',
      build: async (room) => {
        await setBooking({ gap_min: 0 });
        const session = await sessionIn(room, 'Zoé', '14:00', 120);
        await sessionIn(room, 'Yann', '16:00', 60);
        await setBooking({ gap_min: 30 });
        return session;
      },
      expect: {
        max: 0, code: 'CHEVAUCHEMENT', reason: 'Prolongation impossible : la séance suivante commence à 16:00 (Yann Test).',
      },
    },
    {
      name: 'battement à 0, suivante à fin + 60 min',
      settings: { gap_min: 0 },
      build: async (room) => {
        const session = await sessionIn(room, 'Zoé', '14:00', 120);
        await sessionIn(room, 'Yann', '17:00', 60);
        return session;
      },
      expect: { max: 60, until: '17:00', code: 'CHEVAUCHEMENT' },
    },
    {
      name: 'battement de 45 minutes, pas de 15 minutes',
      settings: { slot_min: 15, extension_step_min: 15, gap_min: 45 },
      build: async (room) => {
        const session = await sessionIn(room, 'Zoé', '14:00', 120);
        await sessionIn(room, 'Yann', '17:45', 60);
        return session;
      },
      expect: { max: 60, until: '17:00', code: 'BATTEMENT' },
    },
    {
      name: 'pas d’une heure',
      settings: { extension_step_min: 60 },
      build: async (room) => {
        const session = await sessionIn(room, 'Zoé', '14:00', 120);
        await sessionIn(room, 'Yann', '19:00', 60); // 18:30 at the latest, so 18:00 by whole hours
        return session;
      },
      expect: { max: 120, until: '18:00', code: 'BATTEMENT' },
    },
    {
      name: 'sans suivante',
      build: (room) => sessionIn(room, 'Zoé', '14:00', 120),
      expect: { max: 1320, until: '14:00', code: 'DUREE_MAXIMALE' },
    },
    {
      name: 'sans suivante, pas de 45 minutes',
      settings: { slot_min: 15, extension_step_min: 45 },
      build: (room) => sessionIn(room, 'Zoé', '14:00', 60), // 1380 minutes left, 30 steps of 45
      expect: { max: 1350, until: '13:30', code: 'DUREE_MAXIMALE' },
    },
    {
      name: 'sans suivante, pas de 4 heures',
      settings: { extension_step_min: 240 },
      build: (room) => sessionIn(room, 'Zoé', '14:00', 120),
      expect: { max: 1200, until: '12:00', code: 'DUREE_MAXIMALE' },
    },
    {
      name: 'une séance collée avant elle ne la gêne pas',
      build: async (room) => {
        await setBooking({ gap_min: 0 });
        await sessionIn(room, 'Yann', '12:00', 120);
        const session = await sessionIn(room, 'Zoé', '14:00', 60); // glued to the one before
        await setBooking({ gap_min: 120 });
        return session;
      },
      expect: { max: 1380, until: '14:00', code: 'DUREE_MAXIMALE' },
    },
    {
      name: 'un membre inscrit ailleurs plus tard',
      build: async (room) => {
        const guest = await enroll('Cam');
        const session = await sessionIn(room, 'Zoé', '14:00', 120, { attendee_ids: [guest.id] });
        await book({ room_id: (await newRoom()).id, member_id: guest.id, start_time: '17:00', duration_min: 60 });
        return session;
      },
      expect: { max: 60, until: '17:00', code: 'MEMBRE_OCCUPE' },
    },
    {
      name: 'un membre inscrit ailleurs tout de suite',
      build: async (room) => {
        const guest = await enroll('Cam');
        const session = await sessionIn(room, 'Zoé', '14:00', 120, { attendee_ids: [guest.id] });
        await book({ room_id: (await newRoom()).id, member_id: guest.id, start_time: '16:00', duration_min: 60 });
        return session;
      },
      expect: {
        max: 0, code: 'MEMBRE_OCCUPE', reason: 'Prolongation impossible : Cam Test est déjà inscrit à une autre séance à 16:00.',
      },
    },
    {
      name: 'un membre inscrit ailleurs et une suivante : la plus courte prolongation parle',
      build: async (room) => {
        const guest = await enroll('Cam');
        const session = await sessionIn(room, 'Zoé', '14:00', 120, { attendee_ids: [guest.id] });
        await book({ room_id: (await newRoom()).id, member_id: guest.id, start_time: '16:00', duration_min: 60 });
        await sessionIn(room, 'Yann', '16:30', 60); // the half hour is also too close to this one, but the server says the member first
        return session;
      },
      expect: {
        max: 0, code: 'MEMBRE_OCCUPE', reason: 'Prolongation impossible : Cam Test est déjà inscrit à une autre séance à 16:00.',
      },
    },
    {
      name: '24 heures atteintes',
      build: async (room) => {
        const session = await sessionIn(room, 'Zoé', '14:00', 120);
        ok(await extend(session.id, 1320));
        return session;
      },
      expect: { max: 0, code: 'DUREE_MAXIMALE', reason: 'Prolongation impossible : une séance ne peut pas dépasser 24 heures.' },
    },
  ];
  for (const c of cases) {
    try {
      await setBooking({ slot_min: 30, extension_step_min: 30, gap_min: 30, ...c.settings });
      const session = await c.build(await newRoom());
      await agrees(server.club, manager, session.id, c.expect);
    } catch (err) {
      err.message = `${c.name} : ${err.message}`;
      throw err;
    }
  }
});

// The club as it runs online (a Server without `lenientTariffs`): the time beyond the credit cannot be billed
// until an administrator has validated the tariff. The monthly plan is validated so that members can subscribe.
async function realClub() {
  const real = new Server({});
  await real.start();
  await real.addUser('admin', 'Admin', 'admin', 'gap-real-admin-password');
  await real.addUser('gerant', 'Gérant', 'gerant', 'gap-real-manager-password');
  const realAdmin = new Client(real);
  const realManager = new Client(real);
  await realAdmin.login('admin', 'gap-real-admin-password');
  const bundle = await realManager.login('gerant', 'gap-real-manager-password');
  const plan = bundle.plans.find((p) => p.code === 'MENSUELLE');
  ok(await realAdmin.put(`/api/plans/${plan.id}`, { price_validated: true }));
  const enrollReal = async (first_name) => {
    const member = ok(await realManager.post('/api/members', { first_name, last_name: 'Test', phone: '+000 000000' }));
    ok(await realManager.post(`/api/members/${member.id}/subscriptions`, { plan_id: plan.id, start_date: bundle.biz_today }));
    return member;
  };
  const room = bundle.rooms[0];
  const guest = await enrollReal('Zoé');
  return {
    server: real,
    admin: realAdmin,
    manager: realManager,
    enroll: enrollReal,
    book: async (patch) => ok(await realManager.post('/api/reservations', {
      member_id: guest.id, room_id: room.id, date: bundle.biz_today, start_time: '14:00', duration_min: 60, ...patch,
    })).reservation,
    agrees: (id, expected) => agrees(real.club, realManager, id, expected),
  };
}

const TARIFF_REASON = "Prolongation impossible : le tarif des heures supplémentaires n'est pas encore validé par un administrateur.";

test('fenêtre : tarif non validé, sans crédit restant', async () => {
  const real = await realClub();
  try {
    const first = await real.book({ duration_min: 120 }); // the 2 hours of credit, all of it
    assert.deepEqual(real.server.club.extensionWindow(first.id), {
      possible: false, max_minutes: 0, until_time: null, until_at: null, reason: TARIFF_REASON, next: null,
    });
    await real.agrees(first.id, { max: 0, code: 'TARIF_NON_VALIDE', reason: TARIFF_REASON });
  } finally {
    real.server.destroy();
  }
});

test('fenêtre : tarif non validé, 60 min de crédit restant', async () => {
  const real = await realClub();
  try {
    const first = await real.book({ duration_min: 60 }); // 14:00-15:00, an hour of credit left
    assert.deepEqual(real.server.club.extensionWindow(first.id), {
      possible: true, max_minutes: 60, until_time: '16:00', until_at: isoOf(first.end_ms + 60 * MIN), reason: null, next: null,
    });
    await real.agrees(first.id, { max: 60, until: '16:00', code: 'TARIF_NON_VALIDE' });
    // Once an administrator has validated the tariff, a booking made after that is no longer limited by its credit...
    ok(await real.admin.put('/api/settings', { overtime_tariff: { hour: 25000 * UM, half: 15000 * UM, validated: true } }));
    const yann = await real.enroll('Yann');
    const later = await real.book({ member_id: yann.id, start_time: '20:00', duration_min: 60 }); // 60 minutes of credit left
    await real.agrees(later.id, { max: 1380, until: '20:00', code: 'DUREE_MAXIMALE' });
    // ... while the one made before keeps the tariff it was booked with, as the server does.
    await real.agrees(first.id, { max: 0, code: 'TARIF_NON_VALIDE', reason: TARIFF_REASON });
  } finally {
    real.server.destroy();
  }
});

test('fenêtre : tarif non validé et séance suivante trop proche, la salle est citée avant le tarif', async () => {
  const real = await realClub();
  try {
    const first = await real.book({ duration_min: 120 }); // no credit left, 14:00-16:00
    const yann = await real.enroll('Yann');
    await real.book({ member_id: yann.id, start_time: '16:30', duration_min: 60 });
    // The server looks at the room before the tariff, and so does the window.
    await real.agrees(first.id, {
      max: 0, code: 'BATTEMENT', reason: 'Prolongation impossible : la séance suivante commence à 16:30 (Yann Test).',
    });
  } finally {
    real.server.destroy();
  }
});

test('fenêtre : exposée', async () => {
  const first = await book({ start_time: '14:00', duration_min: 120 }); // 14:00-16:00
  await book({ member_id: members[1].id, start_time: '17:30', duration_min: 60 });
  const expected = {
    possible: true, max_minutes: 60, until_time: '17:00', until_at: isoOf(first.end_ms + 60 * MIN), reason: null,
    next: { member_name: 'Bruno Test', start_time: '17:30' },
  };
  // On the booking's page, started or not.
  assert.deepEqual(ok(await manager.get(`/api/reservations/${first.id}`)).extension_window, expected);
  // On the card of the room, once the session has started.
  ok(await manager.post(`/api/reservations/${first.id}/start`));
  const dashboard = ok(await manager.get('/api/dashboard'));
  const status = (room) => dashboard.rooms_status.find((rm) => rm.id === room.id);
  assert.deepEqual(status(rooms[0]).current.extension_window, expected);
  assert.equal(status(rooms[1]).current, null);
  // And in what every action on the booking answers: the extension itself.
  const extended = ok(await extend(first.id, 60));
  assert.equal(extended.reservation.end_time, '17:00');
  assert.deepEqual(extended.extension_window, {
    possible: false, max_minutes: 0, until_time: null, until_at: null,
    reason: 'Prolongation impossible : la séance suivante commence à 17:30 (Bruno Test).',
    next: { member_name: 'Bruno Test', start_time: '17:30' },
  });
});
