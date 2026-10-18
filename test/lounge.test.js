import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { Server, Client, ok } from './harness.js';
import { MIGRATIONS, migrate } from '../worker/schema.js';
import { nodeDb } from '../worker/db-node.js';
import { addDays, localToUtcMs } from '../shared/time.js';

let server, admin, manager, member, cave, today;
const thresholds = {
  name: 'Réserve', location: 'Salon', humidity_min: 65, humidity_max: 72,
  temperature_min: 18, temperature_max: 22, reading_interval_hours: 24,
};

beforeEach(async () => {
  server = new Server({ SETUP_TOKEN: 'installation-lounge' });
  await server.start();
  admin = new Client(server);
  ok(await admin.post('/api/setup', { setup_token: 'installation-lounge', login: 'admin', name: 'Admin test', password: 'test-lounge-password' }));
  ok(await admin.post('/api/users', { login: 'gerant', name: 'Gérant test', role: 'gerant', password: 'test-lounge-manager' }));
  manager = new Client(server);
  await manager.login('gerant', 'test-lounge-manager');
  member = ok(await manager.post('/api/members', { first_name: 'Camille', last_name: 'Test', phone: '00000000' }));
  cave = ok(await admin.post('/api/humidors', thresholds));
  today = server.club.loungeToday();
});
afterEach(() => server.destroy());

async function assigned(code = 'A-01', end = addDays(today, 30)) {
  const locker = ok(await admin.post('/api/lockers', { code, humidor_id: cave.id }));
  return ok(await manager.post(`/api/lockers/${locker.id}/assign`, { member_id: member.id, end_date: end }));
}

test('caves : authentification et rôles contrôlés par le serveur', async () => {
  const anonymous = new Client(server);
  assert.equal((await anonymous.get('/api/lounge')).status, 401);
  assert.equal((await manager.post('/api/humidors', { ...thresholds, name: 'Autre' })).status, 403);
  assert.equal((await manager.put(`/api/humidors/${cave.id}`, thresholds)).status, 403);
  assert.equal((await manager.post('/api/lockers', { code: 'A-01', humidor_id: cave.id })).status, 403);
  const detail = ok(await manager.post(`/api/humidors/${cave.id}/readings`, { humidity: 68, temperature: 20 }));
  assert.equal((await manager.post(`/api/humidor-readings/${detail.latest.id}/void`, { reason: 'Erreur de saisie' })).status, 403);
  assert.equal(detail.latest.created_by_name, 'Gérant test');
});

test('caves : seuils et relevés validés, zéro et décimales acceptés sans coercition de champs vides', async () => {
  for (const patch of [{ humidity_min: 72 }, { temperature_max: 18 }, { humidity_max: 101 }, { reading_interval_hours: 0 }]) {
    assert.equal((await admin.put(`/api/humidors/${cave.id}`, { ...thresholds, ...patch })).status, 400);
  }
  for (const value of ['', ' ', null, true, [], 'NaN', 100.1, -1, 65.55]) {
    assert.equal((await manager.post(`/api/humidors/${cave.id}/readings`, { humidity: value, temperature: 20 })).status, 400, String(value));
  }
  assert.equal((await admin.post('/api/humidors', { ...thresholds, name: 'réserve' })).status, 409);
  const detail = ok(await manager.post(`/api/humidors/${cave.id}/readings`, { humidity: '68,5', temperature: 0 }));
  assert.equal(detail.latest.humidity, 68.5);
  assert.equal(detail.latest.temperature, 0);
  assert.equal(detail.status, 'alerte');
});

test('caves : contrôle manquant, conforme, périmé, hors seuil et annulation tracée', async () => {
  assert.equal(cave.status, 'a_controler');
  const now = Date.now();
  server.club.at = now;
  const first = ok(await manager.post(`/api/humidors/${cave.id}/readings`, { humidity: 65, temperature: 22 }));
  assert.equal(first.status, 'conforme');
  server.club.at = now + 24 * 3600000;
  assert.equal(ok(await admin.get(`/api/humidors/${cave.id}`)).status, 'a_controler');
  const bad = ok(await manager.post(`/api/humidors/${cave.id}/readings`, { humidity: 73, temperature: 23 }));
  assert.equal(bad.status, 'alerte');
  const corrected = ok(await admin.post(`/api/humidor-readings/${bad.latest.id}/void`, { reason: 'Erreur de lecture' }));
  assert.equal(corrected.latest.id, first.latest.id);
  assert.equal(corrected.status, 'a_controler');
  assert.equal(corrected.readings[0].void_reason, 'Erreur de lecture');
  assert.equal(corrected.readings[0].voided_by_name, 'Admin test');
  ok(await admin.post(`/api/humidor-readings/${first.latest.id}/void`, { reason: 'Appareil défectueux' }));
  assert.equal(ok(await admin.get(`/api/humidors/${cave.id}`)).latest, null);
  const audit = server.club.get("SELECT COUNT(*) AS n FROM audit_log WHERE action = 'cave.releve_annuler'");
  assert.equal(audit.n, 2);
});

