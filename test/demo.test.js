// The demo space: a second club (its own database) that copies the real club's configuration and
// catalogue and starts empty: no member, booking, payment, expense or treasury history. Both clubs are
// driven here as the Worker will drive them: the real club hands out its configuration
// (Club.demoConfig), the demo club prepares itself from it.
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
const count = (club, table) => club.get(`SELECT COUNT(*) AS n FROM ${table}`).n;
const mark = (club, key) => club.get('SELECT COUNT(*) AS n FROM meta WHERE key = ?', key).n;

// A product of the real club's catalogue, created by its administrator.
const realProduct = async (admin, fields) => ok(await admin.post('/api/products', {
  category: 'cigare', price: 12000 * UM, initial_stock: 40, ...fields,
}));

// The tables that hold what the club does: all empty in a demo space just prepared.
const ACTIVITY = [
  'members', 'cards', 'subscriptions', 'reservations', 'reservation_attendees', 'charges', 'payments', 'refunds',
  'wallet_movements', 'credit_movements', 'ledger_entries', 'closed_periods', 'humidors', 'humidor_readings',
];
const assertNoActivity = (club) => {
  for (const table of ACTIVITY) assert.equal(count(club, table), 0, table);
};

test('configuration réelle copiée dans la démo', async () => {
  const { real, demo, admin, bundle } = await clubs();
  ok(await admin.put('/api/settings', { club_name: 'Cercle TEST' }));
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
  assert.equal(settings.club_name, 'Cercle TEST');
  assert.equal(settings.demo_mode, true);
  assert.deepEqual(settings.opening_balances.amounts, {}); // the demo has none: its treasury starts at zero
  const copied = demo.club.plans().find((p) => p.code === 'ANNUELLE');
  assert.equal(copied.price, 120000 * UM);
  assert.equal(copied.price_validated_by_name, 'Propriétaire'); // the validating account was copied too
  assert.deepEqual(demo.club.rooms().map((r) => r.name), ['Salon']);
  assert.deepEqual(demo.club.rooms().map((r) => r.name), real.club.rooms().map((r) => r.name));
  assert.deepEqual(demo.club.all('SELECT * FROM categories ORDER BY id'), real.club.all('SELECT * FROM categories ORDER BY id'));

  assert.equal(demo.club.listMembers().length, 0);
  assert.equal(mark(demo.club, 'demo_empty'), 1);
  assert.equal(real.club.listMembers().length, 0);
  assert.ok(real.club.isEmpty());
});

test('démo vide : aucun client ni opération, le catalogue réel avec son stock fictif', async () => {
  const { real, demo, admin } = await clubs();
  const a = await realProduct(admin, { name: 'Cohiba Siglo I', reference: 'CIG-001' });
  const b = await realProduct(admin, { name: 'Whisky maison', category: 'bouteille', reference: 'BOU-001', initial_stock: 3 });
  demo.club.prepareDemo(real.club.demoConfig());

  assertNoActivity(demo.club);
  // The real products only, under their ids, 10 each whatever the real stock, and nothing fictitious.
  const products = demo.club.listProducts({ includeInactive: true });
  assert.deepEqual(products.map((p) => p.id).sort((x, y) => x - y), [a.id, b.id]);
  assert.ok(products.every((p) => !p.is_demo && p.stock_qty === 10));
  // The only stock movements are the opening ones that explain that stock.
  assert.deepEqual(
    demo.club.all('SELECT product_id, kind, quantity FROM stock_movements ORDER BY product_id').map((m) => ({ ...m })),
    [{ product_id: a.id, kind: 'stock_initial', quantity: 10 }, { product_id: b.id, kind: 'stock_initial', quantity: 10 }],
  );
  // The treasury starts at zero: no opening balance, no movement.
  const today = demo.club.bizToday();
  const treasury = demo.club.treasury(today, today);
  assert.equal(treasury.total.closing, 0);
  assert.ok(treasury.accounts.every((acc) => acc.closing === 0), JSON.stringify(treasury.accounts));
  // The real club keeps its own stock.
  assert.equal(real.club.listProducts().find((p) => p.id === a.id).stock_qty, 40);
});

