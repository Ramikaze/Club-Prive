// First installation, expenses, treasury, general ledger, monthly closing, data reset, local accounts
// and the real club never being in demo mode.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { addMonths } from '../shared/time.js';
import { Server, Client, ok, UM } from './harness.js';

const SETUP_TOKEN = 'code-installation-test';
const server = new Server({ SETUP_TOKEN }, { lenientTariffs: true });
// The club as it runs online: never in demo mode (test 21).
const real = new Server({ SETUP_TOKEN });
let admin;
let manager;
let realAdmin;
let today;
let categories;
const cat = (name) => categories.find((c) => c.name === name).id;

before(async () => {
  await server.start();
  await real.start();
  realAdmin = new Client(real);
  ok(await realAdmin.post('/api/setup', { setup_token: SETUP_TOKEN, login: 'reel', name: 'Administrateur réel', password: 'mot-de-passe-reel' }));
});
after(() => {
  server.destroy();
  real.destroy();
});

test('15. installation : le premier administrateur exige le code SETUP_TOKEN', async () => {
  const anonymous = new Client(server);
  assert.deepEqual(ok(await anonymous.get('/api/setup')), { needed: true, token_configured: true });
  assert.equal((await anonymous.post('/api/login', { login: 'x', password: 'y' })).status, 401);
  const wrong = await anonymous.post('/api/setup', { setup_token: 'faux', login: 'patron', name: 'Patron', password: 'mot-de-passe-patron' });
  assert.equal(wrong.status, 403);
  const weak = await anonymous.post('/api/setup', { setup_token: SETUP_TOKEN, login: 'patron', name: 'Patron', password: 'court' });
  assert.equal(weak.status, 400);
  admin = new Client(server);
  const bundle = ok(await admin.post('/api/setup', { setup_token: SETUP_TOKEN, login: 'patron', name: 'Patron', password: 'mot-de-passe-patron' }));
  assert.equal(bundle.user.role, 'admin');
  assert.equal(bundle.settings.currency.label, 'FCFA');
  assert.equal(bundle.settings.timezone, 'Africa/Brazzaville');
  today = bundle.biz_today;
  assert.equal(ok(await admin.get('/api/me')).user.login, 'patron');
  const again = await anonymous.post('/api/setup', { setup_token: SETUP_TOKEN, login: 'autre', name: 'Autre', password: 'mot-de-passe-autre' });
  assert.equal(again.status, 409);
  assert.equal(ok(await anonymous.get('/api/setup')).needed, false);
  ok(await admin.post('/api/users', { login: 'gerant', name: 'Gérant', role: 'gerant', password: 'gerant-password-1' }));
  manager = new Client(server);
  await manager.login('gerant', 'gerant-password-1');
  categories = ok(await manager.get('/api/ledger/categories'));
  assert.ok(categories.some((c) => c.kind === 'depense' && c.name === 'Loyer'));
});

test('15 bis. identifiants perdus : le code d’installation redonne l’accès au premier administrateur', async () => {
  const anonymous = new Client(server);
  const reset = (body) => anonymous.post('/api/setup/reset', { setup_token: SETUP_TOKEN, login: 'patronne', password: 'nouveau-mot-de-passe', ...body });
  assert.equal((await reset({ setup_token: 'faux' })).status, 403);
  assert.equal((await reset({ password: 'court' })).status, 400);
  assert.equal((await reset({ login: 'gerant' })).status, 409);
  const owner = new Client(server);
  const bundle = ok(await owner.post('/api/setup/reset', { setup_token: SETUP_TOKEN, login: 'patronne', password: 'nouveau-mot-de-passe' }));
  assert.equal(bundle.user.login, 'patronne');
  assert.equal(bundle.user.role, 'admin');
  assert.equal((await admin.get('/api/me')).status, 401); // the owner's other sessions are closed
  ok(await manager.get('/api/me')); // other accounts keep theirs
  assert.equal((await anonymous.post('/api/login', { login: 'patron', password: 'mot-de-passe-patron' })).status, 401);
  const entry = ok(await owner.get('/api/audit')).find((a) => a.action === 'utilisateur.acces_reinitialise');
  assert.deepEqual(entry.details, { avant: 'patron', apres: 'patronne' });
  admin = owner;
});

