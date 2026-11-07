// Regular clients buying on credit (spec docs/superpowers/specs/2026-11-07-credit-clients-design.md). Mixed into Club
// (end of club.js) like the caisses: `this` is the Club instance, and no method opens a transaction of its own.
//
// A credit sale is a Boutique sale (`shop_sales.on_credit`) whose lines stay due: no money came in, so they count in no
// caisse (the rule of every unpaid note). A settlement is an ordinary payment (`payments.settlement`) that pays the
// client's due credit lines oldest first, the last one possibly in part (`charges.settled` keeps what is paid of a line):
// each franc lands in the caisse of the line it pays, on the day it is received. Cancelling a settlement gives its money
// back through refunds dated that day, so closed days and caisses are protected as for any refund.
import { conflict, invalid, forbidden, notFound } from './errors.js';
import { int, text, toId } from './validate.js';
import { isBoss, SHOP } from '../shared/roles.js';
import { CARD_METHOD } from '../shared/rules.js';
import { formatTicketNumber } from '../shared/ticket.js';

// The due credit lines of a client, oldest first: the order a settlement pays them in.
const DUE_CREDIT_LINES = `
  SELECT c.* FROM charges c JOIN shop_sales s ON s.id = c.shop_sale_id
  WHERE c.member_id = ? AND s.on_credit = 1 AND c.status = 'due'
  ORDER BY c.created_at, c.id`;

