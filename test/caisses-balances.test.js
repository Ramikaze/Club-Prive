// The associés' caisses as the server computes them (GET /api/caisses): the cash fund, the card credit, the three
// caisses and the till. The central rule (spec): fund + card credit + the three caisses = till, to the unit, after
// any movement of money.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { addDays } from '../shared/time.js';
import { Server, Client, ok, UM, fundCaisse } from './harness.js';
import { seedDemo } from '../worker/seed.js';

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
    // The rent comes out of Réservation de séance, which holds nothing yet: the associés put money in first.
    await fundCaisse(admin, 'reservations', 20000 * UM);
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
    assert.equal(end.caisses.reservations.apports, 21000 * UM);
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

test('données fictives : les tuiles s’additionnent et aucune caisse n’est sous zéro', async () => {
  const c = await club('fictive');
  try {
    ok(await c.admin.post('/api/admin/reset', { confirm: 'EFFACER' }));
    const author = c.server.club.userRow(ok(await c.admin.get('/api/me')).user.id);
    seedDemo(c.server.club, { actor: author });
    const b = await c.caisses();
    assert.equal(tiles(b), b.till);
    for (const k of ['reservations', 'alcool', 'cigares']) assert.ok(b.caisses[k].balance >= 0, `${k} : ${b.caisses[k].balance}`);
    assert.equal(b.caisses.cigares.taken, 20000 * UM);
    assert.ok(b.caisses.alcool.purchases_autres > 0);
  } finally { c.server.destroy(); }
});

test('données fictives : deux fournisseurs, dont un payé en partie depuis la caisse Cigare', async () => {
  const c = await club('fictive-suppliers');
  try {
    ok(await c.admin.post('/api/admin/reset', { confirm: 'EFFACER' }));
    const author = c.server.club.userRow(ok(await c.admin.get('/api/me')).user.id);
    seedDemo(c.server.club, { actor: author });
    const list = ok(await c.admin.get('/api/suppliers'));
    assert.deepEqual(list.suppliers.map((s) => [s.account, s.currency]).sort(), [['alcool', 'USD'], ['cigares', 'EUR']]);
    const corona = list.suppliers.find((s) => s.account === 'cigares');
    const sheet = ok(await c.admin.get(`/api/suppliers/${corona.id}`));
    assert.deepEqual(sheet.lines.map((l) => [l.kind, l.balance]), [
      ['report', 450000 * UM], ['achat', 750000 * UM], ['paiement', 600000 * UM],
    ]);
    assert.equal(list.totals.cigares, 600000 * UM);
    assert.equal(list.totals.alcool, 520000 * UM);
    const b = await c.caisses();
    assert.equal(tiles(b), b.till);
    for (const k of ['reservations', 'alcool', 'cigares']) assert.ok(b.caisses[k].balance >= 0, `${k} : ${b.caisses[k].balance}`);
  } finally { c.server.destroy(); }
});

test('un repas d’avant le fond ne s’annule plus : son argent est dans le fond', async () => {
  const c = await club('meal');
  try {
    const a = await c.member('Ana', '00 00 09 04', '06:00');
    c.server.club.at = Date.now() - 24 * 3600 * 1000;
    ok(await c.ger.post(`/api/members/${a.id}/wallet/recharge`, { amount: 3000 * UM, method: 'Espèces' }));
    const meal = ok(await c.ger.post(`/api/members/${a.id}/outside-meal`, { amount: 8000 * UM, label: 'Pizzeria', rest_method: 'Espèces' })).payment;
    c.server.club.at = null;
    ok(await c.admin.post('/api/treasury/fund', { amounts: { 'Espèces': 100000 * UM } }));
    const r = await c.admin.post(`/api/payments/${meal.id}/cancel-meal`, { reason: 'Commande annulée' });
    assert.equal(r.status, 409, JSON.stringify(r.data));
    assert.equal(r.data.error.code, 'REPAS_AVANT_FOND');
    const b = await c.caisses();
    assert.equal(tiles(b), b.till);
  } finally { c.server.destroy(); }
});

test('le gérant ne lit pas les caisses', async () => {
  const c = await club('rights');
  try {
    assert.equal((await c.ger.get('/api/caisses')).status, 403);
  } finally { c.server.destroy(); }
});

// A closed month takes no more money: collecting a note or refunding a paid line is refused (409 PERIODE_CLOTUREE)
// and leaves nothing behind, so a closed month's accounts can never change silently. (Cancelling a line not paid yet
// moves no money, only goods back to stock: it is not held by the closing.)
test('mois clôturé : encaissement et remboursement refusés, rien n’est écrit', async () => {
  const c = await club('mois-clos');
  const { admin, ger, p, server } = c;
  const refusedClosed = (r) => {
    assert.equal(r.status, 409, JSON.stringify(r.data));
    assert.equal(r.data.error.code, 'PERIODE_CLOTUREE');
  };
  try {
    ok(await admin.post('/api/treasury/fund', { amounts: { 'Espèces': 100000 * UM } }));
    const a = await c.member('Clo', '00 00 09 05', '06:00');
    const due = await c.item(a, p.CHP);
    const paidLine = await c.item(a, p.CIG);
    ok(await ger.post('/api/payments', { charge_ids: [paidLine], method: 'Espèces' }));
    const rows = () => server.club.get(`SELECT (SELECT COUNT(*) FROM payments) AS payments, (SELECT COUNT(*) FROM refunds) AS refunds,
      (SELECT COUNT(*) FROM payment_allocations) AS allocations, (SELECT group_concat(id || ':' || status) FROM charges) AS charges`);
    const before = { rows: rows(), caisses: await c.caisses() };
    const month = c.today.slice(0, 7);
    server.club.run("INSERT INTO closed_periods (month, closed_at, summary) VALUES (?, ?, '{}')", month, new Date().toISOString());
    try {
      refusedClosed(await ger.post('/api/payments', { charge_ids: [due], method: 'Espèces' }));
      refusedClosed(await admin.post(`/api/charges/${paidLine}/refund`, { reason: 'Cigare abîmé', method: 'Espèces' }));
    } finally {
      server.club.run('DELETE FROM closed_periods WHERE month = ?', month);
    }
    assert.deepEqual(rows(), before.rows);
    assert.deepEqual(await c.caisses(), before.caisses);
  } finally { c.server.destroy(); }
});
