// Caisse figures by category: the Alcool account split into Champagne / Autres boissons, and the billed lines
// listed per column (Réservation séance, Champagne, Autres boissons, Cigare).
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { Server, Client, ok, UM } from './harness.js';

const server = new Server({}, { lenientTariffs: true });
let admin;
let ger;
let cig;
let cha;
let gerant;
let today;
let yesterday;
let bundle;
let CHP;
let DRK;
let CIG;
let n = 0;
let slot = 0;

const FIELDS = ['billed', 'collected', 'refunded', 'net', 'outstanding', 'cancelled', 'lines'];
const refused = (r, status) => assert.equal(r.status, status, JSON.stringify(r.data));
const summary = async (d = today) => ok(await admin.get(`/api/finance/summary?from=${d}`));
const billed = async (d = today) => ok(await admin.get(`/api/finance/billed?from=${d}`));
const alcool = (s) => s.accounts.find((a) => a.account === 'alcool');
const newMember = async () => ok(await ger.post('/api/members', { first_name: 'jean', last_name: `cat${++n}`, phone: `00 00 07 ${String(n).padStart(2, '0')}` }));
// A booking of the member on the note of which the lines can be added (an hour per call, from 06:00).
async function bookSession(member, extra = {}) {
  return ok(await ger.post('/api/reservations', {
    member_id: member.id, room_id: bundle.rooms[0].id, date: today, start_time: `${String(4 + 2 * ++slot).padStart(2, '0')}:00`, duration_min: 60, ...extra,
  }));
}
const subscribe = async (member) => ok(await ger.post(`/api/members/${member.id}/subscriptions`, {
  plan_id: bundle.plans.find((p) => p.code === 'MENSUELLE').id, start_date: today,
}));
const addItem = async (resId, product, quantity = 1) => {
  const d = ok(await ger.post(`/api/reservations/${resId}/items`, { product_id: product, quantity }));
  return d.charges.filter((c) => c.status === 'due' && c.kind === 'produit').at(-1);
};
const pay = async (ids) => ok(await ger.post('/api/payments', { charge_ids: ids, method: 'Espèces' })).payment;
// A member with a plan and a booking, ready to take product lines.
async function session() {
  const m = await newMember();
  await subscribe(m);
  const r = await bookSession(m);
  return { m, resId: r.reservation.id };
}

before(async () => {
  await server.start();
  await server.addUser('admin', 'Propriétaire', 'admin', 'cat-admin-password');
  await server.addUser('ger', 'Gérant', 'gerant', 'cat-ger-password');
  await server.addUser('cig', 'Associé cigares', 'associe', 'cat-cig-password', 'cigares');
  await server.addUser('cha', 'Associé champagne', 'associe', 'cat-cha-password', 'alcool');
  admin = new Client(server);
  ger = new Client(server);
  cig = new Client(server);
  cha = new Client(server);
  today = (await admin.login('admin', 'cat-admin-password')).biz_today;
  bundle = await ger.login('ger', 'cat-ger-password');
  await cig.login('cig', 'cat-cig-password');
  await cha.login('cha', 'cat-cha-password');
  gerant = server.club.userByLogin('ger');
  yesterday = new Date(Date.parse(`${today}T12:00:00Z`) - 86400000).toISOString().slice(0, 10);
  CHP = ok(await admin.post('/api/products', { category: 'bouteille', name: 'Champagne test', reference: 'CHP', price: 20000 * UM, initial_stock: 100 })).id;
  DRK = ok(await admin.post('/api/products', { category: 'boisson', name: 'Boisson test', reference: 'DRK', price: 30000 * UM, initial_stock: 100 })).id;
  CIG = ok(await admin.post('/api/products', { category: 'cigare', name: 'Cigare test', reference: 'CIG', price: 5000 * UM, initial_stock: 400 })).id;
});
after(() => server.destroy());

test('Champagne + Autres boissons = Alcool', async () => {
  const was = await summary();
  const { resId } = await session();
  const chp = await addItem(resId, CHP);
  const d1 = await addItem(resId, DRK);
  const d2 = await addItem(resId, DRK);
  const cg = await addItem(resId, CIG);
  await pay([chp.id, d1.id, d2.id, cg.id]);
  ok(await ger.post('/api/shop/sales', { account: 'alcool', buyer: { kind: 'journalier' }, lines: [{ product_id: CHP, quantity: 1 }], method: 'Espèces' }));
  const now = await summary();
  const a = alcool(now);
  const b = alcool(was);
  assert.equal(a.champagne.collected, b.champagne.collected + 40000 * UM);
  assert.equal(a.autres_boissons.collected, b.autres_boissons.collected + 60000 * UM);
  for (const f of FIELDS) assert.equal(a.champagne[f] + a.autres_boissons[f], a[f], f);
  for (const k of ['reservations', 'cigares']) assert.equal(now.accounts.find((x) => x.account === k).champagne, undefined);
  assert.equal(now.total.champagne, undefined);
});

test('un paiement mêlé : chaque moitié reçoit sa ligne', async () => {
  const was = alcool(await summary());
  const { resId } = await session();
  const chp = await addItem(resId, CHP);
  const drk = await addItem(resId, DRK);
  await pay([chp.id, drk.id]);
  const now = alcool(await summary());
  assert.equal(now.champagne.collected, was.champagne.collected + 20000 * UM);
  assert.equal(now.autres_boissons.collected, was.autres_boissons.collected + 30000 * UM);
});

