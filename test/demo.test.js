// The demo space: a second club (its own database) that copies the real club's configuration and
// holds only fictitious data. Both clubs are driven here as the Worker will drive them: the real
// club hands out its configuration (Club.demoConfig), the demo club prepares itself from it.
import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { addDays, addMonths } from '../shared/time.js';
import { CARD_METHOD } from '../shared/rules.js';
import { sha256Hex } from '../worker/auth.js';
import { DEMO_AUTHOR_ID } from '../worker/club.js';
import { Server, Site, Client, ok, ORIGIN, UM } from './harness.js';

const servers = [];
afterEach(() => {
  for (const server of servers.splice(0)) server.destroy();
});

const PROPRIO = 'mot-de-passe-proprio';
const GERANT = 'mot-de-passe-gerant';
const INSTALL_CODE = 'code-installation-test'; // the Worker's SETUP_TOKEN secret, in the tests that need it

// A real club with its administrator (logged in) and a manager, and an empty demo space beside it.
// `env`: the secrets and variables of the Worker, which both clubs receive.
async function clubs({ env = {} } = {}) {
  const real = new Server(env);
  const demo = new Server(env, { demo: true });
  servers.push(real, demo);
  await real.start();
  await demo.start();
  await real.addUser('proprietaire', 'Propriétaire', 'admin', PROPRIO);
  await real.addUser('gerant', 'Gérant', 'gerant', GERANT);
  const admin = new Client(real);
  const bundle = await admin.login('proprietaire', PROPRIO);
  return { real, demo, admin, bundle };
}

const memberNames = (club) => club.listMembers().map((m) => m.name).sort();
const FICTITIOUS = ['Client Test 1', 'Client Test 2', 'Client Test 3', 'Client Test 4', 'Client Test 5'];

test('configuration réelle copiée dans la démo', async () => {
  const { real, demo, admin, bundle } = await clubs();
  ok(await admin.put('/api/settings', { club_name: 'Cercle Test' }));
  const annual = bundle.plans.find((p) => p.code === 'ANNUELLE');
  ok(await admin.put(`/api/plans/${annual.id}`, { price: 120000 * UM, price_validated: true }));
  // One room, « Salon »: the default one is retired.
  ok(await admin.post('/api/rooms', { name: 'Salon', capacity: 6 }));
  ok(await admin.del(`/api/rooms/${bundle.rooms[0].id}`));
  // Two settings that stay in the real club: its treasury starting point, and an old stored `demo_mode`.
  ok(await admin.put('/api/settings', { opening_balances: { date: bundle.biz_today, amounts: { 'Espèces': 7 * UM } } }));
  real.db.run("INSERT INTO settings (key, value, updated_at) VALUES ('demo_mode', 'true', ?)", new Date().toISOString());

  const config = real.club.demoConfig();
  assert.deepEqual(config.settings.map((r) => r.key).filter((k) => k === 'demo_mode' || k === 'opening_balances'), []);
  demo.club.prepareDemo(config);

  const settings = demo.club.settings();
  assert.equal(settings.club_name, 'Cercle Test');
  assert.equal(settings.demo_mode, true);
  assert.notEqual(settings.opening_balances.amounts['Espèces'], 7 * UM); // the demo has its own, fictitious one
  const copied = demo.club.plans().find((p) => p.code === 'ANNUELLE');
  assert.equal(copied.price, 120000 * UM);
  assert.equal(copied.price_validated_by_name, 'Propriétaire'); // the validating account was copied too
  assert.deepEqual(demo.club.rooms().map((r) => r.name), ['Salon']);
  assert.deepEqual(demo.club.rooms().map((r) => r.name), real.club.rooms().map((r) => r.name));

  const members = demo.club.listMembers();
  assert.equal(members.length, 5);
  assert.ok(members.every((m) => m.is_demo));
  assert.equal(real.club.listMembers().length, 0);
  assert.ok(real.club.isEmpty());
});

test('démo remplie : membres, produits, trésorerie et grand livre cohérents', async () => {
  const { real, demo } = await clubs();
  demo.club.prepareDemo(real.club.demoConfig());

  assert.deepEqual(memberNames(demo.club), FICTITIOUS);
  assert.equal(demo.club.listProducts().length, 7);
  const today = demo.club.bizToday();
  const treasury = demo.club.treasury(today, today);
  assert.ok(treasury.accounts.every((a) => a.closing >= 0), JSON.stringify(treasury.accounts));
  assert.ok(treasury.total.closing > 0);
  const book = demo.club.ledgerBook({ from: addMonths(today, -3), to: today });
  assert.ok(book.rows.some((r) => r.type === 'depense') && book.rows.some((r) => r.type === 'encaissement'));
  assert.equal(book.closing, treasury.total.closing);
});

test('un seul remplissage : les appels suivants suivent les comptes, pas les réglages', async () => {
  const { real, demo, admin } = await clubs();
  ok(await admin.put('/api/settings', { club_name: 'Premier nom' }));
  demo.club.prepareDemo(real.club.demoConfig());
  const ids = demo.club.listMembers().map((m) => m.id);
  assert.equal(ids.length, 5);

  // The real club moves on: a renamed and deactivated account, a new account, a new club name.
  const manager = real.club.userByLogin('gerant');
  ok(await admin.put(`/api/users/${manager.id}`, { name: 'Gérante', active: false }));
  ok(await admin.post('/api/users', { login: 'stagiaire', name: 'Stagiaire', role: 'gerant', password: 'mot-de-passe-stagiaire' }));
  ok(await admin.put('/api/settings', { club_name: 'Second nom' }));
  demo.club.prepareDemo(real.club.demoConfig());

  // Not filled a second time, and the settings are those copied at the first preparation.
  assert.deepEqual(demo.club.listMembers().map((m) => m.id), ids);
  assert.equal(demo.club.listProducts().length, 7);
  assert.equal(demo.club.settings().club_name, 'Premier nom');
  // The accounts follow at once.
  const renamed = demo.club.userRow(manager.id);
  assert.equal(renamed.name, 'Gérante');
  assert.equal(renamed.active, 0);
  const added = real.club.userByLogin('stagiaire');
  assert.equal(demo.club.userRow(added.id).login, `u${added.id}`);
});

