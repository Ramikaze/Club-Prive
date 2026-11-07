// Migration V21 (credit of the regular clients) on a database at version 20 holding real records: the payment
// allocations and refunds are rebuilt without their one-per-line uniqueness, with the same ids and the references to
// them (the card movements of a refund) intact; a paid or refunded line counts as settled in full.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Server, Client, ok, UM } from './harness.js';
import { nodeDb } from '../worker/db-node.js';
import { MIGRATIONS } from '../worker/schema.js';

// A database at version 20 filled with every row of a database made on the current code (the V20 columns of each
// table only), as `v18Copy` does in test/drinks-v19.test.js.
function v20Copy(sourceFile, file) {
  const db = nodeDb(file);
  db.exec('CREATE TABLE meta (key TEXT PRIMARY KEY, value TEXT NOT NULL)');
  db.transaction(() => {
    for (const statements of MIGRATIONS.slice(0, 20)) for (const statement of statements) db.exec(statement);
    db.run("INSERT INTO meta (key, value) VALUES ('schema_version', '20')");
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

test('migration V21 sans perte : encaissements, remboursements et mouvements de carte gardés', async () => {
  const source = new Server({}, { lenientTariffs: true });
  const old = new Server({});
  try {
    await source.start();
    await source.addUser('admin', 'Propriétaire', 'admin', 'v21-src-password');
    const a = new Client(source);
    await a.login('admin', 'v21-src-password');
    const bottle = ok(await a.post('/api/products', { category: 'bouteille', name: 'Bouteille v21', reference: 'BTL', price: 20000 * UM, initial_stock: 5 }));
    const m = ok(await a.post('/api/members', { first_name: 'jean', last_name: 'migration', phone: '00 00 08 21' }));
    ok(await a.post(`/api/members/${m.id}/wallet/recharge`, { amount: 30000 * UM, method: 'Espèces' }));
    // A card sale, then its cancellation: a refund whose card part is a card movement pointing at it.
    const sale = ok(await a.post('/api/shop/sales', {
      account: 'alcool', buyer: { kind: 'membre', member_id: m.id }, lines: [{ product_id: bottle.id, quantity: 1 }], card: true,
    }));
    ok(await a.post(`/api/shop/sales/${sale.sale.id}/cancel`, { reason: 'Test de migration' }));
    ok(await a.post('/api/shop/sales', {
      account: 'alcool', buyer: { kind: 'journalier' }, lines: [{ product_id: bottle.id, quantity: 1 }], method: 'Espèces',
    }));
    const read = (db) => ({
      allocations: db.all('SELECT id, payment_id, charge_id, account, amount FROM payment_allocations ORDER BY id'),
      refunds: db.all('SELECT id, charge_id, payment_id, account, amount, method, reason, restocked, card_amount FROM refunds ORDER BY id'),
      wallet: db.all('SELECT id, refund_id, payment_id, amount FROM wallet_movements ORDER BY id'),
    });
    const expected = read(source.db);
    assert.ok(expected.allocations.length >= 2);
    assert.equal(expected.refunds.length, 1);
    assert.ok(expected.wallet.some((w) => w.refund_id === expected.refunds[0].id));

    v20Copy(source.file, old.file);
    await old.start(); // migrates 20 -> 21
    assert.equal(old.db.get("SELECT value FROM meta WHERE key = 'schema_version'").value, String(MIGRATIONS.length));
    assert.deepEqual(read(old.db), expected);
    assert.deepEqual(old.db.all('PRAGMA foreign_key_check'), []);
    assert.equal(old.db.get("SELECT COUNT(*) AS n FROM sqlite_master WHERE name IN ('payment_allocations_v20', 'refunds_v20')").n, 0);
    // A paid or refunded line counts as settled in full; nothing is on credit.
    assert.equal(old.db.get("SELECT COUNT(*) AS n FROM charges WHERE status IN ('payee', 'remboursee') AND settled <> amount").n, 0);
    assert.equal(old.db.get('SELECT COUNT(*) AS n FROM shop_sales WHERE on_credit = 1').n, 0);
    assert.equal(old.db.get('SELECT COUNT(*) AS n FROM members WHERE credit_limit <> 0').n, 0);

    // The migrated club works: a line may now be paid in two settlements.
    const b = new Client(old);
    await b.login('admin', 'v21-src-password');
    const c = ok(await b.post('/api/clients', { first_name: 'awa', last_name: 'migration', phone: '00 00 08 22' }));
    ok(await b.put(`/api/clients/${c.id}/credit-limit`, { credit_limit: 50000 * UM }));
    ok(await b.post('/api/shop/sales', { account: 'alcool', buyer: { kind: 'client', member_id: c.id }, lines: [{ product_id: bottle.id, quantity: 1 }], credit: true }));
    ok(await b.post(`/api/clients/${c.id}/settlements`, { amount: 5000 * UM, method: 'Espèces' }));
    const last = ok(await b.post(`/api/clients/${c.id}/settlements`, { amount: 15000 * UM, method: 'Espèces' }));
    assert.equal(last.account.owed, 0);
  } finally {
    source.destroy();
    old.destroy();
  }
});
