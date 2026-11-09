// « Demander une réservation » (members only): the day, the duration and the number of people give the free slots; the
// client picks one, sees what it would cost, and sends the request. The club answers it: nothing is booked or paid here.
import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import Icon from '../../components/ui/Icon.jsx';
import { FormError } from '../../components/ui/ui.jsx';
import { toast } from '../../components/ui/toast.jsx';
import { useSubmit } from '../../lib/hooks.js';
import { dayLabel, fmtDuration, money, parts } from '../../lib/format.js';
import { addDays } from '../../../shared/time.js';
import { clientApi, qs } from '../clientApi.js';

const DAYS = 30;
const MAX_DURATION = 480;

// Free slots for the chosen day, duration and party; the answer is dropped if the choice changed meanwhile.
function useSlots(date, duration, party) {
  const [state, setState] = useState({ slots: null, error: null });
  useEffect(() => {
    let live = true;
    setState({ slots: null, error: null });
    clientApi.get(`/api/client/slots${qs({ date, duration_min: duration, party_size: party })}`).then(
      (r) => { if (live) setState({ slots: r.slots, error: null }); },
      (e) => { if (live && e.status !== 401) setState({ slots: [], error: e.message }); },
    );
    return () => { live = false; };
  }, [date, duration, party]);
  return state;
}

function useQuote(body) {
  const [quote, setQuote] = useState(null);
  const key = body ? JSON.stringify(body) : null;
  useEffect(() => {
    setQuote(null);
    if (!key) return undefined;
    let live = true;
    clientApi.preview('/api/client/reservation-requests/quote', JSON.parse(key)).then(
      (q) => { if (live) setQuote(q); },
      () => { /* the estimate is a help: the request itself says what is wrong */ },
    );
    return () => { live = false; };
  }, [key]);
  return quote;
}

function Estimate({ quote }) {
  if (!quote) return <p className="muted">Calcul de l’estimation…</p>;
  const nothing = !quote.included_minutes && !(quote.supplement_amount > 0);
  return (
    <div className="cl-estimate" aria-label="Estimation">
      <strong>Estimation</strong>
      {quote.included_minutes > 0 && <p>Compris dans votre abonnement : {fmtDuration(quote.included_minutes)}.</p>}
      {quote.supplement_amount > 0 && <p>À payer en plus : {money(quote.supplement_amount)}{quote.card_amount > 0 ? `, dont ${money(quote.card_amount)} sur votre carte` : ''}.</p>}
      {quote.deposit_amount > 0 && <p>Acompte de {money(quote.deposit_amount)} (séance de 3 h ou plus), à payer au club ou en rechargeant votre carte.</p>}
      {nothing && <p>Rien à payer en plus.</p>}
      <p className="subtle">Le club confirme ou refuse votre demande : rien n’est réservé tant qu’il n’a pas répondu.</p>
    </div>
  );
}

export default function ClientBooking({ club }) {
  const navigate = useNavigate();
  const { slot_min: step, min_duration_min: min, weekend_min_duration_min: weekendMin } = club.booking;
  const today = parts(Date.now()).date;
  const days = useMemo(() => Array.from({ length: DAYS + 1 }, (_, i) => addDays(today, i)), [today]);
  const durations = useMemo(() => {
    const list = [];
    for (let d = min; d <= MAX_DURATION; d += step) list.push(d);
    return list;
  }, [min, step]);
  const [date, setDate] = useState(days[0]);
  const [duration, setDuration] = useState(min);
  const [party, setParty] = useState(1);
  const [slot, setSlot] = useState(null);
  const { slots, error: slotsError } = useSlots(date, duration, party);
  const chosen = slot && slots?.includes(slot) ? slot : null;
  const body = chosen ? { date, start_time: chosen, duration_min: duration, party_size: party } : null;
  const quote = useQuote(body);
  const { busy, error, submit } = useSubmit();
  useEffect(() => setSlot(null), [date, duration, party]);

  const send = () => submit(async () => {
    await clientApi.post('/api/client/reservation-requests', body);
    toast('Demande envoyée : le club vous répondra bientôt.');
    navigate('/');
  });

  return (
    <div className="cl-stack">
      <Link className="back" to="/"><Icon name="left" /> Compte</Link>
      <h1>Demander une réservation</h1>
      <section className="cl-card cl-form">
        <label className="field"><span>Jour</span>
          <select value={date} onChange={(e) => setDate(e.target.value)}>
            {days.map((d) => <option key={d} value={d}>{dayLabel(d, 'title')}{d === today ? ' (aujourd’hui)' : ''}</option>)}
          </select></label>
        <label className="field"><span>Durée</span>
          <select value={duration} onChange={(e) => setDuration(Number(e.target.value))}>
            {durations.map((d) => <option key={d} value={d}>{fmtDuration(d)}</option>)}
          </select>
          {weekendMin > min && <span className="help">Le vendredi et le samedi soir, la durée minimale est de {fmtDuration(weekendMin)}.</span>}
        </label>
        <label className="field"><span>Nombre de personnes</span>
          <select value={party} onChange={(e) => setParty(Number(e.target.value))}>
            {Array.from({ length: club.room_capacity ?? 8 }, (_, i) => i + 1).map((n) => <option key={n} value={n}>{n}</option>)}
          </select></label>
      </section>
      <section className="cl-card" aria-label="Créneaux libres">
        <div className="cl-head"><h2>Créneaux libres</h2></div>
        {slots === null && <p className="muted">Recherche des créneaux…</p>}
        {slotsError && <p className="form-error" role="alert">{slotsError}</p>}
        {slots?.length === 0 && !slotsError && <p className="muted">Aucun créneau libre ce jour-là pour cette durée : essayez un autre jour.</p>}
        {slots?.length > 0 && (
          <div className="cl-slots" role="group" aria-label="Heure de début">
            {slots.map((s) => <button key={s} type="button" className="btn btn-sm" aria-pressed={chosen === s} onClick={() => setSlot(s)}>{s}</button>)}
          </div>
        )}
      </section>
      {chosen && (
        <section className="cl-card">
          <p><strong>{dayLabel(date, 'title')}</strong> · {chosen} · {fmtDuration(duration)} · {party} pers.</p>
          <Estimate quote={quote} />
          <FormError error={error} />
          <button type="button" className="btn btn-primary btn-block" disabled={busy} aria-busy={busy} onClick={send}>Envoyer la demande</button>
        </section>
      )}
    </div>
  );
}
