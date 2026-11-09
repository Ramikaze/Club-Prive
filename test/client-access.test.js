// Client access from the staff side: the administrator or an associé creates the access of a member or regular client
// (provisional identifier = his member number, temporary code shown once), renews the code and restores the access;
// every staff member, the manager included, sees the access and may cut it.
import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { sha256Hex } from '../worker/auth.js';
import { Server, Client, ok, ORIGIN } from './harness.js';

const servers = [];
afterEach(() => {
  for (const server of servers.splice(0)) server.destroy();
});

const CODE_RE = /^[A-HJ-NP-Z2-9]{8}$/;

async function setup(env = {}, opts = {}) {
  const server = new Server(env, opts);
  servers.push(server);
  await server.start();
  await server.addUser('proprietaire', 'Propriétaire', 'admin', 'mot-de-passe-proprio');
  await server.addUser('cigares', 'Associé cigares', 'associe', 'mot-de-passe-associe', 'cigares');
  await server.addUser('gerant', 'Gérant', 'gerant', 'mot-de-passe-gerant');
  const admin = new Client(server);
  await admin.login('proprietaire', 'mot-de-passe-proprio');
  const associate = new Client(server);
  await associate.login('cigares', 'mot-de-passe-associe');
  const manager = new Client(server);
  await manager.login('gerant', 'mot-de-passe-gerant');
  return { server, admin, associate, manager };
}

let n = 0;
const newMember = async (who, phone = '06 123 45 67') => ok(await who.post('/api/members', { first_name: 'jean', last_name: `membre${++n}`, phone }));
const newClient = async (who, phone) => ok(await who.post('/api/clients', { first_name: 'awa', last_name: `client${++n}`, phone }));
const account = (server, memberId) => server.club.get('SELECT * FROM client_accounts WHERE member_id = ?', memberId);
const addSession = (server, accountId) => server.club.run(
  "INSERT INTO client_sessions (token_hash, account_id, must_set_password, created_at, expires_at) VALUES (?, ?, 0, '2026-01-01T00:00:00Z', '2099-01-01T00:00:00Z')",
  `tok${++n}`, accountId,
);

test('créer l’accès : identifiant provisoire = numéro de membre en minuscules, code de 8 caractères', async () => {
  const { server, admin } = await setup();
  const m = await newMember(admin);
  const none = ok(await admin.get(`/api/members/${m.id}/client-access`));
  assert.equal(none.state, 'aucun');
  assert.equal(none.login_chosen, false);
  const res = ok(await admin.post(`/api/members/${m.id}/client-access`, {}));
  assert.match(res.login, /^m-\d{4}$/);
  assert.equal(res.login, m.member_no.toLowerCase());
  assert.match(res.code, CODE_RE);
  assert.equal(res.status.state, 'en_attente');
  assert.equal(res.status.login_chosen, false);
  assert.ok(res.expires_at);
  const row = account(server, m.id);
  assert.equal(row.login, m.member_no.toLowerCase());
  assert.equal(row.login_chosen, 0);
  assert.ok(row.temp_hash.startsWith('pbkdf2-sha256$'));
  assert.ok(!row.temp_hash.includes(res.code));
  assert.equal(row.password_hash, null);
  const status = ok(await admin.get(`/api/members/${m.id}/client-access`));
  assert.equal(status.login, m.member_no.toLowerCase());
  assert.equal(status.login_chosen, false);
});

test('un associé crée l’accès d’un client régulier ; le téléphone de la fiche ne compte plus', async () => {
  const { associate } = await setup();
  const c = await newClient(associate, '06 555 00 11');
  const res = ok(await associate.post(`/api/members/${c.id}/client-access`, {}));
  assert.match(res.login, /^c-\d{4}$/);
  assert.equal(res.login, c.member_no.toLowerCase());
  // A file without a usable phone, or with the phone of another file, gets its access all the same.
  const noPhone = await newMember(associate, '++++++');
  assert.equal(ok(await associate.post(`/api/members/${noPhone.id}/client-access`, {})).login, noPhone.member_no.toLowerCase());
  const twin = await newClient(associate, '+242 06 555 00 11');
  assert.equal(ok(await associate.post(`/api/members/${twin.id}/client-access`, {})).login, twin.member_no.toLowerCase());
});

