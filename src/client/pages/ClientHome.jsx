// « Mon compte »: the session in progress with its countdown, the balances, the reservations and the requests, and a
// short look at the history.
import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import Icon from '../../components/ui/Icon.jsx';
import { Loaded } from '../../components/ui/ui.jsx';
import { toast } from '../../components/ui/toast.jsx';
import { useBusy, useLoad } from '../../lib/hooks.js';
import { dayLabel, fmtDuration, money, parts } from '../../lib/format.js';
import { clientApi } from '../clientApi.js';
import { HistoryRows } from './ClientHistory.jsx';

const pad = (n) => String(n).padStart(2, '0');
export const clock = (ms) => {
  const s = Math.floor(Math.max(0, ms) / 1000);
  return `${Math.floor(s / 3600)}:${pad(Math.floor(s / 60) % 60)}:${pad(s % 60)}`;
};

// Counts down to `endAt` once a second, on the server's clock (`offset` = server minus this phone), and stops at 0.
function Countdown({ endAt, offset, onEnd }) {
  const endMs = Date.parse(endAt);
  const left = () => Math.max(0, endMs - (Date.now() + offset));
  const [ms, setMs] = useState(left);
  const ended = useRef(onEnd);
  ended.current = onEnd;
  // The end is told once per session: a refresh that still finds it running must not start a loop of refreshes.
  const told = useRef(null);
  const finish = () => {
    if (told.current === endMs) return;
    told.current = endMs;
    ended.current?.();
  };
  useEffect(() => {
    setMs(left());
    if (left() <= 0) { finish(); return undefined; }
    const timer = setInterval(() => {
      const rest = left();
      setMs(rest);
      if (rest <= 0) { clearInterval(timer); finish(); }
    }, 1000);
    return () => clearInterval(timer);
  }, [endMs, offset]); // eslint-disable-line react-hooks/exhaustive-deps
  return <div className="cl-count" role="timer" aria-label="Temps restant">{clock(ms)}</div>;
}

function Session({ session, offset, reload }) {
  return (
    <section className="cl-card cl-session" aria-label="En séance">
      <span className="chip chip-ok">En séance</span>
      <h2>{session.room_name ?? 'Votre salon'}</h2>
      <Countdown endAt={session.end_at} offset={offset} onEnd={reload} />
      <p className="muted">Fin prévue à {parts(session.end_at).time}</p>
    </section>
  );
}

function Balances({ account }) {
  const { credit, wallet, subscription } = account;
  if (account.member.kind === 'client') {
    if (!credit) return null;
    return (
      <div className="cl-tiles">
        <div className="cl-tile cl-tile-wide"><span>Vous devez</span><strong>{money(credit.owed)}</strong></div>
        <div className="cl-tile"><span>Plafond</span><strong>{money(credit.limit)}</strong></div>
        <div className="cl-tile"><span>Crédit disponible</span><strong>{money(credit.available)}</strong></div>
      </div>
    );
  }
  return (
    <div className="cl-tiles">
      <div className="cl-tile"><span>Crédit carte</span><strong>{money(wallet?.balance ?? 0)}</strong></div>
      <div className="cl-tile">
        <span>Heures abonnement</span>
        <strong>{subscription ? fmtDuration(subscription.available_min) : '—'}</strong>
        {subscription && <small>{subscription.plan_name}</small>}
        {subscription && <small>Jusqu’au {dayLabel(subscription.end_date, 'short')}</small>}
      </div>
    </div>
  );
}

function Reservations({ account, reload }) {
  const [asking, setAsking] = useState(null);
  const { busy, run } = useBusy();
  const cancel = (id) => run(async () => {
    await clientApi.post(`/api/client/reservation-requests/${id}/cancel`, {});
    setAsking(null);
    toast('Demande annulée.');
    reload();
  });
  const { reservations, requests } = account;
  return (
    <section className="cl-card" aria-label="Mes réservations">
      <div className="cl-head"><h2>Mes réservations</h2></div>
      {reservations.length + requests.length === 0 && <p className="muted">Aucune réservation à venir.</p>}
      <ul className="cl-rows">
        {reservations.map((r) => (
          <li key={`r${r.id}`}>
            <div className="cl-row-main">
              <strong>{dayLabel(r.date, 'medium')} · {r.start_time}–{r.end_time}</strong>
              <span className="muted">{fmtDuration(r.duration_min)} · {r.party_size} pers.</span>
            </div>
            <span className="chip chip-ok">Confirmée</span>
          </li>
        ))}
        {requests.map((q) => (
          <li key={`q${q.id}`}>
            <div className="cl-row-main">
              <strong>{dayLabel(q.date, 'medium')} · {q.start_time}</strong>
              <span className="muted">{fmtDuration(q.duration_min)} · {q.party_size} pers.</span>
              {q.status === 'refusee' && <span className="cl-reason">{q.message ? `Refusée : ${q.message}` : 'Demande refusée.'}</span>}
              {/* The deposit still to pay: 0 when the card covers it, the club then takes it from the card at the confirmation. */}
              {q.status === 'en_attente' && q.deposit_amount > 0 && (
                <span className="cl-reason">Un acompte de {money(q.deposit_amount)} est à payer au club ou en rechargeant votre carte.</span>
              )}
              {q.status === 'en_attente' && (asking === q.id ? (
                <span className="cl-inline">
                  <button type="button" className="btn btn-sm btn-danger" disabled={busy} onClick={() => cancel(q.id)}>Confirmer l’annulation</button>
                  <button type="button" className="btn btn-sm" onClick={() => setAsking(null)}>Garder</button>
                </span>
              ) : <button type="button" className="cl-link" onClick={() => setAsking(q.id)}>Annuler la demande</button>)}
            </div>
            <span className={`chip ${q.status === 'refusee' ? 'chip-danger' : 'chip-warn'}`}>{q.status === 'refusee' ? 'Refusée' : 'En attente'}</span>
          </li>
        ))}
      </ul>
    </section>
  );
}

function HistoryPreview() {
  const state = useLoad(() => clientApi.get('/api/client/history'), []);
  return (
    <section className="cl-card" aria-label="Historique">
      <div className="cl-head"><h2>Historique</h2><Link to="/historique">Tout voir</Link></div>
      <Loaded state={state}>
        {(h) => (h.items.length ? <HistoryRows items={h.items.slice(0, 4)} /> : <p className="muted">Rien ce mois-ci.</p>)}
      </Loaded>
    </section>
  );
}

export default function ClientHome({ member }) {
  const state = useLoad(() => clientApi.get('/api/client/account'), [], { refreshMs: 60000 });
  // The phone's clock may be off: the countdown goes by the server's, as it was when the page loaded.
  const offset = useRef(0);
  if (state.data) offset.current = Date.parse(state.data.server_now) - Date.now();
  return (
    <div className="cl-stack">
      <Loaded state={state}>
        {(account) => (
          <>
            {account.in_session && <Session session={account.in_session} offset={offset.current} reload={state.reload} />}
            <Balances account={account} />
            <Reservations account={account} reload={state.reload} />
            {member.kind === 'membre' && (
              <Link className="btn btn-primary btn-block" to="/reserver"><Icon name="calendar" /> Demander une réservation</Link>
            )}
          </>
        )}
      </Loaded>
      <HistoryPreview />
    </div>
  );
}
