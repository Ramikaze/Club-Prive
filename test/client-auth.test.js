// Client sign-in (spec « Espace client », identifier chosen by the client): the client signs in with his member number
// and the temporary code, chooses his identifier and his password first, then signs in with them. His session is his
// own (table client_sessions, cookie csid limited to /api/client): a client session never opens a staff route, a staff
// session never opens a client route. The accesses made with the phone before must choose an identifier first.
import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { Server, Site, Client, ok } from './harness.js';
import { ALWAYS_REAL } from '../worker/space.js';
import { sha256Hex, hashPassword } from '../worker/auth.js';

const servers = [];
afterEach(() => {
  for (const server of servers.splice(0)) server.destroy();
});

const PASSWORD = 'mon-mot-de-passe-client';
const IDENT = 'jean.dupont';

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
const refused = (r, status, code) => {
  assert.equal(r.status, status, JSON.stringify(r.data));
  assert.equal(r.data.error.code, code);
};
const BAD_CREDENTIALS = { error: { code: 'IDENTIFIANTS', message: 'Identifiant ou mot de passe incorrect.', details: null } };

// A client who chose his identifier and his password: signed in with them, his session is a full one.
async function signedInClient(server, member, code, login = IDENT) {
  const client = new Client(server);
  ok(await signIn(client, member.member_no, code));
  ok(await client.post('/api/client/password', { login, new_password: PASSWORD }));
  return client;
}

// An access made with the phone before the client chose identifiers (V24): his login is his phone as WhatsApp reads it,
// not chosen, with a password of his own.
async function legacyAccess(server, member) {
  server.club.run(
    "UPDATE client_accounts SET login = '242061234567', login_chosen = 0, password_hash = ?, temp_hash = NULL, temp_expires_at = NULL WHERE member_id = ?",
    await hashPassword(PASSWORD), member.id,
  );
}

test('première connexion avec le numéro de membre et le code : choisir son identifiant et son mot de passe d’abord', async () => {
  const { server, member, code } = await setup();
  const client = new Client(server);
  const first = ok(await signIn(client, member.member_no, code));
  assert.equal(first.must_set_password, true);
  assert.equal(first.login_chosen, false);
  assert.equal(first.login, null);
  assert.deepEqual(first.member, { first_name: 'Jean', last_name: 'DUPONT', member_no: member.member_no, kind: 'membre' });

  refused(await client.get('/api/client/account'), 403, 'IDENTIFIANT_A_CHOISIR');
  refused(await client.get('/api/client/inconnu'), 403, 'IDENTIFIANT_A_CHOISIR');
  assert.equal(ok(await client.get('/api/client/me')).must_set_password, true);

  // The identifier is asked for with the password: without it, nothing is recorded.
  refused(await client.post('/api/client/password', { new_password: PASSWORD }), 400, 'IDENTIFIANT_INVALIDE');
  refused(await client.post('/api/client/password', { login: 'Jean.Dupont', new_password: 'court' }), 400, 'INVALIDE');
  assert.equal(account(server, member.id).login_chosen, 0);
  const chosen = ok(await client.post('/api/client/password', { login: '  Jean.Dupont ', new_password: PASSWORD }));
  assert.equal(chosen.must_set_password, false);
  assert.equal(chosen.login, IDENT);
  assert.equal(chosen.login_chosen, true);
  // The same session goes on, now a full one. An unknown client path is then 404; without a session, 401 like any other.
  const me = ok(await client.get('/api/client/me'));
  assert.equal(me.must_set_password, false);
  assert.equal(me.login, IDENT);
  assert.equal(me.login_chosen, true);
  ok(await client.get('/api/client/account'));
  assert.equal((await client.get('/api/client/inconnu')).status, 404);
  assert.equal((await new Client(server).get('/api/client/inconnu')).status, 401);
  const row = account(server, member.id);
  assert.equal(row.login, IDENT);
  assert.equal(row.login_chosen, 1);
  assert.ok(row.password_hash.startsWith('pbkdf2-sha256$'));
  assert.ok(!row.password_hash.includes(PASSWORD));
  assert.equal(row.temp_hash, null);

  // The code served once: it no longer opens anything.
  const again = await signIn(new Client(server), member.member_no, code);
  assert.equal(again.status, 401);
  assert.deepEqual(again.data, BAD_CREDENTIALS);
  const signedIn = ok(await signIn(new Client(server), IDENT, PASSWORD));
  assert.equal(signedIn.must_set_password, false);
  assert.equal(signedIn.login_chosen, true);
  assert.ok(account(server, member.id).last_login_at);
  // Any case, spaces around.
  ok(await signIn(new Client(server), '  JEAN.Dupont ', PASSWORD));
  // Neither the phone nor the member number signs in with the password.
  assert.deepEqual((await signIn(new Client(server), '06 123 45 67', PASSWORD)).data, BAD_CREDENTIALS);
  assert.deepEqual((await signIn(new Client(server), member.member_no, PASSWORD)).data, BAD_CREDENTIALS);
});

