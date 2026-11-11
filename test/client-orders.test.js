// Boutique orders of the client space: an order sets products aside (no stock, no money moved) until the staff turns
// it into the Boutique sale at the counter.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { Server, Client, ok, UM } from './harness.js';

const server = new Server({});
const PASSWORD = 'mon-mot-de-passe-client';
let admin;
let ger;
let cig;
let CIG;
let BTL;
let n = 0;

const stockOf = (id) => server.club.get('SELECT stock_qty FROM products WHERE id = ?', id).stock_qty;
const count = (table) => server.club.get(`SELECT COUNT(*) AS n FROM ${table}`).n;
const refused = (r, status, code) => {
  assert.equal(r.status, status, JSON.stringify(r.data));
  assert.equal(r.data.error.code, code);
};
const newProduct = async (category, stock, price = 5000 * UM) => {
  n += 1;
  return ok(await admin.post('/api/products', { category, name: `Produit ${n}`, reference: `P${n}`, price, initial_stock: stock }));
};
// A regular client or member with a client access, signed in on a client of his own.
async function person(kind = 'client') {
  n += 1;
  const phone = `06 5${String(n).padStart(2, '0')} 00 00`;
  const m = ok(await ger.post(kind === 'client' ? '/api/clients' : '/api/members', { first_name: 'awa', last_name: `commande${n}`, phone }));
  const { code } = ok(await admin.post(`/api/members/${m.id}/client-access`, {}));
  const client = new Client(server);
  ok(await client.post('/api/client/login', { login: m.member_no, password: code }));
  ok(await client.post('/api/client/password', { login: `awa.commande${n}`, new_password: PASSWORD }));
  return { member: m, client };
}
const order = (who, lines, headers) => who.client.post('/api/client/orders', { lines }, headers);

before(async () => {
  await server.start();
  await server.addUser('admin', 'Propriétaire', 'admin', 'ord-admin-password');
  await server.addUser('ger', 'Gérant', 'gerant', 'ord-ger-password');
  await server.addUser('cig', 'Associé cigares', 'associe', 'ord-cig-password', 'cigares');
  admin = new Client(server);
  ger = new Client(server);
  cig = new Client(server);
  await admin.login('admin', 'ord-admin-password');
  await ger.login('ger', 'ord-ger-password');
  await cig.login('cig', 'ord-cig-password');
  CIG = (await newProduct('cigare', 10)).id;
  BTL = (await newProduct('bouteille', 10)).id;
});
after(() => server.destroy());

test('commander met de côté sans toucher au stock', async () => {
  const p = await newProduct('cigare', 5);
  const a = await person();
  const b = await person();
  const movements = count('stock_movements');
  const money = [count('charges'), count('payments'), count('shop_sales')];
  const o = ok(await order(a, [{ product_id: p.id, quantity: 2 }]));
  assert.equal(o.status, 'en_attente');
  assert.equal(o.lines[0].quantity, 2);
  assert.equal(o.lines[0].unit_price, 5000 * UM);
  assert.equal(stockOf(p.id), 5);
  assert.equal(count('stock_movements'), movements);
  assert.deepEqual([count('charges'), count('payments'), count('shop_sales')], money);
  const seen = ok(await b.client.get('/api/client/products')).find((x) => x.id === p.id);
  assert.equal(seen.max_order, 3);
  assert.equal(seen.available, true);
  assert.equal(server.club.heldQuantities().get(p.id), 2);
  assert.equal(server.club.heldQuantities(o.id).get(p.id), undefined);
  assert.ok(server.club.get("SELECT 1 AS x FROM audit_log WHERE action = 'client.commande' AND user_id IS NULL"));
});

test('la dernière bouteille commandée deux fois', async () => {
  const p = await newProduct('bouteille', 1);
  const a = await person();
  const b = await person();
  ok(await order(a, [{ product_id: p.id, quantity: 1 }]));
  refused(await order(b, [{ product_id: p.id, quantity: 1 }]), 409, 'STOCK_INSUFFISANT');
});

