import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { addDays, localToUtcMs } from '../shared/time.js';
import { seedDemo } from '../worker/seed.js';
import { Server, Client, ok } from './harness.js';

let server, admin, manager, rooms, members, today;

beforeEach(async () => {
  server = new Server({}, { lenientTariffs: true });
  await server.start();
  await server.addUser('admin', 'Admin', 'admin', 'rooms-admin-password');
  await server.addUser('gerant', 'Gérant', 'gerant', 'rooms-manager-password');
  admin = new Client(server);
  manager = new Client(server);
  await admin.login('admin', 'rooms-admin-password');
  const bundle = await manager.login('gerant', 'rooms-manager-password');
  today = bundle.biz_today;
  // The club opens with a single room; these scenarios add two more to cover moves between rooms.
  assert.equal(bundle.rooms.length, 1);
  for (const [name, capacity] of [['Salon VIP', 6], ['Petit Salon', 4]]) ok(await admin.post('/api/rooms', { name, capacity }));
  rooms = ok(await manager.get('/api/rooms'));
  members = [];
  for (const first_name of ['Alice', 'Bruno', 'Camille']) {
    const member = ok(await manager.post('/api/members', { first_name, last_name: 'Test', phone: '+000 000000' }));
    const sub = ok(await manager.post(`/api/members/${member.id}/subscriptions`, {
      plan_id: bundle.plans.find((p) => p.code === 'MENSUELLE').id, start_date: today,
    }));
    members.push({ ...member, subId: sub.subscription_id });
  }
});
afterEach(() => server.destroy());

const request = (patch = {}) => ({ member_id: members[0].id, room_id: rooms[0].id, date: today, start_time: '15:00', duration_min: 60, ...patch });
const book = async (patch = {}) => ok(await manager.post('/api/reservations', request(patch))).reservation;
const credit = (member) => server.club.credit(server.club.get('SELECT * FROM subscriptions WHERE id = ?', member.subId), today);
const rejected = (response, code) => {
  assert.equal(response.status, 409, JSON.stringify(response.data));
  assert.equal(response.data.error.code, code);
};

test('salles : seul un administrateur peut modifier la configuration', async () => {
  assert.equal((await manager.post('/api/rooms', { name: 'Interdite' })).status, 403);
  assert.equal((await manager.put(`/api/rooms/${rooms[0].id}`, { capacity: 1 })).status, 403);
  assert.equal((await manager.del(`/api/rooms/${rooms[0].id}`)).status, 403);
  assert.equal(ok(await manager.get('/api/rooms')).length, rooms.length);
  assert.equal((await admin.post('/api/rooms', { name: 'Vide', capacity: '' })).status, 400);
});

test('capacité : devis, création et modification comptent toutes les personnes', async () => {
  const room = ok(await admin.post('/api/rooms', { name: 'Duo', capacity: 2 })).room;
  for (const path of ['/api/reservations/quote', '/api/reservations']) {
    rejected(await manager.post(path, request({ room_id: room.id, party_size: 3 })), 'CAPACITE_DEPASSEE');
    rejected(await manager.post(path, request({ room_id: room.id, party_size: 3, attendee_ids: [members[1].id] })), 'CAPACITE_DEPASSEE');
  }
  const res = await book({ room_id: room.id, party_size: 2 });
  rejected(await manager.put(`/api/reservations/${res.id}/occupancy`, { party_size: 3 }), 'CAPACITE_DEPASSEE');
  rejected(await manager.post(`/api/reservations/${res.id}/attendees`, { member_id: members[1].id }), 'CAPACITE_DEPASSEE');
  assert.equal(credit(members[1]).committed, 0);
});

test('effectif : les invités restent comptés lors de l’ajout et du retrait d’un membre', async () => {
  const res = await book({ party_size: 3 });
  const added = ok(await manager.post(`/api/reservations/${res.id}/attendees`, { member_id: members[1].id })).reservation;
  assert.equal(added.party_size, 4);
  rejected(await manager.put(`/api/reservations/${res.id}/occupancy`, { party_size: 1 }), 'EFFECTIF_INVALIDE');
  const removed = ok(await manager.del(`/api/reservations/${res.id}/attendees/${members[1].id}`)).reservation;
  assert.equal(removed.party_size, 3);
  assert.equal(credit(members[1]).committed, 0);
});

