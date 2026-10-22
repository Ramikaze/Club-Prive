// Live counter of a session in a room. It starts when the member's arrival is recorded (status
// "en cours", started_at) and shows the time spent, what remains of the booking, then the overrun.
import { useEffect, useState } from 'react';
import { fmtDuration, parts } from '../../lib/format.js';

const ENDING_SOON_MS = 10 * 60000;

function useNow(intervalMs) {
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

export default function SessionTimer({ reservation: r, compact = false }) {
  const now = useNow(1000);
  if (!isRunning(r)) return null;
  const started = Date.parse(r.started_at);
  const end = Date.parse(r.end_at);
  const elapsed = now - started;
  const remaining = end - now;
  const over = remaining < 0;
  const ending = !over && remaining <= ENDING_SOON_MS;
  const progress = Math.min(1, Math.max(0, elapsed / Math.max(1, end - started)));
  const state = over ? 'is-over' : ending ? 'is-ending' : '';
  return (
    <div className={`session-timer ${state} ${compact ? 'is-compact' : ''}`} role="timer"
      aria-label={`En salle depuis ${fmtDuration(Math.floor(elapsed / 60000))}`}>
      <div className="session-timer-main">
        <span className="session-timer-label">En salle depuis {parts(started).time}</span>
        <span className="session-timer-clock">{clock(elapsed)}</span>
      </div>
      <div className="session-timer-track" aria-hidden="true"><span style={{ transform: `scaleX(${progress})` }} /></div>
      <div className="session-timer-foot">
        {over
          ? `Dépassement de ${fmtDuration(minutes(remaining))} : fin prévue à ${r.end_time}`
          : `Fin prévue à ${r.end_time} · reste ${fmtDuration(minutes(remaining))}`}
      </div>
    </div>
  );
}

// One line for lists: "en salle depuis 1 h 05", refreshed every 15 seconds.
export function TimeInRoom({ reservation: r }) {
  const now = useNow(15000);
  if (!isRunning(r)) return null;
  const elapsed = Math.max(0, Math.floor((now - Date.parse(r.started_at)) / 60000));
  const over = now > Date.parse(r.end_at);
  return (
    <span className={over ? 'session-inline is-over' : 'session-inline'}>
      en salle depuis {fmtDuration(elapsed)}{over ? ' · dépassement' : ''}
    </span>
  );
}
