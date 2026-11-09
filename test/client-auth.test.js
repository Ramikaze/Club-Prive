// Client sign-in (spec « Espace client »): the client signs in with his phone number and the temporary code, chooses
// his password first, then signs in with it. His session is his own (table client_sessions, cookie csid limited to
// /api/client): a client session never opens a staff route, a staff session never opens a client route.
import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { Server, Site, Client, ok } from './harness.js';
import { ALWAYS_REAL } from '../worker/space.js';
import { sha256Hex } from '../worker/auth.js';

const servers = [];
afterEach(() => {
  for (const server of servers.splice(0)) server.destroy();
});

const PASSWORD = 'mon-mot-de-passe-client';

async function setup() {
  const server = new Server();
  servers.push(server);
  await server.start();
  await server.addUser('proprietaire', 'Propriétaire', 'admin', 'mot-de-passe-proprio');
  const admin = new Client(server);
  await admin.login('proprietaire', 'mot-de-passe-proprio');
  const member = ok(await admin.post('/api/members', { first_name: 'jean', last_name: 'dupont', phone: '06 123 45 67' }));
  const { code } = ok(await admin.post(`/api/members/${member.id}/client-access`, {}));
  return { server, admin, member, code };
}

const signIn = (client, login, password, ip = 'local') => client.post('/api/client/login', { login, password }, { 'cf-connecting-ip': ip });
const account = (server, memberId) => server.club.get('SELECT * FROM client_accounts WHERE member_id = ?', memberId);

// A client who chose his password: signed in with it, his session is a full one.
async function signedInClient(server, code) {
  const client = new Client(server);
  ok(await signIn(client, '06 123 45 67', code));
  ok(await client.post('/api/client/password', { new_password: PASSWORD }));
  return client;
}

test('première connexion avec le code : choisir son mot de passe d’abord', async () => {
  const { server, member, code } = await setup();
  const client = new Client(server);
  const first = ok(await signIn(client, '06 123 45 67', code));
  assert.equal(first.must_set_password, true);
  assert.deepEqual(first.member, { first_name: 'Jean', last_name: 'DUPONT', member_no: member.member_no, kind: 'membre' });

  const blocked = await client.get('/api/client/account');
  assert.equal(blocked.status, 403);
  assert.equal(blocked.data.error.code, 'MOT_DE_PASSE_A_CHOISIR');
  assert.equal(ok(await client.get('/api/client/me')).must_set_password, true);

  const short = await client.post('/api/client/password', { new_password: 'court' });
  assert.equal(short.status, 400);
  const chosen = ok(await client.post('/api/client/password', { new_password: PASSWORD }));
  assert.equal(chosen.must_set_password, false);
  // The same session goes on, now a full one. An unknown client path is then 404; without a session, 401 like any other.
  assert.equal(ok(await client.get('/api/client/me')).must_set_password, false);
  assert.equal((await client.get('/api/client/inconnu')).status, 404);
  assert.equal((await new Client(server).get('/api/client/inconnu')).status, 401);
  const row = account(server, member.id);
  assert.ok(row.password_hash.startsWith('pbkdf2-sha256$'));
  assert.ok(!row.password_hash.includes(PASSWORD));
  assert.equal(row.temp_hash, null);

  // The code served once: it no longer opens anything.
  const again = await signIn(new Client(server), '06 123 45 67', code);
  assert.equal(again.status, 401);
  assert.equal(again.data.error.code, 'IDENTIFIANTS');
  const signedIn = ok(await signIn(new Client(server), '06 123 45 67', PASSWORD));
  assert.equal(signedIn.must_set_password, false);
  assert.ok(account(server, member.id).last_login_at);
});

test('le code expire après 7 jours', async () => {
  const { server, member, code } = await setup();
  server.club.run("UPDATE client_accounts SET temp_expires_at = '2020-01-01T00:00:00.000Z' WHERE member_id = ?", member.id);
  const r = await signIn(new Client(server), '06 123 45 67', code);
  assert.equal(r.status, 401);
  assert.equal(r.data.error.code, 'IDENTIFIANTS');
});