test('occupation : transfert vers une salle trop petite et modification après clôture refusés', async () => {
  const small = ok(await admin.post('/api/rooms', { name: 'Solo', capacity: 1 })).room;
  const res = await book({ attendee_ids: [members[1].id] });
  rejected(await manager.put(`/api/reservations/${res.id}/occupancy`, { room_id: small.id }), 'CAPACITE_DEPASSEE');
  ok(await manager.post(`/api/reservations/${res.id}/finish`));
  rejected(await manager.put(`/api/reservations/${res.id}/occupancy`, { party_size: 1 }), 'STATUT');
});

test('disponibilité membre : titulaire et accompagnant ne peuvent occuper deux salles simultanément', async () => {
  const res = await book({ attendee_ids: [members[1].id] });
  for (const member of [members[0], members[1]]) {
    rejected(await manager.post('/api/reservations', request({ room_id: rooms[1].id, member_id: member.id })), 'MEMBRE_OCCUPE');
    rejected(await manager.post('/api/reservations/quote', request({ room_id: rooms[1].id, member_id: members[2].id, attendee_ids: [member.id] })), 'MEMBRE_OCCUPE');
  }
  const other = await book({ room_id: rooms[1].id, member_id: members[2].id });
  rejected(await manager.post(`/api/reservations/${other.id}/attendees`, { member_id: members[1].id }), 'MEMBRE_OCCUPE');
  assert.equal(credit(members[1]).committed, 0);
  ok(await manager.post(`/api/reservations/${res.id}/cancel`, { reason: 'Changement de salle' }));
  ok(await manager.post(`/api/reservations/${other.id}/attendees`, { member_id: members[1].id }));
});

test('prolongation : disponibilité de chaque participant vérifiée et créneaux contigus autorisés', async () => {
  const res = await book({ attendee_ids: [members[1].id] });
  await book({ room_id: rooms[1].id, member_id: members[1].id, start_time: '16:00' });
  for (const suffix of ['/extend/quote', '/extend']) {
    rejected(await manager.post(`/api/reservations/${res.id}${suffix}`, { minutes: 30 }), 'MEMBRE_OCCUPE');
  }
  assert.equal(ok(await manager.get(`/api/reservations/${res.id}`)).reservation.duration_min, 60);
  assert.equal(credit(members[0]).committed, 60);
});

// Credit movements of a member's plan, whatever the booking.
const movements = (member) => server.club.all('SELECT kind, minutes FROM credit_movements WHERE subscription_id = ?', member.subId).map((m) => ({ ...m }));

test('membres présents : jamais débités, à la réservation, à l’entrée, en prolongation ou à la clôture', async () => {
  const res = await book({ attendee_ids: [members[1].id] });
  // Booking with an attendee: only the holder's plan is engaged; the attendee row keeps who was there.
  assert.equal(credit(members[0]).committed, 60);
  assert.deepEqual(movements(members[1]), []);
  assert.deepEqual({ ...server.club.get('SELECT subscription_id, included_minutes FROM reservation_attendees WHERE reservation_id = ?', res.id) },
    { subscription_id: null, included_minutes: 0 });
  assert.deepEqual(res.attendees.map((a) => [a.member_id, a.included_minutes]), [[members[0].id, 60], [members[1].id, undefined]]);
  ok(await manager.post(`/api/reservations/${res.id}/extend`, { minutes: 30 }));
  assert.equal(credit(members[0]).committed, 90);
  ok(await manager.del(`/api/reservations/${res.id}/attendees/${members[1].id}`));
  const headers = { 'idempotency-key': 'return-to-room-once' };
  for (let n = 0; n < 2; n += 1) {
    ok(await manager.post(`/api/reservations/${res.id}/attendees`, { member_id: members[1].id }, headers));
  }
  // On entry in the room as well (« Membre (n/N) »): nothing of the member's is taken.
  ok(await manager.post(`/api/reservations/${res.id}/attendees`, { member_id: members[2].id }));
  ok(await manager.post(`/api/reservations/${res.id}/finish`));
  assert.equal(ok(await manager.get(`/api/members/${members[1].id}`)).reservations[0].id, res.id);
  // Finishing consumes the holder's minutes alone.
  assert.deepEqual([credit(members[0]).committed, credit(members[0]).consumed, credit(members[0]).available], [0, 90, 30]);
  for (const member of members.slice(1)) {
    assert.deepEqual(movements(member), []);
    assert.equal(credit(member).available, 120);
  }
});

