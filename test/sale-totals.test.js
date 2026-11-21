// The sale screen's figures (src/components/shop/saleTotals.js): the discount as typed in the cart, read as the server
// will read it, and the cart priced with shared/pricing.js, so the screen shows the total the server records.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { discountOf, cartTotals } from '../src/components/shop/saleTotals.js';

const UM = 100;
const COUPE = { id: 1, price: 5000 * UM, lot_qty: 3, lot_price: 10000 * UM, extra_price: 3000 * UM };
const BARREDA = { id: 2, price: 12500 * UM, lot_qty: null, lot_price: null, extra_price: null };

test('discountOf : la remise telle que tapée', () => {
  assert.deepEqual(discountOf({ kind: 'montant', input: '5 000' }), { kind: 'montant', value: 500000 });
  assert.deepEqual(discountOf({ kind: 'pourcentage', input: '10' }), { kind: 'pourcentage', value: 10 });
  assert.equal(discountOf({ kind: 'pourcentage', input: '' }), null);
  assert.equal(discountOf({ kind: 'montant', input: '  ' }), null);
  assert.ok(Number.isNaN(discountOf({ kind: 'pourcentage', input: '1,5' }).value));
  assert.ok(Number.isNaN(discountOf({ kind: 'montant', input: 'dix' }).value));
  assert.equal(discountOf(null), null);
});

test('cartTotals : lot et remise', () => {
  const cart = { lines: { 1: 4, 2: 1 }, discount: { kind: 'pourcentage', input: '10' } };
  const t = cartTotals([COUPE, BARREDA], cart, null);
  assert.equal(t.problem, null);
  assert.equal(t.subtotal, 25500 * UM);
  assert.equal(t.total, 22950 * UM);
  assert.deepEqual(t.lines.map((l) => [l.product_id, l.price, l.lot]), [[1, 13000 * UM, true], [2, 12500 * UM, false]]);
  // Without a discount, and with products the cart does not hold.
  assert.equal(cartTotals([COUPE, BARREDA], { lines: { 2: 2 }, discount: null }, null).total, 25000 * UM);
});

test('cartTotals : remise devenue trop forte', () => {
  const t = cartTotals([{ ...BARREDA, price: 100 * UM }], { lines: { 2: 1 }, discount: { kind: 'montant', input: '100' } }, null);
  assert.equal(t.problem.code, 'REMISE_TROP_FORTE');
  assert.equal(t.total, 100 * UM);
});

test('cartTotals : plafond', () => {
  const t = cartTotals([BARREDA], { lines: { 2: 1 }, discount: { kind: 'pourcentage', input: '20' } }, 10);
  assert.equal(t.problem.code, 'PLAFOND_REMISE');
});