test('le numéro de membre seul n’ouvre rien, même avec le bon mot de passe ; avec un code en cours, il ouvre le choix', async () => {
  const { server, admin, member, code } = await setup();
  await signedInClient(server, member, code);
  for (const typed of [member.member_no, member.member_no.toLowerCase(), ` ${member.member_no} `]) {
    const r = await signIn(new Client(server), typed, PASSWORD);
    assert.equal(r.status, 401, typed);
    assert.deepEqual(r.data, BAD_CREDENTIALS);
  }
  // With a live code, the member number opens the « choose » step, with the code only: the password, even when the
  // access holds one, is not checked against it.
  const { code: renewed } = ok(await admin.post(`/api/members/${member.id}/client-access/code`, {}));
  server.club.run('UPDATE client_accounts SET password_hash = ? WHERE member_id = ?', await hashPassword(PASSWORD), member.id);
  assert.deepEqual((await signIn(new Client(server), member.member_no, PASSWORD)).data, BAD_CREDENTIALS);
  ok(await signIn(new Client(server), IDENT, PASSWORD));
  const viaCode = ok(await signIn(new Client(server), member.member_no.toLowerCase(), renewed));
  assert.equal(viaCode.must_set_password, true);
  assert.equal(viaCode.login, IDENT);
  assert.equal(viaCode.login_chosen, true);
  // An expired code: the member number opens nothing again.
  server.club.run("UPDATE client_accounts SET temp_expires_at = '2020-01-01T00:00:00.000Z' WHERE member_id = ?", member.id);
  assert.deepEqual((await signIn(new Client(server), member.member_no, renewed)).data, BAD_CREDENTIALS);
});

test('un client régulier passé en membre : son ancien numéro C-… sert aussi avec le code', async () => {
  const { server, admin } = await setup();
  const c = ok(await admin.post('/api/clients', { first_name: 'awa', last_name: 'regulier', phone: '06 555 00 11' }));
  const { code } = ok(await admin.post(`/api/members/${c.id}/client-access`, {}));
  const converted = ok(await admin.post(`/api/clients/${c.id}/convert`, {}));
  const memberNo = converted.member?.member_no ?? converted.member_no;
  assert.match(memberNo, /^M-/);
  assert.equal(ok(await signIn(new Client(server), c.member_no, code)).must_set_password, true);
  assert.equal(ok(await signIn(new Client(server), memberNo, code)).must_set_password, true);
  assert.equal(account(server, c.id).login, c.member_no.toLowerCase());
});

test('le code expire après 7 jours', async () => {
  const { server, member, code } = await setup();
  server.club.run("UPDATE client_accounts SET temp_expires_at = '2020-01-01T00:00:00.000Z' WHERE member_id = ?", member.id);
  const r = await signIn(new Client(server), member.member_no, code);
  assert.equal(r.status, 401);
  assert.equal(r.data.error.code, 'IDENTIFIANTS');
});

