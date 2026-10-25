// The cash page's figures (src/components/cash/flows.js) on the server's own answers: a sale paid entirely with the
// member's card, a mixed one, recharges (one cancelled), refunds (cash and card), an outside meal partly paid with
// the card, an other receipt, an expense, a transfer and the opening balances. The Recettes and Dépenses blocks
// must add up to the figures of « Soldes », and the fund plus recettes less dépenses must be the closing balance,
// on all accounts and on each one (its transfers included).
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { CARD_METHOD } from '../shared/rules.js';
import { expenseTotal, receiptSummary, tillFigures, transferTotals } from '../src/components/cash/flows.js';
import { Server, Client, ok, UM } from './harness.js';

const server = new Server({});
let admin;
let manager;
let today;
let gerant;

before(async () => {
  await server.start();
  await server.addUser('admin', 'Admin', 'admin', 'cash-flows-admin-password');
  await server.addUser('gerant', 'Gérant', 'gerant', 'cash-flows-manager-password');
  admin = new Client(server);
  manager = new Client(server);
  await admin.login('admin', 'cash-flows-admin-password');
  today = (await manager.login('gerant', 'cash-flows-manager-password')).biz_today;
  gerant = server.club.userByLogin('gerant');
});
after(() => server.destroy());

const newMember = async (first_name) => ok(await manager.post('/api/members', { first_name, last_name: 'Caisse', phone: '+000 00 00 00 00' }));
const recharge = async (memberId, amount, method) => ok(await manager.post(`/api/members/${memberId}/wallet/recharge`, { amount: amount * UM, method }));
const line = (memberId, account, amount, label) => server.club.tx(() => server.club.insertCharge(gerant, {
  account, kind: 'produit', member_id: memberId, label, quantity: 1, unit_price: amount * UM,
}));
const pay = async (body) => ok(await manager.post('/api/payments', body)).payment;
const dayOf = (iso) => server.club.bizDayOf(Date.parse(iso));

// What the page loads for the day, and its figures on one account ('' for all).
async function pageData() {
  const q = `from=${today}&to=${today}`;
  const journal = ok(await admin.get(`/api/finance/journal?${q}`));
  const { entries } = ok(await admin.get(`/api/ledger/entries?${q}`));
  const t = ok(await admin.get(`/api/treasury?${q}`));
  const openingBalances = server.club.settings().opening_balances;
  return { journal, entries, t, openingBalances };
}
function figures({ journal, entries, t, openingBalances }, method) {
  return {
    receipts: receiptSummary(journal, entries, { method, to: today, dayOf }),
    expenses: expenseTotal(entries, method),
    transfers: transferTotals(entries, method),
    till: tillFigures(t, method, { entries, journal, openingBalances, dayOf }),
  };
}
function assertOneStory(data) {
  for (const method of ['', ...data.t.accounts.map((a) => a.method)]) {
    const f = figures(data, method);
    const at = method || 'toutes';
    assert.equal(f.receipts.total, f.till.in, `recettes (${at})`);
    assert.equal(f.expenses, f.till.out, `dépenses (${at})`);
    assert.equal(f.till.opening + f.till.in - f.till.out + f.till.received - f.till.sent, f.till.closing, `solde (${at})`);
    if (!method) assert.equal(f.till.received, f.till.sent);
  }
}