// The demo space prepared from a real club that its administrator has set up in an unusual way.
async function preparedWith(configure) {
  const spaces = await clubs();
  await configure(spaces);
  spaces.demo.club.prepareDemo(spaces.real.club.demoConfig());
  return spaces;
}

test('réglages inhabituels : pas d’« Espèces », formule annuelle sans prix, une seule salle', async () => {
  const { demo } = await preparedWith(async ({ admin, bundle }) => {
    ok(await admin.put('/api/settings', { payment_methods: ['Carte bancaire'] }));
    assert.equal(bundle.plans.find((p) => p.code === 'ANNUELLE').price, null);
    assert.equal(bundle.rooms.length, 1);
  });

  assert.equal(demo.club.listMembers().length, 5);
  assert.deepEqual(demo.club.all('SELECT DISTINCT method FROM payments').map((r) => r.method), ['Carte bancaire']);
});

test('réglages inhabituels : créneaux d’une heure', async () => {
  const { demo } = await preparedWith(async ({ admin }) => {
    ok(await admin.put('/api/settings', { booking: { slot_min: 60, min_duration_min: 60, weekend_min_duration_min: 120, extension_step_min: 60 } }));
  });

  assert.equal(demo.club.listMembers().length, 5);
  const durations = demo.club.all('SELECT duration_min FROM reservations').map((r) => r.duration_min);
  assert.ok(durations.length > 0);
  assert.ok(durations.every((d) => d % 60 === 0), durations.join(' '));
});

test('réglages inhabituels : petite salle', async () => {
  const { demo } = await preparedWith(async ({ admin, bundle }) => {
    ok(await admin.put(`/api/rooms/${bundle.rooms[0].id}`, { capacity: 2 }));
  });

  assert.equal(demo.club.listMembers().length, 5);
  const parties = demo.club.all('SELECT party_size FROM reservations').map((r) => r.party_size);
  assert.ok(parties.length > 0);
  assert.ok(parties.every((n) => n <= 2), parties.join(' '));
});

// Two history bookings of the seed sit 3 h 30 apart in the room (yesterday 15:00-17:30 and 21:00-22:00): a gap
// beyond that refuses the second, and the demo must still open and reset, with the club's rule kept.
for (const gap of [211, 240]) {
  test(`réglages inhabituels : battement de ${gap} minutes`, async () => {
    const { real, demo } = await preparedWith(async (spaces) => {
      ok(await spaces.admin.put('/api/settings', { booking: { ...spaces.bundle.settings.booking, gap_min: gap } }));
      assert.equal(spaces.real.club.settings().booking.gap_min, gap);
    });

    assert.equal(demo.club.listMembers().length, 5);
    assert.equal(demo.club.settings().booking.gap_min, gap);
    // What the seed could book keeps the rule: no two bookings of a room closer than the gap.
    const booked = demo.club.all("SELECT room_id, start_ms, end_ms FROM reservations WHERE status <> 'annulee' ORDER BY room_id, start_ms");
    assert.ok(booked.length > 0);
    for (let i = 1; i < booked.length; i += 1) {
      if (booked[i].room_id === booked[i - 1].room_id) assert.ok(booked[i].start_ms - booked[i - 1].end_ms >= gap * 60000, `réservation ${i}`);
    }
    // The reset fills the space again from the same settings, and works too.
    const actor = demo.club.userRow(real.club.userByLogin('proprietaire').id);
    demo.club.resetDemo(real.club.demoConfig(), actor);
    assert.equal(demo.club.listMembers().length, 5);
  });
}

test('réglages inhabituels : formules retirées de la vente', async () => {
  const { demo } = await preparedWith(async ({ admin, bundle }) => {
    for (const plan of bundle.plans) ok(await admin.put(`/api/plans/${plan.id}`, { active: false }));
  });

  assert.equal(demo.club.listMembers().length, 5);
  // The copy stays faithful: the demo does not offer them either.
  assert.ok(demo.club.plans().length > 0);
  assert.ok(demo.club.plans().every((p) => !p.active));
});

test('remise à neuf : les essais disparaissent, la configuration est recopiée', async () => {
  const { real, demo, admin } = await clubs();
  demo.club.prepareDemo(real.club.demoConfig());
  const actor = demo.club.userRow(real.club.userByLogin('proprietaire').id);
  demo.club.tx(() => demo.club.createMember(actor, { first_name: 'Essai', last_name: 'Membre', phone: '+000 000000' }));
  assert.ok(memberNames(demo.club).includes('Essai Membre'));
  assert.equal(demo.club.listMembers().length, 6);

  ok(await admin.put('/api/settings', { club_name: 'Nom actuel' }));
  demo.club.resetDemo(real.club.demoConfig(), actor);

  assert.ok(!memberNames(demo.club).includes('Essai Membre'));
  assert.deepEqual(memberNames(demo.club), FICTITIOUS);
  assert.equal(demo.club.settings().club_name, 'Nom actuel');
  const entry = demo.club.auditLog().find((a) => a.action === 'demo.remettre_a_neuf');
  assert.equal(entry.user_id, actor.id);
  // The space is marked as filled again: a plain preparation leaves it alone, and it can be reset again.
  demo.club.prepareDemo(real.club.demoConfig());
  assert.equal(demo.club.listMembers().length, 5);
  demo.club.resetDemo(real.club.demoConfig(), actor);
  assert.equal(demo.club.listMembers().length, 5);
});

test('un remplissage ou une remise à neuf qui échoue ne laisse rien derrière lui', async () => {
  const { real, demo, admin } = await clubs();
  ok(await admin.put('/api/settings', { club_name: 'Cercle Test' }));
  const broken = { ...real.club.demoConfig(), plans: [] }; // the seed finds no plan to sell

  assert.throws(() => demo.club.prepareDemo(broken));
  assert.equal(demo.club.settings().club_name, 'Limen'); // nothing copied...
  assert.equal(demo.club.plans().length, 2); // ...the plans it had are still there...
  assert.equal(demo.club.listMembers().length, 0); // ...nothing seeded...
  assert.equal(demo.club.get("SELECT COUNT(*) AS n FROM meta WHERE key = 'demo_seeded'").n, 0); // ...and no mark.
  demo.club.prepareDemo(real.club.demoConfig()); // the next try fills it, once
  assert.equal(demo.club.listMembers().length, 5);
  assert.equal(demo.club.settings().club_name, 'Cercle Test');

  // A failed reset keeps the trials made in the space.
  const actor = demo.club.userRow(real.club.userByLogin('proprietaire').id);
  demo.club.tx(() => demo.club.createMember(actor, { first_name: 'Essai', last_name: 'Membre', phone: '+000 000000' }));
  assert.throws(() => demo.club.resetDemo(broken, actor));
  assert.ok(memberNames(demo.club).includes('Essai Membre'));
  assert.equal(demo.club.listMembers().length, 6);
  assert.equal(demo.club.get("SELECT COUNT(*) AS n FROM meta WHERE key = 'demo_seeded'").n, 1);
});