test('le gérant ne crée pas d’accès, ne donne pas de code et ne rétablit pas ; il voit l’accès et le coupe', async () => {
  const { server, admin, manager } = await setup();
  const m = await newMember(manager);
  const create = await manager.post(`/api/members/${m.id}/client-access`, {});
  assert.equal(create.status, 403);
  assert.equal(create.data.error.code, 'INTERDIT');
  assert.equal(create.data.code, undefined);
  assert.ok(!account(server, m.id));

  ok(await admin.post(`/api/members/${m.id}/client-access`, {}));
  const before = account(server, m.id);
  const renew = await manager.post(`/api/members/${m.id}/client-access/code`, {});
  assert.equal(renew.status, 403);
  assert.equal(renew.data.error.code, 'INTERDIT');
  assert.equal(account(server, m.id).temp_hash, before.temp_hash);

  const seen = ok(await manager.get(`/api/members/${m.id}/client-access`));
  assert.equal(seen.state, 'en_attente');
  assert.equal(seen.login, m.member_no.toLowerCase());
  assert.equal(seen.login_chosen, false);
  assert.equal(ok(await manager.post(`/api/members/${m.id}/client-access/disable`, {})).state, 'coupe');
  const enable = await manager.post(`/api/members/${m.id}/client-access/enable`, {});
  assert.equal(enable.status, 403);
  assert.equal(enable.data.error.code, 'INTERDIT');
  assert.equal(ok(await manager.get(`/api/members/${m.id}/client-access`)).state, 'coupe');

  const actions = server.club.all("SELECT action FROM audit_log WHERE action LIKE 'client.acces%' ORDER BY id").map((r) => r.action);
  assert.deepEqual(actions, ['client.acces.creer', 'client.acces.couper']);
});

test('un associé renouvelle le code et rétablit l’accès', async () => {
  const { server, admin, associate } = await setup();
  const m = await newMember(admin);
  ok(await admin.post(`/api/members/${m.id}/client-access`, {}));
  assert.match(ok(await associate.post(`/api/members/${m.id}/client-access/code`, {})).code, CODE_RE);
  assert.equal(ok(await associate.post(`/api/members/${m.id}/client-access/disable`, {})).state, 'coupe');
  assert.equal(ok(await associate.post(`/api/members/${m.id}/client-access/enable`, {})).state, 'en_attente');
  assert.equal(account(server, m.id).active, 1);
});

test('refus : deuxième accès, fiche désactivée', async () => {
  const { admin } = await setup();
  const m = await newMember(admin);
  ok(await admin.post(`/api/members/${m.id}/client-access`, {}));
  const again = await admin.post(`/api/members/${m.id}/client-access`, {});
  assert.equal(again.status, 409);
  assert.equal(again.data.error.code, 'ACCES_EXISTE');

  const off = await newMember(admin, '06 999 88 77');
  ok(await admin.post(`/api/members/${off.id}/deactivate`, { reason: 'Départ' }));
  const inactive = await admin.post(`/api/members/${off.id}/client-access`, {});
  assert.equal(inactive.status, 409);
  assert.equal(inactive.data.error.code, 'MEMBRE_DESACTIVE');
});

test('le journal ne contient jamais le code', async () => {
  const { server, admin } = await setup();
  const m = await newMember(admin);
  const codes = [ok(await admin.post(`/api/members/${m.id}/client-access`, {})).code];
  codes.push(ok(await admin.post(`/api/members/${m.id}/client-access/code`, {})).code);
  ok(await admin.post(`/api/members/${m.id}/client-access/disable`, {}));
  ok(await admin.post(`/api/members/${m.id}/client-access/enable`, {}));
  const rows = server.club.all("SELECT action, details FROM audit_log WHERE action LIKE 'client.acces%'");
  assert.deepEqual(rows.map((r) => r.action), ['client.acces.creer', 'client.acces.code', 'client.acces.couper', 'client.acces.retablir']);
  for (const r of rows) {
    for (const code of codes) assert.ok(!r.details.includes(code));
    assert.ok(r.details.includes(m.member_no.toLowerCase()));
  }
});

