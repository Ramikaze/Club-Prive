// Migration V31 (discount and lot price, spec docs/superpowers/specs/2026-11-21-remise-prix-par-lot-design.md) on a
// database at version 30 holding real records: `charges` is rebuilt with its `discount` column and the rule that only
// a Boutique line may cost less than quantity × unit price; every line, payment, refund and stock movement keeps its
// id and its references.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Server, Client, ok, UM, postSale } from './harness.js';
import { nodeDb } from '../worker/db-node.js';
import { MIGRATIONS } from '../worker/schema.js';

// The 24 columns of `charges` at version 30.
const V30_CHARGES = `id, account, kind, member_id, reservation_id, subscription_id, product_id, label, quantity, unit_price, amount,
  status, tariff_validated, created_at, created_by, cancelled_at, cancelled_by, cancel_reason, consumer_member_id, deposit,
  shop_sale_id, settled, carryover, unit_cost`;

// A database at version 30 filled with every row of a database made on the current code (the V30 columns of each
// table only), as `v20Copy` does in test/credit-v21.test.js.
function v30Copy(sourceFile, file) {
  const db = nodeDb(file);
  db.exec('CREATE TABLE meta (key TEXT PRIMARY KEY, value TEXT NOT NULL)');
  db.transaction(() => {
    for (const statements of MIGRATIONS.slice(0, 30)) for (const statement of statements) db.exec(statement);
    db.run("INSERT INTO meta (key, value) VALUES ('schema_version', '30')");
  });
  db.exec('PRAGMA foreign_keys = OFF');
  db.exec(`ATTACH DATABASE '${sourceFile.replaceAll("'", "''")}' AS src`);
  const tables = db.all("SELECT name FROM main.sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' AND name <> 'meta'");
  db.transaction(() => {
    for (const { name } of tables) {
      const columns = db.all(`PRAGMA main.table_info(${name})`).map((c) => `"${c.name}"`).join(', ');
      db.exec(`INSERT INTO main."${name}" (${columns}) SELECT ${columns} FROM src."${name}"`);
    }
  });
  db.exec('DETACH DATABASE src');
  db.close();
}

const read = (db) => ({
  charges: db.all(`SELECT ${V30_CHARGES} FROM charges ORDER BY id`),
  allocations: db.all('SELECT id, payment_id, charge_id, account, amount FROM payment_allocations ORDER BY id'),
  refunds: db.all('SELECT id, charge_id, payment_id, account, amount, method, reason, restocked, card_amount FROM refunds ORDER BY id'),
  stock: db.all('SELECT id, product_id, charge_id, gift_id, quantity FROM stock_movements ORDER BY id'),
});