test('le numéro de membre s’écrit en majuscules ou minuscules ; le téléphone n’est pas un identifiant', async () => {
  const { server, member, code } = await setup();
  for (const login of [member.member_no, member.member_no.toLowerCase(), `  ${member.member_no.toLowerCase()} `]) {
    const r = await signIn(new Client(server), login, code);
    assert.equal(r.status, 200, `${login} ${JSON.stringify(r.data)}`);
  }
  // Anything else answers like any wrong identifier, not with a server error. (Each from its own address: unknown
  // identifiers would otherwise share lockout keys.)
  const others = ['06 123 45 67', '+242061234567', '12', '', null, 123, [member.member_no], { n: 1 }, 'x'.repeat(5000)];
  for (const [i, login] of others.entries()) {
    const r = await signIn(new Client(server), login, code, `10.0.1.${i}`);
    assert.equal(r.status, 401, JSON.stringify(login));
    assert.deepEqual(r.data, BAD_CREDENTIALS);
  }
});

test('cinq échecs bloquent une minute', async () => {
  const { server, member, code } = await setup();
  const visitor = new Client(server);
  for (let i = 0; i < 5; i += 1) assert.equal((await signIn(visitor, member.member_no, 'faux', '10.0.0.1')).status, 401);
  const locked = await signIn(visitor, member.member_no, 'faux', '10.0.0.1');
  assert.equal(locked.status, 429);
  assert.equal(locked.data.error.code, 'TROP_DE_TENTATIVES');
  // The same identifier written in another case is the same identifier; even the right code waits for the minute.
  assert.equal((await signIn(visitor, ` ${member.member_no.toLowerCase()}`, code, '10.0.0.1')).status, 429);
  // Another address is not locked.
  assert.equal((await signIn(visitor, member.member_no, code, '10.0.0.2')).status, 200);
});

test('cinq échecs sur un ancien accès par téléphone : le numéro écrit autrement attend aussi', async () => {
  const { server, member } = await setup();
  await legacyAccess(server, member);
  for (let i = 0; i < 5; i += 1) assert.equal((await signIn(new Client(server), '06 123 45 67', 'faux', '10.0.0.5')).status, 401);
  assert.equal((await signIn(new Client(server), '+242061234567', PASSWORD, '10.0.0.5')).status, 429);
});

test('même réponse pour un inconnu, un mauvais mot de passe, un numéro de membre sans code, un accès coupé', async () => {
  const { server, admin, member, code } = await setup();
  const other = ok(await admin.post('/api/members', { first_name: 'paul', last_name: 'autre', phone: '06 000 00 02' }));
  ok(await admin.post(`/api/members/${other.id}/client-access`, {}));
  server.club.run("UPDATE client_accounts SET temp_expires_at = '2020-01-01T00:00:00.000Z' WHERE member_id = ?", other.id);
  const wrong = await signIn(new Client(server), member.member_no, 'mauvais-mot-de-passe', '10.0.0.3');
  const unknown = await signIn(new Client(server), 'personne.inconnue', 'mauvais-mot-de-passe', '10.0.0.3');
  const unknownNo = await signIn(new Client(server), 'M-9999', 'mauvais-mot-de-passe', '10.0.0.3');
  const unusable = await signIn(new Client(server), '12', 'mauvais-mot-de-passe', '10.0.0.3');
  const noCode = await signIn(new Client(server), other.member_no, 'mauvais-mot-de-passe', '10.0.0.6');
  await signedInClient(server, member, code);
  const memberNoWithPassword = await signIn(new Client(server), member.member_no, PASSWORD, '10.0.0.7');
  ok(await admin.post(`/api/members/${member.id}/client-access/disable`, {}));
  const cut = await signIn(new Client(server), IDENT, PASSWORD, '10.0.0.4');
  for (const r of [wrong, unknown, unknownNo, unusable, noCode, memberNoWithPassword, cut]) {
    assert.equal(r.status, 401);
    assert.deepEqual(r.data, BAD_CREDENTIALS);
    assert.equal(r.headers.get('set-cookie'), null);
  }
});