test('un seul remplissage : les appels suivants suivent les comptes, pas les réglages', async () => {
  const { real, demo, admin } = await clubs();
  ok(await admin.put('/api/settings', { club_name: 'Premier nom' }));
  demo.club.prepareDemo(real.club.demoConfig());
  const actor = demo.club.userRow(real.club.userByLogin('proprietaire').id);
  const trial = demo.club.tx(() => demo.club.createMember(actor, { first_name: 'Essai', last_name: 'Membre', phone: '+000 000000' }));

  // The real club moves on: a renamed and deactivated account, a new account, a new club name, a new product.
  const manager = real.club.userByLogin('gerant');
  ok(await admin.put(`/api/users/${manager.id}`, { name: 'Gérante', active: false }));
  ok(await admin.post('/api/users', { login: 'stagiaire', name: 'Stagiaire', role: 'gerant', password: 'mot-de-passe-stagiaire' }));
  ok(await admin.put('/api/settings', { club_name: 'Second nom' }));
  await realProduct(admin, { name: 'Tout nouveau', reference: 'CIG-009' });
  demo.club.prepareDemo(real.club.demoConfig());

  // Not emptied a second time, and the settings and the catalogue are those copied at the first preparation.
  assert.deepEqual(demo.club.listMembers().map((m) => m.id), [trial.id]);
  assert.equal(demo.club.listProducts().length, 0);
  assert.equal(demo.club.settings().club_name, 'Premier nom');
  // The accounts follow at once.
  const renamed = demo.club.userRow(manager.id);
  assert.equal(renamed.name, 'Gérante');
  assert.equal(renamed.active, 0);
  const added = real.club.userByLogin('stagiaire');
  assert.equal(demo.club.userRow(added.id).login, `u${added.id}`);
});

test('formules : la copie est fidèle, une formule retirée de la vente le reste en démo', async () => {
  const { real, demo, admin, bundle } = await clubs();
  const monthly = bundle.plans.find((p) => p.code === 'MENSUELLE');
  ok(await admin.put(`/api/plans/${monthly.id}`, { active: false }));
  demo.club.prepareDemo(real.club.demoConfig());

  const pick = (plans) => plans.map((p) => [p.id, p.code, p.price, p.active]).sort();
  assert.deepEqual(pick(demo.club.plans()), pick(real.club.plans()));
  assert.equal(demo.club.plans().find((p) => p.code === 'MENSUELLE').active, false);
  assert.equal(demo.club.plans().find((p) => p.code === 'ANNUELLE').active, true);
});

test('une démo remplie à l’ancienne (données fictives) est vidée à la requête suivante, les comptes restent', async () => {
  const { real, demo, admin } = await clubs();
  const cohiba = await realProduct(admin, { name: 'Cohiba Siglo I', reference: 'CIG-001' });
  const asAdmin = inDemo(demo, await contextOf(real, admin));

  // The space as the old version left it: trials, a recharge, a fictitious product and opening balance, the old mark.
  const trial = ok(await asAdmin.post('/api/members', TRIAL));
  ok(await asAdmin.post(`/api/members/${trial.id}/wallet/recharge`, { amount: 50000 * UM, method: 'Espèces' }));
  const author = demo.club.get('SELECT * FROM users WHERE id = ?', DEMO_AUTHOR_ID);
  demo.club.tx(() => demo.club.createProduct(author, {
    category: 'cigare', name: 'Robusto (démo)', reference: 'CIG-DEMO-01', price: 10000 * UM, initial_stock: 30,
  }, { demo: true }));
  demo.club.tx(() => demo.club.updateSettings(author, {
    opening_balances: { date: demo.club.bizToday(), amounts: { 'Espèces': 150000 * UM } },
  }));
  demo.db.run("DELETE FROM meta WHERE key = 'demo_empty'");
  demo.db.run("INSERT INTO meta (key, value) VALUES ('demo_seeded', ?)", new Date().toISOString());
  assert.equal(count(demo.club, 'payments'), 1);
  const accounts = demo.club.all('SELECT * FROM users ORDER BY id');

  // The next request finds no `demo_empty` mark: the space is emptied, then the configuration copied again.
  assert.deepEqual(ok(await asAdmin.get('/api/members')), []);
  assertNoActivity(demo.club);
  assert.deepEqual(demo.club.listProducts({ includeInactive: true }).map((p) => [p.id, p.stock_qty, p.is_demo]), [[cohiba.id, 10, false]]);
  assert.deepEqual(demo.club.settings().opening_balances.amounts, {});
  assert.equal(mark(demo.club, 'demo_seeded'), 0);
  assert.equal(mark(demo.club, 'demo_empty'), 1);
  assert.deepEqual(demo.club.all('SELECT * FROM users ORDER BY id'), accounts); // the accounts are kept as they were

  // Once only: a trial made now stays.
  ok(await asAdmin.post('/api/members', TRIAL));
  assert.equal(ok(await asAdmin.get('/api/members')).length, 1);
});

