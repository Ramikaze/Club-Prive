// The gap between two bookings of the same room (settings booking.gap_min, 30 minutes by default),
// checked on the server when a booking is created, extended or moved to another room.
import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { Server, Client, ok } from './harness.js';

let server, admin, manager, rooms, members, today;

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
  // The club opens with a single room; these scenarios add two more.
  for (const [name, capacity] of [['Salon VIP', 6], ['Petit Salon', 4]]) ok(await admin.post('/api/rooms', { name, capacity }));
  rooms = ok(await manager.get('/api/rooms'));
  members = [];
  for (const first_name of ['Alice', 'Bruno', 'Camille']) {
    const member = ok(await manager.post('/api/members', { first_name, last_name: 'Test', phone: '+000 000000' }));
    ok(await manager.post(`/api/members/${member.id}/subscriptions`, {
      plan_id: bundle.plans.find((p) => p.code === 'MENSUELLE').id, start_date: today,
    }));
    members.push(member);
  }
});
afterEach(() => server.destroy());

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
  assert.equal(
    refused.message,
    "Il faut 30 minutes entre deux réservations : la séance suivante commence à 16:30, la prolongation peut aller jusqu'à 16:00 au plus tard.",
  );
  assert.deepEqual(refused.details.conflicts.map((r) => r.member_name), ['Bruno Test']);
  assert.equal(ok(await manager.get(`/api/reservations/${first.id}`)).reservation.duration_min, 120);
});

test('battement : prolongation, le message donne la fin la plus tardive', async () => {
  await setBooking({ gap_min: 120 });
  const first = await book({ start_time: '14:00', duration_min: 60 }); // 14:00-15:00
  await book({ member_id: members[1].id, start_time: '18:00', duration_min: 60 }); // 18:00-19:00
  assert.equal(ok(await extend(first.id, 30)).reservation.end_time, '15:30');
  const refused = rejected(await extend(first.id, 60), 'BATTEMENT'); // would end at 16:30, 90 minutes before 18:00
  assert.equal(
    refused.message,
    "Il faut 2 h entre deux réservations : la séance suivante commence à 18:00, la prolongation peut aller jusqu'à 16:00 au plus tard.",
  );
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
  assert.equal(ok(await extend(second.id, 30)).reservation.end_time, '15:30');
});

test('battement : devis', async () => {
  const first = await book({ start_time: '14:00', duration_min: 120 }); // 14:00-16:00
  const quote = ok(await manager.post('/api/reservations/quote', request({ member_id: members[1].id, start_time: '16:00' })));
  assert.deepEqual(quote.conflicts, []);
  assert.deepEqual(quote.gap_conflicts.map((r) => r.id), [first.id]);
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
    "Il faut 30 minutes entre deux réservations : la séance suivante commence à 19:00, la prolongation peut aller jusqu'à 18:00 au plus tard.",
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
