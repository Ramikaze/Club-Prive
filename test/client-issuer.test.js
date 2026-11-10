// A client's temporary code is only as trusted as the staff member who gave it (security audit run-2): when that
// person loses the right to give codes (deactivated, or no longer administrator or associé), the codes he gave and the
// sessions opened with them stop working. A session opened with a code also ends when the code expires.
import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { Server, Client, ok } from './harness.js';
import { MIGRATIONS } from '../worker/schema.js';

const servers = [];
afterEach(() => {
  for (const server of servers.splice(0)) server.destroy();
});

const refused = (r, status) => assert.equal(r.status, status, JSON.stringify(r.data));

async function setup() {
  const server = new Server({});
  servers.push(server);
  await server.start();
  await server.addUser('proprietaire', 'Propriétaire', 'admin', 'mot-de-passe-proprio');
  await server.addUser('cigares', 'Associé cigares', 'associe', 'mot-de-passe-associe', 'cigares');
  const admin = new Client(server);
  await admin.login('proprietaire', 'mot-de-passe-proprio');
  const associate = new Client(server);
  await associate.login('cigares', 'mot-de-passe-associe');
  const associateId = server.club.get("SELECT id FROM users WHERE login = 'cigares'").id;
  const member = ok(await admin.post('/api/members', { first_name: 'jean', last_name: 'client', phone: '06 123 45 67' }));
  const { code } = ok(await associate.post(`/api/members/${member.id}/client-access`, {}));
  return { server, admin, associateId, member, code };
}

const signIn = (server, login, password) => new Client(server).post('/api/client/login', { login, password });

test('le code garde le nom de celui qui l’a donné', async () => {
  const { server, associateId, member } = await setup();
  assert.equal(server.club.get('SELECT temp_issued_by FROM client_accounts WHERE member_id = ?', member.id).temp_issued_by, associateId);
});

test('un associé désactivé : ses codes et les sessions ouvertes avec eux ne marchent plus', async () => {
  const { server, admin, associateId, member, code } = await setup();
  const holder = new Client(server);
  ok(await holder.post('/api/client/login', { login: member.member_no, password: code }));
  ok(await holder.get('/api/client/me'));
  ok(await admin.put(`/api/users/${associateId}`, { active: false }));
  refused(await holder.get('/api/client/me'), 401);
  refused(await signIn(server, member.member_no, code), 401);
  const a = server.club.get('SELECT temp_hash, temp_issued_by FROM client_accounts WHERE member_id = ?', member.id);
  assert.equal(a.temp_hash, null);
  assert.equal(a.temp_issued_by, null);
  const log = server.club.get("SELECT details FROM audit_log WHERE action = 'utilisateur.modifier' ORDER BY id DESC");
  assert.equal(JSON.parse(log.details).codes_clients_annules, 1);
});

test('un associé redevenu gérant : ses codes ne marchent plus', async () => {
  const { server, admin, associateId, member, code } = await setup();
  ok(await admin.put(`/api/users/${associateId}`, { role: 'gerant', rayon: null }));
  refused(await signIn(server, member.member_no, code), 401);
});

test('un associé qui change de rayon garde ses codes', async () => {
  const { server, admin, associateId, member, code } = await setup();
  ok(await admin.put(`/api/users/${associateId}`, { role: 'associe', rayon: 'alcool' }));
  ok(await signIn(server, member.member_no, code));
});

test('une session ouverte avec le code s’arrête quand le code expire', async () => {
  const { server, member, code } = await setup();
  const holder = new Client(server);
  ok(await holder.post('/api/client/login', { login: member.member_no, password: code }));
  server.club.run("UPDATE client_accounts SET temp_expires_at = '2020-01-01T00:00:00.000Z' WHERE member_id = ?", member.id);
  refused(await holder.get('/api/client/me'), 401);
});

test('la migration V26 existe', () => {
  assert.ok(MIGRATIONS.length >= 26);
});