test('jamais sur le vrai club', async () => {
  const { real, admin } = await clubs();
  ok(await admin.post('/api/members', { first_name: 'Vrai', last_name: 'Membre', phone: '+242 06 000 0000' }));
  const config = real.club.demoConfig();
  const actor = real.club.userByLogin('proprietaire');

  for (const call of [
    () => real.club.prepareDemo(config),
    () => real.club.resetDemo(config, actor),
    () => real.club.mirrorUsers(config.users),
  ]) {
    assert.throws(call, (err) => err.code === 'MODE_DEMO_INACTIF');
  }

  // Nothing moved: the real member, the accounts and their passwords, no demo marker.
  assert.deepEqual(memberNames(real.club), ['Vrai Membre']);
  await new Client(real).login('proprietaire', PROPRIO);
  assert.equal(real.club.userByLogin('gerant').name, 'Gérant');
  assert.equal(real.club.get("SELECT COUNT(*) AS n FROM meta WHERE key = 'demo_seeded'").n, 0);
});

test('comptes de la démo : copies sans mot de passe, auteur fictif', async () => {
  const { real, demo } = await clubs();
  // An account that already sits in the demo database under a real account's id (id 1) is taken over.
  await demo.addUser('ancien', 'Ancien compte', 'admin', PROPRIO);
  demo.club.prepareDemo(real.club.demoConfig());

  for (const account of real.club.listUsers()) {
    const copy = demo.club.userRow(account.id);
    assert.equal(copy.login, `u${account.id}`);
    assert.equal(copy.name, account.name);
    assert.equal(copy.role, account.role);
    assert.equal(copy.password_hash, '!');
  }
  // Nobody signs in to the demo space, whatever login and password they try.
  const visitor = new Client(demo);
  for (const login of ['proprietaire', 'ancien', 'u1', 'auteur.demo.0']) {
    assert.equal((await visitor.post('/api/login', { login, password: PROPRIO })).status, 401, login);
    assert.equal((await visitor.post('/api/login', { login, password: '!' })).status, 401, login);
  }

  // The fictitious author owns every fictitious record.
  assert.equal(DEMO_AUTHOR_ID, 0);
  const author = demo.club.get('SELECT * FROM users WHERE id = ?', DEMO_AUTHOR_ID);
  assert.equal(author.login, 'auteur.demo.0');
  assert.equal(author.name, 'Démonstration');
  assert.equal(author.role, 'admin');
  assert.equal(author.password_hash, '!');
  assert.deepEqual(demo.club.all('SELECT DISTINCT created_by FROM members').map((r) => r.created_by), [DEMO_AUTHOR_ID]);
});

test('configuration envoyée à la démo : les comptes ne portent que leur identité', async () => {
  const { real } = await clubs();
  const config = real.club.demoConfig();
  assert.equal(config.users.length, 2);

  // No login (the demo gives each account u<id>) and no password hash leave the real club.
  assert.deepEqual(Object.keys(config.users[0]).sort(), ['active', 'id', 'name', 'role']);
  for (const user of config.users) assert.deepEqual(Object.keys(user).sort(), ['active', 'id', 'name', 'role']);
  const hash = real.club.userByLogin('proprietaire').password_hash;
  assert.ok(hash && !JSON.stringify(config).includes(hash));
});

// ---------------------------------------------------------------------------- the demo space's API
// The Worker's two steps for a request made in the demo space, called directly here, without the
// routing: the real club vouches for the session and hands out the account and the configuration
// (demoContext), the demo club serves the request as that account (handleDemo).

const TRIAL = { first_name: 'Essai', last_name: 'Gérant', phone: '+242 06 111 2222' };

// Hash of a signed-in client's session cookie, as the Worker computes it.
const sessionHash = (client) => sha256Hex(decodeURIComponent(client.cookie.split('=')[1]));

const contextOf = async (real, client) => real.api.demoContext(await sessionHash(client));

// A client of the demo club: no cookie, the identity comes with each call.
const inDemo = (demo, ctx) => new Client({
  fetch: (url, init) => demo.api.handleDemo(new Request(ORIGIN + url, init), ctx),
});

async function managerOf(real) {
  const manager = new Client(real);
  await manager.login('gerant', GERANT);
  return manager;
}

test('contexte démo : le vrai club répond de la session, rien sans session valide', async () => {
  const { real, admin, bundle } = await clubs();
  assert.equal(real.api.demoContext(null), null);
  assert.equal(real.api.demoContext(await sha256Hex('jeton-inconnu')), null);

  const hash = await sessionHash(admin);
  const ctx = real.api.demoContext(hash);
  // The identity only, no password hash; the configuration is the real club's.
  assert.deepEqual(ctx.user, { id: bundle.user.id, name: 'Propriétaire', role: 'admin' });
  assert.deepEqual(ctx.config, real.club.demoConfig());

  // An expired session and a deactivated account give nothing either (the rows are still there).
  real.db.run('UPDATE sessions SET expires_at = ? WHERE token_hash = ?', '2000-01-01T00:00:00.000Z', hash);
  assert.equal(real.api.demoContext(hash), null);
  const managerHash = await sessionHash(await managerOf(real));
  assert.equal(real.api.demoContext(managerHash).user.role, 'gerant');
  real.db.run("UPDATE users SET active = 0 WHERE login = 'gerant'");
  assert.equal(real.api.demoContext(managerHash), null);
});

