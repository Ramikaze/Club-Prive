// The Caisse in three columns (src/components/cash/categories.js) on the server's own answers: the columns add up
// to the total, Boisson is Champagne + Autres boissons, and a billed line reads the way the page shows it.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { categoryColumns, lineTexts } from '../src/components/cash/categories.js';
import { receiptSummary, recetteToCash, tillFigures } from '../src/components/cash/flows.js';
import { addDays } from '../shared/time.js';
import { CARD_METHOD } from '../shared/rules.js';
import { Server, Client, ok, UM } from './harness.js';

const server = new Server({}, { lenientTariffs: true });
let admin;
let ger;
let today;
let bundle;
let CHP;
let DRK;
let CIG;

const summary = async () => ok(await admin.get(`/api/finance/summary?from=${today}`));
const billed = async () => ok(await admin.get(`/api/finance/billed?from=${today}`));

before(async () => {
  await server.start();
  await server.addUser('admin', 'Propriétaire', 'admin', 'cols-admin-password');
  await server.addUser('ger', 'Gérant', 'gerant', 'cols-ger-password');
  admin = new Client(server);
  ger = new Client(server);
  today = (await admin.login('admin', 'cols-admin-password')).biz_today;
  bundle = await ger.login('ger', 'cols-ger-password');
  CHP = ok(await admin.post('/api/products', { category: 'bouteille', name: 'Champagne test', reference: 'CHP', price: 20000 * UM, initial_stock: 100 })).id;
  DRK = ok(await admin.post('/api/products', { category: 'boisson', name: 'Boisson test', reference: 'DRK', price: 30000 * UM, initial_stock: 100 })).id;
  CIG = ok(await admin.post('/api/products', { category: 'cigare', name: 'Cigare test', reference: 'CIG', price: 5000 * UM, initial_stock: 400 })).id;
  // A session with one line of each category, the champagne and the cigar paid, the drink left on the note.
  const m = ok(await ger.post('/api/members', { first_name: 'jean', last_name: 'cols', phone: '00 00 08 01' }));
  ok(await ger.post(`/api/members/${m.id}/subscriptions`, { plan_id: bundle.plans.find((p) => p.code === 'MENSUELLE').id, start_date: today }));
  const r = ok(await ger.post('/api/reservations', { member_id: m.id, room_id: bundle.rooms[0].id, date: today, start_time: '06:00', duration_min: 60 }));
  const ids = [];
  for (const product_id of [CHP, DRK, CIG]) {
    const d = ok(await ger.post(`/api/reservations/${r.reservation.id}/items`, { product_id, quantity: 1 }));
    ids.push(d.charges.filter((c) => c.status === 'due' && c.kind === 'produit').at(-1).id);
  }
  ok(await ger.post('/api/payments', { charge_ids: [ids[0], ids[2]], method: 'Espèces' }));
});
after(() => server.destroy());

test('trois colonnes ; Boisson = Champagne + Autres boissons ; la somme = le total', async () => {
  const sum = await summary(); const b = await billed();
  const cols = categoryColumns(sum, b);
  assert.deepEqual(cols.map((c) => c.title), ['Réservation de séance', 'Champagne et autres boissons', 'Cigare']);
  assert.deepEqual(cols[1].parts.map((p) => p.title), ['Champagne', 'Autres boissons']);
  // Each column is pinned to its own account, not just to the sum.
  const acc = (k) => sum.accounts.find((a) => a.account === k);
  assert.equal(cols[0].net, acc('reservations').net);
  assert.equal(cols[1].net, acc('alcool').net);
  assert.equal(cols[2].net, acc('cigares').net);
  assert.equal(cols[1].parts[0].net, acc('alcool').champagne.net);
  assert.equal(cols[1].parts[1].net, acc('alcool').autres_boissons.net);
  assert.equal(cols[1].net, cols[1].parts[0].net + cols[1].parts[1].net);
  assert.equal(cols.reduce((s, c) => s + c.net, 0), sum.total.net);
  assert.deepEqual(cols[1].parts[1].lines, b.columns.autres_boissons.lines);
  assert.ok(cols[1].parts[1].lines.some((l) => l.status === 'due'));
});

