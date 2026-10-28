// The evening closing of the till: every ticket of the day checked (or a reason for those left), every till and
// account counted, the gaps recorded as « Écart de caisse » with a reason, then the day locked until an
// administrator reopens it. The manager closes too; only an administrator reopens.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { Server, Client, ok, UM } from './harness.js';

const server = new Server({});
let admin;
let manager;
let today;

const refused = (r, status, code) => {
  assert.equal(r.status, status, JSON.stringify(r.data));
  if (code) assert.equal(r.data.error.code, code);
};

before(async () => {
  await server.start();
  await server.addUser('admin', 'Admin', 'admin', 'day-closing-admin-password');
  await server.addUser('gerant', 'Gérant', 'gerant', 'day-closing-manager-password');
  admin = new Client(server);
  manager = new Client(server);
  today = (await admin.login('admin', 'day-closing-admin-password')).biz_today;
  await manager.login('gerant', 'day-closing-manager-password');
  ok(await admin.post('/api/treasury/fund', { amounts: { 'Espèces': 50000 * UM } }));
});
after(() => server.destroy());

const expenseCategory = async () => ok(await admin.get('/api/ledger/categories'))
  .find((c) => c.kind === 'depense' && c.active && c.name !== 'Écart de caisse' && c.name !== 'Avance repas client');

test('la fermeture exige un motif pour les tickets non pointés et pour un écart', async () => {
  const cat = await expenseCategory();
  const e = ok(await manager.post('/api/ledger/entries', { kind: 'depense', category_id: cat.id, amount: 2000 * UM, method: 'Espèces' }));
  const state = ok(await manager.get(`/api/day-closing?day=${today}`));
  assert.equal(state.closed, null);
  const cash = state.accounts.find((a) => a.method === 'Espèces');
  assert.equal(cash.expected, 48000 * UM);
  assert.equal(cash.to_count, true);
  // A ticket left unchecked needs a reason.
  refused(await manager.post('/api/day-closing', { day: today, checked: [], counts: { 'Espèces': 48000 * UM } }), 400);
  // A gap needs a reason.
  refused(await manager.post('/api/day-closing', { day: today, checked: [`E-${e.id}`], counts: { 'Espèces': 46500 * UM } }), 400);
  // An account to count must be counted.
  refused(await manager.post('/api/day-closing', { day: today, checked: [`E-${e.id}`], counts: {} }), 400);
});

test('le gérant ferme la journée : l’écart est enregistré, la journée verrouillée', async () => {
  const res = ok(await manager.post('/api/day-closing', {
    day: today, checked: [], unchecked_reason: 'Reçu égaré', counts: { 'Espèces': 46500 * UM }, gap_reason: 'Monnaie rendue en trop',
    cash_detail: { 10000: 4, 5000: 1, pieces: 1500 * UM },
  }));
  assert.ok(res.closed);
  const line = res.closed.summary.accounts.find((a) => a.method === 'Espèces');
  assert.equal(line.gap, -1500 * UM);
  assert.equal(res.closed.summary.unchecked.length, 1);
  const gapEntry = server.club.entryRows('e.id = ?', line.entry_id)[0];
  assert.equal(gapEntry.category_name, 'Écart de caisse');
  assert.equal(gapEntry.amount, 1500 * UM);
  const t = ok(await admin.get(`/api/treasury?from=${today}&to=${today}`));
  assert.equal(t.accounts.find((a) => a.method === 'Espèces').closing, 46500 * UM);
  // Locked: no new movement dated today, no second closing.
  const cat = await expenseCategory();
  refused(await manager.post('/api/ledger/entries', { kind: 'depense', category_id: cat.id, amount: 1000 * UM, method: 'Espèces' }), 409, 'JOURNEE_FERMEE');
  refused(await manager.post('/api/day-closing', { day: today, counts: {} }), 409, 'DEJA_FERMEE');
});

test('seul un administrateur rouvre la journée, avec un motif', async () => {
  refused(await manager.post(`/api/day-closing/${today}/reopen`, { reason: 'Oubli' }), 403);
  refused(await admin.post(`/api/day-closing/${today}/reopen`, {}), 400);
  const res = ok(await admin.post(`/api/day-closing/${today}/reopen`, { reason: 'Ticket oublié' }));
  assert.equal(res.closed, null);
  const cat = await expenseCategory();
  ok(await manager.post('/api/ledger/entries', { kind: 'depense', category_id: cat.id, amount: 1000 * UM, method: 'Espèces' }));
});

test('une journée future ne peut pas être fermée', async () => {
  refused(await admin.post('/api/day-closing', { day: '2999-01-01', counts: {} }), 400);
});

// The demo reset empties the same tables as this wipe (WIPE_ORDER).
test('l’effacement des données rouvre aussi les journées fermées', async () => {
  const state = ok(await admin.get(`/api/day-closing?day=${today}`));
  const counts = Object.fromEntries(state.accounts.filter((a) => a.to_count).map((a) => [a.method, a.expected]));
  assert.ok(ok(await admin.post('/api/day-closing', { day: today, checked: [], unchecked_reason: 'Test', counts })).closed);
  ok(await admin.post('/api/admin/reset', { confirm: 'EFFACER' }));
  assert.equal(ok(await admin.get(`/api/day-closing?day=${today}`)).closed, null);
  const cat = await expenseCategory();
  ok(await admin.post('/api/ledger/entries', { kind: 'depense', category_id: cat.id, amount: 1000 * UM, method: 'Espèces' }));
});
