// Paramètres › « Effacer des données » (shared/erase.js): the administrator alone erases the groups he ticks, with
// the groups they need; links from tables that stay are emptied; the database stays consistent (no foreign key left
// pointing at nothing); accounts and settings always stay; the erasure is written in the journal.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Server, Client, ok, UM } from './harness.js';
import { eraseClosure } from '../shared/erase.js';

const refused = (r, status) => assert.equal(r.status, status, JSON.stringify(r.data));

// A club with a bit of everything: a member with a plan, a session with a paid line, a Boutique sale, a card
// recharge, a gift from the cigar associé.
async function seeded(name) {
  const server = new Server({}, { lenientTariffs: true });
  await server.start();
  await server.addUser('admin', 'Propriétaire', 'admin', `${name}-admin-password`);
  await server.addUser('ger', 'Gérant', 'gerant', `${name}-ger-password`);
  await server.addUser('cig', 'Associé cigares', 'associe', `${name}-cig-password`, 'cigares');
  const admin = new Client(server);
  const ger = new Client(server);
  const cig = new Client(server);
  const today = (await admin.login('admin', `${name}-admin-password`)).biz_today;
  const bundle = await ger.login('ger', `${name}-ger-password`);
  await cig.login('cig', `${name}-cig-password`);
  const CIG = ok(await admin.post('/api/products', { category: 'cigare', name: 'Cigare effacé', reference: 'CIG-E', price: 5000 * UM, initial_stock: 20 })).id;
  const m = ok(await ger.post('/api/members', { first_name: 'eva', last_name: 'efface', phone: '00 00 06 01' }));
  ok(await ger.post(`/api/members/${m.id}/subscriptions`, { plan_id: bundle.plans.find((x) => x.code === 'MENSUELLE').id, start_date: today }));
  const r = ok(await ger.post('/api/reservations', { member_id: m.id, room_id: bundle.rooms[0].id, date: today, start_time: '06:00', duration_min: 60 }));
  const line = ok(await ger.post(`/api/reservations/${r.reservation.id}/items`, { product_id: CIG, quantity: 1 }))
    .charges.find((c) => c.status === 'due' && c.kind === 'produit').id;
  ok(await ger.post('/api/payments', { charge_ids: [line], method: 'Espèces' }));
  ok(await ger.post('/api/shop/sales', { account: 'cigares', buyer: { kind: 'journalier' }, lines: [{ product_id: CIG, quantity: 1 }], method: 'Espèces' }));
  ok(await ger.post(`/api/members/${m.id}/wallet/recharge`, { amount: 10000 * UM, method: 'Espèces' }));
  ok(await cig.post(`/api/products/${CIG}/offer`, { quantity: 1, member_id: m.id }));
  const count = (table) => server.club.get(`SELECT COUNT(*) AS n FROM ${table}`).n;
  const brokenLinks = () => server.club.all('PRAGMA foreign_key_check');
  return { server, admin, ger, cig, count, brokenLinks, CIG };
}

test('effacer : rubriques entraînées dans l’ordre de la liste', () => {
  assert.deepEqual(eraseClosure(['seances']), ['encaissements', 'seances']);
  assert.deepEqual(eraseClosure(['produits']), ['encaissements', 'offerts', 'commandes', 'stock', 'produits']);
  assert.deepEqual(eraseClosure(['membres', 'inconnue']), ['encaissements', 'seances', 'commandes', 'membres']);
  assert.deepEqual(eraseClosure([]), []);
});

test('effacer : l’administrateur seul, avec EFFACER et au moins une rubrique', async () => {
  const c = await seeded('droits');
  try {
    refused(await c.ger.post('/api/admin/erase', { groups: ['encaissements'], confirm: 'EFFACER' }), 403);
    refused(await c.cig.post('/api/admin/erase', { groups: ['encaissements'], confirm: 'EFFACER' }), 403);
    refused(await c.admin.post('/api/admin/erase', { groups: ['encaissements'], confirm: 'effacer' }), 400);
    refused(await c.admin.post('/api/admin/erase', { groups: [], confirm: 'EFFACER' }), 400);
    assert.ok(c.count('payments') > 0);
  } finally { c.server.destroy(); }
});

test('effacer les encaissements : l’argent part, le reste reste, l’historique du stock garde ses lignes', async () => {
  const c = await seeded('encaissements');
  try {
    const kept = { products: c.count('products'), members: c.count('members'), reservations: c.count('reservations'), gifts: c.count('gifts'), moves: c.count('stock_movements'), users: c.count('users') };
    const stock = c.server.club.get('SELECT stock_qty FROM products WHERE id = ?', c.CIG).stock_qty;
    assert.deepEqual(ok(await c.admin.post('/api/admin/erase', { groups: ['encaissements'], confirm: 'EFFACER' })).erased, ['encaissements']);
    for (const t of ['payments', 'charges', 'shop_sales', 'wallet_movements', 'payment_allocations', 'ticket_events']) assert.equal(c.count(t), 0, t);
    assert.deepEqual({ products: c.count('products'), members: c.count('members'), reservations: c.count('reservations'), gifts: c.count('gifts'), moves: c.count('stock_movements'), users: c.count('users') }, kept);
    assert.equal(c.server.club.get('SELECT COUNT(*) AS n FROM stock_movements WHERE charge_id IS NOT NULL').n, 0);
    assert.equal(c.server.club.get('SELECT stock_qty FROM products WHERE id = ?', c.CIG).stock_qty, stock);
    assert.deepEqual(c.brokenLinks(), []);
    const entry = ok(await c.admin.get('/api/audit')).find((a) => a.action === 'donnees.effacer_partie');
    assert.deepEqual(entry.details.rubriques, ['encaissements']);
  } finally { c.server.destroy(); }
});

test('effacer les produits ou les membres : leurs rubriques suivent, la base reste cohérente, les comptes restent', async () => {
  for (const group of ['produits', 'membres']) {
    const c = await seeded(`tout-${group}`);
    try {
      const users = c.count('users');
      const r = ok(await c.admin.post('/api/admin/erase', { groups: [group], confirm: 'EFFACER' }));
      assert.deepEqual(r.erased, eraseClosure([group]));
      assert.equal(c.count(group === 'produits' ? 'products' : 'members'), 0);
      assert.ok(c.count(group === 'produits' ? 'members' : 'products') > 0, 'l’autre rubrique reste');
      assert.equal(c.count('users'), users);
      assert.deepEqual(c.brokenLinks(), []);
    } finally { c.server.destroy(); }
  }
});

test('effacer les membres sans les cadeaux : chaque cadeau reste, sans bénéficiaire', async () => {
  const c = await seeded('cadeaux');
  try {
    ok(await c.admin.post('/api/admin/erase', { groups: ['membres'], confirm: 'EFFACER' }));
    assert.equal(c.count('gifts'), 1);
    assert.equal(c.server.club.get('SELECT member_id FROM gifts').member_id, null);
    assert.deepEqual(c.brokenLinks(), []);
  } finally { c.server.destroy(); }
});