test('le numéro s’écrit comme on veut', async () => {
  const { server, code } = await setup();
  for (const login of ['06 123 45 67', '+242061234567', '00242061234567', ' 242 06 12 34 567 ']) {
    const r = await signIn(new Client(server), login, code);
    assert.equal(r.status, 200, `${login} ${JSON.stringify(r.data)}`);
  }
  // A number WhatsApp could not read answers like any wrong identifier, not with a server error. (Each from its own
  // address: they all share one lockout key per address.)
  for (const [i, login] of ['12', '', null, 123, ['06 123 45 67'], { n: 1 }].entries()) {
    const r = await signIn(new Client(server), login, code, `10.0.1.${i}`);
    assert.equal(r.status, 401, JSON.stringify(login));
    assert.equal(r.data.error.code, 'IDENTIFIANTS');
  }
});

test('cinq échecs bloquent une minute', async () => {
  const { server, code } = await setup();
  const visitor = new Client(server);
  for (let i = 0; i < 5; i += 1) assert.equal((await signIn(visitor, '06 123 45 67', 'faux', '10.0.0.1')).status, 401);
  const locked = await signIn(visitor, '06 123 45 67', 'faux', '10.0.0.1');
  assert.equal(locked.status, 429);
  assert.equal(locked.data.error.code, 'TROP_DE_TENTATIVES');
  // The same number written another way is the same identifier; even the right code waits for the minute.
  assert.equal((await signIn(visitor, '+242061234567', code, '10.0.0.1')).status, 429);
  // Another address is not locked.
  assert.equal((await signIn(visitor, '06 123 45 67', code, '10.0.0.2')).status, 200);
});

test('même réponse pour un inconnu et un mauvais mot de passe', async () => {
  const { server, admin, member } = await setup();
  const wrong = await signIn(new Client(server), '06 123 45 67', 'mauvais-mot-de-passe', '10.0.0.3');
  const unknown = await signIn(new Client(server), '06 000 00 01', 'mauvais-mot-de-passe', '10.0.0.3');
  const unusable = await signIn(new Client(server), '12', 'mauvais-mot-de-passe', '10.0.0.3');
  ok(await admin.post(`/api/members/${member.id}/client-access/disable`, {}));
  const cut = await signIn(new Client(server), '06 123 45 67', 'mauvais-mot-de-passe', '10.0.0.4');
  for (const r of [wrong, unknown, unusable, cut]) {
    assert.equal(r.status, 401);
    assert.deepEqual(r.data, {
      error: { code: 'IDENTIFIANTS', message: 'Identifiant ou mot de passe incorrect.', details: null },
    });
    assert.equal(r.headers.get('set-cookie'), null);
  }
});

test('séparation', async () => {
  const { server, admin, member, code } = await setup();
  const client = await signedInClient(server, code);
  assert.match(client.cookie, /^csid=./);
  assert.match(admin.cookie, /^sid=./);

  // A client session opens no staff route.
  for (const url of ['/api/me', '/api/members', '/api/dashboard', '/api/products']) {
    const r = await client.get(url);
    assert.equal(r.status, 401, url);
  }
  assert.equal((await client.post('/api/shop/sales', { account: 'cigares', lines: [] })).status, 401);
  // The client's token is not a staff token under the staff cookie's name either.
  const asStaff = new Client(server);
  asStaff.cookie = `sid=${client.cookie.slice('csid='.length)}`;
  assert.equal((await asStaff.get('/api/me')).status, 401);

  // A staff session opens no client route.
  for (const url of ['/api/client/me', '/api/client/account']) {
    const r = await admin.get(url);
    assert.equal(r.status, 401, url);
  }
  assert.equal((await admin.post('/api/client/password', { new_password: 'nouveau-mot-de-passe' })).status, 401);
  const asClient = new Client(server);
  asClient.cookie = `csid=${admin.cookie.slice('sid='.length)}`;
  assert.equal((await asClient.get('/api/client/me')).status, 401);

  // A browser holding both cookies gets each space with its own identity.
  const both = new Client(server);
  both.cookie = `${admin.cookie}; ${client.cookie}`;
  assert.equal(ok(await both.get('/api/me')).user.name, 'Propriétaire');
  assert.equal(ok(await both.get('/api/client/me')).member.member_no, member.member_no);
  both.cookie = `${client.cookie}; ${admin.cookie}`;
  assert.equal(ok(await both.get('/api/me')).user.name, 'Propriétaire');
  assert.equal(ok(await both.get('/api/client/me')).member.member_no, member.member_no);
});