test('produit sans stock : indisponible', async () => {
  const p = await newProduct('bouteille', 0);
  const a = await person();
  const seen = ok(await a.client.get('/api/client/products')).find((x) => x.id === p.id);
  assert.equal(seen.available, false);
  assert.equal(seen.max_order, 0);
  const r = await order(a, [{ product_id: p.id, quantity: 1 }]);
  refused(r, 409, 'STOCK_INSUFFISANT');
  assert.match(r.data.error.message, /Il ne reste que 0 « Produit \d+ » disponible\(s\)\./);
});

test('trois commandes ouvertes au plus', async () => {
  const a = await person();
  for (let i = 0; i < 3; i += 1) ok(await order(a, [{ product_id: CIG, quantity: 1 }]));
  refused(await order(a, [{ product_id: CIG, quantity: 1 }]), 409, 'TROP_DE_COMMANDES');
});

test('lignes invalides, produit hors boutique ou inactif', async () => {
  const a = await person();
  const drink = await newProduct('boisson', 5);
  for (const lines of [[], 'x', [{ product_id: CIG, quantity: 0 }], [{ product_id: CIG, quantity: 21 }], [{ product_id: CIG, quantity: 1.5 }], [{ quantity: 1 }]]) {
    assert.equal((await order(a, lines)).status, 400, JSON.stringify(lines));
  }
  assert.equal((await order(a, [{ product_id: drink.id, quantity: 1 }])).status, 404);
  assert.equal((await order(a, [{ product_id: 99999, quantity: 1 }])).status, 404);
  const off = await newProduct('cigare', 5);
  ok(await admin.put(`/api/products/${off.id}`, { active: false }));
  assert.equal((await order(a, [{ product_id: off.id, quantity: 1 }])).status, 409);
  assert.equal(ok(await a.client.get('/api/client/products')).some((x) => x.id === off.id || x.id === drink.id), false);
});

test('le client annule tant que « En attente », pas après « Prête »', async () => {
  const a = await person();
  const o1 = ok(await order(a, [{ product_id: CIG, quantity: 1 }]));
  const c = ok(await a.client.post(`/api/client/orders/${o1.id}/cancel`, {}));
  assert.equal(c.status, 'annulee');
  assert.equal(server.club.get('SELECT cancelled_by_client AS c FROM client_orders WHERE id = ?', o1.id).c, 1);
  refused(await a.client.post(`/api/client/orders/${o1.id}/cancel`, {}), 409, 'COMMANDE_NON_ANNULABLE');
  const o2 = ok(await order(a, [{ product_id: CIG, quantity: 1 }]));
  ok(await ger.post(`/api/orders/${o2.id}/ready`, {}));
  refused(await a.client.post(`/api/client/orders/${o2.id}/cancel`, {}), 409, 'COMMANDE_NON_ANNULABLE');
  assert.ok(server.club.get("SELECT 1 AS x FROM audit_log WHERE action = 'client.commande.annuler' AND user_id IS NULL"));
  assert.ok(server.club.get("SELECT 1 AS x FROM audit_log WHERE action = 'commande.prete'"));
});

