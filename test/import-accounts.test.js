// The Digibox accounts import door (POST /api/admin/accounts-import, spec
// docs/superpowers/specs/2026-11-17-dette-reprise-design.md): regular clients with their « Dette reprise », suppliers
// with their « Solde reporté », in one call, open only while the IMPORT_TOKEN secret exists. Never doubles anything,
// never writes over an account that already moved. Every name and amount here is made up.
import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { Server, Client, ok, UM, postSale } from './harness.js';

const IMPORT_TOKEN = 'code-import-fictif';
const servers = [];
afterEach(() => { for (const s of servers.splice(0)) s.destroy(); });

async function setup(env = { IMPORT_TOKEN }) {
  const server = new Server(env);
  servers.push(server);
  await server.start();
  await server.addUser('admin', 'Propriétaire', 'admin', 'import-admin-password');
  const admin = new Client(server);
  await admin.login('admin', 'import-admin-password');
  return { server, admin, door: new Client(server) };
}

const DATA = {
  clients: [
    { last_name: 'Société Fictive', debt: 150000 },
    { last_name: 'Kevin', phone: '06 000 00 01', notes: 'Livraison : centre ville', debt: 25500 },
    { first_name: 'Ali', last_name: 'Fictif', phone: '06 000 00 02' },
  ],
  suppliers: [
    { name: 'Fournisseur Fictif', account: 'cigares', country: 'Europe', currency: 'EUR', contact: '+242 06 000 00 03', carried_over: 900000 },
  ],
};
const send = (door, body, token = IMPORT_TOKEN) => door.post('/api/admin/accounts-import', body, token === null ? {} : { 'x-import-token': token });
const count = (server, sql) => server.club.get(`SELECT COUNT(*) AS n FROM ${sql}`).n;
const snapshot = (server) => ({
  members: count(server, 'members'),
  charges: count(server, 'charges'),
  suppliers: count(server, 'suppliers'),
  purchases: count(server, 'supplier_purchases'),
});
const clientsOf = async (admin) => {
  const r = ok(await admin.get('/api/clients'));
  return r.clients ?? r;
};

test('porte : sans IMPORT_TOKEN 503, mauvais code 403, rien n’est créé', async () => {
  const off = await setup({});
  assert.equal((await send(off.door, { ...DATA, dry_run: false })).status, 503);
  const on = await setup();
  const before = snapshot(on.server);
  const r = await send(on.door, { ...DATA, dry_run: false }, 'mauvais-code');
  assert.equal(r.status, 403);
  assert.deepEqual(snapshot(on.server), before);
});

test('essai à blanc : le plan, sans rien écrire', async () => {
  const { server, door } = await setup();
  const before = snapshot(server);
  const plan = ok(await send(door, { ...DATA, dry_run: true }));
  assert.equal(plan.dry_run, true);
  assert.deepEqual(plan.clients.map((c) => [c.name, c.action, c.debt]), [
    ['SOCIÉTÉ FICTIVE', 'creer_avec_dette', 150000],
    ['KEVIN', 'creer_avec_dette', 25500],
    ['Ali FICTIF', 'creer', 0],
  ]);
  assert.deepEqual(plan.suppliers.map((s) => [s.name, s.action, s.carried_over]), [['Fournisseur Fictif', 'creer', 900000]]);
  assert.equal(plan.total_debt, 175500);
  assert.deepEqual(snapshot(server), before);
});

test('import : clients, dettes reprises et fournisseur ; relancé, rien ne double', async () => {
  const { server, admin, door } = await setup();
  const done = ok(await send(door, { ...DATA, dry_run: false }));
  assert.equal(done.dry_run, false);
  assert.equal(done.total_debt, 175500);
  const clients = await clientsOf(admin);
  const societe = clients.find((c) => c.last_name === 'SOCIÉTÉ FICTIVE');
  assert.equal(societe.first_name, '');
  assert.equal(societe.phone, '');
  assert.equal(societe.owed, 150000 * UM);
  const kevin = clients.find((c) => c.last_name === 'KEVIN');
  assert.equal(kevin.owed, 25500 * UM);
  assert.equal(server.club.get('SELECT notes FROM members WHERE id = ?', kevin.id).notes, 'Livraison : centre ville');
  assert.equal(clients.find((c) => c.last_name === 'FICTIF').owed, 0);
  const acc = ok(await admin.get(`/api/clients/${societe.id}/account`));
  assert.equal(acc.movements[0].label, 'Dette reprise — Reprise Digibox');
  assert.equal(acc.movements[0].account, 'cigares');
  assert.equal(acc.credit_limit, 0);
  const sup = server.club.get("SELECT * FROM suppliers WHERE name = 'Fournisseur Fictif'");
  assert.deepEqual([sup.account, sup.currency, sup.country], ['cigares', 'EUR', 'Europe']);
  const report = server.club.get('SELECT * FROM supplier_purchases WHERE supplier_id = ?', sup.id);
  assert.deepEqual([report.kind, report.amount, report.label], ['report', 900000 * UM, 'Solde Digibox']);
  assert.ok(server.club.get("SELECT 1 AS x FROM audit_log WHERE action = 'import.digibox'"));

  const before = snapshot(server);
  const again = ok(await send(door, { ...DATA, dry_run: false }));
  assert.deepEqual(again.clients.map((c) => c.action), ['deja_repris', 'deja_repris', 'existe']);
  assert.deepEqual(again.suppliers.map((s) => s.action), ['deja_repris']);
  assert.equal(again.total_debt, 0);
  assert.deepEqual(snapshot(server), before);
});