test('le cookie client est limité à /api/client', async () => {
  const { server, code } = await setup();
  const r = await signIn(new Client(server), '06 123 45 67', code);
  const cookie = r.headers.get('set-cookie');
  assert.match(cookie, /^csid=[^;]+;/);
  for (const part of ['HttpOnly', 'SameSite=Lax', 'Path=/api/client', `Max-Age=${30 * 86400}`]) {
    assert.ok(cookie.split('; ').includes(part), `${part} dans ${cookie}`);
  }
  assert.ok(!cookie.includes('Path=/;'));

  // Signing out clears the cookie on the same path and ends the session.
  const client = new Client(server);
  ok(await signIn(client, '06 123 45 67', code));
  const before = client.cookie;
  const out = await client.post('/api/client/logout', {});
  assert.equal(out.status, 200);
  assert.ok(out.headers.get('set-cookie').split('; ').includes('Path=/api/client'));
  assert.ok(out.headers.get('set-cookie').includes('Max-Age=0'));
  client.cookie = before;
  assert.equal((await client.get('/api/client/me')).status, 401);
  const hash = await sha256Hex(decodeURIComponent(before.slice('csid='.length)));
  assert.equal(server.club.get('SELECT COUNT(*) AS n FROM client_sessions WHERE token_hash = ?', hash).n, 0);
});

test('accès coupé ou fiche désactivée : la session ne marche plus', async () => {
  const { server, admin, member, code } = await setup();
  const client = await signedInClient(server, code);
  ok(await client.get('/api/client/me'));
  ok(await admin.post(`/api/members/${member.id}/client-access/disable`, {}));
  assert.equal((await client.get('/api/client/me')).status, 401);
  assert.equal((await signIn(new Client(server), '06 123 45 67', PASSWORD)).status, 401);

  // A file switched off by any other way than the staff's button: the session check refuses it on its own.
  ok(await admin.post(`/api/members/${member.id}/client-access/enable`, {}));
  const again = new Client(server);
  ok(await signIn(again, '06 123 45 67', PASSWORD));
  server.club.run('UPDATE members SET active = 0 WHERE id = ?', member.id);
  assert.equal((await again.get('/api/client/me')).status, 401);
  assert.equal((await signIn(new Client(server), '06 123 45 67', PASSWORD)).status, 401);
});

test('changer son mot de passe ferme les autres sessions', async () => {
  const { server, code } = await setup();
  const phone = await signedInClient(server, code);
  const laptop = new Client(server);
  ok(await signIn(laptop, '242061234567', PASSWORD));
  ok(await laptop.get('/api/client/me'));

  const wrong = await phone.post('/api/client/password', { current_password: 'pas-le-bon-mot', new_password: 'encore-un-autre-mot' });
  assert.equal(wrong.status, 400);
  const missing = await phone.post('/api/client/password', { new_password: 'encore-un-autre-mot' });
  assert.equal(missing.status, 400);
  ok(await laptop.get('/api/client/me'));

  ok(await phone.post('/api/client/password', { current_password: PASSWORD, new_password: 'encore-un-autre-mot' }));
  assert.equal((await laptop.get('/api/client/me')).status, 401);
  ok(await phone.get('/api/client/me'));
  assert.equal((await signIn(new Client(server), '06 123 45 67', PASSWORD)).status, 401);
  ok(await signIn(new Client(server), '06 123 45 67', 'encore-un-autre-mot'));
});