test('16. dépenses, entrées et transferts : droits et contrôles', async () => {
  ok(await admin.put('/api/settings', { opening_balances: { date: null, amounts: { 'Espèces': 100000 * UM } } }));
  const member = ok(await manager.post('/api/members', { first_name: 'Paul', last_name: 'Test', phone: '+000 00 00 00 00' }));
  const plan = ok(await manager.get('/api/me')).plans.find((p) => p.code === 'MENSUELLE');
  const sub = ok(await manager.post(`/api/members/${member.id}/subscriptions`, { plan_id: plan.id }));
  ok(await manager.post('/api/payments', { charge_ids: [sub.charge_id], method: 'Espèces' }));

  const expense = ok(await manager.post('/api/ledger/entries', {
    kind: 'depense', category_id: cat('Achats cigares'), amount: 20000 * UM, method: 'Espèces', account: 'cigares', label: 'Boîte de robustos',
  }));
  assert.equal(expense.biz_date, today);
  assert.equal(expense.created_by_name, 'Gérant');
  const backdated = await manager.post('/api/ledger/entries', {
    kind: 'depense', category_id: cat('Divers'), amount: 1000 * UM, method: 'Espèces', biz_date: addMonths(today, -1),
  });
  assert.equal(backdated.status, 403);
  assert.equal((await manager.post('/api/ledger/entries', {
    kind: 'transfert', amount: 1000 * UM, method: 'Espèces', to_method: 'Virement',
  })).status, 403);
  assert.equal((await manager.post(`/api/ledger/entries/${expense.id}/cancel`, { reason: 'Erreur' })).status, 403);

  ok(await admin.post('/api/ledger/entries', { kind: 'transfert', amount: 30000 * UM, method: 'Espèces', to_method: 'Virement' }));
  ok(await admin.post('/api/ledger/entries', { kind: 'recette', category_id: cat('Apport des associés'), amount: 10000 * UM, method: 'Virement' }));
  const bad = [
    { kind: 'transfert', amount: 100, method: 'Espèces', to_method: 'Espèces' },
    { kind: 'depense', category_id: cat('Divers'), amount: 100, method: 'Espèces', biz_date: '2999-01-01' },
    { kind: 'depense', category_id: cat('Divers'), amount: 100, method: 'Coffre inconnu' },
    { kind: 'depense', category_id: cat('Apport des associés'), amount: 100, method: 'Espèces' },
    { kind: 'depense', category_id: cat('Divers'), amount: 0, method: 'Espèces' },
  ];
  for (const body of bad) assert.equal((await admin.post('/api/ledger/entries', body)).status, 400, JSON.stringify(body));

  const mine = ok(await manager.get('/api/ledger/entries?from=2020-01-01&to=2020-12-31'));
  assert.equal(mine.restricted, true);
  assert.equal(mine.from, today);
  assert.equal(mine.entries.length, 3);
  for (const url of [`/api/treasury?from=${today}`, `/api/ledger/book?from=${today}`, '/api/closings', `/api/export/grand-livre?from=${today}`]) {
    assert.equal((await manager.get(url)).status, 403, url);
  }
  assert.equal((await manager.post('/api/admin/reset', { confirm: 'EFFACER' })).status, 403);
});

test('17. trésorerie et grand livre concordent', async () => {
  const t = ok(await admin.get(`/api/treasury?from=${today}&to=${today}`));
  const acc = (m) => t.accounts.find((a) => a.method === m);
  assert.deepEqual(acc('Espèces'), { method: 'Espèces', opening: 100000 * UM, in: 50000 * UM, out: 50000 * UM, closing: 100000 * UM });
  assert.deepEqual(acc('Virement'), { method: 'Virement', opening: 0, in: 40000 * UM, out: 0, closing: 40000 * UM });
  assert.equal(t.total.closing, 140000 * UM);
  assert.equal(t.result.revenue, 50000 * UM);
  assert.equal(t.result.expenses, 20000 * UM);
  assert.equal(t.result.result, 30000 * UM);
  assert.equal(t.result.other_receipts, 10000 * UM);
  assert.equal(t.result.accounts.find((a) => a.account === 'cigares').margin, -20000 * UM);

  const book = ok(await admin.get(`/api/ledger/book?from=${today}&to=${today}`));
  assert.equal(book.rows.length, 5); // payment, expense, transfer out + in, receipt
  assert.equal(book.opening, 100000 * UM);
  assert.equal(book.closing, t.total.closing);
  assert.equal(book.rows.at(-1).balance, book.closing);
  const bank = ok(await admin.get(`/api/ledger/book?from=${today}&method=${encodeURIComponent('Virement')}`));
  assert.equal(bank.opening, 0);
  assert.equal(bank.closing, 40000 * UM);
  const cigars = ok(await admin.get(`/api/ledger/book?from=${today}&account=cigares`));
  assert.equal(cigars.rows.length, 1);
  assert.equal(cigars.rows[0].balance, null);

  const sheet = ok(await admin.get(`/api/export/grand-livre?from=${today}&to=${today}&format=json`));
  assert.match(sheet.filename, /\.xlsx$/);
  assert.equal(sheet.sheet, 'Grand livre');
  assert.equal(sheet.rows.length, 6);
  assert.equal(sheet.rows[0].at(-1), 100000); // money in currency units for Excel
  const csv = await admin.get(`/api/export/operations?from=${today}&to=${today}`);
  assert.equal(csv.status, 200);
  assert.match(csv.headers.get('content-type'), /text\/csv/);
  assert.match(csv.data, /Boîte de robustos/);
});

