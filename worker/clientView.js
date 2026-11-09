// What a signed-in client sees of his own file (spec « Espace client »): account, history, tickets. Mixed into Club
// (end of club.js). Every answer is built field by field from the staff's views, never passed through: a staff name,
// a note, a reason typed by staff or a reference must not reach a client, whatever the staff's view carries.
import { notFound, invalid } from './errors.js';
import { localParts } from '../shared/time.js';
import { DEPOSIT_FROM, depositFor } from '../shared/rules.js';

// The ticket fields a client never gets: the next duplicate's number (the staff's count of copies), the reasons typed
// by staff when the sale or payment was cancelled, and the cashier's name.
const TICKET_HIDDEN = ['next_copy_no', 'cancel_reason', 'shop_cancel_reason', 'created_by_name'];
const COPY_KINDS = ['impression', 'telechargement'];
const CHARGE_STATUS = { due: 'a_regler', payee: 'valide', annulee: 'annule', remboursee: 'rembourse' };
const SESSION_STATUS = { reservee: 'reservee', en_cours: 'en_cours', terminee: 'valide', annulee: 'annule' };
// How far back a refused request stays visible.
const REFUSED_DAYS = 30;

export const clientViewMethods = {
  clientAccountView(memberId) {
    const m = this.fileRow(memberId);
    const tz = this.settings().timezone;
    const today = this.bizToday();
    const now = this.nowMs();
    const when = (ms) => localParts(ms, tz);
    const isClient = m.kind === 'client';

    const current = isClient ? null : this.subscriptionSummary(m.id, today);
    const subscription = current && ['active', 'expire_bientot'].includes(current.state)
      ? { plan_name: current.plan_name, end_date: current.end_date, available_min: current.credit.available } : null;

    let credit = null;
    if (isClient) {
      const owed = this.creditOwed(m.id);
      const limit = m.credit_limit ?? 0;
      if (limit > 0 || owed > 0) credit = { owed, limit, available: Math.max(0, limit - owed) };
    }

    const running = this.get(
      `SELECT r.start_ms, r.end_ms, rm.name AS room_name FROM reservations r LEFT JOIN rooms rm ON rm.id = r.room_id
       WHERE r.member_id = ? AND r.status = 'en_cours' ORDER BY r.start_ms DESC LIMIT 1`, m.id,
    );
    const reservations = this.all(
      "SELECT * FROM reservations WHERE member_id = ? AND status = 'reservee' AND start_ms > ? ORDER BY start_ms", m.id, now,
    ).map((r) => ({
      id: r.id, date: when(r.start_ms).date, start_time: when(r.start_ms).time, end_time: when(r.end_ms).time,
      duration_min: r.duration_min, party_size: r.party_size ?? 1, status: r.status,
    }));

    const since = new Date(now - REFUSED_DAYS * 86400000).toISOString();
    const requests = this.all(
      `SELECT * FROM reservation_requests WHERE member_id = ?
         AND (status = 'en_attente' OR (status = 'refusee' AND COALESCE(decided_at, created_at) >= ?)) ORDER BY date, start_time, id`,
      m.id, since,
    ).map((q) => ({
      id: q.id, date: q.date, start_time: q.start_time, duration_min: q.duration_min, party_size: q.party_size, status: q.status,
      message: q.message ?? null, deposit_amount: this.requestDeposit(q),
    }));

    return {
      member: { first_name: m.first_name, last_name: m.last_name, member_no: m.member_no, kind: m.kind },
      server_now: new Date(now).toISOString(),
      wallet: isClient ? null : { balance: this.walletBalance(m.id) },
      subscription,
      credit,
      in_session: running
        ? { room_name: running.room_name ?? null, start_at: new Date(running.start_ms).toISOString(), end_at: new Date(running.end_ms).toISOString() }
        : null,
      reservations,
      requests,
    };
  },

  // The deposit still due for a pending request of 3 hours or more, as planning it now gives it (a member
  // without a plan pays by card); 0 for any other request,
  // or when the slot can no longer be planned (the staff decides then).
  requestDeposit(q) {
    if (q.status !== 'en_attente' || q.duration_min < DEPOSIT_FROM) return 0;
    try {
      const p = this.planReservation({
        member_id: q.member_id, room_id: q.room_id, date: q.date, start_time: q.start_time, duration_min: q.duration_min,
        party_size: q.party_size, pay_with_card: true,
      });
      return depositFor(p.duration, p.supplement);
    } catch {
      return 0;
    }
  },

  clientHistory(memberId, from, to) {
    const statement = this.memberStatement(memberId, from, to);
    const { start_at: startAt, end_at: endAt } = statement.period;
    const items = [];
    const item = (at, kind, label, amount, paymentId, ticketNumber, status) => items.push({
      at, kind, label, amount, payment_id: paymentId ?? null, ticket_number: ticketNumber ?? null, status,
    });
    const payments = new Map(statement.payments.map((p) => [p.id, p]));

    for (const w of statement.wallet) {
      if (w.kind === 'recharge') {
        item(w.at, 'recharge', 'Recharge de la carte', w.amount, w.payment_id, w.number, payments.get(w.payment_id)?.cancelled_at ? 'annule' : 'valide');
      } else if (w.kind === 'remboursement') {
        item(w.at, 'remboursement', 'Remboursement sur la carte', w.amount, w.payment_id, w.number, 'valide');
      }
    }
    for (const r of statement.refunds) item(r.at, 'remboursement', `Remboursement — ${r.label}`, r.amount, r.payment_id, r.number, 'valide');
    for (const p of statement.payments) {
      if (p.settlement) item(p.paid_at, 'reglement', 'Règlement', p.amount, p.id, p.number, p.cancelled_at ? 'annule' : 'valide');
    }
    for (const r of statement.reservations) {
      if (r.status === 'reservee') continue;
      item(r.start_at, 'seance', `Séance — ${r.room_name}`, r.supplement_amount, null, null, SESSION_STATUS[r.status]);
    }
    for (const s of statement.subscriptions) {
      if (s.created_at >= startAt && s.created_at < endAt) {
        item(s.created_at, 'abonnement', `Abonnement — ${s.plan_name}`, s.price, null, null, s.status === 'annulee' ? 'annule' : 'valide');
      }
    }
    for (const l of this.purchaseHistory(memberId).lines) {
      if (l.at >= startAt && l.at < endAt) {
        item(l.at, 'achat', `${l.quantity}× ${l.label}`, l.amount, l.payment_id, l.ticket_number, CHARGE_STATUS[l.status] ?? l.status);
      }
    }
    items.sort((x, y) => (x.at < y.at ? 1 : x.at > y.at ? -1 : 0));
    return { period: { from: statement.period.from, to: statement.period.to }, items };
  },

  // The payment row when it is the member's own and not a walk-in's, else null.
  clientOwnPayment(memberId, paymentId) {
    const p = this.ticketPaymentRow(paymentId);
    return p && p.member_id === memberId && p.member_kind !== 'journalier' ? p : null;
  },

  clientTicket(memberId, paymentId) {
    if (!this.clientOwnPayment(memberId, paymentId)) throw notFound('Ticket');
    // ticketFor reads its actor for isBoss only: a client is never one, so the staff's journal of copies is not built.
    const { ticket } = this.ticketFor({ role: 'client' }, paymentId);
    for (const key of TICKET_HIDDEN) delete ticket[key];
    return { ticket };
  },

  // A client's own print or download is noted apart: it is not a numbered duplicate, ticket_events stays the staff's.
  recordClientTicketCopy(memberId, paymentId, input) {
    const kind = input?.kind;
    if (!COPY_KINDS.includes(kind)) throw invalid('Sortie de ticket inconnue.');
    if (!this.clientOwnPayment(memberId, paymentId)) throw notFound('Ticket');
    const at = this.nowIso();
    this.run(
      'INSERT INTO client_ticket_copies (payment_id, member_id, kind, at) VALUES (?, ?, ?, ?)', Number(paymentId), memberId, kind, at,
    );
    return { kind, at };
  },
};