test('ancien accès par téléphone : choisir un identifiant avant tout, ensuite le téléphone ne sert plus', async () => {
  const { server, member } = await setup();
  await legacyAccess(server, member);
  assert.equal(account(server, member.id).login_chosen, 0);
  const client = new Client(server);
  const first = ok(await signIn(client, '06 123 45 67', PASSWORD));
  assert.equal(first.must_set_password, false);
  assert.equal(first.login_chosen, false);
  assert.equal(first.login, null);
  for (const url of ['/api/client/account', '/api/client/orders', '/api/client/history', '/api/client/inconnu']) {
    refused(await client.get(url), 403, 'IDENTIFIANT_A_CHOISIR');
  }
  refused(await client.post('/api/client/orders', { lines: [] }), 403, 'IDENTIFIANT_A_CHOISIR');
  // The password route asks for the identifier too.
  refused(await client.post('/api/client/password', { current_password: PASSWORD, new_password: 'un-autre-mot-de-passe' }), 400, 'IDENTIFIANT_INVALIDE');
  // The identifier alone, on its own route.
  refused(await client.post('/api/client/login-name', {}), 400, 'IDENTIFIANT_INVALIDE');
  refused(await client.post('/api/client/login-name', { login: '0612345678' }), 400, 'IDENTIFIANT_INVALIDE');
  const named = ok(await client.post('/api/client/login-name', { login: 'Jean.D' }));
  assert.equal(named.login, 'jean.d');
  assert.equal(named.login_chosen, true);
  assert.equal(named.must_set_password, false);
  ok(await client.get('/api/client/account'));
  // Chosen once: the route refuses a second choice.
  refused(await client.post('/api/client/login-name', { login: 'jean.autre' }), 409, 'IDENTIFIANT_DEJA_CHOISI');

  for (const phone of ['06 123 45 67', '+242061234567', '242061234567']) {
    assert.deepEqual((await signIn(new Client(server), phone, PASSWORD)).data, BAD_CREDENTIALS, phone);
  }
  ok(await signIn(new Client(server), 'jean.d', PASSWORD));
  ok(await signIn(new Client(server), 'JEAN.D', PASSWORD));

  const rows = server.club.all("SELECT * FROM audit_log WHERE action = 'client.identifiant'");
  assert.equal(rows.length, 1);
  assert.equal(rows[0].user_id, null);
  assert.equal(rows[0].entity, 'member');
  assert.equal(rows[0].entity_id, member.id);
  assert.deepEqual(JSON.parse(rows[0].details), { client: member.id, avant: '242061234567', apres: 'jean.d' });
});

test('ancien accès par téléphone avec un nouveau code : téléphone ou numéro de membre, puis identifiant et mot de passe', async () => {
  const { server, admin, member } = await setup();
  await legacyAccess(server, member);
  const { code } = ok(await admin.post(`/api/members/${member.id}/client-access/code`, {}));
  assert.equal(account(server, member.id).login, '242061234567');
  ok(await signIn(new Client(server), member.member_no, code));
  const client = new Client(server);
  const first = ok(await signIn(client, '06 123 45 67', code));
  assert.equal(first.must_set_password, true);
  assert.equal(first.login_chosen, false);
  refused(await client.get('/api/client/account'), 403, 'IDENTIFIANT_A_CHOISIR');
  // The code session goes through the password route, which takes both.
  refused(await client.post('/api/client/login-name', { login: 'jean.d' }), 403, 'MOT_DE_PASSE_A_CHOISIR');
  refused(await client.post('/api/client/password', { new_password: PASSWORD }), 400, 'IDENTIFIANT_INVALIDE');
  ok(await client.post('/api/client/password', { login: 'jean.d', new_password: PASSWORD }));
  ok(await client.get('/api/client/account'));
  assert.deepEqual((await signIn(new Client(server), '06 123 45 67', PASSWORD)).data, BAD_CREDENTIALS);
  ok(await signIn(new Client(server), 'jean.d', PASSWORD));
});