test('de la base vide à la fin : client avec carte, recharge, réservation, consommation, encaissement', async () => {
  const { real, demo, admin } = await clubs();
  const cohiba = await realProduct(admin, { name: 'Cohiba Siglo I', reference: 'CIG-001' });
  const asAdmin = inDemo(demo, await contextOf(real, admin));

  // A new client has his virtual card at once.
  const member = ok(await asAdmin.post('/api/members', TRIAL));
  assert.deepEqual(member.cards.map((c) => c.kind), ['virtuelle']);
  // The card is recharged in cash.
  const recharged = ok(await asAdmin.post(`/api/members/${member.id}/wallet/recharge`, { amount: 100000 * UM, method: 'Espèces' }));
  assert.equal(recharged.wallet.balance, 100000 * UM);
  // The room booked for tomorrow, paid with the card (no plan: the whole time is paid).
  const roomId = ok(await asAdmin.get('/api/rooms'))[0].id;
  const tomorrow = addDays(demo.club.bizToday(), 1);
  const booked = ok(await asAdmin.post('/api/reservations', {
    member_id: member.id, room_id: roomId, date: tomorrow, start_time: '15:00', duration_min: 120, pay_with_card: true,
  }));
  const timePaid = booked.charges.filter((c) => c.kind === 'temps_supplementaire').reduce((sum, c) => sum + c.amount, 0);
  assert.ok(timePaid > 0);
  assert.equal(booked.reservation.due_amount, 0);
  assert.equal(demo.club.walletBalance(member.id), 100000 * UM - timePaid);
  // Two cigars of the copied catalogue, then the note paid in cash.
  const served = ok(await asAdmin.post(`/api/reservations/${booked.reservation.id}/items`, { product_id: cohiba.id, quantity: 2 }));
  const due = served.charges.filter((c) => c.status === 'due');
  assert.deepEqual(due.map((c) => c.amount), [2 * 12000 * UM]);
  const paid = ok(await asAdmin.post('/api/payments', { charge_ids: due.map((c) => c.id), method: 'Espèces' }));
  assert.equal(paid.payment.amount, 2 * 12000 * UM);
  assert.equal(demo.club.listProducts().find((p) => p.id === cohiba.id).stock_qty, 8);
  assert.equal(count(demo.club, 'payments'), 3); // the recharge, the room by the card, the cigars in cash

  // None of it reached the real club.
  assert.equal(real.club.listMembers().length, 0);
  assert.equal(count(real.club, 'payments'), 0);
  assert.equal(real.club.listProducts().find((p) => p.id === cohiba.id).stock_qty, 40);
});

test('remise à neuf : les essais disparaissent, la configuration est recopiée', async () => {
  const { real, demo, admin } = await clubs();
  demo.club.prepareDemo(real.club.demoConfig());
  const actor = demo.club.userRow(real.club.userByLogin('proprietaire').id);
  demo.club.tx(() => demo.club.createMember(actor, { first_name: 'Essai', last_name: 'Membre', phone: '+000 000000' }));
  assert.deepEqual(memberNames(demo.club), ['Essai MEMBRE']);

  ok(await admin.put('/api/settings', { club_name: 'Nom actuel' }));
  const cohiba = await realProduct(admin, { name: 'Cohiba Siglo I', reference: 'CIG-001' });
  demo.club.resetDemo(real.club.demoConfig(), actor);

  assertNoActivity(demo.club);
  assert.equal(demo.club.settings().club_name, 'Nom actuel');
  assert.deepEqual(demo.club.listProducts().map((p) => [p.id, p.stock_qty]), [[cohiba.id, 10]]);
  const entries = demo.club.auditLog();
  assert.deepEqual(entries.map((a) => a.action).filter((a) => a === 'demo.remettre_a_neuf'), ['demo.remettre_a_neuf']);
  assert.equal(entries.find((a) => a.action === 'demo.remettre_a_neuf').user_id, actor.id);
  // The space is marked as prepared again: a plain preparation leaves it alone, and it can be reset again.
  assert.equal(mark(demo.club, 'demo_empty'), 1);
  demo.club.tx(() => demo.club.createMember(actor, { first_name: 'Essai', last_name: 'Membre', phone: '+000 000000' }));
  demo.club.prepareDemo(real.club.demoConfig());
  assert.equal(demo.club.listMembers().length, 1);
  demo.club.resetDemo(real.club.demoConfig(), actor);
  assert.equal(demo.club.listMembers().length, 0);
});

