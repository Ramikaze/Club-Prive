// « Compter la caisse » counts the cash note by note and coin by coin (src/components/cash/cashCount.js): the notes and
// coins offered, the total they make, an untouched count, and the lines that are not a whole number.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DENOMINATIONS, cashTotal, parseCount } from '../src/components/cash/cashCount.js';

test('comptage : les billets puis les pièces, du plus grand au plus petit', () => {
  assert.deepEqual(DENOMINATIONS.map((d) => d.value), [10000, 5000, 2000, 1000, 500, 100, 50, 25]);
  assert.equal(DENOMINATIONS.find((d) => d.value === 500).kind, 'billet ou pièce');
});

test('comptage : un nombre par ligne, vide = 0, espaces acceptés', () => {
  assert.equal(parseCount(''), 0);
  assert.equal(parseCount('  '), 0);
  assert.equal(parseCount(undefined), 0);
  assert.equal(parseCount('12'), 12);
  assert.equal(parseCount('1 200'), 1200);
  for (const bad of ['-1', '2,5', '1.5', 'abc', '3 billets']) assert.equal(parseCount(bad), null, bad);
});

test('comptage : le total des espèces est la somme nombre × valeur, en centimes comme tout montant', () => {
  const r = cashTotal({ 10000: '3', 500: '2', 25: '4' });
  assert.deepEqual(r, { total: 3_110_000, filled: true, invalid: [] });
  assert.equal(cashTotal({ 10000: '70', 1000: '36', 25: '2' }).total, 73_605_000);
});

test('comptage : rien de saisi = espèces non comptées', () => {
  assert.deepEqual(cashTotal({}), { total: 0, filled: false, invalid: [] });
  assert.deepEqual(cashTotal({ 1000: '  ' }), { total: 0, filled: false, invalid: [] });
});

test('comptage : un zéro saisi compte (caisse vide comptée)', () => {
  assert.deepEqual(cashTotal({ 10000: '0' }), { total: 0, filled: true, invalid: [] });
});

test('comptage : une ligne invalide est signalée par sa valeur', () => {
  const r = cashTotal({ 5000: '2', 100: 'x', 50: '-3' });
  assert.equal(r.filled, true);
  assert.deepEqual(r.invalid, ['100', '50']);
  assert.equal(r.total, 1_000_000);
});