test('une écriture faite dans la démo reste dans la démo', async () => {
  const { real, demo, admin, bundle } = await clubs();
  const auditBefore = real.club.all('SELECT * FROM audit_log');
  const asAdmin = inDemo(demo, await contextOf(real, admin));

  // The first request prepares the space (5 fictitious members), then creates a sixth.
  const created = ok(await asAdmin.post('/api/members', TRIAL));
  assert.equal(created.name, 'Essai Gérant');
  assert.deepEqual(memberNames(demo.club), [...FICTITIOUS, 'Essai Gérant'].sort());
  assert.equal(demo.club.memberRow(created.id).created_by, bundle.user.id);
  assert.equal(ok(await asAdmin.get('/api/members')).length, 6);

  assert.deepEqual(memberNames(real.club), []);
  assert.ok(real.club.isEmpty());
  assert.deepEqual(real.club.all('SELECT * FROM audit_log'), auditBefore);
});

test('en démo, la gestion des comptes est refusée, comptes et mots de passe intacts', async () => {
  const { real, demo, admin } = await clubs();
  const manager = await managerOf(real);
  const managerId = real.club.userByLogin('gerant').id;
  const accountsBefore = real.club.listUsers();
  const attempts = [
    ['GET', '/api/users'],
    ['POST', '/api/users', { login: 'intrus', name: 'Intrus', role: 'admin', password: 'mot-de-passe-intrus' }],
    ['PUT', `/api/users/${managerId}`, { active: false }],
    ['POST', `/api/users/${managerId}/password`, { password: 'nouveau-mot-de-passe' }],
    ['POST', '/api/me/password', { current_password: PROPRIO, new_password: 'nouveau-mot-de-passe' }],
    ['POST', '/api/admin/reset', { confirm: 'EFFACER' }],
  ];

  // The message does not depend on the role.
  for (const client of [admin, manager]) {
    const asUser = inDemo(demo, await contextOf(real, client));
    for (const [method, url, body] of attempts) {
      const r = await asUser.call(method, url, body);
      assert.equal(r.status, 403, `${method} ${url}`);
      assert.equal(r.data.error.code, 'MODE_DEMO', `${method} ${url}`);
      assert.equal(r.data.error.message, 'Les comptes se gèrent hors du mode démo.');
    }
  }

  // Nothing moved, in the real club or in the demo: the data was not wiped either.
  assert.deepEqual(real.club.listUsers(), accountsBefore);
  await new Client(real).login('proprietaire', PROPRIO);
  assert.equal(demo.club.get("SELECT COUNT(*) AS n FROM users WHERE login = 'intrus'").n, 0);
  assert.equal(demo.club.userRow(managerId).active, 1);
  assert.equal(demo.club.userRow(managerId).password_hash, '!');
  assert.equal(demo.club.listMembers().length, 5);
});

test('« Remettre la démo à neuf » : réservé aux administrateurs, absent du vrai club', async () => {
  const { real, demo, admin, bundle } = await clubs();
  const asAdmin = inDemo(demo, await contextOf(real, admin));
  const asManager = inDemo(demo, await contextOf(real, await managerOf(real)));
  ok(await asAdmin.post('/api/members', TRIAL));
  assert.equal(demo.club.listMembers().length, 6);

  // The manager is turned away and the trials stay.
  assert.equal((await asManager.post('/api/demo/reset', {})).status, 403);
  assert.equal(demo.club.listMembers().length, 6);

  // The administrator gets the original space back, with the real club's settings as they are now.
  ok(await admin.put('/api/settings', { club_name: 'Nom actuel' }));
  const refreshed = inDemo(demo, await contextOf(real, admin));
  const reset = ok(await refreshed.post('/api/demo/reset', {}));
  assert.deepEqual(memberNames(demo.club), FICTITIOUS);
  assert.equal(reset.demo, true);
  assert.equal(reset.settings.club_name, 'Nom actuel');
  assert.equal(reset.user.name, 'Propriétaire');
  assert.equal(demo.club.auditLog().find((a) => a.action === 'demo.remettre_a_neuf').user_id, bundle.user.id);

  // The real club has no such route, and nothing of the demo reached it.
  assert.equal((await admin.post('/api/demo/reset', {})).status, 404);
  assert.deepEqual(memberNames(real.club), []);
  assert.equal(real.club.auditLog().some((a) => a.action === 'demo.remettre_a_neuf'), false);
});