// A configuration the copy cannot take: a second room without a name (the column is NOT NULL). The first
// room has gone in by the time it fails.
const brokenConfig = (config) => ({ ...config, rooms: [...config.rooms, { ...config.rooms[0], id: 999, name: null }] });

test('une préparation ou une remise à neuf qui échoue ne laisse rien derrière elle', async () => {
  const { real, demo, admin } = await clubs();
  ok(await admin.put('/api/settings', { club_name: 'Cercle TEST' }));
  await realProduct(admin, { name: 'Cohiba Siglo I', reference: 'CIG-001' });
  const broken = brokenConfig(real.club.demoConfig());

  assert.throws(() => demo.club.prepareDemo(broken));
  assert.equal(demo.club.settings().club_name, 'Limen'); // nothing copied...
  assert.equal(demo.club.plans().length, 2); // ...the plans it had are still there...
  assert.equal(count(demo.club, 'products'), 0); // ...no product, no stock...
  assert.equal(count(demo.club, 'stock_movements'), 0);
  assert.equal(demo.club.hasUsers(), false); // ...no account mirrored...
  assert.equal(mark(demo.club, 'demo_empty'), 0); // ...and no mark.
  demo.club.prepareDemo(real.club.demoConfig()); // the next try prepares it, once
  assert.equal(demo.club.settings().club_name, 'Cercle TEST');
  assert.equal(count(demo.club, 'products'), 1);

  // A failed reset keeps the trials made in the space, and its mark.
  const actor = demo.club.userRow(real.club.userByLogin('proprietaire').id);
  demo.club.tx(() => demo.club.createMember(actor, { first_name: 'Essai', last_name: 'Membre', phone: '+000 000000' }));
  assert.throws(() => demo.club.resetDemo(broken, actor));
  assert.deepEqual(memberNames(demo.club), ['Essai MEMBRE']);
  assert.equal(mark(demo.club, 'demo_empty'), 1);
  assert.equal(demo.club.auditLog().some((a) => a.action === 'demo.remettre_a_neuf'), false);
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
  assert.deepEqual(memberNames(real.club), ['Vrai MEMBRE']);
  await new Client(real).login('proprietaire', PROPRIO);
  assert.equal(real.club.userByLogin('gerant').name, 'Gérant');
  assert.equal(mark(real.club, 'demo_empty'), 0);
  assert.equal(mark(real.club, 'demo_seeded'), 0);
});

test('comptes de la démo : copies sans mot de passe, auteur fictif', async () => {
  const { real, demo, admin } = await clubs();
  await realProduct(admin, { name: 'Cohiba Siglo I', reference: 'CIG-001' });
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

  // The fictitious author owns what the preparation writes: the copied products and their opening stock.
  assert.equal(DEMO_AUTHOR_ID, 0);
  const author = demo.club.get('SELECT * FROM users WHERE id = ?', DEMO_AUTHOR_ID);
  assert.equal(author.login, 'auteur.demo.0');
  assert.equal(author.name, 'Démonstration');
  assert.equal(author.role, 'admin');
  assert.equal(author.password_hash, '!');
  assert.deepEqual(demo.club.all('SELECT DISTINCT created_by FROM products').map((r) => r.created_by), [DEMO_AUTHOR_ID]);
  assert.deepEqual(demo.club.all('SELECT DISTINCT created_by FROM stock_movements').map((r) => r.created_by), [DEMO_AUTHOR_ID]);
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

  // The first request prepares the space (empty), then creates its first member.
  const created = ok(await asAdmin.post('/api/members', TRIAL));
  assert.equal(created.name, 'Essai GÉRANT');
  assert.deepEqual(memberNames(demo.club), ['Essai GÉRANT']);
  assert.equal(demo.club.memberRow(created.id).created_by, bundle.user.id);
  assert.equal(ok(await asAdmin.get('/api/members')).length, 1);

  assert.deepEqual(memberNames(real.club), []);
  assert.ok(real.club.isEmpty());
  assert.deepEqual(real.club.all('SELECT * FROM audit_log'), auditBefore);
});

