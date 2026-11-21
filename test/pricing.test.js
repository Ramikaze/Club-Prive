// Prices of the Boutique (shared/pricing.js): the lot price of a product, the discount of a sale, its spread over the
// lines in whole francs, the manager's cap. The same functions price a sale on the screen and in the Worker.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { FRANC, linePrice, lotApplies, discountLabel, spreadDiscount, priceSale } from '../shared/pricing.js';

const UM = 100;
const COUPE = { id: 1, price: 5000 * UM, lot_qty: 3, lot_price: 10000 * UM, extra_price: 3000 * UM };
const item = (id, price) => ({ id, price, lot_qty: null, lot_price: null, extra_price: null });
const BARREDA = item(2, 12500 * UM);
const CAIN = item(3, 11500 * UM);
const CASA = item(4, 10000 * UM);
const sum = (xs) => xs.reduce((s, x) => s + x, 0);

test('linePrice : grille du coupe-cigare', () => {
  assert.deepEqual([1, 2, 3, 4, 5, 6].map((n) => linePrice(COUPE, n)), [5000, 10000, 10000, 13000, 16000, 19000].map((x) => x * UM));
  assert.equal(linePrice({ price: 7000 * UM, lot_qty: null }, 3), 21000 * UM);
  assert.equal(lotApplies(COUPE, 2), false);
  assert.equal(lotApplies(COUPE, 3), true);
  assert.equal(FRANC, 100);
});

test('priceSale : lot puis remise de 10 %', () => {
  const r = priceSale([{ product: COUPE, quantity: 4 }, { product: BARREDA, quantity: 1 }], { kind: 'pourcentage', value: 10 });
  assert.equal(r.problem, null);
  assert.equal(r.subtotal, 25500 * UM);
  assert.equal(r.discount, 2550 * UM);
  assert.equal(r.total, 22950 * UM);
  assert.deepEqual(
    { product_id: r.lines[0].product_id, quantity: r.lines[0].quantity, unit_price: r.lines[0].unit_price, price: r.lines[0].price, lot: r.lines[0].lot },
    { product_id: 1, quantity: 4, unit_price: 5000 * UM, price: 13000 * UM, lot: true },
  );
  assert.equal(r.lines[1].lot, false);
  assert.equal(sum(r.lines.map((l) => l.discount)), 2550 * UM);
  for (const l of r.lines) assert.equal(l.amount, l.price - l.discount);
});

test('priceSale : pourcentage arrondi au franc', () => {
  assert.equal(priceSale([{ product: item(5, 12345 * UM), quantity: 1 }], { kind: 'pourcentage', value: 10 }).discount, 1235 * UM);
});

test('priceSale : montant réparti au plus grand reste', () => {
  const r = priceSale([1, 2, 3].map((id) => ({ product: item(id, 10000 * UM), quantity: 1 })), { kind: 'montant', value: 1000 * UM });
  assert.deepEqual(r.lines.map((l) => l.discount), [334, 333, 333].map((x) => x * UM));
});

test('spreadDiscount : chaque ligne garde au moins 1 franc', () => {
  assert.deepEqual(spreadDiscount([2 * UM, 98 * UM], 98 * UM), [1 * UM, 97 * UM]);
});

test('priceSale : centimes gardés', () => {
  const r = priceSale([{ product: item(6, 4000050), quantity: 1 }], { kind: 'pourcentage', value: 10 });
  assert.equal(r.discount, 400000);
  assert.equal(r.lines[0].amount, 3600050);
});

test('priceSale : remise trop forte', () => {
  const r = priceSale([{ product: item(7, 2 * UM), quantity: 1 }, { product: item(8, 98 * UM), quantity: 1 }], { kind: 'montant', value: 99 * UM });
  assert.equal(r.problem.code, 'REMISE_TROP_FORTE');
  assert.equal(r.problem.message, 'Remise trop forte : le total doit rester positif.');
  assert.equal(r.discount, 0);
  assert.equal(r.total, 100 * UM);
  assert.deepEqual(r.lines.map((l) => l.discount), [0, 0]);
});

test('priceSale : valeurs refusées', () => {
  const lines = [{ product: BARREDA, quantity: 1 }];
  for (const discount of [
    { kind: 'pourcentage', value: 0 }, { kind: 'pourcentage', value: 100 }, { kind: 'pourcentage', value: 12.5 },
    { kind: 'montant', value: 150 }, { kind: 'montant', value: 0 }, { kind: 'cadeau', value: 5 }, { kind: 'pourcentage', value: '10' },
  ]) {
    const r = priceSale(lines, discount);
    assert.equal(r.problem?.code, 'REMISE_INVALIDE', JSON.stringify(discount));
    assert.equal(r.total, r.subtotal);
  }
  // 1 % of 30 F rounds to 0 F: no discount at all.
  assert.equal(priceSale([{ product: item(9, 30 * UM), quantity: 1 }], { kind: 'pourcentage', value: 1 }).problem?.code, 'REMISE_INVALIDE');
});

test('priceSale : plafond du gérant', () => {
  const lines = [BARREDA, CAIN, CASA].map((product) => ({ product, quantity: 1 }));
  const code = (discount, capPct) => priceSale(lines, discount, { capPct }).problem?.code ?? null;
  assert.equal(priceSale(lines, null).subtotal, 34000 * UM);
  assert.equal(code({ kind: 'pourcentage', value: 10 }, 10), null);
  assert.equal(code({ kind: 'pourcentage', value: 11 }, 10), 'PLAFOND_REMISE');
  assert.equal(code({ kind: 'montant', value: 3400 * UM }, 10), null);
  assert.equal(code({ kind: 'montant', value: 3500 * UM }, 10), 'PLAFOND_REMISE');
  assert.equal(code({ kind: 'pourcentage', value: 1 }, 0), 'PLAFOND_REMISE');
  assert.equal(code({ kind: 'pourcentage', value: 50 }, null), null);
  assert.equal(priceSale(lines, { kind: 'pourcentage', value: 11 }, { capPct: 10 }).problem.message,
    'Remise au-delà du plafond du gérant : 10 % du total au maximum.');
});

test('discountLabel', () => {
  assert.equal(discountLabel('pourcentage', 10), 'Remise 10 %');
  assert.equal(discountLabel('montant', 500000), 'Remise');
});

test('priceSale : sans remise', () => {
  const r = priceSale([{ product: COUPE, quantity: 5 }], null);
  assert.equal(r.problem, null);
  assert.equal(r.discount, 0);
  assert.equal(r.subtotal, 16000 * UM);
  assert.equal(r.total, r.subtotal);
  assert.deepEqual(r.lines.map((l) => [l.discount, l.amount]), [[0, 16000 * UM]]);
});

test('priceSale : panier vide, aucune remise à refuser', () => {
  const r = priceSale([], { kind: 'pourcentage', value: 10 });
  assert.deepEqual({ problem: r.problem, discount: r.discount, total: r.total, lines: r.lines }, { problem: null, discount: 0, total: 0, lines: [] });
});
