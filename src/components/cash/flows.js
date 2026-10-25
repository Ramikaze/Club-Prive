// How the cash page reads the data it loads (the cash journal and the ledger entries of the period): when each
// operation happened, the recettes and dépenses as the owner reads them, and the till's figures without the
// transfers between accounts.
import { addDays, fmtHHMM, localToUtcMs } from '../../../shared/time.js';
import { dayMonth, parts, tz, win } from '../../lib/format.js';

// The business day of an instant: before the opening hour it still belongs to the day before.
export function bizDayOf(iso) {
  const p = parts(iso);
  return p.minutes < win().open ? addDays(p.date, -1) : p.date;
}

// An instant as a row shows it: the time alone when the page shows one day, else day and time.
export const whenText = (iso, oneDay) => (oneDay ? parts(iso).time : `${dayMonth(iso)} ${parts(iso).time}`);

// An entry typed on its own day keeps its time; a backdated one sits at the start of its day and shows its day
// only (as in the general ledger).
export function entryWhen(e, oneDay) {
  if (bizDayOf(e.created_at) === e.biz_date) return { ms: Date.parse(e.created_at), text: whenText(e.created_at, oneDay) };
  return { ms: localToUtcMs(e.biz_date, fmtHHMM(win().open), tz()), text: `${e.biz_date.slice(8, 10)}/${e.biz_date.slice(5, 7)}` };
}

const isSale = (p) => p.kind !== 'recharge' && p.kind !== 'repas';

// The recettes of the period by type. The money put on the members' cards is shown apart, out of the total: it
// becomes a recette when the member spends it (on a sub-account or an outside meal).
export function receiptSummary(journal, entries) {
  const by = { reservations: 0, alcool: 0, cigares: 0 };
  let meals = 0;
  let recharges = 0;
  for (const p of journal.payments) {
    if (p.cancelled_at) continue;
    if (p.kind === 'recharge') recharges += p.amount;
    else if (p.kind === 'repas') meals += p.amount;
    else for (const [k, v] of Object.entries(p.by_account)) by[k] += v;
  }
  const other = entries.filter((e) => e.kind === 'recette' && e.status === 'active').reduce((s, e) => s + e.amount, 0);
  const refunds = journal.refunds.reduce((s, r) => s + r.amount, 0);
  const lines = [
    ['Réservations', by.reservations, 'reservations'], ['Alcool', by.alcool, 'alcool'], ['Cigares', by.cigares, 'cigares'],
    ['Repas extérieurs', meals], ['Entrées diverses', other],
  ];
  return { lines, refunds, recharges, total: by.reservations + by.alcool + by.cigares + meals + other - refunds };
}

// Every recette of the period, newest first: the payments (sales, card recharges, outside meals), the refunds
// (money given back, counted negative) and the other receipts typed in the ledger.
export function receiptRows(journal, entries, oneDay) {
  const rows = [
    ...journal.payments.map((p) => ({ type: 'payment', key: `P-${p.id}`, ms: Date.parse(p.paid_at), when: whenText(p.paid_at, oneDay), p })),
    ...journal.refunds.map((r) => ({ type: 'refund', key: `R-${r.id}`, ms: Date.parse(r.created_at), when: whenText(r.created_at, oneDay), r })),
    ...entries.filter((e) => e.kind === 'recette').map((e) => {
      const w = entryWhen(e, oneDay);
      return { type: 'entry', key: `E-${e.id}`, ms: w.ms, when: w.text, e };
    }),
  ];
  return rows.sort((x, y) => y.ms - x.ms);
}

// Expenses by category, the largest first (active entries only).
export function byCategory(entries) {
  const map = new Map();
  for (const e of entries) {
    if (e.status !== 'active' || e.kind !== 'depense') continue;
    map.set(e.category_name, (map.get(e.category_name) ?? 0) + e.amount);
  }
  return [...map.entries()].sort((a, b) => b[1] - a[1]);
}

// The till's figures for one treasury account ('' for all of them). The treasury counts a transfer as money in
// on one account and out on the other, and a refund (or a cancelled recharge or meal) as money out: here the
// transfers are taken out of both figures and shown apart, and what was given back comes off the recettes, as
// the Recettes block reads them. The closing balance is the treasury's, transfers included.
export function tillFigures(t, method, entries, journal) {
  const a = (method ? t.accounts.find((x) => x.method === method) : null) ?? t.total;
  const mine = (m) => !method || m === method;
  let received = 0;
  let sent = 0;
  let given = 0;
  for (const e of entries) {
    if (e.kind !== 'transfert' || e.status !== 'active') continue;
    if (mine(e.to_method)) received += e.amount;
    if (mine(e.method)) sent += e.amount;
  }
  for (const r of journal.refunds) if (mine(r.method)) given += r.amount - (r.card_amount ?? 0);
  for (const p of journal.payments) {
    if (p.cancelled_at && !isSale(p) && bizDayOf(p.cancelled_at) <= t.to && mine(p.method)) given += p.amount - (p.card_amount ?? 0);
  }
  return { opening: a.opening, in: a.in - received - given, out: a.out - sent - given, received, sent, closing: a.closing };
}