test('membres présents : un membre sans formule ni crédit peut entrer, sans aucun débit', async () => {
  ok(await admin.post(`/api/subscriptions/${members[1].subId}/adjust`, { minutes: -120, reason: 'Crédit épuisé (test)' }));
  const dora = ok(await manager.post('/api/members', { first_name: 'Dora', last_name: 'Test', phone: '+000 000001' }));
  const quote = ok(await manager.post('/api/reservations/quote', request({ attendee_ids: [members[1].id, dora.id] })));
  assert.deepEqual(quote.extra_attendees.map((a) => a.id), [members[1].id, dora.id]);
  assert.equal(quote.extra_attendees.some((a) => 'included_minutes' in a || 'credit_available' in a), false);
  const res = await book({ attendee_ids: [dora.id] });
  const added = ok(await manager.post(`/api/reservations/${res.id}/attendees`, { member_id: members[1].id })).reservation;
  assert.deepEqual(added.attendees.map((a) => a.member_id), [members[0].id, dora.id, members[1].id]);
  assert.equal(movements(members[1]).filter((m) => m.kind !== 'ajustement').length, 0);
  ok(await manager.post(`/api/reservations/${res.id}/cancel`, { reason: 'Annulation (test)' }));
  assert.equal(movements(members[1]).filter((m) => m.kind !== 'ajustement').length, 0);
  assert.equal(credit(members[0]).available, 120);
});

test('membres présents : au démarrage, le crédit encore engagé sur une séance active est rendu une seule fois', async () => {
  const active = await book({ attendee_ids: [members[1].id] });
  const done = await book({ attendee_ids: [members[2].id], room_id: rooms[1].id, member_id: members[0].id, start_time: '17:00' });
  // What the live database holds from before the rule: attendees with engaged credit, one booking finished since.
  const legacy = (res, member, kind) => {
    server.club.run('UPDATE reservation_attendees SET subscription_id = ?, included_minutes = 60 WHERE reservation_id = ? AND member_id = ?', member.subId, res.id, member.id);
    server.club.creditMove(null, member.subId, res.id, 'engagement', 60, 'Présence en salle (ancien)');
    if (kind) server.club.creditMove(null, member.subId, res.id, kind, 60, 'Réservation terminée (présence en salle)');
  };
  legacy(active, members[1]);
  legacy(done, members[2], 'consommation');
  server.club.run("UPDATE reservations SET status = 'terminee' WHERE id = ?", done.id);
  server.club.run("DELETE FROM meta WHERE key = 'attendees_not_debited'");
  assert.equal(credit(members[1]).committed, 60);
  for (let n = 0; n < 2; n += 1) await server.restart();
  assert.deepEqual(server.club.all("SELECT minutes, reason FROM credit_movements WHERE subscription_id = ? AND kind = 'liberation'", members[1].subId).map((m) => ({ ...m })),
    [{ minutes: 60, reason: 'Membres présents : plus de débit' }]);
  assert.deepEqual([credit(members[1]).committed, credit(members[1]).available], [0, 120]);
  assert.equal(server.club.get('SELECT included_minutes FROM reservation_attendees WHERE reservation_id = ?', active.id).included_minutes, 0);
  // The finished booking keeps its history.
  assert.equal(server.club.get('SELECT included_minutes FROM reservation_attendees WHERE reservation_id = ?', done.id).included_minutes, 60);
  assert.deepEqual([credit(members[2]).consumed, credit(members[2]).available], [60, 60]);
});

