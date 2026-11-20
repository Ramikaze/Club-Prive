// « Argent encaissé » and « Dépenses » rows (src/club.css): a row's amount is plain text, but a cancelled row stays
// grey all through (its struck amount too); a row's title opens its ticket, so its underline must be visible and its
// keyboard focus ring not clipped.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const css = readFileSync(new URL('../src/club.css', import.meta.url), 'utf8');
const rules = [...css.matchAll(/(^|\n)([^{}\n]+)\{([^}]*)\}/g)].map((m) => ({ selector: m[2].trim(), body: m[3] }));

test('le montant en texte simple ne touche pas une ligne annulée', () => {
  const plain = rules.filter((r) => r.selector.includes('.cash-block-plain') && r.selector.includes('.cash-amount') && /(^|;)\s*color:/.test(r.body));
  assert.ok(plain.length, 'une règle donne au montant la couleur du texte');
  for (const r of plain) assert.match(r.selector, /:not\(\.is-cancelled\)/, r.selector);
});

test('le titre-lien vers le ticket a un soulignement visible et un focus non coupé', () => {
  const link = rules.find((r) => r.selector === '.cash-block-plain .cash-row .title a');
  assert.ok(link, 'une règle pour le titre-lien existe');
  assert.match(link.body, /text-decoration-color:\s*var\(--text-3\)/);
  assert.ok(rules.some((r) => /(^|,\s*)\.cash-row \.title(\s*,|$)/.test(r.selector) && /overflow:\s*visible/.test(r.body)),
    'le titre d’une ligne de caisse ne coupe pas le cadre de focus');
});