test('recettes, dépenses et soldes racontent la même histoire : l’argent reçu, par compte et en tout', async () => {
  const methods = server.club.settings().payment_methods.filter((m) => m !== CARD_METHOD);
  const [cash, bank, momo, wire] = ['Espèces', 'Carte bancaire', 'MTN MoMo', 'Virement'];
  for (const m of [cash, bank, momo, wire]) assert.ok(methods.includes(m), m);

  // A sale paid entirely with the card: listed, but no money received.
  const ana = await newMember('Ana');
  await recharge(ana.id, 50000, cash);
  const bottle = line(ana.id, 'alcool', 20000, 'Bouteille');
  const byCard = await pay({ charge_ids: [bottle], card: true, method: cash });
  assert.equal(byCard.method, CARD_METHOD);
  // A mixed sale: the card's 5 000, then 15 000 in cash.
  const ben = await newMember('Ben');
  await recharge(ben.id, 5000, momo);
  const mixed = await pay({ charge_ids: [line(ben.id, 'cigares', 20000, 'Cigare')], card: true, method: cash });
  assert.equal(mixed.card_amount, 5000 * UM);
  // A sale by bank card, refunded the same day; the card sale refunded back to the card.
  const cleo = await newMember('Cléo');
  const room = line(cleo.id, 'reservations', 12000, 'Séance');
  await pay({ charge_ids: [room], method: bank });
  ok(await admin.post(`/api/charges/${room}/refund`, { reason: 'Salle indisponible', method: bank }));
  ok(await admin.post(`/api/charges/${bottle}/refund`, { reason: 'Bouteille bouchonnée' }));
  // An outside meal: the card pays its 3 000, the rest by MoMo; the courier is paid in cash (an expense).
  const dan = await newMember('Dan');
  await recharge(dan.id, 3000, cash);
  ok(await manager.post(`/api/members/${dan.id}/outside-meal`, { amount: 10000 * UM, label: 'Pizzeria', courier_method: cash, rest_method: momo }));
  // A recharge cancelled the same day: it adds nothing.
  const eve = await newMember('Ève');
  const { payment: cancelled } = await recharge(eve.id, 4000, cash);
  ok(await admin.post(`/api/payments/${cancelled.id}/cancel-recharge`, { reason: 'Erreur de saisie' }));
  // An other receipt, an expense and a transfer.
  const categories = ok(await admin.get('/api/ledger/categories'));
  const income = categories.find((c) => c.kind === 'recette' && c.active);
  const spend = categories.find((c) => c.kind === 'depense' && c.active && c.name !== 'Avance repas client');
  ok(await admin.post('/api/ledger/entries', { kind: 'recette', category_id: income.id, amount: 30000 * UM, method: wire }));
  ok(await admin.post('/api/ledger/entries', { kind: 'depense', category_id: spend.id, amount: 2500 * UM, method: cash }));
  ok(await admin.post('/api/ledger/entries', { kind: 'transfert', amount: 10000 * UM, method: cash, to_method: wire }));

  const data = await pageData();
  assertOneStory(data);
  const all = figures(data, '');
  const sum = Object.fromEntries(all.receipts.lines.map(([label, v]) => [label, v]));
  assert.equal(sum.Alcool, 0); // paid with the card
  assert.equal(sum.Cigares, 15000 * UM); // the cash part only
  assert.equal(sum['Réservations'], 12000 * UM);
  assert.equal(sum['Repas extérieurs'], 7000 * UM);
  assert.equal(sum['Approvisionnements cartes'], 58000 * UM); // 50 000 + 5 000 + 3 000, the cancelled 4 000 left out
  assert.equal(sum['Entrées diverses'], 30000 * UM);
  assert.equal(all.receipts.refunds, 12000 * UM); // the card refund gives no money back
  assert.equal(all.receipts.card, 20000 * UM + 5000 * UM + 3000 * UM);
  assert.equal(all.receipts.total, (15000 + 12000 + 7000 + 58000 + 30000 - 12000) * UM);
  assert.equal(all.expenses, (10000 + 2500) * UM);
  const onCash = figures(data, cash);
  assert.deepEqual(onCash.transfers, { received: 0, sent: 10000 * UM });

  // Opening balances set within the period are the cash fund, not recettes.
  ok(await admin.put('/api/settings', { opening_balances: { date: today, amounts: { [cash]: 100000 * UM } } }));
  const withFund = await pageData();
  assertOneStory(withFund);
  assert.equal(figures(withFund, '').till.opening, 100000 * UM);
  assert.equal(figures(withFund, '').till.in, all.receipts.total);
});
