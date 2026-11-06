// Regular clients (registered buyers who are not members) and the hidden walk-in row.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { Server, Client, ok } from './harness.js';

const server = new Server({});
let admin;
let ger;

before(async () => {
  await server.start();
  await server.addUser('admin', 'Propriétaire', 'admin', 'clients-admin-password');
  await server.addUser('ger', 'Gérant', 'gerant', 'clients-ger-password');
  admin = new Client(server);
  await admin.login('admin', 'clients-admin-password');
  ger = new Client(server);
  await ger.login('ger', 'clients-ger-password');
});
after(() => server.destroy());

let n = 0;
const newClient = async (who = ger) => ok(await who.post('/api/clients', { first_name: 'awa', last_name: `test${++n}`, phone: `00 00 00 ${String(n).padStart(2, '0')}` }));
const newMember = async () => ok(await ger.post('/api/members', { first_name: 'jean', last_name: `membre${++n}`, phone: `00 00 01 ${String(n).padStart(2, '0')}` }));
const code = (r) => r.data?.error?.code;

test('un client régulier a son propre numéro et reste hors des membres', async () => {
  const c = ok(await ger.post('/api/clients', { first_name: 'awa', last_name: 'test', phone: '00 00 00 01' }));
  assert.equal(c.member_no, 'C-0001');
  assert.equal(c.kind, 'client');
  assert.equal(c.last_name, 'TEST');
  assert.deepEqual(c.cards, []);
  assert.ok(!ok(await ger.get('/api/members')).some((m) => m.id === c.id));
  assert.ok(ok(await ger.get('/api/clients')).some((m) => m.id === c.id));
  const row = ok(await ger.get('/api/clients')).find((m) => m.id === c.id);
  assert.equal(row.purchases_count, 0);
  assert.equal(row.purchases_total, 0);
  assert.equal(row.last_purchase_at, null);
  assert.ok(server.club.get("SELECT 1 AS x FROM audit_log WHERE action = 'client.creer'"));
});

test('le numéro de membre suit les membres, pas les clients', async () => {
  const before = server.club.get("SELECT COALESCE(MAX(CAST(SUBSTR(member_no, 3) AS INTEGER)), 0) AS n FROM members WHERE member_no LIKE 'M-%'").n;
  const a = await newMember();
  await newClient();
  await newClient();
  const b = await newMember();
  assert.equal(a.member_no, `M-${String(before + 1).padStart(4, '0')}`);
  assert.equal(b.member_no, `M-${String(before + 2).padStart(4, '0')}`);
  const c = await newClient();
  assert.match(c.member_no, /^C-\d{4}$/);
});

test('un client régulier ne réserve pas, n’a ni abonnement, ni carte, ni recharge', async () => {
  const c = await newClient();
  const plan = server.club.get('SELECT id FROM plans LIMIT 1');
  const answers = [
    await ger.post(`/api/members/${c.id}/subscriptions`, { plan_id: plan?.id ?? 1 }),
    await ger.post(`/api/members/${c.id}/cards`, { kind: 'virtuelle' }),
    await ger.post(`/api/members/${c.id}/wallet/recharge`, { amount: 1000, method: 'Espèces' }),
    await ger.post(`/api/members/${c.id}/outside-meal`, { amount: 1000, label: 'Plat' }),
    await ger.post('/api/reservations', { member_id: c.id, room_id: 1, date: '2030-01-01', start_time: '20:00', duration_min: 60 }),
  ];
  for (const r of answers) {
    assert.equal(r.status, 409, JSON.stringify(r.data));
    assert.equal(code(r), 'PAS_MEMBRE');
  }
});