test('caves : relevé rejoué une seule fois et changement de seuil appliqué au dernier relevé', async () => {
  const body = { humidity: 73, temperature: 20 };
  const key = { 'idempotency-key': 'reading-once-123' };
  const first = ok(await manager.post(`/api/humidors/${cave.id}/readings`, body, key));
  const again = await manager.post(`/api/humidors/${cave.id}/readings`, body, key);
  assert.equal(ok(again).latest.id, first.latest.id);
  assert.equal(again.headers.get('Idempotent-Replayed'), 'true');
  assert.equal(ok(await admin.get(`/api/humidors/${cave.id}`)).readings.length, 1);
  assert.equal(ok(await admin.put(`/api/humidors/${cave.id}`, { ...thresholds, humidity_max: 75 })).status, 'conforme');
});

test('casiers : attribution concurrente refusée, membre inexistant et dates invalides rejetés', async () => {
  const locker = ok(await admin.post('/api/lockers', { code: 'A-01', humidor_id: cave.id }));
  assert.equal((await admin.post('/api/lockers', { code: 'a-01', humidor_id: cave.id })).status, 409);
  assert.equal((await manager.post(`/api/lockers/${locker.id}/assign`, { member_id: 999, end_date: today })).status, 404);
  for (const end of ['', '2026-02-30', addDays(today, -1)]) {
    assert.equal((await manager.post(`/api/lockers/${locker.id}/assign`, { member_id: member.id, end_date: end })).status, 400);
  }
  const results = await Promise.all([1, 2].map(() => manager.post(`/api/lockers/${locker.id}/assign`, { member_id: member.id, end_date: today })));
  assert.deepEqual(results.map((r) => r.status).sort(), [200, 409]);
  assert.equal(ok(await manager.get(`/api/members/${member.id}`)).lockers[0].id, locker.id);
});

test('casiers : dépôts idempotents, regroupement des références et retraits atomiques', async () => {
  const locker = await assigned();
  const path = `/api/locker-assignments/${locker.assignment_id}/items`;
  const body = { name: 'Robusto personnel', quantity: 4 };
  const headers = { 'idempotency-key': 'deposit-once-123' };
  const first = ok(await manager.post(path, body, headers));
  ok(await manager.post(path, body, headers));
  let detail = ok(await manager.post(path, { name: 'ROBUSTO PERSONNEL', quantity: 2 }));
  assert.equal(detail.items.length, 1);
  assert.equal(detail.cigar_count, 6);
  assert.equal(detail.movements.length, 2);
  assert.equal((await manager.post(path, { name: 'Autre', quantity: 0 })).status, 400);
  const withdraw = `/api/locker-items/${first.items[0].id}/withdraw`;
  assert.equal((await manager.post(withdraw, { quantity: 7, notes: 'Remis au membre' })).status, 409);
  assert.equal((await manager.post(withdraw, { quantity: 1, notes: '' })).status, 400);
  const results = await Promise.all([1, 2].map(() => manager.post(withdraw, { quantity: 4, notes: 'Remis au membre' })));
  assert.deepEqual(results.map((r) => r.status).sort(), [200, 409]);
  detail = ok(await manager.get(`/api/lockers/${locker.id}`));
  assert.equal(detail.cigar_count, 2);
  assert.equal(detail.movements.length, 3);
  assert.equal(detail.movements[0].stock_after, 2);
  assert.equal(server.club.get('SELECT COUNT(*) AS n FROM stock_movements').n, 0);
  assert.equal(server.club.get('SELECT COUNT(*) AS n FROM charges').n, 0);
});

test('casiers : libération uniquement à vide, historique conservé et ancien écran inopérant', async () => {
  const locker = await assigned();
  const path = `/api/locker-assignments/${locker.assignment_id}`;
  const contents = ok(await manager.post(`${path}/items`, { name: 'Corona', quantity: 2 }));
  assert.equal((await manager.post(`${path}/release`, { reason: 'Fin du service' })).status, 409);
  ok(await manager.post(`/api/locker-items/${contents.items[0].id}/withdraw`, { quantity: 2, notes: 'Restitués au membre' }));
  const release = ok(await manager.post(`${path}/release`, { reason: 'Fin de mise à disposition' }));
  assert.equal(release.status, 'libre');
  assert.equal(release.items.length, 0);
  assert.equal(release.movements.length, 2);
  assert.ok(release.assignments[0].released_at);
  const next = ok(await manager.post(`/api/lockers/${locker.id}/assign`, { member_id: member.id, end_date: addDays(today, 40) }));
  assert.notEqual(next.assignment_id, locker.assignment_id);
  for (const operation of ['items', 'renew', 'release']) {
    assert.equal((await manager.post(`${path}/${operation}`, { name: 'Ancien', quantity: 3, end_date: addDays(today, 80), reason: 'Fin' })).status, 409);
  }
  assert.equal(ok(await manager.get(`/api/lockers/${locker.id}`)).cigar_count, 0);
});

