// Cash receipt, server side: check code at payment, codes for old payments, ticket settings, data reset.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { Server, Client, ok, UM } from './harness.js';

const SETUP_TOKEN = 'code-installation-test';
const server = new Server({ SETUP_TOKEN }, { lenientTariffs: true });
const CODE = /^[ABCDEFGHJKMNPQRSTUVWXYZ23456789]{12}$/;
let admin;
let manager;
let plan;

before(async () => {
  await server.start();
  admin = new Client(server);
  ok(await admin.post('/api/setup', { setup_token: SETUP_TOKEN, login: 'patron', name: 'Patron', password: 'mot-de-passe-patron' }));
  ok(await admin.post('/api/users', { login: 'gerant', name: 'Gérant', role: 'gerant', password: 'gerant-password-1' }));
  manager = new Client(server);
  await manager.login('gerant', 'gerant-password-1');
  plan = ok(await manager.get('/api/me')).plans.find((p) => p.code === 'MENSUELLE');
});
after(() => server.destroy());

async function collect(last) {
  const member = ok(await manager.post('/api/members', { first_name: 'Paul', last_name: last, phone: '+000 00 00 00 00' }));
  const sub = ok(await manager.post(`/api/members/${member.id}/subscriptions`, { plan_id: plan.id }));
  return ok(await manager.post('/api/payments', { charge_ids: [sub.charge_id], method: 'Espèces' })).payment;
}

test('un encaissement reçoit un code de 12 caractères, différent d\'un paiement à l\'autre', async () => {
  const a = await collect('Un');
  const b = await collect('Deux');
  assert.match(a.ticket_code, CODE);
  assert.match(b.ticket_code, CODE);
  assert.notEqual(a.ticket_code, b.ticket_code);
});

test('les paiements existants reçoivent un code au démarrage', async () => {
  const p = await collect('Trois');
  const before = server.db.get('SELECT amount, paid_at FROM payments WHERE id = ?', p.id);
  server.db.run('UPDATE payments SET ticket_code = NULL');
  await server.restart();
  const rows = server.db.all('SELECT id, ticket_code, amount, paid_at FROM payments');
  assert.ok(rows.length >= 3);
  for (const r of rows) assert.match(r.ticket_code, CODE);
  assert.equal(new Set(rows.map((r) => r.ticket_code)).size, rows.length);
  const after = rows.find((r) => r.id === p.id);
  assert.equal(after.amount, before.amount);
  assert.equal(after.paid_at, before.paid_at);
});

test('réglages du ticket', async () => {
  const s = ok(await admin.get('/api/me')).settings;
  assert.equal(s.ticket_header, '');
  assert.equal(s.ticket_footer, 'Merci de votre visite');
  assert.equal((await admin.put('/api/settings', { ticket_header: 'x'.repeat(201) })).status, 400);
  assert.equal((await admin.put('/api/settings', { ticket_header: 'a\nb\nc\nd\ne' })).status, 400);
  assert.equal((await admin.put('/api/settings', { ticket_footer: 'a\nb\nc' })).status, 400);
  assert.equal((await manager.put('/api/settings', { ticket_header: 'Bonjour' })).status, 403);
  const t = ok(await admin.put('/api/settings', { ticket_header: 'Ligne 1\nLigne 2', ticket_footer: 'A bientôt' })).settings;
  assert.equal(t.ticket_header, 'Ligne 1\nLigne 2');
  assert.equal(t.ticket_footer, 'A bientôt');
});

test('effacer toutes les données vide aussi les sorties de tickets', async () => {
  const p = await collect('Quatre');
  server.db.run("INSERT INTO ticket_events (payment_id, kind, copy_no, at) VALUES (?, 'impression', 1, ?)", p.id, new Date().toISOString());
  ok(await admin.post('/api/admin/reset', { confirm: 'EFFACER' }));
  assert.equal(server.db.get('SELECT COUNT(*) AS n FROM ticket_events').n, 0);
  assert.equal(server.db.get('SELECT COUNT(*) AS n FROM payments').n, 0);
});
