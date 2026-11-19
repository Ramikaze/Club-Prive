// The page area (main) takes the focus on each page load (AppShell), for screen readers. The global
// :focus-visible ring must not draw around it: after a refresh by keyboard it showed as two vertical bands.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const css = readFileSync(new URL('../src/club.css', import.meta.url), 'utf8');

test('la zone de contenu (main) n’a pas de cadre de focus', () => {
  const rule = css.match(/(^|\n)([^{}\n]*main:focus-visible[^{}\n]*)\{([^}]*)\}/);
  assert.ok(rule, 'une règle main:focus-visible existe');
  assert.match(rule[3], /box-shadow:\s*none/);
  assert.match(rule[3], /outline:\s*none/);
});