test('conflits : un client qui doit déjà, un membre du même nom, un fournisseur qui a déjà bougé', async () => {
  const { server, admin, door } = await setup();
  const prod = ok(await admin.post('/api/products', { category: 'cigare', name: 'Cigare import', reference: 'CIM', price: 5000 * UM, initial_stock: 5 }));
  const kevin = ok(await admin.post('/api/clients', { last_name: 'kevin', phone: '06 000 00 01' }));
  ok(await admin.put(`/api/clients/${kevin.id}/credit-limit`, { credit_limit: 50000 * UM }));
  ok(await postSale(admin, {
    account: 'cigares', buyer: { kind: 'client', member_id: kevin.id }, lines: [{ product_id: prod.id, quantity: 1 }], credit: true,
  }));
  ok(await admin.post('/api/members', { first_name: 'ali', last_name: 'fictif', phone: '06 000 00 09' }));
  const sup = ok(await admin.post('/api/suppliers', { name: 'Fournisseur Fictif', account: 'cigares' }));
  ok(await admin.post(`/api/suppliers/${sup.id}/purchases`, { kind: 'achat', amount: 1000 * UM }));
  const done = ok(await send(door, { ...DATA, dry_run: false }));
  assert.deepEqual(done.clients.map((c) => c.action), ['creer_avec_dette', 'conflit_doit_deja', 'conflit_membre']);
  assert.deepEqual(done.suppliers.map((s) => s.action), ['conflit_operations']);
  assert.equal(done.total_debt, 150000);
  assert.equal(server.club.get('SELECT COUNT(*) AS n FROM charges WHERE member_id = ? AND carryover = 1', kevin.id).n, 0);
  assert.equal(server.club.get("SELECT COUNT(*) AS n FROM members WHERE last_name = 'FICTIF'").n, 1);
  assert.equal(server.club.get('SELECT COUNT(*) AS n FROM supplier_purchases WHERE supplier_id = ?', sup.id).n, 1);
});

test('fichier refusé en entier : nom manquant, doublon, montant faux', async () => {
  const { server, door } = await setup();
  const before = snapshot(server);
  const bad = [
    { clients: [...DATA.clients, { phone: '06 000 00 04' }], suppliers: [] },
    { clients: [...DATA.clients, { last_name: 'kevin' }], suppliers: [] },
    { clients: [{ last_name: 'Société Fictive', debt: -5 }], suppliers: [] },
    { clients: [], suppliers: [{ ...DATA.suppliers[0], account: 'reservations' }] },
  ];
  for (const body of bad) {
    const r = await send(door, { ...body, dry_run: false });
    assert.equal(r.status, 400, JSON.stringify(r.data));
  }
  assert.deepEqual(snapshot(server), before);
});

test('doublons probables : accents et tirets reconnus, même téléphone ou même nom sans prénom signalés', async () => {
  const { server, admin, door } = await setup();
  const elodie = ok(await admin.post('/api/clients', { first_name: 'élodie', last_name: 'fictive', phone: '06 000 00 11' }));
  ok(await admin.post('/api/clients', { first_name: 'jean-pierre', last_name: 'martin', phone: '06 000 00 12' }));
  const mbemba = ok(await admin.post('/api/clients', { first_name: 'jean', last_name: 'mbemba', phone: '+242 06 111 22 33' }));
  const kouka = ok(await admin.post('/api/clients', { first_name: 'paul', last_name: 'kouka' }));
  const before = snapshot(server);
  const plan = ok(await send(door, {
    dry_run: false,
    clients: [
      { first_name: 'Elodie', last_name: 'FICTIVE', debt: 1000 },
      { first_name: 'Jean Pierre', last_name: 'MARTIN' },
      { last_name: 'MBEMBA', phone: '06 111 22 33', debt: 2000 },
      { last_name: 'KOUKA', debt: 3000 },
    ],
    suppliers: [],
  }));
  assert.deepEqual(plan.clients.map((c) => c.action), ['existe_dette_ajoutee', 'existe', 'conflit_homonyme', 'conflit_homonyme']);
  assert.deepEqual(plan.clients.map((c) => c.member_no), [elodie.member_no, plan.clients[1].member_no, mbemba.member_no, kouka.member_no]);
  assert.equal(plan.total_debt, 1000);
  const after = snapshot(server);
  assert.equal(after.members, before.members);
  assert.equal(after.charges, before.charges + 1);
});
