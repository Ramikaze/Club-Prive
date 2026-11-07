// No caisse ever goes below zero (owner's rules, 2026-11-07): a supplier is paid only up to what the caisse holds,
// and every operation that lowers a caisse (an expense, the gérant's too, a refund, the cancellation of an apport,
// a shortage found counting the till) is refused when the caisse cannot cover it. An apport goes into the caisse
// chosen; a purchase always pays from the caisse of its category.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { Server, Client, ok, UM, fundCaisse } from './harness.js';

const server = new Server({}, { lenientTariffs: true });
let admin;
let cha;
let ger;
let today;
let categories;
let BTL;

const refused = (r, status, code) => {
  assert.equal(r.status, status, JSON.stringify(r.data));
  if (code) assert.equal(r.data.error.code, code);
  return r;
};
const caisses = async () => ok(await admin.get('/api/caisses'));
const cat = (code, name) => categories.find((c) => (code ? c.code === code : c.name === name)).id;
const expense = (who, body) => who.post('/api/ledger/entries', { kind: 'depense', method: 'Espèces', ...body });
const stockOf = (id) => server.club.get('SELECT stock_qty FROM products WHERE id = ?', id).stock_qty;

before(async () => {
  await server.start();
  await server.addUser('admin', 'Propriétaire', 'admin', 'rules-admin-password');
  await server.addUser('cha', 'Associé champagne', 'associe', 'rules-cha-password', 'alcool');
  await server.addUser('ger', 'Gérant', 'gerant', 'rules-ger-password');
  admin = new Client(server);
  cha = new Client(server);
  ger = new Client(server);
  today = (await admin.login('admin', 'rules-admin-password')).biz_today;
  await cha.login('cha', 'rules-cha-password');
  await ger.login('ger', 'rules-ger-password');
  categories = ok(await admin.get('/api/ledger/categories'));
  const CIG = ok(await admin.post('/api/products', { category: 'cigare', name: 'Cigare test', reference: 'CIG', price: 50000 * UM, initial_stock: 10 })).id;
  BTL = ok(await admin.post('/api/products', { category: 'bouteille', name: 'Champagne test', reference: 'BTL', price: 20000 * UM, initial_stock: 10 })).id;
  ok(await ger.post('/api/shop/sales', { account: 'cigares', buyer: { kind: 'journalier' }, lines: [{ product_id: CIG, quantity: 1 }], method: 'Espèces' }));
});
after(() => server.destroy());

test('payer un fournisseur : jamais plus que la caisse, et toujours de la bonne caisse', async () => {
  const r = refused(await expense(admin, { category_id: cat('achat_cigares'), amount: 60000 * UM }), 409, 'CAISSE_INSUFFISANTE');
  assert.equal(r.data.error.details.balance, 50000 * UM);
  const e = ok(await expense(admin, { category_id: cat('achat_cigares'), amount: 50000 * UM, account: 'alcool' }));
  assert.equal(e.account, 'cigares');
  assert.equal((await caisses()).caisses.cigares.balance, 0);
});

test('dépense du gérant refusée quand Réservation de séance est vide', async () => {
  refused(await expense(ger, { category_id: cat(null, 'Divers'), amount: 2000 * UM }), 409, 'CAISSE_INSUFFISANTE');
  await fundCaisse(admin, 'reservations', 10000 * UM);
  ok(await expense(ger, { category_id: cat(null, 'Divers'), amount: 2000 * UM }));
});

test('apport dans la caisse choisie ; son annulation refusée une fois l’argent parti', async () => {
  const apport = await fundCaisse(admin, 'alcool', 30000 * UM);
  assert.equal(apport.account, 'alcool');
  assert.equal((await caisses()).caisses.alcool.apports, 30000 * UM);
  const e = ok(await expense(admin, { category_id: cat('achat_champagne'), amount: 30000 * UM }));
  refused(await admin.post(`/api/ledger/entries/${apport.id}/cancel`, { reason: 'Erreur' }), 409, 'CAISSE_INSUFFISANTE');
  ok(await admin.post(`/api/ledger/entries/${e.id}/cancel`, { reason: 'Facture annulée' }));
  ok(await admin.post(`/api/ledger/entries/${apport.id}/cancel`, { reason: 'Erreur' }));
});

test('remboursement refusé quand la caisse de la vente est vide', async () => {
  const r = ok(await ger.post('/api/shop/sales', { account: 'alcool', buyer: { kind: 'journalier' }, lines: [{ product_id: BTL, quantity: 1 }], method: 'Espèces' }));
  const balance = (await caisses()).caisses.alcool.balance;
  ok(await cha.post('/api/caisses/retrait', { account: 'alcool', amount: balance, method: 'Espèces' }));
  const stock = stockOf(BTL);
  refused(await cha.post(`/api/shop/sales/${r.sale.id}/cancel`, { reason: 'Erreur de produit' }), 409, 'CAISSE_INSUFFISANTE');
  assert.equal(stockOf(BTL), stock);
  assert.equal(server.club.get('SELECT cancelled_at FROM shop_sales WHERE id = ?', r.sale.id).cancelled_at, null);
});

test('comptage et fermeture : un manque plus grand que Réservation de séance est refusé', async () => {
  const s = new Server({});
  await s.start();
  await s.addUser('admin', 'Propriétaire', 'admin', 'rules-count-password');
  const a = new Client(s);
  const day = (await a.login('admin', 'rules-count-password')).biz_today;
  try {
    ok(await a.post('/api/treasury/fund', { amounts: { 'Espèces': 100000 * UM } }));
    const expected = async () => ok(await a.get(`/api/treasury?from=${day}`)).accounts.find((x) => x.method === 'Espèces').closing;
    refused(await a.post('/api/treasury/count', { method: 'Espèces', counted: (await expected()) - 10000 * UM }), 409, 'CAISSE_INSUFFISANTE');
    refused(await a.post('/api/day-closing', {
      day, checked: [], unchecked_reason: 'Contrôle', counts: { 'Espèces': (await expected()) - 10000 * UM }, gap_reason: 'Manque',
    }), 409, 'CAISSE_INSUFFISANTE');
    await fundCaisse(a, 'reservations', 10000 * UM);
    ok(await a.post('/api/treasury/count', { method: 'Espèces', counted: (await expected()) - 10000 * UM }));
  } finally { s.destroy(); }
});