test('concurrence : un seul engagement pour le même membre dans deux salles', async () => {
  const results = await Promise.all(rooms.slice(0, 2).map((room) => manager.post('/api/reservations', request({ room_id: room.id }))));
  assert.deepEqual(results.map((r) => r.status).sort(), [200, 409]);
  rejected(results.find((r) => r.status === 409), 'MEMBRE_OCCUPE');
  assert.equal(credit(members[0]).committed, 60);
});

test('abonnement : celui du titulaire est retenu par sa réservation active, pas celui d’un membre présent', async () => {
  const res = await book({ attendee_ids: [members[1].id] });
  rejected(await admin.post(`/api/subscriptions/${members[0].subId}/cancel`, { reason: 'Demande du membre' }), 'RESERVATIONS_ACTIVES');
  ok(await admin.post(`/api/subscriptions/${members[1].subId}/cancel`, { reason: 'Demande du membre' }));
  ok(await manager.post(`/api/reservations/${res.id}/cancel`, { reason: 'Annulation collective' }));
  assert.equal(credit(members[0]).available, 120);
  ok(await admin.post(`/api/subscriptions/${members[0].subId}/cancel`, { reason: 'Demande du membre' }));
});

test('configuration : capacité et fermeture respectent les réservations actives', async () => {
  const res = await book({ party_size: 4 });
  rejected(await admin.put(`/api/rooms/${rooms[0].id}`, { capacity: 3 }), 'CAPACITE_DEPASSEE');
  rejected(await admin.put(`/api/rooms/${rooms[0].id}`, { active: false }), 'RESERVATIONS_ACTIVES');
  rejected(await admin.del(`/api/rooms/${rooms[0].id}`), 'RESERVATIONS_ACTIVES');
  ok(await manager.post(`/api/reservations/${res.id}/cancel`, { reason: 'Fermeture du salon' }));
  ok(await admin.put(`/api/rooms/${rooms[0].id}`, { active: false, capacity: 3 }));
});

test('suppression de salle : historique conservé, aucune réaffectation et dernière salle active protégée', async () => {
  const first = await book();
  const second = await book({ member_id: members[1].id, room_id: rooms[1].id });
  for (const res of [first, second]) ok(await manager.post(`/api/reservations/${res.id}/finish`));
  ok(await admin.del(`/api/rooms/${rooms[0].id}`));
  assert.equal(ok(await admin.get('/api/rooms?all=1')).some((r) => r.id === rooms[0].id), false);
  const historical = ok(await manager.get(`/api/reservations/${first.id}`)).reservation;
  assert.equal(historical.room_id, rooms[0].id);
  assert.equal(historical.room_name, rooms[0].name);
  assert.equal((await admin.put(`/api/rooms/${rooms[0].id}`, { active: true })).status, 404);
  ok(await admin.put(`/api/rooms/${rooms[2].id}`, { active: false }));
  rejected(await admin.del(`/api/rooms/${rooms[1].id}`), 'DERNIERE_SALLE');
  await server.restart();
  assert.equal(ok(await manager.get(`/api/reservations/${first.id}`)).reservation.room_name, rooms[0].name);
});