test('migration V31 sans perte : lignes, paiements, remboursements et stock gardés', async () => {
  const source = new Server({}, { lenientTariffs: true });
  const old = new Server({});
  try {
    await source.start();
    await source.addUser('admin', 'Propriétaire', 'admin', 'v31-src-password');
    await source.addUser('cig', 'Associé cigares', 'associe', 'v31-cig-password', 'cigares');
    const a = new Client(source);
    const bundle = await a.login('admin', 'v31-src-password');
    const today = bundle.biz_today;
    const cig = new Client(source);
    await cig.login('cig', 'v31-cig-password');
    const cigar = ok(await a.post('/api/products', { category: 'cigare', name: 'Cigare v31', reference: 'C31', price: 5000 * UM, initial_stock: 10 }));
    const m = ok(await a.post('/api/members', { first_name: 'jean', last_name: 'migration', phone: '00 00 09 31' }));
    ok(await a.post(`/api/members/${m.id}/wallet/recharge`, { amount: 30000 * UM, method: 'Espèces' }));
    // A card sale, then its cancellation: refunds, goods back, a card movement.
    const sale = ok(await postSale(a, {
      account: 'cigares', buyer: { kind: 'membre', member_id: m.id }, lines: [{ product_id: cigar.id, quantity: 2 }], card: true,
    }));
    ok(await a.post(`/api/shop/sales/${sale.sale.id}/cancel`, { reason: 'Test de migration' }));
    ok(await postSale(a, {
      account: 'cigares', buyer: { kind: 'journalier' }, lines: [{ product_id: cigar.id, quantity: 1 }], method: 'Espèces',
    }));
    // A regular client's credit sale, then a settlement.
    const c = ok(await a.post('/api/clients', { first_name: 'awa', last_name: 'migration', phone: '00 00 09 32' }));
    ok(await a.put(`/api/clients/${c.id}/credit-limit`, { credit_limit: 50000 * UM }));
    ok(await postSale(a, { account: 'cigares', buyer: { kind: 'client', member_id: c.id }, lines: [{ product_id: cigar.id, quantity: 1 }], credit: true }));
    ok(await a.post(`/api/clients/${c.id}/settlements`, { amount: 2000 * UM, method: 'Espèces' }));
    // A gift by the associé of the rayon.
    ok(await cig.post(`/api/products/${cigar.id}/offer`, { quantity: 1, reason: 'Test de migration' }));
    // A session: a member's plan, his booking and a cigar served in it; and a regular client's « Dette reprise ».
    const s = ok(await a.post('/api/members', { first_name: 'lea', last_name: 'seance', phone: '00 00 09 33' }));
    ok(await a.post(`/api/members/${s.id}/subscriptions`, { plan_id: bundle.plans.find((x) => x.code === 'MENSUELLE').id, start_date: today }));
    const booking = ok(await a.post('/api/reservations', { member_id: s.id, room_id: bundle.rooms[0].id, date: today, start_time: '06:00', duration_min: 60 }));
    ok(await a.post(`/api/reservations/${booking.reservation.id}/items`, { product_id: cigar.id, quantity: 1 }));
    ok(await a.post(`/api/clients/${c.id}/carryovers`, { amount: 10000 * UM, account: 'cigares', note: 'Reprise de migration' }));
    const expected = read(source.db);
    // Boutique lines (card sale cancelled, walk-in, credit), a plan, a session's cigar, a « Dette reprise ».
    assert.ok(expected.charges.filter((c) => c.shop_sale_id !== null).length === 3);
    assert.ok(expected.charges.some((c) => c.kind === 'abonnement' && c.subscription_id !== null));
    assert.ok(expected.charges.some((c) => c.reservation_id !== null && c.kind === 'produit'));
    assert.ok(expected.charges.some((c) => c.carryover === 1));
    assert.ok(expected.refunds.length >= 1);
    assert.ok(expected.stock.some((s) => s.gift_id !== null));

    v30Copy(source.file, old.file);
    await old.start(); // migrates 30 -> 31
    assert.equal(old.db.get("SELECT value FROM meta WHERE key = 'schema_version'").value, String(MIGRATIONS.length));
    assert.deepEqual(read(old.db), expected);
    assert.equal(old.db.get('SELECT COUNT(*) AS n FROM charges WHERE discount <> 0').n, 0);
    assert.deepEqual(old.db.all('PRAGMA foreign_key_check'), []);
    assert.equal(old.db.get("SELECT COUNT(*) AS n FROM sqlite_master WHERE name = 'charges_v30'").n, 0);
    const indexes = old.db.all("SELECT name FROM sqlite_master WHERE type = 'index' AND tbl_name = 'charges'").map((i) => i.name);
    for (const name of ['charges_reservation', 'charges_member', 'charges_created', 'charges_consumer', 'charges_shop_sale', 'charges_product']) {
      assert.ok(indexes.includes(name), name);
    }

    // Only a Boutique line may cost less than quantity × unit price, and never more.
    const insert = (shopSaleId, amount, discount) => old.db.run(
      `INSERT INTO charges (account, kind, member_id, label, quantity, unit_price, amount, status, created_at, shop_sale_id, discount)
       VALUES ('cigares', 'produit', ?, 'Ligne test', 1, 1000, ?, 'due', '2026-11-21T10:00:00.000Z', ?, ?)`,
      m.id, amount, shopSaleId, discount,
    );
    assert.throws(() => insert(null, 900, 0), /CHECK/);
    insert(sale.sale.id, 900, 100);
    assert.throws(() => insert(sale.sale.id, 900, 200), /CHECK/);
  } finally {
    source.destroy();
    // A failure before the copy leaves `old` never started: nothing of it to close.
    if (old.db) old.destroy();
  }
});

test('insertCharge : une ligne Boutique garde le montant payé et sa remise', async () => {
  const server = new Server({});
  try {
    await server.start();
    await server.addUser('admin', 'Propriétaire', 'admin', 'v31-ins-password');
    const a = new Client(server);
    await a.login('admin', 'v31-ins-password');
    const cigar = ok(await a.post('/api/products', { category: 'cigare', name: 'Coupe v31', reference: 'K31', price: 5000 * UM, initial_stock: 5 }));
    const sold = ok(await postSale(a, { account: 'cigares', buyer: { kind: 'journalier' }, lines: [{ product_id: cigar.id, quantity: 1 }], method: 'Espèces' }));
    const actor = server.club.get("SELECT id FROM users WHERE login = 'admin'");
    const line = {
      account: 'cigares', kind: 'produit', member_id: server.club.walkInMemberId(), product_id: cigar.id, label: 'Coupe v31',
      unit_price: 5000 * UM, shop_sale_id: sold.sale.id,
    };
    const row = (id) => server.club.get('SELECT quantity, unit_price, amount, discount FROM charges WHERE id = ?', id);
    const lot = server.club.tx(() => server.club.insertCharge(actor, { ...line, quantity: 4, amount: 11700 * UM, discount: 1300 * UM }));
    assert.deepEqual({ ...row(lot) }, { quantity: 4, unit_price: 5000 * UM, amount: 11700 * UM, discount: 1300 * UM });
    // Without them, as every other caller: quantity × unit price, no discount.
    const plain = server.club.tx(() => server.club.insertCharge(actor, { ...line, quantity: 2 }));
    assert.deepEqual({ ...row(plain) }, { quantity: 2, unit_price: 5000 * UM, amount: 10000 * UM, discount: 0 });
  } finally {
    server.destroy();
  }
});