test('règles de l’identifiant', async () => {
  const { server, admin, member, code } = await setup();
  const other = ok(await admin.post('/api/members', { first_name: 'paul', last_name: 'pris', phone: '06 000 00 03' }));
  const { code: otherCode } = ok(await admin.post(`/api/members/${other.id}/client-access`, {}));
  await signedInClient(server, other, otherCode, 'deja.pris');

  const client = new Client(server);
  ok(await signIn(client, member.member_no, code));
  const choose = (login) => client.post('/api/client/password', { login, new_password: PASSWORD });
  const bad = [
    '06 12 34 56 78', '0612345678', '06.12.34.56.78', '06-12-34-56-78', '242061234567', 'm-0012', 'M-0012', 'c-3', 'abc', 'é-paul',
    'paul m', 'paul_m', 'a'.repeat(31), '', '   ', null, 12345678, ['paul.m'], { login: 'paul.m' },
  ];
  for (const login of bad) refused(await choose(login), 400, 'IDENTIFIANT_INVALIDE');
  refused(await choose('Deja.Pris'), 409, 'IDENTIFIANT_PRIS');
  assert.equal((await choose('Deja.Pris')).data.error.message, 'Cet identifiant est déjà pris : choisissez-en un autre.');
  assert.equal(account(server, member.id).login_chosen, 0);
  assert.equal(account(server, member.id).password_hash, null);
  // A member number shape is only refused whole: letters around it are fine. As are 4 and 30 characters.
  for (const [i, login] of ['m-12a', 'jean-m-12', 'abcd', 'a'.repeat(30), '1.2.3.a'].entries()) {
    const m = ok(await admin.post('/api/members', { first_name: 'awa', last_name: `valide ${'abcde'[i]}`, phone: '06 000 00 04' }));
    const access = ok(await admin.post(`/api/members/${m.id}/client-access`, {}));
    const who = new Client(server);
    ok(await signIn(who, m.member_no, access.code));
    assert.equal(ok(await who.post('/api/client/password', { login, new_password: PASSWORD })).login, login, login);
  }
});

test('règle de l’identifiant : Paul.M est gardé paul.m', async () => {
  const { server, member, code } = await setup();
  const client = new Client(server);
  ok(await signIn(client, member.member_no, code));
  assert.equal(ok(await client.post('/api/client/password', { login: 'Paul.M', new_password: PASSWORD })).login, 'paul.m');
  assert.equal(account(server, member.id).login, 'paul.m');
  ok(await signIn(new Client(server), 'Paul.M', PASSWORD));
});

