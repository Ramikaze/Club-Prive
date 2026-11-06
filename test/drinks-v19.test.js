// Migration V19 and the third product category « boisson » (Autre boisson): the products table is rebuilt with the
// new CHECK without moving a row; the category's labels, rights, session billing and stock export.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { nodeDb } from '../worker/db-node.js';
import { MIGRATIONS } from '../worker/schema.js';
import { CATEGORIES, CATEGORY_LABEL, CATEGORY_PLURAL, accountOfCategory } from '../shared/roles.js';
import { Server, Client, ok, UM } from './harness.js';

const server = new Server({}, { lenientTariffs: true });
let admin;
let ger;
let cig;
let cha;
let bundle;
let n = 0;

before(async () => {
  await server.start();
  await server.addUser('admin', 'Propriétaire', 'admin', 'drk-admin-password');
  await server.addUser('ger', 'Gérant', 'gerant', 'drk-ger-password');
  await server.addUser('cig', 'Associé cigares', 'associe', 'drk-cig-password', 'cigares');
  await server.addUser('cha', 'Associé champagne', 'associe', 'drk-cha-password', 'alcool');
  admin = new Client(server);
  ger = new Client(server);
  cig = new Client(server);
  cha = new Client(server);
  await admin.login('admin', 'drk-admin-password');
  bundle = await ger.login('ger', 'drk-ger-password');
  await cig.login('cig', 'drk-cig-password');
  await cha.login('cha', 'drk-cha-password');
});
after(() => server.destroy());

const refused = (r, status) => assert.equal(r.status, status, JSON.stringify(r.data));
const SIGNATURE = [0xff, 0xd8, 0xff, 0xe0];
// A small JPEG-looking picture: the signature of the format, then filler.
function picture(size = 600, fill = 7) {
  const bytes = new Uint8Array(size).fill(fill);
  bytes.set(SIGNATURE);
  return { mime: 'image/jpeg', data: Buffer.from(bytes).toString('base64') };
}
const drink = (extra = {}) => ({ category: 'boisson', name: 'Whisky test', reference: 'DRK', price: 30000 * UM, initial_stock: 4, ...extra });

// Books a session for a new member (who needs a plan) and returns its id.
async function bookSession() {
  n += 1;
  const member = ok(await ger.post('/api/members', { first_name: 'awa', last_name: `boisson${n}`, phone: `00 00 07 ${String(n).padStart(2, '0')}` }));
  ok(await ger.post(`/api/members/${member.id}/subscriptions`, { plan_id: bundle.plans.find((p) => p.code === 'MENSUELLE').id, start_date: bundle.biz_today }));
  return ok(await ger.post('/api/reservations', {
    member_id: member.id, room_id: bundle.rooms[0].id, date: bundle.biz_today, start_time: `${String(6 + 2 * n).padStart(2, '0')}:00`, duration_min: 60,
  })).reservation.id;
}

test('trois catégories ; l’autre boisson va au compte Alcool', () => {
  assert.deepEqual(CATEGORIES, ['cigare', 'bouteille', 'boisson']);
  assert.equal(CATEGORY_LABEL.bouteille, 'Champagne'); assert.equal(CATEGORY_LABEL.boisson, 'Autre boisson');
  assert.equal(CATEGORY_PLURAL.boisson, 'Autres boissons'); assert.equal(accountOfCategory('boisson'), 'alcool');
});

