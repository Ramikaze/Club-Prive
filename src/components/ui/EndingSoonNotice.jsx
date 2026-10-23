// The alert of a running session about to end: it asks the manager to offer an extension, and says whether
// the server would accept one and until when. The window is the server's (`extension_window`, sent with the
// session by the dashboard): this only shows it. Only the countdown changes every second, in a box that
// keeps its size, so nothing around it moves. No sound.
import Icon from './Icon.jsx';
import { ENDING_SOON_MS, useNow } from './SessionTimer.jsx';
import { openExtendDialog } from '../../dialogs/index.js';

const pad = (n) => String(n).padStart(2, '0');

// mm:ss, always five characters.
const countdown = (ms) => {
  const s = Math.max(0, Math.ceil(ms / 1000));
  return `${pad(Math.floor(s / 60))}:${pad(s % 60)}`;
};

export default function EndingSoonNotice({ reservation: r, onExtended }) {
  const now = useNow(1000);
  if (r?.status !== 'en_cours') return null;
  const left = Date.parse(r.end_at) - now;
  // Shown for the last 15 minutes only; once the end has passed, the timer's overrun display takes over.
  if (!(left > 0 && left <= ENDING_SOON_MS)) return null;
  const w = r.extension_window;
  let answer = null;
  if (w?.possible) {
    answer = (
      <div className="ending-notice-extend">
        <p>{`Prolongation possible jusqu’à ${w.until_time}${w.until_next_day ? ' (lendemain)' : ''}`}</p>
        <button type="button" className="btn btn-sm" onClick={() => openExtendDialog(r, onExtended, w)}>Prolonger</button>
      </div>
    );
  } else if (w) {
    answer = <p>{w.reason || 'Prolongation impossible.'}</p>;
  }
  return (
    <div className="notice notice-ending" role="group" aria-label="Fin de séance proche">
      <Icon name="clock" />
      <div className="ending-notice-main">
        <div className="ending-notice-head">
          <p className="ending-notice-title">{`Fin à ${r.end_time} : demandez au client s’il veut prolonger.`}</p>
          <span className="ending-notice-clock" aria-hidden="true">{`reste ${countdown(left)}`}</span>
        </div>
        {answer}
      </div>
    </div>
  );
}
