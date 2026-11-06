// The lines billed in a period, listed per Caisse column. Mixed into Club (end of club.js); like the rest of the
// business layer these methods never open transactions.
import { formatTicketNumber } from '../shared/ticket.js';
import { buyerShown } from './shop.js';

// The one place that says which half of the Alcool account a line belongs to: an « autre boisson » product is
// "autres_boissons", anything else (a bottle, or a line with no product left) is "champagne". `pr` is the line's
// product, LEFT JOINed.
export const DRINK_PART_SQL = "CASE WHEN pr.category = 'boisson' THEN 'autres_boissons' ELSE 'champagne' END";

// Lines kept per column; the column says when it holds more.
const LINES_PER_COLUMN = 200;

export const billedMethods = {
  // Every charge created in the period (all statuses, newest first), grouped in the four Caisse columns. A line is
  // listed on its billing day, whenever it is paid; its money counts on the day it is collected (financeSummary).
  billedLines(from, to) {
    const [a, b] = this.periodBounds(from, to);
    const rows = this.all(
      `SELECT * FROM (
         SELECT *, ROW_NUMBER() OVER (PARTITION BY col ORDER BY created_at DESC, id DESC) AS rn,
           COUNT(*) OVER (PARTITION BY col) AS cnt
         FROM (
           SELECT c.id, c.created_at, c.kind, c.label, c.quantity, c.amount, c.status, c.reservation_id, c.shop_sale_id,
             c.member_id, ro.name AS room_name, su.plan_name, pa.payment_id,
             m.first_name, m.last_name, m.member_no, COALESCE(s.buyer_kind, m.kind) AS buyer_kind,
             CASE c.account WHEN 'reservations' THEN 'reservations' WHEN 'cigares' THEN 'cigares' ELSE ${DRINK_PART_SQL} END AS col
           FROM charges c
           JOIN members m ON m.id = c.member_id
           LEFT JOIN products pr ON pr.id = c.product_id
           LEFT JOIN reservations r ON r.id = c.reservation_id
           LEFT JOIN rooms ro ON ro.id = r.room_id
           LEFT JOIN subscriptions su ON su.id = c.subscription_id
           LEFT JOIN shop_sales s ON s.id = c.shop_sale_id
           LEFT JOIN payment_allocations pa ON pa.charge_id = c.id
           WHERE c.created_at >= ? AND c.created_at < ?
         )
       ) WHERE rn <= ${LINES_PER_COLUMN} ORDER BY col, rn`, a, b,
    );
    const columns = {};
    for (const key of ['reservations', 'champagne', 'autres_boissons', 'cigares']) columns[key] = { count: 0, truncated: false, lines: [] };
    for (const r of rows) {
      const column = columns[r.col];
      const buyer = buyerShown(r.buyer_kind, r);
      column.count = r.cnt;
      column.truncated = r.cnt > LINES_PER_COLUMN;
      column.lines.push({
        charge_id: r.id, at: r.created_at, kind: r.kind, label: r.label, quantity: r.quantity, amount: r.amount, status: r.status,
        reservation_id: r.reservation_id, room_name: r.room_name ?? null, plan_name: r.plan_name ?? null, shop_sale_id: r.shop_sale_id,
        member_id: r.buyer_kind === 'journalier' ? null : r.member_id, member_name: buyer.name, member_no: buyer.no,
        payment_id: r.payment_id ?? null, ticket_number: r.payment_id ? formatTicketNumber(r.payment_id) : null,
      });
    }
    return { from, to, limit: LINES_PER_COLUMN, columns };
  },
};
