// Reservation dialogs shared by several screens. Each dialog keeps one idempotency key for its whole
// life, so a double click or a retry after a network error never records the operation twice.
import { useEffect, useRef, useState } from 'react';
import { api, newKey } from '../lib/api.js';
import { money, fmtDuration, dayLabel, win, bizToday, parts, relLabel, subStateLabel } from '../lib/format.js';
import { useStore, useSettings } from '../store/useStore.js';
import { openDialog, Modal, actionDialog } from '../components/ui/Modal.jsx';
import { toast } from '../components/ui/toast.jsx';
import Icon from '../components/ui/Icon.jsx';
import { AccountTag, Chip, Hypothesis, Loaded, Notice, FormError } from '../components/ui/ui.jsx';
import ConsumptionBreakdown, { ConsumerPicker, consumptionOf } from '../components/ui/ConsumptionBreakdown.jsx';
import { useLoad, useSubmit } from '../lib/hooks.js';
import { openPaymentDialog } from './moneyDialogs.jsx';
import { daysBetween, parseHHMM } from '../../shared/time.js';
import { minDurationFor, supplementDetail } from '../../shared/rules.js';
import { waDigits, waLink, bookingConfirmationText } from '../../shared/whatsapp.js';

export function supplementText(paid, tariff) {
  if (!paid) return 'aucun';
  const d = supplementDetail(paid);
  const pieces = [];
  if (d.hours) pieces.push(`${d.hours} h × ${money(tariff.hour)}`);
  if (d.halves) pieces.push(`1 demi-heure × ${money(tariff.half)}`);
  return `${fmtDuration(paid)} → ${pieces.join(' + ')}`;
}

// Minutes from the business day's midnight: a time before the day starts is the following night.
const startRelOf = (time) => {
  const m = parseHHMM(time);
  return m < win().open ? m + 1440 : m;
};

function defaultStart(date) {
  const w = win();
  const { slot_min: slot, min_duration_min: minDur } = useStore.getState().settings.booking;
  const last = w.maxEnd - minDur;
  if (date === bizToday()) {
    const p = parts(Date.now());
    let rel = Math.ceil((daysBetween(date, p.date) * 1440 + p.minutes) / slot) * slot;
    if (rel < w.open) rel = w.open;
    if (rel <= last) return relLabel(rel);
  }
  const evening = 18 * 60;
  return relLabel(evening >= w.open && evening <= last ? evening : w.open);
}

const creditLine = (summary) => (summary?.credit
  ? ` · crédit disponible ${fmtDuration(summary.credit.available)}` : '');

// Whether a member may take the room. With `card`, the booking member who has no plan, or no time left on it,
// may still book: the time is then paid with the card's money (`cardOnly`). The people he brings along always
// need their own plan and time.
export function memberRoomEligibility(m, { card = false } = {}) {
  if (!m) return { ok: false, reason: 'Membre inconnu' };
  if (m.active === false) return { ok: false, reason: 'Membre désactivé' };
  if (m.cards_deactivated) return { ok: false, reason: 'Carte désactivée' };
  const state = m.subscription?.state;
  const avail = m.subscription?.credit?.available ?? 0;
  let reason = null;
  if (!['active', 'expire_bientot'].includes(state)) reason = state === 'expiree' ? 'Carte / formule expirée' : 'Aucune formule active';
  else if (avail <= 0) reason = 'Crédit épuisé (0 min)';
  if (!reason) return { ok: true, available: avail };
  return card ? { ok: true, available: 0, cardOnly: true, reason } : { ok: false, reason };
}

const conflictText = (conflicts) => conflicts.map((c) => `${c.member_name} (${c.start_time} – ${c.end_time})`).join(', ');

// ---------------------------------------------------------------- new reservation

// The club has no opening hours: any start of the business day can be booked, for any length.
const LONGEST_OFFERED = 12 * 60; // the longest duration in the list; a session can be extended beyond

function startOptions(w, slot) {
  const out = [];
  for (let rel = w.open; rel < w.maxEnd; rel += slot) out.push({ label: relLabel(rel), note: rel >= 1440 ? ' (après minuit)' : '' });
  return out;
}

function durationOptions(slot, minDur) {
  const out = [];
  for (let d = minDur; d <= LONGEST_OFFERED; d += slot) out.push({ d });
  return out;
}

