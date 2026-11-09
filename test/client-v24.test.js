// Migration V24 (client space): the new tables exist, and a reset of the business data empties them (staff push
// subscriptions are kept, like the users).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Server, Client, ok, UM } from './harness.js';

const CLIENT_TABLES = [
  'client_accounts', 'client_sessions', 'client_idempotency', 'client_orders', 'client_order_lines',
  'client_order_sales', 'reservation_requests', 'client_ticket_copies',
];

test('migration V24 : schema_version = 24 et les tables existent', async () => {
  const server = new Server({});
  try {
    await server.start();
    assert.equal(server.db.get("SELECT value FROM meta WHERE key = 'schema_version'").value, '24');
    for (const table of [...CLIENT_TABLES, 'push_subscriptions']) server.db.all(`SELECT 1 FROM ${table} LIMIT 1`);
  } finally {
    server.destroy();
  }
});

test('effacer toutes les données vide les tables des clients', async () => {
  const server = new Server({}, { lenientTariffs: true });
  try {
    await server.start();
    await server.addUser('admin', 'Propriétaire', 'admin', 'v24-admin-password');
    const a = new Client(server);
    await a.login('admin', 'v24-admin-password');
    const member = ok(await a.post('/api/members', { first_name: 'jean', last_name: 'client', phone: '00 00 08 24' }));
    const product = ok(await a.post('/api/products', { category: 'bouteille', name: 'Bouteille v24', reference: 'B24', price: 100 * UM, initial_stock: 5 }));
    const sale = ok(await a.post('/api/shop/sales', {
      account: 'alcool', buyer: { kind: 'journalier' }, lines: [{ product_id: product.id, quantity: 1 }], method: 'Espèces',
    }));
    const db = server.db;
    const adminId = db.get("SELECT id FROM users WHERE login = 'admin'").id;
    const now = '2026-11-09T10:00:00Z';
    const roomId = db.run("INSERT INTO rooms (name, created_at) VALUES ('Salon v24', ?)", now).lastId;
    const reservationId = db.run(
      `INSERT INTO reservations (member_id, biz_day, start_ms, end_ms, duration_min, status, tariff_hour, tariff_half, tariff_validated, included_minutes, created_at, room_id)
       VALUES (?, '2026-11-10', 0, 3600000, 60, 'reservee', 0, 0, 0, 60, ?, ?)`,
      member.id, now, roomId,
    ).lastId;
    const paymentId = db.run("INSERT INTO payments (member_id, amount, method, paid_at) VALUES (?, 100, 'Espèces', ?)", member.id, now).lastId;
    const accountId = db.run("INSERT INTO client_accounts (member_id, login, created_at) VALUES (?, 'jean.client', ?)", member.id, now).lastId;
    const orderId = db.run("INSERT INTO client_orders (member_id, status, created_at) VALUES (?, 'en_attente', ?)", member.id, now).lastId;
    db.run("INSERT INTO client_sessions (token_hash, account_id, created_at, expires_at) VALUES ('t', ?, ?, ?)", accountId, now, now);
    db.run("INSERT INTO client_idempotency (key, account_id, request_hash, response, created_at) VALUES ('k', ?, 'h', '{}', ?)", accountId, now);
    db.run("INSERT INTO client_order_lines (order_id, product_id, account, quantity, unit_price) VALUES (?, ?, 'alcool', 1, 100)", orderId, product.id);
    db.run("INSERT INTO client_order_sales (order_id, account, sale_id) VALUES (?, 'alcool', ?)", orderId, sale.sale.id);
    db.run(
      "INSERT INTO reservation_requests (member_id, room_id, date, start_time, duration_min, party_size, status, created_at, reservation_id) VALUES (?, ?, '2026-11-10', '18:00', 60, 2, 'confirmee', ?, ?)",
      member.id, roomId, now, reservationId,
    );
    db.run("INSERT INTO client_ticket_copies (payment_id, member_id, kind, at) VALUES (?, ?, 'impression', ?)", paymentId, member.id, now);
    db.run("INSERT INTO push_subscriptions (user_id, endpoint, p256dh, auth, created_at) VALUES (?, 'https://push.test/1', 'p', 'a', ?)", adminId, now);
    for (const table of CLIENT_TABLES) assert.equal(db.get(`SELECT COUNT(*) AS n FROM ${table}`).n, 1, table);

    ok(await a.post('/api/admin/reset', { confirm: 'EFFACER' }));

    for (const table of CLIENT_TABLES) assert.equal(db.get(`SELECT COUNT(*) AS n FROM ${table}`).n, 0, table);
    assert.equal(db.get('SELECT COUNT(*) AS n FROM push_subscriptions').n, 1);
  } finally {
    server.destroy();
  }
});
