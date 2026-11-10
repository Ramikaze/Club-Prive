// Products given away (« Offert », spec docs/superpowers/specs/2026-11-10-offert-design.md). Only the associé of a
// product's rayon gives it, on the current business day: the stock goes down, no money moves (no payment, no charge,
// no ledger entry), and the gift keeps the cost price and the giver's name of its day, so a later change of either
// never alters it. The giver, while still the associé of that rayon, or the administrator cancels a gift: the stock
// comes back and the gift stays listed, marked cancelled. Mixed into Club (worker/club.js), like worker/credit.js.
import { conflict, forbidden, invalid, notFound } from './errors.js';
import { int, text, toId } from './validate.js';
import { accountOfCategory, ownsAccount } from '../shared/roles.js';

const GIFT_SELECT = `
  SELECT g.*, p.name AS product_name, p.reference, p.category,
    m.first_name AS member_first_name, m.last_name AS member_last_name, u.name AS cancelled_by_name
  FROM gifts g
  JOIN products p ON p.id = g.product_id
  LEFT JOIN members m ON m.id = g.member_id
  LEFT JOIN users u ON u.id = g.cancelled_by`;

const DAY = /^\d{4}-\d{2}-\d{2}$/;

// The associé of that rayon: the only one who gives its products (the manager and the administrator do not).
const givesIn = (user, account) => user?.role === 'associe' && ownsAccount(user, account);

export const giftMethods = {
  giftDTO(g, viewer) {
    return {
      id: g.id, product_id: g.product_id, product_name: g.product_name, reference: g.reference, category: g.category,
      quantity: g.quantity, unit_cost: g.unit_cost, unit_price: g.unit_price,
      total_cost: g.unit_cost === null ? null : g.unit_cost * g.quantity, total_price: g.unit_price * g.quantity,
      account: g.account, given_by: g.given_by, given_by_name: g.given_by_name,
      member_id: g.member_id, member_name: g.member_id ? `${g.member_first_name} ${g.member_last_name}` : null,
      reason: g.reason, biz_date: g.biz_date, created_at: g.created_at,
      cancelled_at: g.cancelled_at, cancelled_by_name: g.cancelled_by_name ?? null, cancel_reason: g.cancel_reason,
      can_cancel: !g.cancelled_at && this.canCancelGift(viewer, g),
    };
  },

  giftById(id, viewer) {
    return this.giftDTO(this.get(`${GIFT_SELECT} WHERE g.id = ?`, id), viewer);
  },

  // The giver while his account is active and still the associé of that rayon, or the administrator.
  canCancelGift(user, g) {
    if (user?.role === 'admin') return true;
    return Boolean(user?.active) && user.id === g.given_by && givesIn(user, g.account);
  },

  offerProduct(actor, productId, input) {
    const p = this.get('SELECT * FROM products WHERE id = ?', toId(productId, 'Produit'));
    if (!p) throw notFound('Produit');
    const account = accountOfCategory(p.category);
    if (!givesIn(actor, account)) throw forbidden('Seul l’associé de ce rayon peut offrir ce produit.');
    if (!p.active) throw conflict('PRODUIT_INACTIF', 'Ce produit est désactivé : il ne peut pas être offert.');
    const quantity = int(input.quantity, 'Quantité', { min: 1, max: 10000 });
    const reason = text(input.reason, 'Motif', { max: 200 });
    let memberId = null;
    if (input.member_id !== undefined && input.member_id !== null && input.member_id !== '') {
      const m = this.get('SELECT id, active FROM members WHERE id = ?', toId(input.member_id, 'Client'));
      if (!m || !m.active) throw notFound('Client');
      memberId = m.id;
    }
    const today = this.bizToday();
    this.assertOpen(today, 'Ce cadeau');
    const id = this.insert(
      `INSERT INTO gifts (product_id, quantity, unit_cost, unit_price, account, given_by, given_by_name, member_id, reason, biz_date, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      p.id, quantity, p.cost_price ?? null, p.price, account, actor.id, actor.name, memberId, reason, today, this.nowIso(),
    );
    // Refuses a stock that would go below zero; the route's transaction then drops the gift written above.
    this.moveStock(actor, p.id, -quantity, 'offert', { giftId: id, reason });
    this.audit(actor, 'offert.creer', 'product', p.id, {
      gift_id: id, produit: p.name, quantite: quantity, prix_de_revient: p.cost_price ?? null, beneficiaire: memberId, motif: reason,
    });
    return { gift: this.giftById(id, actor), product: this.productById(p.id) };
  },

  cancelGift(actor, giftId, input) {
    const g = this.get('SELECT * FROM gifts WHERE id = ?', toId(giftId, 'Cadeau'));
    if (!g) throw notFound('Cadeau');
    if (!this.canCancelGift(actor, g)) throw forbidden('Seuls l’associé qui a fait ce cadeau et l’administrateur peuvent l’annuler.');
    if (g.cancelled_at) throw conflict('DEJA_ANNULE', 'Ce cadeau est déjà annulé.');
    const reason = text(input.reason, "Motif d'annulation", { required: true, min: 3, max: 200 });
    this.assertOpen(this.bizToday(), 'Cette annulation');
    this.run(
      'UPDATE gifts SET cancelled_at = ?, cancelled_by = ?, cancel_reason = ? WHERE id = ? AND cancelled_at IS NULL',
      this.nowIso(), actor.id, reason, g.id,
    );
    this.moveStock(actor, g.product_id, g.quantity, 'annulation_offert', { giftId: g.id, reason });
    this.audit(actor, 'offert.annuler', 'product', g.product_id, { gift_id: g.id, quantite: g.quantity, motif: reason });
    return { gift: this.giftById(g.id, actor), product: this.productById(g.product_id) };
  },

  // The gifts of a period (one day by default), newest first, and per associé the total at cost price of those not
  // cancelled. A gift without a cost price counts 0 and is counted in `missing_cost`. An associé sees his rayon only.
  listGifts(actor, query = {}) {
    const from = DAY.test(query.from ?? '') ? query.from : this.bizToday();
    const to = DAY.test(query.to ?? '') ? query.to : from;
    if (to < from) throw invalid('La fin de la période précède son début.');
    const own = actor.role === 'admin' ? null : actor.rayon;
    const rows = own
      ? this.all(`${GIFT_SELECT} WHERE g.biz_date >= ? AND g.biz_date <= ? AND g.account = ? ORDER BY g.id DESC`, from, to, own)
      : this.all(`${GIFT_SELECT} WHERE g.biz_date >= ? AND g.biz_date <= ? ORDER BY g.id DESC`, from, to);
    const gifts = rows.map((g) => this.giftDTO(g, actor));
    const groups = new Map();
    for (const g of gifts) {
      if (g.cancelled_at) continue;
      const key = `${g.given_by}|${g.account}`;
      const x = groups.get(key) ?? { user_id: g.given_by, name: g.given_by_name, account: g.account, total_cost: 0, quantity: 0, missing_cost: 0 };
      x.total_cost += g.total_cost ?? 0;
      x.quantity += g.quantity;
      if (g.unit_cost === null) x.missing_cost += 1;
      groups.set(key, x);
    }
    return { from, to, by_associate: [...groups.values()], gifts };
  },
};