test('journal : le changement de mot de passe est noté, pas la connexion', async () => {
  const { server, member, code } = await setup();
  const last = server.club.get('SELECT MAX(id) AS id FROM audit_log').id;
  const client = new Client(server);
  ok(await signIn(client, '06 123 45 67', code));
  ok(await client.get('/api/client/me'));
  assert.equal(server.club.get('SELECT MAX(id) AS id FROM audit_log').id, last);
  ok(await client.post('/api/client/password', { new_password: PASSWORD }));
  const rows = server.club.all('SELECT * FROM audit_log WHERE id > ?', last);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].action, 'client.mot_de_passe');
  assert.equal(rows[0].user_id, null);
  assert.equal(JSON.parse(rows[0].details).client, member.id);
  assert.ok(!rows[0].details.includes(PASSWORD));
  assert.ok(!rows[0].details.includes(code));
});

test('écritures du client : clé d’idempotence à lui', async () => {
  const { server, member, code } = await setup();
  const client = new Client(server);
  ok(await signIn(client, '06 123 45 67', code));
  const bad = await client.post('/api/client/logout', {}, { 'idempotency-key': 'court' });
  assert.equal(bad.status, 400);
  ok(await client.get('/api/client/me'));
  ok(await client.post('/api/client/logout', {}, { 'idempotency-key': 'cle-client-0001' }));
  const rows = server.club.all('SELECT * FROM client_idempotency');
  assert.equal(rows.length, 1);
  assert.equal(rows[0].key, 'cle-client-0001');
  assert.equal(rows[0].account_id, account(server, member.id).id);
  assert.equal(server.club.get('SELECT COUNT(*) AS n FROM idempotency_keys').n, 0);
  // The password never enters the table, not even through the hash of the request.
  const other = new Client(server);
  ok(await signIn(other, '06 123 45 67', code));
  ok(await other.post('/api/client/password', { new_password: PASSWORD }, { 'idempotency-key': 'cle-client-0002' }));
  assert.equal(server.club.get('SELECT COUNT(*) AS n FROM client_idempotency').n, 1);
});

test('l’espace client va toujours au vrai club, même avec l’en-tête démo', async () => {
  const { server: real, admin, member, code } = await setup();
  const demo = new Server({}, { demo: true });
  servers.push(demo);
  await demo.start();
  const visitor = new Client(new Site(real, demo));
  const DEMO = { 'x-club-espace': 'demo' };
  const signedIn = await visitor.post('/api/client/login', { login: '06 123 45 67', password: code }, DEMO);
  assert.equal(signedIn.status, 200, JSON.stringify(signedIn.data));
  assert.equal(ok(await visitor.call('GET', '/api/client/me', undefined, DEMO)).member.member_no, member.member_no);
  assert.equal(demo.club.hasUsers(), false); // the demo space was not even prepared

  // Handed a client path all the same, the demo space does not know it.
  const staffHash = await sha256Hex(decodeURIComponent(admin.cookie.slice('sid='.length)));
  const inDemo = new Client({
    fetch: async (url, init) => demo.api.handleDemo(new Request(`http://club.test${url}`, init), structuredClone(real.api.demoContext(staffHash))),
  });
  assert.equal((await inDemo.post('/api/client/login', { login: '06 123 45 67', password: code })).status, 404);
  assert.equal(demo.club.get('SELECT COUNT(*) AS n FROM client_sessions').n, 0);

  assert.ok(ALWAYS_REAL.test('/api/client/login'));
  assert.ok(ALWAYS_REAL.test('/api/push/subscriptions'));
  // The staff's regular clients (/api/clients) are not the client space: they follow the header.
  assert.ok(!ALWAYS_REAL.test('/api/clients'));
});
