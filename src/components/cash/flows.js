// The cash page's figures, on one basis: the money actually received or paid out in the period, on one treasury
// account or on all of them (method '' for all). The part of a payment taken from the member's card is no money
// received: it came in with the recharge. These are the treasury's rules (worker/ledger.js, cashFlows), applied
// to what the page loads (the cash journal and the ledger entries of the period), so that the Recettes and
// Dépenses blocks add up to the figures of « Soldes ». Pure: no store, no clock (`dayOf` gives the business day of
// an instant), so test/cash-flows.test.js runs it on the server's answers.
import { CARD_METHOD } from '../../../shared/rules.js';

export const ACCOUNTS = ['reservations', 'alcool', 'cigares'];

// On the account shown: all of them, or this one.
export const onAccount = (method, m) => !method || m === method;

// The money received for a payment or given back for a refund: the card's part left out.
export const cashOf = (x) => x.amount - (x.card_amount ?? 0);

export const isSale = (p) => p.kind !== 'recharge' && p.kind !== 'repas';

// A sale's money by sub-account: the card's part is spread over its lines in order and left out, as the general
// ledger does.
export function saleCashByAccount(p) {
  const by = Object.fromEntries(ACCOUNTS.map((k) => [k, 0]));
  let card = p.card_amount ?? 0;
  for (const a of p.allocations ?? []) {
    const fromCard = Math.min(card, a.amount);
    card -= fromCard;
    by[a.account] += a.amount - fromCard;
  }
  return by;
}

// A recharge or an outside meal cancelled within the period gives its money back in the period (the treasury
// counts it out on the cancellation's day): it adds nothing. Cancelled after the period, it still counts there.
export const cancelledBy = (p, to, dayOf) => !!p.cancelled_at && dayOf(p.cancelled_at) <= to;

// What a payment of the journal adds to the recettes: 0 for a recharge or a meal cancelled within the period, the
// money received otherwise (0 when the card paid it all).
export const paymentAdds = (p, to, dayOf) => (!isSale(p) && cancelledBy(p, to, dayOf) ? 0 : cashOf(p));

// The recettes of the period by type, and their total: what was received, less what was given back. The card's
// part of the payments is shown apart (`card`), not counted.
export function receiptSummary(journal, entries, { method = '', to, dayOf }) {
  const by = Object.fromEntries(ACCOUNTS.map((k) => [k, 0]));
  let meals = 0;
  let recharges = 0;
  let card = 0;
  for (const p of journal.payments) {
    if (!onAccount(method, p.method)) continue;
    if (p.kind === 'recharge') recharges += paymentAdds(p, to, dayOf);
    else if (p.kind === 'repas') {
      if (cancelledBy(p, to, dayOf)) continue;
      meals += cashOf(p);
      card += p.card_amount ?? 0;
    } else {
      for (const [k, v] of Object.entries(saleCashByAccount(p))) by[k] += v;
      card += p.card_amount ?? 0;
    }
  }
  const refunds = journal.refunds.filter((r) => onAccount(method, r.method)).reduce((s, r) => s + cashOf(r), 0);
  const other = entries.filter((e) => e.kind === 'recette' && e.status === 'active' && onAccount(method, e.method))
    .reduce((s, e) => s + e.amount, 0);
  const lines = [
    ['Réservations', by.reservations, 'reservations'], ['Alcool', by.alcool, 'alcool'], ['Cigares', by.cigares, 'cigares'],
    ['Repas extérieurs', meals], ['Approvisionnements cartes', recharges], ['Entrées diverses', other],
  ];
  return { lines, refunds, card, total: lines.reduce((s, [, v]) => s + v, 0) - refunds };
}

// The expenses of the period on the account shown (active ones only).
export const expenseTotal = (entries, method = '') => entries
  .filter((e) => e.kind === 'depense' && e.status === 'active' && onAccount(method, e.method))
  .reduce((s, e) => s + e.amount, 0);

// Transfers received and sent by the account shown; on all accounts, both are the sum of the transfers.
export function transferTotals(entries, method = '') {
  let received = 0;
  let sent = 0;
  for (const e of entries) {
    if (e.kind !== 'transfert' || e.status !== 'active') continue;
    if (onAccount(method, e.to_method)) received += e.amount;
    if (onAccount(method, e.method)) sent += e.amount;
  }
  return { received, sent };
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

// « Soldes » from the treasury (GET /api/treasury): the cash fund, the recettes and dépenses as the blocks read
// them, and the closing balance. The treasury counts a transfer in and out, a refund or a cancelled recharge or
// meal out, and the opening balances, when set within the period, in or out: here the transfers are shown apart,
// what was given back comes off the recettes, and the opening balances are the cash fund. So, on all accounts,
// fund + recettes − dépenses = closing; on one account, plus the transfers received, less those sent.
export function tillFigures(t, method, { entries, journal, openingBalances, dayOf }) {
  const shown = method ? t.accounts.filter((x) => x.method === method) : t.accounts;
  let opening = 0;
  let inflow = 0;
  let outflow = 0;
  for (const x of shown) {
    opening += x.opening;
    inflow += x.in;
    outflow += x.out;
  }
  const ob = openingBalances;
  if (ob?.date && ob.date >= t.from && ob.date <= t.to) {
    for (const x of shown) {
      const initial = ob.amounts?.[x.method] ?? 0;
      opening += initial;
      inflow -= Math.max(initial, 0);
      outflow -= Math.max(-initial, 0);
    }
  }
  const { received, sent } = transferTotals(entries, method);
  let given = journal.refunds.filter((r) => r.method !== CARD_METHOD && onAccount(method, r.method)).reduce((s, r) => s + cashOf(r), 0);
  for (const p of journal.payments) {
    if (!isSale(p) && cancelledBy(p, t.to, dayOf) && onAccount(method, p.method)) given += cashOf(p);
  }
  const closing = shown.reduce((s, x) => s + x.closing, 0);
  return { opening, in: inflow - received - given, out: outflow - sent - given, received, sent, closing };
}