test('remboursement d’une autre boisson : il sort de « Autres boissons »', async () => {
  const { resId } = await session();
  const drk = await addItem(resId, DRK);
  await pay([drk.id]);
  const was = alcool(await summary());
  ok(await admin.post(`/api/charges/${drk.id}/refund`, { reason: 'Bouteille entamée', method: 'Espèces' }));
  const now = alcool(await summary());
  assert.equal(now.autres_boissons.refunded, was.autres_boissons.refunded + 30000 * UM);
  assert.equal(now.champagne.refunded, was.champagne.refunded);
  assert.equal(now.refunded, was.refunded + 30000 * UM);
});

test('ligne Alcool sans produit : comptée dans Champagne', async () => {
  const was = alcool(await summary());
  const m = await newMember();
  const id = server.club.tx(() => server.club.insertCharge(gerant, {
    account: 'alcool', kind: 'produit', member_id: m.id, label: 'Ancienne ligne', quantity: 1, unit_price: 1000 * UM,
  }));
  await pay([id]);
  const now = alcool(await summary());
  assert.equal(now.champagne.collected, was.champagne.collected + 1000 * UM);
  assert.equal(now.autres_boissons.collected, was.autres_boissons.collected);
  assert.ok((await billed()).columns.champagne.lines.some((l) => l.charge_id === id));
});

test('liste des lignes facturées : chaque ligne dans sa colonne', async () => {
  const plan = bundle.plans.find((p) => p.code === 'MENSUELLE');
  const { m, resId } = await session();
  const drk = await addItem(resId, DRK);
  const cg = await addItem(resId, CIG);
  ok(await ger.post(`/api/charges/${cg.id}/cancel`, { reason: 'Erreur de saisie' }));
  // A member without plan, the booking paid with the card.
  const payer = await newMember();
  ok(await ger.post(`/api/members/${payer.id}/wallet/recharge`, { amount: 100000 * UM, method: 'Espèces' }));
  const booked = await bookSession(payer, { pay_with_card: true });
  const sale = ok(await ger.post('/api/shop/sales', { account: 'alcool', buyer: { kind: 'journalier' }, lines: [{ product_id: CHP, quantity: 1 }], method: 'Espèces' }));
  const cols = (await billed()).columns;
  const dr = cols.autres_boissons.lines.find((l) => l.charge_id === drk.id);
  assert.equal(dr.status, 'due');
  assert.equal(dr.payment_id, null);
  assert.equal(dr.ticket_number, null);
  assert.equal(dr.reservation_id, resId);
  assert.equal(dr.kind, 'produit');
  assert.equal(dr.member_id, m.id);
  assert.equal(cols.cigares.lines.find((l) => l.charge_id === cg.id).status, 'annulee');
  const abo = cols.reservations.lines.find((l) => l.member_id === m.id && l.kind === 'abonnement');
  assert.equal(abo.plan_name, plan.name);
  const time = cols.reservations.lines.find((l) => l.reservation_id === booked.reservation.id && l.kind === 'temps_supplementaire');
  assert.equal(time.plan_name, null);
  assert.equal(time.room_name, bundle.rooms[0].name);
  const shop = cols.champagne.lines.find((l) => l.shop_sale_id === sale.sale.id);
  assert.match(shop.ticket_number, /^T-\d+$/);
  assert.equal(shop.status, 'payee');
  for (const c of Object.values(cols)) assert.ok(c.count >= c.lines.length);
});

test('client journalier sans donnée personnelle dans les colonnes', async () => {
  const sale = ok(await ger.post('/api/shop/sales', { account: 'alcool', buyer: { kind: 'journalier' }, lines: [{ product_id: CHP, quantity: 1 }], method: 'Espèces' }));
  const l = (await billed()).columns.champagne.lines.find((x) => x.shop_sale_id === sale.sale.id);
  assert.equal(l.member_id, null);
  assert.equal(l.member_name, 'Client journalier');
  assert.equal(l.member_no, null);
});

test('dates : la liste suit la facturation, la recette suit l’encaissement', async () => {
  const { resId } = await session();
  const drk = await addItem(resId, DRK);
  const old = new Date(Date.parse(`${yesterday}T12:00:00Z`)).toISOString();
  server.club.run('UPDATE charges SET created_at = ? WHERE id = ?', old, drk.id);
  const y = (await billed(yesterday)).columns.autres_boissons.lines.find((l) => l.charge_id === drk.id);
  assert.equal(y.status, 'due');
  assert.ok(!(await billed(today)).columns.autres_boissons.lines.some((l) => l.charge_id === drk.id));
  const todayWas = alcool(await summary()).autres_boissons.collected;
  const yWas = alcool(await summary(yesterday)).autres_boissons.collected;
  await pay([drk.id]);
  assert.equal(alcool(await summary()).autres_boissons.collected, todayWas + 30000 * UM);
  assert.equal(alcool(await summary(yesterday)).autres_boissons.collected, yWas);
  assert.equal((await billed(yesterday)).columns.autres_boissons.lines.find((l) => l.charge_id === drk.id).status, 'payee');
});

test('le gérant n’a pas les colonnes de la caisse', async () => {
  refused(await ger.get(`/api/finance/billed?from=${today}`), 403);
  ok(await cig.get(`/api/finance/billed?from=${today}`));
  ok(await cha.get(`/api/finance/billed?from=${today}`));
});

test('période longue : 200 lignes au plus par colonne, les plus récentes', async () => {
  const m = await newMember();
  let last;
  server.club.tx(() => {
    for (let i = 0; i < 205; i += 1) {
      last = server.club.insertCharge(gerant, { account: 'cigares', kind: 'produit', member_id: m.id, label: 'Cigare', quantity: 1, unit_price: 1000 * UM });
    }
  });
  const cols = (await billed()).columns;
  assert.ok(cols.cigares.count >= 205);
  assert.equal(cols.cigares.lines.length, 200);
  assert.equal(cols.cigares.truncated, true);
  assert.equal(cols.cigares.lines[0].charge_id, last);
  assert.equal(cols.reservations.truncated, false);
});
