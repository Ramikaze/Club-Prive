// Credit of the regular clients (spec docs/superpowers/specs/2026-11-07-credit-clients-design.md): the limit, credit
// sales at the Boutique, settlements paying the oldest purchases first (the last one in part), their cancellation, the
// cancellation of a credit sale, the client's account and the caisses, which only see money actually received.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { Server, Client, ok, UM } from './harness.js';

const server = new Server({});
let admin;
let ger;
let cha;
let CHP;
let CIG;
let today;

const tiles = (b) => b.fund.amount + b.cards + b.caisses.reservations.balance + b.caisses.alcool.balance + b.caisses.cigares.balance;
const refused = (r, status, code) => {
  assert.equal(r.status, status, JSON.stringify(r.data));
  if (code) assert.equal(r.data.error.code, code);
};
const stockOf = (id) => server.club.get('SELECT stock_qty FROM products WHERE id = ?', id).stock_qty;
let n = 0;
const newClient = async () => ok(await ger.post('/api/clients', { first_name: 'awa', last_name: `credit${++n}`, phone: `00 00 07 ${String(n).padStart(2, '0')}` }));
const creditSale = (who, client, account, product_id, quantity) => who.post('/api/shop/sales', {
  account, buyer: { kind: 'client', member_id: client.id }, lines: [{ product_id, quantity }], credit: true,
});
const account = async (client) => ok(await ger.get(`/api/clients/${client.id}/account`));
const caisses = async () => ok(await admin.get('/api/caisses'));
const centralRule = async (what) => {
  const b = await caisses();
  assert.equal(tiles(b), b.till, `règle centrale (${what})`);
  return b;
};

before(async () => {
  await server.start();
  await server.addUser('admin', 'Propriétaire', 'admin', 'credit-admin-password');
  await server.addUser('ger', 'Gérant', 'gerant', 'credit-ger-password');
  await server.addUser('cha', 'Associé champagne', 'associe', 'credit-cha-password', 'alcool');
  admin = new Client(server);
  ger = new Client(server);
  cha = new Client(server);
  today = (await admin.login('admin', 'credit-admin-password')).biz_today;
  await ger.login('ger', 'credit-ger-password');
  await cha.login('cha', 'credit-cha-password');
  CHP = ok(await admin.post('/api/products', { category: 'bouteille', name: 'Champagne crédit', reference: 'CHP', price: 20000 * UM, initial_stock: 20 })).id;
  CIG = ok(await admin.post('/api/products', { category: 'cigare', name: 'Cigare crédit', reference: 'CIG', price: 5000 * UM, initial_stock: 20 })).id;
  ok(await admin.post('/api/treasury/fund', { amounts: { 'Espèces': 100000 * UM } }));
});
after(() => server.destroy());

test('plafond : sans plafond pas de crédit ; seuls l’administrateur et les associés le fixent', async () => {
  const c = await newClient();
  assert.equal(c.credit_limit, 0);
  refused(await creditSale(ger, c, 'alcool', CHP, 1), 409, 'SANS_CREDIT');
  refused(await ger.put(`/api/clients/${c.id}/credit-limit`, { credit_limit: 100000 * UM }), 403);
  const acc = ok(await cha.put(`/api/clients/${c.id}/credit-limit`, { credit_limit: 100000 * UM }));
  assert.equal(acc.credit_limit, 100000 * UM);
  assert.equal(acc.available, 100000 * UM);
  assert.ok(server.club.get("SELECT 1 AS x FROM audit_log WHERE action = 'client.plafond'"));
  // Members and walk-ins never buy on credit.
  const m = ok(await ger.post('/api/members', { first_name: 'jean', last_name: 'credit', phone: '00 00 07 99' }));
  refused(await ger.post('/api/shop/sales', { account: 'alcool', buyer: { kind: 'membre', member_id: m.id }, lines: [{ product_id: CHP, quantity: 1 }], credit: true }), 400);
  refused(await ger.post('/api/shop/sales', { account: 'alcool', buyer: { kind: 'journalier' }, lines: [{ product_id: CHP, quantity: 1 }], credit: true }), 400);
});

