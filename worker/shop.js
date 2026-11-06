// The boutique: regular clients (registered buyers who are not members) and the hidden walk-in client. All
// writes run inside the API transaction, including audit and idempotency.
import { conflict, invalid, forbidden, notFound } from './errors.js';
import { toId, flag, text } from './validate.js';
import { SHOP, canSellIn, ownsAccount } from '../shared/roles.js';
import { formatTicketNumber } from '../shared/ticket.js';

// How a buyer is shown anywhere in the app: a day client ('journalier') is only « Client journalier », with no
// number and no personal data (the hidden row's own name is never printed); anyone else by name and number.
export const WALK_IN_NAME = 'Client journalier';
export function buyerShown(kind, { first_name, last_name, member_no }) {
  if (kind === 'journalier') return { name: WALK_IN_NAME, no: null };
  return { name: `${first_name} ${last_name}`, no: member_no };
}

export const shopMethods = {
  // The one hidden row every walk-in sale is booked on, created on first use. It has no card and no file: it is
  // never listed, searched, renewed or counted, and fileRow() refuses to open it.
  walkInMemberId() {
    const row = this.get("SELECT id FROM members WHERE kind = 'journalier'");
    if (row) return row.id;
    return this.insert(
      `INSERT INTO members (member_no, first_name, last_name, phone, kind, created_at) VALUES ('J-0000', 'Client', 'JOURNALIER', '', 'journalier', ?)`,
      this.nowIso(),
    );
  },

  // Regular clients only, with what they bought (cancelled sales left out).
  listClients(q, statut = 'actifs') {
    const keep = this.keepByStatus(statut);
    return this.searchMemberRows(q, 'client').filter(keep).map((m) => {
      const bought = this.get(
        `SELECT COUNT(*) AS n, MAX(s.created_at) AS last_at,
           COALESCE((SELECT SUM(c.amount) FROM charges c JOIN shop_sales x ON x.id = c.shop_sale_id
                     WHERE x.member_id = ? AND x.cancelled_at IS NULL), 0) AS total
         FROM shop_sales s WHERE s.member_id = ? AND s.cancelled_at IS NULL`, m.id, m.id,
      );
      return { ...this.memberBase(m), purchases_count: bought.n, purchases_total: bought.total, last_purchase_at: bought.last_at ?? null };
    });
  },

  createClient(actor, input) {
    const f = this.memberFields(input);
    const memberNo = this.nextMemberNo('C');
    const id = this.insert(
      `INSERT INTO members (member_no, first_name, last_name, phone, email, notes, kind, created_at, created_by)
       VALUES (?, ?, ?, ?, ?, ?, 'client', ?, ?)`,
      memberNo, f.first, f.last, f.phone, f.email, f.notes, this.nowIso(), actor.id,
    );
    this.audit(actor, 'client.creer', 'member', id, { member_no: memberNo, nom: `${f.first} ${f.last}` });
    return this.memberDetail(id);
  },

  // The client becomes a member on the same row, so every purchase stays attached; the old number is kept.
  convertClient(actor, id) {
    const m = this.fileRow(id);
    if (m.kind !== 'client') throw conflict('PAS_CLIENT', `${m.first_name} ${m.last_name} est déjà membre.`);
    const memberNo = this.nextMemberNo('M');
    const now = this.nowIso();
    this.run(
      `UPDATE members SET kind = 'membre', former_client_no = ?, member_no = ?, became_member_at = ?, became_member_by = ?,
         updated_at = ?, updated_by = ? WHERE id = ?`,
      m.member_no, memberNo, now, actor.id, now, actor.id, m.id,
    );
    this.ensureCard(actor, m.id);
    this.audit(actor, 'client.passer_membre', 'member', m.id, {
      ancien_numero: m.member_no, nouveau_numero: memberNo, nom: `${m.first_name} ${m.last_name}`,
    });
    return this.memberDetail(m.id);
  },

  // One counter sale: the sale row, one charge per product, the stock out, then the payment (the card first, for
  // members). Runs in the request's transaction, so any refusal below leaves nothing behind.
  createShopSale(actor, input) {
    if (!input || typeof input !== 'object' || Array.isArray(input)) throw invalid('Vente invalide.');
    const account = input.account;
    if (!Object.hasOwn(SHOP, account)) throw invalid('Rayon inconnu.');
    if (!canSellIn(actor, account)) throw forbidden('Vous ne vendez que les produits de votre rayon.');

    if (!Array.isArray(input.lines) || input.lines.length < 1 || input.lines.length > 30) {
      throw invalid('Une vente compte de 1 à 30 produits.');
    }
    // A product listed twice is one line.
    const wanted = new Map();
    for (const l of input.lines) {
      if (!l || typeof l !== 'object') throw invalid('Ligne de vente invalide.');
      const id = toId(l.product_id, 'Produit');
      const qty = typeof l.quantity === 'string' ? Number(l.quantity) : l.quantity;
      if (!Number.isInteger(qty) || qty < 1 || qty > 99) throw invalid('Quantité : un nombre entier de 1 à 99.');
      const total = (wanted.get(id) ?? 0) + qty;
      if (total > 99) throw invalid('Quantité : 99 au maximum par produit.');
      wanted.set(id, total);
    }
    const products = [...wanted].map(([id, quantity]) => {
      const p = this.get('SELECT * FROM products WHERE id = ?', id);
      if (!p) throw notFound('Produit');
      if (!p.active) throw conflict('PRODUIT_INACTIF', `Le produit « ${p.name} » est inactif.`);
      if (p.category !== SHOP[account].category) throw invalid(`« ${p.name} » ne se vend pas dans ce rayon.`, 'RAYON');
      return { p, quantity };
    });

    const buyer = input.buyer;
    if (!buyer || typeof buyer !== 'object' || !['journalier', 'client', 'membre'].includes(buyer.kind)) {
      throw invalid('Acheteur invalide.');
    }
    const card = flag(input.card);
    if (card && buyer.kind !== 'membre') throw invalid('Seul un membre paie avec sa carte.');
    const method = text(input.method, 'Moyen de paiement', { max: 40 });
    this.assertOpen(this.bizToday(), 'Cette vente');

    let memberId;
    if (buyer.kind === 'journalier') {
      memberId = this.walkInMemberId();
    } else {
      const m = this.fileRow(toId(buyer.member_id, 'Acheteur'));
      if (m.kind !== buyer.kind) throw invalid(buyer.kind === 'client' ? 'Cet acheteur n’est pas un client régulier.' : 'Cet acheteur n’est pas un membre.');
      this.assertMemberActive(m, 'une vente');
      memberId = m.id;
    }

    const saleId = this.insert(
      'INSERT INTO shop_sales (account, member_id, buyer_kind, created_at, created_by) VALUES (?, ?, ?, ?, ?)',
      account, memberId, buyer.kind, this.nowIso(), actor.id,
    );
    const chargeIds = [];
    for (const { p, quantity } of products) {
      const chargeId = this.insertCharge(actor, {
        account, kind: 'produit', member_id: memberId, product_id: p.id, label: p.name, quantity, unit_price: p.price,
        shop_sale_id: saleId,
      });
      this.moveStock(actor, p.id, -quantity, 'vente', { chargeId, reason: `Boutique n° ${saleId}` });
      chargeIds.push(chargeId);
    }
    const { payment } = this.recordPayment(actor, { charge_ids: chargeIds, card, method, shop_sale_id: saleId });
    this.audit(actor, 'boutique.vente', 'shop_sale', saleId, {
      rayon: account, acheteur: buyer.kind, montant: payment.amount, carte: payment.card_amount,
    });
    return { sale: this.shopSaleDTO(saleId), payment };
  },

  // Cancels a whole sale: every line is refunded by the method it was paid with (the card part back onto the
  // card), the goods go back to stock. Only the boss of the rayon or the admin; money moves today, so a closed day
  // refuses it (inside writeRefund) and the transaction leaves nothing behind.
  cancelShopSale(actor, saleId, input) {
    const sale = this.get('SELECT * FROM shop_sales WHERE id = ?', toId(saleId, 'Vente'));
    if (!sale) throw notFound('Vente');
    if (!ownsAccount(actor, sale.account)) throw forbidden('Seul l’associé du rayon ou l’administrateur annule une vente Boutique.');
    const reason = text(input?.reason, 'Motif d’annulation', { required: true, min: 3, max: 300 });
    if (sale.cancelled_at) throw conflict('DEJA_ANNULEE', 'Cette vente est déjà annulée.');
    const lines = this.all("SELECT * FROM charges WHERE shop_sale_id = ? AND status = 'payee' ORDER BY id", sale.id);
    for (const c of lines) {
      const { payment, cardPart } = this.cardPartOf(c);
      this.writeRefund(actor, c, payment, cardPart, { method: payment.method, reason, restock: true });
    }
    this.run('UPDATE shop_sales SET cancelled_at = ?, cancelled_by = ?, cancel_reason = ? WHERE id = ?', this.nowIso(), actor.id, reason, sale.id);
    this.audit(actor, 'boutique.vente.annuler', 'shop_sale', sale.id, {
      rayon: sale.account, montant: lines.reduce((n, c) => n + c.amount, 0), motif: reason,
    });
    return { sale: this.shopSaleDTO(sale.id) };
  },

  // A day client is shown without any number or personal data; the hidden row's name is never printed.
  shopSaleDTO(id) {
    const s = this.get(
      `SELECT s.*, m.first_name, m.last_name, m.member_no, u.name AS created_by_name, cu.name AS cancelled_by_name
       FROM shop_sales s JOIN members m ON m.id = s.member_id
       LEFT JOIN users u ON u.id = s.created_by LEFT JOIN users cu ON cu.id = s.cancelled_by WHERE s.id = ?`, id,
    );
    if (!s) throw notFound('Vente');
    const lines = this.all(
      'SELECT id, product_id, label, quantity, unit_price, amount, status FROM charges WHERE shop_sale_id = ? ORDER BY id', id,
    ).map((c) => ({
      charge_id: c.id, product_id: c.product_id, label: c.label, quantity: c.quantity, unit_price: c.unit_price,
      amount: c.amount, status: c.status,
    }));
    const pay = this.get('SELECT id, method, card_amount FROM payments WHERE shop_sale_id = ? ORDER BY id LIMIT 1', id);
    const buyer = buyerShown(s.buyer_kind, s);
    return {
      id: s.id, account: s.account, buyer_kind: s.buyer_kind, member_id: s.buyer_kind === 'journalier' ? null : s.member_id,
      member_name: buyer.name, member_no: buyer.no,
      payment_id: pay?.id ?? null, ticket_number: pay ? formatTicketNumber(pay.id) : null,
      amount: lines.reduce((n, l) => n + l.amount, 0), card_amount: pay?.card_amount ?? 0, method: pay?.method ?? null,
      created_at: s.created_at, created_by_name: s.created_by_name ?? null,
      cancelled_at: s.cancelled_at, cancel_reason: s.cancel_reason, cancelled_by_name: s.cancelled_by_name ?? null,
      lines,
    };
  },

  // Product lines bought by a member or regular client, Boutique and session mixed, newest first. Payment details
  // come from the payment that collected the line (lowest id if several), and stay null while the line is due.
  // The total counts what is owed or paid, not refunded or cancelled lines.
  purchaseHistory(memberId) {
    const m = this.fileRow(memberId);
    const lines = this.all(
      `SELECT c.id, c.created_at, c.label, c.quantity, c.amount, c.account, c.reservation_id, c.shop_sale_id, c.status,
         s.buyer_kind, p.id AS payment_id, p.method, p.card_amount
       FROM charges c
       LEFT JOIN shop_sales s ON s.id = c.shop_sale_id
       LEFT JOIN payments p ON p.id = (SELECT MIN(payment_id) FROM payment_allocations WHERE charge_id = c.id)
       WHERE c.member_id = ? AND c.kind = 'produit'
       ORDER BY c.created_at DESC, c.id DESC LIMIT 500`, m.id,
    ).map((c) => ({
      charge_id: c.id, at: c.created_at, label: c.label, quantity: c.quantity, amount: c.amount, account: c.account,
      origin: c.shop_sale_id ? 'boutique' : 'seance', reservation_id: c.reservation_id, status: c.status,
      payment_id: c.payment_id ?? null, ticket_number: c.payment_id ? formatTicketNumber(c.payment_id) : null,
      method: c.method ?? null, card_amount: c.payment_id ? c.card_amount : null, as_client: c.buyer_kind === 'client',
    }));
    const total = lines.filter((l) => l.status === 'due' || l.status === 'payee').reduce((n, l) => n + l.amount, 0);
    return { member_id: m.id, total, lines };
  },
};