test('encaisser une commande à deux rayons : deux ventes puis « Retirée »', async () => {
  const c = await newProduct('cigare', 5);
  const b = await newProduct('bouteille', 5);
  const a = await person();
  const o = ok(await order(a, [{ product_id: c.id, quantity: 2 }, { product_id: b.id, quantity: 1 }]));
  const buyer = { kind: 'client', member_id: a.member.id };
  ok(await ger.post('/api/shop/sales', { account: 'cigares', buyer, lines: [{ product_id: c.id, quantity: 2 }], method: 'Espèces', order_id: o.id }));
  assert.equal(stockOf(c.id), 3);
  assert.equal(stockOf(b.id), 5);
  assert.equal(server.club.get('SELECT status FROM client_orders WHERE id = ?', o.id).status, 'en_attente');
  // The same rayon cannot be sold twice for one order.
  refused(await ger.post('/api/shop/sales', { account: 'cigares', buyer, lines: [{ product_id: c.id, quantity: 1 }], method: 'Espèces', order_id: o.id }), 409, 'COMMANDE_DEJA_ENCAISSEE');
  ok(await ger.post('/api/shop/sales', { account: 'alcool', buyer, lines: [{ product_id: b.id, quantity: 1 }], method: 'Espèces', order_id: o.id }));
  const row = server.club.get('SELECT * FROM client_orders WHERE id = ?', o.id);
  assert.equal(row.status, 'retiree');
  assert.ok(row.closed_at);
  assert.ok(row.closed_by);
  assert.equal(stockOf(b.id), 4);
  assert.equal(server.club.get('SELECT COUNT(*) AS n FROM client_order_sales WHERE order_id = ?', o.id).n, 2);
  const mine = ok(await a.client.get('/api/client/orders')).find((x) => x.id === o.id);
  assert.equal(mine.status, 'retiree');
  assert.deepEqual(mine.lines.map((l) => l.taken), [true, true]);
  // A sale on a closed order is refused.
  refused(await ger.post('/api/shop/sales', { account: 'alcool', buyer, lines: [{ product_id: b.id, quantity: 1 }], method: 'Espèces', order_id: o.id }), 409, 'COMMANDE_CLOTUREE');
});

test('retrait partiel : clôturer après une seule vente libère le reste', async () => {
  const c = await newProduct('cigare', 5);
  const b = await newProduct('bouteille', 5);
  const a = await person();
  const o = ok(await order(a, [{ product_id: c.id, quantity: 1 }, { product_id: b.id, quantity: 2 }]));
  // No sale yet: nothing to close on.
  refused(await ger.post(`/api/orders/${o.id}/close`, {}), 409, 'AUCUNE_VENTE');
  ok(await ger.post('/api/shop/sales', { account: 'cigares', buyer: { kind: 'client', member_id: a.member.id }, lines: [{ product_id: c.id, quantity: 1 }], method: 'Espèces', order_id: o.id }));
  // A sale was made: the order cannot be cancelled any more, only closed.
  refused(await ger.post(`/api/orders/${o.id}/cancel`, { reason: 'Changement d’avis' }), 409, 'COMMANDE_DEJA_ENCAISSEE');
  assert.equal(server.club.heldQuantities().get(b.id), 2);
  const closed = ok(await ger.post(`/api/orders/${o.id}/close`, {}));
  assert.equal(closed.status, 'retiree');
  assert.equal(server.club.heldQuantities().get(b.id) ?? 0, 0);
  const mine = ok(await a.client.get('/api/client/orders')).find((x) => x.id === o.id);
  assert.deepEqual(mine.lines.map((l) => [l.account, l.taken]), [['cigares', true], ['alcool', false]]);
  assert.ok(server.club.get("SELECT 1 AS x FROM audit_log WHERE action = 'commande.cloturer'"));
});

test('vente d’une commande pour un autre acheteur : refusée', async () => {
  const a = await person();
  const b = await person();
  const o = ok(await order(a, [{ product_id: CIG, quantity: 1 }]));
  const sale = (buyer, account = 'cigares') => ger.post('/api/shop/sales', {
    account, buyer, lines: [{ product_id: account === 'cigares' ? CIG : BTL, quantity: 1 }], method: 'Espèces', order_id: o.id,
  });
  const before = [count('shop_sales'), count('payments'), count('client_order_sales')];
  refused(await sale({ kind: 'client', member_id: b.member.id }), 409, 'COMMANDE_AUTRE_ACHETEUR');
  refused(await sale({ kind: 'journalier' }), 409, 'COMMANDE_AUTRE_ACHETEUR');
  // A rayon the order has no line in.
  refused(await sale({ kind: 'client', member_id: a.member.id }, 'alcool'), 409, 'COMMANDE_SANS_RAYON');
  assert.equal((await ger.post('/api/shop/sales', { account: 'cigares', buyer: { kind: 'client', member_id: a.member.id }, lines: [{ product_id: CIG, quantity: 1 }], method: 'Espèces', order_id: 99999 })).status, 404);
  assert.deepEqual([count('shop_sales'), count('payments'), count('client_order_sales')], before);
  assert.equal(server.club.get('SELECT status FROM client_orders WHERE id = ?', o.id).status, 'en_attente');
});