test('accès salle : le titulaire doit avoir carte active, formule et crédit ; un membre présent, une carte active', async () => {
  // Bruno : crédit épuisé par un ajustement administrateur.
  ok(await admin.post(`/api/subscriptions/${members[1].subId}/adjust`, { minutes: -credit(members[1]).available, reason: 'Crédit épuisé (test)' }));
  assert.equal(credit(members[1]).available, 0);
  // Camille : carte désactivée (carte virtuelle émise automatiquement à la création du membre).
  const camille = ok(await manager.get(`/api/members/${members[2].id}`));
  assert.equal(camille.cards.length, 1);
  assert.equal(camille.can_enter_room, true);
  ok(await manager.post(`/api/cards/${camille.cards[0].id}/deactivate`, { reason: 'Carte perdue' }));
  // Dora : membre sans formule.
  const dora = ok(await manager.post('/api/members', { first_name: 'Dora', last_name: 'Test', phone: '+000 000001' }));

  const eligibility = Object.fromEntries(ok(await manager.get('/api/members')).map((m) => [m.first_name, m.can_enter_room]));
  assert.deepEqual(eligibility, { Alice: true, Bruno: false, Camille: false, Dora: false });
  assert.equal(ok(await manager.get(`/api/members/${members[1].id}`)).can_enter_room, false);

  // Réservation directe au nom d'un membre non éligible.
  rejected(await manager.post('/api/reservations', request({ member_id: members[1].id, require_credit: true })), 'CREDIT_EPUISE');
  rejected(await manager.post('/api/reservations', request({ member_id: members[2].id, require_credit: true })), 'CARTE_DESACTIVEE');
  rejected(await manager.post('/api/reservations', request({ member_id: dora.id, require_credit: true })), 'ABONNEMENT_INVALIDE');

  // Membres présents : ni formule ni crédit demandés (seul le titulaire est débité), mais une carte désactivée
  // reste refusée, à la création comme au devis.
  rejected(await manager.post('/api/reservations/quote', request({ attendee_ids: [members[2].id] })), 'CARTE_DESACTIVEE');
  rejected(await manager.post('/api/reservations', request({ attendee_ids: [members[2].id] })), 'CARTE_DESACTIVEE');
  assert.equal(credit(members[0]).committed, 0, 'aucune réservation partielle créée');

  // Ajout en direct dans une salle occupée : Bruno (crédit épuisé) et Dora (sans formule) entrent sans débit.
  const res = await book({ require_credit: true });
  rejected(await manager.post(`/api/reservations/${res.id}/attendees`, { member_id: members[2].id }), 'CARTE_DESACTIVEE');
  for (const id of [members[1].id, dora.id]) ok(await manager.post(`/api/reservations/${res.id}/attendees`, { member_id: id }));
  const detail = ok(await manager.get(`/api/reservations/${res.id}`)).reservation;
  assert.deepEqual(detail.attendees.map((a) => a.member_id), [members[0].id, members[1].id, dora.id]);
  assert.deepEqual([credit(members[1]).committed, credit(members[1]).available], [0, 0]);
  assert.equal(credit(members[0]).committed, 60);
});

test('consommations : chaque bouteille ou cigare est attribué au membre présent qui l’a pris', async () => {
  const cigar = ok(await admin.post('/api/products', { category: 'cigare', name: 'Robusto test', reference: 'T-ROB', price: 1000000, initial_stock: 10 })).id;
  const whisky = ok(await admin.post('/api/products', { category: 'bouteille', name: 'Whisky test', reference: 'T-WHI', price: 4000000, initial_stock: 10 })).id;
  const res = await book();
  ok(await manager.post(`/api/reservations/${res.id}/attendees`, { member_id: members[1].id }));
  ok(await manager.post(`/api/reservations/${res.id}/start`));
  ok(await manager.post(`/api/reservations/${res.id}/items`, { product_id: cigar, quantity: 2 }));
  ok(await manager.post(`/api/reservations/${res.id}/items`, { product_id: whisky, quantity: 1, consumer_member_id: members[1].id }));
  const absent = await manager.post(`/api/reservations/${res.id}/items`, { product_id: cigar, quantity: 1, consumer_member_id: members[2].id });
  assert.equal(absent.status, 400);
  assert.equal(absent.data.error.code, 'MEMBRE_ABSENT');

  // Billing stays with the holder; the consumer is kept per line.
  const lines = ok(await manager.get(`/api/reservations/${res.id}`)).charges.filter((c) => c.kind === 'produit');
  assert.deepEqual(lines.map((c) => [c.label, c.member_id, c.consumer_member_id, c.consumer_name]), [
    ['Robusto test', members[0].id, members[0].id, 'Alice TEST'],
    ['Whisky test', members[0].id, members[1].id, 'Bruno TEST'],
  ]);
  const room = ok(await manager.get('/api/dashboard')).rooms_status.find((rm) => rm.id === res.room_id);
  assert.deepEqual(room.current.consumptions.map((c) => [c.account, c.consumer_name, c.amount]), [
    ['cigares', 'Alice TEST', 2000000],
    ['alcool', 'Bruno TEST', 4000000],
  ]);

});