test('nouveau code : l’identifiant choisi reste ; le client peut le garder ou le changer', async () => {
  const { server, admin, member, code } = await setup();
  await signedInClient(server, member, code);
  const renewed = ok(await admin.post(`/api/members/${member.id}/client-access/code`, {}));
  assert.equal(renewed.status.login, IDENT);
  assert.equal(renewed.status.login_chosen, true);
  assert.deepEqual((await signIn(new Client(server), IDENT, PASSWORD)).data, BAD_CREDENTIALS);

  // With the identifier and the code: the identifier is kept, only the password is asked for.
  const keep = new Client(server);
  const first = ok(await signIn(keep, IDENT, renewed.code));
  assert.equal(first.must_set_password, true);
  assert.equal(first.login, IDENT);
  assert.equal(first.login_chosen, true);
  refused(await keep.get('/api/client/account'), 403, 'MOT_DE_PASSE_A_CHOISIR');
  const kept = ok(await keep.post('/api/client/password', { new_password: 'second-mot-de-passe' }));
  assert.equal(kept.login, IDENT);
  ok(await signIn(new Client(server), IDENT, 'second-mot-de-passe'));
  assert.equal(server.club.get("SELECT COUNT(*) AS n FROM audit_log WHERE action = 'client.identifiant'").n, 1);

  // With the member number and a new code: the client changes his identifier as he chooses his password.
  const third = ok(await admin.post(`/api/members/${member.id}/client-access/code`, {}));
  const change = new Client(server);
  ok(await signIn(change, member.member_no, third.code));
  const changed = ok(await change.post('/api/client/password', { login: 'Jean.Nouveau', new_password: 'troisieme-mot-de-passe' }));
  assert.equal(changed.login, 'jean.nouveau');
  assert.deepEqual((await signIn(new Client(server), IDENT, 'troisieme-mot-de-passe')).data, BAD_CREDENTIALS);
  ok(await signIn(new Client(server), 'jean.nouveau', 'troisieme-mot-de-passe'));
  const rows = server.club.all("SELECT * FROM audit_log WHERE action = 'client.identifiant' ORDER BY id");
  assert.deepEqual(rows.map((r) => JSON.parse(r.details)), [
    { client: member.id, avant: member.member_no.toLowerCase(), apres: IDENT },
    { client: member.id, avant: IDENT, apres: 'jean.nouveau' },
  ]);
  // Outside a code session, the identifier does not change.
  refused(await change.post('/api/client/password', {
    current_password: 'troisieme-mot-de-passe', new_password: 'quatrieme-mot-de-passe', login: 'jean.encore',
  }), 400, 'IDENTIFIANT_FIGE');
  refused(await change.post('/api/client/login-name', { login: 'jean.encore' }), 409, 'IDENTIFIANT_DEJA_CHOISI');
  assert.equal(account(server, member.id).login, 'jean.nouveau');
});

test('séparation', async () => {
  const { server, admin, member, code } = await setup();
  const client = await signedInClient(server, member, code);
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
  assert.equal((await admin.post('/api/client/login-name', { login: 'jean.staff' })).status, 401);
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
  const { server, member, code } = await setup();
  const r = await signIn(new Client(server), member.member_no, code);
  const cookie = r.headers.get('set-cookie');
  assert.match(cookie, /^csid=[^;]+;/);
  for (const part of ['HttpOnly', 'SameSite=Lax', 'Path=/api/client', `Max-Age=${30 * 86400}`]) {
    assert.ok(cookie.split('; ').includes(part), `${part} dans ${cookie}`);
  }
  assert.ok(!cookie.includes('Path=/;'));

  // Signing out clears the cookie on the same path and ends the session.
  const client = new Client(server);
  ok(await signIn(client, member.member_no, code));
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
  const client = await signedInClient(server, member, code);
  ok(await client.get('/api/client/me'));
  ok(await admin.post(`/api/members/${member.id}/client-access/disable`, {}));
  assert.equal((await client.get('/api/client/me')).status, 401);
  assert.equal((await signIn(new Client(server), IDENT, PASSWORD)).status, 401);

  // A file switched off by any other way than the staff's button: the session check refuses it on its own.
  ok(await admin.post(`/api/members/${member.id}/client-access/enable`, {}));
  const again = new Client(server);
  ok(await signIn(again, IDENT, PASSWORD));
  server.club.run('UPDATE members SET active = 0 WHERE id = ?', member.id);
  assert.equal((await again.get('/api/client/me')).status, 401);
  assert.equal((await signIn(new Client(server), IDENT, PASSWORD)).status, 401);
});

test('changer son mot de passe ferme les autres sessions', async () => {
  const { server, member, code } = await setup();
  const phone = await signedInClient(server, member, code);
  const laptop = new Client(server);
  ok(await signIn(laptop, IDENT, PASSWORD));
  ok(await laptop.get('/api/client/me'));

  const wrong = await phone.post('/api/client/password', { current_password: 'pas-le-bon-mot', new_password: 'encore-un-autre-mot' });
  assert.equal(wrong.status, 400);
  const missing = await phone.post('/api/client/password', { new_password: 'encore-un-autre-mot' });
  assert.equal(missing.status, 400);
  ok(await laptop.get('/api/client/me'));

  ok(await phone.post('/api/client/password', { current_password: PASSWORD, new_password: 'encore-un-autre-mot' }));
  assert.equal((await laptop.get('/api/client/me')).status, 401);
  ok(await phone.get('/api/client/me'));
  assert.equal((await signIn(new Client(server), IDENT, PASSWORD)).status, 401);
  ok(await signIn(new Client(server), IDENT, 'encore-un-autre-mot'));
  assert.equal(account(server, member.id).login, IDENT);
});

