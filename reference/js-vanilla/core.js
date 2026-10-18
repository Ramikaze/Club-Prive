// Client core: session state, escaped HTML templates, API client with safe retries, formatting.
import { localParts, addDays } from '/shared/time.js';
import { bookingWindow, fmtDuration } from '/shared/rules.js';

export { fmtDuration };

// ---------------------------------------------------------------- state

export const state = { me: null, settings: null, plans: [], accounts: [] };

export function setBundle(bundle) {
  state.me = bundle.user;
  state.settings = bundle.settings;
  state.plans = bundle.plans;
  state.accounts = bundle.accounts;
  document.title = `${bundle.settings.club_name} — Gestion`;
}

export const isAdmin = () => state.me?.role === 'admin';
export const ROLE_LABEL = { admin: 'Propriétaire / administrateur', gerant: 'Gérant' };

// ---------------------------------------------------------------- HTML (every value is escaped unless wrapped in raw())

const ESCAPES = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
export const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ESCAPES[c]);

class Raw {
  constructor(s) { this.s = s; }
  toString() { return this.s; }
}

export const raw = (s) => new Raw(String(s));

function renderValue(v) {
  if (v == null || v === false || v === true) return '';
  if (v instanceof Raw) return v.s;
  if (Array.isArray(v)) return v.map(renderValue).join('');
  return esc(v);
}

export function html(strings, ...values) {
  let out = strings[0];
  for (let i = 0; i < values.length; i += 1) out += renderValue(values[i]) + strings[i + 1];
  return new Raw(out);
}

// ---------------------------------------------------------------- API