test('désactivation d’un membre : historique conservé, accès bloqué, réactivation possible', async () => {
  const cigar = ok(await admin.post('/api/products', { category: 'cigare', name: 'Robusto test', reference: 'T-ROB', price: 1000000, initial_stock: 10 })).id;
  const bruno = members[1];
  const res = await book({ member_id: bruno.id });
  ok(await manager.post(`/api/reservations/${res.id}/start`));
  const detail = ok(await manager.post(`/api/reservations/${res.id}/items`, { product_id: cigar, quantity: 1 }));
  ok(await manager.post('/api/payments', { charge_ids: detail.charges.map((c) => c.id), method: 'Espèces' }));

  // Not while the member is in a session in progress or to come.
  rejected(await manager.post(`/api/members/${bruno.id}/deactivate`, { reason: 'Départ du club' }), 'RESERVATIONS_ACTIVES');
  ok(await manager.post(`/api/reservations/${res.id}/finish`));
  assert.equal((await manager.post(`/api/members/${bruno.id}/deactivate`, {})).status, 400); // a reason is required
  const off = ok(await manager.post(`/api/members/${bruno.id}/deactivate`, { reason: 'Départ du club' }));
  assert.equal(off.active, false);
  assert.equal(off.deactivation_reason, 'Départ du club');
  assert.equal(off.deactivated_by_name, 'Gérant');
  assert.equal(off.can_enter_room, false);

  // Everything stays: payments, lines, bookings; the member leaves the default list only.
  assert.equal(off.payments.length, 1);
  assert.ok(off.charges.some((c) => c.label === 'Robusto test' && c.status === 'payee'));
  assert.ok(off.reservations.some((r) => r.id === res.id));
  assert.ok(!ok(await manager.get('/api/members')).some((m) => m.id === bruno.id));
  assert.deepEqual(ok(await manager.get('/api/members?statut=desactives')).map((m) => m.id), [bruno.id]);
  rejected(await manager.post('/api/reservations', request({ member_id: bruno.id, start_time: '18:00' })), 'MEMBRE_DESACTIVE');
  rejected(await manager.post(`/api/members/${bruno.id}/cards`, { kind: 'virtuelle' }), 'MEMBRE_DESACTIVE');
  assert.equal((await manager.del(`/api/members/${bruno.id}`)).status, 405); // deletion no longer exists

  const back = ok(await manager.post(`/api/members/${bruno.id}/reactivate`));
  assert.equal(back.active, true);
  assert.ok(ok(await manager.get('/api/members')).some((m) => m.id === bruno.id));
  ok(await manager.post('/api/reservations', request({ member_id: bruno.id, start_time: '18:00' })));
});

test('démonstration : une séance est déjà en cours au chargement, avec les consommations de chaque membre', async () => {
  ok(await admin.post('/api/admin/reset', { confirm: 'EFFACER' }));
  const author = server.club.userRow(ok(await admin.get('/api/me')).user.id);
  const realNow = Date.now;
  const loadedAt = localToUtcMs(today, '15:10', server.club.settings().timezone);
  Date.now = () => loadedAt;
  try {
    seedDemo(server.club, { actor: author });
    const live = ok(await manager.get('/api/dashboard')).rooms_status.filter((rm) => rm.current?.status === 'en_cours');
    assert.equal(live.length, 1, JSON.stringify(live.map((rm) => rm.name)));
    const session = live[0].current;
    assert.ok(Date.parse(session.started_at) < loadedAt && session.end_ms > loadedAt);
    assert.equal(session.attendees.length, 2);
    const byMember = new Map();
    for (const line of session.consumptions) {
      byMember.set(line.consumer_member_id, (byMember.get(line.consumer_member_id) ?? new Set()).add(line.account));
    }
    assert.deepEqual([...byMember.keys()].sort(), session.attendees.map((a) => a.member_id).sort());
    for (const accounts of byMember.values()) assert.deepEqual([...accounts].sort(), ['alcool', 'cigares']);
  } finally {
    Date.now = realNow;
  }
});

