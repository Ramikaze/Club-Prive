// Forgiving text search, shared by the server and the browser: capitals and accents do not count, the words of the
// query may come in any order, and a word of four letters or more may carry one typo (numbers must be exact). The
// search starts at SEARCH_MIN_CHARS characters; below that, nothing is filtered.

export const SEARCH_MIN_CHARS = 2;

// 'Élodie  N'Diaye' -> 'elodie n diaye'
export function fold(value) {
  return String(value ?? '')
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}

// True when a and b differ by at most one letter added, removed, changed, or two neighbours swapped.
function oneTypo(a, b) {
  if (a === b) return true;
  if (Math.abs(a.length - b.length) > 1) return false;
  let i = 0;
  while (i < a.length && i < b.length && a[i] === b[i]) i += 1;
  if (a.length === b.length) {
    if (a.slice(i + 1) === b.slice(i + 1)) return true;
    return a[i] === b[i + 1] && a[i + 1] === b[i] && a.slice(i + 2) === b.slice(i + 2);
  }
  const [long, short] = a.length > b.length ? [a, b] : [b, a];
  return long.slice(i + 1) === short.slice(i);
}

// How well one word of the query fits the words of a text: 3 a word starts with it, 2 it is inside a word or inside
// the text, 1 a word (or the start of one) is it with one typo, 0 not found.
function wordScore(term, words, text) {
  if (words.some((w) => w.startsWith(term))) return 3;
  if (text.includes(term)) return 2;
  if (term.length >= 4 && /[a-z]/.test(term) && words.some((w) => oneTypo(term, w) || (w.length > term.length && oneTypo(term, w.slice(0, term.length))))) return 1;
  return 0;
}

// The score of a text for a query, 0 when it does not match: every word of the query must be found. `fields` are the
// texts to search, the first ones weighing more (the name before the reference or the description).
export function matchScore(query, fields) {
  const terms = fold(query).split(' ').filter(Boolean);
  if (!terms.length) return 0;
  const folded = fields.map((f) => fold(f));
  let total = 0;
  for (const term of terms) {
    let best = 0;
    folded.forEach((text, rank) => {
      if (!text) return;
      const score = wordScore(term, text.split(' '), text);
      if (score) best = Math.max(best, score * 10 - rank);
    });
    if (!best) return 0;
    total += best;
  }
  // A text that starts like the query comes first.
  if (folded[0]?.startsWith(terms.join(' '))) total += 5;
  return total;
}

// The items that match the query, best first (ties keep their order). `fieldsOf(item)` gives its texts.
export function smartFilter(items, query, fieldsOf) {
  return items
    .map((item, index) => ({ item, index, score: matchScore(query, fieldsOf(item)) }))
    .filter((r) => r.score > 0)
    .sort((x, y) => y.score - x.score || x.index - y.index)
    .map((r) => r.item);
}

// True when the query is long enough to search.
export const searchable = (query) => fold(query).replace(/ /g, '').length >= SEARCH_MIN_CHARS;