// `card`: the paid time is taken from the card's money now (« Payer avec la carte »).
function QuotePanel({ q, now, card }) {
  const warnings = [];
  if (q.deposit_amount && card) {
    warnings.push(<Notice key="deposit" kind="info">{`Séance de 3 h ou plus : l’acompte de 50 % (${money(q.deposit_amount)}) reste acquis au club en cas d’annulation ou d’absence.${q.card_balance < q.deposit_amount ? ' La carte ne couvre pas l’acompte : choisissez le moyen qui paie le reste maintenant.' : ''}`}</Notice>);
  } else if (q.deposit_amount) {
    warnings.push(<Notice key="deposit" kind="info">{now
      ? `Séance de 3 h ou plus avec entrée immédiate : tout le temps payant (${money(q.supplement_amount)}) s’encaisse maintenant.`
      : `Séance de 3 h ou plus : acompte de 50 % (${money(q.deposit_amount)}) encaissé maintenant, solde de ${money(q.balance_amount)} à régler avant l’entrée en salle. Annulable jusqu’à la veille à minuit ; l’acompte reste acquis au club, y compris si le membre ne vient pas.`}</Notice>);
  }
  if (q.conflicts.length) {
    warnings.push(<Notice key="conflicts" kind="danger">{`${q.room?.name ?? 'Salle'} déjà occupée sur ce créneau : ${conflictText(q.conflicts)}. Choisissez une autre salle disponible ci-dessus.`}</Notice>);
  }
  if (q.gap_message) {
    warnings.push(<Notice key="gap" kind="danger">{`${q.gap_message} Choisissez un autre créneau ou une autre salle disponible ci-dessus.`}</Notice>);
  }
  if (q.room && q.party_size > q.room.capacity) {
    warnings.push(<Notice key="cap" kind="warn">{`Le nombre de personnes (${q.party_size}) dépasse la capacité de ${q.room.name} (${q.room.capacity} pers.).`}</Notice>);
  }
  if (q.paid_minutes && q.tariff_blocked) {
    warnings.push(<Notice key="tariff" kind="danger">Le tarif du temps supplémentaire n’est pas validé par un administrateur.</Notice>);
  }
  return (
    <>
      <dl className="calc">
        {q.room ? <div><dt>Salle</dt><dd>{`${q.room.name} · ${q.party_size} pers. (capacité ${q.room.capacity} pers.)`}</dd></div> : null}
        <div><dt>Horaire</dt><dd>{`${dayLabel(q.biz_day, 'medium')} · ${q.start_time} → ${q.end_time}${q.end_next_day ? ' (lendemain)' : ''}`}</dd></div>
        <div><dt>Durée</dt><dd>{fmtDuration(q.duration_min)}</dd></div>
        {q.subscription ? (
          <>
            <div><dt>Formule (titulaire)</dt><dd>{`${q.subscription.plan_name} · jusqu’au ${dayLabel(q.subscription.end_date, 'short')}`}</dd></div>
            <div><dt>Crédit disponible (titulaire)</dt><dd>{fmtDuration(q.credit_before.available)}</dd></div>
            <div><dt>Heures incluses utilisées (titulaire)</dt><dd>{fmtDuration(q.included_minutes)}</dd></div>
          </>
        ) : <div><dt>Formule (titulaire)</dt><dd>Aucune formule : tout le temps est payant</dd></div>}
        {q.extra_attendees?.length ? (
          <div>
            <dt>Crédits accompagnants ({q.extra_attendees.length})</dt>
            <dd>
              {q.extra_attendees.map((a) => `${a.name} : −${fmtDuration(a.included_minutes)} (sur ${fmtDuration(a.credit_available)})`).join(' · ')}
            </dd>
          </div>
        ) : null}
        <div><dt>Temps payant</dt><dd>{supplementText(q.paid_minutes, q.tariff)}
          {q.paid_minutes && !q.tariff.validated
            ? <>{' '}<Hypothesis title="Tarif annoncé dans les messages audio, non encore validé par un administrateur." label="tarif à valider" /></>
            : null}</dd></div>
        <div className="total"><dt>Supplément à régler</dt><dd>{money(q.supplement_amount)}</dd></div>
        {card ? (
          <>
            <div><dt>Solde de la carte</dt><dd>{money(q.card_balance)}</dd></div>
            <div><dt>Payé par la carte, maintenant</dt><dd>{money(q.card_amount)}</dd></div>
            <div><dt>Reste à payer</dt><dd>{money(q.rest_amount)}</dd></div>
          </>
        ) : null}
        {q.deposit_amount && !now && !card ? (
          <>
            <div><dt>Acompte (50 %), maintenant</dt><dd>{money(q.deposit_amount)}</dd></div>
            <div><dt>Solde, avant l’entrée en salle</dt><dd>{money(q.balance_amount)}</dd></div>
          </>
        ) : null}
        {q.credit_after != null ? <div><dt>Crédit restant après (titulaire)</dt><dd>{fmtDuration(q.credit_after)}</dd></div> : null}
      </dl>
      {warnings.length ? <div className="stack" style={{ marginTop: 10 }}>{warnings}</div> : null}
    </>
  );
}