test('textes d’une ligne facturée', () => {
  const base = { member_name: 'Jean TEST', reservation_id: 12, room_name: 'Salon', quantity: 2, label: 'Whisky test' };
  assert.equal(lineTexts({ ...base, kind: 'abonnement', plan_name: 'Mensuelle' }).title, 'Abonnement · Mensuelle · Jean TEST');
  assert.deepEqual(lineTexts({ ...base, kind: 'produit' }), { title: 'Whisky test × 2', origin: 'Séance n° 12 · Jean TEST' });
  assert.equal(lineTexts({ ...base, kind: 'produit', shop_sale_id: 3, reservation_id: null, member_name: 'Client journalier' }).origin, 'Boutique · Client journalier');
  assert.equal(lineTexts({ ...base, kind: 'temps_supplementaire', label: 'Temps supplémentaire (1 h)' }).origin, 'Séance n° 12 · Salon · Jean TEST');
  assert.equal(lineTexts({ ...base, kind: 'produit', reservation_id: null }).origin, 'Jean TEST');
});

test('le tableau de bord du gérant ne porte pas la répartition Champagne / Autres boissons', async () => {
  const alcool = (d) => d.cash_today.accounts.find((a) => a.account === 'alcool');
  assert.equal(alcool(ok(await ger.get('/api/dashboard'))).champagne, undefined);
  assert.equal(alcool(ok(await ger.get('/api/dashboard'))).autres_boissons, undefined);
  assert.ok(alcool(ok(await admin.get('/api/dashboard'))).champagne);
});

// ---------------------------------------------------------------------------- « Recette du jour » and « Argent encaissé »
// Owner's rule (2026-11-07): the recette is the three columns only, card-paid sales counted on the day the card
// pays; « Argent encaissé » (the till's figure) stays the money received. One line under the columns goes from the
// one to the other, every term computed on its own: recette + terms must land exactly on « Argent encaissé ».

const dayOf = (iso) => server.club.bizDayOf(Date.parse(iso));

// What the administrator's Caisse loads for the period, and its figures on all accounts: the line from the recette
// to the money received, and « Argent encaissé » both ways the page computes it (the receipts block and the box).
async function cashPage(from, to = from) {
  const q = `from=${from}&to=${to}`;
  const sum = ok(await admin.get(`/api/finance/summary?${q}`));
  const journal = ok(await admin.get(`/api/finance/journal?${q}`));
  const { entries } = ok(await admin.get(`/api/ledger/entries?${q}`));
  const t = ok(await admin.get(`/api/treasury?${q}`));
  return {
    sum,
    bridge: recetteToCash(sum, journal, entries, { to, dayOf }),
    receipts: receiptSummary(journal, entries, { to, dayOf }).total,
    cash: tillFigures(t, '', { entries, journal, openingBalances: server.club.settings().opening_balances, dayOf }).in,
  };
}
const termsOf = (bridge) => Object.fromEntries(bridge.terms.map((x) => [x.key, x.amount]));
// The recette is the three columns; the box and the receipts block agree; the recette plus each term is the box.
function assertLands(p, at) {
  assert.equal(p.bridge.recette, p.sum.total.net, `recette (${at})`);
  assert.equal(p.receipts, p.cash, `argent encaissé, bloc et case (${at})`);
  assert.equal(p.bridge.recette + p.bridge.terms.reduce((s, x) => s + x.amount, 0), p.cash, `recette + écarts (${at})`);
  assert.equal(p.bridge.cash, p.cash, `total de la ligne (${at})`);
}
const newMember = async (first_name, phone) => ok(await ger.post('/api/members', { first_name, last_name: 'Recette', phone }));
const recharge = async (memberId, amount, method) => ok(await ger.post(`/api/members/${memberId}/wallet/recharge`, { amount: amount * UM, method })).payment;
const dueProduct = (d) => d.charges.filter((c) => c.status === 'due' && c.kind === 'produit').at(-1).id;