test('B ne voit ni n’annule la commande de A', async () => {
  const a = await person();
  const b = await person();
  const o = ok(await order(a, [{ product_id: CIG, quantity: 1 }]));
  assert.deepEqual(ok(await b.client.get('/api/client/orders')).map((x) => x.id).filter((id) => id === o.id), []);
  const r = await b.client.post(`/api/client/orders/${o.id}/cancel`, {});
  refused(r, 404, 'INTROUVABLE');
  assert.equal(server.club.get('SELECT status FROM client_orders WHERE id = ?', o.id).status, 'en_attente');
  refused(await b.client.post('/api/client/orders/99999/cancel', {}), 404, 'INTROUVABLE');
});

test('réponse produits sans stock exact', async () => {
  const a = await person();
  const list = ok(await a.client.get('/api/client/products'));
  assert.ok(list.length >= 2);
  for (const p of list) {
    assert.deepEqual(Object.keys(p).sort(), ['account', 'available', 'category', 'description', 'id', 'max_order', 'name', 'photo_version', 'price']);
    assert.ok(p.max_order <= 20);
  }
  assert.equal(list.find((p) => p.id === BTL).account, 'alcool');
  assert.equal(list.find((p) => p.id === CIG).account, 'cigares');
  assert.equal(JSON.stringify(list).includes('stock_qty'), false);
});

test('photo d’un produit de la liste : image ; hors liste : 404', async () => {
  const a = await person();
  const drink = await newProduct('boisson', 5);
  assert.equal((await a.client.get(`/api/client/products/${drink.id}/photo`)).status, 404);
  assert.equal((await a.client.get(`/api/client/products/${CIG}/photo`)).status, 404); // listed, but no picture
  const withPhoto = await newProduct('bouteille', 5);
  server.club.storePhoto(withPhoto.id, { mime: 'image/png', bytes: new Uint8Array([1, 2, 3]) }, null);
  const shown = await a.client.get(`/api/client/products/${withPhoto.id}/photo`);
  assert.equal(shown.status, 200);
  assert.equal(shown.headers.get('content-type'), 'image/png');
  assert.ok(ok(await a.client.get('/api/client/products')).find((x) => x.id === withPhoto.id).photo_version);
  assert.equal((await new Client(server).get(`/api/client/products/${CIG}/photo`)).status, 401);
});

test('une commande rejouée avec la même clé ne crée qu’une commande', async () => {
  const a = await person();
  const lines = [{ product_id: CIG, quantity: 1 }];
  const first = await order(a, lines, { 'idempotency-key': 'cle-commande-0001' });
  const again = await order(a, lines, { 'idempotency-key': 'cle-commande-0001' });
  assert.equal(again.status, 200);
  assert.equal(again.headers.get('idempotent-replayed'), 'true');
  assert.deepEqual(again.data, first.data);
  assert.equal(server.club.get('SELECT COUNT(*) AS n FROM client_orders WHERE member_id = ?', a.member.id).n, 1);
  refused(await order(a, [{ product_id: CIG, quantity: 2 }], { 'idempotency-key': 'cle-commande-0001' }), 422, 'CLE_REUTILISEE');
  assert.equal(server.club.get('SELECT COUNT(*) AS n FROM client_orders WHERE member_id = ?', a.member.id).n, 1);
});

