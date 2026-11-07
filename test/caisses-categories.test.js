// The purchase categories of the associés' caisses: « Achats boissons » split into « Achats champagne » and « Achats
// autres boissons », each purchase category and « Apport des associés » found by a stable code (never by its name),
// the old drinks purchases moved into the Champagne caisse, and the V20 ledger that accepts a profit taking.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { Server, Client, ok } from './harness.js';
import { MIGRATIONS, migrate } from '../worker/schema.js';
import { nodeDb } from '../worker/db-node.js';
import { splitHalves } from '../shared/caisses.js';

const server = new Server({});
let admin;

before(async () => {
  await server.start();
  await server.addUser('admin', 'Admin', 'admin', 'caisses-categories-password');
  admin = new Client(server);
  await admin.login('admin', 'caisses-categories-password');
});
after(() => server.destroy());

const categories = async () => ok(await admin.get('/api/ledger/categories'));
const byName = (list, name) => list.find((c) => c.name === name);

test('catégories neuves : achats champagne, autres boissons et cigares, chacune avec son code', async () => {
  const list = await categories();
  assert.equal(byName(list, 'Achats champagne')?.code, 'achat_champagne');
  assert.equal(byName(list, 'Achats autres boissons')?.code, 'achat_autres_boissons');
  assert.equal(byName(list, 'Achats cigares')?.code, 'achat_cigares');
  const apport = byName(list, 'Apport des associés');
  assert.equal(apport?.kind, 'recette');
  assert.equal(apport?.code, 'apport');
  assert.equal(byName(list, 'Achats boissons'), undefined);
});

test('club existant : « Achats boissons » devient « Achats champagne » et ses dépenses passent dans la caisse Champagne', async () => {
  const club = server.club;
  const id = club.get("SELECT id FROM categories WHERE code = 'achat_champagne'").id;
  club.run('UPDATE categories SET code = NULL');
  club.run("UPDATE categories SET name = 'Achats boissons' WHERE id = ?", id);
  club.run("DELETE FROM categories WHERE name = 'Achats autres boissons'");
  const expense = club.insert(
    `INSERT INTO ledger_entries (kind, biz_date, category_id, account, method, amount, label, status, created_at)
     VALUES ('depense', '2026-11-01', ?, NULL, 'Espèces', 1000, 'Bouteilles', 'active', '2026-11-01T10:00:00Z')`, id,
  );
  await server.restart();
  const row = server.club.get('SELECT name, code FROM categories WHERE id = ?', id);
  assert.deepEqual({ ...row }, { name: 'Achats champagne', code: 'achat_champagne' });
  assert.equal(server.club.get("SELECT code FROM categories WHERE name = 'Achats autres boissons'")?.code, 'achat_autres_boissons');
  assert.equal(server.club.get('SELECT account FROM ledger_entries WHERE id = ?', expense).account, 'alcool');
});

test('un nom déjà pris n’est pas écrasé', async () => {
  const club = server.club;
  club.run('UPDATE categories SET code = NULL');
  club.run("INSERT INTO categories (kind, name, created_at) VALUES ('depense', 'Achats boissons', '2026-11-01T10:00:00Z')");
  await server.restart();
  assert.equal(server.club.get("SELECT code FROM categories WHERE name = 'Achats champagne'").code, 'achat_champagne');
  assert.equal(server.club.get("SELECT code FROM categories WHERE name = 'Achats boissons'").code, null);
});

test('une catégorie des caisses se renomme mais ne se désactive pas', async () => {
  const cigars = byName(await categories(), 'Achats cigares');
  const renamed = ok(await admin.put(`/api/ledger/categories/${cigars.id}`, { name: 'Achats cigares Cuba' }));
  assert.equal(renamed.find((c) => c.id === cigars.id).code, 'achat_cigares');
  const r = await admin.put(`/api/ledger/categories/${cigars.id}`, { active: false });
  assert.equal(r.status, 409, JSON.stringify(r.data));
  assert.equal(r.data.error.code, 'CATEGORIE_PROTEGEE');
});

test('migration V20 : prise de bénéfices sans catégorie, jamais sans caisse', () => {
  const db = nodeDb(':memory:');
  try {
    migrate(db);
    assert.equal(db.get("SELECT value FROM meta WHERE key = 'schema_version'").value, String(MIGRATIONS.length));
    const insert = (kind, account, categoryId) => db.run(
      `INSERT INTO ledger_entries (kind, biz_date, category_id, account, method, amount, label, created_at)
       VALUES (?, '2026-11-07', ?, ?, 'Espèces', 100, 'Test', '2026-11-07T10:00:00Z')`, kind, categoryId, account,
    );
    insert('retrait', 'cigares', null);
    assert.equal(db.get("SELECT COUNT(*) AS n FROM ledger_entries WHERE kind = 'retrait'").n, 1);
    assert.throws(() => insert('retrait', null, null));
    assert.throws(() => insert('depense', null, null));
  } finally { db.close(); }
});

test('splitHalves partage à l’unité près', () => {
  assert.deepEqual(splitHalves(10001), { alcool: 5001, cigares: 5000 });
  assert.deepEqual(splitHalves(10000), { alcool: 5000, cigares: 5000 });
});
