// « Journées à vérifier » (src/components/cash/dayLinks.js): a day of the list opens the cash page on that day alone,
// scrolled to « Recette du jour par catégorie », whose bar closes and verifies the day shown.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { dayLink, closingDayOf } from '../src/components/cash/dayLinks.js';

test('dayLink : la caisse de ce jour-là, à la recette par catégorie', () => {
  assert.equal(dayLink('2026-11-18'), '/caisse?from=2026-11-18&to=2026-11-18&type=jour');
});

test('closingDayOf : le jour affiché, sinon aujourd’hui', () => {
  assert.equal(closingDayOf('2026-11-18', '2026-11-18', '2026-11-21'), '2026-11-18');
  assert.equal(closingDayOf('2026-11-21', '2026-11-21', '2026-11-21'), '2026-11-21');
  assert.equal(closingDayOf('2026-11-16', '2026-11-21', '2026-11-21'), '2026-11-21');
});