test('en démo, la gestion des comptes est refusée, comptes et mots de passe intacts', async () => {
  const { real, demo, admin } = await clubs();
  const manager = await managerOf(real);
  const managerId = real.club.userByLogin('gerant').id;
  const accountsBefore = real.club.listUsers();
  ok(await inDemo(demo, await contextOf(real, admin)).post('/api/members', TRIAL)); // a trial, to see it is not wiped
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
  assert.equal(demo.club.listMembers().length, 1);
});

test('« Remettre la démo à neuf » : réservé aux administrateurs, absent du vrai club', async () => {
  const { real, demo, admin, bundle } = await clubs();
  const asAdmin = inDemo(demo, await contextOf(real, admin));
  const asManager = inDemo(demo, await contextOf(real, await managerOf(real)));
  ok(await asAdmin.post('/api/members', TRIAL));
  assert.equal(demo.club.listMembers().length, 1);

  // The manager is turned away and the trials stay.
  assert.equal((await asManager.post('/api/demo/reset', {})).status, 403);
  assert.equal(demo.club.listMembers().length, 1);

  // The administrator gets an empty space back, with the real club's settings as they are now.
  ok(await admin.put('/api/settings', { club_name: 'Nom actuel' }));
  const refreshed = inDemo(demo, await contextOf(real, admin));
  const reset = ok(await refreshed.post('/api/demo/reset', {}));
  assert.deepEqual(memberNames(demo.club), []);
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
  assert.equal(demo.club.listMembers().length, 0);

  // The same key twice: one member, and the second answer is the first one replayed.
  const key = { 'idempotency-key': 'cle-demo-0001' };
  const first = await asAdmin.post('/api/members', TRIAL, key);
  const second = await asAdmin.post('/api/members', TRIAL, key);
  assert.equal(first.status, 200);
  assert.equal(second.status, 200);
  assert.equal(second.headers.get('idempotent-replayed'), 'true');
  assert.deepEqual(second.data, first.data);
  assert.equal(demo.club.listMembers().length, 1);
});

test('en démo, un compte inconnu de la configuration reçoit une erreur, pas une exception', async () => {
  const { real, demo, admin } = await clubs();
  const ctx = await contextOf(real, admin);

  const stranger = await inDemo(demo, { ...ctx, user: { id: 999 } }).get('/api/me');
  assert.equal(stranger.status, 404);
  assert.equal(stranger.data.error.code, 'INTROUVABLE');
});

test('en démo, une préparation en échec répond par son erreur, pas par une exception', async () => {
  const { real, demo, admin } = await clubs();
  const ctx = await contextOf(real, admin);

  const refused = await inDemo(demo, { ...ctx, config: brokenConfig(ctx.config) }).get('/api/me');
  assert.equal(refused.status, 409);
  assert.equal(refused.data.error.code, 'CONTRAINTE');
  assert.equal(demo.club.hasUsers(), false);
  assert.equal(mark(demo.club, 'demo_empty'), 0);
});

test('en démo, un enregistrement resté dans un espace jamais préparé est effacé à la préparation', async () => {
  const { real, demo, admin } = await clubs();
  demo.db.run(
    "INSERT INTO members (member_no, first_name, last_name, phone, created_at) VALUES ('M-0001', 'Resté', 'Là', '+242 06 000 0000', ?)",
    new Date().toISOString(),
  );

  assert.deepEqual(ok(await inDemo(demo, await contextOf(real, admin)).get('/api/members')), []);
  assert.deepEqual(memberNames(demo.club), []);
  assert.equal(mark(demo.club, 'demo_empty'), 1);
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
  assert.equal(created.name, 'Essai GÉRANT');
  const names = (members) => members.map((m) => m.name).sort();
  assert.deepEqual(names(ok(await inTheDemo.get('/api/members'))), ['Essai GÉRANT']);
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
  assert.deepEqual(memberNames(real.club), ['Vrai MEMBRE']);
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
  // This space's renewals started before that plan ended (a fresh database starts them today).
  demo.club.run("UPDATE meta SET value = ? WHERE key = 'renewals_since'", start);
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
