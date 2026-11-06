// Caisse figures: the Séances / Boutique split of the Caisse tab and the Boutique tab's own figures.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { Server, Client, ok, UM } from './harness.js';

const server = new Server({});
let admin;
let ger;
let cig;
let cha;
let today;
let yesterday;
let CIG;
let BTL;

const refused = (r, status) => assert.equal(r.status, status, JSON.stringify(r.data));
const sale = (who, body) => who.post('/api/shop/sales', body);
const summary = async (from = today, to = from) => ok(await admin.get(`/api/finance/summary?from=${from}&to=${to}`));
const shop = async (from = today, to = from) => ok(await admin.get(`/api/shop/summary?from=${from}&to=${to}`));
const FIELDS = ['billed', 'collected', 'refunded', 'net', 'outstanding', 'cancelled', 'lines'];
let n = 0;
const newMember = async () => ok(await ger.post('/api/members', { first_name: 'jean', last_name: `membre${++n}`, phone: `00 00 05 ${String(n).padStart(2, '0')}` }));
const dayBefore = (iso) => new Date(Date.parse(iso) - 86400000).toISOString();

before(async () => {
  await server.start();
  await server.addUser('admin', 'Propriétaire', 'admin', 'fin-admin-password');
  await server.addUser('ger', 'Gérant', 'gerant', 'fin-ger-password');
  await server.addUser('cig', 'Associé cigares', 'associe', 'fin-cig-password', 'cigares');
  await server.addUser('cha', 'Associé champagne', 'associe', 'fin-cha-password', 'alcool');
  admin = new Client(server);
  ger = new Client(server);
  cig = new Client(server);
  cha = new Client(server);
  today = (await admin.login('admin', 'fin-admin-password')).biz_today;
  yesterday = dayBefore(`${today}T12:00:00Z`).slice(0, 10);
  await ger.login('ger', 'fin-ger-password');
  await cig.login('cig', 'fin-cig-password');
  await cha.login('cha', 'fin-cha-password');
  CIG = ok(await admin.post('/api/products', { category: 'cigare', name: 'Cigare test', reference: 'CIG', price: 5000 * UM, initial_stock: 50 })).id;
  BTL = ok(await admin.post('/api/products', { category: 'bouteille', name: 'Bouteille test', reference: 'BTL', price: 20000 * UM, initial_stock: 50 })).id;
});
after(() => server.destroy());

test('une vente Boutique ne change pas les chiffres des séances', async () => {
  const before = await summary();
  const r = ok(await sale(ger, { account: 'cigares', buyer: { kind: 'journalier' }, lines: [{ product_id: CIG, quantity: 2 }], method: 'Espèces' }));
  assert.equal(r.sale.amount, 10000 * UM);
  const after = await summary();
  for (const k of ['reservations', 'alcool', 'cigares']) {
    const was = before.accounts.find((x) => x.account === k);
    const now = after.accounts.find((x) => x.account === k);
    assert.deepEqual(now.seances, was.seances);
  }
  const cg = after.accounts.find((x) => x.account === 'cigares');
  const cgBefore = before.accounts.find((x) => x.account === 'cigares');
  assert.equal(cg.boutique.collected, 10000 * UM);
  assert.equal(cg.boutique.billed, 10000 * UM);
  assert.equal(cg.boutique.lines, 1);
  assert.equal(cg.collected, cgBefore.collected + 10000 * UM);
  // Existing keys are all still there, and seances + boutique is each figure, per account and in the total.
  for (const x of [...after.accounts, after.total]) {
    for (const f of FIELDS) assert.equal(x.seances[f] + x.boutique[f], x[f], `${x.account}.${f}`);
  }
  assert.deepEqual(Object.keys(after.accounts[0]).slice(0, 10), ['account', 'label', 'billed', 'collected', 'refunded', 'net', 'outstanding', 'cancelled', 'lines', 'seances']);
});

test('onglet Boutique : par acheteur et par moyen de paiement', async () => {
  const base = await shop();
  const m = await newMember();
  ok(await ger.post(`/api/members/${m.id}/wallet/recharge`, { amount: 20000 * UM, method: 'Espèces' }));
  ok(await sale(ger, { account: 'alcool', buyer: { kind: 'journalier' }, lines: [{ product_id: BTL, quantity: 1 }], method: 'Espèces' }));
  ok(await sale(ger, { account: 'alcool', buyer: { kind: 'membre', member_id: m.id }, lines: [{ product_id: BTL, quantity: 1 }], card: true, method: 'Espèces' }));
  const out = await shop();
  const col = out.accounts.alcool;
  const was = base.accounts.alcool;
  assert.equal(col.total, was.total + 40000 * UM);
  assert.equal(col.count, was.count + 2);
  assert.equal(col.by_buyer.journalier, was.by_buyer.journalier + 20000 * UM);
  assert.equal(col.by_buyer.membre, was.by_buyer.membre + 20000 * UM);
  assert.equal(col.by_buyer.client, 0);
  const meth = (c, name) => c.by_method.find((x) => x.method === name)?.total ?? 0;
  assert.equal(meth(col, 'Espèces'), meth(was, 'Espèces') + 20000 * UM);
  assert.equal(meth(col, 'Carte membre'), meth(was, 'Carte membre') + 20000 * UM);
  assert.equal(col.sales.length, was.sales.length + 2);
  assert.equal(col.by_method.reduce((s, x) => s + x.total, 0), col.total);
  // The other column is untouched, and the Caisse tab carries the same Boutique sales.
  assert.equal(out.accounts.cigares.total, base.accounts.cigares.total);
  assert.equal(out.accounts.cigares.total, 10000 * UM);
});

