// The boutique: regular clients (registered buyers who are not members) and the hidden walk-in client. All
// writes run inside the API transaction, including audit and idempotency.
import { conflict, invalid, forbidden, notFound } from './errors.js';
import { toId, flag, text } from './validate.js';
import { SHOP, canSellIn, isBoss } from '../shared/roles.js';
import { formatTicketNumber } from '../shared/ticket.js';
import { CARD_METHOD, CREDIT_LABEL } from '../shared/rules.js';

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
      return {
        ...this.memberBase(m), purchases_count: bought.n, purchases_total: bought.total, last_purchase_at: bought.last_at ?? null,
        owed: this.creditOwed(m.id),
      };
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
    this.assertMemberActive(m, 'de le passer en membre');
    // The debt stays on a client's account, never among a member's notes (spec 2026-11-07-credit-clients-design.md).
    const owed = this.creditOwed(m.id);
    if (owed > 0) {
      throw conflict('CREANCE_EN_COURS', `${m.first_name} ${m.last_name} doit encore ${this.money(owed)} : enregistrez d’abord son règlement.`);
    }
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
    // A regular client may buy on credit, under the limit a boss set (worker/credit.js): no payment, the lines wait on
    // his account. Anyone who sells in the rayon may sell on credit.
    const credit = flag(input.credit);
    if (credit && buyer.kind !== 'client') throw invalid('Seul un client régulier achète à crédit.');
    if (credit && card) throw invalid('Une vente à crédit ne se paie pas avec une carte.');
    const method = credit ? null : text(input.method, 'Moyen de paiement', { max: 40 });
    this.assertOpen(this.bizToday(), 'Cette vente');
    // A sale made for a client's order: his own order, his rayon, once (worker/clientOrders.js).
    const orderId = input.order_id === undefined || input.order_id === null ? null : toId(input.order_id, 'Commande');
    if (orderId) this.assertSaleMatchesOrder(orderId, account, buyer);

    let memberId;
    if (buyer.kind === 'journalier') {
      memberId = this.walkInMemberId();
    } else {
      const m = this.fileRow(toId(buyer.member_id, 'Acheteur'));
      if (m.kind !== buyer.kind) throw invalid(buyer.kind === 'client' ? 'Cet acheteur n’est pas un client régulier.' : 'Cet acheteur n’est pas un membre.');
      this.assertMemberActive(m, 'une vente');
      memberId = m.id;
      if (credit) this.assertCreditAllowed(m, products.reduce((n, { p, quantity }) => n + p.price * quantity, 0));
    }

    const saleId = this.insert(
      'INSERT INTO shop_sales (account, member_id, buyer_kind, created_at, created_by, on_credit) VALUES (?, ?, ?, ?, ?, ?)',
      account, memberId, buyer.kind, this.nowIso(), actor.id, credit ? 1 : 0,
    );
    if (orderId) this.linkSaleToOrder(actor, orderId, account, saleId);
    const chargeIds = [];
    for (const { p, quantity } of products) {
      const chargeId = this.insertCharge(actor, {
        account, kind: 'produit', member_id: memberId, product_id: p.id, label: p.name, quantity, unit_price: p.price,
        shop_sale_id: saleId,
      });
      this.moveStock(actor, p.id, -quantity, 'vente', { chargeId, reason: `Boutique n° ${saleId}` });
      chargeIds.push(chargeId);
    }
    if (credit) {
      const amount = this.get('SELECT SUM(amount) AS n FROM charges WHERE shop_sale_id = ?', saleId).n;
      this.audit(actor, 'boutique.vente', 'shop_sale', saleId, { rayon: account, acheteur: buyer.kind, montant: amount, credit: true, client: memberId });
      return { sale: this.shopSaleDTO(saleId), payment: null };
    }
    const { payment } = this.recordPayment(actor, { charge_ids: chargeIds, card, method }, { shopSaleId: saleId });
    this.audit(actor, 'boutique.vente', 'shop_sale', saleId, {
      rayon: account, acheteur: buyer.kind, montant: payment.amount, carte: payment.card_amount,
    });
    return { sale: this.shopSaleDTO(saleId), payment };
  },

  // Cancels a whole sale: every line is refunded by the method it was paid with (the card part back onto the
  // card), the goods go back to stock. Any associé or the admin; money moves today, so a closed day
  // refuses it (inside writeRefund) and the transaction leaves nothing behind.
  cancelShopSale(actor, saleId, input) {
    const sale = this.get('SELECT * FROM shop_sales WHERE id = ?', toId(saleId, 'Vente'));
    if (!sale) throw notFound('Vente');
    // Any associé, the administrator too: when the associé of the rayon is away, the other acts for him (owner's rule,
    // 2026-11-07); the journal keeps who did it.
    if (!isBoss(actor)) throw forbidden('Seul un administrateur ou un associé annule une vente Boutique.');
    const reason = text(input?.reason, 'Motif d’annulation', { required: true, min: 3, max: 300 });
    if (sale.cancelled_at) throw conflict('DEJA_ANNULEE', 'Cette vente est déjà annulée.');
    const lines = this.all("SELECT * FROM charges WHERE shop_sale_id = ? AND status IN ('payee', 'due') ORDER BY id", sale.id);
    if (sale.on_credit) this.cancelCreditLines(actor, lines, reason);
    else {
      for (const c of lines) {
        const { payment, cardPart } = this.cardPartOf(c);
        this.writeRefund(actor, c, payment, cardPart, { method: payment.method, reason, restock: true });
      }
    }
    this.run('UPDATE shop_sales SET cancelled_at = ?, cancelled_by = ?, cancel_reason = ? WHERE id = ?', this.nowIso(), actor.id, reason, sale.id);
    this.audit(actor, 'boutique.vente.annuler', 'shop_sale', sale.id, {
      rayon: sale.account, montant: lines.reduce((n, c) => n + c.amount, 0), motif: reason, ...(sale.on_credit ? { credit: true } : {}),
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
      'SELECT id, product_id, label, quantity, unit_price, amount, status, settled FROM charges WHERE shop_sale_id = ? ORDER BY id', id,
    ).map((c) => ({
      charge_id: c.id, product_id: c.product_id, label: c.label, quantity: c.quantity, unit_price: c.unit_price,
      amount: c.amount, status: c.status, settled: c.settled,
    }));
    const pay = this.get('SELECT id, method, card_amount FROM payments WHERE shop_sale_id = ? ORDER BY id LIMIT 1', id);
    const buyer = buyerShown(s.buyer_kind, s);
    return {
      id: s.id, account: s.account, buyer_kind: s.buyer_kind, member_id: s.buyer_kind === 'journalier' ? null : s.member_id,
      member_name: buyer.name, member_no: buyer.no,
      payment_id: pay?.id ?? null, ticket_number: pay ? formatTicketNumber(pay.id) : null,
      amount: lines.reduce((n, l) => n + l.amount, 0), card_amount: pay?.card_amount ?? 0,
      // A credit sale has no payment of its own: it shows « À crédit » where the method goes.
      on_credit: !!s.on_credit, method: s.on_credit ? CREDIT_LABEL : pay?.method ?? null,
      created_at: s.created_at, created_by_name: s.created_by_name ?? null,
      cancelled_at: s.cancelled_at, cancel_reason: s.cancel_reason, cancelled_by_name: s.cancelled_by_name ?? null,
      lines,
    };
  },

  // Figures of the Caisse « Boutique » tab, one column per rayon. A sale counts in the period of its creation (listed,
  // marked cancelled when it is); money given back counts in the period of the refund, as a negative amount on the
  // same buyer kind and methods. So the same day the two cancel out, and a past period never changes afterwards.
  // The card part of a payment or refund shows under CARD_METHOD, the rest under its own method.
  shopSummary(from, to) {
    const [a, b] = this.periodBounds(from, to);
    const accounts = {};
    for (const account of Object.keys(SHOP)) {
      const by_buyer = { journalier: 0, client: 0, membre: 0 };
      const methods = new Map();
      const addMethod = (method, amount) => methods.set(method, (methods.get(method) ?? 0) + amount);
      const addSplit = (kind, amount, cardPart, method, sign) => {
        by_buyer[kind] += sign * amount;
        if (amount - cardPart) addMethod(method, sign * (amount - cardPart));
        if (cardPart) addMethod(CARD_METHOD, sign * cardPart);
      };
      let count = 0;
      const sales = this.all(
        'SELECT id FROM shop_sales WHERE account = ? AND created_at >= ? AND created_at < ? ORDER BY created_at DESC, id DESC', account, a, b,
      ).map((x) => this.shopSaleDTO(x.id));
      let total = 0;
      for (const s of sales) {
        addSplit(s.buyer_kind, s.amount, s.card_amount, s.method, 1);
        total += s.amount;
        if (!(s.cancelled_at && s.cancelled_at >= a && s.cancelled_at < b)) count += 1;
      }
      // One line per cancelled sale, with what went back in this period (the refunds of a sale share one moment).
      const sold = new Map();
      for (const r of this.all(
        `SELECT rf.amount, rf.card_amount, rf.method, rf.created_at, s.id AS sale_id, s.buyer_kind, s.cancel_reason, cu.name AS cancelled_by_name
         FROM refunds rf JOIN charges c ON c.id = rf.charge_id JOIN shop_sales s ON s.id = c.shop_sale_id
         LEFT JOIN users cu ON cu.id = s.cancelled_by
         WHERE s.account = ? AND s.on_credit = 0 AND rf.created_at >= ? AND rf.created_at < ? ORDER BY rf.created_at, rf.id`, account, a, b,
      )) {
        addSplit(r.buyer_kind, r.amount, r.card_amount, r.method, -1);
        total -= r.amount;
        const x = sold.get(r.sale_id) ?? {
          sale_id: r.sale_id, at: r.created_at, amount: 0, reason: r.cancel_reason, cancelled_by_name: r.cancelled_by_name ?? null,
          ticket_number: null,
        };
        x.amount += r.amount;
        sold.set(r.sale_id, x);
      }
      // A cancelled credit sale undoes its whole amount « À crédit », on the day of the cancellation. What its client had
      // already settled and gets back is money of his account, not of the counter: it shows in his file and the books.
      for (const r of this.all(
        `SELECT s.id AS sale_id, s.buyer_kind, s.cancelled_at, s.cancel_reason, cu.name AS cancelled_by_name,
           (SELECT SUM(amount) FROM charges WHERE shop_sale_id = s.id) AS amount
         FROM shop_sales s LEFT JOIN users cu ON cu.id = s.cancelled_by
         WHERE s.account = ? AND s.on_credit = 1 AND s.cancelled_at >= ? AND s.cancelled_at < ? ORDER BY s.cancelled_at, s.id`, account, a, b,
      )) {
        addSplit(r.buyer_kind, r.amount, 0, CREDIT_LABEL, -1);
        total -= r.amount;
        sold.set(r.sale_id, {
          sale_id: r.sale_id, at: r.cancelled_at, amount: r.amount, reason: r.cancel_reason, cancelled_by_name: r.cancelled_by_name ?? null,
          ticket_number: null,
        });
      }
      for (const x of sold.values()) {
        const pay = this.get('SELECT id FROM payments WHERE shop_sale_id = ? ORDER BY id LIMIT 1', x.sale_id);
        x.ticket_number = pay ? formatTicketNumber(pay.id) : null;
      }
      accounts[account] = {
        account, total, count, by_buyer,
        by_method: [...methods].map(([method, t]) => ({ method, total: t })).filter((x) => x.total !== 0).sort((p, q) => q.total - p.total),
        sales, cancellations: [...sold.values()],
      };
    }
    return { from, to, accounts };
  },

  // Product lines bought by a member or regular client, Boutique and session mixed, newest first. Payment details
  // come from the payment that collected the line (the latest one still standing, for a line settled in several
  // payments), and stay null while the line is due.
  // The total counts what is owed or paid, not refunded or cancelled lines.
  purchaseHistory(memberId) {
    const m = this.fileRow(memberId);
    const lines = this.all(
      `SELECT c.id, c.created_at, c.label, c.quantity, c.amount, c.account, c.reservation_id, c.shop_sale_id, c.status,
         c.settled, s.on_credit, s.buyer_kind, p.id AS payment_id, p.method, p.card_amount
       FROM charges c
       LEFT JOIN shop_sales s ON s.id = c.shop_sale_id
       LEFT JOIN payments p ON p.id = (
         SELECT x.payment_id FROM payment_allocations x JOIN payments xp ON xp.id = x.payment_id WHERE x.charge_id = c.id
         ORDER BY (xp.cancelled_at IS NULL) DESC, x.id DESC LIMIT 1)
       WHERE c.member_id = ? AND c.kind = 'produit'
       ORDER BY c.created_at DESC, c.id DESC LIMIT 500`, m.id,
    ).map((c) => ({
      charge_id: c.id, at: c.created_at, label: c.label, quantity: c.quantity, amount: c.amount, account: c.account,
      origin: c.shop_sale_id ? 'boutique' : 'seance', reservation_id: c.reservation_id, status: c.status,
      payment_id: c.payment_id ?? null, ticket_number: c.payment_id ? formatTicketNumber(c.payment_id) : null,
      method: c.method ?? null, card_amount: c.payment_id ? c.card_amount : null, as_client: c.buyer_kind === 'client',
      // A credit purchase: what is already settled of it (its account tells the rest).
      on_credit: !!c.on_credit, settled: c.on_credit ? c.settled : null,
    }));
    const total = lines.filter((l) => l.status === 'due' || l.status === 'payee').reduce((n, l) => n + l.amount, 0);
    return { member_id: m.id, total, lines };
  },
};