function BookingDialog({ close, preset, onDone }) {
  const s = useSettings();
  const storeRooms = useStore((st) => st.rooms);
  const activeRooms = storeRooms.filter((rm) => rm.active);
  const w = win();
  const slot = s.booking.slot_min;
  const [key] = useState(newKey);
  const { busy, error, submit } = useSubmit();
  const [init] = useState(() => {
    const date = preset.date ?? bizToday();
    const wanted = preset.start_time ?? defaultStart(date);
    const list = startOptions(win(), slot);
    return {
      date,
      start: list.some((o) => o.label === wanted) ? wanted : (list[0]?.label ?? wanted),
      roomId: preset.room_id ?? activeRooms[0]?.id ?? 1,
      startNow: Boolean(preset.start_now),
    };
  });
  const [member, setMember] = useState(preset.member ?? null);
  const [roomId, setRoomId] = useState(init.roomId);
  const [partySize, setPartySize] = useState(1);
  const [startNow, setStartNow] = useState(init.startNow);
  const [date, setDate] = useState(init.date);
  const [start, setStart] = useState(init.start);
  const [duration, setDuration] = useState(() => minDurationFor(s.booking, init.date, startRelOf(init.start)));
  // Friday and Saturday from 18:00 the minimum is longer (2 h by default).
  const minDur = minDurationFor(s.booking, date, startRelOf(start));
  const [notes, setNotes] = useState('');
  const [depositMethod, setDepositMethod] = useState(s.payment_methods[0] ?? '');
  // Paying with the card is required when the member has no plan or no time left on it, offered otherwise.
  const [payWithCard, setPayWithCard] = useState(() => cardRequired(preset.member));
  const [restMethod, setRestMethod] = useState(''); // '' = what the card cannot pay stays on the note
  const [quote, setQuote] = useState(null);
  const [quoteError, setQuoteError] = useState(null);
  const [loading, setLoading] = useState(() => Boolean(preset.member));
  const [search, setSearch] = useState('');
  const [found, setFound] = useState({ list: null, error: null });

  const seq = useRef(0);
  const searchSeq = useRef(0);
  const quoteTimer = useRef(null);
  const searchTimer = useRef(null);
  const latest = useRef(null);
  latest.current = { member, roomId, partySize, startNow, date, start, duration, notes, depositMethod, payWithCard, restMethod };

  const payload = () => {
    const v = latest.current;
    // Only the booking member is recorded; the people they bring along are counted, not named.
    return {
      member_id: v.member?.id,
      room_id: Number(v.roomId),
      party_size: Number(v.partySize),
      attendee_ids: [],
      // Paid with the card, a member whose time is used up still books: the card pays the whole time.
      require_credit: !v.payWithCard,
      pay_with_card: Boolean(v.payWithCard),
      start_now: Boolean(v.startNow && v.date === bizToday()),
      date: v.date,
      start_time: v.start,
      duration_min: Number(v.duration),
      notes: v.notes,
      // Without the card, used only when a deposit is due (3 h or more with paid time); with it, the method that
      // pays now what the card cannot (none: it stays on the note).
      deposit_method: v.payWithCard ? (v.restMethod || undefined) : v.depositMethod,
    };
  };

  const runQuote = async () => {
    if (!latest.current.member) {
      setQuote(null);
      setLoading(false);
      return;
    }
    const n = (seq.current += 1);
    setLoading(true);
    try {
      const q = await api.preview('/api/reservations/quote', payload());
      if (n !== seq.current) return;
      setQuote(q);
      setQuoteError(null);
    } catch (e) {
      if (n !== seq.current) return;
      setQuote(null);
      setQuoteError(e.message);
    }
    setLoading(false);
  };

  const requestQuote = () => {
    clearTimeout(quoteTimer.current);
    setLoading(true);
    quoteTimer.current = setTimeout(runQuote, 180);
  };

  const runSearch = async (value) => {
    const q = value.trim();
    const n = (searchSeq.current += 1);
    try {
      const list = await api.get(q ? `/api/members?q=${encodeURIComponent(q)}` : '/api/members');
      if (n !== searchSeq.current) return;
      setFound({ list, error: null });
    } catch (e) {
      if (n !== searchSeq.current) return;
      setFound({ list: null, error: e.message });
    }
  };

  const onSearch = (e) => {
    const { value } = e.target;
    setSearch(value);
    clearTimeout(searchTimer.current);
    searchTimer.current = setTimeout(() => runSearch(value), 200);
  };

  const stopSearch = () => {
    clearTimeout(searchTimer.current);
    searchSeq.current += 1;
    setSearch('');
    setFound({ list: null, error: null });
  };

  const pick = (x) => {
    const elig = memberRoomEligibility(x, { card: true });
    if (!elig.ok) {
      toast(`Accès refusé pour ${x.name} : ${elig.reason}.`, 'error');
      return;
    }
    stopSearch();
    setMember(x);
    latest.current.member = x;
    const required = cardRequired(x);
    setPayWithCard(required);
    latest.current.payWithCard = required;
    requestQuote();
  };

  const onPayWithCard = (e) => {
    setPayWithCard(e.target.checked);
    latest.current.payWithCard = e.target.checked;
    requestQuote();
  };

  const changeMember = () => {
    clearTimeout(quoteTimer.current);
    seq.current += 1;
    stopSearch();
    setMember(null);
    setQuote(null);
    setQuoteError(null);
    setLoading(false);
    runSearch('');
  };

  useEffect(() => () => {
    clearTimeout(quoteTimer.current);
    clearTimeout(searchTimer.current);
    seq.current += 1;
    searchSeq.current += 1;
  }, []);

  useEffect(() => {
    if (latest.current.member) requestQuote();
    else runSearch('');
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Raises the duration to the minimum of the chosen day and time when it falls short.
  const fitDuration = (nextDate, nextStart) => {
    const min = minDurationFor(s.booking, nextDate, startRelOf(nextStart));
    if (Number(duration) < min) setDuration(min);
  };

  const onStart = (e) => {
    const next = e.target.value;
    setStart(next);
    fitDuration(date, next);
    requestQuote();
  };

  const selectRoom = (nextRoomId) => {
    setRoomId(Number(nextRoomId));
    latest.current.roomId = Number(nextRoomId);
    // A smaller room lowers the head count to what it holds.
    const cap = activeRooms.find((rm) => rm.id === Number(nextRoomId))?.capacity;
    if (cap && partySize > cap) {
      setPartySize(cap);
      latest.current.partySize = cap;
    }
    requestQuote();
  };

  const onSubmit = (e) => {
    e.preventDefault();
    submit(async () => {
      if (!member) throw new Error('Choisissez un membre titulaire.');
      const body = payload();
      // A deposit the card cannot cover is paid now: the « later » choice is not offered then.
      if (body.pay_with_card && !body.deposit_method && !restLaterAllowed) body.deposit_method = s.payment_methods[0];
      const detail = await api.post('/api/reservations', body, key);
      close();
      // A booking for later offers the confirmation to the member, one click away in the toast (members
      // installed in the room right now have nothing to be told). The dialog closes as it always did; the
      // booking's page keeps a « Renvoyer la confirmation » button.
      const confirmation = detail.reservation.status === 'reservee' ? confirmationToastAction(detail) : null;
      toast(`${detail.reservation.status === 'en_cours' ? 'Membres installés' : 'Réservation confirmée'} : ${detail.reservation.member_name} (${detail.reservation.room_name}, ${detail.reservation.party_size} membre(s)).`, 'ok', confirmation);
      onDone?.(detail);
    });
  };

  let quoteBox = null;
  if (!member) quoteBox = <p className="subtle">Choisissez le membre titulaire pour calculer la séance.</p>;
  else if (loading && !quote) quoteBox = <p className="subtle">Calcul en cours…</p>;
  else if (quoteError) quoteBox = <Notice kind="danger">{quoteError}</Notice>;
  else if (quote) quoteBox = <QuotePanel q={quote} now={startNow && date === bizToday()} card={payWithCard} />;
  const deposit = quote && !quoteError ? quote.deposit_amount : 0;
  const goingIn = startNow && date === bizToday();
  const forcedCard = cardRequired(member);
  const rest = payWithCard && quote && !quoteError ? quote.rest_amount : 0;
  const restLaterAllowed = !(deposit && quote && quote.card_balance < deposit);
  const cardPays = payWithCard && quote && !quoteError ? quote.card_amount : 0;

  const ready = Boolean(member && quote && !quoteError);
  const canSubmit = ready && !(quote.conflicts.length > 0 || quote.gap_conflicts.length > 0 || quote.tariff_blocked);

  const roomsList = quote?.rooms_availability ?? activeRooms.map((rm) => ({ ...rm, available: true, conflict: null, gap_conflict: null }));
  const roomCapacity = roomsList.find((rm) => rm.id === Number(roomId))?.capacity ?? 8;

  const onPartySize = (e) => {
    const next = Number(e.target.value);
    setPartySize(next);
    latest.current.partySize = next;
    requestQuote();
  };

  return (
    <Modal title={startNow ? 'Installer des membres dans une salle' : 'Nouvelle réservation'} size="wide" onClose={close}>
      <form className="form-grid" onSubmit={onSubmit} noValidate>
        <fieldset><legend>Membre titulaire</legend><div id="bk-member">
          {member ? (
            <div className="row">
              <div className="grow" style={{ flex: 1, minWidth: 0 }}>
                <strong>{member.name}</strong> <span className="subtle">{member.member_no}{member.card_code ? ` · carte ${member.card_code}` : ''}</span>
                <div className="subtle">{subStateLabel(member.subscription)}{creditLine(member.subscription)}</div>
              </div>
              {preset.lockMember ? null : <button type="button" className="btn btn-sm" onClick={changeMember}>Changer</button>}
            </div>
          ) : (
            <>
              <div className="search"><Icon name="search" /><input type="search" value={search} onChange={onSearch}
                placeholder="Nom, téléphone, n° de membre ou code carte" aria-label="Rechercher un membre" autoComplete="off" autoFocus /></div>
              <div id="bk-results" className="list" aria-live="polite">
                {found.error ? <Notice kind="danger">{found.error}</Notice> : null}
                {found.list ? (found.list.length
                  ? found.list.slice(0, 8).map((x) => {
                    const elig = memberRoomEligibility(x, { card: true });
                    return (
                      <button
                        key={x.id}
                        type="button"
                        className="list-item"
                        aria-disabled={!elig.ok}
                        style={elig.ok ? undefined : { opacity: 0.55 }}
                        onClick={() => pick(x)}
                      >
                        <div className="grow">
                          <div className="title">{x.name} <span className="subtle">{x.member_no}{x.card_code ? ` · ${x.card_code}` : ''}</span></div>
                          <div className="meta">{subStateLabel(x.subscription)}{creditLine(x.subscription)}</div>
                        </div>
                        {!elig.ok ? <span className="chip chip-danger">{elig.reason}</span>
                          : elig.cardOnly ? <span className="chip chip-info">payé par la carte</span>
                            : <span className="chip chip-ok">{fmtDuration(elig.available)} dispo</span>}
                      </button>
                    );
                  })
                  : <p className="subtle">Aucun membre trouvé.</p>) : null}
              </div>
            </>
          )}
        </div></fieldset>

        <fieldset><legend>Salle</legend>
          <div className="room-picker-grid">
            {roomsList.map((rm) => {
              const selected = Number(roomId) === rm.id;
              const free = rm.available !== false;
              // Refused for the gap alone: no booking overlaps the slot, one of the room sits too close to it.
              const tooClose = !free && !rm.conflict && Boolean(rm.gap_conflict);
              const near = rm.conflict ?? rm.gap_conflict;
              return (
                <button
                  key={rm.id}
                  type="button"
                  className={`room-pick-btn${selected ? ' selected' : ''}${!free ? ' busy' : ''}`}
                  onClick={() => selectRoom(rm.id)}
                >
                  <div className="row" style={{ justifyContent: 'space-between', width: '100%' }}>
                    <strong>{rm.name}</strong>
                    <span className={`chip ${free ? 'chip-ok' : tooClose ? 'chip-warn' : 'chip-danger'}`}>
                      {free ? 'Disponible' : tooClose ? 'Trop proche d’une autre réservation' : 'Occupée'}
                    </span>
                  </div>
                  <div className="subtle" style={{ fontSize: '0.78rem' }}>
                    Jusqu’à {rm.capacity} personnes{!free && near ? ` · ${near.member_name}` : ''}
                  </div>
                </button>
              );
            })}
          </div>

          <label className="field" style={{ marginTop: 12 }}><span>Nombre de personnes (client inclus)</span>
            <select name="party_size" value={partySize} onChange={onPartySize}>
              {Array.from({ length: roomCapacity }, (_, i) => i + 1).map((n) => (
                <option key={n} value={n}>{n === 1 ? '1 — le client seul' : `${n} — le client + ${n - 1} invité${n > 2 ? 's' : ''}`}</option>
              ))}
            </select>
          </label>

          {date === bizToday() ? (
            <label className="check" style={{ marginTop: 10 }}>
              <input type="checkbox" checked={startNow} onChange={(e) => setStartNow(e.target.checked)} />
              <span><strong>Client déjà présent</strong> (installer immédiatement en salle occupée)</span>
            </label>
          ) : null}
        </fieldset>

        <div className="form-row">
          <label className="field"><span>Journée</span>
            <input type="date" name="date" value={date} required onChange={(e) => { setDate(e.target.value); fitDuration(e.target.value, start); requestQuote(); }} /></label>
          <label className="field"><span>Début</span>
            <select name="start_time" value={start} onChange={onStart}>
              {startOptions(w, slot).map((o) => <option key={o.label} value={o.label}>{`${o.label}${o.note}`}</option>)}
            </select></label>
          <label className="field"><span>Durée</span>
            <select name="duration_min" value={duration} onChange={(e) => { setDuration(Number(e.target.value)); requestQuote(); }}>
              {durationOptions(slot, minDur).map((o) => <option key={o.d} value={o.d}>{fmtDuration(o.d)}</option>)}
            </select></label>
        </div>
        <p className="subtle">{`Réservable à toute heure, par créneaux de ${slot} min. Minimum ${fmtDuration(s.booking.min_duration_min)}, ${fmtDuration(s.booking.weekend_min_duration_min ?? s.booking.min_duration_min)} le vendredi et le samedi à partir de 18 h.`}</p>
        <label className="field"><span>Remarque (facultatif)</span>
          <input name="notes" maxLength={300} value={notes} onChange={(e) => setNotes(e.target.value)} /></label>
        {member ? (
          <label className="check">
            <input type="checkbox" name="pay_with_card" checked={payWithCard} disabled={forcedCard} onChange={onPayWithCard} />
            <span><strong>Payer avec la carte</strong>{' '}
              {forcedCard ? '(aucune formule ou plus d’heures : le temps est payé avec le crédit CFA de la carte)' : '(le temps payant est pris maintenant sur le crédit CFA de la carte)'}</span>
          </label>
        ) : null}
        <div id="bk-quote" aria-live="polite">{quoteBox}</div>
        {rest ? (
          <label className="field"><span>{`Reste (${money(rest)}) payé maintenant par`}</span>
            <select name="rest_method" value={restMethod || (restLaterAllowed ? '' : s.payment_methods[0])} onChange={(e) => setRestMethod(e.target.value)}>
              {restLaterAllowed ? <option value="">Plus tard : le reste va sur la note, à encaisser</option> : null}
              {s.payment_methods.map((m) => <option key={m} value={m}>{m}</option>)}
            </select></label>
        ) : null}
        {deposit && !payWithCard ? (
          <label className="field"><span>{goingIn ? 'Encaissé maintenant par' : 'Acompte encaissé maintenant par'}</span>
            <select name="deposit_method" value={depositMethod} onChange={(e) => setDepositMethod(e.target.value)}>
              {s.payment_methods.map((m) => <option key={m} value={m}>{m}</option>)}
            </select></label>
        ) : null}
        <FormError error={error} />
        <div className="modal-actions">
          <button type="button" className="btn" onClick={close}>Annuler</button>
          <button type="submit" className="btn btn-primary" id="bk-submit" disabled={busy || !canSubmit} aria-busy={busy}>
            {cardPays
              ? `Payer ${money(cardPays)} avec la carte et ${goingIn ? 'installer' : 'réserver'}`
              : deposit && !payWithCard
                ? (goingIn ? `Encaisser ${money(quote.supplement_amount)} et installer` : `Encaisser l’acompte (${money(deposit)}) et réserver`)
                : (goingIn ? 'Installer dans la salle' : 'Confirmer la réservation')}
          </button>
        </div>
      </form>
    </Modal>
  );
}

// The card must pay when the member has no plan, or no time left on it, for the day.
const cardRequired = (m) => Boolean(m) && !memberRoomEligibility(m).ok;

export function openBookingDialog(preset = {}, onDone) {
  openDialog(BookingDialog, { preset: preset ?? {}, onDone });
}

// ---------------------------------------------------------------- WhatsApp confirmation

// What the confirmation says, from a booking's detail (the server's answer when it is made, or its page) and the
// club's settings. The day is the one the session starts on, as the member reads it in his calendar: a session
// at 01:00 after a Friday evening is Saturday's.
function confirmationText(detail) {
  const r = detail.reservation;
  const { club_name: clubName, club_whatsapp: clubWhatsapp } = useStore.getState().settings;
  return bookingConfirmationText({
    firstName: detail.member_first_name,
    dayLabel: dayLabel(r.start_date, 'title').toLowerCase(),
    startTime: r.start_time,
    endTime: r.end_time,
    roomName: r.room_name,
    partySize: r.party_size,
    clubName,
    clubWhatsapp,
  });
}

// The demo shows the message and sends nothing. The receipt page reuses it with its own title.
export function DemoMessageDialog({ close, text, title = 'Confirmation WhatsApp' }) {
  return (
    <Modal title={title} onClose={close}>
      <div className="form-grid">
        <Notice kind="info">En démo, aucun message n'est envoyé.</Notice>
        <p className="subtle">Voici le message que WhatsApp afficherait, prêt à envoyer au client :</p>
        <blockquote className="wa-message">{text}</blockquote>
        <div className="modal-actions"><button type="button" className="btn btn-primary" onClick={close}>Fermer</button></div>
      </div>
    </Modal>
  );
}

// The only way a confirmation leaves the application, and only on the manager's click: WhatsApp opens on the
// message, addressed to the member's number, and waits for him to press « Envoyer ». A number that cannot be
// used opens WhatsApp without a recipient, and he picks the contact. The demo never opens the link: it shows
// the message. `demo` is whether the booking belongs to the demo: a button pressed on the page asks the store,
// a toast's button passes the answer it was made with.
export function sendWhatsAppConfirmation(detail, demo = useStore.getState().demo) {
  sendWhatsAppText(detail.member_phone, confirmationText(detail), { demo });
}

// Any message to a member the same way: WhatsApp opens on it, addressed to `phone` (to nobody when the number
// cannot be used); the demo shows it under `title` and opens nothing.
export function sendWhatsAppText(phone, text, { title, demo = useStore.getState().demo } = {}) {
  if (demo) {
    openDialog(DemoMessageDialog, title ? { text, title } : { text });
    return;
  }
  window.open(waLink(waDigits(phone), text), '_blank', 'noopener');
}

// The button of the toast shown after a booking for later. It stays 20 seconds, long enough for the session to
// change under it, so it keeps the space it was made in: made in the demo, it can never open WhatsApp.
export function confirmationToastAction(detail) {
  const demo = useStore.getState().demo;
  return { label: 'Envoyer la confirmation WhatsApp', icon: 'message', onClick: () => sendWhatsAppConfirmation(detail, demo) };
}

// ---------------------------------------------------------------- add/remove member in room

function AddAttendeeDialog({ close, r, onDone }) {
  const state = useLoad(() => api.get('/api/members'), []);
  const [q, setQ] = useState('');
  const { busy, error, submit } = useSubmit();

  const presentIds = new Set((r.attendees ?? [{ member_id: r.member_id }]).map((a) => a.member_id));

  const addMember = (m) => {
    const elig = memberRoomEligibility(m);
    if (!elig.ok) {
      toast(`Accès refusé pour ${m.name} : ${elig.reason}.`, 'error');
      return;
    }
    submit(async () => {
      const res = await api.post(`/api/reservations/${r.id}/attendees`, { member_id: m.id }, newKey());
      close();
      toast(`${m.name} ajouté(e) dans ${r.room_name} (crédit engagé sur sa carte).`);
      onDone?.(res);
    });
  };

  return (
    <Modal title={`Ajouter un membre dans ${r.room_name ?? 'la salle'}`} size="wide" onClose={close}>
      <Loaded state={state}>{(members) => {
        const norm = q.trim().toLowerCase();
        const filtered = members.filter((m) => {
          if (presentIds.has(m.id)) return false;
          if (!norm) return true;
          return (
            m.name.toLowerCase().includes(norm)
            || m.member_no.toLowerCase().includes(norm)
            || (m.card_code && m.card_code.toLowerCase().includes(norm))
            || (m.phone && m.phone.toLowerCase().includes(norm))
          );
        });
        // Show eligible members first
        filtered.sort((a, b) => Number(memberRoomEligibility(b).ok) - Number(memberRoomEligibility(a).ok));

        return (
          <div className="form-grid">
            <Notice kind="info">
              Seuls les membres disposant d’une <strong>carte active</strong> et d’un <strong>crédit d’utilisation restant (&gt; 0 min)</strong> peuvent entrer dans la salle. Chaque membre présent consomme son propre crédit ({fmtDuration(r.duration_min)} max pour cette séance).
            </Notice>
            <div className="search">
              <Icon name="search" />
              <input
                type="search"
                value={q}
                onChange={(e) => setQ(e.target.value)}
                placeholder="Rechercher par nom, n° de membre, code de carte ou scan QR…"
                aria-label="Rechercher un membre à ajouter dans la salle"
                autoFocus
              />
            </div>
            <FormError error={error} />
            <div className="list" style={{ maxHeight: 340, overflowY: 'auto' }}>
              {filtered.length ? filtered.map((m) => {
                const elig = memberRoomEligibility(m);
                const deduction = elig.ok ? Math.min(elig.available, r.duration_min) : 0;
                return (
                  <button
                    key={m.id}
                    type="button"
                    className="list-item"
                    aria-disabled={!elig.ok || busy}
                    style={elig.ok ? undefined : { opacity: 0.55 }}
                    onClick={() => addMember(m)}
                  >
                    <div className="grow">
                      <div className="title">
                        <strong>{m.name}</strong> <span className="subtle">{m.member_no}{m.card_code ? ` · carte ${m.card_code}` : ''}</span>
                      </div>
                      <div className="meta">
                        {subStateLabel(m.subscription)}{creditLine(m.subscription)}
                        {elig.ok ? ` · Décompte séance : −${fmtDuration(deduction)}` : ''}
                      </div>
                    </div>
                    {elig.ok ? (
                      <span className="chip chip-ok">+ Faire entrer ({fmtDuration(elig.available)} dispo)</span>
                    ) : (
                      <span className="chip chip-danger">{elig.reason}</span>
                    )}
                  </button>
                );
              }) : <p className="subtle">Aucun membre correspondant.</p>}
            </div>
            <div className="modal-actions">
              <button type="button" className="btn" onClick={close}>Fermer</button>
            </div>
          </div>
        );
      }}</Loaded>
    </Modal>
  );
}

export function openAddAttendeeDialog(r, onDone) {
  openDialog(AddAttendeeDialog, { r, onDone });
}

export async function quickRemoveAttendee(r, att, onDone) {
  try {
    const res = await api.del(`/api/reservations/${r.id}/attendees/${att.member_id}`, {}, newKey());
    toast(`${att.name} retiré(e) de ${r.room_name} (crédit libéré).`);
    onDone?.(res);
  } catch (e) {
    toast(e.message, 'error');
  }
}

// ---------------------------------------------------------------- extension

function ExtendDialog({ close, r, onDone, options, endRel }) {
  const s = useSettings();
  const [key] = useState(newKey);
  const { busy, error, submit } = useSubmit();
  const [minutes, setMinutes] = useState(options[0]);
  // A booking made without a plan is extended with the card only; one with a plan may use it for the paid time.
  const forcedCard = !r.subscription_id;
  const [payWithCard, setPayWithCard] = useState(forcedCard);
  const [restMethod, setRestMethod] = useState(''); // '' = what the card cannot pay stays on the note
  const [quote, setQuote] = useState(null);
  const [quoteError, setQuoteError] = useState(null);
  const seq = useRef(0);

  const requestQuote = async (value, card = payWithCard) => {
    const n = (seq.current += 1);
    try {
      const q = await api.preview(`/api/reservations/${r.id}/extend/quote`, { minutes: Number(value), pay_with_card: card });
      if (n !== seq.current) return;
      setQuote(q);
      setQuoteError(null);
    } catch (e) {
      if (n !== seq.current) return;
      setQuote(null);
      setQuoteError(e.message);
    }
  };

  useEffect(() => {
    requestQuote(options[0]);
    return () => { seq.current += 1; };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const onSubmit = (e) => {
    e.preventDefault();
    submit(async () => {
      // The extension names the method for the rest `method` (the booking calls it `deposit_method`).
      const body = { minutes: Number(minutes), pay_with_card: payWithCard, method: payWithCard && restMethod ? restMethod : undefined };
      const detail = await api.post(`/api/reservations/${r.id}/extend`, body, key);
      close();
      toast(`Réservation prolongée jusqu’à ${detail.reservation.end_time}.`);
      onDone?.(detail);
    });
  };

  const q = quote;
  let box = <p className="subtle">Calcul en cours…</p>;
  if (quoteError) box = <Notice kind="danger">{quoteError}</Notice>;
  else if (q) {
    const warnings = [];
    if (q.conflicts.length) warnings.push(<Notice key="conflicts" kind="danger">{`Créneau suivant occupé : ${conflictText(q.conflicts)}.`}</Notice>);
    if (q.gap_message) warnings.push(<Notice key="gap" kind="danger">{q.gap_message}</Notice>);
    if (q.tariff_blocked) warnings.push(<Notice key="tariff" kind="danger">Le tarif de cette réservation n’a pas été validé par un administrateur : prolongation payante impossible.</Notice>);
    box = (
      <>
        <dl className="calc">
          <div><dt>Nouvelle fin</dt><dd>{q.new_end_time}{q.end_next_day ? ' (lendemain)' : ''}</dd></div>
          <div><dt>Crédit disponible</dt><dd>{fmtDuration(q.credit_available)}</dd></div>
          <div><dt>Heures incluses utilisées</dt><dd>{fmtDuration(q.included_minutes)}</dd></div>
          <div><dt>Temps payant ajouté</dt><dd>{fmtDuration(q.paid_minutes)}</dd></div>
          <div><dt>Temps payant total</dt><dd>{supplementText(q.total_paid_minutes, q.tariff)}</dd></div>
          <div><dt>Supplément</dt><dd>{`${money(q.supplement_before)} → ${money(q.supplement_after)}`}</dd></div>
          <div className="total"><dt>{payWithCard ? 'À payer' : 'À ajouter à la note'}</dt><dd>{money(q.supplement_delta)}</dd></div>
          {payWithCard ? (
            <>
              <div><dt>Solde de la carte</dt><dd>{money(q.card_balance)}</dd></div>
              <div><dt>Payé par la carte, maintenant</dt><dd>{money(q.card_amount)}</dd></div>
              <div><dt>Reste à payer</dt><dd>{money(q.rest_amount)}</dd></div>
            </>
          ) : null}
        </dl>
        <p className="subtle" style={{ marginTop: 6 }}>{`Le tarif appliqué reste celui de la réservation confirmée (${money(q.tariff.hour)} / h, ${money(q.tariff.half)} / 30 min).`}</p>
        {warnings.length ? <div className="stack" style={{ marginTop: 10 }}>{warnings}</div> : null}
      </>
    );
  }

  const blocked = Boolean(quoteError) || !q || q.conflicts.length > 0 || q.gap_conflicts.length > 0 || q.tariff_blocked;
  const rest = payWithCard && q && !quoteError ? q.rest_amount : 0;

  return (
    <Modal title="Prolonger la réservation" onClose={close}>
      <form className="form-grid" onSubmit={onSubmit} noValidate>
        <p>{`${r.member_name} · actuellement ${r.start_time} → ${r.end_time} (${fmtDuration(r.duration_min)}).`}</p>
        <label className="field"><span>Prolonger de</span>
          <select name="minutes" value={minutes} onChange={(e) => { setMinutes(Number(e.target.value)); requestQuote(e.target.value); }}>
            {options.map((d) => (
              <option key={d} value={d}>{`+ ${fmtDuration(d)} (fin ${endRel + d === 1440 ? 'minuit' : relLabel(endRel + d)}${endRel + d > 1440 ? ', lendemain' : ''})`}</option>
            ))}
          </select></label>
        <label className="check">
          <input type="checkbox" name="pay_with_card" checked={payWithCard} disabled={forcedCard}
            onChange={(e) => { setPayWithCard(e.target.checked); requestQuote(minutes, e.target.checked); }} />
          <span><strong>Payer avec la carte</strong>{forcedCard ? ' (réservation sans formule : le temps est payé avec le crédit CFA)' : ''}</span>
        </label>
        <div id="ex-quote" aria-live="polite">{box}</div>
        {rest ? (
          <label className="field"><span>{`Reste (${money(rest)}) payé maintenant par`}</span>
            <select name="rest_method" value={restMethod} onChange={(e) => setRestMethod(e.target.value)}>
              <option value="">Plus tard : le reste va sur la note, à encaisser</option>
              {s.payment_methods.map((m) => <option key={m} value={m}>{m}</option>)}
            </select></label>
        ) : null}
        <FormError error={error} />
        <div className="modal-actions"><button type="button" className="btn" onClick={close}>Annuler</button>
          <button type="submit" className="btn btn-primary" id="ex-submit" disabled={busy || blocked} aria-busy={busy}>Confirmer la prolongation</button></div>
      </form>
    </Modal>
  );
}

// `extensionWindow` is what the server says the session can still be extended by (the `extension_window` of
// the dashboard and of the booking's detail). The callers that have it pass it in, so the dialog offers
// nothing the server would refuse; without it every length is offered, and the server decides.
export function openExtendDialog(r, onDone, extensionWindow) {
  if (extensionWindow && !extensionWindow.possible) {
    toast(extensionWindow.reason || 'Prolongation impossible.', 'error');
    return;
  }
  const s = useStore.getState().settings;
  const step = s.booking.extension_step_min;
  const end = parts(r.end_ms);
  const endRel = daysBetween(r.biz_day, end.date) * 1440 + end.minutes;
  // No closing time: up to 6 hours more at a time, within the 24 hours a session can last.
  const longest = Math.min(6 * 60, extensionWindow?.max_minutes ?? Infinity);
  const options = [];
  for (let d = step; d <= longest && r.duration_min + d <= 1440; d += step) options.push(d);
  if (!options.length) {
    toast('Prolongation impossible : une séance ne peut pas dépasser 24 heures.', 'error');
    return;
  }
  openDialog(ExtendDialog, { r, onDone, options, endRel });
}

// ---------------------------------------------------------------- cancellation

export function openCancelReservationDialog(detail, onDone) {
  const r = detail.reservation;
  const key = newKey();
  const committed = detail.credit_movements.reduce((sum, mv) => {
    if (mv.kind === 'engagement') return sum + mv.minutes;
    if (mv.kind === 'liberation' || mv.kind === 'consommation') return sum - mv.minutes;
    return sum;
  }, 0);
  const due = detail.charges.filter((c) => c.status === 'due');
  const paid = detail.charges.filter((c) => c.status === 'payee');
  const deposit = paid.filter((c) => c.deposit).reduce((sum, c) => sum + c.amount, 0);
  const otherPaid = paid.filter((c) => !c.deposit);
  // A booking of 3 hours or more can no longer be cancelled on its day: only the absence is recorded.
  const absence = r.late_cancellation;
  actionDialog({
    title: absence ? 'Enregistrer l’absence du membre' : 'Annuler la réservation',
    danger: true,
    confirmLabel: absence ? 'Enregistrer l’absence' : 'Annuler la réservation',
    reasonLabel: absence ? 'Motif de l’absence' : 'Motif de l’annulation',
    body: (
      <>
        {absence ? <Notice kind="warn">Séance de 3 h ou plus : elle ne peut plus être annulée le jour même. Si le membre ne vient pas, enregistrez son absence ; seul l’acompte est perdu.</Notice> : null}
        <ul className="stack" style={{ paddingLeft: 18, margin: 0 }}>
          <li>{committed ? `${fmtDuration(committed)} de crédit seront libérées et redeviendront disponibles.` : 'Aucune heure incluse à libérer.'}</li>
          <li>{due.length ? `${due.length} ligne(s) non encaissée(s) seront annulées (les produits retournent en stock).` : 'Aucune ligne à annuler.'}</li>
          {deposit ? <li><strong>{`L’acompte de ${money(deposit)} reste acquis au club`}</strong> : il n’est pas remboursé.</li> : null}
          {otherPaid.length ? <li><strong>{`${otherPaid.length} ligne(s) déjà encaissée(s)`}</strong> resteront en l’état : un remboursement éventuel est une action distincte réservée à un administrateur.</li> : null}
        </ul>
        {r.cancellable_until && !absence
          ? <p className="subtle">{`Séance de 3 h ou plus : annulable jusqu’au ${dayLabel(r.biz_day, 'medium')} à 0 h (la veille à minuit).`}</p>
          : null}
      </>
    ),
    run: async (v) => {
      const res = await api.post(`/api/reservations/${r.id}/cancel`, { reason: v.reason, no_show: absence }, key);
      toast(absence ? 'Absence enregistrée : seul l’acompte est conservé.' : 'Réservation annulée.');
      onDone?.(res);
    },
  });
}

// ---------------------------------------------------------------- quick 1-click consumption & actions

const PRODUCT_GROUPS = [
  ['cigare', 'Cigares'],
  ['bouteille', 'Bouteilles'],
];

function ConsumptionDialog({ close, reservationId, memberName, roomName, onDone }) {
  const state = useLoad(() => Promise.all([
    api.get(`/api/reservations/${reservationId}`),
    api.get('/api/products'),
  ]), [reservationId]);
  const [addingId, setAddingId] = useState(null);
  const [error, setError] = useState(null);
  const [consumer, setConsumer] = useState(null);

  const addProduct = async (p, forMember) => {
    if (addingId) return;
    setAddingId(p.id);
    setError(null);
    try {
      await api.post(`/api/reservations/${reservationId}/items`, { product_id: p.id, quantity: 1, consumer_member_id: forMember.member_id }, newKey());
      toast(`+1 ${p.name} pour ${forMember.name}.`);
      state.reload();
      onDone?.();
    } catch (e) {
      setError(e.message);
    } finally {
      setAddingId(null);
    }
  };

  return (
    <Modal title={`Facturer bouteilles & cigares — ${roomName ? `${roomName} · ` : ''}${memberName}`} size="wide" onClose={close}>
      <Loaded state={state}>{([detail, products]) => {
        const due = detail.charges.filter((c) => c.status === 'due');
        const dueTotal = due.reduce((sum, c) => sum + c.amount, 0);
        const attendees = detail.reservation.attendees ?? [];
        const forMember = attendees.find((a) => a.member_id === consumer) ?? attendees[0]
          ?? { member_id: detail.reservation.member_id, name: detail.reservation.member_name };
        return (
          <div className="form-grid">
            <p className="subtle">Choisissez le membre, puis touchez une bouteille ou un cigare pour l’ajouter immédiatement (+1). La note reste au nom du titulaire.</p>
            <ConsumerPicker attendees={attendees} value={forMember.member_id} onChange={setConsumer} />
            {PRODUCT_GROUPS.map(([cat, label]) => {
              const items = products.filter((p) => p.category === cat);
              return (
                <div key={cat} className="stack">
                  <h3 style={{ margin: '4px 0 2px', fontSize: '0.95rem' }}>{label}</h3>
                  {items.length ? (
                    <div className="quick-product-grid">
                      {items.map((p) => {
                        const out = p.stock_qty <= 0;
                        const busy = addingId === p.id;
                        return (
                          <button
                            key={p.id}
                            type="button"
                            className="quick-product-btn"
                            disabled={out || Boolean(addingId)}
                            onClick={() => addProduct(p, forMember)}
                          >
                            <div className="quick-product-top">
                              <strong>{p.name}</strong>
                              <span className="chip chip-ok">{busy ? '…' : '+ 1'}</span>
                            </div>
                            <div className="quick-product-meta">
                              <span className="num">{money(p.price)}</span>
                              <span>{out ? 'Rupture' : `${p.stock_qty} en stock`}</span>
                            </div>
                          </button>
                        );
                      })}
                    </div>
                  ) : <p className="subtle">Aucun produit dans cette catégorie.</p>}
                </div>
              );
            })}
            <FormError error={error} />
            <div className="card" style={{ padding: '12px 14px', background: 'var(--surface-2)' }}>
              <div className="row" style={{ justifyContent: 'space-between', marginBottom: 8 }}>
                <strong>Consommations par membre ({detail.reservation.room_name})</strong>
                <span className="num">Reste à payer sur la note : <strong>{money(dueTotal)}</strong></span>
              </div>
              <ConsumptionBreakdown attendees={attendees} lines={consumptionOf(detail.charges)} />
            </div>
            <div className="modal-actions">
              <button type="button" className="btn" onClick={close}>Fermer</button>
              {dueTotal > 0 && (
                <button
                  type="button"
                  className="btn btn-primary"
                  onClick={() => {
                    close();
                    openPaymentDialog({ lines: detail.charges, memberName: detail.reservation.member_name }, onDone);
                  }}
                >
                  <Icon name="wallet" /> Encaisser {money(dueTotal)}
                </button>
              )}
            </div>
          </div>
        );
      }}</Loaded>
    </Modal>
  );
}

export function openConsumptionDialog(r, onDone) {
  openDialog(ConsumptionDialog, { reservationId: r.id, memberName: r.member_name, roomName: r.room_name, onDone });
}

export async function openQuickPayReservation(r, onDone) {
  try {
    const detail = await api.get(`/api/reservations/${r.id}`);
    openPaymentDialog({ lines: detail.charges, memberName: detail.reservation.member_name }, onDone);
  } catch (e) {
    toast(e.message, 'error');
  }
}

export async function quickStartReservation(r, onDone) {
  try {
    await api.post(`/api/reservations/${r.id}/start`, {});
    toast(`Arrivée enregistrée : ${r.member_name} (${r.room_name}).`);
    onDone?.();
  } catch (e) {
    toast(e.message, 'error');
    // A booking secured by a deposit: take the balance first, then the arrival can be recorded.
    if (e.code === 'SOLDE_REQUIS') openQuickPayReservation(r, onDone);
  }
}

export function quickFinishReservation(r, onDone) {
  actionDialog({
    title: `Libérer ${r.room_name ?? 'la salle'} — ${r.member_name}`,
    message: `Confirmer la fin de l’occupation (${r.start_time} – ${r.end_time})${r.due_amount ? ` ? Il reste ${money(r.due_amount)} à encaisser sur la note.` : ' ?'}`,
    confirmLabel: 'Terminer et libérer la salle',
    run: async () => {
      await api.post(`/api/reservations/${r.id}/finish`, {});
      toast('Salle libérée.');
      onDone?.();
    },
  });
}

export async function quickUpdatePartySize(r, nextCount, onDone) {
  const clamped = Math.max(1, Math.min(50, Number(nextCount) || 1));
  try {
    const res = await api.put(`/api/reservations/${r.id}/occupancy`, { party_size: clamped });
    toast(`${clamped} personne(s) présente(s) dans ${res.reservation.room_name}.`);
    onDone?.(res);
  } catch (e) {
    toast(e.message, 'error');
  }
}

export async function quickChangeRoom(r, roomId, onDone) {
  try {
    const res = await api.put(`/api/reservations/${r.id}/occupancy`, { room_id: Number(roomId) });
    toast(`Salle modifiée : ${res.reservation.room_name}.`);
    onDone?.(res);
  } catch (e) {
    toast(e.message, 'error');
  }
}
