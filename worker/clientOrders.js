// Boutique orders of the client space (spec « Espace client »). Mixed into Club (end of club.js): `this` is the Club
// instance, and no method opens a transaction of its own (the API wraps every write).
// An order only sets products aside: it never moves stock or money. The stock goes down, and the money is taken, when
// the staff turns the order into the usual Boutique sale at the counter (createShopSale with `order_id`, worker/shop.js).
// Products held by open orders are taken off what other clients can order (orderableQuantity), nothing more.
import { conflict, invalid, notFound } from './errors.js';
import { toId, text } from './validate.js';
import { SHOP, RAYONS, accountOfCategory } from '../shared/roles.js';

const OPEN = "('en_attente', 'prete')";
const MAX_OPEN_ORDERS = 3;
const MAX_LINE_QTY = 20;
const MAX_LINES = 30;
// The categories a client can order: cigars and champagne bottles.
const ORDERABLE = ['cigare', 'bouteille'];

export const clientOrderMethods = {
  // What open orders hold, per product; a rayon already sold holds nothing (its stock is already out). `excludeOrderId` leaves one order out (its own hold).
  heldQuantities(excludeOrderId = null) {
    const rows = this.all(
      `SELECT l.product_id, SUM(l.quantity) AS qty FROM client_order_lines l JOIN client_orders o ON o.id = l.order_id
       WHERE o.status IN ${OPEN} AND o.id <> ?
         AND NOT EXISTS (SELECT 1 FROM client_order_sales s WHERE s.order_id = l.order_id AND s.account = l.account)
       GROUP BY l.product_id`, excludeOrderId ?? 0,
    );
    return new Map(rows.map((r) => [r.product_id, r.qty]));
  },

  orderableQuantity(productId) {
    const p = this.get('SELECT stock_qty FROM products WHERE id = ?', productId);
    if (!p) return 0;
    return Math.max(0, p.stock_qty - (this.heldQuantities().get(productId) ?? 0));
  },

  // ---------------------------------------------------------------- client side

  // Built field by field: the exact stock and the costs never reach the client, only « how many he can order ».
  clientProducts() {
    const held = this.heldQuantities();
    return this.all(
      `SELECT p.id, p.name, p.description, p.price, p.category, p.stock_qty, ph.updated_at AS photo_version
       FROM products p LEFT JOIN product_photos ph ON ph.product_id = p.id AND ph.bytes > 0
       WHERE p.active = 1 AND p.category IN ('cigare', 'bouteille') ORDER BY p.category, p.name, p.id`,
    ).map((p) => {
      const maxOrder = Math.min(MAX_LINE_QTY, Math.max(0, p.stock_qty - (held.get(p.id) ?? 0)));
      return {
        id: p.id, name: p.name, description: p.description, price: p.price, account: accountOfCategory(p.category), category: p.category,
        photo_version: p.photo_version ?? null, available: maxOrder > 0, max_order: maxOrder,
      };
    });
  },

  // The picture of a product the client can order, else « not found ».
  clientProductPhoto(productId) {
    const p = this.get('SELECT id FROM products WHERE id = ? AND active = 1 AND category IN (\'cigare\', \'bouteille\')', toId(productId, 'Produit'));
    if (!p) throw notFound('Produit');
    return this.productPhoto(p.id);
  },

  // The order as its owner sees it. `taken` is null while the order is open or cancelled, then tells for each line
  // whether its rayon was sold.
  clientOrderView(order) {
    const sold = new Set(this.all('SELECT account FROM client_order_sales WHERE order_id = ?', order.id).map((r) => r.account));
    const closed = order.status === 'retiree';
    return {
      id: order.id, status: order.status, created_at: order.created_at, cancel_reason: order.cancel_reason ?? null,
      lines: this.all(
        `SELECT l.account, l.quantity, l.unit_price, p.name FROM client_order_lines l JOIN products p ON p.id = l.product_id
         WHERE l.order_id = ? ORDER BY l.id`, order.id,
      ).map((l) => ({ name: l.name, quantity: l.quantity, unit_price: l.unit_price, account: l.account, taken: closed ? sold.has(l.account) : null })),
    };
  },

  clientOrders(memberId) {
    return this.all('SELECT * FROM client_orders WHERE member_id = ? ORDER BY created_at DESC, id DESC LIMIT 100', memberId)
      .map((o) => this.clientOrderView(o));
  },

  createClientOrder(memberId, input) {
    const m = this.fileRow(memberId);
    this.assertMemberActive(m, 'une commande');
    if (!Array.isArray(input?.lines) || input.lines.length < 1 || input.lines.length > MAX_LINES) {
      throw invalid(`Une commande compte de 1 à ${MAX_LINES} produits.`);
    }
    // A product listed twice is one line.
    const wanted = new Map();
    for (const l of input.lines) {
      if (!l || typeof l !== 'object') throw invalid('Ligne de commande invalide.');
      const id = toId(l.product_id, 'Produit');
      if (!Number.isInteger(l.quantity) || l.quantity < 1) throw invalid(`Quantité : un nombre entier de 1 à ${MAX_LINE_QTY}.`);
      const total = (wanted.get(id) ?? 0) + l.quantity;
      if (total > MAX_LINE_QTY) throw invalid(`Quantité : ${MAX_LINE_QTY} au maximum par produit.`);
      wanted.set(id, total);
    }
    const open = this.get(`SELECT COUNT(*) AS n FROM client_orders WHERE member_id = ? AND status IN ${OPEN}`, m.id).n;
    if (open >= MAX_OPEN_ORDERS) throw conflict('TROP_DE_COMMANDES', `Vous avez déjà ${MAX_OPEN_ORDERS} commandes en cours.`);
    const held = this.heldQuantities();
    const lines = [...wanted].map(([id, quantity]) => {
      const p = this.get('SELECT * FROM products WHERE id = ?', id);
      if (!p || !ORDERABLE.includes(p.category)) throw notFound('Produit');
      if (!p.active) throw conflict('PRODUIT_INACTIF', `Le produit « ${p.name} » n’est plus proposé.`);
      const left = Math.max(0, p.stock_qty - (held.get(id) ?? 0));
      if (quantity > left) throw conflict('STOCK_INSUFFISANT', `Il ne reste que ${left} « ${p.name} » disponible(s).`, { product_id: id, left });
      return { p, quantity };
    });
    const orderId = this.insert("INSERT INTO client_orders (member_id, status, created_at) VALUES (?, 'en_attente', ?)", m.id, this.nowIso());
    for (const { p, quantity } of lines) {
      this.run(
        'INSERT INTO client_order_lines (order_id, product_id, account, quantity, unit_price) VALUES (?, ?, ?, ?, ?)',
        orderId, p.id, accountOfCategory(p.category), quantity, p.price,
      );
    }
    this.audit(null, 'client.commande', 'client_order', orderId, {
      client: m.id, lignes: lines.map(({ p, quantity }) => ({ produit: p.name, quantite: quantity })),
    });
    return this.clientOrderView(this.get('SELECT * FROM client_orders WHERE id = ?', orderId));
  },

  // The client's own order, or « not found » (a foreign one is not told apart from an unknown one).
  clientOrderRow(memberId, orderId) {
    const o = this.get('SELECT * FROM client_orders WHERE id = ? AND member_id = ?', toId(orderId, 'Commande'), memberId);
    if (!o) throw notFound('Commande');
    return o;
  },

  cancelClientOrder(memberId, orderId) {
    const o = this.clientOrderRow(memberId, orderId);
    if (o.status !== 'en_attente') throw conflict('COMMANDE_NON_ANNULABLE', 'Cette commande n’est plus annulable : contactez le club.');
    if (this.get('SELECT 1 AS x FROM client_order_sales WHERE order_id = ?', o.id)) {
      throw conflict('COMMANDE_DEJA_ENCAISSEE', 'Votre commande est en cours de retrait : contactez le club pour la modifier.');
    }
    this.run(
      "UPDATE client_orders SET status = 'annulee', closed_at = ?, cancelled_by_client = 1 WHERE id = ?", this.nowIso(), o.id,
    );
    this.audit(null, 'client.commande.annuler', 'client_order', o.id, { client: memberId });
    return this.clientOrderView(this.get('SELECT * FROM client_orders WHERE id = ?', o.id));
  },

  // ---------------------------------------------------------------- staff side

  openOrderRow(orderId) {
    const o = this.get('SELECT * FROM client_orders WHERE id = ?', toId(orderId, 'Commande'));
    if (!o) throw notFound('Commande');
    if (!['en_attente', 'prete'].includes(o.status)) throw conflict('COMMANDE_CLOTUREE', 'Cette commande est déjà clôturée.');
    return o;
  },

  // Every open order, oldest first, for any staff member. `counts.orders` is the caller's: an associé is concerned by
  // the orders with a line in his rayon only. Requests (Task 6) come in `requests`.
  staffOrders(user) {
    const orders = this.all(`SELECT * FROM client_orders WHERE status IN ${OPEN} ORDER BY created_at, id`).map((o) => {
      const m = this.get('SELECT id, first_name, last_name, member_no, kind, phone FROM members WHERE id = ?', o.member_id);
      const sales = Object.fromEntries(this.all('SELECT account, sale_id FROM client_order_sales WHERE order_id = ?', o.id).map((s) => [s.account, s.sale_id]));
      return {
        id: o.id, status: o.status, created_at: o.created_at, ready_at: o.ready_at, sales,
        member: { id: m.id, name: `${m.first_name} ${m.last_name}`, member_no: m.member_no, kind: m.kind, phone: m.phone },
        lines: this.all(
          `SELECT l.product_id, l.account, l.quantity, l.unit_price, p.name, p.stock_qty FROM client_order_lines l
           JOIN products p ON p.id = l.product_id WHERE l.order_id = ? ORDER BY l.id`, o.id,
        ),
      };
    });
    const mine = user.role === 'associe' ? orders.filter((o) => o.lines.some((l) => l.account === user.rayon)) : orders;
    const requests = this.staffRequests();
    return { orders, requests, counts: { orders: mine.length, requests: requests.length } };
  },

  markOrderReady(actor, orderId) {
    const o = this.openOrderRow(orderId);
    if (o.status !== 'en_attente') throw conflict('DEJA_PRETE', 'Cette commande est déjà prête.');
    this.run("UPDATE client_orders SET status = 'prete', ready_at = ?, ready_by = ? WHERE id = ?", this.nowIso(), actor.id, o.id);
    this.audit(actor, 'commande.prete', 'client_order', o.id, { client: o.member_id });
    return { id: o.id, status: 'prete' };
  },

  // The reason is shown to the client. An order already sold in a rayon is closed, not cancelled: its sale stands.
  cancelOrder(actor, orderId, input) {
    const o = this.openOrderRow(orderId);
    const reason = text(input?.reason, 'Motif d’annulation', { required: true, min: 3, max: 300 });
    if (this.get('SELECT 1 AS x FROM client_order_sales WHERE order_id = ?', o.id)) {
      throw conflict('COMMANDE_DEJA_ENCAISSEE', 'Une partie de cette commande est déjà encaissée : clôturez-la plutôt.');
    }
    this.run("UPDATE client_orders SET status = 'annulee', closed_at = ?, closed_by = ?, cancel_reason = ? WHERE id = ?", this.nowIso(), actor.id, reason, o.id);
    this.audit(actor, 'commande.annuler', 'client_order', o.id, { client: o.member_id, motif: reason });
    return { id: o.id, status: 'annulee' };
  },

  // Ends a partly sold order: what was sold is taken, the rest is let go (and no longer held).
  closeOrder(actor, orderId) {
    const o = this.openOrderRow(orderId);
    if (!this.get('SELECT 1 AS x FROM client_order_sales WHERE order_id = ?', o.id)) {
      throw conflict('AUCUNE_VENTE', 'Aucune vente n’est enregistrée pour cette commande : annulez-la plutôt.');
    }
    this.finishOrder(actor, o.id);
    this.audit(actor, 'commande.cloturer', 'client_order', o.id, { client: o.member_id });
    return { id: o.id, status: 'retiree' };
  },

  finishOrder(actor, orderId) {
    this.run("UPDATE client_orders SET status = 'retiree', closed_at = ?, closed_by = ? WHERE id = ?", this.nowIso(), actor.id, orderId);
  },

  // ---------------------------------------------------------------- the counter sale of an order

  // Checks that a sale about to be made is the order's own: open order, same buyer, a rayon it has lines in, not yet
  // sold. Called by createShopSale before anything is written.
  assertSaleMatchesOrder(orderId, account, buyer) {
    const o = this.openOrderRow(orderId);
    if (buyer.kind === 'journalier' || o.member_id !== Number(buyer.member_id)) {
      throw conflict('COMMANDE_AUTRE_ACHETEUR', 'Cette commande est celle d’un autre client.');
    }
    if (!this.get('SELECT 1 AS x FROM client_order_lines WHERE order_id = ? AND account = ?', o.id, account)) {
      throw conflict('COMMANDE_SANS_RAYON', `Cette commande n’a aucun produit du rayon ${SHOP[account].tab}.`);
    }
    if (this.get('SELECT 1 AS x FROM client_order_sales WHERE order_id = ? AND account = ?', o.id, account)) {
      throw conflict('COMMANDE_DEJA_ENCAISSEE', `Le rayon ${SHOP[account].tab} de cette commande est déjà encaissé.`);
    }
    return o;
  },

  // Once the sale is written: remembers it, and ends the order when every rayon it has lines in was sold.
  linkSaleToOrder(actor, orderId, account, saleId) {
    this.run('INSERT INTO client_order_sales (order_id, account, sale_id) VALUES (?, ?, ?)', orderId, account, saleId);
    const wanted = RAYONS.filter((r) => this.get('SELECT 1 AS x FROM client_order_lines WHERE order_id = ? AND account = ?', orderId, r));
    const sold = this.all('SELECT account FROM client_order_sales WHERE order_id = ?', orderId).map((r) => r.account);
    if (wanted.every((r) => sold.includes(r))) this.finishOrder(actor, orderId);
  },
};