export const creditMethods = {
  // What a client owes now: the unpaid part of his credit lines.
  creditOwed(memberId) {
    return this.get(
      `SELECT COALESCE(SUM(c.amount - c.settled), 0) AS n FROM charges c JOIN shop_sales s ON s.id = c.shop_sale_id
       WHERE c.member_id = ? AND s.on_credit = 1 AND c.status = 'due'`, memberId,
    ).n;
  },

  // Whether a line belongs to a credit sale: such a line is paid only by a settlement.
  isCreditLine(c) {
    return !!c.shop_sale_id && !!this.get('SELECT on_credit FROM shop_sales WHERE id = ?', c.shop_sale_id)?.on_credit;
  },

  clientRow(id) {
    const m = this.fileRow(id);
    if (m.kind !== 'client') throw conflict('PAS_CLIENT', `${m.first_name} ${m.last_name} n’est pas un client régulier.`);
    return m;
  },

  // A credit sale must fit under the client's limit, debt already owed included. Nobody goes past it: a boss raises
  // the limit first.
  assertCreditAllowed(m, total) {
    const who = `${m.first_name} ${m.last_name}`;
    if (!(m.credit_limit > 0)) {
      throw conflict('SANS_CREDIT', `${who} n’a pas de crédit : un associé ou l’administrateur fixe d’abord son plafond sur sa fiche.`);
    }
    const owed = this.creditOwed(m.id);
    if (owed + total > m.credit_limit) {
      throw conflict(
        'PLAFOND_CREDIT',
        `Crédit refusé : ${who} doit déjà ${this.money(owed)} ; avec cette vente (${this.money(total)}) il devrait ${this.money(owed + total)}, au-delà de son plafond de ${this.money(m.credit_limit)}. Crédit encore possible : ${this.money(Math.max(0, m.credit_limit - owed))}.`,
        { owed, limit: m.credit_limit, total },
      );
    }
  },

  // The administrator or an associé sets how much a client may owe; 0 means no credit.
  setCreditLimit(actor, id, input) {
    if (!isBoss(actor)) throw forbidden('Seuls l’administrateur et les associés fixent le plafond de crédit.');
    const m = this.clientRow(toId(id, 'Client'));
    const limit = int(input?.credit_limit, 'Plafond de crédit', { min: 0, max: 1e13 });
    this.run('UPDATE members SET credit_limit = ?, updated_at = ?, updated_by = ? WHERE id = ?', limit, this.nowIso(), actor.id, m.id);
    this.audit(actor, 'client.plafond', 'member', m.id, { nom: `${m.first_name} ${m.last_name}`, avant: m.credit_limit, apres: limit });
    return this.clientAccount(m.id);
  },

  // « Enregistrer un règlement »: any amount up to the debt, by a configured payment method (never the card: a client
  // has none). Anyone who may collect a note may record it, the manager too. It pays the due credit lines oldest first;
  // the last one may be paid in part and stays due for the rest.
  recordSettlement(actor, id, input) {
    const m = this.clientRow(toId(id, 'Client'));
    const owed = this.creditOwed(m.id);
    if (owed === 0) throw conflict('RIEN_A_REGLER', `${m.first_name} ${m.last_name} ne doit rien.`);
    const amount = int(input?.amount, 'Montant', { min: 1, max: 1e13 });
    if (amount > owed) throw invalid(`Le règlement dépasse la dette : ${m.first_name} ${m.last_name} doit ${this.money(owed)}.`, 'TROP_PAYE');
    const method = text(input?.method, 'Moyen de paiement', { required: true, max: 40 });
    if (method === CARD_METHOD || !this.settings().payment_methods.includes(method)) throw invalid('Moyen de paiement non configuré.');
    this.assertOpen(this.bizToday(), 'Ce règlement');
    const paymentId = this.insert(
      `INSERT INTO payments (member_id, reservation_id, amount, method, reference, paid_at, created_by, ticket_code, card_amount,
         shop_sale_id, settlement, label)
       VALUES (?, NULL, ?, ?, NULL, ?, ?, ?, 0, NULL, 1, 'Règlement de créance')`,
      m.id, amount, method, this.nowIso(), actor.id, this.freshTicketCode(),
    );
    let left = amount;
    for (const c of this.all(DUE_CREDIT_LINES, m.id)) {
      if (left === 0) break;
      const part = Math.min(left, c.amount - c.settled);
      left -= part;
      this.run('INSERT INTO payment_allocations (payment_id, charge_id, account, amount) VALUES (?, ?, ?, ?)', paymentId, c.id, c.account, part);
      const settled = c.settled + part;
      const res = this.run(
        "UPDATE charges SET settled = ?, status = ? WHERE id = ? AND status = 'due' AND settled = ?",
        settled, settled === c.amount ? 'payee' : 'due', c.id, c.settled,
      );
      if (res.changes !== 1) throw conflict('DEJA_TRAITEE', `La ligne « ${c.label} » a été traitée entre-temps.`);
    }
    const payment = this.paymentDTO(this.paymentRow(paymentId));
    this.audit(actor, 'client.reglement', 'member', m.id, {
      payment_id: paymentId, montant: amount, moyen: method, ventilation: payment.by_account, reste: owed - amount,
    });
    return { payment, account: this.clientAccount(m.id) };
  },

  // A settlement typed by mistake: the administrator or an associé cancels it, with a reason. Its money goes back out
  // today, from the caisse each part went into (refused when that caisse holds too little), and the lines it paid are
  // due again. A line whose sale was cancelled since cannot take it back: the refund of that sale already did.
  cancelSettlement(actor, paymentId, input) {
    if (!isBoss(actor)) throw forbidden('Seuls l’administrateur et les associés annulent un règlement.');
    const p = this.get('SELECT * FROM payments WHERE id = ?', toId(paymentId, 'Règlement'));
    if (!p) throw notFound('Règlement');
    if (!p.settlement) throw conflict('PAS_UN_REGLEMENT', 'Cet encaissement n’est pas un règlement de créance.');
    if (p.cancelled_at) throw conflict('DEJA_ANNULEE', 'Ce règlement est déjà annulé.');
    const reason = text(input?.reason, 'Motif d’annulation', { required: true, min: 3, max: 300 });
    this.assertOpen(this.bizToday(), 'Cette annulation');
    const parts = this.all(
      `SELECT pa.id, pa.amount, pa.account, c.id AS charge_id, c.status, c.settled, c.label
       FROM payment_allocations pa JOIN charges c ON c.id = pa.charge_id WHERE pa.payment_id = ? ORDER BY pa.id`, p.id,
    );
    if (parts.some((x) => x.status !== 'due' && x.status !== 'payee')) {
      throw conflict('VENTE_ANNULEE', 'Une vente payée par ce règlement a été annulée depuis : ce règlement ne peut plus être annulé.');
    }
    const byAccount = new Map();
    for (const x of parts) byAccount.set(x.account, (byAccount.get(x.account) ?? 0) + x.amount);
    for (const [account, total] of byAccount) this.assertCaisseCovers(account, total, 'Cette annulation de règlement', actor);
    const now = this.nowIso();
    for (const x of parts) {
      this.insert(
        `INSERT INTO refunds (charge_id, payment_id, account, amount, method, reference, reason, restocked, created_at, created_by, card_amount)
         VALUES (?, ?, ?, ?, ?, NULL, ?, 0, ?, ?, 0)`,
        x.charge_id, p.id, x.account, x.amount, p.method, `Annulation du règlement : ${reason}`, now, actor.id,
      );
      this.run("UPDATE charges SET settled = settled - ?, status = 'due' WHERE id = ?", x.amount, x.charge_id);
    }
    this.run('UPDATE payments SET cancelled_at = ?, cancelled_by = ?, cancel_reason = ? WHERE id = ?', now, actor.id, reason, p.id);
    this.audit(actor, 'client.reglement.annuler', 'member', p.member_id, {
      payment_id: p.id, montant: p.amount, moyen: p.method, motif: reason,
    });
    return { account: this.clientAccount(p.member_id) };
  },

  // Cancelling a credit sale (from cancelShopSale, which checked the rights and the reason): every line's goods come
  // back and its debt is erased; what was already settled of a line goes back to the client, each settlement's part by
  // that settlement's own method and against its own payment (a line may have been paid in several), out of the caisse
  // of the sale, never below zero. A line not paid at all moves no money.
  cancelCreditLines(actor, lines, reason) {
    this.assertOpen(this.bizToday(), 'Cette annulation');
    const parts = lines.map((c) => ({
      c,
      live: this.all(
        `SELECT pa.amount, pa.account, p.id AS payment_id, p.method FROM payment_allocations pa JOIN payments p ON p.id = pa.payment_id
         WHERE pa.charge_id = ? AND p.cancelled_at IS NULL ORDER BY pa.id`, c.id,
      ),
    }));
    const byAccount = new Map();
    for (const { c, live } of parts) for (const x of live) byAccount.set(c.account, (byAccount.get(c.account) ?? 0) + x.amount);
    for (const [account, total] of byAccount) this.assertCaisseCovers(account, total, 'Ce remboursement', actor);
    const now = this.nowIso();
    for (const { c, live } of parts) {
      for (const x of live) {
        this.insert(
          `INSERT INTO refunds (charge_id, payment_id, account, amount, method, reference, reason, restocked, created_at, created_by, card_amount)
           VALUES (?, ?, ?, ?, ?, NULL, ?, 1, ?, ?, 0)`,
          c.id, x.payment_id, c.account, x.amount, x.method, reason, now, actor.id,
        );
      }
      if (c.status === 'payee') this.run("UPDATE charges SET status = 'remboursee' WHERE id = ?", c.id);
      else {
        this.run(
          "UPDATE charges SET status = 'annulee', cancelled_at = ?, cancelled_by = ?, cancel_reason = ? WHERE id = ? AND status = 'due'",
          now, actor.id, reason, c.id,
        );
      }
      this.moveStock(actor, c.product_id, c.quantity, 'retour', { chargeId: c.id, reason });
    }
  },

  // The client's account (« Compte client »): the debt, the limit, what is still possible, and the statement in date
  // order, each movement with the balance after it. A movement is « due » (the client owes more) or « paid » (less):
  // - a credit sale: due, its whole amount;
  // - a settlement: paid; its cancellation: due again, on the day of the cancellation;
  // - a cancelled credit sale: paid, its whole amount; what of it was already settled is given back to the client on
  //   the same day (due), so the balance comes back to what it was before the sale.
  // The same shape (date, operation, due, paid, balance) is meant for the suppliers' accounts later.
  clientAccount(id) {
    const m = this.clientRow(toId(id, 'Client'));
    const moves = [];
    for (const s of this.all(
      `SELECT s.*, u.name AS created_by_name, cu.name AS cancelled_by_name,
         (SELECT COALESCE(SUM(amount), 0) FROM charges WHERE shop_sale_id = s.id) AS amount,
         (SELECT GROUP_CONCAT(quantity || '× ' || label, ' · ') FROM charges WHERE shop_sale_id = s.id) AS items
       FROM shop_sales s LEFT JOIN users u ON u.id = s.created_by LEFT JOIN users cu ON cu.id = s.cancelled_by
       WHERE s.member_id = ? AND s.on_credit = 1 ORDER BY s.created_at, s.id`, m.id,
    )) {
      const rayon = SHOP[s.account].tab;
      moves.push({
        key: `V-${s.id}`, at: s.created_at, order: 0, kind: 'achat', label: `Achat à crédit — ${rayon}`, detail: s.items,
        due: s.amount, paid: 0, sale_id: s.id, by: s.created_by_name ?? null, cancelled_at: s.cancelled_at ?? null,
      });
      if (s.cancelled_at) {
        moves.push({
          key: `VA-${s.id}`, at: s.cancelled_at, order: 2, kind: 'annulation_achat', label: `Achat annulé — ${rayon}`,
          detail: s.cancel_reason, due: 0, paid: s.amount, sale_id: s.id, by: s.cancelled_by_name ?? null,
        });
        const back = this.get(
          `SELECT COALESCE(SUM(rf.amount), 0) AS n FROM refunds rf JOIN charges c ON c.id = rf.charge_id
           WHERE c.shop_sale_id = ? AND rf.restocked = 1`, s.id,
        ).n;
        if (back) {
          moves.push({
            key: `VR-${s.id}`, at: s.cancelled_at, order: 3, kind: 'rendu', label: 'Déjà réglé, rendu au client',
            detail: s.cancel_reason, due: back, paid: 0, sale_id: s.id, by: s.cancelled_by_name ?? null,
          });
        }
      }
    }
    for (const p of this.all(
      `SELECT p.*, u.name AS created_by_name, cu.name AS cancelled_by_name FROM payments p
       LEFT JOIN users u ON u.id = p.created_by LEFT JOIN users cu ON cu.id = p.cancelled_by
       WHERE p.member_id = ? AND p.settlement = 1 ORDER BY p.paid_at, p.id`, m.id,
    )) {
      const base = { payment_id: p.id, ticket_number: formatTicketNumber(p.id), method: p.method };
      moves.push({
        ...base, key: `R-${p.id}`, at: p.paid_at, order: 1, kind: 'reglement', label: `Règlement — ${p.method}`, detail: null,
        due: 0, paid: p.amount, by: p.created_by_name ?? null, cancelled_at: p.cancelled_at ?? null,
      });
      if (p.cancelled_at) {
        moves.push({
          ...base, key: `RA-${p.id}`, at: p.cancelled_at, order: 2, kind: 'annulation_reglement', label: 'Règlement annulé',
          detail: p.cancel_reason, due: p.amount, paid: 0, by: p.cancelled_by_name ?? null,
        });
      }
    }
    moves.sort((x, y) => (x.at < y.at ? -1 : x.at > y.at ? 1 : x.order - y.order));
    let balance = 0;
    for (const x of moves) {
      balance += x.due - x.paid;
      x.balance = balance;
      delete x.order;
    }
    const owed = this.creditOwed(m.id);
    return {
      member_id: m.id, name: `${m.first_name} ${m.last_name}`, member_no: m.member_no, active: m.active !== 0,
      credit_limit: m.credit_limit, owed, available: Math.max(0, m.credit_limit - owed), movements: moves,
    };
  },
};
