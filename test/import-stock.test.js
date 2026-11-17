// The inventory import door (POST /api/admin/stock-import): each product's stock set to the counted quantity by an
// « ajustement » with the inventory's reason, products missing from the catalogue created (price 0 allowed), a product
// renamed when the count splits it in two. Open only while the IMPORT_TOKEN secret exists; one call, one transaction;
// a dry run writes nothing; run again, nothing moves. Every name and figure here is made up.
import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { Server, Client, ok, UM } from './harness.js';

const IMPORT_TOKEN = 'code-import-fictif';
const REASON = 'Inventaire du 17/11/2026';
const servers = [];
afterEach(() => { for (const s of servers.splice(0)) s.destroy(); });

async function setup(env = { IMPORT_TOKEN }) {
  const server = new Server(env);
  servers.push(server);
  await server.start();
  await server.addUser('admin', 'Propriétaire', 'admin', 'stock-admin-password');
  const admin = new Client(server);
  await admin.login('admin', 'stock-admin-password');
  ok(await admin.post('/api/products', { category: 'cigare', name: 'Cigare Alpha', reference: 'CIG-901', price: 10000 * UM, initial_stock: 12 }));
  ok(await admin.post('/api/products', { category: 'cigare', name: 'Cigare Bravo', reference: 'CIG-902', price: 14000 * UM, initial_stock: 0 }));
  ok(await admin.post('/api/products', { category: 'cigare', name: 'Cigare Charlie', reference: 'CIG-903', price: 8000 * UM, initial_stock: 5 }));
  return { server, admin, door: new Client(server) };
}

const send = (door, body, token = IMPORT_TOKEN) => door.post('/api/admin/stock-import', body, token === null ? {} : { 'x-import-token': token });
const ITEMS = [
  { reference: 'CIG-901', count: 30 },
  { reference: 'CIG-902', rename: 'Cigare Bravo Belicoso', count: 40 },
  { reference: 'CIG-903', count: 5 },
  { create: { name: 'Cigare Bravo Toro', price: 14000 }, count: 33 },
  { create: { name: 'Coupe-cigare fictif', price: 0 }, count: 70 },
];
const stock = (server, ref) => server.club.get('SELECT stock_qty FROM products WHERE reference = ?', ref)?.stock_qty;
const snapshot = (server) => ({
  products: server.club.all('SELECT reference, name, price, stock_qty FROM products ORDER BY id'),
  movements: server.club.get('SELECT COUNT(*) AS n FROM stock_movements').n,
});

test('porte : sans IMPORT_TOKEN 503, mauvais code 403, rien ne bouge', async () => {
  const off = await setup({});
  assert.equal((await send(off.door, { reason: REASON, items: ITEMS })).status, 503);
  const on = await setup();
  const before = snapshot(on.server);
  assert.equal((await send(on.door, { reason: REASON, items: ITEMS }, 'mauvais-code')).status, 403);
  assert.deepEqual(snapshot(on.server), before);
});

test('essai à blanc : avant / après pour chaque ligne, rien n’est écrit', async () => {
  const { server, door } = await setup();
  const before = snapshot(server);
  const plan = ok(await send(door, { dry_run: true, reason: REASON, items: ITEMS }));
  assert.equal(plan.dry_run, true);
  assert.deepEqual(plan.items.map((i) => [i.name, i.action, i.before, i.after]), [
    ['Cigare Alpha', 'ajuste', 12, 30],
    ['Cigare Bravo Belicoso', 'ajuste', 0, 40],
    ['Cigare Charlie', 'inchange', 5, 5],
    ['Cigare Bravo Toro', 'creer', 0, 33],
    ['Coupe-cigare fictif', 'creer', 0, 70],
  ]);
  assert.equal(plan.items[1].renamed_from, 'Cigare Bravo');
  assert.deepEqual(snapshot(server), before);
});

test('import : ajustements avec le motif, renommage, créations ; relancé, rien ne bouge', async () => {
  const { server, admin, door } = await setup();
  const done = ok(await send(door, { dry_run: false, reason: REASON, items: ITEMS }));
  assert.equal(done.dry_run, false);
  assert.equal(stock(server, 'CIG-901'), 30);
  assert.equal(stock(server, 'CIG-902'), 40);
  assert.equal(stock(server, 'CIG-903'), 5);
  assert.equal(server.club.get("SELECT name FROM products WHERE reference = 'CIG-902'").name, 'Cigare Bravo Belicoso');
  const toro = server.club.get("SELECT * FROM products WHERE name = 'Cigare Bravo Toro'");
  assert.deepEqual([toro.category, toro.price, toro.stock_qty, toro.active], ['cigare', 14000 * UM, 33, 1]);
  assert.match(toro.reference, /^CIG-\d+$/);
  const cutter = server.club.get("SELECT * FROM products WHERE name = 'Coupe-cigare fictif'");
  assert.deepEqual([cutter.price, cutter.stock_qty], [0, 70]);
  const alphaId = server.club.get("SELECT id FROM products WHERE reference = 'CIG-901'").id;
  const move = server.club.get('SELECT * FROM stock_movements WHERE product_id = ? ORDER BY id DESC LIMIT 1', alphaId);
  assert.deepEqual([move.kind, move.quantity, move.stock_after, move.reason, move.created_by], ['ajustement', 18, 30, REASON, null]);
  assert.ok(server.club.get("SELECT 1 AS x FROM audit_log WHERE action = 'import.inventaire'"));
  // The product's history shows the adjustment.
  assert.ok(JSON.stringify(ok(await admin.get(`/api/stock-movements?product_id=${alphaId}`))).includes(REASON));

  const before = snapshot(server);
  const again = ok(await send(door, { dry_run: false, reason: REASON, items: ITEMS }));
  assert.deepEqual(again.items.map((i) => i.action), ['inchange', 'inchange', 'inchange', 'inchange', 'inchange']);
  assert.deepEqual(snapshot(server), before);
});

test('fichier refusé en entier : référence inconnue, doublon, nombre faux, nom déjà pris, motif absent', async () => {
  const { server, door } = await setup();
  const before = snapshot(server);
  const bad = [
    { reason: REASON, items: [...ITEMS, { reference: 'CIG-999', count: 3 }] },
    { reason: REASON, items: [...ITEMS, { reference: 'CIG-901', count: 3 }] },
    { reason: REASON, items: [{ reference: 'CIG-901', count: -1 }] },
    { reason: REASON, items: [{ reference: 'CIG-901', create: { name: 'X', price: 0 }, count: 1 }] },
    { reason: REASON, items: [{ reference: 'CIG-902', rename: 'Cigare Alpha', count: 1 }] },
    { items: ITEMS },
  ];
  for (const body of bad) {
    const r = await send(door, { ...body, dry_run: false });
    assert.equal(r.status, 400, JSON.stringify(r.data));
  }
  assert.deepEqual(snapshot(server), before);
});