test('18. clôture mensuelle : la période fermée refuse toute écriture jusqu’à sa réouverture', async () => {
  const lastMonth = addMonths(`${today.slice(0, 8)}01`, -1);
  const month = lastMonth.slice(0, 7);
  const old = ok(await admin.post('/api/ledger/entries', {
    kind: 'depense', category_id: cat('Divers'), amount: 5000 * UM, method: 'Espèces', biz_date: lastMonth,
  }));
  assert.equal((await admin.post('/api/closings', { month: today.slice(0, 7) })).status, 400);
  const closings = ok(await admin.post('/api/closings', { month }));
  const closed = closings.months.find((m) => m.month === month);
  assert.equal(closed.closed, true);
  assert.equal(closings.closed[0].summary.result.expenses, 5000 * UM);
  assert.equal((await admin.post('/api/closings', { month })).data.error.code, 'DEJA_CLOTURE');

  const late = await admin.post('/api/ledger/entries', {
    kind: 'depense', category_id: cat('Divers'), amount: 1000 * UM, method: 'Espèces', biz_date: lastMonth,
  });
  assert.equal(late.status, 409);
  assert.equal(late.data.error.code, 'PERIODE_CLOTUREE');
  assert.equal((await admin.post(`/api/ledger/entries/${old.id}/cancel`, { reason: 'Doublon' })).data.error.code, 'PERIODE_CLOTUREE');
  const balances = await admin.put('/api/settings', { opening_balances: { date: null, amounts: { 'Espèces': 1 } } });
  assert.equal(balances.data.error.code, 'PERIODE_CLOTUREE');
  ok(await admin.put('/api/settings', { opening_balances: { date: null, amounts: { 'Espèces': 100000 * UM } } })); // unchanged: accepted

  assert.equal((await admin.post(`/api/closings/${month}/reopen`, {})).status, 400);
  ok(await admin.post(`/api/closings/${month}/reopen`, { reason: 'Facture oubliée' }));
  const cancelled = ok(await admin.post(`/api/ledger/entries/${old.id}/cancel`, { reason: 'Doublon' }));
  assert.equal(cancelled.status, 'annulee');
  const audit = ok(await admin.get('/api/audit?limit=20')).map((a) => a.action);
  for (const action of ['periode.cloturer', 'periode.rouvrir', 'operation.annuler']) assert.ok(audit.includes(action), action);
});

test('19. effacement des données', async () => {
  assert.equal((await admin.post('/api/admin/reset', { confirm: 'oui' })).status, 400);
  ok(await admin.post('/api/admin/reset', { confirm: 'EFFACER' }));
  assert.equal(ok(await admin.get('/api/members')).length, 0);
  assert.equal(ok(await admin.get(`/api/treasury?from=${today}`)).total.closing, 0);
  ok(await manager.get('/api/dashboard')); // accounts and sessions are kept
});

test('20. en local, DEMO_ACCOUNTS=1 crée seulement les comptes', async () => {
  const local = new Server({ DEMO_ACCOUNTS: '1' });
  await local.start();
  try {
    const gerant = new Client(local);
    const bundle = await gerant.login('gerant', 'demo-gerant-2026');
    assert.equal(bundle.user.role, 'gerant');
    assert.equal(bundle.demo, false);
    assert.equal(bundle.settings.demo_mode, false);
    assert.equal(ok(await gerant.get('/api/members')).length, 0);
    await local.restart(); // a second start does not create the accounts twice
    await new Client(local).login('proprietaire', 'demo-proprio-2026');
  } finally {
    local.destroy();
  }
});

test('21. le vrai club ignore un ancien demo_mode stocké et refuse de le modifier', async () => {
  real.db.run("INSERT INTO settings (key, value, updated_at) VALUES ('demo_mode', 'true', '2026-01-01') ON CONFLICT(key) DO UPDATE SET value = 'true'");
  real.club.cachedSettings = null;
  assert.equal(ok(await realAdmin.get('/api/me')).settings.demo_mode, false);
  const r = await realAdmin.put('/api/settings', { demo_mode: true });
  assert.equal(r.status, 400);
  assert.equal(r.data.error.message, 'Paramètre inconnu : demo_mode');
  assert.equal((await realAdmin.post('/api/admin/demo')).status, 404);
});
