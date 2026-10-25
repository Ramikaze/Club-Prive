// Live counter of a session in a room. It starts when the member's arrival is recorded (status
// "en cours", started_at) and counts down the time credit the card carried in (card_credit_min), then
// the paid time once the credit runs out. The booking's planned end stays shown underneath.
import { useEffect, useState } from 'react';
import { fmtDuration, parts } from '../../lib/format.js';

// The last 15 minutes of a session: the timer turns amber and EndingSoonNotice asks about an extension.
export const ENDING_SOON_MS = 15 * 60000;

export function useNow(intervalMs) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(id);
  }, [intervalMs]);
  return now;
}

const clock = (ms) => {
  const s = Math.max(0, Math.floor(ms / 1000));
  const pad = (n) => String(n).padStart(2, '0');
  return `${Math.floor(s / 3600)}:${pad(Math.floor((s % 3600) / 60))}:${pad(s % 60)}`;
};

const minutes = (ms) => Math.max(1, Math.ceil(Math.abs(ms) / 60000));

export const isRunning = (r) => r?.status === 'en_cours' && Boolean(r.started_at);

// Time credit left on the card, in ms (negative once it is used up). Without the figure (a member with no
// subscription carries no time on the card), the booking's own length stands in.
const creditLeft = (r, now) => {
  const started = Date.parse(r.started_at);
  const creditMs = r.card_credit_min != null ? r.card_credit_min * 60000 : Date.parse(r.end_at) - started;
  return { creditMs, left: started + creditMs - now };
};

export default function SessionTimer({ reservation: r, compact = false }) {
  const now = useNow(1000);
  if (!isRunning(r)) return null;
  const started = Date.parse(r.started_at);
  const remaining = Date.parse(r.end_at) - now;
  const { creditMs, left } = creditLeft(r, now);
  const spent = left < 0;
  const over = spent || remaining < 0;
  const ending = !over && (left <= ENDING_SOON_MS || remaining <= ENDING_SOON_MS);
  const progress = creditMs > 0 ? Math.min(1, Math.max(0, left / creditMs)) : 0;
  const state = over ? 'is-over' : ending ? 'is-ending' : '';
  const booked = r.card_credit_min == null;
  const label = booked
    ? (spent ? 'Temps réservé dépassé' : 'Temps réservé restant')
    : (spent ? 'Crédit épuisé · temps payant' : 'Crédit temps restant sur la carte');
  return (
    <div className={`session-timer ${state} ${compact ? 'is-compact' : ''}`} role="timer"
      aria-label={spent
        ? `${booked ? 'Temps réservé dépassé' : 'Crédit temps épuisé'} depuis ${fmtDuration(minutes(left))}`
        : `${label} : ${fmtDuration(Math.floor(left / 60000))}`}>
      <div className="session-timer-main">
        <span className="session-timer-label">{label}</span>
        <span className="session-timer-clock">{spent ? `+${clock(-left)}` : clock(left)}</span>
      </div>
      <div className="session-timer-track" aria-hidden="true"><span style={{ transform: `scaleX(${progress})` }} /></div>
      <div className="session-timer-foot">
        {remaining < 0
          ? `Dépassement de ${fmtDuration(minutes(remaining))} : fin prévue à ${r.end_time}`
          : `Arrivé à ${parts(started).time} · fin prévue à ${r.end_time}`}
      </div>
    </div>
  );
}

// One line for lists: "crédit restant 1 h 05", refreshed every 15 seconds.
export function TimeInRoom({ reservation: r }) {
  const now = useNow(15000);
  if (!isRunning(r)) return null;
  const { left } = creditLeft(r, now);
  const over = left < 0 || now > Date.parse(r.end_at);
  return (
    <span className={over ? 'session-inline is-over' : 'session-inline'}>
      {r.card_credit_min == null
        ? (left < 0 ? `dépassé depuis ${fmtDuration(minutes(left))}` : `temps restant ${fmtDuration(Math.floor(left / 60000))}`)
        : (left < 0 ? `crédit épuisé depuis ${fmtDuration(minutes(left))}` : `crédit restant ${fmtDuration(Math.floor(left / 60000))}`)}
    </span>
  );
}