test('vente à crédit, règlement partiel du plus ancien au plus récent, caisses, annulations', async () => {
  const c = await newClient();
  ok(await admin.put(`/api/clients/${c.id}/credit-limit`, { credit_limit: 60000 * UM }));
  const before0 = await centralRule('départ');
  const stock0 = stockOf(CHP);

  // The manager sells 2 champagnes on credit: stock out, no money, no caisse moves.
  const s1 = ok(await creditSale(ger, c, 'alcool', CHP, 2));
  assert.equal(s1.payment, null);
  assert.equal(s1.sale.on_credit, true);
  assert.equal(s1.sale.method, 'À crédit');
  assert.equal(stockOf(CHP), stock0 - 2);
  let b = await centralRule('vente à crédit');
  assert.equal(b.till, before0.till);
  assert.equal(b.caisses.alcool.balance, before0.caisses.alcool.balance);
  assert.equal((await account(c)).owed, 40000 * UM);

  // Above the limit: refused.
  refused(await creditSale(ger, c, 'alcool', CHP, 2), 409, 'PLAFOND_CREDIT');
  const s2 = ok(await creditSale(ger, c, 'cigares', CIG, 3));

  // Credit lines are no open note: not in « Reste à encaisser », not collectable as a note.
  const open = ok(await ger.get('/api/finance/open'));
  assert.ok(!open.some((g) => g.member_id === c.id));
  refused(await ger.post('/api/payments', { charge_ids: [s1.sale.lines[0].charge_id], method: 'Espèces' }), 409, 'VENTE_A_CREDIT');
  const dash = ok(await ger.get('/api/dashboard'));
  assert.ok(dash.credit_total >= 55000 * UM);

  // A settlement may not exceed the debt.
  refused(await ger.post(`/api/clients/${c.id}/settlements`, { amount: 60000 * UM, method: 'Espèces' }), 400, 'TROP_PAYE');
  // 50 000 pays the champagnes (40 000) in full, then 10 000 of the cigars.
  const r1 = ok(await ger.post(`/api/clients/${c.id}/settlements`, { amount: 50000 * UM, method: 'Espèces' }));
  assert.equal(r1.payment.settlement, true);
  assert.equal(r1.payment.by_account.alcool, 40000 * UM);
  assert.equal(r1.payment.by_account.cigares, 10000 * UM);
  assert.equal(r1.account.owed, 5000 * UM);
  assert.equal(r1.account.available, 55000 * UM);
  b = await centralRule('règlement');
  assert.equal(b.till, before0.till + 50000 * UM);
  assert.equal(b.caisses.alcool.balance, before0.caisses.alcool.balance + 40000 * UM);
  assert.equal(b.caisses.cigares.balance, before0.caisses.cigares.balance + 10000 * UM);
  const cig = server.club.get('SELECT status, settled, amount FROM charges WHERE shop_sale_id = ?', s2.sale.id);
  assert.deepEqual([cig.status, cig.settled, cig.amount], ['due', 10000 * UM, 15000 * UM]);
  // The settlement has its ticket.
  const t = ok(await ger.get(`/api/payments/${r1.payment.id}/ticket`)).ticket;
  assert.equal(t.amount, 50000 * UM);
  assert.equal(t.credit_owed_after, 5000 * UM);

  // The statement ends on the debt.
  let acc = await account(c);
  assert.deepEqual(acc.movements.map((x) => x.kind), ['achat', 'achat', 'reglement']);
  assert.equal(acc.movements.at(-1).balance, acc.owed);

  // The manager does not cancel a settlement; the associé does, and the money goes back out of both caisses.
  refused(await ger.post(`/api/payments/${r1.payment.id}/cancel-settlement`, { reason: 'Erreur de montant' }), 403);
  acc = ok(await cha.post(`/api/payments/${r1.payment.id}/cancel-settlement`, { reason: 'Erreur de montant' })).account;
  assert.equal(acc.owed, 55000 * UM);
  assert.equal(acc.movements.at(-1).kind, 'annulation_reglement');
  assert.equal(acc.movements.at(-1).balance, 55000 * UM);
  b = await centralRule('règlement annulé');
  assert.equal(b.till, before0.till);
  assert.equal(b.caisses.alcool.balance, before0.caisses.alcool.balance);
  assert.equal(b.caisses.cigares.balance, before0.caisses.cigares.balance);
  refused(await cha.post(`/api/payments/${r1.payment.id}/cancel-settlement`, { reason: 'Encore' }), 409, 'DEJA_ANNULEE');
  assert.equal(ok(await ger.get(`/api/payments/${r1.payment.id}/ticket`)).ticket.status, 'annule');

  // 20 000 again pays half of the champagnes; then the champagne sale is cancelled: the 20 000 go back to the client,
  // the rest of that debt is erased, the bottles come back, only the cigars stay owed.
  const r2 = ok(await ger.post(`/api/clients/${c.id}/settlements`, { amount: 20000 * UM, method: 'Espèces' }));
  assert.equal(r2.account.owed, 35000 * UM);
  ok(await cha.post(`/api/shop/sales/${s1.sale.id}/cancel`, { reason: 'Bouteilles rendues' }));
  assert.equal(stockOf(CHP), stock0);
  acc = await account(c);
  assert.equal(acc.owed, 15000 * UM);
  assert.equal(acc.movements.at(-1).balance, 15000 * UM);
  assert.deepEqual(acc.movements.slice(-2).map((x) => x.kind), ['annulation_achat', 'rendu']);
  b = await centralRule('vente à crédit annulée');
  assert.equal(b.till, before0.till);
  assert.equal(b.caisses.alcool.balance, before0.caisses.alcool.balance);
  // That settlement paid a sale cancelled since: it cannot be cancelled any more.
  refused(await cha.post(`/api/payments/${r2.payment.id}/cancel-settlement`, { reason: 'Trop tard' }), 409, 'VENTE_ANNULEE');

  // Caisse › Boutique: the credit sales show « À crédit », the cancelled one comes off on its day.
  const shop = ok(await admin.get(`/api/shop/summary?from=${today}`));
  assert.equal(shop.accounts.alcool.by_method.find((x) => x.method === 'À crédit'), undefined, 'vente annulée le même jour');
  assert.equal(shop.accounts.cigares.by_method.find((x) => x.method === 'À crédit').total, 15000 * UM);

  // No move to member while he owes; once settled, he may.
  refused(await ger.post(`/api/clients/${c.id}/convert`, {}), 409, 'CREANCE_EN_COURS');
  ok(await ger.post(`/api/clients/${c.id}/settlements`, { amount: 15000 * UM, method: 'Espèces' }));
  refused(await ger.post(`/api/clients/${c.id}/settlements`, { amount: 1 * UM, method: 'Espèces' }), 409, 'RIEN_A_REGLER');
  assert.equal(ok(await ger.get('/api/clients')).find((x) => x.id === c.id).owed, 0);
  await centralRule('tout réglé');
  ok(await ger.post(`/api/clients/${c.id}/convert`, {}));
});