// A database at version 18 holding records made through the API: built with the first 18 migrations, then filled
// with every row of a database made on the current code (the V18 columns of each table only), as `v17Copy` does
// in test/roles-v18.test.js.
function v18Copy(sourceFile, file) {
  const db = nodeDb(file);
  db.exec('CREATE TABLE meta (key TEXT PRIMARY KEY, value TEXT NOT NULL)');
  db.transaction(() => {
    for (const statements of MIGRATIONS.slice(0, 18)) for (const statement of statements) db.exec(statement);
    db.run("INSERT INTO meta (key, value) VALUES ('schema_version', '18')");
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

test('migration sans perte : V19 garde produits, stocks, photos et ventes', async () => {
  const source = new Server({}, { lenientTariffs: true });
  const old = new Server({});
  try {
    await source.start();
    await source.addUser('admin', 'Propriétaire', 'admin', 'drk-src-password');
    const a = new Client(source);
    await a.login('admin', 'drk-src-password');
    const cigar = ok(await a.post('/api/products', { category: 'cigare', name: 'Cigare test', reference: 'CIG', price: 5000 * UM, initial_stock: 5 }));
    const bottle = ok(await a.post('/api/products', { category: 'bouteille', name: 'Bouteille test', reference: 'BTL', price: 50000 * UM, initial_stock: 3 }));
    ok(await a.put(`/api/products/${cigar.id}/photo`, picture(5000)));
    ok(await a.post(`/api/products/${bottle.id}/stock`, { kind: 'entree', quantity: 2, reason: 'Livraison' }));
    const day = ok(await a.post('/api/clients', { first_name: 'awa', last_name: 'migration', phone: '00 00 08 01' }));
    ok(await a.post('/api/shop/sales', {
      account: 'alcool', buyer: { kind: 'client', member_id: day.id }, lines: [{ product_id: bottle.id, quantity: 1 }], method: 'Espèces',
    }));
    const read = (db) => ({
      products: db.all('SELECT * FROM products ORDER BY id'),
      stock: db.all('SELECT * FROM stock_movements ORDER BY id'),
      photos: db.all('SELECT product_id, mime, bytes, updated_at, length(data) AS len FROM product_photos ORDER BY product_id'),
      charges: db.all('SELECT id, product_id, account, amount, status FROM charges ORDER BY id'),
      payments: db.all('SELECT id, amount, ticket_code FROM payments ORDER BY id'),
    });
    const expected = read(source.db);
    assert.equal(expected.products.length, 2);
    assert.equal(expected.photos.length, 1);
    assert.ok(expected.stock.length >= 3);
    assert.ok(expected.charges.length >= 1);
    assert.ok(expected.payments.length >= 1);

    v18Copy(source.file, old.file);
    await old.start(); // migrates 18 -> 19
    assert.equal(old.db.get("SELECT value FROM meta WHERE key = 'schema_version'").value, String(MIGRATIONS.length));
    assert.ok(MIGRATIONS.length >= 19);
    assert.deepEqual(read(old.db), expected); // same ids, stock, photos and everything that cites a product
    assert.deepEqual(old.db.all('PRAGMA foreign_key_check'), []);
    assert.equal(old.db.get("SELECT COUNT(*) AS n FROM sqlite_master WHERE name = 'products_v18'").n, 0);
    assert.equal(old.db.get("SELECT COUNT(*) AS n FROM sqlite_master WHERE type = 'index' AND name = 'charges_product'").n, 1);

    const b = new Client(old);
    await b.login('admin', 'drk-src-password'); // the account came across with the rest
    ok(await b.post('/api/products', drink()));
  } finally {
    source.destroy();
    old.destroy();
  }
});

test('l’associé du champagne gère les autres boissons, celui des cigares les voit seulement', async () => {
  const DRK = ok(await cha.post('/api/products', drink())).id;
  refused(await cig.post('/api/products', drink({ reference: 'DRK2' })), 403);
  refused(await cig.put(`/api/products/${DRK}`, { price: 1000 * UM }), 403);
  refused(await cig.put(`/api/products/${DRK}/photo`, picture()), 403);
  assert.ok(ok(await cig.get('/api/products')).some((p) => p.id === DRK && p.category === 'boisson'));

  assert.equal(ok(await cha.put(`/api/products/${DRK}`, { price: 31000 * UM })).price, 31000 * UM);
  ok(await cha.put(`/api/products/${DRK}/photo`, picture()));

  refused(await ger.post('/api/products', drink({ reference: 'DRK3' })), 403);
  ok(await ger.post(`/api/products/${DRK}/stock`, { kind: 'entree', quantity: 2 }));
  const p = ok(await ger.get('/api/products')).find((x) => x.id === DRK);
  refused(await ger.post(`/api/products/${DRK}/stock`, { kind: 'ajustement', target_qty: 1, expected_qty: p.stock_qty, reason: 'Casse' }), 403);

  const bad = await admin.post('/api/products', drink({ category: 'soda', reference: 'SODA' }));
  refused(bad, 400);
  assert.match(JSON.stringify(bad.data), /Catégorie invalide \(cigare, champagne ou autre boisson\)\./);
});

test('une autre boisson se facture en séance, à l’unité entière, au compte Alcool', async () => {
  const DRK = ok(await admin.post('/api/products', drink({ reference: 'DRK-S', initial_stock: 2 }))).id;
  const resId = await bookSession();
  const detail = ok(await ger.post(`/api/reservations/${resId}/items`, { product_id: DRK, quantity: 1 }));
  const line = detail.charges.find((c) => c.kind === 'produit' && c.status === 'due');
  assert.equal(line.account, 'alcool');
  assert.equal(ok(await ger.get('/api/products')).find((x) => x.id === DRK).stock_qty, 1);

  const frac = await ger.post(`/api/reservations/${resId}/items`, { product_id: DRK, quantity: 1.5 });
  refused(frac, 400);
  assert.match(JSON.stringify(frac.data), /Les autres boissons se vendent à l’unité entière : indiquez un nombre entier \(1 à 99\)\./);
  const over = await ger.post(`/api/reservations/${resId}/items`, { product_id: DRK, quantity: 5 });
  refused(over, 409);
  assert.equal(over.data.code ?? over.data.error?.code, 'STOCK_INSUFFISANT', JSON.stringify(over.data));
});

test('l’export des stocks dit Champagne et Autre boisson', async () => {
  const BTL = ok(await admin.post('/api/products', { category: 'bouteille', name: 'Bouteille test', reference: 'BTL', price: 50000 * UM, initial_stock: 3 })).id;
  assert.ok(BTL);
  const exported = ok(await admin.get(`/api/export/stock?from=${bundle.biz_today}&format=json`));
  const text = JSON.stringify(exported);
  assert.ok(text.includes('"Champagne"'), text);
  assert.ok(text.includes('"Autre boisson"'), text);
  assert.ok(!text.includes(`"Bouteille"`), text);
});
