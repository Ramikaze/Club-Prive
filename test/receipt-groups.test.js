// How « Argent encaissé » sorts its rows (src/components/cash/receiptGroups.js), on synthetic rows: a cancelled
// operation leaves its group for the one fold of cancellations, a group left empty disappears, a recharge cancelled
// after the period still counts in its group, a sale paid by the member's card stays apart, the groups add up to
// receiptSummary's total, and the Boutique line shows only the rayons that took money.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { receiptSummary } from '../src/components/cash/flows.js';
import { isCancelledRow, shopRayons, splitReceipts } from '../src/components/cash/receiptGroups.js';

const to = '2026-11-18';
const dayOf = (iso) => iso.slice(0, 10);

// The rows as ReceiptsBlock builds them (without their « when » text), newest first.
const rowsOf = (journal, entries) => [
  ...journal.payments.map((p) => ({ type: 'payment', key: `P-${p.id}`, ms: Date.parse(p.paid_at), p })),
  ...journal.refunds.map((r) => ({ type: 'refund', key: `R-${r.id}`, ms: Date.parse(r.created_at), r })),
  ...entries.filter((e) => e.kind === 'recette').map((e) => ({ type: 'entry', key: `E-${e.id}`, ms: Date.parse(e.created_at), e })),
].sort((x, y) => y.ms - x.ms);

const entry = (id, amount, status = 'active') => ({
  id, kind: 'recette', status, amount, method: 'Espèces', created_at: `2026-11-18T1${id}:00:00Z`, label: `Entrée ${id}`,
});
const sale = (id, amount, extra = {}) => ({
  id, kind: 'produit', amount, card_amount: 0, method: 'Espèces', paid_at: `2026-11-18T1${id}:00:00Z`,
  allocations: [{ account: 'reservations', amount, label: 'Table', quantity: 1 }], ...extra,
});
const shopSale = (id, amount, account) => sale(id, amount, {
  shop_sale_id: 100 + id, shop_account: account, allocations: [{ account, amount, label: 'Produit', quantity: 1 }],
});
const recharge = (id, amount, cancelled_at) => ({
  id, kind: 'recharge', amount, card_amount: 0, method: 'Espèces', paid_at: `2026-11-18T0${id}:00:00Z`, cancelled_at,
});
const split = (journal, entries) => splitReceipts(rowsOf(journal, entries), to, dayOf);
const group = (res, nature) => res.groups.find((g) => g.nature === nature);

test("annulation d'une entrée diverse", () => {
  const res = split({ payments: [], refunds: [] }, [entry(1, 100, 'cancelled'), entry(2, 597500)]);
  assert.equal(res.cancelled.length, 1);
  assert.equal(res.cancelled[0].e.id, 1);
  assert.equal(group(res, 'entree').list.length, 1);
  assert.equal(group(res, 'entree').amount, 597500);
});

test('groupe vide retiré', () => {
  const res = split({ payments: [], refunds: [] }, [entry(1, 100, 'cancelled')]);
  assert.equal(group(res, 'entree'), undefined);
  assert.equal(res.groups.length, 0);
  assert.equal(res.cancelled.length, 1);
});

test('recharge annulée dans / après la période', () => {
  const within = recharge(1, 50000, '2026-11-18T20:00:00Z');
  const after = recharge(2, 30000, '2026-11-19T09:00:00Z');
  const res = split({ payments: [within, after], refunds: [] }, []);
  assert.deepEqual(res.cancelled.map((row) => row.p.id), [1]);
  assert.deepEqual(group(res, 'recharge').list.map((row) => row.p.id), [2]);
  assert.equal(group(res, 'recharge').amount, 30000);
  assert.equal(isCancelledRow(res.cancelled[0], to, dayOf), true);
});

test('vente payée par carte', () => {
  const byCard = sale(1, 40000, { card_amount: 40000 });
  const res = split({ payments: [byCard], refunds: [] }, []);
  assert.deepEqual(res.byCard.map((row) => row.p.id), [1]);
  assert.equal(res.cancelled.length, 0);
  assert.equal(res.groups.length, 0);
});

test('somme des groupes = receiptSummary', () => {
  const journal = {
    payments: [sale(1, 120000), sale(2, 80000, { card_amount: 30000 }), shopSale(3, 241500, 'cigares'),
      recharge(4, 50000, '2026-11-18T20:00:00Z'), recharge(5, 25000, null)],
    refunds: [{ id: 1, amount: 20000, card_amount: 0, method: 'Espèces', created_at: '2026-11-18T19:00:00Z', payment_id: 1, label: 'Table' }],
  };
  const entries = [entry(6, 100, 'cancelled'), entry(7, 597500)];
  const res = split(journal, entries);
  const sum = res.groups.reduce((s, g) => s + g.amount, 0);
  assert.equal(sum, receiptSummary(journal, entries, { to, dayOf }).total);
});

test('shopRayons', () => {
  const only = split({ payments: [shopSale(1, 241500, 'cigares')], refunds: [] }, []);
  assert.deepEqual(shopRayons(group(only, 'boutique')), [{ account: 'cigares', amount: 241500 }]);
  const back = split({
    payments: [shopSale(1, 10000, 'alcool')],
    refunds: [{ id: 1, amount: 10000, card_amount: 0, method: 'Espèces', created_at: '2026-11-18T19:00:00Z', payment_id: 1,
      shop_sale_id: 101, account: 'alcool', label: 'Produit' }],
  }, []);
  assert.deepEqual(shopRayons(group(back, 'boutique')), []);
});
