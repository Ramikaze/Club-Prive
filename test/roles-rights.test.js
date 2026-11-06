// Rights of the associé: « gestion du club » opens to him (and stays closed to the manager), « administration de
// l'application » stays the administrator's, and product files, photos and stock follow his rayon.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { Server, Client, ok, UM } from './harness.js';

const server = new Server({});
let admin;
let cig;
let cha;
let ger;
let today;
let yesterday;

const refused = (r, status) => assert.equal(r.status, status, JSON.stringify(r.data));

before(async () => {
  await server.start();
  await server.addUser('admin', 'Admin', 'admin', 'rights-admin-password');
  await server.addUser('cig', 'Associé cigares', 'associe', 'rights-cig-password', 'cigares');
  await server.addUser('cha', 'Associé champagne', 'associe', 'rights-cha-password', 'alcool');
  await server.addUser('ger', 'Gérant', 'gerant', 'rights-ger-password');
  admin = new Client(server);
  cig = new Client(server);
  cha = new Client(server);
  ger = new Client(server);
  today = (await admin.login('admin', 'rights-admin-password')).biz_today;
  await cig.login('cig', 'rights-cig-password');
  await cha.login('cha', 'rights-cha-password');
  await ger.login('ger', 'rights-ger-password');
  yesterday = server.club.bizDayOf(Date.parse(`${today}T12:00:00Z`) - 86400000);
});
after(() => server.destroy());

// A picture of `size` bytes: the signature of a JPEG, then a fill. Gives the request body.
function picture(size = 600) {
  const bytes = new Uint8Array(size).fill(7);
  bytes.set([0xff, 0xd8, 0xff, 0xe0]);
  return { mime: 'image/jpeg', data: Buffer.from(bytes).toString('base64') };
}

let seq = 0;
const newProduct = async (client, category, extra = {}) => {
  seq += 1;
  return ok(await client.post('/api/products', {
    category, name: `Produit ${seq}`, reference: `R-${category}-${seq}`, price: 10000 * UM, ...extra,
  }));
};

test('l’associé gère le club mais pas l’application', async () => {
  for (const url of ['/api/audit', `/api/treasury?from=${today}`, `/api/ledger/book?from=${today}`, '/api/closings',
    '/api/ticket-events', `/api/finance/summary?from=${today}`]) ok(await cig.get(url));
  refused(await cig.get('/api/users'), 403);
  refused(await cig.put('/api/settings', {}), 403);
  refused(await cig.post('/api/treasury/fund', { amounts: {} }), 403);
  refused(await cig.post('/api/rooms', { name: 'Salle X' }), 403);
  refused(await cig.post('/api/ledger/categories', { kind: 'depense', name: 'Autre' }), 403);
  refused(await ger.get('/api/audit'), 403);
  refused(await ger.get(`/api/treasury?from=${today}`), 403);
});

test('chacun son rayon pour les fiches produits', async () => {
  const cigar = await newProduct(cig, 'cigare');
  refused(await cig.post('/api/products', { category: 'bouteille', name: 'Refusée', reference: 'R-REF-1', price: 1000 * UM }), 403);
  const bottle = await newProduct(admin, 'bouteille');
  refused(await cig.put(`/api/products/${bottle.id}`, { price: 5000 * UM }), 403);
  // Moving his own cigar into the other rayon is refused too.
  refused(await cig.put(`/api/products/${cigar.id}`, { category: 'bouteille' }), 403);
  ok(await cha.put(`/api/products/${bottle.id}`, { price: 5000 * UM }));
  ok(await admin.put(`/api/products/${bottle.id}`, { price: 6000 * UM }));
  ok(await admin.put(`/api/products/${cigar.id}`, { price: 6000 * UM }));
  await newProduct(admin, 'bouteille');
  refused(await ger.post('/api/products', { category: 'cigare', name: 'X', reference: 'R-G-1', price: 1 }), 403);
});

