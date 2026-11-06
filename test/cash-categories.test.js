// The Caisse in three columns (src/components/cash/categories.js) on the server's own answers: the columns add up
// to the total, Boisson is Champagne + Autres boissons, and a billed line reads the way the page shows it.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { categoryColumns, lineTexts } from '../src/components/cash/categories.js';
import { Server, Client, ok, UM } from './harness.js';

const server = new Server({}, { lenientTariffs: true });
let admin;
let ger;
let today;
let bundle;
let CHP;
let DRK;
let CIG;

const summary = async () => ok(await admin.get(`/api/finance/summary?from=${today}`));
const billed = async () => ok(await admin.get(`/api/finance/billed?from=${today}`));

before(async () => {
  await server.start();
  await server.addUser('admin', 'Propriétaire', 'admin', 'cols-admin-password');
  await server.addUser('ger', 'Gérant', 'gerant', 'cols-ger-password');
  admin = new Client(server);
  ger = new Client(server);
  today = (await admin.login('admin', 'cols-admin-password')).biz_today;
  bundle = await ger.login('ger', 'cols-ger-password');
  CHP = ok(await admin.post('/api/products', { category: 'bouteille', name: 'Champagne test', reference: 'CHP', price: 20000 * UM, initial_stock: 100 })).id;
  DRK = ok(await admin.post('/api/products', { category: 'boisson', name: 'Boisson test', reference: 'DRK', price: 30000 * UM, initial_stock: 100 })).id;
  CIG = ok(await admin.post('/api/products', { category: 'cigare', name: 'Cigare test', reference: 'CIG', price: 5000 * UM, initial_stock: 400 })).id;
  // A session with one line of each category, the champagne and the cigar paid, the drink left on the note.
  const m = ok(await ger.post('/api/members', { first_name: 'jean', last_name: 'cols', phone: '00 00 08 01' }));
  ok(await ger.post(`/api/members/${m.id}/subscriptions`, { plan_id: bundle.plans.find((p) => p.code === 'MENSUELLE').id, start_date: today }));
  const r = ok(await ger.post('/api/reservations', { member_id: m.id, room_id: bundle.rooms[0].id, date: today, start_time: '06:00', duration_min: 60 }));
  const ids = [];
  for (const product_id of [CHP, DRK, CIG]) {
    const d = ok(await ger.post(`/api/reservations/${r.reservation.id}/items`, { product_id, quantity: 1 }));
    ids.push(d.charges.filter((c) => c.status === 'due' && c.kind === 'produit').at(-1).id);
  }
  ok(await ger.post('/api/payments', { charge_ids: [ids[0], ids[2]], method: 'Espèces' }));
});
after(() => server.destroy());

test('trois colonnes ; Boisson = Champagne + Autres boissons ; la somme = le total', async () => {
  const sum = await summary(); const b = await billed();
  const cols = categoryColumns(sum, b);
  assert.deepEqual(cols.map((c) => c.title), ['Réservation séance', 'Boisson', 'Cigare']);
  assert.deepEqual(cols[1].parts.map((p) => p.title), ['Champagne', 'Autres boissons']);
  // Each column is pinned to its own account, not just to the sum.
  const acc = (k) => sum.accounts.find((a) => a.account === k);
  assert.equal(cols[0].net, acc('reservations').net);
  assert.equal(cols[1].net, acc('alcool').net);
  assert.equal(cols[2].net, acc('cigares').net);
  assert.equal(cols[1].parts[0].net, acc('alcool').champagne.net);
  assert.equal(cols[1].parts[1].net, acc('alcool').autres_boissons.net);
  assert.equal(cols[1].net, cols[1].parts[0].net + cols[1].parts[1].net);
  assert.equal(cols.reduce((s, c) => s + c.net, 0), sum.total.net);
  assert.deepEqual(cols[1].parts[1].lines, b.columns.autres_boissons.lines);
  assert.ok(cols[1].parts[1].lines.some((l) => l.status === 'due'));
});

test('textes d’une ligne facturée', () => {
  const base = { member_name: 'Jean TEST', reservation_id: 12, room_name: 'Salon', quantity: 2, label: 'Whisky test' };
  assert.equal(lineTexts({ ...base, kind: 'abonnement', plan_name: 'Mensuelle' }).title, 'Abonnement · Mensuelle · Jean TEST');
  assert.deepEqual(lineTexts({ ...base, kind: 'produit' }), { title: 'Whisky test × 2', origin: 'Séance n° 12 · Jean TEST' });
  assert.equal(lineTexts({ ...base, kind: 'produit', shop_sale_id: 3, reservation_id: null, member_name: 'Client journalier' }).origin, 'Boutique · Client journalier');
  assert.equal(lineTexts({ ...base, kind: 'temps_supplementaire', label: 'Temps supplémentaire (1 h)' }).origin, 'Séance n° 12 · Salon · Jean TEST');
  assert.equal(lineTexts({ ...base, kind: 'produit', reservation_id: null }).origin, 'Jean TEST');
});

test('le tableau de bord du gérant ne porte pas la répartition Champagne / Autres boissons', async () => {
  const alcool = (d) => d.cash_today.accounts.find((a) => a.account === 'alcool');
  assert.equal(alcool(ok(await ger.get('/api/dashboard'))).champagne, undefined);
  assert.equal(alcool(ok(await ger.get('/api/dashboard'))).autres_boissons, undefined);
  assert.ok(alcool(ok(await admin.get('/api/dashboard'))).champagne);
});
