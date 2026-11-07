import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { Server, Client, ok } from './harness.js';
import { MIGRATIONS, migrate } from '../worker/schema.js';
import { nodeDb } from '../worker/db-node.js';
import { encodeQrMatrix, qrSvgPath } from '../src/lib/qrcode.js';

let server, admin, manager;

beforeEach(async () => {
  server = new Server({ SETUP_TOKEN: 'installation-lounge' }, { lenientTariffs: true });
  await server.start();
  admin = new Client(server);
  ok(await admin.post('/api/setup', { setup_token: 'installation-lounge', login: 'admin', name: 'Admin test', password: 'test-lounge-password' }));
  ok(await admin.post('/api/users', { login: 'gerant', name: 'Gérant test', role: 'gerant', password: 'test-lounge-manager' }));
  manager = new Client(server);
  await manager.login('gerant', 'test-lounge-manager');
});
afterEach(() => server.destroy());

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

test('migration v10 : plus d’horaires d’ouverture, seul le début de journée reste', () => {
  for (const [open, expected] of [['10:00', '06:00'], ['11:30', '11:30']]) {
    const db = nodeDb(':memory:');
    try {
      db.exec('CREATE TABLE meta (key TEXT PRIMARY KEY, value TEXT NOT NULL)');
      for (const version of MIGRATIONS.slice(0, 9)) for (const sql of version) db.exec(sql);
      db.run("INSERT INTO meta VALUES ('schema_version', '9')");
      db.run("INSERT INTO settings (key, value, updated_at) VALUES ('hours', ?, '2026-01-01T00:00:00Z')", JSON.stringify({ open, close: '24:00', max_end: '05:00' }));
      db.run("INSERT INTO settings (key, value, updated_at) VALUES ('manager_can_authorize_off_hours', 'true', '2026-01-01T00:00:00Z')");
      migrate(db);
      assert.deepEqual(JSON.parse(db.get("SELECT value FROM settings WHERE key = 'hours'").value), { open: expected });
      assert.equal(db.get("SELECT COUNT(*) AS n FROM settings WHERE key = 'manager_can_authorize_off_hours'").n, 0);
    } finally { db.close(); }
  }
});

test('migration v11 : le minimum du week-end est ajouté aux réglages de réservation déjà enregistrés', () => {
  for (const [min, expected] of [[60, 120], [150, 150]]) {
    const db = nodeDb(':memory:');
    try {
      db.exec('CREATE TABLE meta (key TEXT PRIMARY KEY, value TEXT NOT NULL)');
      for (const version of MIGRATIONS.slice(0, 10)) for (const sql of version) db.exec(sql);
      db.run("INSERT INTO meta VALUES ('schema_version', '10')");
      db.run("INSERT INTO settings (key, value, updated_at) VALUES ('booking', ?, '2026-01-01T00:00:00Z')", JSON.stringify({ slot_min: 30, min_duration_min: min, extension_step_min: 30 }));
      migrate(db);
      assert.equal(JSON.parse(db.get("SELECT value FROM settings WHERE key = 'booking'").value).weekend_min_duration_min, expected);
    } finally { db.close(); }
  }
});
