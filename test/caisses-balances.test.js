// The associés' caisses as the server computes them (GET /api/caisses): the cash fund, the card credit, the three
// caisses and the till. The central rule (spec): fund + card credit + the three caisses = till, to the unit, after
// any movement of money.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { addDays } from '../shared/time.js';
import { Server, Client, ok, UM } from './harness.js';

const tiles = (b) => b.fund.amount + b.cards + b.caisses.reservations.balance + b.caisses.alcool.balance + b.caisses.cigares.balance;

// A club with an administrator, a manager, one product of each category and two members on the monthly plan.
async function club(name) {
  const server = new Server({}, { lenientTariffs: true });
  await server.start();
  await server.addUser('admin', 'Propriétaire', 'admin', `${name}-admin-password`);
  await server.addUser('ger', 'Gérant', 'gerant', `${name}-ger-password`);
  const admin = new Client(server);
  const ger = new Client(server);
  const today = (await admin.login('admin', `${name}-admin-password`)).biz_today;
  const bundle = await ger.login('ger', `${name}-ger-password`);
  const product = async (category, reference, price) => ok(await admin.post('/api/products', { category, name: `${reference} test`, reference, price: price * UM, initial_stock: 50 })).id;
  const p = { CHP: await product('bouteille', 'CHP', 20000), DRK: await product('boisson', 'DRK', 10000), CIG: await product('cigare', 'CIG', 5000) };
  const member = async (first_name, phone, start_time) => {
    const m = ok(await ger.post('/api/members', { first_name, last_name: 'Caisses', phone }));
    ok(await ger.post(`/api/members/${m.id}/subscriptions`, { plan_id: bundle.plans.find((x) => x.code === 'MENSUELLE').id, start_date: today }));
    const r = ok(await ger.post('/api/reservations', { member_id: m.id, room_id: bundle.rooms[0].id, date: today, start_time, duration_min: 60 }));
    return { id: m.id, reservation: r.reservation.id };
  };
  const item = async (m, product_id) => ok(await ger.post(`/api/reservations/${m.reservation}/items`, { product_id, quantity: 1 }))
    .charges.filter((c) => c.status === 'due' && c.kind === 'produit').at(-1).id;
  const caisses = async (to) => ok(await admin.get(`/api/caisses${to ? `?to=${to}` : ''}`));
  return { server, admin, ger, today, p, member, item, caisses };
}