test('journal : le choix de l’identifiant et le mot de passe sont notés, pas la connexion', async () => {
  const { server, member, code } = await setup();
  const last = server.club.get('SELECT MAX(id) AS id FROM audit_log').id;
  const client = new Client(server);
  ok(await signIn(client, member.member_no, code));
  ok(await client.get('/api/client/me'));
  assert.equal(server.club.get('SELECT MAX(id) AS id FROM audit_log').id, last);
  ok(await client.post('/api/client/password', { login: IDENT, new_password: PASSWORD }));
  const rows = server.club.all('SELECT * FROM audit_log WHERE id > ? ORDER BY id', last);
  assert.deepEqual(rows.map((r) => r.action), ['client.identifiant', 'client.mot_de_passe']);
  for (const r of rows) {
    assert.equal(r.user_id, null);
    assert.equal(JSON.parse(r.details).client, member.id);
    assert.ok(!r.details.includes(PASSWORD));
    assert.ok(!r.details.includes(code));
  }
  assert.deepEqual(JSON.parse(rows[0].details), { client: member.id, avant: member.member_no.toLowerCase(), apres: IDENT });
});

test('écritures du client : clé d’idempotence à lui', async () => {
  const { server, member, code } = await setup();
  const client = new Client(server);
  ok(await signIn(client, member.member_no, code));
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
  ok(await signIn(other, member.member_no, code));
  ok(await other.post('/api/client/password', { login: IDENT, new_password: PASSWORD }, { 'idempotency-key': 'cle-client-0002' }));
  assert.equal(server.club.get('SELECT COUNT(*) AS n FROM client_idempotency').n, 1);
});

test('l’espace client va toujours au vrai club, même avec l’en-tête démo', async () => {
  const { server: real, admin, member, code } = await setup();
  const demo = new Server({}, { demo: true });
  servers.push(demo);
  await demo.start();
  const visitor = new Client(new Site(real, demo));
  const DEMO = { 'x-club-espace': 'demo' };
  const signedIn = await visitor.post('/api/client/login', { login: member.member_no, password: code }, DEMO);
  assert.equal(signedIn.status, 200, JSON.stringify(signedIn.data));
  assert.equal(ok(await visitor.call('GET', '/api/client/me', undefined, DEMO)).member.member_no, member.member_no);
  assert.equal(demo.club.hasUsers(), false); // the demo space was not even prepared

  // Handed a client path all the same, the demo space does not know it.
  const staffHash = await sha256Hex(decodeURIComponent(admin.cookie.slice('sid='.length)));
  const inDemo = new Client({
    fetch: async (url, init) => demo.api.handleDemo(new Request(`http://club.test${url}`, init), structuredClone(real.api.demoContext(staffHash))),
  });
  assert.equal((await inDemo.post('/api/client/login', { login: member.member_no, password: code })).status, 404);
  assert.equal(demo.club.get('SELECT COUNT(*) AS n FROM client_sessions').n, 0);

  assert.ok(ALWAYS_REAL.test('/api/client/login'));
  assert.ok(ALWAYS_REAL.test('/api/client/login-name'));
  assert.ok(ALWAYS_REAL.test('/api/push/subscriptions'));
  // The staff's regular clients (/api/clients) are not the client space: they follow the header.
  assert.ok(!ALWAYS_REAL.test('/api/clients'));
});

