// Column headers that sort their table: a click sorts ascending, a second click descending (src/lib/sort.js).
// Until a header is clicked the rows keep the order they came in (most often the newest first).
//   const sorter = useSort(items, { name: (c) => c.name, total: (c) => c.purchases_total, at: (c) => isoTime(c.at) });
//   <SortTh sorter={sorter} col="name">Client</SortTh> … {sorter.rows.map(…)}
// A column with no key in `columns` (« Actions ») stays a plain <th>. On a phone the headers of a .stack-sm table
// show as a row of « Trier » buttons above the cards (src/club.css).
import { useState } from 'react';
import Icon from './Icon.jsx';
import { nextSort, sortRows } from '../../lib/sort.js';

export function useSort(rows, columns) {
  const [sort, setSort] = useState(null);
  const get = sort ? columns[sort.key] : null;
  return {
    rows: get ? sortRows(rows, get, sort.dir) : rows,
    sort,
    toggle: (key) => setSort((s) => nextSort(s, key)),
  };
}

// The same, for a table drawn inside a render function (a <Loaded> page), where a hook cannot be called:
//   <Sorted rows={list} columns={…}>{(sorter) => <table>…</table>}</Sorted>
export function Sorted({ rows, columns, children }) {
  return children(useSort(rows, columns));
}

const ARIA_SORT = { asc: 'ascending', desc: 'descending' };

export function SortTh({ sorter, col, className, children }) {
  const dir = sorter.sort?.key === col ? sorter.sort.dir : null;
  return (
    <th className={className} aria-sort={dir ? ARIA_SORT[dir] : undefined}>
      <button
        type="button"
        className={`th-sort${dir ? ' is-sorted' : ''}`}
        onClick={() => sorter.toggle(col)}
        title={dir === 'asc' ? 'Trier en ordre décroissant' : 'Trier en ordre croissant'}
      >
        <span>{children}</span>
        <Icon name={dir ? `sort-${dir}` : 'sort'} />
      </button>
    </th>
  );
}