test('les six tuiles s’additionnent au franc près', async () => {
  const c = await club('balances');
  const { admin, ger, p } = c;
  const step = async (what) => {
    const b = await c.caisses();
    assert.equal(tiles(b), b.till, `règle centrale (${what})`);
    return b;
  };
  try {
    ok(await admin.post('/api/treasury/fund', { amounts: { 'Espèces': 100000 * UM } }));
    await step('fond');
    const a = await c.member('Ana', '00 00 09 01', '06:00');
    const b = await c.member('Bob', '00 00 09 02', '08:00');
    ok(await ger.post(`/api/members/${a.id}/wallet/recharge`, { amount: 50000 * UM, method: 'Espèces' }));
    await step('approvisionnement');
    ok(await ger.post('/api/payments', { charge_ids: [await c.item(a, p.CHP)], card: true, method: 'Espèces' }));
    await step('champagne payé par carte');
    ok(await ger.post('/api/payments', { charge_ids: [await c.item(a, p.CIG), await c.item(a, p.DRK)], method: 'Espèces' }));
    await step('cigare et autre boisson en espèces');
    // Bob: 10 000 on his card, a champagne of 20 000 paid half by card, then refunded.
    ok(await ger.post(`/api/members/${b.id}/wallet/recharge`, { amount: 10000 * UM, method: 'Espèces' }));
    const half = await c.item(b, p.CHP);
    ok(await ger.post('/api/payments', { charge_ids: [half], card: true, method: 'Espèces' }));
    ok(await admin.post(`/api/charges/${half}/refund`, { reason: 'Bouteille bouchonnée', method: 'Espèces' }));
    await step('remboursement à moitié par carte');
    ok(await ger.post(`/api/members/${b.id}/outside-meal`, { amount: 16000 * UM, label: 'Pizzeria', rest_method: 'MTN MoMo' }));
    await step('repas extérieur');
    const top = ok(await ger.post(`/api/members/${a.id}/wallet/recharge`, { amount: 5000 * UM, method: 'Espèces' })).payment;
    ok(await admin.post(`/api/payments/${top.id}/cancel-recharge`, { reason: 'Erreur de saisie' }));
    await step('approvisionnement annulé');
    const categories = ok(await admin.get('/api/ledger/categories'));
    const cat = (code, name) => categories.find((x) => (code ? x.code === code : x.name === name)).id;
    ok(await admin.post('/api/ledger/entries', { kind: 'depense', category_id: cat('achat_champagne'), account: 'alcool', amount: 12000 * UM, method: 'Espèces' }));
    ok(await admin.post('/api/ledger/entries', { kind: 'depense', category_id: cat(null, 'Loyer'), amount: 15000 * UM, method: 'Espèces' }));
    await step('dépenses');
    ok(await admin.post('/api/ledger/entries', { kind: 'transfert', amount: 3000 * UM, method: 'Espèces', to_method: 'MTN MoMo' }));
    await step('transfert');
    const expected = ok(await admin.get(`/api/treasury?from=${c.today}`)).accounts.find((x) => x.method === 'Espèces').closing;
    ok(await admin.post('/api/treasury/count', { method: 'Espèces', counted: expected + 1000 * UM }));
    const end = await step('comptage');
    assert.equal(end.caisses.alcool.sold_champagne, 20000 * UM);
    assert.equal(end.caisses.alcool.sold_autres, 10000 * UM);
    assert.equal(end.caisses.cigares.sold, 5000 * UM);
    assert.equal(end.caisses.alcool.purchases_champagne, 12000 * UM);
    assert.equal(end.caisses.reservations.expenses, 15000 * UM);
    assert.equal(end.caisses.reservations.apports, 1000 * UM);
    assert.equal(end.caisses.alcool.balance, 18000 * UM);
    assert.equal(end.caisses.cigares.balance, 5000 * UM);
    assert.equal(end.cards, 30000 * UM);
  } finally { c.server.destroy(); }
});

test('crédit des cartes déjà là le jour du fond : le fond le déduit', async () => {
  const c = await club('credit');
  try {
    const a = await c.member('Ana', '00 00 09 03', '06:00');
    c.server.club.at = Date.now() - 24 * 3600 * 1000;
    ok(await c.ger.post(`/api/members/${a.id}/wallet/recharge`, { amount: 40000 * UM, method: 'Espèces' }));
    c.server.club.at = null;
    ok(await c.admin.post('/api/treasury/fund', { amounts: { 'Espèces': 100000 * UM } }));
    const b = await c.caisses();
    assert.equal(b.started, true);
    assert.equal(b.fund.total, 100000 * UM);
    assert.equal(b.fund.card_credit, 40000 * UM);
    assert.equal(b.fund.amount, 60000 * UM);
    assert.equal(b.cards, 40000 * UM);
    assert.equal(tiles(b), b.till);
    // Before the fund, the tracking has not started: nothing to share out.
    const before = await c.caisses(addDays(c.today, -1));
    assert.equal(before.started, false);
    for (const k of ['reservations', 'alcool', 'cigares']) assert.equal(before.caisses[k].balance, 0);
  } finally { c.server.destroy(); }
});

test('une caisse se lit en négatif sans planter', async () => {
  const c = await club('negative');
  try {
    const loyer = c.server.club.get("SELECT id FROM categories WHERE name = 'Loyer'").id;
    c.server.club.run(
      `INSERT INTO ledger_entries (kind, biz_date, category_id, method, amount, label, status, created_at)
       VALUES ('depense', ?, ?, 'Espèces', ?, 'Loyer ancien', 'active', ?)`, c.today, loyer, 5000 * UM, new Date().toISOString(),
    );
    const b = await c.caisses();
    assert.equal(b.caisses.reservations.balance, -5000 * UM);
    assert.equal(tiles(b), b.till);
  } finally { c.server.destroy(); }
});

test('le gérant ne lit pas les caisses', async () => {
  const c = await club('rights');
  try {
    assert.equal((await c.ger.get('/api/caisses')).status, 403);
  } finally { c.server.destroy(); }
});
