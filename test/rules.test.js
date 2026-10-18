import { test } from 'node:test';
import assert from 'node:assert/strict';
import { supplementAmount, bookingWindow, placeInWindow, validateHours } from '../shared/rules.js';
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

test('fenêtre horaire : 10:00 – 24:00, prolongation possible jusqu’à 05:00', () => {
  const win = bookingWindow({ open: '10:00', close: '24:00', max_end: '05:00' });
  assert.deepEqual(win, { open: 600, close: 1440, maxEnd: 1740 });
  const tz = 'Africa/Brazzaville';
  const start = localToUtcMs('2026-10-16', '22:00', tz);
  const inHours = placeInWindow(start, start + 90 * 60000, tz, win);
  assert.equal(inHours.inWindow, true);
  assert.equal(inHours.offHours, false);
  const pastMidnight = placeInWindow(start, start + 210 * 60000, tz, win);
  assert.equal(pastMidnight.bizDay, '2026-10-16');
  assert.equal(pastMidnight.endRel, 1530); // 01:30 the next day
  assert.equal(pastMidnight.offHours, true);
  assert.equal(pastMidnight.inWindow, true);
  const tooLate = placeInWindow(start, start + 8 * 3600000, tz, win);
  assert.equal(tooLate.inWindow, false);
  assert.equal(validateHours({ open: '10:00', close: '09:00', max_end: '05:00' }) !== null, true);
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
