// Migration V25 (identifier chosen by the client) on a database at version 24 holding a client access made with the
// phone: the access keeps its login and password, is marked « identifier not chosen », and its client must choose one
// at his next sign-in before anything else.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Server, Client, ok } from './harness.js';
import { nodeDb } from '../worker/db-node.js';
import { hashPassword } from '../worker/auth.js';
import { MIGRATIONS } from '../worker/schema.js';

// A database at version 24 filled with every row of a database made on the current code (the V24 columns of each
// table only), as `v20Copy` does in test/credit-v21.test.js.
function v24Copy(sourceFile, file) {
  const db = nodeDb(file);
  db.exec('CREATE TABLE meta (key TEXT PRIMARY KEY, value TEXT NOT NULL)');
  db.transaction(() => {
    for (const statements of MIGRATIONS.slice(0, 24)) for (const statement of statements) db.exec(statement);
    db.run("INSERT INTO meta (key, value) VALUES ('schema_version', '24')");
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

test('migration V25 : les accès existants gardent leur identifiant, non choisi', async () => {
  const source = new Server({});
  const old = new Server({});
  try {
    await source.start();
    await source.addUser('admin', 'Propriétaire', 'admin', 'v25-admin-password');
    const admin = new Client(source);
    await admin.login('admin', 'v25-admin-password');
    const member = ok(await admin.post('/api/members', { first_name: 'jean', last_name: 'ancien', phone: '06 123 45 67' }));
    ok(await admin.post(`/api/members/${member.id}/client-access`, {}));
    // The access as V24 made it: the phone as login, a password chosen by the client.
    source.db.run(
      "UPDATE client_accounts SET login = '242061234567', password_hash = ?, temp_hash = NULL, temp_expires_at = NULL WHERE member_id = ?",
      await hashPassword('mot-de-passe-ancien'), member.id,
    );

    // A second access still holds a live temporary code (possibly handed out by a gérant before this update).
    const other = ok(await admin.post('/api/members', { first_name: 'awa', last_name: 'code', phone: '06 765 43 21' }));
    ok(await admin.post(`/api/members/${other.id}/client-access`, {}));
    assert.ok(source.db.get('SELECT temp_hash FROM client_accounts WHERE member_id = ?', other.id).temp_hash);

    v24Copy(source.file, old.file);
    await old.start(); // migrates 24 -> 25
    assert.equal(old.db.get("SELECT value FROM meta WHERE key = 'schema_version'").value, String(MIGRATIONS.length));
    assert.equal(MIGRATIONS.length, 25);
    const row = old.db.get('SELECT * FROM client_accounts WHERE member_id = ?', member.id);
    assert.equal(row.login, '242061234567');
    assert.equal(row.login_chosen, 0);
    assert.ok(row.password_hash);
    // Live temporary codes are void: an associé or the administrator issues them again.
    const voided = old.db.get('SELECT temp_hash, temp_expires_at FROM client_accounts WHERE member_id = ?', other.id);
    assert.equal(voided.temp_hash, null);
    assert.equal(voided.temp_expires_at, null);
    assert.throws(() => old.db.run('UPDATE client_accounts SET login_chosen = 2 WHERE id = ?', row.id), /constraint/i);

    // The client signs in with his phone and password as before, and is asked for an identifier first.
    const client = new Client(old);
    const signedIn = ok(await client.post('/api/client/login', { login: '06 123 45 67', password: 'mot-de-passe-ancien' }));
    assert.equal(signedIn.login_chosen, false);
    assert.equal(signedIn.must_set_password, false);
    const blocked = await client.get('/api/client/account');
    assert.equal(blocked.status, 403);
    assert.equal(blocked.data.error.code, 'IDENTIFIANT_A_CHOISIR');
    ok(await client.post('/api/client/login-name', { login: 'jean.ancien' }));
    ok(await client.get('/api/client/account'));
  } finally {
    source.destroy();
    old.destroy();
  }
});
