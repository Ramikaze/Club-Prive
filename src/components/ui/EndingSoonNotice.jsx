// The alert of a running session about to end. When the server would accept an extension (paid in full by the
// member's card, nothing booked right after), it asks the manager to offer one, with the « Prolonger » button;
// otherwise it gives the reason, or nothing more when the club's closing time is the limit (everyone knows it).
// The window is the server's (`extension_window`, sent with the session by the dashboard): this only shows it.
// While the holder's plan credit carries the session past its planned end (`credit_until_at`), the planned end
// is not an end: a quiet line says the time goes on on the credit, and the question comes in the last 15 minutes
// of that credit, about an extension beyond it. Only the countdown changes every second, in a box that keeps its
// size, so nothing around it moves. No sound.
import Icon from './Icon.jsx';
import { ENDING_SOON_MS, useNow } from './SessionTimer.jsx';
import { openExtendDialog } from '../../dialogs/index.js';
import { fmtDuration, parts } from '../../lib/format.js';

const pad = (n) => String(n).padStart(2, '0');

// mm:ss, always five characters.
const countdown = (ms) => {
  const s = Math.max(0, Math.ceil(ms / 1000));
  return `${pad(Math.floor(s / 60))}:${pad(s % 60)}`;
};

export default function EndingSoonNotice({ reservation: r, onExtended }) {
  const now = useNow(1000);
  if (r?.status !== 'en_cours') return null;
  const w = r.extension_window;
  const plannedEnd = Date.parse(r.end_at);
  const creditEnd = w?.credit_until_at ? Date.parse(w.credit_until_at) : null;
  const left = (creditEnd ?? plannedEnd) - now;
  if (creditEnd && now >= plannedEnd - ENDING_SOON_MS && left > ENDING_SOON_MS) {
    return (
      <div className="notice notice-info" role="note">
        <Icon name="clock" />
        <p>{`Fin prévue à ${r.end_time} : le temps continue sur le crédit temps (${fmtDuration(Math.floor(left / 60000))} restantes).`}</p>
      </div>
    );
  }
  // Shown for the last 15 minutes only; once the end has passed, the timer's overrun display takes over.
  if (!(left > 0 && left <= ENDING_SOON_MS)) return null;
  const endTime = creditEnd ? parts(creditEnd).time : r.end_time;
  // Past the credit, the extension worth asking about is one that goes beyond it. A session sent without the
  // window keeps the question and the button, and the server decides.
  const canExtend = !w || (w.possible && w.max_minutes > (w.credit_minutes ?? 0));
  const reason = !w || canExtend ? null : (w.possible ? w.beyond_credit_reason : w.reason);
  return (
    <div className="notice notice-ending" role="group" aria-label="Fin de séance proche">
      <Icon name="clock" />
      <div className="ending-notice-main">
        <div className="ending-notice-head">
          <p className="ending-notice-title">
            {canExtend ? `Fin à ${endTime} : demandez au client s’il veut prolonger.` : `Fin à ${endTime}.`}
          </p>
          <span className="ending-notice-clock" aria-hidden="true">{`reste ${countdown(left)}`}</span>
        </div>
        {canExtend && (
          <div className="ending-notice-extend">
            <button type="button" className="btn btn-sm" onClick={() => openExtendDialog(r, onExtended, w)}>Prolonger</button>
          </div>
        )}
        {reason && <p>{reason}</p>}
      </div>
    </div>
  );
}