test('la recette : facturé le jour de la vente, encaissé le jour du règlement', async () => {
  const c = await newClient();
  ok(await admin.put(`/api/clients/${c.id}/credit-limit`, { credit_limit: 50000 * UM }));
  const cig = (s) => s.accounts.find((a) => a.account === 'cigares');
  const sum0 = ok(await admin.get(`/api/finance/summary?from=${today}`));
  ok(await creditSale(ger, c, 'cigares', CIG, 2));
  const sum1 = ok(await admin.get(`/api/finance/summary?from=${today}`));
  assert.equal(cig(sum1).billed - cig(sum0).billed, 10000 * UM);
  assert.equal(cig(sum1).collected - cig(sum0).collected, 0);
  assert.equal(cig(sum1).outstanding - cig(sum0).outstanding, 10000 * UM);
  ok(await ger.post(`/api/clients/${c.id}/settlements`, { amount: 4000 * UM, method: 'Espèces' }));
  const sum2 = ok(await admin.get(`/api/finance/summary?from=${today}`));
  assert.equal(cig(sum2).collected - cig(sum1).collected, 4000 * UM);
  assert.equal(cig(sum2).boutique.collected - cig(sum1).boutique.collected, 4000 * UM);
  assert.equal(cig(sum2).outstanding - cig(sum0).outstanding, 6000 * UM);
});

test('vente à crédit payée en deux règlements puis annulée : chaque part rendue par son propre moyen', async () => {
  const c = await newClient();
  ok(await admin.put(`/api/clients/${c.id}/credit-limit`, { credit_limit: 50000 * UM }));
  const sale = ok(await creditSale(ger, c, 'alcool', CHP, 1));
  const a = ok(await ger.post(`/api/clients/${c.id}/settlements`, { amount: 8000 * UM, method: 'Espèces' }));
  const b = ok(await ger.post(`/api/clients/${c.id}/settlements`, { amount: 12000 * UM, method: 'MTN MoMo' }));
  ok(await cha.post(`/api/shop/sales/${sale.sale.id}/cancel`, { reason: 'Bouteille rendue' }));
  const refunds = server.club.all(
    'SELECT payment_id, amount, method FROM refunds WHERE charge_id = ? ORDER BY id', sale.sale.lines[0].charge_id,
  );
  assert.deepEqual(refunds.map((r) => ({ ...r })), [
    { payment_id: a.payment.id, amount: 8000 * UM, method: 'Espèces' },
    { payment_id: b.payment.id, amount: 12000 * UM, method: 'MTN MoMo' },
  ]);
  const acc = await account(c);
  assert.equal(acc.owed, 0);
  assert.equal(acc.movements.at(-1).balance, 0);
  assert.equal(ok(await ger.get(`/api/payments/${a.payment.id}/ticket`)).ticket.status, 'rembourse');
  await centralRule('vente réglée en deux fois puis annulée');
});
