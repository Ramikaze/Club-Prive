// Sorting of the staff tables by a click on a column header (src/components/ui/Sortable.jsx). Pure, so the tests
// run it without React. A column gives each row a value: a number (amounts in hundredths, counts, isoTime() of a
// date) or a text, compared in French (accents and capitals do not count, « C-0002 » comes before « C-0010 »).
const collator = new Intl.Collator('fr', { numeric: true, sensitivity: 'base' });

const isEmpty = (v) => v === null || v === undefined || v === '' || (typeof v === 'number' && Number.isNaN(v));

// A date or date-time from the server (ISO text) as a number of milliseconds; null when there is none.
export function isoTime(iso) {
  if (!iso) return null;
  const t = Date.parse(iso);
  return Number.isNaN(t) ? null : t;
}

function compare(a, b) {
  const x = typeof a === 'boolean' ? Number(a) : a;
  const y = typeof b === 'boolean' ? Number(b) : b;
  if (typeof x === 'number' && typeof y === 'number') return x - y;
  return collator.compare(String(x), String(y));
}

// A sorted copy of `rows`. Empty cells always go last, whatever the direction; equal rows keep their order.
export function sortRows(rows, get, dir = 'asc') {
  const sign = dir === 'desc' ? -1 : 1;
  return rows
    .map((row, i) => ({ row, i, v: get(row) }))
    .sort((p, q) => {
      const pe = isEmpty(p.v);
      const qe = isEmpty(q.v);
      if (pe || qe) return pe === qe ? p.i - q.i : pe ? 1 : -1;
      return sign * compare(p.v, q.v) || p.i - q.i;
    })
    .map((p) => p.row);
}

// A click on a header: a new column sorts ascending; the sorted column flips direction.
export const nextSort = (sort, key) => (sort?.key === key && sort.dir === 'asc' ? { key, dir: 'desc' } : { key, dir: 'asc' });
