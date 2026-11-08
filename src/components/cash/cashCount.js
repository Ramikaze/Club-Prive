// « Compter la caisse »: the cash is counted note by note and coin by coin (FCFA of the BEAC), the biggest first. A 500
// exists as a note and as a coin: one line counts both. The total is what the till holds.

export const DENOMINATIONS = [
  { value: 10000, label: '10 000', kind: 'billet' },
  { value: 5000, label: '5 000', kind: 'billet' },
  { value: 2000, label: '2 000', kind: 'billet' },
  { value: 1000, label: '1 000', kind: 'billet' },
  { value: 500, label: '500', kind: 'billet ou pièce' },
  { value: 100, label: '100', kind: 'pièce' },
  { value: 50, label: '50', kind: 'pièce' },
  { value: 25, label: '25', kind: 'pièce' },
];

// How many of one note or coin: a whole number from 0 up (spaces allowed, « 1 200 »); an empty line is 0; anything
// else (negative, decimal, words) is null.
export function parseCount(text) {
  const s = String(text ?? '').replace(/\s/g, '');
  if (s === '') return 0;
  return /^\d{1,7}$/.test(s) ? Number(s) : null;
}

// One line's amount in centimes, the unit of every amount in the app (money(), parseMoney(), the server).
export const lineAmount = (value, count) => value * count * 100;

// The cash counted from what was typed on each line ({ 10000: '3', 500: '2' }): the total in centimes, whether anything
// was typed at all (an untouched cash count is not recorded; a typed 0 is), and the lines that are not a whole number,
// by label.
export function cashTotal(counts) {
  let total = 0;
  let filled = false;
  const invalid = [];
  for (const d of DENOMINATIONS) {
    const raw = counts?.[d.value];
    if (String(raw ?? '').trim() !== '') filled = true;
    const n = parseCount(raw);
    if (n === null) invalid.push(d.label);
    else total += lineAmount(d.value, n);
  }
  return { total, filled, invalid };
}
