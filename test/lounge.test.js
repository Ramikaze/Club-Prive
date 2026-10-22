import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { Server, Client, ok } from './harness.js';
import { MIGRATIONS, migrate } from '../worker/schema.js';
import { nodeDb } from '../worker/db-node.js';
import { encodeQrMatrix, qrSvgPath } from '../src/lib/qrcode.js';

let server, admin, manager, cave;
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
  cave = ok(await admin.post('/api/humidors', thresholds));
});
afterEach(() => server.destroy());

test('caves : authentification et rôles contrôlés par le serveur', async () => {
  const anonymous = new Client(server);
  assert.equal((await anonymous.get('/api/lounge')).status, 401);
  assert.equal((await manager.post('/api/humidors', { ...thresholds, name: 'Autre' })).status, 403);
  assert.equal((await manager.put(`/api/humidors/${cave.id}`, thresholds)).status, 403);
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

test('lounge : indicateurs cohérents, persistance et effacement dans le bon ordre', async () => {
  ok(await manager.post(`/api/humidors/${cave.id}/readings`, { humidity: 80, temperature: 20 }));
  const before = ok(await manager.get('/api/lounge'));
  assert.deepEqual(before.summary, { humidors: 1, alerts: 1, checks_due: 0 });
  assert.deepEqual(ok(await manager.get('/api/dashboard')).lounge.summary, before.summary);
  await server.restart();
  assert.deepEqual(ok(await manager.get('/api/lounge')).summary, before.summary);
  ok(await admin.post('/api/admin/reset', { confirm: 'EFFACER' }));
  const after = ok(await admin.get('/api/lounge'));
  assert.equal(after.humidors.length, 0);
  assert.equal(after.summary.humidors, 0);
});

test('migration v1 vers v5 : membres et données existants conservés, migration rejouable', () => {
  const db = nodeDb(':memory:');
  try {
    db.exec('CREATE TABLE meta (key TEXT PRIMARY KEY, value TEXT NOT NULL)');
    for (const sql of MIGRATIONS[0]) db.exec(sql);
    db.run("INSERT INTO meta VALUES ('schema_version', '1')");
    db.run("INSERT INTO members (id, member_no, first_name, last_name, phone, created_at) VALUES (42, 'CP-42', 'Ancien', 'Membre', '000', '2026-01-01T00:00:00Z')");
    migrate(db);
    migrate(db);
    assert.equal(db.get("SELECT value FROM meta WHERE key = 'schema_version'").value, String(MIGRATIONS.length));
    assert.equal(db.get('SELECT first_name FROM members WHERE id = 42').first_name, 'Ancien');
    assert.equal(db.get('SELECT COUNT(*) AS n FROM humidors').n, 0);
  } finally { db.close(); }
});

test('migration v2 vers v5 : anciennes tables de casiers supprimées, caves et relevés conservés', () => {
  const db = nodeDb(':memory:');
  try {
    db.exec('CREATE TABLE meta (key TEXT PRIMARY KEY, value TEXT NOT NULL)');
    for (const version of [0, 1]) for (const sql of MIGRATIONS[version]) db.exec(sql);
    db.exec('CREATE TABLE lockers (id INTEGER PRIMARY KEY, code TEXT NOT NULL)');
    db.exec('CREATE TABLE locker_assignments (id INTEGER PRIMARY KEY, locker_id INTEGER REFERENCES lockers(id))');
    db.run("INSERT INTO meta VALUES ('schema_version', '2')");
    db.run("INSERT INTO humidors (id, name, humidity_min, humidity_max, temperature_min, temperature_max, reading_interval_hours, created_at) VALUES (7, 'Réserve', 65, 72, 18, 22, 24, '2026-01-01T00:00:00Z')");
    db.run("INSERT INTO lockers VALUES (1, 'A-01')");
    migrate(db);
    assert.equal(db.get("SELECT value FROM meta WHERE key = 'schema_version'").value, String(MIGRATIONS.length));
    assert.equal(db.get("SELECT COUNT(*) AS n FROM sqlite_master WHERE type = 'table' AND name LIKE 'locker%'").n, 0);
    assert.equal(db.get('SELECT name FROM humidors WHERE id = 7').name, 'Réserve');
  } finally { db.close(); }
});

test('migration v4 vers v5 : compatible avec et sans les premières tables de participants', () => {
  for (const earlyV4 of [false, true]) {
    const db = nodeDb(':memory:');
    try {
      db.exec('CREATE TABLE meta (key TEXT PRIMARY KEY, value TEXT NOT NULL)');
      for (const version of MIGRATIONS.slice(0, 4)) for (const sql of version) db.exec(sql);
      if (earlyV4) db.exec('DROP TABLE reservation_attendees');
      db.run("INSERT INTO meta VALUES ('schema_version', '4')");
      db.run("INSERT INTO rooms (id, name, capacity, created_at) VALUES (8, 'Salon historique', 4, '2026-01-01T00:00:00Z')");
      migrate(db);
      migrate(db);
      assert.equal(db.get("SELECT value FROM meta WHERE key = 'schema_version'").value, String(MIGRATIONS.length));
      assert.deepEqual({ ...db.get('SELECT name, archived_at FROM rooms WHERE id = 8') }, { name: 'Salon historique', archived_at: null });
      assert.equal(db.get('SELECT COUNT(*) AS n FROM reservation_attendees').n, 0);
    } finally { db.close(); }
  }
});

test('migration v8 : un seul salon, seules les salles par défaut jamais utilisées sont retirées', () => {
  const db = nodeDb(':memory:');
  try {
    db.exec('CREATE TABLE meta (key TEXT PRIMARY KEY, value TEXT NOT NULL)');
    for (const version of MIGRATIONS.slice(0, 7)) for (const sql of version) db.exec(sql);
    db.run("INSERT INTO meta VALUES ('schema_version', '7')");
    const at = '2026-01-01T00:00:00Z';
    for (const [id, name] of [[1, 'Salon Principal'], [2, 'Salon VIP'], [3, 'Petit Salon']]) {
      db.run('INSERT INTO rooms (id, name, capacity, created_at) VALUES (?, ?, 4, ?)', id, name, at);
    }
    db.exec('PRAGMA foreign_keys = OFF'); // a bare historical booking, without its member and plan
    db.run(`INSERT INTO reservations (member_id, subscription_id, biz_day, start_ms, end_ms, duration_min, included_minutes, status,
      tariff_hour, tariff_half, tariff_validated, created_at, room_id) VALUES (1, 1, '2026-01-01', 0, 3600000, 60, 60, 'terminee', 0, 0, 0, ?, 3)`, at);
    migrate(db);
    migrate(db);
    assert.equal(db.get("SELECT value FROM meta WHERE key = 'schema_version'").value, String(MIGRATIONS.length));
    const rooms = db.all('SELECT id, active, archived_at IS NOT NULL AS archived FROM rooms ORDER BY id').map((r) => ({ ...r }));
    assert.deepEqual(rooms, [{ id: 1, active: 1, archived: 0 }, { id: 2, active: 0, archived: 1 }, { id: 3, active: 1, archived: 0 }]);
  } finally { db.close(); }
});

test('salles multiples, nombre de personnes et désactivation d’un membre', async () => {
  assert.equal(ok(await manager.get('/api/rooms')).length, 1); // the club opens with a single room
  for (const [name, capacity] of [['Salon VIP', 6], ['Petit Salon', 4]]) ok(await admin.post('/api/rooms', { name, capacity }));
  const rooms = ok(await manager.get('/api/rooms'));
  assert.equal(rooms.length, 3);
  const [r1, r2] = rooms;

  const m1 = ok(await manager.post('/api/members', { first_name: 'Client', last_name: 'Un', phone: '+000 1' }));
  const m2 = ok(await manager.post('/api/members', { first_name: 'Client', last_name: 'Deux', phone: '+000 2' }));
  const { plans } = ok(await manager.get('/api/me'));
  const today = server.club.bizToday();
  ok(await manager.post(`/api/members/${m1.id}/subscriptions`, { plan_id: plans[0].id, start_date: today }));
  ok(await manager.post(`/api/members/${m2.id}/subscriptions`, { plan_id: plans[0].id, start_date: today }));

  // Two reservations at the exact same slot in different rooms succeed:
  const res1 = ok(await manager.post('/api/reservations', {
    member_id: m1.id, date: today, start_time: '18:00', duration_min: 60, room_id: r1.id, party_size: 4,
  }));
  assert.equal(res1.reservation.room_id, r1.id);
  assert.equal(res1.reservation.party_size, 4);

  const res2 = ok(await manager.post('/api/reservations', {
    member_id: m2.id, date: today, start_time: '18:00', duration_min: 60, room_id: r2.id, party_size: 2,
  }));
  assert.equal(res2.reservation.room_id, r2.id);

  // Updating party_size in 1 click:
  const updated = ok(await manager.put(`/api/reservations/${res1.reservation.id}/occupancy`, { party_size: 6 }));
  assert.equal(updated.reservation.party_size, 6);

  // A member is deactivated, never deleted: once their booking is cancelled, the record and its
  // history stay, out of the default list.
  ok(await manager.post(`/api/reservations/${res1.reservation.id}/cancel`, { reason: 'Départ du membre' }));
  ok(await manager.post(`/api/members/${m1.id}/deactivate`, { reason: 'Départ du club' }));
  const kept = ok(await manager.get(`/api/members/${m1.id}`));
  assert.equal(kept.active, false);
  assert.ok(kept.reservations.some((r) => r.id === res1.reservation.id));
  assert.equal(kept.subscriptions.length, 1);
});

test('carte de membre : génération du QR code SVG et recherche par URL de QR code', async () => {
  const m = ok(await manager.post('/api/members', { first_name: 'Alexandre', last_name: 'Dumas', phone: '+225 07 00 11 22' }));
  const issued = ok(await manager.post(`/api/members/${m.id}/cards`, { kind: 'virtuelle', code: '' }));
  const cardView = ok(await manager.get(`/api/cards/${issued.card_id}`));
  assert.match(cardView.card.code, /^CV-[A-Z0-9]{4}-[A-Z0-9]{4}$/);

  const qrUrl = `https://club-prive.example.com/#/membres/${m.id}?card=${encodeURIComponent(cardView.card.code)}`;
  const matrix = encodeQrMatrix(qrUrl);
  assert.ok(matrix.size >= 29 && matrix.size <= 57);
  const svg = qrSvgPath(matrix, 2);
  assert.equal(svg.viewBoxSize, matrix.size + 4);
  assert.match(svg.path, /^M\d+,\d+h1v1h-1z/);

  const found = ok(await manager.get(`/api/members?q=${encodeURIComponent(qrUrl)}`));
  assert.equal(found.length, 1);
  assert.equal(found[0].id, m.id);
});

test('migration v9 : le club s’appelle Limen, un nom choisi dans les paramètres est conservé', () => {
  for (const [stored, expected] of [['Club Privé', 'Limen'], ['Le Cercle', 'Le Cercle']]) {
    const db = nodeDb(':memory:');
    try {
      db.exec('CREATE TABLE meta (key TEXT PRIMARY KEY, value TEXT NOT NULL)');
      for (const version of MIGRATIONS.slice(0, 8)) for (const sql of version) db.exec(sql);
      db.run("INSERT INTO meta VALUES ('schema_version', '8')");
      db.run("INSERT INTO settings (key, value, updated_at) VALUES ('club_name', ?, '2026-01-01T00:00:00Z')", JSON.stringify(stored));
      migrate(db);
      assert.equal(JSON.parse(db.get("SELECT value FROM settings WHERE key = 'club_name'").value), expected);
    } finally { db.close(); }
  }
});