test('exports en démo : le nom du fichier commence par DEMO_', async () => {
  const { real, demo, admin } = await clubs();
  const asAdmin = inDemo(demo, await contextOf(real, admin));
  const today = ok(await asAdmin.get('/api/me')).biz_today;
  const period = `from=${addMonths(today, -3)}&to=${today}`;

  const csv = await asAdmin.get(`/api/export/grand-livre?${period}`);
  assert.equal(csv.status, 200);
  assert.match(csv.headers.get('content-disposition'), /^attachment; filename="DEMO_grand-livre_.*\.csv"$/);
  // The Excel export is named by the server too.
  assert.match(ok(await asAdmin.get(`/api/export/grand-livre?${period}&format=json`)).filename, /^DEMO_grand-livre_.*\.xlsx$/);

  // The real club keeps the plain names.
  const own = `/api/export/grand-livre?from=${today}&to=${today}`;
  assert.match((await admin.get(own)).headers.get('content-disposition'), /^attachment; filename="grand-livre_/);
  assert.match(ok(await admin.get(`${own}&format=json`)).filename, /^grand-livre_.*\.xlsx$/);
});

test('en démo, ni le cookie ni le rôle transmis ne comptent : seul le compte recopié décide', async () => {
  const { real, demo, admin, bundle } = await clubs();
  const ctx = await contextOf(real, await managerOf(real));
  const asManager = inDemo(demo, ctx);

  // The demo database holds a session for the very cookie that rides along, pointing at the
  // administrator's mirrored account. An implementation that read the cookie before the handed
  // identity would serve the manager's request as the administrator, and fail this test.
  demo.club.prepareDemo(ctx.config);
  const hash = await sessionHash(admin);
  demo.db.run(
    'INSERT INTO sessions (token_hash, user_id, created_at, expires_at) VALUES (?, ?, ?, ?)',
    hash, bundle.user.id, new Date().toISOString(), '2099-01-01T00:00:00.000Z',
  );
  assert.equal(demo.club.sessionUser(hash).id, bundle.user.id); // the trap is set

  // The administrator's real session cookie rides along with a request made as the manager.
  const carried = { cookie: admin.cookie };
  assert.equal((await asManager.post('/api/demo/reset', {}, carried)).status, 403);
  const me = ok(await asManager.call('GET', '/api/me', undefined, carried));
  assert.equal(me.user.name, 'Gérant');
  assert.equal(me.user.role, 'gerant');

  // The role sent along with the identity is not believed: the mirrored account has the last word.
  const forged = inDemo(demo, { ...ctx, user: { ...ctx.user, role: 'admin' } });
  assert.equal((await forged.post('/api/demo/reset', {})).status, 403);
  assert.equal(ok(await forged.get('/api/me')).user.role, 'gerant');
});

test('en démo, un compte suit le vrai club : nouveau rôle, puis accès retiré', async () => {
  const { real, demo, admin } = await clubs();
  const manager = await managerOf(real);
  const ctx = await contextOf(real, manager);
  const managerId = ctx.user.id;
  assert.equal(ok(await inDemo(demo, ctx).get('/api/me')).user.role, 'gerant');

  // Promoted in the real club: the next request, which carries the configuration as it is now.
  ok(await admin.put(`/api/users/${managerId}`, { role: 'admin' }));
  const promoted = inDemo(demo, { user: ctx.user, config: real.club.demoConfig() });
  assert.equal(ok(await promoted.get('/api/me')).user.role, 'admin');
  assert.equal((await promoted.post('/api/demo/reset', {})).status, 200);

  // Deactivated: the demo space turns the account away.
  ok(await admin.put(`/api/users/${managerId}`, { active: false }));
  const deactivated = await inDemo(demo, { user: ctx.user, config: real.club.demoConfig() }).get('/api/me');
  assert.equal(deactivated.status, 401);
  assert.equal(deactivated.data.error.code, 'NON_CONNECTE');
});

test('en démo, une requête qui ne change aucun compte n’écrit aucune ligne', async () => {
  const { real, demo, admin } = await clubs();
  // total_changes() counts every row this connection has written, triggers included.
  const written = () => demo.club.get('SELECT total_changes() AS n').n;
  const accounts = () => demo.club.all('SELECT * FROM users ORDER BY id');

  // The same configuration prepared a second time: the accounts are not rewritten.
  const config = real.club.demoConfig();
  demo.club.prepareDemo(config);
  const filled = written();
  const rows = accounts();
  demo.club.prepareDemo(config);
  assert.equal(written(), filled);
  assert.deepEqual(accounts(), rows);

  // Same through the API: every demo request prepares the space again, and a read writes nothing.
  const ctx = await contextOf(real, admin);
  const asAdmin = () => inDemo(demo, { user: ctx.user, config: real.club.demoConfig() }); // the configuration as it is now
  ok(await asAdmin().get('/api/me'));
  ok(await asAdmin().get('/api/members'));
  assert.equal(written(), filled);

  // An account that changes is written, that one only, and once.
  const manager = real.club.userByLogin('gerant');
  ok(await admin.put(`/api/users/${manager.id}`, { role: 'admin' }));
  ok(await asAdmin().get('/api/me'));
  assert.equal(written(), filled + 1);
  assert.equal(demo.club.userRow(manager.id).role, 'admin');
  ok(await asAdmin().get('/api/me'));
  assert.equal(written(), filled + 1);

  // Every field is followed, the login and the hash stay what they were, the other accounts are left alone.
  ok(await admin.put(`/api/users/${manager.id}`, { name: 'Gérante', role: 'gerant', active: false }));
  ok(await asAdmin().get('/api/me'));
  assert.equal(written(), filled + 2);
  const followed = demo.club.userRow(manager.id);
  assert.deepEqual(
    [followed.name, followed.role, followed.active, followed.login, followed.password_hash],
    ['Gérante', 'gerant', 0, `u${manager.id}`, '!'],
  );
  assert.deepEqual(accounts().filter((a) => a.id !== manager.id), rows.filter((a) => a.id !== manager.id));
});

test('en démo, le contrôle CSRF et l’idempotence sont ceux du vrai club', async () => {
  const { real, demo, admin } = await clubs();
  const asAdmin = inDemo(demo, await contextOf(real, admin));

  assert.equal((await asAdmin.post('/api/members', TRIAL, { origin: 'http://autre-site.test' })).status, 403);
  assert.equal((await asAdmin.post('/api/members', TRIAL, { 'content-type': 'text/plain' })).status, 415);
  assert.equal(demo.club.listMembers().length, 5);

  // The same key twice: one member, and the second answer is the first one replayed.
  const key = { 'idempotency-key': 'cle-demo-0001' };
  const first = await asAdmin.post('/api/members', TRIAL, key);
  const second = await asAdmin.post('/api/members', TRIAL, key);
  assert.equal(first.status, 200);
  assert.equal(second.status, 200);
  assert.equal(second.headers.get('idempotent-replayed'), 'true');
  assert.deepEqual(second.data, first.data);
  assert.equal(demo.club.listMembers().length, 6);
});

test('en démo, un compte inconnu de la configuration reçoit une erreur, pas une exception', async () => {
  const { real, demo, admin } = await clubs();
  const ctx = await contextOf(real, admin);

  const stranger = await inDemo(demo, { ...ctx, user: { id: 999 } }).get('/api/me');
  assert.equal(stranger.status, 404);
  assert.equal(stranger.data.error.code, 'INTROUVABLE');
});

test('en démo, un remplissage refusé répond par son erreur, pas par une exception', async () => {
  const { real, demo, admin } = await clubs();
  // A space that holds a record but was never filled: the filling will not mix it with fictitious ones.
  demo.db.run(
    "INSERT INTO members (member_no, first_name, last_name, phone, created_at) VALUES ('M-0001', 'Resté', 'Là', '+242 06 000 0000', ?)",
    new Date().toISOString(),
  );

  const refused = await inDemo(demo, await contextOf(real, admin)).get('/api/me');
  assert.equal(refused.status, 409);
  assert.equal(refused.data.error.code, 'DONNEES_EXISTANTES');
  assert.deepEqual(memberNames(demo.club), ['Resté Là']);
  assert.equal(demo.club.get("SELECT COUNT(*) AS n FROM meta WHERE key = 'demo_seeded'").n, 0);
});

test('chaque point d’entrée refuse l’autre espace', async () => {
  const { real, demo, admin } = await clubs();
  const hash = await sessionHash(admin);
  const ctx = real.api.demoContext(hash);

  assert.throws(() => demo.api.demoContext(hash), /real club/);
  await assert.rejects(real.api.handleDemo(new Request(ORIGIN + '/api/me'), ctx), /demo space/);
  // The real club never takes an identity along with a request: its session decides.
  const account = real.club.userRow(ctx.user.id);
  await assert.rejects(real.api.handle(new Request(ORIGIN + '/api/me'), { user: account }), /demo space/);
  assert.equal(real.club.listMembers().length, 0); // nothing was prepared on the real club
});

// Second lock behind the Worker's routing (the router keeps these paths in the real club): sessions
// live there only, so with an identity handed over the demo space has no sign-in, sign-out or setup.
test('en démo, connexion, déconnexion et installation n’existent pas, même si la requête arrive jusque-là', async () => {
  const { real, demo, admin } = await clubs({ env: { SETUP_TOKEN: INSTALL_CODE } });
  const ctx = await contextOf(real, admin);
  const asAdmin = inDemo(demo, ctx);
  const intruder = { login: 'intrus', name: 'Intrus', password: 'mot-de-passe-intrus' };

  for (const [method, url, body] of [
    ['POST', '/api/login', { login: 'proprietaire', password: PROPRIO }],
    ['GET', '/api/login'], // whatever the method: the path decides, not the route table
    ['POST', '/api/logout', {}],
    ['GET', '/api/setup'],
    ['POST', '/api/setup', { ...intruder, setup_token: INSTALL_CODE }],
    ['POST', '/api/setup/reset', { ...intruder, setup_token: INSTALL_CODE }],
  ]) {
    const r = await asAdmin.call(method, url, body);
    assert.equal(r.status, 404, `${method} ${url}`);
    assert.equal(r.data.error.code, 'INTROUVABLE', `${method} ${url}`);
    assert.equal(r.data.error.message, 'Ressource inconnue.');
    assert.equal(r.headers.get('set-cookie'), null, `${method} ${url}`); // no cookie opened, none cleared
  }
  // Nothing happened in the demo database: no session, no account changed or added.
  assert.equal(demo.club.get('SELECT COUNT(*) AS n FROM sessions').n, 0);
  assert.equal(demo.club.get("SELECT COUNT(*) AS n FROM users WHERE login = 'intrus'").n, 0);
  assert.equal(demo.club.userRow(ctx.user.id).login, `u${ctx.user.id}`);
});

test('en démo, une identité sans compte donne 401, pas une exception', async () => {
  const { real, demo, admin } = await clubs();
  const { config } = await contextOf(real, admin);

  for (const [label, context] of Object.entries({
    'aucune identité': undefined,
    'identité nulle': null,
    'objet vide': {},
    'sans compte': { config },
    'compte nul': { user: null, config },
    'compte sans id': { user: { name: 'Sans id', role: 'admin' }, config },
    'identifiant zéro (l’auteur fictif)': { user: { id: DEMO_AUTHOR_ID }, config },
  })) {
    const r = await demo.api.handleDemo(new Request(ORIGIN + '/api/me'), context);
    assert.equal(r.status, 401, label);
    assert.equal((await r.json()).error.code, 'NON_CONNECTE', label);
  }
  // Turned away before anything was prepared.
  assert.equal(demo.club.hasUsers(), false);
  assert.equal(demo.club.listMembers().length, 0);
});

test('un vrai club aux tarifs souples (scénarios) reste le vrai club', async () => {
  const lenient = new Server({}, { lenientTariffs: true });
  servers.push(lenient);
  await lenient.start();
  await lenient.addUser('proprietaire', 'Propriétaire', 'admin', PROPRIO);
  const admin = new Client(lenient);
  await admin.login('proprietaire', PROPRIO);
  assert.equal(lenient.club.demo, true); // what lenientTariffs sets
  const today = lenient.club.bizToday();

  // The demo-only behaviours follow the space the API was created for, not that flag.
  ok(await admin.get('/api/users'));
  const csv = await admin.get(`/api/export/grand-livre?from=${today}&to=${today}`);
  assert.match(csv.headers.get('content-disposition'), /^attachment; filename="grand-livre_/);
  assert.equal((await admin.post('/api/demo/reset', {})).status, 404);
  const ctx = lenient.api.demoContext(await sessionHash(admin));
  assert.equal(ctx.user.name, 'Propriétaire');
  await assert.rejects(lenient.api.handleDemo(new Request(ORIGIN + '/api/me'), ctx), /demo space/);
});

test('l’espace démo ne crée pas les comptes de démonstration locaux', async () => {
  const local = new Server({ DEMO_ACCOUNTS: '1' }, { demo: true });
  servers.push(local);
  await local.start();

  assert.equal(local.club.hasUsers(), false);
  const visitor = new Client(local);
  assert.equal((await visitor.post('/api/login', { login: 'proprietaire', password: 'demo-proprio-2026' })).status, 401);
});

// ---------------------------------------------------------------------------- the Worker's routing
// The browser asks for the demo space with one header and says nothing else about itself. The
// Worker's router (worker/space.js) decides, in front of the two clubs: here they sit behind a Site,
// which sends every request through routeApi as worker/index.js does with the Durable Objects.

const DEMO_HEADER = { 'x-club-espace': 'demo' };

// The real club's administrator and manager signed in through the site, as browsers would be.
async function sites(env = {}) {
  const { real, demo } = await clubs({ env });
  const site = new Site(real, demo);
  const admin = new Client(site);
  await admin.login('proprietaire', PROPRIO);
  const manager = new Client(site);
  await manager.login('gerant', GERANT);
  return { real, demo, site, admin, manager };
}

// The same signed-in client, asking for the demo space: the header is all that changes.
const askingDemo = (client) => ({
  get: (url, headers) => client.call('GET', url, undefined, { ...DEMO_HEADER, ...headers }),
  post: (url, body, headers) => client.call('POST', url, body, { ...DEMO_HEADER, ...headers }),
});

test('aiguillage : avec l’en-tête démo on est dans la démo, sans lui dans le vrai club', async () => {
  const { real, demo, manager } = await sites();
  const auditBefore = real.club.all('SELECT * FROM audit_log');
  const inTheDemo = askingDemo(manager);

  const created = ok(await inTheDemo.post('/api/members', TRIAL));
  assert.equal(created.name, 'Essai Gérant');
  const names = (members) => members.map((m) => m.name).sort();
  assert.deepEqual(names(ok(await inTheDemo.get('/api/members'))), [...FICTITIOUS, 'Essai Gérant'].sort());
  // The same session without the header, or with any other value, is the real club's: no member there.
  assert.deepEqual(ok(await manager.get('/api/members')), []);
  assert.deepEqual(ok(await manager.call('GET', '/api/members', undefined, { 'x-club-espace': 'reel' })), []);

  assert.equal(demo.club.memberRow(created.id).created_by, real.club.userByLogin('gerant').id);
  assert.deepEqual(memberNames(real.club), []);
  assert.ok(real.club.isEmpty());
  assert.deepEqual(real.club.all('SELECT * FROM audit_log'), auditBefore);
});

test('aiguillage : la connexion reste réelle, même demandée avec l’en-tête démo', async () => {
  const { demo, site } = await sites();
  const visitor = new Client(site);

  const login = await askingDemo(visitor).post('/api/login', { login: 'gerant', password: GERANT });
  assert.equal(login.status, 200, JSON.stringify(login.data));
  assert.equal(login.data.demo, false); // the bundle of the real club
  assert.equal(login.data.settings.demo_mode, false);
  assert.equal(ok(await visitor.get('/api/me')).user.name, 'Gérant'); // a real session: it works without the header
  assert.equal(demo.club.get('SELECT COUNT(*) AS n FROM sessions').n, 0); // none was opened in the demo space
  assert.equal(demo.club.hasUsers(), false); // which was not even prepared
});

test('aiguillage : sans session valide, la démo répond 401 comme le vrai club et n’est pas préparée', async () => {
  const { real, demo, site, manager } = await sites();
  const visitor = new Client(site);

  const none = await askingDemo(visitor).get('/api/me');
  assert.equal(none.status, 401);
  assert.equal(none.data.error.code, 'NON_CONNECTE');
  assert.equal(none.data.error.message, 'Session expirée : veuillez vous reconnecter.');
  // Same answer, body and headers, as the real club gives a visitor without a session.
  const own = await visitor.get('/api/me');
  assert.equal(own.status, 401);
  assert.deepEqual(none.data, own.data);
  assert.deepEqual(Object.fromEntries(none.headers), Object.fromEntries(own.headers));

  // A cookie nobody issued, then a session that has expired.
  visitor.cookie = 'sid=jeton-inconnu';
  assert.equal((await askingDemo(visitor).get('/api/me')).status, 401);
  real.db.run('UPDATE sessions SET expires_at = ? WHERE token_hash = ?', '2000-01-01T00:00:00.000Z', await sessionHash(manager));
  assert.equal((await askingDemo(manager).get('/api/me')).status, 401);

  // Turned away at the door: no other check of the API comes first (here the content type, 415 without the header).
  const notJson = { 'content-type': 'text/plain' };
  assert.equal((await new Client(site).post('/api/members', TRIAL, notJson)).status, 415);
  assert.equal((await askingDemo(new Client(site)).post('/api/members', TRIAL, notJson)).status, 401);

  assert.equal(demo.club.hasUsers(), false);
  assert.equal(demo.club.listMembers().length, 0);
});

test('aiguillage : une identité forgée dans un en-tête du navigateur ne compte pas', async () => {
  const { real, site, manager } = await sites();
  const adminId = real.club.userByLogin('proprietaire').id;
  const forged = { 'x-club-demo-user': JSON.stringify({ id: adminId, name: 'Propriétaire', role: 'admin' }) };

  // Without a session, the header gives nothing.
  assert.equal((await askingDemo(new Client(site)).get('/api/me', forged)).status, 401);

  // With the manager's session and the administrator's identity forged beside it, the manager is
  // served as the manager: the demo space is not allowed to reset, and says who the account is.
  assert.equal((await askingDemo(manager).post('/api/demo/reset', {}, forged)).status, 403);
  const me = ok(await askingDemo(manager).get('/api/me', forged));
  assert.equal(me.user.name, 'Gérant');
  assert.equal(me.user.role, 'gerant');
});

test('aiguillage : en démo, un compte suit le vrai club (nom, rôle, puis accès retiré)', async () => {
  const { real, admin, manager } = await sites();
  const managerId = real.club.userByLogin('gerant').id;
  const inTheDemo = askingDemo(manager);
  assert.equal(ok(await inTheDemo.get('/api/me')).user.role, 'gerant');
  assert.equal((await inTheDemo.post('/api/demo/reset', {})).status, 403);

  // Renamed in the real club: the next request, with the same session, shows the new name.
  ok(await admin.put(`/api/users/${managerId}`, { name: 'Gérante' }));
  assert.equal(ok(await inTheDemo.get('/api/me')).user.name, 'Gérante');

  // Promoted: the real club closes the account's sessions, the manager signs in again and the very
  // next demo request gives the new role.
  ok(await admin.put(`/api/users/${managerId}`, { role: 'admin' }));
  await manager.login('gerant', GERANT);
  assert.equal(ok(await inTheDemo.get('/api/me')).user.role, 'admin');
  assert.equal((await inTheDemo.post('/api/demo/reset', {})).status, 200);

  // Deactivated: the next demo request is turned away.
  ok(await admin.put(`/api/users/${managerId}`, { active: false }));
  const turnedAway = await inTheDemo.get('/api/me');
  assert.equal(turnedAway.status, 401);
  assert.equal(turnedAway.data.error.code, 'NON_CONNECTE');
});

test('aiguillage : /api/me en démo annonce la démo, et dans le vrai club non', async () => {
  const { manager } = await sites();

  const inTheDemo = ok(await askingDemo(manager).get('/api/me'));
  assert.equal(inTheDemo.demo, true);
  assert.equal(inTheDemo.settings.demo_mode, true);
  assert.equal(inTheDemo.user.name, 'Gérant');

  const own = ok(await manager.get('/api/me'));
  assert.equal(own.demo, false);
  assert.equal(own.settings.demo_mode, false);
});

test('aiguillage : déconnexion et installation demandées en démo vont au vrai club', async () => {
  const { real, demo, site, manager } = await sites({ SETUP_TOKEN: INSTALL_CODE });
  const managerId = real.club.userByLogin('gerant').id;
  const sessionCookie = manager.cookie;

  // Signing out closes the real session (the demo space has none) and clears the real cookie.
  const out = await askingDemo(manager).post('/api/logout', {});
  assert.equal(out.status, 200);
  assert.match(out.headers.get('set-cookie'), /^sid=;.*Max-Age=0/);
  assert.equal(real.club.get('SELECT COUNT(*) AS n FROM sessions WHERE user_id = ?', managerId).n, 0);
  const stale = new Client(site);
  stale.cookie = sessionCookie;
  assert.equal((await stale.get('/api/me')).status, 401); // the real club no longer knows that cookie
  assert.equal((await askingDemo(stale).get('/api/me')).status, 401);

  // The installation routes answer from the real club, which holds the code...
  assert.deepEqual(ok(await askingDemo(new Client(site)).get('/api/setup')), { needed: false, token_configured: true });
  const reset = { login: 'proprietaire', password: 'nouveau-mot-de-passe-proprio' };
  const wrong = await askingDemo(new Client(site)).post('/api/setup/reset', { ...reset, setup_token: 'mauvais-code-installation' });
  assert.equal(wrong.status, 403);
  assert.equal(wrong.data.error.code, 'CODE_INCORRECT');
  // ...and with the right one the real owner gets the new password.
  ok(await askingDemo(new Client(site)).post('/api/setup/reset', { ...reset, setup_token: INSTALL_CODE }));
  await new Client(site).login('proprietaire', reset.password);

  // None of this reached the demo space: no session, no account, not even prepared.
  assert.equal(demo.club.get('SELECT COUNT(*) AS n FROM sessions').n, 0);
  assert.equal(demo.club.hasUsers(), false);
});

test('aiguillage : comptes et effacement demandés en démo sont refusés, le vrai club reste intact', async () => {
  const { real, site, admin } = await sites();
  ok(await admin.post('/api/members', { first_name: 'Vrai', last_name: 'Membre', phone: '+242 06 000 0000' }));
  const accountsBefore = real.club.listUsers();
  const inTheDemo = askingDemo(admin);

  const password = await inTheDemo.post('/api/me/password', { current_password: PROPRIO, new_password: 'nouveau-mot-de-passe' });
  const wipe = await inTheDemo.post('/api/admin/reset', { confirm: 'EFFACER' });
  for (const refused of [password, wipe]) {
    assert.equal(refused.status, 403);
    assert.equal(refused.data.error.code, 'MODE_DEMO');
  }
  assert.deepEqual(memberNames(real.club), ['Vrai Membre']);
  assert.deepEqual(real.club.listUsers(), accountsBefore);
  await new Client(site).login('proprietaire', PROPRIO); // the real password is the old one
});

// ---------------------------------------------------------------------------- the member card's credit in the demo

// Every row of every table of a club, to see that nothing moved in it.
const dump = (club) => Object.fromEntries(
  club.all("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name")
    .map(({ name }) => [name, club.all(`SELECT * FROM ${name}`)]),
);

test('carte de débit en démo : recharge, paiement par la carte et renouvellement ne touchent pas le vrai club', async () => {
  const { real, demo, admin, bundle } = await clubs();
  ok(await admin.post('/api/members', TRIAL)); // a real member must stay as it is
  const realMember = real.club.listMembers()[0];
  const asAdmin = inDemo(demo, await contextOf(real, admin));
  const before = dump(real.club);

  // A recharge of the card credit, with its signed ticket.
  const member = ok(await asAdmin.post('/api/members', TRIAL));
  const recharged = ok(await asAdmin.post(`/api/members/${member.id}/wallet/recharge`, { amount: 100000 * UM, method: 'Espèces' }));
  assert.equal(recharged.wallet.balance, 100000 * UM);
  assert.equal(recharged.payment.kind, 'recharge');
  assert.equal(demo.club.walletBalance(member.id), 100000 * UM);

  // A due line paid with the card.
  const author = demo.club.userRow(bundle.user.id);
  const due = demo.club.tx(() => demo.club.insertCharge(author, {
    account: 'alcool', kind: 'produit', member_id: member.id, label: 'Bouteille', quantity: 1, unit_price: 30000 * UM,
  }));
  const paid = ok(await asAdmin.post('/api/payments', { charge_ids: [due], card: true, method: 'Espèces' }));
  assert.equal(paid.payment.method, CARD_METHOD);
  assert.equal(paid.payment.card_amount, 30000 * UM);
  assert.equal(demo.club.walletBalance(member.id), 70000 * UM);

  // A renewal: the monthly plan ended yesterday, the home page of the day renews it from the credit.
  const plan = demo.club.plans().find((p) => p.code === 'MENSUELLE');
  assert.ok(plan.price > 0 && plan.price <= 70000 * UM, String(plan.price));
  const today = demo.club.bizToday();
  const start = addDays(today, -31);
  const sub = ok(await asAdmin.post(`/api/members/${member.id}/subscriptions`, { plan_id: plan.id, start_date: start }));
  assert.ok(sub.end_date < today, sub.end_date);
  ok(await asAdmin.get('/api/dashboard'));
  const subs = demo.club.all('SELECT * FROM subscriptions WHERE member_id = ? ORDER BY start_date', member.id);
  assert.equal(subs.length, 2);
  assert.equal(subs[1].start_date, today);
  assert.equal(demo.club.walletBalance(member.id), 70000 * UM - plan.price);
  assert.ok(demo.club.all('SELECT action FROM audit_log').some((a) => a.action === 'abonnement.renouveler_auto'));

  // The real club is exactly as it was.
  assert.deepEqual(dump(real.club), before);
  assert.deepEqual(real.club.listMembers().map((m) => m.id), [realMember.id]);
  assert.equal(real.club.walletBalance(realMember.id), 0);
});
