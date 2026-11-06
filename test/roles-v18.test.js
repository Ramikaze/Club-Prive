// Migration V18 and the associé role: the users table is rebuilt with the new role and its rayon, the
// existing accounts keep their ids, hashes, sessions and everything that cites them; the shared role rules.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { nodeDb } from '../worker/db-node.js';
import { MIGRATIONS } from '../worker/schema.js';
import { ROLES, ROLE_LABEL, RAYONS, RAYON_LABEL, SHOP, accountOfCategory, isBoss, ownsAccount, canSellIn } from '../shared/roles.js';
import { Server, Client, ok } from './harness.js';

const PASSWORD = 'v18-admin-password';
const server = new Server({});
let admin;

before(async () => {
  await server.start();
  await server.addUser('admin', 'Propriétaire', 'admin', PASSWORD);
  admin = new Client(server);
  await admin.login('admin', PASSWORD);
});
after(() => server.destroy());

const refused = (r, status) => assert.equal(r.status, status, JSON.stringify(r.data));
const newUser = (body) => admin.post('/api/users', { password: 'v18-some-password', name: 'Compte', ...body });

test('la base passe à la dernière version sans toucher aux comptes existants', () => {
  assert.equal(server.db.get("SELECT value FROM meta WHERE key = 'schema_version'").value, String(MIGRATIONS.length));
  assert.equal(server.club.get("SELECT role, rayon FROM users WHERE login = 'admin'").role, 'admin');
  assert.equal(server.club.get('SELECT kind FROM members LIMIT 1')?.kind ?? 'membre', 'membre');
});

test('un associé a un rayon, les autres rôles n’en ont pas', async () => {
  const cig = ok(await newUser({ login: 'assoc-cig', role: 'associe', rayon: 'cigares' }));
  assert.equal(cig.rayon, 'cigares');
  assert.equal(cig.role, 'associe');
  refused(await newUser({ login: 'assoc-none', role: 'associe' }), 400);
  refused(await newUser({ login: 'assoc-bad', role: 'associe', rayon: 'tabac' }), 400);
  const ger = ok(await newUser({ login: 'ger-rayon', role: 'gerant', rayon: 'alcool' }));
  assert.equal(ger.rayon, null);
  refused(await newUser({ login: 'role-bad', role: 'patron' }), 400);
});

test('changer le rayon ferme les sessions', async () => {
  const created = ok(await newUser({ login: 'assoc-sess', role: 'associe', rayon: 'cigares' }));
  const assoc = new Client(server);
  await assoc.login('assoc-sess', 'v18-some-password');
  ok(await assoc.get('/api/dashboard'));
  const changed = ok(await admin.put(`/api/users/${created.id}`, { rayon: 'alcool' }));
  assert.equal(changed.rayon, 'alcool');
  refused(await assoc.get('/api/dashboard'), 401);
  // Leaving the associé role drops the rayon.
  const back = ok(await admin.put(`/api/users/${created.id}`, { role: 'gerant' }));
  assert.equal(back.rayon, null);
  // An associé without rayon is refused.
  refused(await admin.put(`/api/users/${created.id}`, { role: 'associe', rayon: null }), 400);
});

test('l’espace démo reçoit le rayon des associés', async () => {
  ok(await newUser({ login: 'assoc-demo', role: 'associe', rayon: 'alcool' }));
  const config = server.club.demoConfig();
  const src = config.users.find((u) => u.name === 'Compte' && u.rayon === 'alcool');
  assert.ok(src);
  assert.ok(config.users.every((u) => 'rayon' in u));
  const demo = new Server({}, { demo: true });
  try {
    await demo.start();
    demo.club.mirrorUsers(config.users);
    assert.equal(demo.club.get('SELECT rayon FROM users WHERE id = ?', src.id).rayon, 'alcool');
    // A second pass changes nothing; a changed rayon is mirrored.
    demo.club.mirrorUsers(config.users.map((u) => (u.id === src.id ? { ...u, rayon: 'cigares' } : u)));
    assert.equal(demo.club.get('SELECT rayon FROM users WHERE id = ?', src.id).rayon, 'cigares');
  } finally {
    demo.destroy();
  }
});