test('côté équipe : toutes les commandes ouvertes, compteur par rôle, annulation motivée', async () => {
  const c = await newProduct('cigare', 5);
  const b = await newProduct('bouteille', 5);
  const a = await person();
  const oc = ok(await order(a, [{ product_id: c.id, quantity: 1 }]));
  const ob = ok(await order(a, [{ product_id: b.id, quantity: 1 }]));
  const forGer = ok(await ger.get('/api/orders'));
  const forCig = ok(await cig.get('/api/orders'));
  const ids = (r) => r.orders.map((o) => o.id);
  assert.ok(ids(forCig).includes(oc.id) && ids(forCig).includes(ob.id));
  assert.deepEqual(ids(forGer), ids(forCig));
  assert.deepEqual(forGer.requests, []);
  const open = forGer.orders.length;
  assert.equal(forGer.counts.orders, open);
  assert.equal(ok(await admin.get('/api/orders')).counts.orders, open);
  assert.ok(forCig.counts.orders < open);
  assert.equal(forCig.counts.orders, forCig.orders.filter((o) => o.lines.some((l) => l.account === 'cigares')).length);
  const mine = forGer.orders.find((o) => o.id === oc.id);
  assert.equal(mine.member.id, a.member.id);
  assert.equal(mine.lines[0].stock_qty, 5);
  assert.deepEqual(Object.keys(mine.member).sort(), ['id', 'kind', 'member_no', 'name', 'phone']);
  assert.equal((await ger.post(`/api/orders/${oc.id}/cancel`, { reason: 'ab' })).status, 400);
  assert.equal((await ger.post(`/api/orders/${oc.id}/cancel`, {})).status, 400);
  const cancelled = ok(await ger.post(`/api/orders/${oc.id}/cancel`, { reason: 'Rupture chez le fournisseur' }));
  assert.equal(cancelled.status, 'annulee');
  const theirs = ok(await a.client.get('/api/client/orders')).find((x) => x.id === oc.id);
  assert.equal(theirs.cancel_reason, 'Rupture chez le fournisseur');
  refused(await ger.post(`/api/orders/${oc.id}/ready`, {}), 409, 'COMMANDE_CLOTUREE');
  assert.equal((await new Client(server).get('/api/orders')).status, 401);
  assert.ok(server.club.get("SELECT 1 AS x FROM audit_log WHERE action = 'commande.annuler' AND user_id IS NOT NULL"));
});

test('une commande à moitié encaissée : le rayon vendu ne retient plus de stock, le client ne l’annule plus', async () => {
  const c = await newProduct('cigare', 5);
  const b = await newProduct('bouteille', 5);
  const a = await person();
  const other = await person();
  ok(await order(other, [{ product_id: c.id, quantity: 1 }]));
  const o = ok(await order(a, [{ product_id: c.id, quantity: 2 }, { product_id: b.id, quantity: 1 }]));
  ok(await ger.post('/api/shop/sales', {
    account: 'cigares', buyer: { kind: 'client', member_id: a.member.id }, lines: [{ product_id: c.id, quantity: 2 }], method: 'Espèces', order_id: o.id,
  }));
  assert.equal(stockOf(c.id), 3);
  const list = ok(await other.client.get('/api/client/products'));
  // Real stock 3, minus the other client's hold of 1; the sold lines hold nothing any more.
  assert.equal(list.find((x) => x.id === c.id).max_order, 2);
  assert.equal(list.find((x) => x.id === b.id).max_order, 4);
  assert.equal(server.club.heldQuantities().get(c.id), 1);
  const r = await a.client.post(`/api/client/orders/${o.id}/cancel`, {});
  refused(r, 409, 'COMMANDE_DEJA_ENCAISSEE');
  assert.equal(server.club.get('SELECT status FROM client_orders WHERE id = ?', o.id).status, 'en_attente');
});

test('côté équipe : la liste des produits porte « held » (mis de côté), jamais côté client', async () => {
  const p = await newProduct('cigare', 6);
  const a = await person();
  const heldOf = async () => ok(await ger.get('/api/products')).find((x) => x.id === p.id).held;
  assert.equal(await heldOf(), 0);
  const o = ok(await order(a, [{ product_id: p.id, quantity: 2 }]));
  assert.equal(await heldOf(), 2);
  const clientList = ok(await a.client.get('/api/client/products'));
  assert.equal(JSON.stringify(clientList).includes('held'), false);
  ok(await ger.post(`/api/orders/${o.id}/cancel`, { reason: 'Test' }));
  assert.equal(await heldOf(), 0);
});

