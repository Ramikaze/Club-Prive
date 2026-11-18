// The real profit of the products (spec docs/superpowers/specs/2026-11-18-benefice-reel-design.md): sales − purchase
// cost − gifts, per caisse and per product. Every event counts on the day it happens, so a past period never changes:
// a sale on the day it is made (paid or not), its cancellation or refund on that day, goods back in stock on theirs,
// a gift on its day and its cancellation on that one. A line whose cost price is unknown is never counted at 0: it is
// reported apart and the report is incomplete. Mixed into Club (worker/club.js).
import { ACCOUNT_LABELS } from '../shared/rules.js';

// Products only sell into these two caisses.
const PROFIT_ACCOUNTS = ['alcool', 'cigares'];

const LINE = `c.account, c.product_id, c.quantity, c.amount, c.unit_cost, p.name, p.reference, p.category
  FROM charges c JOIN products p ON p.id = c.product_id`;

const zero = () => ({ sales: 0, cost: 0, gifts_cost: 0, profit: 0, missing: { sales_count: 0, sales_amount: 0, gifts_count: 0 } });

export const profitMethods = {
  profitReport(from, to) {
    const [a, b] = this.periodBounds(from, to);
    const accounts = new Map(PROFIT_ACCOUNTS.map((k) => [k, zero()]));
    const products = new Map();
    const productOf = (r) => {
      let x = products.get(r.product_id);
      if (!x) {
        x = {
          product_id: r.product_id, name: r.name, reference: r.reference, category: r.category, account: r.account,
          quantity: 0, sales: 0, cost: 0, gifts_quantity: 0, gifts_cost: 0, profit: 0, margin: null, cost_missing: false,
        };
        products.set(r.product_id, x);
      }
      return x;
    };
    const figuresOf = (account) => accounts.get(account) ?? accounts.set(account, zero()).get(account);

    // A sale (sign 1) or its undoing (sign −1): its amount and quantity; its cost only when sold (goods back are below).
    const sale = (r, sign, withCost) => {
      const f = figuresOf(r.account);
      const p = productOf(r);
      if (r.unit_cost === null) {
        f.missing.sales_amount += sign * r.amount;
        if (sign > 0) f.missing.sales_count += 1;
        p.cost_missing = true;
        return;
      }
      f.sales += sign * r.amount;
      p.sales += sign * r.amount;
      p.quantity += sign * r.quantity;
      if (withCost) {
        f.cost += sign * r.quantity * r.unit_cost;
        p.cost += sign * r.quantity * r.unit_cost;
      }
    };
    for (const r of this.all(`SELECT ${LINE} WHERE c.kind = 'produit' AND c.created_at >= ? AND c.created_at < ?`, a, b)) sale(r, 1, true);
    for (const r of this.all(`SELECT ${LINE} WHERE c.kind = 'produit' AND c.status = 'annulee' AND c.cancelled_at >= ? AND c.cancelled_at < ?`, a, b)) {
      sale(r, -1, false);
    }
    // A refunded line is undone by the refund that completed it (a settlement cancelled alone leaves the sale standing).
    for (const r of this.all(
      `SELECT ${LINE} WHERE c.kind = 'produit' AND c.status = 'remboursee'
         AND (SELECT MAX(rf.created_at) FROM refunds rf WHERE rf.charge_id = c.id) >= ?
         AND (SELECT MAX(rf.created_at) FROM refunds rf WHERE rf.charge_id = c.id) < ?`, a, b,
    )) sale(r, -1, false);

    // Goods back in stock (cancellation, refund with restock): their cost comes back on that day. A refund without
    // restock moves no goods: the bottle is lost and its cost stays.
    for (const r of this.all(
      `SELECT c.account, c.product_id, ABS(m.quantity) AS quantity, c.unit_cost, p.name, p.reference, p.category
       FROM stock_movements m JOIN charges c ON c.id = m.charge_id JOIN products p ON p.id = c.product_id
       WHERE m.kind IN ('annulation_vente', 'retour') AND m.created_at >= ? AND m.created_at < ? AND c.unit_cost IS NOT NULL`, a, b,
    )) {
      figuresOf(r.account).cost -= r.quantity * r.unit_cost;
      productOf(r).cost -= r.quantity * r.unit_cost;
    }

    // Gifts on their day, their cancellation on its own.
    const gift = (g, sign) => {
      const f = figuresOf(g.account);
      const p = productOf(g);
      if (g.unit_cost === null) {
        if (sign > 0) f.missing.gifts_count += 1;
        p.cost_missing = true;
        return;
      }
      f.gifts_cost += sign * g.quantity * g.unit_cost;
      p.gifts_cost += sign * g.quantity * g.unit_cost;
      p.gifts_quantity += sign * g.quantity;
    };
    const GIFT = 'SELECT g.account, g.product_id, g.quantity, g.unit_cost, p.name, p.reference, p.category FROM gifts g JOIN products p ON p.id = g.product_id';
    for (const g of this.all(`${GIFT} WHERE g.biz_date >= ? AND g.biz_date <= ?`, from, to)) gift(g, 1);
    for (const g of this.all(`${GIFT} WHERE g.cancelled_at >= ? AND g.cancelled_at < ?`, a, b)) gift(g, -1);

    const total = zero();
    const list = [...accounts].map(([account, f]) => {
      f.profit = f.sales - f.cost - f.gifts_cost;
      for (const k of ['sales', 'cost', 'gifts_cost', 'profit']) total[k] += f[k];
      for (const k of ['sales_count', 'sales_amount', 'gifts_count']) total.missing[k] += f.missing[k];
      return { account, label: ACCOUNT_LABELS[account], ...f };
    });
    const rows = [...products.values()].map((p) => {
      const profit = p.sales - p.cost - p.gifts_cost;
      return { ...p, profit, margin: p.sales > 0 ? profit / p.sales : null };
    }).sort((x, y) => y.profit - x.profit || x.name.localeCompare(y.name, 'fr'));
    const m = total.missing;
    return { from, to, complete: !m.sales_count && !m.sales_amount && !m.gifts_count, accounts: list, total, products: rows };
  },
};