test('annulée le jour même : la vente reste listée et compte 0', async () => {
  const base = (await shop()).accounts.cigares;
  const r = ok(await sale(ger, { account: 'cigares', buyer: { kind: 'journalier' }, lines: [{ product_id: CIG, quantity: 1 }], method: 'Espèces' }));
  const mid = (await shop()).accounts.cigares;
  assert.equal(mid.total, base.total + 5000 * UM);
  ok(await cig.post(`/api/shop/sales/${r.sale.id}/cancel`, { reason: 'Erreur de produit' }));
  const col = (await shop()).accounts.cigares;
  assert.equal(col.total, base.total);
  assert.equal(col.count, base.count);
  const listed = col.sales.find((s) => s.id === r.sale.id);
  assert.ok(listed.cancelled_at);
  const c = col.cancellations.find((x) => x.sale_id === r.sale.id);
  assert.equal(c.amount, 5000 * UM);
  assert.equal(c.reason, 'Erreur de produit');
  assert.equal(c.cancelled_by_name, 'Associé cigares');
  assert.equal(c.ticket_number, listed.ticket_number);
  assert.equal(col.by_buyer.journalier, base.by_buyer.journalier);
  assert.equal(col.by_method.find((x) => x.method === 'Espèces').total, base.by_method.find((x) => x.method === 'Espèces').total);
  // The Caisse tab agrees: the sale and its refund both sit on today in the Boutique part.
  const f = (await summary()).accounts.find((x) => x.account === 'cigares');
  assert.equal(f.boutique.net, col.total);
  assert.equal(f.boutique.refunded, 5000 * UM);
});

test('annulée un autre jour : la vente reste dans sa période, l’argent sort le jour de l’annulation', async () => {
  const r = ok(await sale(ger, { account: 'alcool', buyer: { kind: 'journalier' }, lines: [{ product_id: BTL, quantity: 3 }], method: 'Espèces' }));
  const amount = 60000 * UM;
  assert.equal(r.sale.amount, amount);
  const baseY = (await shop(yesterday)).accounts.alcool;
  const baseT = (await shop()).accounts.alcool;
  const finY = (await summary(yesterday)).accounts.find((x) => x.account === 'alcool');
  // Move the sale (and its money) to yesterday, as if it had been made then.
  const sc = server.club.get('SELECT created_at FROM shop_sales WHERE id = ?', r.sale.id).created_at;
  server.club.run('UPDATE shop_sales SET created_at = ? WHERE id = ?', dayBefore(sc), r.sale.id);
  server.club.run('UPDATE payments SET paid_at = ? WHERE id = ?', dayBefore(sc), r.payment.id);
  server.club.run('UPDATE charges SET created_at = ? WHERE shop_sale_id = ?', dayBefore(sc), r.sale.id);
  let y = (await shop(yesterday)).accounts.alcool;
  assert.equal(y.total, baseY.total + amount);
  assert.equal((await shop()).accounts.alcool.total, baseT.total - amount);
  ok(await cha.post(`/api/shop/sales/${r.sale.id}/cancel`, { reason: 'Client parti' }));
  y = (await shop(yesterday)).accounts.alcool;
  assert.equal(y.total, baseY.total + amount, 'yesterday does not change after the fact');
  assert.equal(y.count, baseY.count + 1);
  assert.ok(y.sales.find((s) => s.id === r.sale.id).cancelled_at);
  assert.equal(y.cancellations.length, 0);
  const t = (await shop()).accounts.alcool;
  // baseT still held the sale: it left today by the move, and the money goes out today by the refund.
  assert.equal(t.total, baseT.total - 2 * amount);
  assert.equal(t.by_buyer.journalier, baseT.by_buyer.journalier - 2 * amount);
  assert.equal(t.by_method.find((x) => x.method === 'Espèces').total, baseT.by_method.find((x) => x.method === 'Espèces').total - 2 * amount);
  assert.equal(t.cancellations.find((x) => x.sale_id === r.sale.id).amount, amount);
  assert.equal(t.count, baseT.count - 1, 'the sale moved out of today and its cancellation adds no sale');
  // Same days in the Caisse tab: yesterday still shows the money in, today the money out.
  const fy = (await summary(yesterday)).accounts.find((x) => x.account === 'alcool');
  assert.equal(fy.boutique.collected, finY.boutique.collected + amount);
  assert.equal(fy.boutique.refunded, finY.boutique.refunded);
  const ft = (await summary()).accounts.find((x) => x.account === 'alcool');
  assert.equal(ft.boutique.refunded >= amount, true);
  // A two-day period holds both and nets to zero for this sale.
  const both = (await shop(yesterday, today)).accounts.alcool;
  assert.equal(both.total, baseY.total + baseT.total - amount);
});

test('le gérant n’a pas l’onglet Boutique de la caisse', async () => {
  refused(await ger.get(`/api/shop/summary?from=${today}`), 403);
  const a = ok(await cig.get(`/api/shop/summary?from=${today}`));
  ok(await cha.get(`/api/shop/summary?from=${today}`));
  assert.deepEqual(Object.keys(a.accounts).sort(), ['alcool', 'cigares']);
  refused(await admin.get('/api/shop/summary?from=nope'), 400);
});
