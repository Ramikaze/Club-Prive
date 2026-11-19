// The text of the period button on phones (src/lib/period.js): a preset's name, else the dates.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { periodButtonLabel } from '../src/lib/period.js';

const presets = [
  { key: 'today', label: 'Aujourd’hui', from: '2026-11-19', to: '2026-11-19' },
  { key: 'week', label: '7 jours', from: '2026-11-13', to: '2026-11-19' },
];

test('un préréglage : son nom', () => {
  assert.equal(periodButtonLabel('2026-11-13', '2026-11-19', presets), '7 jours');
  assert.equal(periodButtonLabel('2026-11-19', '2026-11-19', presets), 'Aujourd’hui');
});

test('un autre jour : la date', () => {
  assert.equal(periodButtonLabel('2026-11-12', '2026-11-12', presets), '12 nov.');
});

test('des dates libres dans l’année', () => {
  assert.equal(periodButtonLabel('2026-11-03', '2026-11-19', presets), '3 nov. – 19 nov.');
});

test('des dates à cheval sur deux années : les années', () => {
  assert.equal(periodButtonLabel('2025-12-28', '2026-01-03', presets), '28 déc. 2025 – 3 janv. 2026');
});
