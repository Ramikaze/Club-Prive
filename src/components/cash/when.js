// When the operations of the cash page happened, on the club's clock: the business day of an instant, and the
// time a row shows. The rows are listed newest first.
import { addDays, fmtHHMM, localToUtcMs } from '../../../shared/time.js';
import { dayMonth, parts, tz, win } from '../../lib/format.js';

// The business day of an instant: before the opening hour it still belongs to the day before.
export function bizDayOf(iso) {
  const p = parts(iso);
  return p.minutes < win().open ? addDays(p.date, -1) : p.date;
}

// An instant as a row shows it: the time alone when the page shows one day, else day and time.
export const whenText = (iso, oneDay) => (oneDay ? parts(iso).time : `${dayMonth(iso)} ${parts(iso).time}`);

// An entry typed on its own day keeps its time; a backdated one sits at the start of its day and shows its day
// only (as in the general ledger).
export function entryWhen(e, oneDay) {
  if (bizDayOf(e.created_at) === e.biz_date) return { ms: Date.parse(e.created_at), text: whenText(e.created_at, oneDay) };
  return { ms: localToUtcMs(e.biz_date, fmtHHMM(win().open), tz()), text: `${e.biz_date.slice(8, 10)}/${e.biz_date.slice(5, 7)}` };
}
