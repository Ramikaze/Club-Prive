// Amounts typed by the cashier (src/lib/moneyText.js): text -> hundredths, hundredths -> text, and the foreign-currency display.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseMoney, toMajor } from '../src/lib/moneyText.js';
import { formatForeign } from '../shared/suppliers.js';

test('montant saisi : espaces et virgule décimale', () => {
  assert.equal(parseMoney('25 000'), 2500000);
  assert.equal(parseMoney('25000,5'), 2500050);
  assert.equal(parseMoney('25000,50'), 2500050);
  assert.equal(parseMoney('25 000,05'), 2500005);
  assert.equal(parseMoney('0'), 0);
});

test('montant saisi : espace insécable et fine insécable comme séparateur de milliers', () => {
  assert.equal(parseMoney('25 000'), 2500000);
  assert.equal(parseMoney('25 000'), 2500000);
  assert.equal(parseMoney('1 000 000,5'), 100000050);
});

test('montant saisi : un montant invalide donne null, jamais un faux montant', () => {
  for (const bad of ['', '  ', 'abc', '1.234', '12,345', '-5', '5,', '1 2 3,4,5', '.5', '1,2,3']) {
    assert.equal(parseMoney(bad), null, JSON.stringify(bad));
  }
  assert.equal(parseMoney(undefined), null);
  assert.equal(parseMoney(null), null);
});

test('montant affiché : entier sans décimales, sinon deux décimales à la virgule', () => {
  assert.equal(toMajor(2500000), '25000');
  assert.equal(toMajor(2500050), '25000,50');
  assert.equal(toMajor(5), '0,05');
  assert.equal(toMajor(0), '0');
  assert.equal(toMajor(null), '');
  assert.equal(toMajor(undefined), '');
});

test('montant : saisir ce qui est affiché redonne le même montant', () => {
  for (const x of [0, 1, 99, 100, 2500050, 123456789]) assert.equal(parseMoney(toMajor(x)), x, String(x));
});

test('devise étrangère : symbole, séparateur de milliers insécable fin, décimales seulement s’il y a des centimes', () => {
  assert.equal(formatForeign(0, 'EUR'), '0 €');
  assert.equal(formatForeign(100050, 'EUR'), '1 000,50 €');
  assert.equal(formatForeign(100000, 'USD'), '1 000 $');
  assert.equal(formatForeign(-100050, 'EUR'), '-1 000,50 €');
  assert.equal(formatForeign(100, 'XOF'), '1 XOF');
});