test('recette du jour → argent encaissé : chaque écart à part, et la ligne tombe juste', async () => {
  const before = await cashPage(today);
  assertLands(before, 'avant');
  // The day so far (before()): the champagne 20 000 and the cigar 5 000 paid in cash, nothing else.
  assert.equal(before.bridge.recette, 25000 * UM);
  assert.equal(before.cash, 25000 * UM);

  const lea = await newMember('Léa', '00 00 08 02');
  ok(await ger.post(`/api/members/${lea.id}/subscriptions`, { plan_id: bundle.plans.find((p) => p.code === 'MENSUELLE').id, start_date: today }));
  // 2 h 30 for a plan of 2 h: a session line « Temps supplémentaire ».
  const r = ok(await ger.post('/api/reservations', { member_id: lea.id, room_id: bundle.rooms[0].id, date: today, start_time: '10:00', duration_min: 150 }));
  const extra = r.charges.find((c) => c.kind === 'temps_supplementaire');
  const X = extra.amount;
  assert.ok(X > 0);
  await recharge(lea.id, 80000, 'Espèces'); // a card top-up: money, no recette
  const add = async (product_id) => dueProduct(ok(await ger.post(`/api/reservations/${r.reservation.id}/items`, { product_id, quantity: 1 })));
  const chp = await add(CHP);
  const drk = await add(DRK);
  const cig = await add(CIG);
  // The session line and the cigar paid in cash.
  ok(await ger.post('/api/payments', { charge_ids: [extra.id, cig], method: 'Espèces' }));
  // The champagne and the other drink paid by card: recette, no money.
  const byCard = ok(await ger.post('/api/payments', { charge_ids: [chp, drk], card: true, method: 'Espèces' })).payment;
  assert.equal(byCard.method, CARD_METHOD);
  assert.equal(byCard.card_amount, 50000 * UM);
  // One refund back to the card (the champagne), one in cash (the cigar).
  ok(await admin.post(`/api/charges/${chp}/refund`, { reason: 'Bouteille bouchonnée' }));
  ok(await admin.post(`/api/charges/${cig}/refund`, { reason: 'Cigare abîmé', method: 'Espèces' }));
  // An outside meal of 60 000: the card's 50 000, the rest 10 000 by MoMo; the courier is an expense.
  const meal = ok(await ger.post(`/api/members/${lea.id}/outside-meal`, { amount: 60000 * UM, label: 'Pizzeria', rest_method: 'MTN MoMo' })).payment;
  assert.equal(meal.card_amount, 50000 * UM);
  // An « Autre entrée » of 15 000 by wire.
  const categories = ok(await admin.get('/api/ledger/categories'));
  const other = categories.find((c) => c.kind === 'recette' && c.name === 'Autre entrée');
  ok(await admin.post('/api/ledger/entries', { kind: 'recette', category_id: other.id, amount: 15000 * UM, method: 'Virement' }));

  const p = await cashPage(today);
  assertLands(p, 'jour');
  // Recette: 25 000 + X + 5 000 (cigar) + 50 000 (card) − 20 000 (refund to the card) − 5 000 (refund in cash).
  assert.equal(p.bridge.recette, 55000 * UM + X);
  assert.deepEqual(termsOf(p.bridge), {
    cartes: 80000 * UM,
    ventes_carte: -50000 * UM,
    remboursements_carte: 20000 * UM,
    repas: 10000 * UM,
    entrees: 15000 * UM,
  });
  // The money received: 20 000 + 5 000 + X + 5 000 + 80 000 + 10 000 + 15 000 − 5 000.
  assert.equal(p.cash, 130000 * UM + X);
  // The line names each term in plain French, in the owner's order.
  assert.deepEqual(p.bridge.terms.map((x) => x.label), [
    'argent mis sur les cartes', 'ventes payées par carte membre', 'remboursements rendus sur la carte', 'argent reçu pour les repas extérieurs (hors carte)', 'entrées diverses',
  ]);
});

