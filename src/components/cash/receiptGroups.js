// How « Argent encaissé » sorts its rows: each operation in its group (by nature), the cancelled ones apart in one
// fold, what the member's card paid apart too, and what each row counts in the total, as receiptSummary counts it,
// so the groups add up to the total. Pure: no store, no clock (`dayOf` gives the business day of an instant), so
// test/receipt-groups.test.js runs it under node.
import { cancelledBy, cashOf, isSale, paymentAdds, saleCashByAccount } from './flows.js';
import { RAYONS } from '../../../shared/roles.js';

// The groups, in this order.
export const RECEIPT_GROUPS = [['abonnement', 'Abonnements'], ['vente', 'Ventes et réservations'], ['boutique', 'Boutique'],
  ['repas', 'Livraisons repas'], ['recharge', 'Recharges cartes'], ['entree', 'Entrées diverses'], ['refund', 'Remboursements']];

function natureOf(row) {
  if (row.type === 'entry') return 'entree';
  if (row.type === 'refund') return cashOf(row.r) === 0 ? 'card' : row.r.shop_sale_id ? 'boutique' : 'refund';
  const { p } = row;
  if (cashOf(p) === 0) return 'card';
  if (p.shop_sale_id) return 'boutique';
  return ['abonnement', 'recharge', 'repas'].includes(p.kind) ? p.kind : 'vente';
}

function countedOf(row, to, dayOf) {
  if (row.type === 'entry') return row.e.status === 'active' ? row.e.amount : 0;
  if (row.type === 'refund') return -cashOf(row.r);
  const { p } = row;
  if (p.kind === 'recharge') return paymentAdds(p, to, dayOf);
  if (p.kind === 'repas') return cancelledBy(p, to, dayOf) ? 0 : cashOf(p);
  return Object.values(saleCashByAccount(p)).reduce((a, b) => a + b, 0);
}

// A cancelled row, struck through: a ledger entry no longer active, or a recharge or an outside meal cancelled
// within the period whose money was received (it gave it back). A sale is never struck: its cancellation is a refund.
export function isCancelledRow(row, to, dayOf) {
  if (row.type === 'entry') return row.e.status !== 'active';
  if (row.type !== 'payment') return false;
  const { p } = row;
  return !isSale(p) && cancelledBy(p, to, dayOf) && cashOf(p) > 0;
}

// The rows (sorted, newest first) split: the cancelled ones first, then what the card paid, then the groups, each
// with what it counts; a group with no row left is dropped.
export function splitReceipts(rows, to, dayOf) {
  const cancelled = [];
  const byCard = [];
  const lists = new Map(RECEIPT_GROUPS.map(([nature]) => [nature, []]));
  for (const row of rows) {
    if (isCancelledRow(row, to, dayOf)) cancelled.push(row);
    else if (natureOf(row) === 'card') byCard.push(row);
    else lists.get(natureOf(row)).push(row);
  }
  const groups = RECEIPT_GROUPS.map(([nature, label]) => {
    const list = lists.get(nature);
    return { nature, label, list, amount: list.reduce((s, row) => s + countedOf(row, to, dayOf), 0) };
  }).filter((g) => g.list.length);
  return { groups, cancelled, byCard };
}

// The Boutique group's money by rayon (the sales less what their cancellations gave back), the empty rayons left out.
export function shopRayons(group) {
  const by = Object.fromEntries(RAYONS.map((a) => [a, 0]));
  for (const row of group.list) {
    const account = row.type === 'refund' ? row.r.account : row.p.shop_account;
    if (account in by) by[account] += row.type === 'refund' ? -cashOf(row.r) : Object.values(saleCashByAccount(row.p)).reduce((a, b) => a + b, 0);
  }
  return RAYONS.filter((a) => by[a] !== 0).map((account) => ({ account, amount: by[account] }));
}
