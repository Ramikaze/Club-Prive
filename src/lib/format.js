// Formatting and labels. Amounts are integers in hundredths; dates are 'YYYY-MM-DD' in the club
// time zone; every rule shared with the server comes from /shared.
import { localParts, addDays } from '../../shared/time.js';
import { bookingWindow, fmtDuration, CARD_METHOD } from '../../shared/rules.js';
import { RECHARGE_LINE_LABEL } from '../../shared/ticket.js';
import { useStore } from '../store/useStore.js';

export { fmtDuration };

const settings = () => useStore.getState().settings;

export function money(minor) {
  if (minor == null) return '—';
  const { label, decimals } = settings().currency;
  const n = new Intl.NumberFormat('fr-FR', { minimumFractionDigits: decimals, maximumFractionDigits: Math.max(decimals, minor % 100 ? 2 : 0) });
  return `${n.format(minor / 100)} ${label}`;
}

// '25 000' or '25000,50' -> 2500050 (hundredths). Returns null when not a valid amount.
export function parseMoney(text) {
  const t = String(text ?? '').replace(/[\s  ]/g, '').replace(',', '.');
  if (!/^\d+(\.\d{1,2})?$/.test(t)) return null;
  const [int, frac = ''] = t.split('.');
  return Number(int) * 100 + Number(`${frac}00`.slice(0, 2));
}

export const toMajor = (minor) => {
  if (minor == null) return '';
  return minor % 100 === 0 ? String(minor / 100) : (minor / 100).toFixed(2).replace('.', ',');
};

export const tz = () => settings().timezone;
export const parts = (v) => localParts(typeof v === 'string' ? Date.parse(v) : v, tz());
export const win = () => bookingWindow(settings().hours);

export function bizToday() {
  const p = parts(Date.now());
  return p.minutes < win().open ? addDays(p.date, -1) : p.date;
}

const formatters = new Map();
function dtf(opts) {
  const k = JSON.stringify(opts);
  if (!formatters.has(k)) formatters.set(k, new Intl.DateTimeFormat('fr-FR', { timeZone: 'UTC', ...opts }));
  return formatters.get(k);
}

// Formats a calendar date 'YYYY-MM-DD' (no time-zone shift).
export function dayLabel(date, style = 'long') {
  if (!date) return '—';
  const [y, m, d] = date.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  if (style === 'short') return dtf({ day: '2-digit', month: '2-digit', year: 'numeric' }).format(dt);
  if (style === 'medium') return dtf({ weekday: 'short', day: 'numeric', month: 'short' }).format(dt);
  if (style === 'title') {
    const s = dtf({ weekday: 'long', day: 'numeric', month: 'long' }).format(dt);
    return s.charAt(0).toUpperCase() + s.slice(1);
  }
  return dtf({ weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }).format(dt);
}

// 'YYYY-MM' -> 'Octobre 2026'
export function monthTitle(month) {
  const s = dtf({ month: 'long', year: 'numeric' }).format(new Date(`${month}-01T00:00:00Z`));
  return s.charAt(0).toUpperCase() + s.slice(1);
}

export function dateTime(iso) {
  if (!iso) return '—';
  const p = parts(iso);
  return `${dayLabel(p.date, 'short')} ${p.time}`;
}

export const pad2 = (n) => String(n).padStart(2, '0');
export const relLabel = (rel) => `${pad2(Math.floor(rel / 60) % 24)}:${pad2(rel % 60)}`;

// ---------------------------------------------------------------- labels

export const ROLE_LABEL = { admin: 'Propriétaire / administrateur', gerant: 'Gérant' };

export const STATUS = {
  humidor: { conforme: ['Dans les seuils', 'ok'], alerte: ['Hors seuils', 'danger'], a_controler: ['À contrôler', 'warn'] },
  res: { reservee: ['Réservée', 'info'], en_cours: ['En cours', 'ok'], terminee: ['Terminée', 'neutral'], annulee: ['Annulée', 'danger'] },
  charge: { due: ['À encaisser', 'warn'], payee: ['Encaissée', 'ok'], annulee: ['Annulée', 'neutral'], remboursee: ['Remboursée', 'danger'] },
  sub: {
    active: ['Active', 'ok'], expire_bientot: ['Expire bientôt', 'warn'], expiree: ['Expirée', 'danger'],
    a_venir: ['À venir', 'info'], aucun: ['Sans formule', 'neutral'], annulee: ['Annulée', 'neutral'],
  },
  entry: { active: ['Enregistrée', 'ok'], annulee: ['Annulée', 'neutral'] },
};

export const ACCOUNT_LABEL = { reservations: 'Réservations', alcool: 'Alcool', cigares: 'Cigares' };

export const subStateLabel = (summary) => {
  if (!summary || summary.state === 'aucun') return 'Aucune formule';
  if (summary.state === 'expiree') return `${summary.plan_name} — expirée le ${dayLabel(summary.end_date, 'short')}`;
  if (summary.state === 'a_venir') return `${summary.plan_name} — débute le ${dayLabel(summary.start_date, 'short')}`;
  return `${summary.plan_name} — jusqu’au ${dayLabel(summary.end_date, 'short')}`;
};

// ---------------------------------------------------------------- payments in the lists

// What a payment that has no line was for: a recharge of the card or an outside meal (its label); null for a
// plain payment, whose lines say it.
export function paymentPurpose(p) {
  if (p.kind === 'recharge') return RECHARGE_LINE_LABEL;
  if (p.kind === 'repas') return `Repas extérieur : ${p.label ?? ''}`;
  return null;
}

// How a payment was paid: the card's part apart from the rest when the card paid only part of it.
export function paymentMethodText(p) {
  const card = p.card_amount ?? 0;
  if (!card || p.method === CARD_METHOD) return p.method;
  return `${CARD_METHOD} ${money(card)} + ${p.method} ${money(p.amount - card)}`;
}

// 'YYYY-MM-DDT…' instant -> '24/10' on the club's clock.
export function dayMonth(iso) {
  const p = parts(iso);
  return `${p.date.slice(8, 10)}/${p.date.slice(5, 7)}`;
}