test('salle unique : une fois, les autres salles sont retirées et leurs réservations à venir passent au salon', async () => {
  const [main, vip, petit] = rooms;
  const historyVip = await book({ room_id: vip.id, start_time: '11:00' });
  const historyPetit = await book({ room_id: petit.id, member_id: members[1].id, start_time: '12:00' });
  for (const r of [historyVip, historyPetit]) ok(await manager.post(`/api/reservations/${r.id}/finish`));
  const toMove = await book({ room_id: petit.id, member_id: members[1].id, start_time: '16:00' });
  await book({ room_id: main.id, start_time: '20:00' });
  const stuck = await book({ room_id: vip.id, member_id: members[2].id, start_time: '20:00' }); // the main room is taken then

  server.club.run("DELETE FROM meta WHERE key = 'single_room'"); // as on a database from before the single-room rule
  await server.restart();
  assert.deepEqual(ok(await manager.get('/api/rooms')).map((r) => r.id), [main.id, vip.id]);
  assert.equal(ok(await manager.get(`/api/reservations/${toMove.id}`)).reservation.room_id, main.id);
  assert.equal(ok(await manager.get(`/api/reservations/${stuck.id}`)).reservation.room_id, vip.id);
  assert.equal(ok(await manager.get(`/api/reservations/${historyPetit.id}`)).reservation.room_name, petit.name);

  ok(await manager.post(`/api/reservations/${stuck.id}/cancel`, { reason: 'Salle unique' }));
  await server.restart(); // runs only once: the room the club keeps open is left alone
  assert.deepEqual(ok(await manager.get('/api/rooms')).map((r) => r.id), [main.id, vip.id]);
});

test('le vrai club n’est jamais en mode démonstration : le bundle annonce demo à faux', async () => {
  const real = new Server(); // without lenientTariffs: the club as it runs online
  await real.start();
  try {
    await real.addUser('essai', 'Essai', 'admin', 'real-club-password');
    const realAdmin = new Client(real);
    await realAdmin.login('essai', 'real-club-password');
    assert.equal(ok(await realAdmin.get('/api/me')).demo, false);
  } finally {
    real.destroy();
  }
});

test('vendredi et samedi à partir de 18 h : une réservation dure au moins 2 heures', async () => {
  const booking = server.club.settings().booking;
  assert.equal((await admin.put('/api/settings', { booking: { ...booking, weekend_min_duration_min: 30 } })).status, 400);
  ok(await admin.put('/api/settings', { booking: { ...booking, weekend_min_duration_min: 120 } }));
  const weekday = (d) => new Date(`${d}T12:00:00Z`).getUTCDay();
  let friday = addDays(today, 1);
  while (weekday(friday) !== 5) friday = addDays(friday, 1);
  const saturday = addDays(friday, 1);
  const sunday = addDays(friday, 2);
  const minimum = (r) => assert.equal(r.data.error?.code, 'DUREE_MINIMALE', JSON.stringify(r.data));
  // Friday afternoon is the week; from 18:00, and through the night, the evening minimum applies.
  ok(await manager.post('/api/reservations', request({ date: friday, start_time: '15:00', duration_min: 60 })));
  const evening = await manager.post('/api/reservations', request({ date: friday, start_time: '18:00', duration_min: 60, member_id: members[1].id }));
  minimum(evening);
  assert.match(evening.data.error.message, /vendredi et le samedi à partir de 18 h/);
  ok(await manager.post('/api/reservations', request({ date: friday, start_time: '18:00', duration_min: 120, member_id: members[1].id })));
  minimum(await manager.post('/api/reservations', request({ date: friday, start_time: '01:00', duration_min: 60, member_id: members[2].id })));
  minimum(await manager.post('/api/reservations', request({ date: saturday, start_time: '22:00', duration_min: 90 })));
  // Saturday afternoon and Sunday evening keep the usual minimum.
  ok(await manager.post('/api/reservations', request({ date: saturday, start_time: '15:00', duration_min: 60 })));
  ok(await manager.post('/api/reservations', request({ date: sunday, start_time: '20:00', duration_min: 60, member_id: members[2].id })));
});