test('recette → argent encaissé : approvisionnement et repas annulés, journée fermée, période de deux jours', async () => {
  const day = await cashPage(today);
  // Yesterday, on the club's clock: a card top-up of 40 000 in cash, then the till closed with 1 000 over the books
  // (an « Écart de caisse » entry, an entrée diverse).
  server.club.at = Date.now() - 24 * 3600 * 1000;
  let yesterday;
  let topUp;
  try {
    yesterday = server.club.bizToday();
    assert.equal(yesterday, addDays(today, -1));
    const max = await newMember('Max', '00 00 08 03');
    topUp = await recharge(max.id, 40000, 'Espèces');
  } finally {
    server.club.at = null;
  }
  const closing = ok(await admin.get(`/api/day-closing?day=${yesterday}`));
  const counts = Object.fromEntries(closing.accounts.filter((a) => a.to_count)
    .map((a) => [a.method, a.expected + (a.method === 'Espèces' ? 1000 * UM : 0)]));
  ok(await admin.post('/api/day-closing', { day: yesterday, counts, gap_reason: 'Billet retrouvé', unchecked_reason: 'Pointé sur papier' }));
  assert.ok(ok(await admin.get(`/api/day-closing?day=${yesterday}`)).closed);
  // Today: yesterday's top-up cancelled; a top-up made and cancelled today; an outside meal paid in cash and cancelled.
  ok(await admin.post(`/api/payments/${topUp.id}/cancel-recharge`, { reason: 'Erreur de saisie' }));
  const zoe = await newMember('Zoé', '00 00 08 04');
  const gone = await recharge(zoe.id, 4000, 'Espèces');
  ok(await admin.post(`/api/payments/${gone.id}/cancel-recharge`, { reason: 'Erreur de saisie' }));
  const ugo = await newMember('Ugo', '00 00 08 05');
  const meal = ok(await ger.post(`/api/members/${ugo.id}/outside-meal`, { amount: 12000 * UM, label: 'Grillades', rest_method: 'Espèces' })).payment;
  ok(await admin.post(`/api/payments/${meal.id}/cancel-meal`, { reason: 'Commande annulée' }));
  // And an « Autre entrée » typed then cancelled: it adds nothing either.
  const other = ok(await admin.get('/api/ledger/categories')).find((c) => c.kind === 'recette' && c.name === 'Autre entrée');
  const entry = ok(await admin.post('/api/ledger/entries', { kind: 'recette', category_id: other.id, amount: 9000 * UM, method: 'Espèces' }));
  ok(await admin.post(`/api/ledger/entries/${entry.id}/cancel`, { reason: 'Saisie en double' }));

  // Yesterday alone: the top-up was cancelled after it, so it still counts there.
  const y = await cashPage(yesterday);
  assertLands(y, 'hier');
  assert.equal(y.bridge.recette, 0);
  assert.deepEqual(termsOf(y.bridge), { cartes: 40000 * UM, ventes_carte: 0, remboursements_carte: 0, repas: 0, entrees: 1000 * UM });
  assert.equal(y.cash, 41000 * UM);
  // Today alone: the cancelled top-up and meal add nothing; yesterday's cancelled top-up is not today's.
  const t = await cashPage(today);
  assertLands(t, 'aujourd’hui');
  assert.equal(t.bridge.recette, day.bridge.recette);
  assert.deepEqual(termsOf(t.bridge), termsOf(day.bridge));
  assert.equal(t.cash, day.cash);
  // The two days: the recette is today's; the 40 000 came in and went out within the period, so it adds nothing.
  const two = await cashPage(yesterday, today);
  assertLands(two, 'deux jours');
  assert.equal(two.bridge.recette, day.bridge.recette);
  assert.deepEqual(termsOf(two.bridge), { ...termsOf(day.bridge), entrees: termsOf(day.bridge).entrees + 1000 * UM });
  assert.equal(two.cash, day.cash + 1000 * UM);
});
