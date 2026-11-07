// The six tiles of « Soldes » (src/components/cash/caisses.js), from the server's figures: their order and titles,
// the lines each caisse shows, its warning when below zero, and the buttons each person gets (spec, decision 8:
// an associé pays a supplier and makes an apport on either caisse; he takes profits only from his own or the
// common one).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { caisseTiles } from '../src/components/cash/caisses.js';

const UM = 100;
const balances = (over = {}) => ({
  start: '2026-11-01', to: '2026-11-07', started: true,
  fund: { amount: 100000 * UM, total: 100000 * UM, card_credit: 0 },
  cards: 350000 * UM,
  caisses: {
    reservations: { balance: 125000 * UM, sold: 175000 * UM, expenses: 50000 * UM, apports: 0, taken: 0, halves: { alcool: 62500 * UM, cigares: 62500 * UM } },
    alcool: {
      balance: 220000 * UM, sold_champagne: 360000 * UM, sold_autres: 60000 * UM, purchases_champagne: 120000 * UM,
      purchases_autres: 30000 * UM, other_expenses: 0, apports: 0, taken: 50000 * UM, ...over.alcool,
    },
    cigares: { balance: 100000 * UM, sold: 300000 * UM, purchases: 200000 * UM, other_expenses: 0, apports: 0, taken: 0, ...over.cigares },
  },
  till: 895000 * UM,
  ...over.top,
});
const admin = { role: 'admin' };
const cig = { role: 'associe', rayon: 'cigares' };
const fmt = { money: (n) => `${n / UM}`, day: (d) => d.split('-').reverse().join('/'), today: '2026-11-07' };
const byKey = (tiles, key) => tiles.find((t) => t.key === key);

test('six tuiles, dans l’ordre du propriétaire, avec leurs titres', () => {
  assert.deepEqual(caisseTiles(balances(), admin, fmt).map((t) => t.title), [
    'Fond de caisse', 'Solde de crédit sur les cartes clients non utilisées', 'Réservation de séance',
    'Champagne et autres boissons', 'Cigare', 'Solde en caisse',
  ]);
});

test('les lignes de la caisse Champagne : « Autres dépenses » et « Apports » seulement quand ils comptent', () => {
  const lines = (b) => byKey(caisseTiles(b, admin, fmt), 'alcool').lines.map((l) => l.label);
  assert.deepEqual(lines(balances()), ['Vendu champagne', 'Vendu autres boissons', 'Achats champagne', 'Achats autres boissons', 'Bénéfices pris']);
  assert.ok(lines(balances({ alcool: { other_expenses: 500 } })).includes('Autres dépenses'));
  assert.ok(lines(balances({ alcool: { apports: 500 } })).includes('Apports'));
  const taken = byKey(caisseTiles(balances(), admin, fmt), 'alcool').lines.find((l) => l.label === 'Bénéfices pris');
  assert.deepEqual({ amount: taken.amount, sign: taken.sign }, { amount: 50000 * UM, sign: 'out' });
});

test('la caisse commune dit la part de chacun', () => {
  const tile = byKey(caisseTiles(balances(), admin, fmt), 'reservations');
  assert.ok(tile.hints.some((h) => h === 'soit 62500 chacun'), tile.hints.join(' | '));
});

test('les boutons : l’administrateur partout, l’associé selon la caisse, jamais de fournisseur sur la caisse commune', () => {
  const actions = (me) => Object.fromEntries(caisseTiles(balances(), me, fmt).map((t) => [t.key, t.actions]));
  assert.deepEqual(actions(admin), {
    fond: [], cartes: [], reservations: ['benefices', 'apport'], alcool: ['fournisseur', 'benefices', 'apport'],
    cigares: ['fournisseur', 'benefices', 'apport'], caisse: [],
  });
  const a = actions(cig);
  assert.deepEqual(a.alcool, ['fournisseur', 'apport']);
  assert.deepEqual(a.cigares, ['fournisseur', 'benefices', 'apport']);
  assert.deepEqual(a.reservations, ['benefices', 'apport']);
  assert.deepEqual(actions({ role: 'gerant' }).cigares, []);
});

test('une caisse en négatif le dit ; avant le fond, pas de tuiles', () => {
  const tile = byKey(caisseTiles(balances({ cigares: { balance: -5000 } }), admin, fmt), 'cigares');
  assert.equal(tile.negative, true);
  assert.ok(tile.hints.includes('Remettez de l’argent dans cette caisse.'));
  assert.equal(caisseTiles(balances({ top: { started: false } }), admin, fmt), null);
});

test('le fond dit le crédit des cartes qu’il contenait déjà', () => {
  const tile = byKey(caisseTiles(balances({ top: { fund: { amount: 60000 * UM, total: 100000 * UM, card_credit: 40000 * UM } } }), admin, fmt), 'fond');
  assert.equal(tile.value, 60000 * UM);
  assert.ok(tile.hints.includes('au 01/11/2026'));
  assert.ok(tile.hints.includes('dont crédit des cartes déjà là : −40000'));
});

test('une période passée : pas de boutons, le solde montré n’est pas celui d’aujourd’hui', () => {
  for (const t of caisseTiles(balances({ top: { to: '2026-11-06' } }), admin, fmt)) assert.deepEqual(t.actions, [], t.key);
});