test('acompte : 3 h ou plus avec du temps payant, 50 % tout de suite, le solde avant l’entrée, annulable jusqu’à la veille', async () => {
  const UM = 100;
  const method = server.club.settings().payment_methods[0];
  // Alice has 2 h of credit: a 4 h booking has 2 h of paid time, 50 000, so a 25 000 deposit.
  const req = request({ date: addDays(today, 3), start_time: '19:00', duration_min: 240 });
  const quote = ok(await manager.post('/api/reservations/quote', req));
  assert.deepEqual([quote.supplement_amount, quote.deposit_amount, quote.balance_amount], [50000 * UM, 25000 * UM, 25000 * UM]);
  const noDeposit = await manager.post('/api/reservations', req);
  assert.equal(noDeposit.status, 400);
  assert.equal(noDeposit.data.error.code, 'ACOMPTE_REQUIS');
  const booked = ok(await manager.post('/api/reservations', { ...req, deposit_method: method }));
  const timeLines = (d) => d.charges.filter((c) => c.kind === 'temps_supplementaire').map((c) => [c.deposit, c.status, c.amount]);
  assert.deepEqual(timeLines(booked), [[true, 'payee', 25000 * UM], [false, 'due', 25000 * UM]]);
  assert.equal(booked.reservation.deposit_amount, 25000 * UM);

  // Before the day the member can cancel: the deposit stays with the club, the balance is cancelled.
  const cancelled = ok(await manager.post(`/api/reservations/${booked.reservation.id}/cancel`, { reason: 'Changement de programme' }));
  assert.equal(cancelled.deposit_kept, 25000 * UM);
  assert.deepEqual(timeLines(cancelled), [[true, 'payee', 25000 * UM], [false, 'annulee', 25000 * UM]]);
  rejected(await manager.post(`/api/reservations/${booked.reservation.id}/cancel`, { reason: 'Deux fois' }), 'STATUT');

  // Entering the room needs the balance paid.
  const bruno = ok(await manager.post('/api/reservations', {
    ...request({ member_id: members[1].id, date: addDays(today, 4), start_time: '19:00', duration_min: 180 }), deposit_method: method,
  }));
  rejected(await manager.post(`/api/reservations/${bruno.reservation.id}/start`), 'SOLDE_REQUIS');
  const balance = bruno.charges.find((c) => c.kind === 'temps_supplementaire' && c.status === 'due');
  ok(await manager.post('/api/payments', { charge_ids: [balance.id], method }));
  assert.equal(ok(await manager.post(`/api/reservations/${bruno.reservation.id}/start`)).reservation.status, 'en_cours');

  // On the day it can no longer be cancelled: only the absence is recorded, and only the deposit is lost.
  const tonight = ok(await manager.post('/api/reservations', {
    ...request({ member_id: members[2].id, date: today, start_time: '23:30', duration_min: 180 }), deposit_method: method,
  }));
  assert.equal(tonight.reservation.late_cancellation, true);
  rejected(await manager.post(`/api/reservations/${tonight.reservation.id}/cancel`, { reason: 'Imprévu' }), 'ANNULATION_TARDIVE');
  const absent = ok(await manager.post(`/api/reservations/${tonight.reservation.id}/cancel`, { reason: 'Membre absent', no_show: true }));
  assert.equal(absent.reservation.status, 'annulee');
  assert.match(absent.reservation.cancel_reason, /^Absence/);
  assert.equal(absent.deposit_kept, tonight.reservation.deposit_amount);
  assert.equal(absent.released_minutes, 120);
  const early = await manager.post(`/api/reservations/${bruno.reservation.id}/cancel`, { reason: 'Membre absent', no_show: true });
  assert.notEqual(early.status, 200);
});

test('séance en cours : le crédit temps de la carte à décompter est connu', async () => {
  const before = credit(members[0]).available;
  const booked = await book({ duration_min: 60 });
  const res = ok(await manager.post(`/api/reservations/${booked.id}/start`, {})).reservation;
  assert.equal(res.status, 'en_cours');
  // The hour taken by the booking plus what the card still holds: the whole credit at arrival.
  assert.equal(res.card_credit_min, before);
  const detail = ok(await manager.get(`/api/reservations/${res.id}`));
  assert.equal(detail.reservation.card_credit_min, before);
});