test('le stock et la photo suivent le rayon, en hausse comme en baisse', async () => {
  const p = await newProduct(admin, 'cigare', { initial_stock: 10 });
  const s = p.stock_qty;
  const stock = (client, body) => client.post(`/api/products/${p.id}/stock`, body);
  const adjust = (client, target) => stock(client, { kind: 'ajustement', target_qty: target, expected_qty: s, reason: 'Inventaire' });
  const current = () => server.club.get('SELECT stock_qty FROM products WHERE id = ?', p.id).stock_qty;
  // The other rayon: nothing moves, nor the photo.
  refused(await stock(cha, { kind: 'entree', quantity: 5 }), 403);
  refused(await adjust(cha, s + 2), 403);
  refused(await adjust(cha, s - 1), 403);
  refused(await cha.put(`/api/products/${p.id}/photo`, picture()), 403);
  refused(await cha.del(`/api/products/${p.id}/photo`), 403);
  assert.equal(current(), s);
  // His own rayon.
  ok(await stock(cig, { kind: 'entree', quantity: 5 }));
  assert.equal(current(), s + 5);
  ok(await stock(cig, { kind: 'ajustement', target_qty: s + 7, expected_qty: s + 5, reason: 'Inventaire' }));
  ok(await stock(cig, { kind: 'ajustement', target_qty: s + 6, expected_qty: s + 7, reason: 'Casse' }));
  assert.equal(current(), s + 6);
  ok(await cig.put(`/api/products/${p.id}/photo`, picture()));
  ok(await cig.del(`/api/products/${p.id}/photo`));
  // The manager keeps today's rights: entries and increases only, no photo.
  const n = s + 6;
  ok(await stock(ger, { kind: 'entree', quantity: 1 }));
  ok(await stock(ger, { kind: 'ajustement', target_qty: n + 3, expected_qty: n + 1, reason: 'Recompté' }));
  refused(await stock(ger, { kind: 'ajustement', target_qty: n, expected_qty: n + 3, reason: 'Casse' }), 403);
  refused(await ger.put(`/api/products/${p.id}/photo`, picture()), 403);
});

test('l’associé enregistre une dépense sans plafond ni date imposée', async () => {
  const cat = ok(await cig.get('/api/ledger/categories'))
    .find((c) => c.kind === 'depense' && c.active && c.name !== 'Écart de caisse' && c.name !== 'Avance repas client');
  const body = { kind: 'depense', category_id: cat.id, method: 'Espèces', amount: 20000 * UM, biz_date: yesterday };
  ok(await cig.post('/api/ledger/entries', body));
  // The manager is held to the cap and to the day, as before.
  refused(await ger.post('/api/ledger/entries', body), 403);
  refused(await ger.post('/api/ledger/entries', { ...body, biz_date: today }), 403);
  ok(await cig.get(`/api/ledger/entries?from=${yesterday}&to=${today}`));
});

test('l’associé rembourse même quand les remboursements sont réservés', async () => {
  ok(await admin.put('/api/settings', { refunds_admin_only: true }));
  const member = ok(await ger.post('/api/members', { first_name: 'Rayon', last_name: 'Test', phone: '+000 00 00 00 00' }));
  const gerant = server.club.userByLogin('ger');
  const bottleLine = () => server.club.tx(() => server.club.insertCharge(gerant, {
    account: 'alcool', kind: 'produit', member_id: member.id, label: 'Champagne', quantity: 1, unit_price: 20000 * UM,
  }));
  const paid = bottleLine();
  ok(await ger.post('/api/payments', { charge_ids: [paid], method: 'Espèces' }));
  // The line is a bottle, the rayon of cha: sessions have no rayon limit, so cig refunds it.
  refused(await ger.post(`/api/charges/${paid}/refund`, { reason: 'Bouchonnée', method: 'Espèces' }), 403);
  ok(await cig.post(`/api/charges/${paid}/refund`, { reason: 'Bouchonnée', method: 'Espèces' }));
  const due = bottleLine();
  ok(await cig.post(`/api/charges/${due}/cancel`, { reason: 'Erreur de saisie' }));
});