test('le client reçoit le nom, la monnaie, le fuseau et les règles de réservation du club, rien d’autre', async () => {
  const { server, member, code } = await setup();
  const client = new Client(server);
  const signedIn = ok(await signIn(client, member.member_no, code));
  const { booking } = server.club.settings();
  const expected = {
    name: 'Limen', currency: { label: 'FCFA', decimals: 0 }, timezone: 'Africa/Brazzaville',
    booking: { slot_min: booking.slot_min, min_duration_min: booking.min_duration_min, weekend_min_duration_min: booking.weekend_min_duration_min },
    room_capacity: server.club.rooms()[0].capacity,
  };
  assert.deepEqual(Object.keys(signedIn).sort(), ['club', 'login', 'login_chosen', 'member', 'must_set_password']);
  assert.deepEqual(signedIn.club, expected);
  assert.deepEqual(ok(await client.get('/api/client/me')).club, expected);
  ok(await client.post('/api/client/password', { login: IDENT, new_password: PASSWORD }));
  assert.deepEqual(ok(await client.get('/api/client/me')).club, expected);
});

test('le code provisoire se tape en minuscules, avec des espaces autour', async () => {
  const { server, member, code } = await setup();
  // A phone keyboard types lowercase in a password field: the code is read in capitals, without the spaces around.
  const typed = `  ${code.toLowerCase()} `;
  const first = ok(await signIn(new Client(server), member.member_no, typed, '10.0.2.1'));
  assert.equal(first.must_set_password, true);
  // A wrong code stays wrong, whatever its case.
  const other = (code[0] === 'A' ? 'B' : 'A') + code.slice(1);
  const wrong = await signIn(new Client(server), member.member_no, other.toLowerCase(), '10.0.2.2');
  assert.equal(wrong.status, 401);
  assert.equal(wrong.data.error.code, 'IDENTIFIANTS');
  // The password chosen afterwards is checked as typed: neither its capitals nor its spaces are touched.
  const client = new Client(server);
  ok(await signIn(client, member.member_no, code, '10.0.2.3'));
  ok(await client.post('/api/client/password', { login: IDENT, new_password: ' Mon-Mot-De-Passe ' }));
  assert.equal((await signIn(new Client(server), IDENT, ' Mon-Mot-De-Passe ', '10.0.2.4')).status, 200);
  assert.equal((await signIn(new Client(server), IDENT, ' MON-MOT-DE-PASSE ', '10.0.2.5')).status, 401);
  assert.equal((await signIn(new Client(server), IDENT, 'Mon-Mot-De-Passe', '10.0.2.6')).status, 401);
});

test('au démarrage : sessions client expirées et vieilles clés d’idempotence effacées', async () => {
  const { server, member, code } = await setup();
  const client = new Client(server);
  ok(await signIn(client, member.member_no, code));
  const accountId = account(server, member.id).id;
  const day = 86400000;
  const iso = (ms) => new Date(Date.now() + ms).toISOString();
  server.club.run(
    'INSERT INTO client_sessions (token_hash, account_id, must_set_password, created_at, expires_at) VALUES (?, ?, 0, ?, ?)',
    'session-expiree', accountId, iso(-31 * day), iso(-day),
  );
  const insertKey = (key, at) => server.club.run(
    'INSERT INTO client_idempotency (key, account_id, request_hash, response, created_at) VALUES (?, ?, ?, ?, ?)', key, accountId, 'h', 'null', at,
  );
  insertKey('cle-ancienne-01', iso(-8 * day));
  insertKey('cle-recente-001', iso(-6 * day));
  await server.restart();
  const sessions = server.club.all('SELECT token_hash FROM client_sessions').map((s) => s.token_hash);
  assert.ok(!sessions.includes('session-expiree'));
  assert.equal(sessions.length, 1); // the live session stays
  assert.deepEqual(server.club.all('SELECT key FROM client_idempotency').map((k) => k.key), ['cle-recente-001']);
  assert.equal(ok(await client.get('/api/client/me')).must_set_password, true);
});
