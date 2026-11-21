// A number field of a settings form (src/lib/formNumbers.js): left empty, the setting keeps its value.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { typedNumber } from '../src/lib/formNumbers.js';

test('typedNumber : vide, rien ne change ; sinon le nombre tapé', () => {
  assert.equal(typedNumber(''), undefined);
  assert.equal(typedNumber('   '), undefined);
  assert.equal(typedNumber(undefined), undefined);
  assert.equal(typedNumber('7'), 7);
  assert.equal(typedNumber('0'), 0);
  assert.ok(Number.isNaN(typedNumber('dix')));
});
