// Sorting of the staff tables by a click on a column header (src/lib/sort.js): French text, numbers, dates.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isoTime, nextSort, sortRows } from '../src/lib/sort.js';

const names = (rows) => rows.map((r) => r.name);

test('texte en français : accents et majuscules ne comptent pas, les numéros se suivent dans l’ordre', () => {
  const rows = [{ name: 'Eric' }, { name: 'émile' }, { name: 'Élodie' }, { name: 'zoé' }, { name: 'Albert' }];
  assert.deepEqual(names(sortRows(rows, (r) => r.name, 'asc')), ['Albert', 'Élodie', 'émile', 'Eric', 'zoé']);
  assert.deepEqual(names(sortRows(rows, (r) => r.name, 'desc')), ['zoé', 'Eric', 'émile', 'Élodie', 'Albert']);
  const refs = [{ name: 'C-0010' }, { name: 'C-0002' }, { name: 'C-0001' }];
  assert.deepEqual(names(sortRows(refs, (r) => r.name, 'asc')), ['C-0001', 'C-0002', 'C-0010']);
});

test('nombres et montants en centimes : ordre numérique, pas alphabétique', () => {
  const rows = [{ name: 'a', v: 900 }, { name: 'b', v: 10000 }, { name: 'c', v: -500 }, { name: 'd', v: 0 }];
  assert.deepEqual(names(sortRows(rows, (r) => r.v, 'asc')), ['c', 'd', 'a', 'b']);
  assert.deepEqual(names(sortRows(rows, (r) => r.v, 'desc')), ['b', 'a', 'd', 'c']);
});

test('dates : du plus ancien au plus récent, puis l’inverse', () => {
  const rows = [
    { name: 'midi', at: '2026-11-17T12:00:00.000Z' },
    { name: 'veille', at: '2026-11-16T23:59:00.000Z' },
    { name: 'matin', at: '2026-11-17T09:05:00.000Z' },
  ];
  assert.deepEqual(names(sortRows(rows, (r) => isoTime(r.at), 'asc')), ['veille', 'matin', 'midi']);
  assert.deepEqual(names(sortRows(rows, (r) => isoTime(r.at), 'desc')), ['midi', 'matin', 'veille']);
  assert.equal(isoTime(null), null);
  assert.equal(isoTime(''), null);
  assert.ok(isoTime('2026-11-17') < isoTime('2026-11-18'));
});

test('cases vides toujours en dernier, dans les deux sens', () => {
  const rows = [{ name: 'vide', v: null }, { name: 'deux', v: 2 }, { name: 'rien', v: '' }, { name: 'un', v: 1 }, { name: 'absent' }];
  assert.deepEqual(names(sortRows(rows, (r) => r.v, 'asc')), ['un', 'deux', 'vide', 'rien', 'absent']);
  assert.deepEqual(names(sortRows(rows, (r) => r.v, 'desc')), ['deux', 'un', 'vide', 'rien', 'absent']);
});

test('à égalité, les lignes gardent leur ordre d’origine', () => {
  const rows = [{ name: 'premier', v: 5 }, { name: 'deuxième', v: 5 }, { name: 'troisième', v: 1 }, { name: 'quatrième', v: 5 }];
  assert.deepEqual(names(sortRows(rows, (r) => r.v, 'asc')), ['troisième', 'premier', 'deuxième', 'quatrième']);
  assert.deepEqual(names(sortRows(rows, (r) => r.v, 'desc')), ['premier', 'deuxième', 'quatrième', 'troisième']);
});

test('le tableau reçu n’est pas modifié', () => {
  const rows = [{ name: 'b' }, { name: 'a' }];
  sortRows(rows, (r) => r.name, 'asc');
  assert.deepEqual(names(rows), ['b', 'a']);
});

test('clic sur un en-tête : croissant, puis décroissant, puis de nouveau croissant ; autre colonne : croissant', () => {
  let sort = null;
  sort = nextSort(sort, 'nom');
  assert.deepEqual(sort, { key: 'nom', dir: 'asc' });
  sort = nextSort(sort, 'nom');
  assert.deepEqual(sort, { key: 'nom', dir: 'desc' });
  sort = nextSort(sort, 'nom');
  assert.deepEqual(sort, { key: 'nom', dir: 'asc' });
  sort = nextSort({ key: 'nom', dir: 'desc' }, 'montant');
  assert.deepEqual(sort, { key: 'montant', dir: 'asc' });
});