test('passer en membre garde l’historique et le numéro d’origine', async () => {
  const c = await newClient();
  const m = ok(await ger.post(`/api/clients/${c.id}/convert`, {}));
  assert.equal(m.id, c.id);
  assert.equal(m.kind, 'membre');
  assert.match(m.member_no, /^M-\d{4}$/);
  assert.equal(m.former_client_no, c.member_no);
  assert.ok(m.became_member_at);
  assert.equal(m.cards.length, 1);
  assert.ok(m.card_code);
  const audit = server.club.get("SELECT details FROM audit_log WHERE action = 'client.passer_membre' AND entity_id = ?", c.id);
  assert.ok(audit);
  assert.ok(audit.details.includes(c.member_no) && audit.details.includes(m.member_no));
  const again = await ger.post(`/api/clients/${c.id}/convert`, {});
  assert.equal(again.status, 409);
  assert.equal(code(again), 'PAS_CLIENT');
  assert.ok(ok(await ger.get('/api/members')).some((x) => x.id === c.id));
  assert.ok(!ok(await ger.get('/api/clients')).some((x) => x.id === c.id));
  // A real member is no client either.
  const mem = await newMember();
  assert.equal(code(await ger.post(`/api/clients/${mem.id}/convert`, {})), 'PAS_CLIENT');
});

test('le client journalier n’apparaît nulle part', async () => {
  const id = server.club.tx(() => server.club.walkInMemberId());
  assert.equal(server.club.tx(() => server.club.walkInMemberId()), id);
  assert.equal(server.club.get("SELECT COUNT(*) AS n FROM members WHERE kind = 'journalier'").n, 1);
  const row = server.club.get('SELECT * FROM members WHERE id = ?', id);
  assert.equal(row.member_no, 'J-0000');
  assert.equal(row.first_name, 'Client');
  assert.equal(row.last_name, 'JOURNALIER');
  assert.equal(row.phone, '');
  assert.equal(server.club.get('SELECT COUNT(*) AS n FROM cards WHERE member_id = ?', id).n, 0);
  for (const url of ['/api/members', '/api/members?q=client', '/api/members?q=journalier', '/api/clients', '/api/clients?q=journalier', '/api/clients?statut=tous']) {
    assert.ok(!ok(await ger.get(url)).some((m) => m.id === id), url);
  }
  assert.ok(!server.club.renewalCandidates().includes(id));
});

test('la fiche du client journalier ne s’ouvre pas', async () => {
  const id = server.club.tx(() => server.club.walkInMemberId());
  const answers = [
    await ger.get(`/api/members/${id}`),
    await ger.get(`/api/members/${id}/statement`),
    await ger.put(`/api/members/${id}`, { first_name: 'Essai', last_name: 'Test', phone: '00 00 00 09' }),
    await admin.post(`/api/members/${id}/deactivate`, { reason: 'Essai de désactivation' }),
    await admin.post(`/api/members/${id}/reactivate`),
  ];
  for (const r of answers) assert.equal(r.status, 404, JSON.stringify(r.data));
  const row = server.club.get('SELECT * FROM members WHERE id = ?', id);
  assert.equal(row.active, 1);
  assert.equal(row.first_name, 'Client');
  assert.equal(row.last_name, 'JOURNALIER');
  assert.equal(row.phone, '');
});

test('un client régulier se désactive et se réactive comme un membre', async () => {
  const c = await newClient();
  const off = ok(await ger.post(`/api/members/${c.id}/deactivate`, { reason: 'Départ du pays' }));
  assert.equal(off.active, false);
  assert.ok(!ok(await ger.get('/api/clients')).some((x) => x.id === c.id));
  assert.ok(ok(await ger.get('/api/clients?statut=desactives')).some((x) => x.id === c.id));
  const twice = await ger.post(`/api/members/${c.id}/deactivate`, { reason: 'Départ du pays' });
  assert.equal(twice.status, 409);
  assert.equal(code(twice), 'DEJA_DESACTIVE');
  const on = ok(await ger.post(`/api/members/${c.id}/reactivate`, {}));
  assert.equal(on.active, true);
  assert.equal(on.kind, 'client');
  assert.equal(on.member_no, c.member_no);
  assert.ok(ok(await ger.get('/api/clients')).some((x) => x.id === c.id));
});

test('listMembers indique qui est en salle', async () => {
  const m = await newMember();
  const row = ok(await ger.get('/api/members')).find((x) => x.id === m.id);
  assert.equal(row.in_room, false);
});
