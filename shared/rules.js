// Pure business rules shared by the server (authoritative) and the browser (previews).
import { localParts, addDays, daysBetween, parseHHMM } from './time.js';

export const ACCOUNTS = ['reservations', 'alcool', 'cigares'];
export const ACCOUNT_LABELS = { reservations: 'Réservations', alcool: 'Alcool', cigares: 'Cigares' };

// The member card's CFA credit as a means of payment. It is never one of the configured payment methods: the
// money came into the till when the card was recharged, so a payment by card is no cash inflow.
export const CARD_METHOD = 'Carte membre';

// A subscription renews itself from the card's CFA credit. The member is warned this many days before its end
// when the credit will not cover the price, and a recharge still renews it up to this many days after the end.
export const RENEWAL_WARNING_DAYS = 3;
export const RENEWAL_GRACE_DAYS = 30;

// The club has no opening hours: it opens whenever the room is booked, day or night. A business
// day still starts at `hours.open` (06:00 by default) for the agenda and the books, so a session
// started before that time counts in the previous day, like a late evening. The window is that
// whole day, in minutes from midnight of the business day (e.g. 06:00 to 06:00 the next day).
export function bookingWindow(hours) {
  const open = parseHHMM(hours.open) ?? 360;
  return { open, close: open + 1440, maxEnd: open + 1440 };
}

// The club's closing time: no session runs, nor is extended, past it. Before the start of the business day it
// is the following night (02:30); after it, the same evening.
export const DEFAULT_CLOSE = '02:30';

export function validateHours(hours) {
  const open = parseHHMM(hours.open);
  if (open == null || open >= 1440) return 'Heure de début de journée invalide (format HH:MM).';
  if (hours.close != null) {
    const close = parseHHMM(hours.close);
    if (close == null || close >= 1440) return 'Heure de fermeture invalide (format HH:MM).';
    if (close === open) return 'La fermeture ne peut pas être à l’heure du début de la journée.';
  }
  return null;
}

// Friday and Saturday evenings, from 18:00 until the end of the night, a booking lasts longer: it
// has its own minimum duration, 2 h by default. `bizDay` is the business day the booking starts on
// and `startRel` its start in minutes from that day's midnight (01:00 the following night is 1500),
// so a Friday night session that starts after midnight still counts as Friday evening.
export const WEEKEND_FROM = 18 * 60;
export function isWeekend(bizDay, startRel) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(bizDay ?? ''))) return false;
  const [y, m, d] = bizDay.split('-').map(Number);
  const weekday = new Date(Date.UTC(y, m - 1, d)).getUTCDay(); // 5 Friday, 6 Saturday
  return (weekday === 5 || weekday === 6) && startRel >= WEEKEND_FROM;
}

export function minDurationFor(booking, bizDay, startRel) {
  const base = booking.min_duration_min;
  return isWeekend(bizDay, startRel) ? Math.max(base, booking.weekend_min_duration_min ?? base) : base;
}

// A booking of 3 hours or more is secured by a deposit: half of its paid time (the hours beyond the
// member's credit), taken when it is booked; the balance is paid before entering the room. It can
// be cancelled until midnight before its business day; the deposit stays with the club, and so it
// does if the member does not come. Nothing paid, no deposit.
export const DEPOSIT_FROM = 180; // minutes
export function depositFor(durationMin, supplement) {
  if (durationMin < DEPOSIT_FROM || !(supplement > 0)) return 0;
  return Math.round(supplement / 2);
}

// Amount in hundredths -> « 12 500 FCFA ».
export function formatMoney(minor, currency = { label: 'FCFA', decimals: 0 }) {
  const d = currency.decimals ?? 0;
  const n = new Intl.NumberFormat('fr-FR', { minimumFractionDigits: d, maximumFractionDigits: d }).format(minor / 100);
  return `${n} ${currency.label}`;
}

// The till's cash: the courier of an outside meal is always paid with it.
export const CASH_METHOD = 'Espèces';

// Member names as the club writes them: « Jean-Pierre » (each part of the first name capitalised) and
// « N'DIAYE » (the last name in capitals, accents kept). Spaces are trimmed and collapsed.
const tidy = (s) => String(s ?? '').trim().replace(/\s+/g, ' ');
export function formatFirstName(s) {
  return tidy(s).toLocaleLowerCase('fr').replace(/(^|[\s'’-])(\p{L})/gu, (_, sep, ch) => sep + ch.toLocaleUpperCase('fr'));
}
export function formatLastName(s) {
  return tidy(s).toLocaleUpperCase('fr');
}

// Places an occupation [startMs, endMs) on its business day, given by its start.
export function placeInWindow(startMs, endMs, tz, win) {
  const s = localParts(startMs, tz);
  const e = localParts(endMs, tz);
  const bizDay = s.minutes < win.open ? addDays(s.date, -1) : s.date;
  const startRel = daysBetween(bizDay, s.date) * 1440 + s.minutes;
  const endRel = daysBetween(bizDay, e.date) * 1440 + e.minutes;
  return { bizDay, startRel, endRel };
}

// Paid minutes -> amount. Each full hour at the hourly price, a remainder up to 30 min at the
// half-hour price, a longer remainder at the hourly price. Amounts are integers (minor units).
export function supplementAmount(paidMin, tariff) {
  if (!paidMin || paidMin <= 0) return 0;
  const hours = Math.floor(paidMin / 60);
  const rest = paidMin % 60;
  return hours * tariff.hour + (rest === 0 ? 0 : rest <= 30 ? tariff.half : tariff.hour);
}

export function supplementDetail(paidMin) {
  const rest = paidMin % 60;
  return {
    hours: Math.floor(paidMin / 60) + (rest > 30 ? 1 : 0),
    halves: rest > 0 && rest <= 30 ? 1 : 0,
  };
}

export function fmtDuration(min) {
  const h = Math.floor(min / 60);
  const m = min % 60;
  if (!h) return `${m} min`;
  return m ? `${h} h ${String(m).padStart(2, '0')}` : `${h} h`;
}

// A session has one member, its holder; everyone else in the party is a guest (not a member), whose time and
// consumptions the holder pays. `partySize` counts the holder.
export function partyLabel(partySize) {
  const guests = Math.max(1, Number(partySize) || 1) - 1;
  if (!guests) return 'Titulaire seul';
  return `Titulaire + ${guests} invité${guests > 1 ? 's' : ''}`;
}