test('casiers : échéance au jour civil local, renouvellement et retrait après expiration', async () => {
  const locker = await assigned('A-01', today);
  const path = `/api/locker-assignments/${locker.assignment_id}`;
  const contents = ok(await manager.post(`${path}/items`, { name: 'Robusto', quantity: 2 }));
  server.club.at = localToUtcMs(addDays(today, 1), '01:00', 'Africa/Brazzaville');
  assert.equal(server.club.bizToday(), today); // The lounge follows calendar dates, not the late-night booking day.
  assert.equal(ok(await manager.get(`/api/lockers/${locker.id}`)).status, 'expire');
  assert.equal((await manager.post(`${path}/items`, { name: 'Robusto', quantity: 1 })).status, 409);
  ok(await manager.post(`/api/locker-items/${contents.items[0].id}/withdraw`, { quantity: 1, notes: 'Restitution' }));
  assert.equal((await manager.post(`${path}/renew`, { end_date: today })).status, 400);
  assert.equal(ok(await manager.post(`${path}/renew`, { end_date: addDays(today, 30) })).status, 'occupe');
  ok(await manager.post(`${path}/items`, { name: 'Robusto', quantity: 1 }));
});

test('casiers : mise hors service protégée et attribution bloquée', async () => {
  const locker = ok(await admin.post('/api/lockers', { code: 'A-01', humidor_id: cave.id }));
  const path = `/api/lockers/${locker.id}/availability`;
  assert.equal((await manager.put(path, { active: false, reason: 'Maintenance' })).status, 403);
  assert.equal((await admin.put(path, { active: 'false', reason: 'Maintenance' })).status, 400);
  assert.equal(ok(await admin.put(path, { active: false, reason: 'Maintenance' })).status, 'indisponible');
  assert.equal((await manager.post(`/api/lockers/${locker.id}/assign`, { member_id: member.id, end_date: today })).status, 409);
  ok(await admin.put(path, { active: true, reason: 'Entretien terminé' }));
  ok(await manager.post(`/api/lockers/${locker.id}/assign`, { member_id: member.id, end_date: today }));
  assert.equal((await admin.put(path, { active: false, reason: 'Maintenance' })).status, 409);
});

test('lounge : indicateurs cohérents, persistance et effacement dans le bon ordre', async () => {
  const locker = await assigned('A-01', addDays(today, 2));
  ok(await manager.post(`/api/locker-assignments/${locker.assignment_id}/items`, { name: 'Robusto', quantity: 12 }));
  ok(await manager.post(`/api/humidors/${cave.id}/readings`, { humidity: 80, temperature: 20 }));
  const before = ok(await manager.get('/api/lounge'));
  assert.deepEqual(before.summary, { humidors: 1, alerts: 1, checks_due: 0, lockers: 1, occupied: 1, available: 0, expiring: 1, cigars: 12 });
  assert.deepEqual(ok(await manager.get('/api/dashboard')).lounge.summary, before.summary);
  await server.restart();
  assert.deepEqual(ok(await manager.get('/api/lounge')).summary, before.summary);
  ok(await admin.post('/api/admin/reset', { confirm: 'EFFACER' }));
  const after = ok(await admin.get('/api/lounge'));
  assert.equal(after.humidors.length, 0);
  assert.equal(after.lockers.length, 0);
});

test('migration v1 vers v2 : membres et données existants conservés, migration rejouable', () => {
  const db = nodeDb(':memory:');
  try {
    db.exec('CREATE TABLE meta (key TEXT PRIMARY KEY, value TEXT NOT NULL)');
    for (const sql of MIGRATIONS[0]) db.exec(sql);
    db.run("INSERT INTO meta VALUES ('schema_version', '1')");
    db.run("INSERT INTO members (id, member_no, first_name, last_name, phone, created_at) VALUES (42, 'CP-42', 'Ancien', 'Membre', '000', '2026-01-01T00:00:00Z')");
    migrate(db);
    migrate(db);
    assert.equal(db.get("SELECT value FROM meta WHERE key = 'schema_version'").value, '2');
    assert.equal(db.get('SELECT first_name FROM members WHERE id = 42').first_name, 'Ancien');
    assert.equal(db.get('SELECT COUNT(*) AS n FROM humidors').n, 0);
  } finally { db.close(); }
});