export class ApiError extends Error {
  constructor(status, code, message, details) {
    super(message);
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

let onUnauthorized = () => {};
export const setUnauthorizedHandler = (fn) => { onUnauthorized = fn; };

// One key per user action: a retried request (network drop, double click) is applied only once.
export function newKey() {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function request(method, url, body, key) {
  const headers = { Accept: 'application/json' };
  if (method !== 'GET') headers['Content-Type'] = 'application/json';
  if (key) headers['Idempotency-Key'] = key;
  const retriable = method === 'GET' || Boolean(key);
  for (let attempt = 0; ; attempt += 1) {
    let res;
    try {
      res = await fetch(url, {
        method, headers, credentials: 'same-origin',
        body: method === 'GET' ? undefined : JSON.stringify(body ?? {}),
      });
    } catch {
      if (retriable && attempt < 2) {
        await sleep(600 * (attempt + 1));
        continue;
      }
      throw new ApiError(0, 'RESEAU', "Connexion au serveur impossible. Vérifiez le réseau puis réessayez : l'opération ne sera pas enregistrée deux fois.");
    }
    if (res.status >= 502 && res.status <= 504 && retriable && attempt < 2) {
      await sleep(600 * (attempt + 1));
      continue;
    }
    let data = null;
    try { data = await res.json(); } catch { /* empty body */ }
    if (res.status === 401 && url !== '/api/login') onUnauthorized();
    if (!res.ok) {
      throw new ApiError(res.status, data?.error?.code ?? 'ERREUR', data?.error?.message ?? `Erreur ${res.status}.`, data?.error?.details);
    }
    return data;
  }
}

export const api = {
  get: (url) => request('GET', url),
  post: (url, body, key = newKey()) => request('POST', url, body, key),
  put: (url, body, key = newKey()) => request('PUT', url, body, key),
  // Read-only computations sent with POST (previews): no idempotency key needed.
  preview: (url, body) => request('POST', url, body, null),
};

export const qs = (params) => {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== null && v !== '') p.set(k, v);
  const s = p.toString();
  return s ? `?${s}` : '';
};

// ---------------------------------------------------------------- formatting

export function money(minor) {
  if (minor == null) return '—';
  const { label, decimals } = state.settings.currency;
  const n = new Intl.NumberFormat('fr-FR', { minimumFractionDigits: decimals, maximumFractionDigits: Math.max(decimals, minor % 100 ? 2 : 0) });
  return `${n.format(minor / 100)} ${label}`;
}

// '25 000' or '25000,50' -> 2500050 (hundredths). Returns null when not a valid amount.
export function parseMoney(text) {
  const t = String(text ?? '').replace(/[\s  ]/g, '').replace(',', '.');
  if (!/^\d+(\.\d{1,2})?$/.test(t)) return null;
  const [int, frac = ''] = t.split('.');
  return Number(int) * 100 + Number(`${frac}00`.slice(0, 2));
}

export const toMajor = (minor) => {
  if (minor == null) return '';
  return minor % 100 === 0 ? String(minor / 100) : (minor / 100).toFixed(2).replace('.', ',');
};

export const tz = () => state.settings.timezone;
export const parts = (v) => localParts(typeof v === 'string' ? Date.parse(v) : v, tz());
export const win = () => bookingWindow(state.settings.hours);

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

export function dateTime(iso) {
  if (!iso) return '—';
  const p = parts(iso);
  return `${dayLabel(p.date, 'short')} ${p.time}`;
}

export const pad2 = (n) => String(n).padStart(2, '0');
export const relLabel = (rel) => `${pad2(Math.floor(rel / 60) % 24)}:${pad2(rel % 60)}`;

// ---------------------------------------------------------------- labels

export const STATUS = {
  res: { reservee: ['Réservée', 'info'], en_cours: ['En cours', 'ok'], terminee: ['Terminée', 'neutral'], annulee: ['Annulée', 'danger'] },
  charge: { due: ['À encaisser', 'warn'], payee: ['Encaissée', 'ok'], annulee: ['Annulée', 'neutral'], remboursee: ['Remboursée', 'danger'] },
  sub: {
    active: ['Active', 'ok'], expire_bientot: ['Expire bientôt', 'warn'], expiree: ['Expirée', 'danger'],
    a_venir: ['À venir', 'info'], aucun: ['Sans formule', 'neutral'], annulee: ['Annulée', 'neutral'],
  },
};

export function chip(group, key) {
  const [label, kind] = STATUS[group][key] ?? [key, 'neutral'];
  return html`<span class="chip chip-${kind}">${label}</span>`;
}

export const hypothesis = (title, label = 'Hypothèse') => html`<span class="chip chip-hyp" title="${title}">${label}</span>`;
export const demoChip = (on) => (on ? html`<span class="chip chip-demo" title="Donnée fictive de démonstration">démo</span>` : '');

export const ACCOUNT_LABEL = { reservations: 'Réservations', alcool: 'Alcool', cigares: 'Cigares' };
export const accountTag = (a) => html`<span class="nowrap"><i class="dot dot-${a}"></i> ${ACCOUNT_LABEL[a]}</span>`;

export const ACTION_LABELS = {
  connexion: 'Connexion',
  'parametres.modifier': 'Paramètres modifiés',
  'formule.modifier': 'Formule modifiée',
  'utilisateur.creer': 'Utilisateur créé',
  'utilisateur.modifier': 'Utilisateur modifié',
  'utilisateur.mot_de_passe_reinitialise': 'Mot de passe réinitialisé',
  'utilisateur.mot_de_passe_modifie': 'Mot de passe modifié',
  'membre.creer': 'Membre créé',
  'membre.modifier': 'Fiche membre modifiée',
  'abonnement.activer': 'Formule activée',
  'abonnement.renouveler': 'Formule renouvelée',
  'abonnement.annuler': 'Abonnement annulé',
  'credit.ajuster': 'Crédit ajusté',
  'carte.emettre': 'Carte émise',
  'carte.desactiver': 'Carte désactivée',
  'reservation.creer': 'Réservation créée',
  'reservation.prolonger': 'Prolongation',
  'reservation.demarrer': 'Arrivée : réservation démarrée',
  'reservation.terminer': 'Réservation terminée',
  'reservation.annuler': 'Réservation annulée',
  'reservation.consommation.ajouter': 'Consommation ajoutée',
  'paiement.enregistrer': 'Encaissement',
  'ligne.annuler': 'Ligne annulée',
  'ligne.rembourser': 'Remboursement',
  'produit.creer': 'Produit créé',
  'produit.modifier': 'Produit modifié',
  'stock.entree': 'Entrée de stock',
  'stock.ajustement': 'Ajustement de stock',
};

export const subStateLabel = (summary) => {
  if (!summary || summary.state === 'aucun') return 'Aucune formule';
  if (summary.state === 'expiree') return `${summary.plan_name} — expirée le ${dayLabel(summary.end_date, 'short')}`;
  if (summary.state === 'a_venir') return `${summary.plan_name} — débute le ${dayLabel(summary.start_date, 'short')}`;
  return `${summary.plan_name} — jusqu’au ${dayLabel(summary.end_date, 'short')}`;
};
