// The demo space: a second club (its own database) that copies the real club's configuration and
// holds only fictitious data. Both clubs are driven here as the Worker will drive them: the real
// club hands out its configuration (Club.demoConfig), the demo club prepares itself from it.
import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { addMonths } from '../shared/time.js';
import { DEMO_AUTHOR_ID } from '../worker/club.js';
import { Server, Client, ok, UM } from './harness.js';

const servers = [];
afterEach(() => {
  for (const server of servers.splice(0)) server.destroy();
});

const PROPRIO = 'mot-de-passe-proprio';

// A real club with its administrator (logged in) and a manager, and an empty demo space beside it.
async function clubs() {
  const real = new Server();
  const demo = new Server({}, { demo: true });
  servers.push(real, demo);
  await real.start();
  await demo.start();
  await real.addUser('proprietaire', 'Propriétaire', 'admin', PROPRIO);
  await real.addUser('gerant', 'Gérant', 'gerant', 'mot-de-passe-gerant');
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
