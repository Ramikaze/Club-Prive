// The sentence under the real profit that says what it leaves out (src/components/cash/profitText.js).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { missingText } from '../src/components/cash/profitText.js';

const money = (n) => `${n / 100} F`;
const m = (sales_count, sales_amount, gifts_count) => ({ sales_count, sales_amount, gifts_count });

test('rien ne manque : pas de phrase', () => {
  assert.equal(missingText(m(0, 0, 0), money), null);
});
test('ventes sans prix de revient, au singulier et au pluriel', () => {
  assert.equal(missingText(m(1, 2000000, 0), money), '1 vente (20000 F) sans prix de revient n’est pas comptée.');
  assert.equal(missingText(m(2, 3000000, 1), money), '2 ventes (30000 F) sans prix de revient ne sont pas comptées ; 1 produit offert sans prix de revient.');
});
test('seulement l’annulation d’une vente sans prix de revient : jamais « 0 vente »', () => {
  assert.equal(missingText(m(0, -1000000, 0), money), 'Des ventes sans prix de revient annulées (-10000 F) ne sont pas comptées.');
});
