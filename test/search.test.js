import test from 'node:test';
import assert from 'node:assert/strict';
import { fold, matchScore, searchable, smartFilter } from '../shared/search.js';

const cigars = [
  { name: 'Cain Daytona 550 (Robusto 5 x 50)', reference: 'CIG-001' },
  { name: 'Casa Turrent Origenes Cuba', reference: 'CIG-003' },
  { name: 'Château Diadem Conviction Gordo', reference: 'CIG-004' },
  { name: 'Oliva Serie V Double Robusto', reference: 'CIG-046' },
];
const names = (items) => items.map((p) => p.name);
const find = (q) => names(smartFilter(cigars, q, (p) => [p.name, p.reference]));

test('fold ôte accents, majuscules et ponctuation', () => {
  assert.equal(fold("  Élodie N'Diaye "), 'elodie n diaye');
});

test('la recherche commence à deux caractères', () => {
  assert.equal(searchable('r'), false);
  assert.equal(searchable(' ro '), true);
});

test('accents, ordre des mots et début de mot', () => {
  assert.deepEqual(find('chateau'), ['Château Diadem Conviction Gordo']);
  assert.deepEqual(find('robusto oliva'), ['Oliva Serie V Double Robusto']);
  assert.deepEqual(find('ca'), ['Cain Daytona 550 (Robusto 5 x 50)', 'Casa Turrent Origenes Cuba']);
  assert.deepEqual(find('cig-046'), ['Oliva Serie V Double Robusto']);
});

test('une faute de frappe est tolérée dans un mot de quatre lettres ou plus, pas dans un nombre', () => {
  assert.deepEqual(find('turent'), ['Casa Turrent Origenes Cuba']);
  assert.deepEqual(find('daytnoa'), ['Cain Daytona 550 (Robusto 5 x 50)']);
  assert.deepEqual(find('5501'), []);
  assert.deepEqual(find('xyz'), []);
});

test('le nom passe avant la référence, un nom qui commence comme la recherche passe en tête', () => {
  assert.ok(matchScore('cuba', ['Casa Cuba', 'X']) > matchScore('cuba', ['X', 'Casa Cuba']));
  assert.deepEqual(find('oliva'), ['Oliva Serie V Double Robusto']);
});
