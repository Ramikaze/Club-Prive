// Date and time helpers with no dependency, shared by the server and the browser.
// Instants are UTC milliseconds; calendar dates are 'YYYY-MM-DD' strings in the club time zone.

const formatters = new Map();
const pad = (n) => String(n).padStart(2, '0');

function formatter(tz) {
  let f = formatters.get(tz);
  if (!f) {
    f = new Intl.DateTimeFormat('en-US', {
      timeZone: tz, hourCycle: 'h23',
      year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', second: '2-digit',
    });
    formatters.set(tz, f);
  }
  return f;
}

export function localParts(ms, tz) {
  const p = {};
  for (const { type, value } of formatter(tz).formatToParts(new Date(ms))) p[type] = value;
  const hour = Number(p.hour) % 24;
  const minute = Number(p.minute);
  return {
    date: `${p.year}-${p.month}-${p.day}`,
    hour, minute, second: Number(p.second),
    minutes: hour * 60 + minute,
    time: `${pad(hour)}:${pad(minute)}`,
  };
}

export function tzOffsetMs(ms, tz) {
  const p = localParts(ms, tz);
  const [y, m, d] = p.date.split('-').map(Number);
  return Date.UTC(y, m - 1, d, p.hour, p.minute, p.second) - (ms - (ms % 1000));
}

// Wall-clock time in `tz` -> UTC instant. Handles DST transitions by re-checking the offset.
export function localToUtcMs(date, time, tz) {
  const [y, m, d] = date.split('-').map(Number);
  const [hh, mm] = time.split(':').map(Number);
  const guess = Date.UTC(y, m - 1, d, hh, mm);
  const off = tzOffsetMs(guess, tz);
  let result = guess - off;
  const off2 = tzOffsetMs(result, tz);
  if (off2 !== off) result = guess - off2;
  return result;
}

export function isValidDate(s) {
  if (typeof s !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const [y, m, d] = s.split('-').map(Number);
  const t = new Date(Date.UTC(y, m - 1, d));
  return t.getUTCFullYear() === y && t.getUTCMonth() === m - 1 && t.getUTCDate() === d;
}

export function isValidTimeZone(tz) {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

const dateToUtc = (s) => {
  const [y, m, d] = s.split('-').map(Number);
  return Date.UTC(y, m - 1, d);
};
const utcToDate = (ms) => new Date(ms).toISOString().slice(0, 10);

export const addDays = (s, n) => utcToDate(dateToUtc(s) + n * 86400000);
export const daysBetween = (a, b) => Math.round((dateToUtc(b) - dateToUtc(a)) / 86400000);

export function addMonths(s, n) {
  const [y, m, d] = s.split('-').map(Number);
  const last = new Date(Date.UTC(y, m - 1 + n + 1, 0)).getUTCDate();
  return utcToDate(Date.UTC(y, m - 1 + n, Math.min(d, last)));
}

// Number of whole months between two dates (b after a).
export function monthsElapsed(a, b) {
  const [y1, m1, d1] = a.split('-').map(Number);
  const [y2, m2, d2] = b.split('-').map(Number);
  let n = (y2 - y1) * 12 + (m2 - m1);
  if (d2 < d1) n -= 1;
  return n;
}

export const weekday = (s) => new Date(dateToUtc(s)).getUTCDay(); // 0 = Sunday

export function startOfWeek(s) {
  const wd = weekday(s);
  return addDays(s, wd === 0 ? -6 : 1 - wd);
}

// 'HH:MM' -> minutes since midnight; '24:00' is allowed (1440). Returns null when invalid.
export function parseHHMM(s) {
  const m = /^(\d{1,2}):(\d{2})$/.exec(String(s ?? ''));
  if (!m) return null;
  const h = Number(m[1]);
  const mi = Number(m[2]);
  if (h > 24 || mi > 59 || (h === 24 && mi !== 0)) return null;
  return h * 60 + mi;
}

export const fmtHHMM = (min) => `${pad(Math.floor(min / 60) % 24)}:${pad(min % 60)}`;