// A database at version 17 holding records made through the API: built with the first 17 migrations, then filled
// with every row of a database made on the current code (the V17 columns of each table only), as `v14Copy` does
// in test/wallet.test.js.
function v17Copy(sourceFile, file) {
  const db = nodeDb(file);
  db.exec('CREATE TABLE meta (key TEXT PRIMARY KEY, value TEXT NOT NULL)');
  db.transaction(() => {
    for (const statements of MIGRATIONS.slice(0, 17)) for (const statement of statements) db.exec(statement);
    db.run("INSERT INTO meta (key, value) VALUES ('schema_version', '17')");
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

test('migration sans perte : V18 garde les comptes, leurs sessions et ce qui les cite', async () => {
  const source = new Server({}, { lenientTariffs: true });
  const old = new Server({});
  try {
    await source.start();
    // Admin and gérant only: the V17 CHECK on users.role has no associé.
    await source.addUser('gerant', 'Gérant', 'gerant', 'v18-manager-password');
    const g = new Client(source);
    await g.login('gerant', 'v18-manager-password'); // one open session
    ok(await g.post('/api/members', { first_name: 'Hugo', last_name: 'Migration', phone: '+000 00 00 00 00' }));
    const read = (db) => ({
      users: db.all('SELECT id, login, name, role, password_hash, active, created_by FROM users ORDER BY id'),
      sessions: db.all('SELECT token_hash, user_id, expires_at FROM sessions ORDER BY token_hash'),
      members: db.all('SELECT id, member_no, created_by, updated_by FROM members ORDER BY id'),
      payments: db.all('SELECT id, created_by FROM payments ORDER BY id'),
    });
    const expected = read(source.db);
    assert.ok(expected.sessions.length >= 1);
    assert.ok(expected.members.length >= 1);

    v17Copy(source.file, old.file);
    await old.start(); // migrates 17 -> 18
    assert.equal(old.db.get("SELECT value FROM meta WHERE key = 'schema_version'").value, String(MIGRATIONS.length));
    assert.deepEqual(read(old.db), expected); // same ids, roles, hashes, sessions and created_by references
    assert.ok(old.db.all('SELECT rayon FROM users').every((u) => u.rayon === null));
    assert.ok(old.db.all('SELECT kind FROM members').every((m) => m.kind === 'membre'));
    assert.deepEqual(old.db.all('PRAGMA foreign_key_check'), []);
    assert.equal(old.db.get("SELECT COUNT(*) AS n FROM sqlite_master WHERE name = 'users_v17'").n, 0);
  } finally {
    source.destroy();
    old.destroy();
  }
});

test('règles de rôle partagées', () => {
  const adminUser = { role: 'admin' }; const cig = { role: 'associe', rayon: 'cigares' }; const ger = { role: 'gerant' };
  assert.equal(isBoss(adminUser) && isBoss(cig) && !isBoss(ger), true);
  assert.equal(ownsAccount(cig, 'cigares'), true); assert.equal(ownsAccount(cig, 'alcool'), false);
  assert.equal(ownsAccount(adminUser, 'alcool'), true); assert.equal(ownsAccount(ger, 'alcool'), false);
  assert.equal(canSellIn(ger, 'alcool'), true); assert.equal(canSellIn(cig, 'alcool'), false);
  assert.equal(canSellIn(cig, 'cigares'), true);
  assert.equal(accountOfCategory('bouteille'), 'alcool'); assert.equal(accountOfCategory('cigare'), 'cigares');
  assert.deepEqual(ROLES, ['admin', 'associe', 'gerant']);
  assert.deepEqual(RAYONS, ['cigares', 'alcool']);
  assert.equal(ROLE_LABEL.associe, 'Associé'); assert.equal(RAYON_LABEL.alcool, 'Champagne');
  assert.equal(SHOP.alcool.category, 'bouteille');
});