test('côté équipe : « encaissé » mène au ticket de la vente (son paiement), pas de ticket pour une vente à crédit', async () => {
  const c = await newProduct('cigare', 5);
  const b = await newProduct('bouteille', 5);
  const a = await person();
  ok(await admin.put(`/api/clients/${a.member.id}/credit-limit`, { credit_limit: 100000 * UM }));
  // A recharge elsewhere takes a payment number and no sale number: the two numbers part.
  const m = ok(await ger.post('/api/members', { first_name: 'paul', last_name: 'decale', phone: '06 599 00 00' }));
  ok(await ger.post(`/api/members/${m.id}/wallet/recharge`, { amount: 1000 * UM, method: 'Espèces' }));
  const buyer = { kind: 'client', member_id: a.member.id };
  const both = [{ product_id: c.id, quantity: 1 }, { product_id: b.id, quantity: 1 }];
  const paid = ok(await order(a, both));
  const cash = ok(await ger.post('/api/shop/sales', { account: 'cigares', buyer, lines: [{ product_id: c.id, quantity: 1 }], method: 'Espèces', order_id: paid.id }));
  assert.notEqual(cash.payment.id, cash.sale.id);
  const onCredit = ok(await order(a, both));
  const credit = ok(await ger.post('/api/shop/sales', { account: 'alcool', buyer, lines: [{ product_id: b.id, quantity: 1 }], credit: true, order_id: onCredit.id }));
  assert.equal(credit.payment ?? null, null);
  const { orders } = ok(await ger.get('/api/orders'));
  const seen = (id) => orders.find((o) => o.id === id);
  assert.deepEqual(seen(paid.id).sales, { cigares: cash.sale.id });
  assert.deepEqual(seen(paid.id).tickets, { cigares: cash.payment.id });
  assert.deepEqual(seen(onCredit.id).sales, { alcool: credit.sale.id });
  assert.deepEqual(seen(onCredit.id).tickets, { alcool: null });
});

// Once a rayon of an order is sold at the counter, the client sees that rayon taken and is no longer offered to cancel
// (the server would refuse it); a fresh order still is.
test('commande à moitié encaissée : côté client, rayon retiré et plus d’annulation proposée', async () => {
  const c = await newProduct('cigare', 5);
  const b = await newProduct('bouteille', 5);
  const a = await person();
  const o = ok(await order(a, [{ product_id: c.id, quantity: 1 }, { product_id: b.id, quantity: 1 }]));
  const view = async () => ok(await a.client.get('/api/client/orders')).find((x) => x.id === o.id);
  const before = await view();
  assert.equal(before.cancellable, true);
  assert.deepEqual(before.lines.map((l) => l.taken), [null, null]);
  ok(await ger.post('/api/shop/sales', {
    account: 'cigares', buyer: { kind: 'client', member_id: a.member.id }, lines: [{ product_id: c.id, quantity: 1 }], method: 'Espèces', order_id: o.id,
  }));
  const half = await view();
  assert.equal(half.status, 'en_attente');
  assert.equal(half.cancellable, false);
  assert.deepEqual(half.lines.map((l) => [l.account, l.taken]), [['cigares', true], ['alcool', null]]);
  ok(await ger.post('/api/shop/sales', {
    account: 'alcool', buyer: { kind: 'client', member_id: a.member.id }, lines: [{ product_id: b.id, quantity: 1 }], method: 'Espèces', order_id: o.id,
  }));
  const done = await view();
  assert.equal(done.status, 'retiree');
  assert.equal(done.cancellable, false);
  assert.deepEqual(done.lines.map((l) => l.taken), [true, true]);
});
