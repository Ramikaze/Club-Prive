// Pure business rules shared by the server (authoritative) and the browser (previews).
import { localParts, addDays, daysBetween, parseHHMM } from './time.js';

export const ACCOUNTS = ['reservations', 'alcool', 'cigares'];
export const ACCOUNT_LABELS = { reservations: 'Réservations', alcool: 'Alcool', cigares: 'Cigares' };

// Opening hours expressed in minutes from midnight of the business day.
// A time at or before opening belongs to the next calendar day (e.g. close 24:00, max_end 05:00).
export function bookingWindow(hours) {
  const open = parseHHMM(hours.open);
  const close = parseHHMM(hours.close);
  const maxEnd = parseHHMM(hours.max_end);
  const c = close <= open ? close + 1440 : close;
  const x = maxEnd <= open ? maxEnd + 1440 : maxEnd;
  return { open, close: c, maxEnd: Math.max(x, c) };
}

export function validateHours(hours) {
  const open = parseHHMM(hours.open);
  const close = parseHHMM(hours.close);
  const maxEnd = parseHHMM(hours.max_end);
  if (open == null || open >= 1440) return "Heure d'ouverture invalide (format HH:MM).";
  if (close == null) return 'Heure de fermeture invalide (format HH:MM, 24:00 accepté).';
  if (maxEnd == null) return 'Heure maximale de fin invalide (format HH:MM).';
  const w = bookingWindow(hours);
  if (w.close <= w.open) return "La fermeture doit suivre l'ouverture.";
  if ((maxEnd <= open ? maxEnd + 1440 : maxEnd) < w.close) return 'La fin maximale de prolongation doit être après la fermeture habituelle.';
  if (w.maxEnd >= w.open + 1440) return 'La plage totale doit rester inférieure à 24 heures.';
  return null;
}

// Places an occupation [startMs, endMs) relative to its business day.
export function placeInWindow(startMs, endMs, tz, win) {
  const s = localParts(startMs, tz);
  const e = localParts(endMs, tz);
  const bizDay = s.minutes < win.open ? addDays(s.date, -1) : s.date;
  const startRel = daysBetween(bizDay, s.date) * 1440 + s.minutes;
  const endRel = daysBetween(bizDay, e.date) * 1440 + e.minutes;
  return {
    bizDay, startRel, endRel,
    inWindow: startRel >= win.open && endRel <= win.maxEnd && endRel > startRel,
    offHours: startRel >= win.close || endRel > win.close,
  };
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