test('nouveau code : l’ancien mot de passe et les sessions disparaissent, l’identifiant reste', async () => {
  const { server, admin } = await setup();
  const m = await newMember(admin);
  const first = ok(await admin.post(`/api/members/${m.id}/client-access`, {}));
  const acc = account(server, m.id);
  server.club.run("UPDATE client_accounts SET login = 'jean.m', login_chosen = 1, password_hash = 'x', temp_hash = NULL WHERE id = ?", acc.id);
  addSession(server, acc.id);
  const active = ok(await admin.get(`/api/members/${m.id}/client-access`));
  assert.equal(active.state, 'actif');
  assert.equal(active.login, 'jean.m');
  assert.equal(active.login_chosen, true);
  // The file's phone changes: the identifier does not follow it.
  ok(await admin.put(`/api/members/${m.id}`, { phone: '06 777 66 55' }));
  const second = ok(await admin.post(`/api/members/${m.id}/client-access/code`, {}));
  assert.match(second.code, CODE_RE);
  assert.notEqual(second.code, first.code);
  assert.equal(second.login, 'jean.m');
  assert.equal(second.status.state, 'en_attente');
  assert.equal(second.status.login_chosen, true);
  assert.equal(server.club.get('SELECT COUNT(*) AS n FROM client_sessions').n, 0);
  const row = account(server, m.id);
  assert.equal(row.password_hash, null);
  assert.equal(row.login, 'jean.m');
  assert.equal(row.login_chosen, 1);
});

test('couper l’accès ferme les sessions, le rétablir le rend', async () => {
  const { server, admin } = await setup();
  const m = await newMember(admin);
  ok(await admin.post(`/api/members/${m.id}/client-access`, {}));
  addSession(server, account(server, m.id).id);
  assert.equal(ok(await admin.post(`/api/members/${m.id}/client-access/disable`, {})).state, 'coupe');
  assert.equal(server.club.get('SELECT COUNT(*) AS n FROM client_sessions').n, 0);
  assert.equal(ok(await admin.post(`/api/members/${m.id}/client-access/enable`, {})).state, 'en_attente');
});

test('désactiver la fiche ferme les sessions du client', async () => {
  const { server, admin } = await setup();
  const m = await newMember(admin);
  ok(await admin.post(`/api/members/${m.id}/client-access`, {}));
  addSession(server, account(server, m.id).id);
  ok(await admin.post(`/api/members/${m.id}/deactivate`, { reason: 'Départ' }));
  assert.equal(server.club.get('SELECT COUNT(*) AS n FROM client_sessions').n, 0);
});

test('espace démo : créer un accès est refusé', async () => {
  const { server: real, admin } = await setup();
  const demo = new Server({}, { demo: true });
  servers.push(demo);
  await demo.start();
  const m = await newMember(admin);
  const hash = await sha256Hex(decodeURIComponent(admin.cookie.split('=')[1]));
  const inDemo = new Client({
    fetch: async (url, init) => demo.api.handleDemo(new Request(ORIGIN + url, init), structuredClone(real.api.demoContext(hash))),
  });
  const res = await inDemo.post(`/api/members/${m.id}/client-access`, {});
  assert.equal(res.status, 403);
  assert.equal(res.data.error.code, 'MODE_DEMO');
});

test('le code n’est jamais gardé dans les clés d’idempotence', async () => {
  const { server, admin } = await setup();
  const m = await newMember(admin);
  const headers = { 'idempotency-key': 'cle-test-0001' };
  const created = (await admin.call('POST', `/api/members/${m.id}/client-access`, {}, headers)).data;
  const renewed = (await admin.call('POST', `/api/members/${m.id}/client-access/code`, {}, { 'idempotency-key': 'cle-test-0002' })).data;
  assert.match(created.code, CODE_RE);
  assert.match(renewed.code, CODE_RE);
  assert.equal(server.club.get('SELECT COUNT(*) AS n FROM idempotency_keys').n, 0);
  // A retry with the same key is not replayed: it answers as a fresh call.
  const retry = await admin.call('POST', `/api/members/${m.id}/client-access/code`, {}, { 'idempotency-key': 'cle-test-0002' });
  assert.notEqual(retry.data.code, renewed.code);
});
