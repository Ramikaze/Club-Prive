import { test } from 'node:test';
import assert from 'node:assert/strict';
import { supplementAmount, bookingWindow, placeInWindow, validateHours, depositFor, isWeekend } from '../shared/rules.js';
import { localToUtcMs, localParts, addMonths, addDays, monthsElapsed, parseHHMM } from '../shared/time.js';

const TARIFF = { hour: 2500000, half: 1500000 }; // 25 000 / 15 000 in hundredths

test('grille du temps supplémentaire : heure complète puis demi-heure', () => {
  assert.equal(supplementAmount(0, TARIFF), 0);
  assert.equal(supplementAmount(30, TARIFF), 1500000); // 15 000
  assert.equal(supplementAmount(60, TARIFF), 2500000); // 25 000
  assert.equal(supplementAmount(90, TARIFF), 4000000); // 40 000
  assert.equal(supplementAmount(120, TARIFF), 5000000);
  assert.equal(supplementAmount(150, TARIFF), 6500000);
});

test('pas d’horaires d’ouverture : la journée va de 06:00 à 06:00, la salle se réserve à toute heure', () => {
  const win = bookingWindow({ open: '06:00' });
  assert.deepEqual(win, { open: 360, close: 1800, maxEnd: 1800 });
  const tz = 'Africa/Brazzaville';
  const evening = localToUtcMs('2026-10-16', '22:00', tz);
  const night = placeInWindow(evening, evening + 210 * 60000, tz, win);
  assert.equal(night.bizDay, '2026-10-16');
  assert.equal(night.endRel, 1530); // 01:30 the next day
  const dawn = localToUtcMs('2026-10-17', '04:00', tz);
  assert.equal(placeInWindow(dawn, dawn + 3600000, tz, win).bizDay, '2026-10-16'); // still the night of the 16th
  const morning = localToUtcMs('2026-10-17', '08:00', tz);
  assert.equal(placeInWindow(morning, morning + 3600000, tz, win).bizDay, '2026-10-17');
  assert.equal(validateHours({ open: '06:00' }), null);
  assert.notEqual(validateHours({ open: '25:00' }), null);
});

test('fuseau horaire configurable, y compris avec heure d’été', () => {
  const paris = localToUtcMs('2026-07-01', '10:00', 'Europe/Paris');
  assert.equal(new Date(paris).toISOString(), '2026-07-01T08:00:00.000Z');
  const winter = localToUtcMs('2026-12-01', '10:00', 'Europe/Paris');
  assert.equal(new Date(winter).toISOString(), '2026-12-01T09:00:00.000Z');
  assert.equal(localParts(paris, 'Europe/Paris').time, '10:00');
  const brazza = localToUtcMs('2026-10-16', '00:30', 'Africa/Brazzaville');
  assert.equal(new Date(brazza).toISOString(), '2026-10-15T23:30:00.000Z');
});

test('calendrier : mois, jours, heures', () => {
  assert.equal(addMonths('2026-01-31', 1), '2026-02-28');
  assert.equal(addDays(addMonths('2026-10-16', 1), -1), '2026-11-15');
  assert.equal(addDays(addMonths('2026-10-16', 12), -1), '2027-10-15');
  assert.equal(monthsElapsed('2026-01-15', '2026-03-14'), 1);
  assert.equal(parseHHMM('24:00'), 1440);
  assert.equal(parseHHMM('24:30'), null);
});

test('acompte et soirées du vendredi et du samedi', () => {
  assert.equal(depositFor(240, 5000000), 2500000); // half of the paid time
  assert.equal(depositFor(240, 0), 0); // all covered by the credit: no deposit
  assert.equal(depositFor(150, 5000000), 0); // under 3 hours: no deposit
  assert.equal(isWeekend('2026-10-23', 18 * 60), true); // Friday 18:00
  assert.equal(isWeekend('2026-10-23', 17 * 60 + 30), false); // Friday 17:30
  assert.equal(isWeekend('2026-10-24', 1440 + 60), true); // Saturday night, 01:00 on Sunday
  assert.equal(isWeekend('2026-10-25', 20 * 60), false); // Sunday evening
});
