// Reservation requests of the client space (spec « Espace client »). Mixed into Club (end of club.js): `this` is the
// Club instance, and no method opens a transaction of its own (the API wraps every write).
// A request only asks for a slot: it holds nothing and moves no money. The staff confirms it with the usual booking
// (createReservation with `request_id`: gap, deposit for 3 h or more, tariffs all apply) or refuses it with a message.
// A client learns whether a slot is free, never who holds it: every answer here is built field by field.
import { AppError, conflict, invalid, notFound } from './errors.js';
import { int, text, toId } from './validate.js';
import { isValidDate, addDays, localToUtcMs } from '../shared/time.js';
import { depositFor } from '../shared/rules.js';

const MAX_PENDING = 3;
const LEAD_MIN = 60;
const HORIZON_DAYS = 30;
const hhmm = (min) => `${String(Math.floor(min / 60) % 24).padStart(2, '0')}:${String(min % 60).padStart(2, '0')}`;

export const clientRequestMethods = {
  // Only a member whose file is active and who holds an active card can ask (a regular client has no room access).
  assertCanRequest(memberId) {
    const m = this.get('SELECT kind, active FROM members WHERE id = ?', memberId);
    const closed = () => new AppError(403, 'RESERVATION_NON_OUVERTE', 'La demande de réservation est réservée aux membres du club ayant une carte active.');
    if (!m || m.kind !== 'membre' || m.active !== 1) throw closed();
    if (this.hasDeactivatedCardsOnly(memberId) || !this.activeCardCode(memberId)) throw closed();
  },

  // The fields of a request body, checked and normalised.
  requestInput(input) {
    return {
      date: input?.date,
      start_time: input?.start_time,
      duration_min: int(input?.duration_min, 'Durée', { min: 1, max: 1440 }),
      party_size: input?.party_size === undefined || input?.party_size === '' || input?.party_size === null
        ? 1 : int(input.party_size, 'Nombre de personnes', { min: 1, max: 200 }),
    };
  },

  // Plans the slot as a member paying with his card would book it; the plan throws when the slot is invalid.
  planRequest(memberId, roomId, q) {
    return this.planReservation({ member_id: memberId, room_id: roomId, ...q, pay_with_card: true });
  },

  // Whether the plan's slot can be asked for now: not too near, not too far, nothing in the way. Says nothing of why.
  slotOpen(plan) {
    const now = this.nowMs();
    return plan.startMs >= now + LEAD_MIN * 60000 && plan.startMs <= now + HORIZON_DAYS * 86400000
      && !plan.conflicts.length && !plan.gap_conflicts.length;
  },

  clientSlots(memberId, query) {
    this.assertCanRequest(memberId);
    const q = this.requestInput({ ...query, start_time: '00:00' });
    if (!isValidDate(q.date)) throw invalid('Date invalide.');
    const room = this.resolveRoom();
    const step = this.settings().booking.slot_min;
    const open = this.window().open;
    const slots = [];
    for (let t = open; t < open + 1440; t += step) {
      try {
        if (this.slotOpen(this.planRequest(memberId, room.id, { ...q, start_time: hhmm(t) }))) slots.push(hhmm(t));
      } catch (err) {
        if (!(err instanceof AppError)) throw err;
      }
    }
    return { slots };
  },

  clientRequestQuote(memberId, input) {
    this.assertCanRequest(memberId);
    const q = this.requestInput(input);
    const quote = this.quoteReservation(null, { member_id: memberId, room_id: this.resolveRoom().id, ...q, pay_with_card: true });
    // Owner's decision 8: a card whose balance covers the deposit pays it at the confirmation (as createReservation
    // does); otherwise the deposit is paid at the club, or the card recharged, before the club confirms.
    return {
      included_minutes: quote.included_minutes, paid_minutes: quote.paid_minutes, supplement_amount: quote.supplement_amount,
      card_amount: quote.card_amount, deposit_amount: quote.deposit_amount,
      deposit_from_card: quote.deposit_amount > 0 && quote.card_balance >= quote.deposit_amount,
    };
  },

  requestView(r) {
    return {
      id: r.id, date: r.date, start_time: r.start_time, duration_min: r.duration_min, party_size: r.party_size, status: r.status,
      message: r.message ?? null, deposit_amount: this.requestDeposit(r),
    };
  },

  createClientRequest(memberId, input) {
    this.assertCanRequest(memberId);
    const q = this.requestInput(input);
    if (this.get("SELECT COUNT(*) AS n FROM reservation_requests WHERE member_id = ? AND status = 'en_attente'", memberId).n >= MAX_PENDING) {
      throw conflict('TROP_DE_DEMANDES', `Vous avez déjà ${MAX_PENDING} demandes en attente : attendez une réponse du club ou annulez-en une.`);
    }
    const room = this.resolveRoom();
    if (!this.slotOpen(this.planRequest(memberId, room.id, q))) {
      throw conflict('CRENEAU_INDISPONIBLE', 'Ce créneau n’est plus disponible : choisissez-en un autre.');
    }
    const id = this.insert(
      `INSERT INTO reservation_requests (member_id, room_id, date, start_time, duration_min, party_size, status, created_at)
       VALUES (?, ?, ?, ?, ?, ?, 'en_attente', ?)`,
      memberId, room.id, q.date, q.start_time, q.duration_min, q.party_size, this.nowIso(),
    );
    this.audit(null, 'client.demande.creer', 'reservation_request', id, { client: memberId, date: q.date, debut: q.start_time, duree: q.duration_min });
    return this.requestView(this.get('SELECT * FROM reservation_requests WHERE id = ?', id));
  },

  // A foreign or unknown id is « not found »; a request already answered cannot be cancelled.
  cancelClientRequest(memberId, requestId) {
    const r = this.get('SELECT * FROM reservation_requests WHERE id = ? AND member_id = ?', toId(requestId, 'Demande'), memberId);
    if (!r) throw notFound('Demande');
    if (r.status !== 'en_attente') throw conflict('DEMANDE_TRAITEE', 'Cette demande a déjà reçu une réponse.');
    this.run("UPDATE reservation_requests SET status = 'annulee', decided_at = ? WHERE id = ?", this.nowIso(), r.id);
    this.audit(null, 'client.demande.annuler', 'reservation_request', r.id, { client: memberId });
    return this.requestView(this.get('SELECT * FROM reservation_requests WHERE id = ?', r.id));
  },

  // ---------------------------------------------------------------- staff side

  pendingRequestRow(requestId) {
    const r = this.get('SELECT * FROM reservation_requests WHERE id = ?', toId(requestId, 'Demande'));
    if (!r) throw notFound('Demande');
    if (r.status !== 'en_attente') throw conflict('DEMANDE_TRAITEE', 'Cette demande a déjà reçu une réponse.');
    return r;
  },

  // Every pending request, oldest first, for any staff member.
  staffRequests() {
    return this.all("SELECT * FROM reservation_requests WHERE status = 'en_attente' ORDER BY created_at, id").map((r) => {
      const m = this.get('SELECT id, first_name, last_name, member_no, kind, phone FROM members WHERE id = ?', r.member_id);
      let estimate = null;
      try {
        const p = this.planRequest(r.member_id, r.room_id, r);
        estimate = {
          included_minutes: p.included, paid_minutes: p.paid, supplement_amount: p.supplement, deposit_amount: depositFor(p.duration, p.supplement),
          available: !p.conflicts.length && !p.gap_conflicts.length,
        };
      } catch { /* the slot can no longer be planned: the staff decides */ }
      return {
        id: r.id, created_at: r.created_at, date: r.date, start_time: r.start_time, duration_min: r.duration_min, party_size: r.party_size,
        room_id: r.room_id,
        member: { id: m.id, name: `${m.first_name} ${m.last_name}`, member_no: m.member_no, kind: m.kind, phone: m.phone },
        estimate,
      };
    });
  },

  refuseRequest(actor, requestId, input) {
    const r = this.pendingRequestRow(requestId);
    const message = text(input?.message, 'Message', { required: true, min: 3, max: 300 });
    this.run("UPDATE reservation_requests SET status = 'refusee', decided_at = ?, decided_by = ?, message = ? WHERE id = ?", this.nowIso(), actor.id, message, r.id);
    this.audit(actor, 'demande.refuser', 'reservation_request', r.id, { client: r.member_id, motif: message });
    return { id: r.id, status: 'refusee' };
  },

  // Called by createReservation before anything is written: the request must be pending and the booking the same member's.
  assertRequestMatches(requestId, memberId) {
    const r = this.pendingRequestRow(requestId);
    if (r.member_id !== memberId) throw conflict('DEMANDE_AUTRE_MEMBRE', 'Cette demande est celle d’un autre membre.');
    return r;
  },

  // Called once the booking is written: the request is answered and linked to it.
  linkRequestToReservation(actor, requestId, reservationId) {
    this.run(
      "UPDATE reservation_requests SET status = 'confirmee', reservation_id = ?, decided_at = ?, decided_by = ? WHERE id = ?",
      reservationId, this.nowIso(), actor.id, requestId,
    );
  },
};
