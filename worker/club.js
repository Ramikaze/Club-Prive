// Business layer. Every rule that protects money, credits, stock or the room lives here and runs
// on the server. Methods never open transactions themselves: callers wrap them in club.tx().
// The database is reached through a small adapter (get / all / run / transaction, see db.js) so the
// same code runs on a Cloudflare Durable Object and on node:sqlite in tests. Everything here is
// synchronous: password hashing and other async work happen in the API layer, before the transaction.
import { AppError, invalid, forbidden, notFound, conflict } from './errors.js';
import { text, int, toId, flag, frDate } from './validate.js';
import { ledgerMethods, DEFAULT_CATEGORIES } from './ledger.js';
import { loungeMethods } from './lounge.js';
import { seedDemo } from './seed.js';
import {
  localParts, localToUtcMs, addDays, addMonths, daysBetween, monthsElapsed, isValidDate, isValidTimeZone, parseHHMM,
} from '../shared/time.js';
import {
  ACCOUNTS, ACCOUNT_LABELS, bookingWindow, validateHours, placeInWindow, supplementAmount, supplementDetail, fmtDuration,
  isWeekend, minDurationFor, DEPOSIT_FROM, depositFor, formatMoney,
} from '../shared/rules.js';

export const RES_STATUS = { reservee: 'Réservée', en_cours: 'En cours', terminee: 'Terminée', annulee: 'Annulée' };
export const CHARGE_STATUS = { due: 'À encaisser', payee: 'Encaissée', annulee: 'Annulée', remboursee: 'Remboursée' };
const CHARGE_KIND = { temps_supplementaire: 'Temps supplémentaire', produit: 'Produit', abonnement: 'Abonnement' };
const EXPORT_SHEETS = {
  lignes: 'Lignes', encaissements: 'Encaissements', remboursements: 'Remboursements', synthese: 'Synthèse',
  reservations: 'Réservations', stock: 'Mouvements de stock', operations: 'Dépenses et entrées', 'grand-livre': 'Grand livre',
  tresorerie: 'Trésorerie',
};
const STOCK_KIND = {
  stock_initial: 'Stock initial', entree: 'Entrée', vente: 'Vente', annulation_vente: 'Annulation de vente',
  retour: 'Retour (remboursement)', ajustement: 'Ajustement',
};
const SESSION_DAYS = 14;

// Business data removed by a reset, children before parents. Users, settings, plans and
// categories are kept.
const WIPE_ORDER = [
  'humidor_readings', 'humidors',
  'idempotency_keys', 'payment_allocations', 'refunds', 'stock_movements', 'credit_movements', 'charges', 'payments',
  'reservation_attendees', 'reservations', 'cards', 'subscriptions', 'members', 'products', 'ledger_entries', 'closed_periods', 'audit_log',
];

// The fictitious author of the demo space's records: an administrator account of the demo database
// only. Real accounts start at id 1, so it never stands for one of them.
export const DEMO_AUTHOR_ID = 0;

export function defaultSettings() {
  return {
    club_name: 'Limen',
    currency: { label: 'FCFA', decimals: 0 },
    timezone: 'Africa/Brazzaville',
    hours: { open: '06:00' }, // start of the business day; the room can be booked at any hour
    // gap_min: minutes kept free between two bookings of the same room; 0 turns the rule off.
    booking: { slot_min: 30, min_duration_min: 60, weekend_min_duration_min: 120, extension_step_min: 30, gap_min: 30 },
    overtime_tariff: { hour: 2500000, half: 1500000, validated: false },
    annual_allocation_mode: 'activation',
    subscription_revenue_account: 'reservations',
    refunds_admin_only: true,
    payment_methods: ['Espèces', 'Carte bancaire', 'MTN MoMo', 'Airtel Money', 'Virement'],
    opening_balances: { date: null, amounts: {} },
    low_stock_default: 3,
    expiry_warning_days: 7,
  };
}

const DEFAULT_PLANS = [
  {
    code: 'MENSUELLE', name: 'Mensuelle — 2 heures', duration_months: 1, included_minutes: 120, price: 5000000,
    price_note: 'Tarif de carte compris comme 50 000 dans la transcription : montant et formule à confirmer.',
  },
  {
    code: 'ANNUELLE', name: 'Annuelle — 24 heures', duration_months: 12, included_minutes: 1440, price: null,
    price_note: 'Aucun tarif annuel établi. Le prix ne doit pas être déduit du prix mensuel.',
  },
];

// The club has a single room; more can be added in the room settings.
const DEFAULT_ROOMS = [
  { name: 'Salon Principal', capacity: 8, description: 'Grand salon privé' },
];

const RES_SELECT = `
  SELECT r.*, m.first_name, m.last_name, m.member_no, m.is_demo,
    rm.name AS room_name, rm.capacity AS room_capacity,
    cu.name AS created_by_name, au.name AS off_hours_authorized_by_name,
    (SELECT COALESCE(SUM(c.amount), 0) FROM charges c WHERE c.reservation_id = r.id AND c.status = 'due') AS due_amount,
    (SELECT COALESCE(SUM(c.amount), 0) FROM charges c WHERE c.reservation_id = r.id AND c.status IN ('due', 'payee')) AS billed_amount,
    (SELECT GROUP_CONCAT(c.quantity || '× ' || c.label, ' · ') FROM charges c WHERE c.reservation_id = r.id AND c.kind = 'produit' AND c.status IN ('due', 'payee')) AS items_summary
  FROM reservations r
  JOIN members m ON m.id = r.member_id
  LEFT JOIN rooms rm ON rm.id = r.room_id
  LEFT JOIN users cu ON cu.id = r.created_by
  LEFT JOIN users au ON au.id = r.off_hours_authorized_by`;

const CHARGE_SELECT = `
  SELECT c.*, u.name AS created_by_name, cu.name AS cancelled_by_name,
    pa.payment_id, p.paid_at, p.method AS payment_method,
    rf.id AS refund_id, rf.created_at AS refunded_at, rf.reason AS refund_reason,
    m.first_name, m.last_name, m.member_no, cm.first_name AS consumer_first, cm.last_name AS consumer_last
  FROM charges c
  JOIN members m ON m.id = c.member_id
  LEFT JOIN members cm ON cm.id = c.consumer_member_id
  LEFT JOIN users u ON u.id = c.created_by
  LEFT JOIN users cu ON cu.id = c.cancelled_by
  LEFT JOIN payment_allocations pa ON pa.charge_id = c.id
  LEFT JOIN payments p ON p.id = pa.payment_id
  LEFT JOIN refunds rf ON rf.charge_id = c.id`;

// A duration inside a sentence: « 30 minutes » (fmtDuration abbreviates them to « 30 min »), « 1 h 30 » from an hour on.
const durationInWords = (min) => (min < 60 ? `${min} minute${min > 1 ? 's' : ''}` : fmtDuration(min));

export class Club {
  constructor(db, { demo = false } = {}) {
    this.db = db;
    this.demo = !!demo; // true only in the demo space (fictitious data); the real club is never in demo mode
    this.depth = 0;
    this.cachedSettings = null;
    this.at = null; // fixed clock (ms), used only by the demo seed to backdate history
  }

  // ---------------------------------------------------------------- infrastructure

  nowMs() { return this.at ?? Date.now(); }
  nowIso() { return new Date(this.nowMs()).toISOString(); }

  get(sql, ...params) { return this.db.get(sql, ...params); }
  all(sql, ...params) { return this.db.all(sql, ...params); }
  run(sql, ...params) { return this.db.run(sql, ...params); }
  insert(sql, ...params) { return this.db.run(sql, ...params).lastId; }

  // A write transaction is atomic and synchronous: on the Durable Object nothing else runs until it
  // returns, so two operations on the same reservation, credit or stock are applied one after the other.
  tx(fn) {
    if (this.depth > 0) return fn();
    this.depth += 1;
    try {
      return this.db.transaction(fn);
    } catch (err) {
      this.cachedSettings = null;
      throw err;
    } finally {
      this.depth -= 1;
    }
  }

  audit(actor, action, entity, entityId, details) {
    this.run(
      'INSERT INTO audit_log (at, user_id, action, entity, entity_id, details) VALUES (?, ?, ?, ?, ?, ?)',
      this.nowIso(), actor?.id ?? null, action, entity ?? null, entityId ?? null, details ? JSON.stringify(details) : null,
    );
  }

  bootstrap() {
    this.tx(() => {
      for (const [key, value] of Object.entries(defaultSettings())) {
        this.run('INSERT OR IGNORE INTO settings (key, value, updated_at) VALUES (?, ?, ?)', key, JSON.stringify(value), this.nowIso());
      }
      if (!this.get('SELECT 1 AS x FROM plans LIMIT 1')) {
        for (const p of DEFAULT_PLANS) {
          this.run(
            'INSERT INTO plans (code, name, duration_months, included_minutes, price, price_validated, price_note, updated_at) VALUES (?, ?, ?, ?, ?, 0, ?, ?)',
            p.code, p.name, p.duration_months, p.included_minutes, p.price, p.price_note, this.nowIso(),
          );
        }
      }
      if (!this.get('SELECT 1 AS x FROM rooms LIMIT 1')) {
        for (const r of DEFAULT_ROOMS) {
          this.run(
            'INSERT INTO rooms (name, capacity, description, active, created_at) VALUES (?, ?, ?, 1, ?)',
            r.name, r.capacity, r.description, this.nowIso(),
          );
        }
      }
      this.run('UPDATE reservations SET room_id = (SELECT id FROM rooms ORDER BY id LIMIT 1) WHERE room_id IS NULL');
      if (!this.get("SELECT 1 AS x FROM meta WHERE key = 'single_room'")) {
        this.retireExtraRooms();
        this.run("INSERT INTO meta (key, value) VALUES ('single_room', ?)", this.nowIso());
      }
      if (!this.get('SELECT 1 AS x FROM categories LIMIT 1')) {
        for (const [kind, names] of Object.entries(DEFAULT_CATEGORIES)) {
          for (const name of names) this.run('INSERT INTO categories (kind, name, created_at) VALUES (?, ?, ?)', kind, name, this.nowIso());
        }
      }
      this.run('DELETE FROM idempotency_keys WHERE created_at < ?', new Date(Date.now() - 7 * 86400000).toISOString());
      this.run('DELETE FROM sessions WHERE expires_at < ?', new Date().toISOString());
    });
    this.cachedSettings = null;
  }

  hasUsers() {
    return !!this.get('SELECT 1 AS x FROM users LIMIT 1');
  }

  isEmpty() {
    return !['members', 'products', 'reservations', 'ledger_entries', 'humidors'].some((t) => this.get(`SELECT 1 AS x FROM ${t} LIMIT 1`));
  }

  // Removes every business record (members, bookings, money, stock, history) so the club can start
  // for real after a demonstration. Accounts, settings, plans and categories are kept.
  wipeData(actor, confirm) {
    if (confirm !== 'EFFACER') throw invalid('Pour confirmer, saisissez EFFACER en majuscules.');
    for (const table of WIPE_ORDER) this.run(`DELETE FROM ${table}`);
    this.run("DELETE FROM settings WHERE key = 'opening_balances'");
    this.cachedSettings = null;
    this.audit(actor, 'donnees.effacer', null, null, { tables: WIPE_ORDER });
    return { ok: true };
  }

  // ---------------------------------------------------------------- settings

  settings() {
    if (!this.cachedSettings) {
      const s = defaultSettings();
      for (const row of this.all('SELECT key, value FROM settings')) if (row.key in s) s[row.key] = JSON.parse(row.value);
      // A booking setting saved before the gap existed has no `gap_min`: it reads with the default.
      if (!Number.isInteger(s.booking.gap_min)) s.booking = { ...s.booking, gap_min: defaultSettings().booking.gap_min };
      // Not a stored setting: it follows the space the club runs in, whatever an older `demo_mode` row says.
      s.demo_mode = this.demo;
      this.cachedSettings = s;
    }
    return this.cachedSettings;
  }

  window() { return bookingWindow(this.settings().hours); }

  money(minor) { return formatMoney(minor, this.settings().currency); }

  bizDayOf(ms) {
    const s = this.settings();
    const lp = localParts(ms, s.timezone);
    return lp.minutes < this.window().open ? addDays(lp.date, -1) : lp.date;
  }

  bizToday() { return this.bizDayOf(this.nowMs()); }

  // Financial periods follow business days (opening time to opening time the next day),
  // so a payment taken at 01:00 belongs to the evening it was earned.
  periodBounds(from, to) {
    if (!isValidDate(from) || !isValidDate(to)) throw invalid('Période invalide.');
    if (to < from) throw invalid('La date de fin doit suivre la date de début.');
    if (daysBetween(from, to) > 400) throw invalid('Période limitée à 400 jours.');
    const s = this.settings();
    return [
      new Date(localToUtcMs(from, s.hours.open, s.timezone)).toISOString(),
      new Date(localToUtcMs(addDays(to, 1), s.hours.open, s.timezone)).toISOString(),
    ];
  }

  bundle(user) {
    return {
      user: this.userDTO(user),
      settings: this.settings(),
      plans: this.plans(),
      rooms: this.rooms({ includeInactive: true }),
      accounts: ACCOUNTS.map((key) => ({ key, label: ACCOUNT_LABELS[key] })),
      biz_today: this.bizToday(),
      server_time: this.nowIso(),
      demo: this.demo,
    };
  }

  normalizeSetting(actor, key, v, current) {
    switch (key) {
      case 'club_name':
        return text(v, 'Nom du club', { required: true, max: 80 });
      case 'currency': {
        if (!v || typeof v !== 'object') throw invalid('Devise invalide.');
        return {
          label: text(v.label, 'Libellé de la devise', { required: true, max: 12 }),
          decimals: int(v.decimals, 'Nombre de décimales', { min: 0, max: 2 }),
        };
      }
      case 'timezone': {
        const tz = text(v, 'Fuseau horaire', { required: true, max: 64 });
        if (!isValidTimeZone(tz)) throw invalid('Fuseau horaire inconnu (exemples : Africa/Brazzaville, Europe/Paris).');
        return tz;
      }
      case 'hours': {
        const h = { open: String(v?.open ?? '') };
        const err = validateHours(h);
        if (err) throw invalid(err);
        return h;
      }
      case 'booking': {
        const slot = int(v?.slot_min, 'Pas des créneaux', { min: 15, max: 60 });
        if (![15, 30, 60].includes(slot)) throw invalid('Pas des créneaux : 15, 30 ou 60 minutes.');
        const min = int(v?.min_duration_min, 'Durée minimale', { min: slot, max: 720 });
        const weekend = int(v?.weekend_min_duration_min ?? current.weekend_min_duration_min ?? min, 'Durée minimale le week-end', { min: slot, max: 720 });
        const step = int(v?.extension_step_min, 'Pas de prolongation', { min: slot, max: 240 });
        // Left out (as by a client that predates the gap), the gap keeps its value.
        const gap = int(v?.gap_min ?? current.gap_min, 'Battement entre deux réservations', { min: 0, max: 240 });
        if (min % slot || weekend % slot || step % slot) throw invalid('Les durées minimales et le pas de prolongation doivent être des multiples du pas des créneaux.');
        if (weekend < min) throw invalid('La durée minimale du week-end ne peut pas être plus courte que celle de la semaine.');
        return { slot_min: slot, min_duration_min: min, weekend_min_duration_min: weekend, extension_step_min: step, gap_min: gap };
      }
      case 'overtime_tariff': {
        const hour = int(v?.hour, "Prix de l'heure supplémentaire", { min: 0 });
        const half = int(v?.half, 'Prix de la demi-heure supplémentaire', { min: 0 });
        const changed = hour !== current.hour || half !== current.half;
        const validated = v?.validated === undefined ? (!changed && current.validated) : flag(v.validated);
        const out = { hour, half, validated };
        if (validated) {
          const keep = !changed && current.validated;
          out.validated_by = keep ? current.validated_by : actor.name;
          out.validated_at = keep ? current.validated_at : this.nowIso();
        }
        return out;
      }
      case 'refunds_admin_only':
        return flag(v);
      case 'annual_allocation_mode':
        if (!['activation', 'mensuelle'].includes(v)) throw invalid("Mode d'attribution invalide.");
        return v;
      case 'subscription_revenue_account':
        if (!ACCOUNTS.includes(v)) throw invalid('Sous-compte invalide.');
        return v;
      case 'payment_methods': {
        if (!Array.isArray(v)) throw invalid('Liste des moyens de paiement invalide.');
        const list = [...new Set(v.map((x) => text(x, 'Moyen de paiement', { max: 40 })).filter(Boolean))];
        if (!list.length || list.length > 12) throw invalid('Indiquez entre 1 et 12 moyens de paiement.');
        return list;
      }
      case 'opening_balances':
        return this.normalizeOpeningBalances(v, current);
      case 'low_stock_default':
        return int(v, "Seuil d'alerte de stock", { min: 0, max: 10000 });
      case 'expiry_warning_days':
        return int(v, "Délai d'alerte d'expiration", { min: 1, max: 90 });
      default:
        throw invalid(`Paramètre inconnu : ${key}`);
    }
  }

  updateSettings(actor, patch) {
    if (!patch || typeof patch !== 'object' || Array.isArray(patch)) throw invalid('Paramètres invalides.');
    const current = this.settings();
    const changes = {};
    for (const [key, value] of Object.entries(patch)) {
      // `demo_mode` is in `current` (derived, see settings()) but has no case in normalizeSetting:
      // it is refused like any unknown key.
      if (!(key in current)) throw invalid(`Paramètre inconnu : ${key}`);
      changes[key] = this.normalizeSetting(actor, key, value, current[key]);
    }
    const before = {};
    for (const key of Object.keys(changes)) {
      before[key] = current[key];
      this.run(
        `INSERT INTO settings (key, value, updated_at, updated_by) VALUES (?, ?, ?, ?)
         ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at, updated_by = excluded.updated_by`,
        key, JSON.stringify(changes[key]), this.nowIso(), actor.id,
      );
    }
    this.cachedSettings = null;
    this.audit(actor, 'parametres.modifier', 'settings', null, { avant: before, apres: changes });
    return this.settings();
  }

  // ---------------------------------------------------------------- plans (formules)

  planDTO(p) {
    return {
      id: p.id, code: p.code, name: p.name, duration_months: p.duration_months, included_minutes: p.included_minutes,
      price: p.price, price_validated: !!p.price_validated, price_validated_at: p.price_validated_at ?? null,
      price_validated_by_name: p.price_validated_by_name ?? null, price_note: p.price_note, active: !!p.active,
    };
  }

  plans() {
    return this.all(`SELECT p.*, u.name AS price_validated_by_name FROM plans p
      LEFT JOIN users u ON u.id = p.price_validated_by ORDER BY p.duration_months, p.id`).map((p) => this.planDTO(p));
  }

  updatePlan(actor, planId, input) {
    const p = this.get('SELECT * FROM plans WHERE id = ?', toId(planId));
    if (!p) throw notFound('Formule');
    const name = input.name !== undefined ? text(input.name, 'Nom de la formule', { required: true, max: 80 }) : p.name;
    const included = input.included_minutes !== undefined
      ? int(input.included_minutes, 'Heures incluses (en minutes)', { min: 0, max: 100000 }) : p.included_minutes;
    let price = p.price;
    if (input.price !== undefined) price = input.price === null || input.price === '' ? null : int(input.price, 'Prix', { min: 0 });
    const priceChanged = price !== p.price;
    const validated = input.price_validated !== undefined ? flag(input.price_validated) : (!priceChanged && !!p.price_validated);
    if (price == null && validated) throw invalid('Impossible de valider un prix non défini.');
    const note = input.price_note !== undefined ? text(input.price_note, 'Note sur le tarif', { max: 300 }) : p.price_note;
    const active = input.active !== undefined ? flag(input.active) : !!p.active;
    const newlyValidated = validated && (!p.price_validated || priceChanged);
    this.run(
      `UPDATE plans SET name = ?, included_minutes = ?, price = ?, price_validated = ?,
         price_validated_by = ?, price_validated_at = ?, price_note = ?, active = ?, updated_at = ?, updated_by = ?
       WHERE id = ?`,
      name, included, price, validated ? 1 : 0,
      validated ? (newlyValidated ? actor.id : p.price_validated_by) : null,
      validated ? (newlyValidated ? this.nowIso() : p.price_validated_at) : null,
      note, active ? 1 : 0, this.nowIso(), actor.id, p.id,
    );
    this.audit(actor, 'formule.modifier', 'plan', p.id, {
      avant: { name: p.name, included_minutes: p.included_minutes, price: p.price, price_validated: !!p.price_validated, active: !!p.active },
      apres: { name, included_minutes: included, price, price_validated: validated, active },
    });
    return this.plans().find((x) => x.id === p.id);
  }

  // ---------------------------------------------------------------- users & sessions

  userDTO(u) {
    return {
      id: u.id, login: u.login, name: u.name, role: u.role, active: !!u.active,
      last_login_at: u.last_login_at ?? null, created_at: u.created_at,
    };
  }

  listUsers() {
    return this.all('SELECT * FROM users ORDER BY active DESC, role, name').map((u) => this.userDTO(u));
  }

  userRow(id) {
    const u = this.get('SELECT * FROM users WHERE id = ?', toId(id));
    if (!u) throw notFound('Utilisateur');
    return u;
  }

  // `password_hash` is computed by the API layer (asynchronous WebCrypto) after its strength check.
  createUser(actor, input) {
    const login = text(input.login, 'Identifiant', { required: true, max: 40 });
    if (!/^[a-zA-Z0-9._-]{3,40}$/.test(login)) throw invalid('Identifiant : 3 à 40 caractères (lettres, chiffres, point, tiret).');
    const name = text(input.name, 'Nom', { required: true, max: 80 });
    if (!['admin', 'gerant'].includes(input.role)) throw invalid('Rôle invalide.');
    if (typeof input.password_hash !== 'string' || !input.password_hash) throw invalid('Mot de passe manquant.');
    if (this.get('SELECT 1 AS x FROM users WHERE login = ?', login)) throw conflict('IDENTIFIANT_PRIS', 'Cet identifiant est déjà utilisé.');
    const id = this.insert(
      'INSERT INTO users (login, name, role, password_hash, created_at, created_by) VALUES (?, ?, ?, ?, ?, ?)',
      login, name, input.role, input.password_hash, this.nowIso(), actor?.id ?? null,
    );
    this.audit(actor, 'utilisateur.creer', 'user', id, { login, name, role: input.role });
    return this.userDTO(this.userRow(id));
  }

  updateUser(actor, userId, input) {
    const u = this.userRow(userId);
    const name = input.name !== undefined ? text(input.name, 'Nom', { required: true, max: 80 }) : u.name;
    const role = input.role !== undefined ? input.role : u.role;
    if (!['admin', 'gerant'].includes(role)) throw invalid('Rôle invalide.');
    const active = input.active !== undefined ? flag(input.active) : !!u.active;
    if (u.id === actor.id && (role !== 'admin' || !active)) {
      throw invalid("Vous ne pouvez ni retirer vos propres droits d'administrateur ni désactiver votre compte.");
    }
    if (u.role === 'admin' && u.active && (role !== 'admin' || !active)) {
      const { n } = this.get("SELECT COUNT(*) AS n FROM users WHERE role = 'admin' AND active = 1");
      if (n <= 1) throw conflict('DERNIER_ADMIN', 'Il doit rester au moins un administrateur actif.');
    }
    this.run('UPDATE users SET name = ?, role = ?, active = ? WHERE id = ?', name, role, active ? 1 : 0, u.id);
    if (!active || role !== u.role) this.run('DELETE FROM sessions WHERE user_id = ?', u.id);
    this.audit(actor, 'utilisateur.modifier', 'user', u.id, {
      avant: { name: u.name, role: u.role, active: !!u.active }, apres: { name, role, active },
    });
    return this.userDTO(this.userRow(u.id));
  }

  setUserPassword(actor, userId, passwordHash) {
    const u = this.userRow(userId);
    this.run('UPDATE users SET password_hash = ? WHERE id = ?', passwordHash, u.id);
    this.run('DELETE FROM sessions WHERE user_id = ?', u.id);
    this.audit(actor, 'utilisateur.mot_de_passe_reinitialise', 'user', u.id, null);
    return { ok: true };
  }

  // The current password was checked by the API layer; other sessions of the user are closed.
  changeOwnPassword(actor, passwordHash, keepTokenHash) {
    const u = this.userRow(actor.id);
    this.run('UPDATE users SET password_hash = ? WHERE id = ?', passwordHash, u.id);
    this.run('DELETE FROM sessions WHERE user_id = ? AND token_hash <> ?', u.id, keepTokenHash ?? '');
    this.audit(actor, 'utilisateur.mot_de_passe_modifie', 'user', u.id, null);
    return { ok: true };
  }

  // Lost access: the installation code (checked by the API layer) gives the club's first administrator
  // a new identifier and password; the account is reactivated and its open sessions are closed.
  resetOwnerAccess(input) {
    const login = text(input.login, 'Identifiant', { required: true, max: 40 });
    if (!/^[a-zA-Z0-9._-]{3,40}$/.test(login)) throw invalid('Identifiant : 3 à 40 caractères (lettres, chiffres, point, tiret).');
    if (typeof input.password_hash !== 'string' || !input.password_hash) throw invalid('Mot de passe manquant.');
    const owner = this.get("SELECT * FROM users WHERE role = 'admin' ORDER BY id LIMIT 1");
    if (!owner) throw notFound('Administrateur');
    if (this.get('SELECT 1 AS x FROM users WHERE login = ? AND id <> ?', login, owner.id)) {
      throw conflict('IDENTIFIANT_PRIS', 'Cet identifiant est déjà utilisé.');
    }
    this.run('UPDATE users SET login = ?, password_hash = ?, active = 1 WHERE id = ?', login, input.password_hash, owner.id);
    this.run('DELETE FROM sessions WHERE user_id = ?', owner.id);
    this.audit(null, 'utilisateur.acces_reinitialise', 'user', owner.id, { avant: owner.login, apres: login });
    return this.userRow(owner.id);
  }

  userByLogin(loginName) {
    return this.get('SELECT * FROM users WHERE login = ?', String(loginName ?? '').trim()) ?? null;
  }

  // Sessions are stored by token hash only: a copy of the database does not give access.
  openSession(user, tokenHash) {
    const u = this.userRow(user.id);
    if (!u.active) return null;
    const now = new Date();
    this.run(
      'INSERT INTO sessions (token_hash, user_id, created_at, expires_at) VALUES (?, ?, ?, ?)',
      tokenHash, u.id, now.toISOString(), new Date(now.getTime() + SESSION_DAYS * 86400000).toISOString(),
    );
    this.run('UPDATE users SET last_login_at = ? WHERE id = ?', now.toISOString(), u.id);
    this.audit(u, 'connexion', 'user', u.id, null);
    return { user: this.userRow(u.id), maxAge: SESSION_DAYS * 86400 };
  }

  sessionUser(tokenHash) {
    if (!tokenHash) return null;
    const row = this.get(
      'SELECT u.*, s.expires_at AS session_expires FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.token_hash = ?',
      tokenHash,
    );
    if (!row || row.session_expires < new Date().toISOString() || !row.active) return null;
    return row;
  }

  logout(tokenHash) {
    if (tokenHash) this.run('DELETE FROM sessions WHERE token_hash = ?', tokenHash);
    return { ok: true };
  }

  // ---------------------------------------------------------------- members

  memberRow(id) {
    const m = this.get('SELECT * FROM members WHERE id = ?', toId(id, 'Membre'));
    if (!m) throw notFound('Membre');
    return m;
  }

  memberFields(input, current = {}) {
    const pick = (k) => (input[k] !== undefined ? input[k] : current[k]);
    const first = text(pick('first_name'), 'Prénom', { required: true, max: 60 });
    const last = text(pick('last_name'), 'Nom', { required: true, max: 60 });
    const phone = text(pick('phone'), 'Téléphone', { required: true, max: 30 });
    if (!/^[0-9+().\s-]{6,30}$/.test(phone)) throw invalid('Téléphone : chiffres, espaces et + uniquement (6 caractères minimum).');
    const email = text(pick('email'), 'Courriel', { max: 120 });
    if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw invalid('Courriel invalide.');
    const notes = text(pick('notes'), 'Notes', { max: 500 });
    return { first, last, phone, email, notes };
  }

  createMember(actor, input, { demo = false } = {}) {
    const f = this.memberFields(input);
    const { n } = this.get('SELECT COALESCE(MAX(id), 0) + 1 AS n FROM members');
    const memberNo = `M-${String(n).padStart(4, '0')}`;
    const id = this.insert(
      `INSERT INTO members (member_no, first_name, last_name, phone, email, notes, is_demo, created_at, created_by)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      memberNo, f.first, f.last, f.phone, f.email, f.notes, demo ? 1 : 0, this.nowIso(), actor.id,
    );
    this.audit(actor, 'membre.creer', 'member', id, { member_no: memberNo, nom: `${f.first} ${f.last}` });
    return this.memberDetail(id);
  }

  updateMember(actor, memberId, input) {
    const m = this.memberRow(memberId);
    const f = this.memberFields(input, m);
    this.run(
      'UPDATE members SET first_name = ?, last_name = ?, phone = ?, email = ?, notes = ?, updated_at = ?, updated_by = ? WHERE id = ?',
      f.first, f.last, f.phone, f.email, f.notes, this.nowIso(), actor.id, m.id,
    );
    this.audit(actor, 'membre.modifier', 'member', m.id, {
      avant: { first_name: m.first_name, last_name: m.last_name, phone: m.phone, email: m.email },
      apres: { first_name: f.first, last_name: f.last, phone: f.phone, email: f.email },
    });
    return this.memberDetail(m.id);
  }

  // A member is never deleted: deactivation keeps every payment, booking and consumption in the
  // books, and stops new bookings, room access, plans and cards until the member is reactivated.
  assertMemberActive(m, what) {
    if (m.active === 0) {
      throw conflict('MEMBRE_DESACTIVE', `${m.first_name} ${m.last_name} est désactivé : réactivez sa fiche avant ${what}.`);
    }
  }

  deactivateMember(actor, memberId, input) {
    const m = this.memberRow(memberId);
    if (m.active === 0) throw conflict('DEJA_DESACTIVE', 'Ce membre est déjà désactivé.');
    const reason = text(input.reason, 'Motif de la désactivation', { required: true, min: 3, max: 300 });
    const { n } = this.get(
      `SELECT COUNT(*) AS n FROM reservations r
       WHERE r.status IN ('reservee', 'en_cours')
         AND (r.member_id = ? OR EXISTS (SELECT 1 FROM reservation_attendees ra WHERE ra.reservation_id = r.id AND ra.member_id = ?))`,
      m.id, m.id,
    );
    if (n > 0) {
      throw conflict('RESERVATIONS_ACTIVES', `${m.first_name} ${m.last_name} figure dans ${n} réservation(s) en cours ou à venir : terminez-les ou annulez-les avant de désactiver la fiche.`);
    }
    this.run(
      'UPDATE members SET active = 0, deactivated_at = ?, deactivated_by = ?, deactivation_reason = ?, updated_at = ?, updated_by = ? WHERE id = ?',
      this.nowIso(), actor.id, reason, this.nowIso(), actor.id, m.id,
    );
    this.audit(actor, 'membre.desactiver', 'member', m.id, { member_no: m.member_no, nom: `${m.first_name} ${m.last_name}`, motif: reason });
    return this.memberDetail(m.id);
  }

  reactivateMember(actor, memberId) {
    const m = this.memberRow(memberId);
    if (m.active !== 0) throw conflict('DEJA_ACTIF', 'Ce membre est déjà actif.');
    this.run(
      'UPDATE members SET active = 1, deactivated_at = NULL, deactivated_by = NULL, deactivation_reason = NULL, updated_at = ?, updated_by = ? WHERE id = ?',
      this.nowIso(), actor.id, m.id,
    );
    this.audit(actor, 'membre.reactiver', 'member', m.id, { member_no: m.member_no, nom: `${m.first_name} ${m.last_name}`, motif_precedent: m.deactivation_reason });
    return this.memberDetail(m.id);
  }

  // ---------------------------------------------------------------- rooms

  roomDTO(r) {
    return {
      id: r.id,
      name: r.name,
      capacity: r.capacity,
      description: r.description ?? null,
      active: !!r.active,
    };
  }

  rooms({ includeInactive = false } = {}) {
    const rows = includeInactive
      ? this.all('SELECT * FROM rooms WHERE archived_at IS NULL ORDER BY id')
      : this.all('SELECT * FROM rooms WHERE active = 1 AND archived_at IS NULL ORDER BY id');
    return rows.map((r) => this.roomDTO(r));
  }

  resolveRoom(roomId) {
    if (roomId !== undefined && roomId !== null && roomId !== '') {
      const r = this.get('SELECT * FROM rooms WHERE id = ?', toId(roomId, 'Salle'));
      if (!r || !r.active || r.archived_at) throw invalid('Salle invalide ou inactive.');
      return r;
    }
    const def = this.get('SELECT * FROM rooms WHERE active = 1 AND archived_at IS NULL ORDER BY id LIMIT 1');
    if (!def) throw conflict('AUCUNE_SALLE', 'Aucune salle ouverte à la réservation.');
    return def;
  }

  createRoom(actor, input) {
    const name = text(input.name, 'Nom de la salle', { required: true, max: 60 });
    const capacity = input.capacity === undefined ? 6 : int(input.capacity, 'Capacité', { min: 1, max: 200 });
    const description = text(input.description, 'Description', { max: 200 });
    if (this.get('SELECT 1 AS x FROM rooms WHERE name = ?', name)) {
      throw conflict('SALLE_EXISTANTE', 'Une salle porte déjà ce nom.');
    }
    const id = this.insert(
      'INSERT INTO rooms (name, capacity, description, active, created_at, created_by) VALUES (?, ?, ?, 1, ?, ?)',
      name, capacity, description, this.nowIso(), actor.id,
    );
    this.audit(actor, 'salle.creer', 'room', id, { name, capacity });
    return this.roomDTO(this.get('SELECT * FROM rooms WHERE id = ?', id));
  }

  updateRoom(actor, roomId, input) {
    const r = this.get('SELECT * FROM rooms WHERE id = ?', toId(roomId, 'Salle'));
    if (!r || r.archived_at) throw notFound('Salle');
    const name = input.name !== undefined ? text(input.name, 'Nom de la salle', { required: true, max: 60 }) : r.name;
    const capacity = input.capacity !== undefined ? int(input.capacity, 'Capacité', { min: 1, max: 200 }) : r.capacity;
    const description = input.description !== undefined ? text(input.description, 'Description', { max: 200 }) : r.description;
    const active = input.active !== undefined ? flag(input.active) : !!r.active;
    if (name.toLowerCase() !== r.name.toLowerCase() && this.get('SELECT 1 AS x FROM rooms WHERE name = ? AND id <> ?', name, r.id)) {
      throw conflict('SALLE_EXISTANTE', 'Une salle porte déjà ce nom.');
    }
    if (!active) {
      const { n } = this.get('SELECT COUNT(*) AS n FROM rooms WHERE active = 1 AND archived_at IS NULL AND id <> ?', r.id);
      if (n < 1) throw conflict('DERNIERE_SALLE', 'Il doit rester au moins une salle active.');
    }
    const bookings = this.all("SELECT id, party_size FROM reservations WHERE room_id = ? AND status IN ('reservee', 'en_cours')", r.id);
    if (!active && bookings.length) {
      throw conflict('RESERVATIONS_ACTIVES', 'Déplacez ou annulez les réservations actives avant de fermer cette salle.');
    }
    if (bookings.some((b) => Math.max(b.party_size, 1 + this.get('SELECT COUNT(*) AS n FROM reservation_attendees WHERE reservation_id = ?', b.id).n) > capacity)) {
      throw conflict('CAPACITE_DEPASSEE', 'Une réservation active dépasse cette capacité. Modifiez son effectif ou changez-la de salle avant de réduire la capacité.');
    }
    this.run(
      'UPDATE rooms SET name = ?, capacity = ?, description = ?, active = ?, updated_at = ? WHERE id = ?',
      name, capacity, description, active ? 1 : 0, this.nowIso(), r.id,
    );
    this.audit(actor, 'salle.modifier', 'room', r.id, { name, capacity, active });
    return this.roomDTO(this.get('SELECT * FROM rooms WHERE id = ?', r.id));
  }

  deleteRoom(actor, roomId) {
    const r = this.get('SELECT * FROM rooms WHERE id = ?', toId(roomId, 'Salle'));
    if (!r || r.archived_at) throw notFound('Salle');
    const { n } = this.get('SELECT COUNT(*) AS n FROM rooms WHERE active = 1 AND archived_at IS NULL AND id <> ?', r.id);
    if (n < 1) throw conflict('DERNIERE_SALLE', 'Il doit rester au moins une salle active.');
    const activeRes = this.get(
      "SELECT COUNT(*) AS c FROM reservations WHERE room_id = ? AND status IN ('reservee', 'en_cours')",
      r.id,
    );
    if (activeRes.c > 0) {
      throw conflict('RESERVATIONS_ACTIVES', `Cette salle a ${activeRes.c} réservation(s) en cours ou à venir.`);
    }
    // Keep the original room on historical reservations, including simultaneous sessions.
    this.run('UPDATE rooms SET active = 0, archived_at = ?, updated_at = ? WHERE id = ?', this.nowIso(), this.nowIso(), r.id);
    this.audit(actor, 'salle.supprimer', 'room', r.id, { name: r.name });
    return { ok: true, deleted_id: r.id };
  }

  // The club has a single room. Run once per database: bookings still to come in the other rooms
  // move to the main room when it is free, then the other rooms are retired (their history keeps
  // its original room, as with a deleted room). A room still holding a booking that cannot move stays.
  retireExtraRooms() {
    const keep = this.get("SELECT id FROM rooms WHERE active = 1 AND archived_at IS NULL ORDER BY name = 'Salon Principal' DESC, id LIMIT 1");
    if (!keep) return;
    const now = this.nowIso();
    const pending = this.all(
      "SELECT id, start_ms, end_ms FROM reservations WHERE status IN ('reservee', 'en_cours') AND room_id <> ? ORDER BY start_ms",
      keep.id,
    );
    for (const r of pending) {
      if (this.overlapping(r.start_ms, r.end_ms, r.id, keep.id).length) continue;
      this.run('UPDATE reservations SET room_id = ?, updated_at = ? WHERE id = ?', keep.id, now, r.id);
    }
    this.run(
      `UPDATE rooms SET active = 0, archived_at = ?, updated_at = ? WHERE id <> ? AND archived_at IS NULL
         AND NOT EXISTS (SELECT 1 FROM reservations r WHERE r.room_id = rooms.id AND r.status IN ('reservee', 'en_cours'))`,
      now, now, keep.id,
    );
  }

  activeCardCode(memberId) {
    const c = this.get("SELECT code FROM cards WHERE member_id = ? AND status = 'active' ORDER BY id DESC LIMIT 1", memberId);
    return c?.code ?? null;
  }

  hasDeactivatedCardsOnly(memberId) {
    const total = this.get('SELECT COUNT(*) AS n FROM cards WHERE member_id = ?', memberId).n;
    if (total === 0) return false;
    const active = this.get("SELECT COUNT(*) AS n FROM cards WHERE member_id = ? AND status = 'active'", memberId).n;
    return active === 0;
  }

  memberBase(m) {
    return {
      id: m.id, member_no: m.member_no, first_name: m.first_name, last_name: m.last_name,
      name: `${m.first_name} ${m.last_name}`, phone: m.phone, email: m.email, notes: m.notes,
      is_demo: !!m.is_demo, created_at: m.created_at,
      card_code: this.activeCardCode(m.id),
      active: m.active !== 0, deactivated_at: m.deactivated_at ?? null, deactivation_reason: m.deactivation_reason ?? null,
    };
  }

  // statut: 'actifs' (default), 'desactives' or 'tous'.
  listMembers(q, statut = 'actifs') {
    const keep = statut === 'tous' ? () => true : statut === 'desactives' ? (m) => m.active === 0 : (m) => m.active !== 0;
    let raw = typeof q === 'string' ? q.trim() : '';
    const qrCardMatch = raw.match(/[?&]card=([A-Z0-9-]{4,40})/i);
    if (qrCardMatch) raw = qrCardMatch[1];
    const query = raw.slice(0, 60);
    let rows;
    if (query) {
      const like = `%${query.replace(/[%_\\]/g, '\\$&')}%`;
      rows = this.all(
        `SELECT DISTINCT m.* FROM members m LEFT JOIN cards c ON c.member_id = m.id
         WHERE m.first_name || ' ' || m.last_name LIKE ? ESCAPE '\\'
            OR m.last_name || ' ' || m.first_name LIKE ? ESCAPE '\\'
            OR m.phone LIKE ? ESCAPE '\\' OR m.member_no LIKE ? ESCAPE '\\' OR c.code LIKE ? ESCAPE '\\'
         ORDER BY m.last_name, m.first_name LIMIT 200`,
        like, like, like, like, like,
      );
    } else {
      rows = this.all('SELECT * FROM members ORDER BY last_name, first_name LIMIT 500');
    }
    const today = this.bizToday();
    return rows.filter(keep).map((m) => {
      const base = this.memberBase(m);
      const subscription = this.subscriptionSummary(m.id, today);
      const cardsDeactivated = this.hasDeactivatedCardsOnly(m.id);
      const canEnterRoom = m.active !== 0 && !cardsDeactivated
        && ['active', 'expire_bientot'].includes(subscription.state)
        && (subscription.credit?.available ?? 0) > 0;
      return {
        ...base,
        subscription,
        cards_deactivated: cardsDeactivated,
        can_enter_room: canEnterRoom,
      };
    });
  }

  memberDetail(memberId) {
    const m = this.memberRow(memberId);
    const today = this.bizToday();
    const subscriptions = this.all(
      `SELECT s.*, u.name AS created_by_name FROM subscriptions s LEFT JOIN users u ON u.id = s.created_by
       WHERE s.member_id = ? ORDER BY s.start_date DESC`, m.id,
    ).map((s) => this.subscriptionDTO(s, today));
    const cards = this.all(
      `SELECT c.*, u.name AS issued_by_name FROM cards c LEFT JOIN users u ON u.id = c.issued_by
       WHERE c.member_id = ? ORDER BY c.status, c.issued_at DESC`, m.id,
    ).map((c) => this.cardDTO(c));
    const reservations = this.all(`${RES_SELECT} WHERE r.member_id = ? OR EXISTS (
      SELECT 1 FROM reservation_attendees ra WHERE ra.reservation_id = r.id AND ra.member_id = ?
    ) ORDER BY r.start_ms DESC LIMIT 100`, m.id, m.id)
      .map((r) => this.reservationDTO(r));
    const charges = this.all(`${CHARGE_SELECT} WHERE c.member_id = ? ORDER BY c.created_at DESC LIMIT 300`, m.id)
      .map((c) => this.chargeDTO(c));
    const payments = this.all(
      `SELECT p.*, mm.first_name, mm.last_name, mm.member_no, u.name AS created_by_name FROM payments p
       JOIN members mm ON mm.id = p.member_id LEFT JOIN users u ON u.id = p.created_by
       WHERE p.member_id = ? ORDER BY p.paid_at DESC LIMIT 100`, m.id,
    ).map((p) => this.paymentDTO(p));
    const { due } = this.get("SELECT COALESCE(SUM(amount), 0) AS due FROM charges WHERE member_id = ? AND status = 'due'", m.id);
    const subscription = this.subscriptionSummary(m.id, today);
    const cardsDeactivated = this.hasDeactivatedCardsOnly(m.id);
    return {
      ...this.memberBase(m),
      deactivated_by_name: m.deactivated_by ? (this.get('SELECT name FROM users WHERE id = ?', m.deactivated_by)?.name ?? null) : null,
      subscription,
      cards_deactivated: cardsDeactivated,
      can_enter_room: m.active !== 0 && !cardsDeactivated
        && ['active', 'expire_bientot'].includes(subscription.state)
        && (subscription.credit?.available ?? 0) > 0,
      subscriptions, cards, reservations, charges, payments, balance_due: due,
    };
  }

  // ---------------------------------------------------------------- subscriptions & credit

  currentSubscription(memberId, day) {
    return this.get(
      `SELECT * FROM subscriptions WHERE member_id = ? AND status = 'active' AND start_date <= ? AND end_date >= ?
       ORDER BY start_date DESC LIMIT 1`, memberId, day, day,
    );
  }

  allocatedMinutes(sub, day) {
    if (sub.allocation_mode !== 'mensuelle' || sub.duration_months <= 1) return sub.included_minutes;
    if (day < sub.start_date) return 0;
    const perMonth = Math.floor(sub.included_minutes / sub.duration_months);
    const months = Math.min(sub.duration_months, monthsElapsed(sub.start_date, day) + 1);
    return Math.min(sub.included_minutes, perMonth * months);
  }

  credit(sub, day) {
    const s = this.get(
      `SELECT
         COALESCE(SUM(CASE WHEN kind = 'engagement' THEN minutes ELSE 0 END), 0) AS eng,
         COALESCE(SUM(CASE WHEN kind = 'liberation' THEN minutes ELSE 0 END), 0) AS lib,
         COALESCE(SUM(CASE WHEN kind = 'consommation' THEN minutes ELSE 0 END), 0) AS cons,
         COALESCE(SUM(CASE WHEN kind = 'ajustement' THEN minutes ELSE 0 END), 0) AS adj
       FROM credit_movements WHERE subscription_id = ?`, sub.id,
    );
    const allocated = this.allocatedMinutes(sub, day);
    const granted = allocated + s.adj;
    const used = s.eng - s.lib;
    return {
      included: sub.included_minutes, allocated, adjustments: s.adj, granted,
      committed: used - s.cons, consumed: s.cons, available: Math.max(0, granted - used),
      allocation_mode: sub.allocation_mode,
    };
  }

  subscriptionDTO(s, today) {
    let state = 'active';
    if (s.status === 'annulee') state = 'annulee';
    else if (s.end_date < today) state = 'expiree';
    else if (s.start_date > today) state = 'a_venir';
    const asOf = today < s.start_date ? s.start_date : today > s.end_date ? s.end_date : today;
    return {
      id: s.id, member_id: s.member_id, plan_id: s.plan_id, plan_name: s.plan_name, duration_months: s.duration_months,
      start_date: s.start_date, end_date: s.end_date, included_minutes: s.included_minutes,
      allocation_mode: s.allocation_mode, price: s.price, price_validated: !!s.price_validated,
      status: s.status, state, renewal_of: s.renewal_of, created_at: s.created_at, created_by_name: s.created_by_name ?? null,
      cancel_reason: s.cancel_reason, credit: this.credit(s, asOf),
    };
  }

  subscriptionSummary(memberId, today) {
    const warn = this.settings().expiry_warning_days;
    const current = this.currentSubscription(memberId, today);
    if (current) {
      const daysLeft = daysBetween(today, current.end_date);
      return {
        state: daysLeft < warn ? 'expire_bientot' : 'active', id: current.id, plan_name: current.plan_name,
        start_date: current.start_date, end_date: current.end_date, days_left: daysLeft, credit: this.credit(current, today),
      };
    }
    const future = this.get(
      "SELECT * FROM subscriptions WHERE member_id = ? AND status = 'active' AND start_date > ? ORDER BY start_date LIMIT 1",
      memberId, today,
    );
    if (future) {
      return {
        state: 'a_venir', id: future.id, plan_name: future.plan_name, start_date: future.start_date,
        end_date: future.end_date, credit: this.credit(future, future.start_date),
      };
    }
    const last = this.get(
      "SELECT * FROM subscriptions WHERE member_id = ? AND status = 'active' AND end_date < ? ORDER BY end_date DESC LIMIT 1",
      memberId, today,
    );
    if (last) {
      return {
        state: 'expiree', id: last.id, plan_name: last.plan_name, start_date: last.start_date,
        end_date: last.end_date, days_since: daysBetween(last.end_date, today),
      };
    }
    return { state: 'aucun' };
  }

  activateSubscription(actor, memberId, input) {
    const m = this.memberRow(memberId);
    this.assertMemberActive(m, 'd’activer une formule');
    const plan = this.get('SELECT * FROM plans WHERE id = ?', toId(input.plan_id, 'Formule'));
    if (!plan || !plan.active) throw invalid('Formule invalide ou inactive.');
    const s = this.settings();
    const start = input.start_date || this.bizToday();
    if (!isValidDate(start)) throw invalid('Date de début invalide.');
    const end = addDays(addMonths(start, plan.duration_months), -1);
    const overlap = this.get(
      `SELECT * FROM subscriptions WHERE member_id = ? AND status = 'active' AND start_date <= ? AND end_date >= ?
       ORDER BY end_date DESC LIMIT 1`, m.id, end, start,
    );
    if (overlap) {
      const next = addDays(overlap.end_date, 1);
      throw conflict(
        'ABONNEMENT_EXISTANT',
        `Un abonnement (${overlap.plan_name}) couvre déjà cette période jusqu'au ${frDate(overlap.end_date)}. Renouvelez à partir du ${frDate(next)}.`,
        { next_start: next },
      );
    }
    if (plan.price == null && !s.demo_mode) {
      throw conflict('TARIF_NON_DEFINI', `Le prix de la formule « ${plan.name} » n'est pas défini : activation impossible tant qu'un administrateur n'a pas fixé le prix dans Paramètres.`);
    }
    if (plan.price != null && !plan.price_validated && !s.demo_mode) {
      throw conflict('TARIF_NON_VALIDE', `Le prix de la formule « ${plan.name} » n'a pas été validé par un administrateur.`);
    }
    const mode = plan.duration_months > 1 ? s.annual_allocation_mode : 'activation';
    const previous = this.get(
      "SELECT id FROM subscriptions WHERE member_id = ? AND status = 'active' AND end_date < ? ORDER BY end_date DESC LIMIT 1",
      m.id, start,
    );
    const id = this.insert(
      `INSERT INTO subscriptions (member_id, plan_id, plan_name, duration_months, start_date, end_date, included_minutes,
         allocation_mode, price, price_validated, status, renewal_of, created_at, created_by)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'active', ?, ?, ?)`,
      m.id, plan.id, plan.name, plan.duration_months, start, end, plan.included_minutes, mode,
      plan.price, plan.price_validated ? 1 : 0, previous?.id ?? null, this.nowIso(), actor.id,
    );
    // Ensure the member has an active card on subscription activation if they never had a card issued yet.
    if (!this.get('SELECT 1 AS x FROM cards WHERE member_id = ?', m.id)) {
      const code = this.generateCardCode('virtuelle');
      this.insert(
        'INSERT INTO cards (member_id, kind, code, status, issued_at, issued_by) VALUES (?, ?, ?, ?, ?, ?)',
        m.id, 'virtuelle', code, 'active', this.nowIso(), actor.id,
      );
    }
    let chargeId = null;
    if (plan.price > 0) {
      chargeId = this.insertCharge(actor, {
        account: s.subscription_revenue_account, kind: 'abonnement', member_id: m.id, subscription_id: id,
        label: `Abonnement ${plan.name} (${frDate(start)} → ${frDate(end)})`, quantity: 1, unit_price: plan.price,
        tariff_validated: plan.price_validated ? 1 : 0,
      });
    }
    this.audit(actor, previous ? 'abonnement.renouveler' : 'abonnement.activer', 'member', m.id, {
      subscription_id: id, formule: plan.name, debut: start, fin: end, prix: plan.price, prix_valide: !!plan.price_validated,
    });
    return { subscription_id: id, start_date: start, end_date: end, charge_id: chargeId, member: this.memberDetail(m.id) };
  }

  cancelSubscription(actor, subId, input) {
    const sub = this.get('SELECT * FROM subscriptions WHERE id = ?', toId(subId));
    if (!sub) throw notFound('Abonnement');
    if (sub.status === 'annulee') throw conflict('DEJA_ANNULE', 'Abonnement déjà annulé.');
    const reason = text(input.reason, 'Motif', { required: true, min: 3, max: 300 });
    const active = this.get(
      `SELECT COUNT(*) AS n FROM reservations r WHERE r.status IN ('reservee', 'en_cours')
       AND (r.subscription_id = ? OR EXISTS (
         SELECT 1 FROM reservation_attendees ra WHERE ra.reservation_id = r.id AND ra.subscription_id = ?
       ))`, sub.id, sub.id,
    );
    if (active.n > 0) {
      throw conflict('RESERVATIONS_ACTIVES', `Annulez ou terminez d'abord les ${active.n} réservation(s) rattachée(s) à cet abonnement.`);
    }
    for (const c of this.all("SELECT * FROM charges WHERE subscription_id = ? AND status = 'due'", sub.id)) {
      this.voidCharge(actor, c, `Annulation de l'abonnement : ${reason}`);
    }
    this.run(
      "UPDATE subscriptions SET status = 'annulee', cancelled_at = ?, cancelled_by = ?, cancel_reason = ? WHERE id = ?",
      this.nowIso(), actor.id, reason, sub.id,
    );
    this.audit(actor, 'abonnement.annuler', 'member', sub.member_id, { subscription_id: sub.id, motif: reason });
    return this.memberDetail(sub.member_id);
  }

  adjustCredit(actor, subId, input) {
    const sub = this.get('SELECT * FROM subscriptions WHERE id = ?', toId(subId));
    if (!sub) throw notFound('Abonnement');
    if (sub.status !== 'active') throw conflict('ABONNEMENT_ANNULE', 'Abonnement annulé : ajustement impossible.');
    const minutes = int(input.minutes, 'Minutes', { min: -100000, max: 100000 });
    if (minutes === 0) throw invalid('Indiquez un nombre de minutes non nul.');
    const reason = text(input.reason, 'Motif', { required: true, min: 3, max: 300 });
    const credit = this.credit(sub, this.bizToday() > sub.end_date ? sub.end_date : this.bizToday());
    if (minutes < 0 && -minutes > credit.available) {
      throw conflict('CREDIT_INSUFFISANT', `Retrait impossible : seulement ${fmtDuration(credit.available)} disponibles.`);
    }
    this.creditMove(actor, sub.id, null, 'ajustement', minutes, reason);
    this.audit(actor, 'credit.ajuster', 'member', sub.member_id, { subscription_id: sub.id, minutes, motif: reason });
    return this.memberDetail(sub.member_id);
  }

  creditMove(actor, subId, reservationId, kind, minutes, reason) {
    if (!minutes) return;
    this.run(
      'INSERT INTO credit_movements (subscription_id, reservation_id, kind, minutes, reason, created_at, created_by) VALUES (?, ?, ?, ?, ?, ?, ?)',
      subId, reservationId, kind, minutes, reason ?? null, this.nowIso(), actor?.id ?? null,
    );
  }

  committedFor(reservationId, subscriptionId = null) {
    if (subscriptionId != null) {
      const s = this.get(
        `SELECT
           COALESCE(SUM(CASE WHEN kind = 'engagement' THEN minutes ELSE 0 END), 0)
           - COALESCE(SUM(CASE WHEN kind = 'liberation' THEN minutes ELSE 0 END), 0)
           - COALESCE(SUM(CASE WHEN kind = 'consommation' THEN minutes ELSE 0 END), 0) AS open
         FROM credit_movements WHERE reservation_id = ? AND subscription_id = ?`,
        reservationId, subscriptionId,
      );
      return s.open;
    }
    const s = this.get(
      `SELECT
         COALESCE(SUM(CASE WHEN kind = 'engagement' THEN minutes ELSE 0 END), 0)
         - COALESCE(SUM(CASE WHEN kind = 'liberation' THEN minutes ELSE 0 END), 0)
         - COALESCE(SUM(CASE WHEN kind = 'consommation' THEN minutes ELSE 0 END), 0) AS open
       FROM credit_movements WHERE reservation_id = ?`, reservationId,
    );
    return s.open;
  }

  // ---------------------------------------------------------------- cards

  cardDTO(c) {
    return {
      id: c.id, member_id: c.member_id, kind: c.kind, code: c.code, status: c.status, issued_at: c.issued_at,
      issued_by_name: c.issued_by_name ?? null, deactivated_at: c.deactivated_at, deactivation_reason: c.deactivation_reason,
    };
  }

  generateCardCode(kind) {
    const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    const pick = (n) => [...crypto.getRandomValues(new Uint8Array(n))].map((b) => alphabet[b % alphabet.length]).join('');
    for (let i = 0; i < 20; i += 1) {
      const code = kind === 'virtuelle' ? `CV-${pick(4)}-${pick(4)}` : `CP-${pick(6)}`;
      if (!this.get('SELECT 1 AS x FROM cards WHERE code = ?', code)) return code;
    }
    throw new Error('Impossible de générer un code de carte unique.');
  }

  issueCard(actor, memberId, input) {
    const m = this.memberRow(memberId);
    this.assertMemberActive(m, 'd’émettre une carte');
    const kind = input.kind;
    if (!['physique', 'virtuelle'].includes(kind)) throw invalid('Type de carte invalide.');
    let code = text(input.code, 'Numéro de carte', { max: 40 });
    if (code) {
      code = code.toUpperCase();
      if (!/^[A-Z0-9-]{4,40}$/.test(code)) throw invalid('Numéro de carte : lettres, chiffres et tirets (4 caractères minimum).');
      if (this.get('SELECT 1 AS x FROM cards WHERE code = ?', code)) throw conflict('CODE_CARTE_PRIS', 'Ce numéro de carte est déjà attribué.');
    } else {
      code = this.generateCardCode(kind);
    }
    for (const old of this.all("SELECT * FROM cards WHERE member_id = ? AND kind = ? AND status = 'active'", m.id, kind)) {
      this.run(
        "UPDATE cards SET status = 'desactivee', deactivated_at = ?, deactivated_by = ?, deactivation_reason = ? WHERE id = ?",
        this.nowIso(), actor.id, `Remplacée par ${code}`, old.id,
      );
    }
    const id = this.insert(
      'INSERT INTO cards (member_id, kind, code, status, issued_at, issued_by) VALUES (?, ?, ?, ?, ?, ?)',
      m.id, kind, code, 'active', this.nowIso(), actor.id,
    );
    this.audit(actor, 'carte.emettre', 'member', m.id, { card_id: id, type: kind, code });
    return { card_id: id, member: this.memberDetail(m.id) };
  }

  deactivateCard(actor, cardId, input) {
    const c = this.get('SELECT * FROM cards WHERE id = ?', toId(cardId));
    if (!c) throw notFound('Carte');
    if (c.status !== 'active') throw conflict('DEJA_DESACTIVEE', 'Carte déjà désactivée.');
    const reason = text(input.reason, 'Motif', { required: true, min: 3, max: 200 });
    this.run(
      "UPDATE cards SET status = 'desactivee', deactivated_at = ?, deactivated_by = ?, deactivation_reason = ? WHERE id = ?",
      this.nowIso(), actor.id, reason, c.id,
    );
    this.audit(actor, 'carte.desactiver', 'member', c.member_id, { card_id: c.id, code: c.code, motif: reason });
    return this.memberDetail(c.member_id);
  }

  cardView(cardId) {
    const c = this.get('SELECT * FROM cards WHERE id = ?', toId(cardId));
    if (!c) throw notFound('Carte');
    const m = this.memberRow(c.member_id);
    return {
      card: this.cardDTO(c), member: this.memberBase(m), subscription: this.subscriptionSummary(m.id, this.bizToday()),
      club_name: this.settings().club_name,
    };
  }

  lookupCard(code) {
    const c = this.get('SELECT * FROM cards WHERE code = ?', String(code ?? '').trim().toUpperCase());
    if (!c) throw notFound('Carte');
    return { card: this.cardDTO(c), member_id: c.member_id };
  }

  // ---------------------------------------------------------------- reservations

  verifyMemberRoomAccess(memberId, bizDay, { requireRemainingCredit = true } = {}) {
    const member = this.memberRow(memberId);
    const who = `${member.first_name} ${member.last_name}`;
    this.assertMemberActive(member, 'toute réservation ou entrée en salle');
    if (this.hasDeactivatedCardsOnly(member.id)) {
      throw conflict('CARTE_DESACTIVEE', `La carte de membre de ${who} est désactivée : émettez une carte active avant l'accès en salle.`);
    }
    const sub = this.currentSubscription(member.id, bizDay);
    if (!sub) {
      const last = this.get(
        "SELECT * FROM subscriptions WHERE member_id = ? AND status = 'active' AND end_date < ? ORDER BY end_date DESC LIMIT 1",
        member.id, bizDay,
      );
      throw conflict(
        'ABONNEMENT_INVALIDE',
        last
          ? `L'abonnement de ${who} a expiré le ${frDate(last.end_date)} : un renouvellement est nécessaire avant de réserver le ${frDate(bizDay)}.`
          : `${who} n'a pas d'abonnement valide le ${frDate(bizDay)}.`,
      );
    }
    const credit = this.credit(sub, bizDay);
    if (requireRemainingCredit && credit.available <= 0) {
      throw conflict(
        'CREDIT_EPUISE',
        `Accès refusé : il ne reste plus de crédit d'utilisation sur la carte de ${who} (0 min disponible).`,
      );
    }
    return { member, sub, credit };
  }

  attendeesFor(r) {
    const primaryCard = this.activeCardCode(r.member_id);
    const list = [{
      member_id: r.member_id,
      name: `${r.first_name} ${r.last_name}`,
      member_no: r.member_no,
      card_code: primaryCard,
      subscription_id: r.subscription_id,
      included_minutes: r.included_minutes,
      is_primary: true,
    }];
    const extras = this.all(
      `SELECT ra.*, m.first_name, m.last_name, m.member_no
       FROM reservation_attendees ra
       JOIN members m ON m.id = ra.member_id
       WHERE ra.reservation_id = ?
       ORDER BY ra.id`,
      r.id,
    );
    for (const ex of extras) {
      list.push({
        member_id: ex.member_id,
        name: `${ex.first_name} ${ex.last_name}`,
        member_no: ex.member_no,
        card_code: this.activeCardCode(ex.member_id),
        subscription_id: ex.subscription_id,
        included_minutes: ex.included_minutes,
        is_primary: false,
      });
    }
    return list;
  }

  reservationRow(id) {
    const r = this.get(`${RES_SELECT} WHERE r.id = ?`, toId(id, 'Réservation'));
    if (!r) throw notFound('Réservation');
    return r;
  }

  reservationDTO(r) {
    const tz = this.settings().timezone;
    const s = localParts(r.start_ms, tz);
    const e = localParts(r.end_ms, tz);
    const attendees = this.attendeesFor(r);
    return {
      id: r.id, member_id: r.member_id, member_name: `${r.first_name} ${r.last_name}`, member_no: r.member_no,
      is_demo: !!r.is_demo, subscription_id: r.subscription_id, biz_day: r.biz_day,
      room_id: r.room_id ?? 1, room_name: r.room_name ?? 'Salon Principal', room_capacity: r.room_capacity ?? 8,
      party_size: Math.max(r.party_size ?? 1, attendees.length),
      attendees,
      items_summary: r.items_summary ?? null,
      start_at: new Date(r.start_ms).toISOString(), end_at: new Date(r.end_ms).toISOString(),
      start_ms: r.start_ms, end_ms: r.end_ms,
      start_date: s.date, start_time: s.time, end_date: e.date, end_time: e.time,
      duration_min: r.duration_min, status: r.status, status_label: RES_STATUS[r.status],
      included_minutes: r.included_minutes, paid_minutes: r.paid_minutes, supplement_amount: r.supplement_amount,
      tariff: { hour: r.tariff_hour, half: r.tariff_half, validated: !!r.tariff_validated },
      off_hours: !!r.off_hours, off_hours_authorized_by_name: r.off_hours_authorized_by_name ?? null,
      // Bookings of 3 hours or more: deposit taken, and cancellable only until midnight before the day.
      deposit_amount: r.deposit_amount ?? 0,
      cancellable_until: r.duration_min >= DEPOSIT_FROM ? new Date(localToUtcMs(r.biz_day, '00:00', tz)).toISOString() : null,
      late_cancellation: this.isLateForCancellation(r),
      notes: r.notes, created_at: r.created_at, created_by_name: r.created_by_name ?? null,
      started_at: r.started_at, finished_at: r.finished_at, cancelled_at: r.cancelled_at, cancel_reason: r.cancel_reason,
      due_amount: r.due_amount ?? 0, billed_amount: r.billed_amount ?? 0,
    };
  }

  overlapping(startMs, endMs, excludeId, roomId = null) {
    if (roomId != null) {
      return this.all(
        `${RES_SELECT} WHERE r.status <> 'annulee' AND COALESCE(r.room_id, 1) = ? AND r.start_ms < ? AND r.end_ms > ? AND r.id <> ? ORDER BY r.start_ms`,
        roomId, endMs, startMs, excludeId ?? 0,
      ).map((r) => this.reservationDTO(r));
    }
    return this.all(
      `${RES_SELECT} WHERE r.status <> 'annulee' AND r.start_ms < ? AND r.end_ms > ? AND r.id <> ? ORDER BY r.start_ms`,
      endMs, startMs, excludeId ?? 0,
    ).map((r) => this.reservationDTO(r));
  }

  overlapError(conflicts, roomName = null) {
    const c = conflicts[0];
    const who = c ? ` par ${c.member_name} (${c.start_time} → ${c.end_time})` : '';
    const rName = roomName ?? c?.room_name;
    const prefix = rName ? `La salle « ${rName} »` : 'La salle';
    return conflict('CHEVAUCHEMENT', `${prefix} est déjà réservée sur ce créneau${who}.`, { conflicts });
  }

  // The bookings of a room that [startMs, endMs) would sit too close to: they do not strictly overlap
  // it (that is `overlapping`, which takes priority) but begin less than `gap_min` minutes after it
  // ends or end less than `gap_min` minutes before it begins. A gap of exactly `gap_min` is enough.
  // Cancelled bookings do not count, and nothing is too close when the gap is 0.
  gapConflicts(startMs, endMs, excludeId, roomId) {
    const gapMs = this.settings().booking.gap_min * 60000;
    if (!gapMs) return [];
    return this.all(
      `${RES_SELECT} WHERE r.status <> 'annulee' AND COALESCE(r.room_id, 1) = ? AND r.id <> ?
         AND r.start_ms < ? AND r.end_ms > ? AND (r.start_ms >= ? OR r.end_ms <= ?) ORDER BY r.start_ms`,
      roomId, excludeId ?? 0, endMs + gapMs, startMs - gapMs, endMs, startMs,
    ).map((r) => this.reservationDTO(r));
  }

  // The refusal for a booking too close to another one of its room: like overlapError, it names the
  // neighbour and gives the nearest time that would do. That time falls on the slot grid, as a start
  // or an end must.
  //  - a new booking: [startMs, endMs) is its span; the closest booking before it and the closest one
  //    after it speak.
  //  - an extension: `startMs` is the end the booking has and `endMs` the end it asked for; only what
  //    follows speaks, and the latest end is a whole number of extension steps from the end it has. When
  //    not even one step fits, it says that no extension is possible instead of naming the end it has.
  //  - a move: `roomName` is the room it would go to; every booking too close is named.
  gapError(conflicts, { startMs, endMs, extension = false, roomName = null }) {
    const { gap_min: gap, slot_min: slot, extension_step_min: step } = this.settings().booking;
    const tz = this.settings().timezone;
    const time = (ms) => localParts(ms, tz).time;
    const lead = `Il faut ${durationInWords(gap)} entre deux réservations : `;
    const details = { conflicts };
    if (roomName) {
      const spans = conflicts.map((c) => `de ${c.start_time} à ${c.end_time}`);
      const list = spans.length > 1 ? `${spans.slice(0, -1).join(', ')} et ${spans.at(-1)}` : spans[0];
      return conflict('BATTEMENT', `${lead}la salle « ${roomName} » a ${spans.length > 1 ? 'des réservations' : 'une réservation'} ${list}.`, details);
    }
    const gapMs = gap * 60000;
    const slotMs = slot * 60000;
    // Slots are counted from midnight in the club's time zone.
    const sinceSlot = (ms) => (localParts(ms, tz).minutes % slot) * 60000;
    const firstSlotFrom = (ms) => ms + ((slotMs - sinceSlot(ms)) % slotMs);
    const lastSlotUntil = (ms) => ms - sinceSlot(ms);
    const parts = [];
    const previous = conflicts.filter((c) => c.end_ms <= startMs).at(-1);
    if (previous) {
      parts.push(`la séance précédente se termine à ${time(previous.end_ms)}, celle-ci peut commencer à ${time(firstSlotFrom(previous.end_ms + gapMs))} au plus tôt`);
    }
    const next = conflicts.find((c) => c.start_ms >= endMs);
    if (next && extension) {
      const stepMs = step * 60000;
      const latest = startMs + Math.floor(Math.max(next.start_ms - gapMs - startMs, 0) / stepMs) * stepMs;
      parts.push(latest > startMs
        ? `la séance suivante commence à ${time(next.start_ms)}, la prolongation peut aller jusqu'à ${time(latest)} au plus tard`
        : `la séance suivante commence à ${time(next.start_ms)}, aucune prolongation n'est possible`);
    } else if (next) {
      parts.push(`la séance suivante commence à ${time(next.start_ms)}, celle-ci doit se terminer à ${time(lastSlotUntil(next.start_ms - gapMs))} au plus tard`);
    }
    return conflict('BATTEMENT', `${lead}${parts.join(' ; ')}.`, details);
  }

  ensureMembersAvailable(memberIds, startMs, endMs, excludeId = null) {
    const ids = [...new Set(memberIds)];
    const placeholders = ids.map(() => '?').join(',');
    const conflicts = this.all(
      `${RES_SELECT} WHERE r.status <> 'annulee' AND r.start_ms < ? AND r.end_ms > ? AND r.id <> ?
       AND (r.member_id IN (${placeholders}) OR EXISTS (
         SELECT 1 FROM reservation_attendees ra WHERE ra.reservation_id = r.id AND ra.member_id IN (${placeholders})
       )) ORDER BY r.start_ms`,
      endMs, startMs, excludeId ?? 0, ...ids, ...ids,
    ).map((r) => this.reservationDTO(r));
    if (!conflicts.length) return;
    const first = conflicts[0];
    const attendee = first.attendees.find((a) => ids.includes(a.member_id));
    throw conflict(
      'MEMBRE_OCCUPE',
      `${attendee.name} participe déjà à une réservation dans « ${first.room_name} » (${first.start_time} → ${first.end_time}).`,
      { conflicts, member_name: attendee.name },
    );
  }

  validateOccupancy(room, partySize, attendeeCount) {
    if (partySize < attendeeCount) {
      throw conflict('EFFECTIF_INVALIDE', `L’effectif doit inclure les ${attendeeCount} membres inscrits à cette réservation.`);
    }
    if (partySize > room.capacity) {
      throw conflict('CAPACITE_DEPASSEE', `La salle « ${room.name} » est limitée à ${room.capacity} personnes.`);
    }
  }

  // Validates a request and computes credit use and supplement, without writing anything.
  // `date` is the business day; a start time before the day starts means the following night.
  // The room can be booked at any hour: there are no opening hours.
  planReservation(input) {
    const s = this.settings();
    const win = this.window();
    const member = this.memberRow(input.member_id);
    const room = this.resolveRoom(input.room_id);
    if (!isValidDate(input.date)) throw invalid('Date invalide.');
    const startMin = parseHHMM(input.start_time);
    if (startMin == null || startMin >= 1440) throw invalid('Heure de début invalide.');
    const duration = int(input.duration_min, 'Durée', { min: 1, max: 1440 });
    const slot = s.booking.slot_min;
    const calendarDate = startMin < win.open ? addDays(input.date, 1) : input.date;
    // Friday and Saturday from 18:00 (the night included), a booking has the weekend minimum.
    const startRel = startMin < win.open ? startMin + 1440 : startMin;
    const minDuration = minDurationFor(s.booking, input.date, startRel);
    if (duration < minDuration) {
      throw invalid(isWeekend(input.date, startRel)
        ? `Le vendredi et le samedi à partir de 18 h, une réservation dure au moins ${fmtDuration(minDuration)}.`
        : `Durée minimale d'une réservation : ${fmtDuration(minDuration)}.`, 'DUREE_MINIMALE');
    }
    if (duration % slot) throw invalid(`La durée doit être un multiple de ${slot} minutes.`, 'CRENEAU');
    if (startMin % slot) throw invalid(`Le début doit tomber sur un créneau de ${slot} minutes.`, 'CRENEAU');
    const startMs = localToUtcMs(calendarDate, input.start_time, s.timezone);
    const endMs = startMs + duration * 60000;
    const place = placeInWindow(startMs, endMs, s.timezone, win);
    const { sub, credit } = this.verifyMemberRoomAccess(member.id, place.bizDay, {
      requireRemainingCredit: flag(input.require_credit),
    });

    if (input.attendee_ids !== undefined && (!Array.isArray(input.attendee_ids) || input.attendee_ids.length > 200)) {
      throw invalid('Liste de membres accompagnants invalide.');
    }
    const rawAttendees = input.attendee_ids ?? [];
    const seenIds = new Set([member.id]);
    const extraAttendees = [];
    for (const rawId of rawAttendees) {
      const mId = toId(rawId, 'Membre accompagnant');
      if (seenIds.has(mId)) continue;
      seenIds.add(mId);
      const att = this.verifyMemberRoomAccess(mId, place.bizDay, { requireRemainingCredit: true });
      extraAttendees.push({
        member: att.member,
        sub: att.sub,
        credit: att.credit,
        included: Math.min(att.credit.available, duration),
      });
    }

    const partySize = input.party_size === undefined || input.party_size === '' || input.party_size === null
      ? 1 + extraAttendees.length
      : int(input.party_size, 'Nombre de personnes', { min: 1, max: 200 });
    this.validateOccupancy(room, partySize, 1 + extraAttendees.length);

    const included = Math.min(credit.available, duration);
    const paid = duration - included;
    const tariff = s.overtime_tariff;
    const allOverlaps = this.overlapping(startMs, endMs, null);
    const conflicts = allOverlaps.filter((r) => r.room_id === room.id);
    if (!conflicts.length) this.ensureMembersAvailable([...seenIds], startMs, endMs);
    const busyRoomIds = new Set(allOverlaps.map((r) => r.room_id));
    // A room is also refused when a booking of its own sits too close; a strict overlap comes first, so
    // a busy room reports its overlap alone.
    const tooClose = (roomId) => (busyRoomIds.has(roomId) ? [] : this.gapConflicts(startMs, endMs, null, roomId));
    const roomsAvailability = this.rooms().map((rm) => {
      const near = tooClose(rm.id);
      return {
        ...rm,
        available: !busyRoomIds.has(rm.id) && !near.length,
        conflict: allOverlaps.find((r) => r.room_id === rm.id) ?? null,
        gap_conflict: near[0] ?? null,
      };
    });
    return {
      member, sub, room, partySize, extraAttendees, credit, startMs, endMs, duration, place, included, paid,
      supplement: supplementAmount(paid, tariff), tariff,
      conflicts,
      gap_conflicts: tooClose(room.id),
      rooms_availability: roomsAvailability,
    };
  }

  quoteReservation(actor, input) {
    const p = this.planReservation(input);
    const s = this.settings();
    const tz = s.timezone;
    return {
      member: { id: p.member.id, name: `${p.member.first_name} ${p.member.last_name}`, member_no: p.member.member_no },
      subscription: { id: p.sub.id, plan_name: p.sub.plan_name, end_date: p.sub.end_date },
      room: this.roomDTO(p.room),
      party_size: p.partySize,
      extra_attendees: p.extraAttendees.map((a) => ({
        id: a.member.id,
        name: `${a.member.first_name} ${a.member.last_name}`,
        member_no: a.member.member_no,
        included_minutes: a.included,
        credit_available: a.credit.available,
      })),
      rooms_availability: p.rooms_availability,
      biz_day: p.place.bizDay,
      start_at: new Date(p.startMs).toISOString(), end_at: new Date(p.endMs).toISOString(),
      start_time: localParts(p.startMs, tz).time, end_time: localParts(p.endMs, tz).time,
      end_next_day: p.place.endRel > 1440,
      duration_min: p.duration,
      credit_before: p.credit, included_minutes: p.included, paid_minutes: p.paid,
      credit_after: p.credit.available - p.included,
      supplement_amount: p.supplement, supplement_detail: supplementDetail(p.paid),
      tariff: { hour: p.tariff.hour, half: p.tariff.half, validated: !!p.tariff.validated },
      tariff_blocked: p.paid > 0 && !p.tariff.validated && !s.demo_mode,
      deposit_amount: depositFor(p.duration, p.supplement),
      balance_amount: p.supplement - depositFor(p.duration, p.supplement),
      conflicts: p.conflicts,
      gap_conflicts: p.gap_conflicts,
      // The sentence createReservation refuses with (the nearest time that would do included), to show before
      // sending: the browser words nothing itself.
      gap_message: p.gap_conflicts.length ? this.gapError(p.gap_conflicts, { startMs: p.startMs, endMs: p.endMs }).message : null,
    };
  }

  createReservation(actor, input) {
    const p = this.planReservation(input);
    const s = this.settings();
    if (p.conflicts.length) throw this.overlapError(p.conflicts, p.room.name);
    if (p.gap_conflicts.length) throw this.gapError(p.gap_conflicts, { startMs: p.startMs, endMs: p.endMs });
    if (p.paid > 0 && !p.tariff.validated && !s.demo_mode) {
      throw conflict('TARIF_NON_VALIDE', "Le tarif des heures supplémentaires n'a pas été validé par un administrateur.");
    }
    // 3 hours or more with paid time: half of it is taken now, or the booking is not recorded.
    const deposit = depositFor(p.duration, p.supplement);
    const depositMethod = deposit ? text(input.deposit_method, "Moyen de paiement de l'acompte", { max: 40 }) : null;
    if (deposit && !depositMethod) {
      throw invalid(
        `Une réservation de 3 h ou plus se confirme par un acompte de ${this.money(deposit)} (50 % du temps payant), à encaisser maintenant.`,
        'ACOMPTE_REQUIS',
      );
    }
    if (depositMethod && !s.payment_methods.includes(depositMethod)) throw invalid('Moyen de paiement non configuré.');
    const notes = text(input.notes, 'Remarque', { max: 300 });
    const startNow = flag(input.start_now);
    const initialStatus = startNow ? 'en_cours' : 'reservee';
    const startedAt = startNow ? this.nowIso() : null;
    const startedBy = startNow ? actor.id : null;
    let id;
    try {
      id = this.insert(
        `INSERT INTO reservations (member_id, subscription_id, room_id, party_size, biz_day, start_ms, end_ms, duration_min, status,
           included_minutes, paid_minutes, supplement_amount, tariff_hour, tariff_half, tariff_validated, deposit_amount,
           notes, created_at, created_by, started_at, started_by)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        p.member.id, p.sub.id, p.room.id, p.partySize, p.place.bizDay, p.startMs, p.endMs, p.duration, initialStatus,
        p.included, p.paid, p.supplement, p.tariff.hour, p.tariff.half, p.tariff.validated ? 1 : 0, deposit,
        notes, this.nowIso(), actor.id, startedAt, startedBy,
      );
    } catch (err) {
      if (String(err.message).includes('CHEVAUCHEMENT')) throw this.overlapError(this.overlapping(p.startMs, p.endMs, null, p.room.id), p.room.name);
      throw err;
    }
    this.creditMove(actor, p.sub.id, id, 'engagement', p.included, 'Réservation confirmée');
    for (const att of p.extraAttendees) {
      this.insert(
        'INSERT INTO reservation_attendees (reservation_id, member_id, subscription_id, included_minutes, created_at, created_by) VALUES (?, ?, ?, ?, ?, ?)',
        id, att.member.id, att.sub.id, att.included, this.nowIso(), actor.id,
      );
      this.creditMove(actor, att.sub.id, id, 'engagement', att.included, `Présence en salle (${p.room.name})`);
    }
    // Paid time is one line, or two when a deposit is due: the deposit (paid now) and the balance
    // (paid before entering the room, or now as well when the member goes straight in).
    const paidNow = [];
    if (p.supplement > 0) {
      const line = {
        account: 'reservations', kind: 'temps_supplementaire', member_id: p.member.id, reservation_id: id,
        quantity: 1, tariff_validated: p.tariff.validated ? 1 : 0,
      };
      if (deposit) {
        paidNow.push(this.insertCharge(actor, { ...line, label: `Acompte 50 % — temps supplémentaire (${fmtDuration(p.paid)})`, unit_price: deposit, deposit: 1 }));
        const balanceId = this.insertCharge(actor, { ...line, label: `Solde 50 % — temps supplémentaire (${fmtDuration(p.paid)})`, unit_price: p.supplement - deposit });
        if (startNow) paidNow.push(balanceId);
      } else {
        this.insertCharge(actor, { ...line, label: `Temps supplémentaire (${fmtDuration(p.paid)})`, unit_price: p.supplement });
      }
    }
    this.audit(actor, 'reservation.creer', 'reservation', id, {
      membre: `${p.member.first_name} ${p.member.last_name}`, salle: p.room.name, personnes: p.partySize,
      accompagnants: p.extraAttendees.map((a) => `${a.member.first_name} ${a.member.last_name}`),
      debut: new Date(p.startMs).toISOString(), duree: p.duration,
      minutes_incluses: p.included, minutes_payantes: p.paid, supplement: p.supplement, acompte: deposit,
    });
    if (paidNow.length) this.recordPayment(actor, { charge_ids: paidNow, method: depositMethod, reference: input.deposit_reference });
    return this.reservationDetail(id);
  }

  addReservationAttendee(actor, id, input) {
    const r = this.reservationRow(id);
    if (!['reservee', 'en_cours'].includes(r.status)) {
      throw conflict('STATUT', 'Impossible d’ajouter un membre sur une séance terminée ou annulée.');
    }
    const room = this.resolveRoom(r.room_id);
    const { member, sub, credit } = this.verifyMemberRoomAccess(input.member_id, r.biz_day, { requireRemainingCredit: true });
    const who = `${member.first_name} ${member.last_name}`;
    if (member.id === r.member_id || this.get('SELECT 1 AS x FROM reservation_attendees WHERE reservation_id = ? AND member_id = ?', r.id, member.id)) {
      throw conflict('DEJA_PRESENT', `${who} est déjà enregistré(e) dans cette salle.`);
    }
    const { n } = this.get('SELECT COUNT(*) AS n FROM reservation_attendees WHERE reservation_id = ?', r.id);
    const newCount = Math.max(r.party_size, 1 + n) + 1;
    this.validateOccupancy(room, newCount, 2 + n);
    this.ensureMembersAvailable([member.id], r.start_ms, r.end_ms, r.id);
    const included = Math.min(credit.available, r.duration_min);
    this.insert(
      'INSERT INTO reservation_attendees (reservation_id, member_id, subscription_id, included_minutes, created_at, created_by) VALUES (?, ?, ?, ?, ?, ?)',
      r.id, member.id, sub.id, included, this.nowIso(), actor.id,
    );
    this.creditMove(actor, sub.id, r.id, 'engagement', included, `Présence en salle (${room.name})`);
    this.run('UPDATE reservations SET party_size = ?, updated_at = ?, updated_by = ? WHERE id = ?', newCount, this.nowIso(), actor.id, r.id);
    this.audit(actor, 'reservation.ajouter_membre', 'reservation', r.id, {
      membre: who, member_no: member.member_no, minutes_engagees: included,
    });
    return this.reservationDetail(r.id);
  }

  removeReservationAttendee(actor, id, memberId) {
    const r = this.reservationRow(id);
    if (!['reservee', 'en_cours'].includes(r.status)) {
      throw conflict('STATUT', 'Impossible de retirer un membre sur une séance terminée ou annulée.');
    }
    const mId = toId(memberId, 'Membre');
    if (mId === r.member_id) {
      throw conflict('TITULAIRE', 'Le membre titulaire de la réservation ne peut pas être retiré sans annuler ou libérer la salle.');
    }
    const row = this.get('SELECT * FROM reservation_attendees WHERE reservation_id = ? AND member_id = ?', r.id, mId);
    if (!row) throw notFound('Membre présent');
    const open = this.committedFor(r.id, row.subscription_id);
    if (open > 0) {
      this.creditMove(actor, row.subscription_id, r.id, 'liberation', open, 'Retrait de la salle');
    }
    this.run('DELETE FROM reservation_attendees WHERE id = ?', row.id);
    const { n } = this.get('SELECT COUNT(*) AS n FROM reservation_attendees WHERE reservation_id = ?', r.id);
    this.run('UPDATE reservations SET party_size = ?, updated_at = ?, updated_by = ? WHERE id = ?', Math.max(r.party_size - 1, 1 + n), this.nowIso(), actor.id, r.id);
    this.audit(actor, 'reservation.retirer_membre', 'reservation', r.id, { member_id: mId, minutes_liberees: open });
    return this.reservationDetail(r.id);
  }

  updateReservationOccupancy(actor, id, input) {
    const r = this.reservationRow(id);
    if (!['reservee', 'en_cours'].includes(r.status)) throw conflict('STATUT', 'Impossible de modifier une réservation terminée ou annulée.');
    const partySize = input.party_size !== undefined
      ? int(input.party_size, 'Nombre de personnes', { min: 1, max: 200 })
      : (r.party_size ?? 1);
    const room = input.room_id !== undefined ? this.resolveRoom(input.room_id) : this.resolveRoom(r.room_id);
    this.validateOccupancy(room, partySize, this.attendeesFor(r).length);
    if (room.id !== (r.room_id ?? 1) && ['reservee', 'en_cours'].includes(r.status)) {
      const conflicts = this.overlapping(r.start_ms, r.end_ms, r.id, room.id);
      if (conflicts.length) throw this.overlapError(conflicts, room.name);
      const tooClose = this.gapConflicts(r.start_ms, r.end_ms, r.id, room.id);
      if (tooClose.length) throw this.gapError(tooClose, { startMs: r.start_ms, endMs: r.end_ms, roomName: room.name });
    }
    this.run(
      'UPDATE reservations SET party_size = ?, room_id = ?, updated_at = ?, updated_by = ? WHERE id = ?',
      partySize, room.id, this.nowIso(), actor.id, r.id,
    );
    this.audit(actor, 'reservation.modifier', 'reservation', r.id, {
      salle: room.name, personnes: partySize,
    });
    return this.reservationDetail(r.id);
  }

  planExtension(id, minutes) {
    const r = this.reservationRow(id);
    if (!['reservee', 'en_cours'].includes(r.status)) {
      throw conflict('STATUT', `Impossible de prolonger une réservation au statut « ${RES_STATUS[r.status]} ».`);
    }
    const s = this.settings();
    const win = this.window();
    const step = s.booking.extension_step_min;
    const add = int(minutes, 'Prolongation', { min: 1, max: 1440 });
    if (add % step) throw invalid(`Prolongation par tranches de ${step} minutes.`, 'CRENEAU');
    if (r.duration_min + add > 1440) throw invalid('Une séance ne peut pas dépasser 24 heures.', 'DUREE_MAXIMALE');
    const newEnd = r.end_ms + add * 60000;
    const place = placeInWindow(r.start_ms, newEnd, s.timezone, win);
    const sub = this.get('SELECT * FROM subscriptions WHERE id = ?', r.subscription_id);
    const credit = this.credit(sub, r.biz_day);
    const addIncluded = sub.status === 'active' ? Math.min(credit.available, add) : 0;
    const addPaid = add - addIncluded;
    // Confirmed services keep the tariff they were booked with.
    const tariff = { hour: r.tariff_hour, half: r.tariff_half, validated: !!r.tariff_validated };
    const newPaid = r.paid_minutes + addPaid;
    const newSupplement = supplementAmount(newPaid, tariff);
    const conflicts = this.overlapping(r.end_ms, newEnd, r.id, r.room_id ?? 1);
    if (!conflicts.length) this.ensureMembersAvailable(this.attendeesFor(r).map((a) => a.member_id), r.end_ms, newEnd, r.id);
    // Only the bookings after this one can be too close: ending later does not bring it closer to the ones
    // before it, which may already be as close as the gap allows (or closer, if the gap has grown since).
    const tooClose = conflicts.length ? [] : this.gapConflicts(r.end_ms, newEnd, r.id, r.room_id ?? 1).filter((o) => o.start_ms >= r.end_ms);
    return {
      r, add, newEnd, place, credit, addIncluded, addPaid, newPaid, newSupplement,
      delta: newSupplement - r.supplement_amount, tariff,
      conflicts,
      gap_conflicts: tooClose,
    };
  }

  quoteExtension(actor, id, input) {
    const p = this.planExtension(id, input.minutes);
    const s = this.settings();
    return {
      reservation_id: p.r.id, minutes: p.add,
      new_end_at: new Date(p.newEnd).toISOString(), new_end_time: localParts(p.newEnd, s.timezone).time,
      end_next_day: p.place.endRel > 1440,
      credit_available: p.credit.available, included_minutes: p.addIncluded, paid_minutes: p.addPaid,
      total_paid_minutes: p.newPaid, supplement_before: p.r.supplement_amount, supplement_after: p.newSupplement,
      supplement_delta: p.delta, tariff: p.tariff,
      tariff_blocked: p.addPaid > 0 && !p.tariff.validated && !s.demo_mode,
      conflicts: p.conflicts,
      gap_conflicts: p.gap_conflicts,
      // The sentence extendReservation refuses with: how far the extension could go, or that none can. A plan has
      // gap conflicts only when nothing overlaps, so the refusal it gets from extensionRefusal is the gap one.
      gap_message: p.gap_conflicts.length ? this.extensionRefusal(p).message : null,
    };
  }

  // Why a planned extension cannot go ahead, as the error to raise, or null when it can: the room is taken,
  // the next booking would be too close, or the time beyond the credit has no tariff an administrator has
  // validated to be billed at (the demo bills it all the same). extendReservation raises it and
  // extensionWindow words it, so what the window calls possible is what the server accepts.
  extensionRefusal(p) {
    if (p.conflicts.length) return this.overlapError(p.conflicts, p.r.room_name);
    if (p.gap_conflicts.length) return this.gapError(p.gap_conflicts, { startMs: p.r.end_ms, endMs: p.newEnd, extension: true });
    if (p.addPaid > 0 && !p.tariff.validated && !this.settings().demo_mode) {
      return conflict('TARIF_NON_VALIDE', "Le tarif des heures supplémentaires de cette réservation n'a pas été validé.");
    }
    return null;
  }

  extendReservation(actor, id, input) {
    const p = this.planExtension(id, input.minutes);
    const refusal = this.extensionRefusal(p);
    if (refusal) throw refusal;
    try {
      this.run(
        `UPDATE reservations SET end_ms = ?, duration_min = duration_min + ?, included_minutes = included_minutes + ?,
           paid_minutes = ?, supplement_amount = ?, updated_at = ?, updated_by = ?
         WHERE id = ?`,
        p.newEnd, p.add, p.addIncluded, p.newPaid, p.newSupplement,
        this.nowIso(), actor.id, p.r.id,
      );
    } catch (err) {
      if (String(err.message).includes('CHEVAUCHEMENT')) throw this.overlapError(this.overlapping(p.r.end_ms, p.newEnd, p.r.id, p.r.room_id ?? 1), p.r.room_name);
      throw err;
    }
    this.creditMove(actor, p.r.subscription_id, p.r.id, 'engagement', p.addIncluded, `Prolongation +${fmtDuration(p.add)}`);
    for (const att of this.all('SELECT * FROM reservation_attendees WHERE reservation_id = ?', p.r.id)) {
      const attSub = this.get('SELECT * FROM subscriptions WHERE id = ?', att.subscription_id);
      if (attSub && attSub.status === 'active') {
        const attCredit = this.credit(attSub, p.r.biz_day);
        const attAdd = Math.min(attCredit.available, p.add);
        if (attAdd > 0) {
          this.run('UPDATE reservation_attendees SET included_minutes = included_minutes + ? WHERE id = ?', attAdd, att.id);
          this.creditMove(actor, att.subscription_id, p.r.id, 'engagement', attAdd, `Prolongation +${fmtDuration(p.add)} (présence en salle)`);
        }
      }
    }
    if (p.delta > 0) {
      this.insertCharge(actor, {
        account: 'reservations', kind: 'temps_supplementaire', member_id: p.r.member_id, reservation_id: p.r.id,
        label: `Prolongation +${fmtDuration(p.add)} (temps supplémentaire)`, quantity: 1, unit_price: p.delta,
        tariff_validated: p.tariff.validated ? 1 : 0,
      });
    }
    this.audit(actor, 'reservation.prolonger', 'reservation', p.r.id, {
      minutes: p.add, ancienne_fin: new Date(p.r.end_ms).toISOString(), nouvelle_fin: new Date(p.newEnd).toISOString(),
      minutes_incluses: p.addIncluded, minutes_payantes: p.addPaid, supplement_ajoute: p.delta,
    });
    return this.reservationDetail(p.r.id);
  }

  // How far a session can still be extended, for the alert shown shortly before it ends: the longest
  // extension the server would accept, or, when not even the shortest is accepted, why. Lengths are whole
  // extension steps, each one tried through planExtension and extensionRefusal (what extendReservation runs),
  // so the window cannot say "possible" for an extension the server refuses. A refusal only ever grows with
  // the length (a longer extension takes more of the room and of each member's time, comes closer to the next
  // booking, goes further beyond the credit and nearer to the 24-hour limit), so the first length refused ends
  // the search. `next` is the next booking of the room, whatever stops the extension.
  extensionWindow(id) {
    const r = this.reservationRow(id);
    const { timezone: tz, booking: { extension_step_min: step } } = this.settings();
    let best = null;
    let refusal = null;
    for (let add = step; add <= 1440; add += step) {
      let p;
      try {
        p = this.planExtension(r.id, add);
      } catch (err) {
        if (!(err instanceof AppError)) throw err;
        refusal = err;
        break;
      }
      refusal = this.extensionRefusal(p);
      if (refusal) break;
      best = p;
    }
    // A booking neither waiting nor running has nothing to extend, and nothing to say about it.
    if (refusal?.code === 'STATUT') {
      return { possible: false, max_minutes: 0, until_time: null, until_at: null, reason: null, next: null };
    }
    const next = this.get(
      `${RES_SELECT} WHERE r.status <> 'annulee' AND COALESCE(r.room_id, 1) = ? AND r.start_ms >= ? AND r.id <> ?
       ORDER BY r.start_ms LIMIT 1`,
      r.room_id ?? 1, r.end_ms, r.id,
    );
    return {
      possible: best !== null,
      max_minutes: best?.add ?? 0,
      until_time: best ? localParts(best.newEnd, tz).time : null,
      until_at: best ? new Date(best.newEnd).toISOString() : null,
      reason: best ? null : this.extensionReason(refusal),
      next: next ? { member_name: `${next.first_name} ${next.last_name}`, start_time: localParts(next.start_ms, tz).time } : null,
    };
  }

  // The refusal of the shortest extension, in the words of the alert. A refusal this does not know keeps
  // its own message, so that a rule added to extendReservation is never hidden.
  extensionReason(refusal) {
    const first = refusal.details?.conflicts?.[0];
    switch (refusal.code) {
      case 'CHEVAUCHEMENT':
      case 'BATTEMENT':
        return `Prolongation impossible : la séance suivante commence à ${first.start_time} (${first.member_name}).`;
      case 'MEMBRE_OCCUPE':
        return `Prolongation impossible : ${refusal.details.member_name} est déjà inscrit à une autre séance à ${first.start_time}.`;
      case 'TARIF_NON_VALIDE':
        return "Prolongation impossible : le tarif des heures supplémentaires n'est pas encore validé par un administrateur.";
      case 'DUREE_MAXIMALE':
        return 'Prolongation impossible : une séance ne peut pas dépasser 24 heures.';
      default:
        return `Prolongation impossible : ${refusal.message}`;
    }
  }

  startReservation(actor, id) {
    const r = this.reservationRow(id);
    if (r.status !== 'reservee') throw conflict('STATUT', `Seule une réservation « Réservée » peut démarrer (statut actuel : ${RES_STATUS[r.status]}).`);
    if (r.deposit_amount > 0) {
      // A booking secured by a deposit: its time is paid in full before entering the room.
      const { due } = this.get(
        "SELECT COALESCE(SUM(amount), 0) AS due FROM charges WHERE reservation_id = ? AND kind = 'temps_supplementaire' AND status = 'due'", r.id,
      );
      if (due > 0) throw conflict('SOLDE_REQUIS', `Le solde de ${this.money(due)} est à régler avant l'entrée en salle.`);
    }
    this.run(
      "UPDATE reservations SET status = 'en_cours', started_at = ?, started_by = ?, updated_at = ?, updated_by = ? WHERE id = ?",
      this.nowIso(), actor.id, this.nowIso(), actor.id, r.id,
    );
    this.audit(actor, 'reservation.demarrer', 'reservation', r.id, null);
    return this.reservationDetail(r.id);
  }

  finishReservation(actor, id) {
    const r = this.reservationRow(id);
    if (!['reservee', 'en_cours'].includes(r.status)) {
      throw conflict('STATUT', `Impossible de terminer une réservation au statut « ${RES_STATUS[r.status]} ».`);
    }
    const open = this.committedFor(r.id, r.subscription_id);
    this.creditMove(actor, r.subscription_id, r.id, 'consommation', open, 'Réservation terminée');
    for (const att of this.all('SELECT * FROM reservation_attendees WHERE reservation_id = ?', r.id)) {
      const attOpen = this.committedFor(r.id, att.subscription_id);
      this.creditMove(actor, att.subscription_id, r.id, 'consommation', attOpen, 'Réservation terminée (présence en salle)');
    }
    this.run(
      "UPDATE reservations SET status = 'terminee', finished_at = ?, finished_by = ?, updated_at = ?, updated_by = ? WHERE id = ?",
      this.nowIso(), actor.id, this.nowIso(), actor.id, r.id,
    );
    this.audit(actor, 'reservation.terminer', 'reservation', r.id, { minutes_consommees: open });
    return this.reservationDetail(r.id);
  }

  cancelReservation(actor, id, input) {
    const r = this.reservationRow(id);
    if (r.status !== 'reservee') {
      throw conflict('STATUT', r.status === 'en_cours'
        ? 'Une réservation en cours ne peut pas être annulée : terminez-la.'
        : `Impossible d'annuler une réservation au statut « ${RES_STATUS[r.status]} ».`);
    }
    // A booking of 3 hours or more can be cancelled until midnight before its business day. On the
    // day, only the member's absence can be recorded; either way the deposit stays with the club,
    // the balance is cancelled and the credit hours are released.
    const late = this.isLateForCancellation(r);
    const absence = flag(input.no_show);
    if (late && !absence) {
      throw conflict(
        'ANNULATION_TARDIVE',
        "Une réservation de 3 h ou plus ne peut être annulée que jusqu'à la veille à minuit. Si le membre ne vient pas, enregistrez son absence : seul l'acompte est perdu.",
      );
    }
    if (absence && !late) throw invalid("L'absence s'enregistre le jour de la séance ; avant, annulez la réservation.");
    const reason = text(input.reason, absence ? "Motif de l'absence" : "Motif d'annulation", { required: true, min: 3, max: 300 });
    const what = absence ? 'Absence' : 'Annulation';
    const released = this.committedFor(r.id, r.subscription_id);
    this.creditMove(actor, r.subscription_id, r.id, 'liberation', released, `${what} : ${reason}`);
    for (const att of this.all('SELECT * FROM reservation_attendees WHERE reservation_id = ?', r.id)) {
      const attReleased = this.committedFor(r.id, att.subscription_id);
      this.creditMove(actor, att.subscription_id, r.id, 'liberation', attReleased, `${what} : ${reason}`);
    }
    const due = this.all("SELECT * FROM charges WHERE reservation_id = ? AND status = 'due'", r.id);
    for (const c of due) this.voidCharge(actor, c, `${what} de la réservation : ${reason}`);
    const paid = this.all("SELECT * FROM charges WHERE reservation_id = ? AND status = 'payee'", r.id);
    const depositKept = paid.filter((c) => c.deposit).reduce((sum, c) => sum + c.amount, 0);
    this.run(
      "UPDATE reservations SET status = 'annulee', cancelled_at = ?, cancelled_by = ?, cancel_reason = ?, updated_at = ?, updated_by = ? WHERE id = ?",
      this.nowIso(), actor.id, absence ? `Absence : ${reason}` : reason, this.nowIso(), actor.id, r.id,
    );
    this.audit(actor, absence ? 'reservation.absence' : 'reservation.annuler', 'reservation', r.id, {
      motif: reason, minutes_liberees: released, lignes_annulees: due.length, lignes_deja_encaissees: paid.length,
      acompte_conserve: depositKept,
    });
    return {
      ...this.reservationDetail(r.id), released_minutes: released, deposit_kept: depositKept,
      paid_lines_to_review: paid.filter((c) => !c.deposit).length,
    };
  }

  // A booking of 3 hours or more can be cancelled until midnight before its business day.
  isLateForCancellation(r) {
    if (r.duration_min < DEPOSIT_FROM) return false;
    return this.nowMs() >= localToUtcMs(r.biz_day, '00:00', this.settings().timezone);
  }

  reservationDetail(id) {
    const r = this.reservationRow(id);
    const charges = this.all(`${CHARGE_SELECT} WHERE c.reservation_id = ? ORDER BY c.created_at, c.id`, r.id).map((c) => this.chargeDTO(c));
    const payments = this.all(
      `SELECT DISTINCT p.*, mm.first_name, mm.last_name, mm.member_no, u.name AS created_by_name FROM payments p
       JOIN payment_allocations pa ON pa.payment_id = p.id JOIN charges c ON c.id = pa.charge_id
       JOIN members mm ON mm.id = p.member_id LEFT JOIN users u ON u.id = p.created_by
       WHERE c.reservation_id = ? ORDER BY p.paid_at`, r.id,
    ).map((p) => this.paymentDTO(p));
    const credit_movements = this.all(
      `SELECT cm.*, u.name AS created_by_name FROM credit_movements cm LEFT JOIN users u ON u.id = cm.created_by
       WHERE cm.reservation_id = ? ORDER BY cm.id`, r.id,
    );
    const history = this.all(
      `SELECT a.*, u.name AS user_name FROM audit_log a LEFT JOIN users u ON u.id = a.user_id
       WHERE a.entity = 'reservation' AND a.entity_id = ? ORDER BY a.id`, r.id,
    ).map((a) => ({ ...a, details: a.details ? JSON.parse(a.details) : null }));
    const totals = Object.fromEntries(ACCOUNTS.map((k) => [k, { billed: 0, paid: 0, due: 0, refunded: 0 }]));
    for (const c of charges) {
      const t = totals[c.account];
      if (c.status !== 'annulee') t.billed += c.amount;
      if (c.status === 'payee') t.paid += c.amount;
      if (c.status === 'due') t.due += c.amount;
      if (c.status === 'remboursee') t.refunded += c.amount;
    }
    const sub = this.get('SELECT * FROM subscriptions WHERE id = ?', r.subscription_id);
    return {
      reservation: this.reservationDTO(r),
      subscription: this.subscriptionDTO(sub, this.bizToday()),
      charges, payments, credit_movements, history, totals,
      extension_window: this.extensionWindow(r.id),
    };
  }

  listReservations(query) {
    const from = query.from;
    const to = query.to ?? query.from;
    if (!isValidDate(from) || !isValidDate(to) || to < from) throw invalid('Période invalide.');
    if (daysBetween(from, to) > 92) throw invalid('Période limitée à 93 jours.');
    const status = query.status && RES_STATUS[query.status] ? query.status : null;
    const roomId = query.room_id ? toId(query.room_id, 'Salle') : null;
    const conds = ['r.biz_day >= ?', 'r.biz_day <= ?'];
    const params = [from, to];
    if (status) {
      conds.push('r.status = ?');
      params.push(status);
    }
    if (roomId) {
      conds.push('COALESCE(r.room_id, 1) = ?');
      params.push(roomId);
    }
    const rows = this.all(`${RES_SELECT} WHERE ${conds.join(' AND ')} ORDER BY r.start_ms`, ...params);
    return rows.map((r) => this.reservationDTO(r));
  }

  // ---------------------------------------------------------------- consumptions, charges, payments

  insertCharge(actor, c) {
    return this.insert(
      `INSERT INTO charges (account, kind, member_id, reservation_id, subscription_id, product_id, label, quantity,
         unit_price, amount, status, tariff_validated, created_at, created_by, consumer_member_id, deposit)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'due', ?, ?, ?, ?, ?)`,
      c.account, c.kind, c.member_id, c.reservation_id ?? null, c.subscription_id ?? null, c.product_id ?? null,
      c.label, c.quantity, c.unit_price, c.quantity * c.unit_price, c.tariff_validated ?? 1, this.nowIso(), actor.id,
      c.consumer_member_id ?? null, c.deposit ? 1 : 0,
    );
  }

  // Bottles and cigars of a reservation, with the member who consumed each (the holder by default).
  consumptionLines(reservationId) {
    return this.all(
      `SELECT c.id, c.account, c.label, c.quantity, c.unit_price, c.amount, c.status, c.product_id,
         COALESCE(c.consumer_member_id, c.member_id) AS consumer_member_id, m.first_name, m.last_name
       FROM charges c JOIN members m ON m.id = COALESCE(c.consumer_member_id, c.member_id)
       WHERE c.reservation_id = ? AND c.kind = 'produit' AND c.status IN ('due', 'payee')
       ORDER BY c.created_at, c.id`, reservationId,
    ).map((c) => ({
      id: c.id, account: c.account, account_label: ACCOUNT_LABELS[c.account], label: c.label, quantity: c.quantity,
      unit_price: c.unit_price, amount: c.amount, status: c.status, status_label: CHARGE_STATUS[c.status],
      product_id: c.product_id, consumer_member_id: c.consumer_member_id, consumer_name: `${c.first_name} ${c.last_name}`,
    }));
  }

  chargeDTO(c) {
    return {
      id: c.id, account: c.account, account_label: ACCOUNT_LABELS[c.account], kind: c.kind, kind_label: CHARGE_KIND[c.kind],
      member_id: c.member_id, member_name: c.first_name ? `${c.first_name} ${c.last_name}` : undefined,
      reservation_id: c.reservation_id, subscription_id: c.subscription_id, product_id: c.product_id,
      label: c.label, quantity: c.quantity, unit_price: c.unit_price, amount: c.amount,
      status: c.status, status_label: CHARGE_STATUS[c.status], tariff_validated: !!c.tariff_validated,
      deposit: !!c.deposit,
      created_at: c.created_at, created_by_name: c.created_by_name ?? null,
      cancelled_at: c.cancelled_at, cancel_reason: c.cancel_reason, cancelled_by_name: c.cancelled_by_name ?? null,
      payment_id: c.payment_id ?? null, paid_at: c.paid_at ?? null, payment_method: c.payment_method ?? null,
      refund_id: c.refund_id ?? null, refunded_at: c.refunded_at ?? null, refund_reason: c.refund_reason ?? null,
      consumer_member_id: c.kind === 'produit' ? (c.consumer_member_id ?? c.member_id) : null,
      consumer_name: c.kind !== 'produit' ? null
        : c.consumer_first ? `${c.consumer_first} ${c.consumer_last}` : (c.first_name ? `${c.first_name} ${c.last_name}` : null),
    };
  }

  moveStock(actor, productId, delta, kind, { chargeId = null, reason = null } = {}) {
    const res = this.run('UPDATE products SET stock_qty = stock_qty + ? WHERE id = ? AND stock_qty + ? >= 0', delta, productId, delta);
    if (res.changes !== 1) {
      const p = this.get('SELECT name, stock_qty FROM products WHERE id = ?', productId);
      throw conflict('STOCK_INSUFFISANT', `Stock insuffisant pour « ${p?.name ?? 'produit'} » : ${p?.stock_qty ?? 0} disponible(s).`);
    }
    const { stock_qty: after } = this.get('SELECT stock_qty FROM products WHERE id = ?', productId);
    this.run(
      `INSERT INTO stock_movements (product_id, kind, quantity, stock_after, charge_id, reason, created_at, created_by)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      productId, kind, delta, after, chargeId, reason, this.nowIso(), actor?.id ?? null,
    );
    return after;
  }

  addItem(actor, reservationId, input) {
    const r = this.reservationRow(reservationId);
    if (r.status === 'annulee') throw conflict('STATUT', "Impossible d'ajouter une consommation à une réservation annulée.");
    const p = this.get('SELECT * FROM products WHERE id = ?', toId(input.product_id, 'Produit'));
    if (!p) throw notFound('Produit');
    if (!p.active) throw conflict('PRODUIT_INACTIF', `Le produit « ${p.name} » est inactif.`);
    const qty = typeof input.quantity === 'string' ? Number(input.quantity) : input.quantity;
    if (!Number.isInteger(qty) || qty < 1 || qty > 99) {
      throw invalid(p.category === 'bouteille'
        ? 'Les bouteilles se vendent uniquement entières : indiquez un nombre entier (1 à 99).'
        : 'Les cigares se vendent à l’unité : indiquez un nombre entier (1 à 99).');
    }
    if (p.stock_qty < qty) throw conflict('STOCK_INSUFFISANT', `Stock insuffisant pour « ${p.name} » : ${p.stock_qty} disponible(s).`);
    // The consumer must be in the room: the holder (default) or a member added to the reservation.
    let consumer = r.member_id;
    if (input.consumer_member_id !== undefined && input.consumer_member_id !== null && input.consumer_member_id !== '') {
      consumer = toId(input.consumer_member_id, 'Membre');
      if (consumer !== r.member_id
        && !this.get('SELECT 1 AS x FROM reservation_attendees WHERE reservation_id = ? AND member_id = ?', r.id, consumer)) {
        throw invalid('Ce membre n’est pas dans la salle de cette réservation.', 'MEMBRE_ABSENT');
      }
    }
    const account = p.category === 'cigare' ? 'cigares' : 'alcool';
    const chargeId = this.insertCharge(actor, {
      account, kind: 'produit', member_id: r.member_id, reservation_id: r.id, product_id: p.id,
      label: p.name, quantity: qty, unit_price: p.price, consumer_member_id: consumer === r.member_id ? null : consumer,
    });
    this.moveStock(actor, p.id, -qty, 'vente', { chargeId, reason: `Réservation n° ${r.id}` });
    this.audit(actor, 'reservation.consommation.ajouter', 'reservation', r.id, {
      charge_id: chargeId, produit: p.name, quantite: qty, montant: qty * p.price, sous_compte: account, consommateur: consumer,
    });
    return this.reservationDetail(r.id);
  }

  voidCharge(actor, c, reason) {
    this.run(
      "UPDATE charges SET status = 'annulee', cancelled_at = ?, cancelled_by = ?, cancel_reason = ? WHERE id = ? AND status = 'due'",
      this.nowIso(), actor.id, reason, c.id,
    );
    if (c.product_id) this.moveStock(actor, c.product_id, c.quantity, 'annulation_vente', { chargeId: c.id, reason });
  }

  cancelCharge(actor, chargeId, input) {
    const c = this.get('SELECT * FROM charges WHERE id = ?', toId(chargeId, 'Ligne'));
    if (!c) throw notFound('Ligne');
    if (c.status !== 'due') {
      throw conflict('STATUT_LIGNE', c.status === 'payee'
        ? 'Cette ligne est déjà encaissée : un remboursement est nécessaire.'
        : `Cette ligne est déjà ${CHARGE_STATUS[c.status].toLowerCase()}.`);
    }
    if (c.kind !== 'produit' && actor.role !== 'admin') {
      throw forbidden("Seul un administrateur peut annuler une ligne de temps supplémentaire ou d'abonnement.");
    }
    const reason = text(input.reason, "Motif d'annulation", { required: true, min: 3, max: 300 });
    this.voidCharge(actor, c, reason);
    this.audit(actor, 'ligne.annuler', c.reservation_id ? 'reservation' : 'member', c.reservation_id ?? c.member_id, {
      charge_id: c.id, libelle: c.label, montant: c.amount, motif: reason,
    });
    return c.reservation_id ? this.reservationDetail(c.reservation_id) : this.memberDetail(c.member_id);
  }

  paymentDTO(p) {
    const allocations = this.all(
      `SELECT pa.charge_id, pa.account, pa.amount, c.label, c.quantity, c.reservation_id
       FROM payment_allocations pa JOIN charges c ON c.id = pa.charge_id WHERE pa.payment_id = ? ORDER BY pa.id`, p.id,
    );
    const byAccount = Object.fromEntries(ACCOUNTS.map((k) => [k, 0]));
    for (const a of allocations) byAccount[a.account] += a.amount;
    return {
      id: p.id, member_id: p.member_id, member_name: p.first_name ? `${p.first_name} ${p.last_name}` : undefined,
      member_no: p.member_no, reservation_id: p.reservation_id, amount: p.amount, method: p.method, reference: p.reference,
      paid_at: p.paid_at, created_by_name: p.created_by_name ?? null, allocations, by_account: byAccount,
    };
  }

  // V1: each selected line is collected in full; the payment is split by line, hence by sub-account.
  recordPayment(actor, input) {
    const s = this.settings();
    if (!Array.isArray(input.charge_ids) || !input.charge_ids.length) throw invalid('Sélectionnez au moins une ligne à encaisser.');
    const ids = [...new Set(input.charge_ids.map((v) => toId(v, 'Ligne')))];
    const charges = ids.map((cid) => {
      const c = this.get('SELECT * FROM charges WHERE id = ?', cid);
      if (!c) throw notFound('Ligne');
      return c;
    });
    for (const c of charges) {
      if (c.status !== 'due') {
        throw conflict('DEJA_TRAITEE', `La ligne « ${c.label} » n'est plus à encaisser (${CHARGE_STATUS[c.status].toLowerCase()}).`);
      }
    }
    if (new Set(charges.map((c) => c.member_id)).size > 1) throw invalid("Un encaissement ne peut concerner qu'un seul membre.");
    const method = text(input.method, 'Moyen de paiement', { required: true, max: 40 });
    if (!s.payment_methods.includes(method)) throw invalid('Moyen de paiement non configuré.');
    const reference = text(input.reference, 'Référence', { max: 80 });
    if (!s.demo_mode && charges.some((c) => !c.tariff_validated)) {
      throw conflict('TARIF_NON_VALIDE', 'Une des lignes repose sur un tarif non validé par un administrateur.');
    }
    this.assertOpen(this.bizToday(), 'Cet encaissement');
    const total = charges.reduce((sum, c) => sum + c.amount, 0);
    const reservationIds = new Set(charges.map((c) => c.reservation_id));
    const reservationId = reservationIds.size === 1 ? [...reservationIds][0] : null;
    const paymentId = this.insert(
      'INSERT INTO payments (member_id, reservation_id, amount, method, reference, paid_at, created_by) VALUES (?, ?, ?, ?, ?, ?, ?)',
      charges[0].member_id, reservationId, total, method, reference, this.nowIso(), actor.id,
    );
    for (const c of charges) {
      this.run('INSERT INTO payment_allocations (payment_id, charge_id, account, amount) VALUES (?, ?, ?, ?)', paymentId, c.id, c.account, c.amount);
      const res = this.run("UPDATE charges SET status = 'payee' WHERE id = ? AND status = 'due'", c.id);
      if (res.changes !== 1) throw conflict('DEJA_TRAITEE', `La ligne « ${c.label} » a été traitée entre-temps.`);
    }
    const payment = this.paymentDTO(this.get(
      `SELECT p.*, m.first_name, m.last_name, m.member_no, u.name AS created_by_name FROM payments p
       JOIN members m ON m.id = p.member_id LEFT JOIN users u ON u.id = p.created_by WHERE p.id = ?`, paymentId,
    ));
    const details = { payment_id: paymentId, montant: total, moyen: method, reference, ventilation: payment.by_account };
    if (reservationId) this.audit(actor, 'paiement.enregistrer', 'reservation', reservationId, details);
    else this.audit(actor, 'paiement.enregistrer', 'member', charges[0].member_id, details);
    return { payment };
  }

  refundCharge(actor, chargeId, input) {
    const s = this.settings();
    if (s.refunds_admin_only && actor.role !== 'admin') throw forbidden('Les remboursements sont réservés à un administrateur.');
    const c = this.get('SELECT * FROM charges WHERE id = ?', toId(chargeId, 'Ligne'));
    if (!c) throw notFound('Ligne');
    if (c.status !== 'payee') throw conflict('STATUT_LIGNE', 'Seule une ligne encaissée peut être remboursée.');
    const alloc = this.get('SELECT * FROM payment_allocations WHERE charge_id = ?', c.id);
    const reason = text(input.reason, 'Motif du remboursement', { required: true, min: 3, max: 300 });
    const method = text(input.method, 'Moyen de remboursement', { required: true, max: 40 });
    if (!s.payment_methods.includes(method)) throw invalid('Moyen de paiement non configuré.');
    const reference = text(input.reference, 'Référence', { max: 80 });
    this.assertOpen(this.bizToday(), 'Ce remboursement');
    const restock = !!c.product_id && flag(input.restock);
    const refundId = this.insert(
      `INSERT INTO refunds (charge_id, payment_id, account, amount, method, reference, reason, restocked, created_at, created_by)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      c.id, alloc.payment_id, c.account, c.amount, method, reference, reason, restock ? 1 : 0, this.nowIso(), actor.id,
    );
    this.run("UPDATE charges SET status = 'remboursee' WHERE id = ?", c.id);
    if (restock) this.moveStock(actor, c.product_id, c.quantity, 'retour', { chargeId: c.id, reason });
    this.audit(actor, 'ligne.rembourser', c.reservation_id ? 'reservation' : 'member', c.reservation_id ?? c.member_id, {
      refund_id: refundId, charge_id: c.id, libelle: c.label, montant: c.amount, sous_compte: c.account, motif: reason, remis_en_stock: restock,
    });
    return c.reservation_id ? this.reservationDetail(c.reservation_id) : this.memberDetail(c.member_id);
  }

  openCharges() {
    const rows = this.all(`${CHARGE_SELECT} WHERE c.status = 'due' ORDER BY m.last_name, m.first_name, c.created_at`);
    const groups = new Map();
    for (const row of rows) {
      const c = this.chargeDTO(row);
      if (!groups.has(c.member_id)) {
        groups.set(c.member_id, {
          member_id: c.member_id, member_name: c.member_name, member_no: row.member_no, total: 0,
          by_account: Object.fromEntries(ACCOUNTS.map((k) => [k, 0])), lines: [],
        });
      }
      const g = groups.get(c.member_id);
      g.total += c.amount;
      g.by_account[c.account] += c.amount;
      g.lines.push(c);
    }
    return [...groups.values()];
  }

  // ---------------------------------------------------------------- products & stock

  productDTO(p) {
    return {
      id: p.id, category: p.category, name: p.name, reference: p.reference, description: p.description, price: p.price,
      stock_qty: p.stock_qty, low_stock_threshold: p.low_stock_threshold, active: !!p.active, is_demo: !!p.is_demo,
      low: p.stock_qty <= p.low_stock_threshold, out: p.stock_qty === 0,
    };
  }

  listProducts({ includeInactive = false } = {}) {
    const rows = includeInactive
      ? this.all('SELECT * FROM products ORDER BY category, name')
      : this.all('SELECT * FROM products WHERE active = 1 ORDER BY category, name');
    return rows.map((p) => this.productDTO(p));
  }

  productFields(input, current = {}) {
    const pick = (k) => (input[k] !== undefined ? input[k] : current[k]);
    const category = pick('category');
    if (!['cigare', 'bouteille'].includes(category)) throw invalid('Catégorie invalide (cigare ou bouteille).');
    const name = text(pick('name'), 'Nom du produit', { required: true, max: 80 });
    const reference = text(pick('reference'), 'Référence', { required: true, max: 40 });
    const description = text(pick('description'), 'Description', { max: 300 });
    const price = int(pick('price'), 'Prix de vente', { min: 0 });
    const threshold = int(pick('low_stock_threshold') ?? this.settings().low_stock_default, "Seuil d'alerte", { min: 0, max: 10000 });
    const active = input.active !== undefined ? flag(input.active) : current.active !== undefined ? !!current.active : true;
    return { category, name, reference, description, price, threshold, active };
  }

  createProduct(actor, input, { demo = false } = {}) {
    const f = this.productFields(input);
    if (this.get('SELECT 1 AS x FROM products WHERE reference = ?', f.reference)) throw conflict('REFERENCE_PRISE', 'Cette référence existe déjà.');
    const initial = input.initial_stock === undefined || input.initial_stock === '' ? 0 : int(input.initial_stock, 'Stock initial', { min: 0, max: 100000 });
    const id = this.insert(
      `INSERT INTO products (category, name, reference, description, price, stock_qty, low_stock_threshold, active, is_demo, created_at, created_by)
       VALUES (?, ?, ?, ?, ?, 0, ?, ?, ?, ?, ?)`,
      f.category, f.name, f.reference, f.description, f.price, f.threshold, f.active ? 1 : 0, demo ? 1 : 0, this.nowIso(), actor.id,
    );
    if (initial > 0) this.moveStock(actor, id, initial, 'stock_initial', { reason: 'Création du produit' });
    this.audit(actor, 'produit.creer', 'product', id, { ...f, stock_initial: initial });
    return this.productDTO(this.get('SELECT * FROM products WHERE id = ?', id));
  }

  updateProduct(actor, productId, input) {
    const p = this.get('SELECT * FROM products WHERE id = ?', toId(productId, 'Produit'));
    if (!p) throw notFound('Produit');
    const f = this.productFields(input, { ...p, low_stock_threshold: p.low_stock_threshold });
    if (f.reference.toLowerCase() !== p.reference.toLowerCase()
      && this.get('SELECT 1 AS x FROM products WHERE reference = ? AND id <> ?', f.reference, p.id)) {
      throw conflict('REFERENCE_PRISE', 'Cette référence existe déjà.');
    }
    this.run(
      `UPDATE products SET category = ?, name = ?, reference = ?, description = ?, price = ?, low_stock_threshold = ?, active = ?,
         updated_at = ?, updated_by = ? WHERE id = ?`,
      f.category, f.name, f.reference, f.description, f.price, f.threshold, f.active ? 1 : 0, this.nowIso(), actor.id, p.id,
    );
    this.audit(actor, 'produit.modifier', 'product', p.id, {
      avant: { name: p.name, reference: p.reference, price: p.price, low_stock_threshold: p.low_stock_threshold, active: !!p.active },
      apres: { name: f.name, reference: f.reference, price: f.price, low_stock_threshold: f.threshold, active: f.active },
    });
    return this.productDTO(this.get('SELECT * FROM products WHERE id = ?', p.id));
  }

  stockOperation(actor, productId, input) {
    const p = this.get('SELECT * FROM products WHERE id = ?', toId(productId, 'Produit'));
    if (!p) throw notFound('Produit');
    if (input.kind === 'entree') {
      const qty = int(input.quantity, 'Quantité reçue', { min: 1, max: 100000 });
      const reason = text(input.reason, 'Remarque', { max: 200 });
      this.moveStock(actor, p.id, qty, 'entree', { reason });
      this.audit(actor, 'stock.entree', 'product', p.id, { quantite: qty, remarque: reason });
    } else if (input.kind === 'ajustement') {
      const target = int(input.target_qty, 'Quantité constatée', { min: 0, max: 100000 });
      const expected = int(input.expected_qty, 'Quantité attendue', { min: 0 });
      if (expected !== p.stock_qty) {
        throw conflict('STOCK_MODIFIE', `Le stock a changé entre-temps (${p.stock_qty} actuellement). Rechargez puis recommencez.`);
      }
      const reason = text(input.reason, "Motif de l'ajustement", { required: true, min: 3, max: 200 });
      const delta = target - p.stock_qty;
      if (delta === 0) throw invalid('La quantité constatée est identique au stock enregistré : aucun ajustement.');
      this.moveStock(actor, p.id, delta, 'ajustement', { reason });
      this.audit(actor, 'stock.ajustement', 'product', p.id, { avant: p.stock_qty, apres: target, ecart: delta, motif: reason });
    } else {
      throw invalid('Type de mouvement invalide (entree ou ajustement).');
    }
    return this.productDTO(this.get('SELECT * FROM products WHERE id = ?', p.id));
  }

  stockMovements(query = {}) {
    const limit = Math.min(500, Math.max(1, Number(query.limit) || 100));
    const base = `SELECT sm.*, p.name AS product_name, p.reference, p.category, u.name AS created_by_name
      FROM stock_movements sm JOIN products p ON p.id = sm.product_id LEFT JOIN users u ON u.id = sm.created_by`;
    const rows = query.product_id
      ? this.all(`${base} WHERE sm.product_id = ? ORDER BY sm.id DESC LIMIT ?`, toId(query.product_id), limit)
      : this.all(`${base} ORDER BY sm.id DESC LIMIT ?`, limit);
    return rows.map((m) => ({ ...m, kind_label: STOCK_KIND[m.kind] }));
  }

  // ---------------------------------------------------------------- dashboard & finance

  dashboard(actor) {
    const s = this.settings();
    const now = this.nowMs();
    const today = this.bizToday();
    const todayList = this.listReservations({ from: today, to: today });
    const current = this.all(
      `${RES_SELECT} WHERE r.status = 'en_cours' OR (r.status = 'reservee' AND r.start_ms <= ? AND r.end_ms > ?) ORDER BY r.start_ms`,
      now, now,
    ).map((r) => this.reservationDTO(r));
    const allUpcoming = this.all(`${RES_SELECT} WHERE r.status = 'reservee' AND r.start_ms > ? ORDER BY r.start_ms LIMIT 20`, now)
      .map((r) => this.reservationDTO(r));
    const upcoming = allUpcoming.slice(0, 6);
    const toClose = this.all(
      `${RES_SELECT} WHERE r.status IN ('reservee', 'en_cours') AND r.end_ms <= ? ORDER BY r.start_ms LIMIT 20`, now,
    ).map((r) => this.reservationDTO(r));
    const activeRooms = this.rooms();
    const roomsStatus = activeRooms.map((rm) => {
      const occ = current.find((r) => r.room_id === rm.id) ?? null;
      const nxt = allUpcoming.find((r) => r.room_id === rm.id) ?? null;
      const todayCount = todayList.filter((r) => r.room_id === rm.id && r.status !== 'annulee').length;
      return {
        ...rm,
        occupied: Boolean(occ),
        current: occ ? { ...occ, consumptions: this.consumptionLines(occ.id), extension_window: this.extensionWindow(occ.id) } : null,
        next: nxt,
        today_count: todayCount,
      };
    });
    const expiring = this.all(
      `SELECT s.id, s.member_id, s.plan_name, s.start_date, s.end_date, m.first_name, m.last_name, m.member_no
       FROM subscriptions s JOIN members m ON m.id = s.member_id
       WHERE s.status = 'active' AND s.end_date >= ? AND s.end_date < ?
         AND NOT EXISTS (SELECT 1 FROM subscriptions n WHERE n.member_id = s.member_id AND n.status = 'active' AND n.start_date > s.end_date)
       ORDER BY s.end_date`, today, addDays(today, s.expiry_warning_days),
    ).map((x) => ({ ...x, member_name: `${x.first_name} ${x.last_name}`, days_left: daysBetween(today, x.end_date) }));
    const expired = this.all(
      `SELECT s.id, s.member_id, s.plan_name, s.start_date, s.end_date, m.first_name, m.last_name, m.member_no
       FROM subscriptions s JOIN members m ON m.id = s.member_id
       WHERE s.status = 'active' AND s.end_date < ? AND s.end_date >= ?
         AND NOT EXISTS (SELECT 1 FROM subscriptions n WHERE n.member_id = s.member_id AND n.status = 'active' AND n.start_date > s.end_date)
       ORDER BY s.end_date DESC`, today, addDays(today, -30),
    ).map((x) => ({ ...x, member_name: `${x.first_name} ${x.last_name}`, days_since: daysBetween(x.end_date, today) }));
    const stockAlerts = this.all('SELECT * FROM products WHERE active = 1 AND stock_qty <= low_stock_threshold ORDER BY stock_qty, name')
      .map((p) => this.productDTO(p));
    const { due } = this.get("SELECT COALESCE(SUM(amount), 0) AS due FROM charges WHERE status = 'due'");
    const result = {
      biz_day: today, now: new Date(now).toISOString(),
      rooms_status: roomsStatus,
      today: todayList, current, upcoming, to_close: toClose,
      expiring, expired, stock_alerts: stockAlerts, outstanding_total: due,
      cash_today: this.financeSummary(today, today),
      lounge: this.loungeOverview(),
    };
    if (actor.role === 'admin') {
      result.revenue = {
        week: this.financeSummary(addDays(today, -6), today),
        month: this.financeSummary(`${today.slice(0, 8)}01`, today),
      };
    }
    return result;
  }

  financeSummary(from, to) {
    const [a, b] = this.periodBounds(from, to);
    const empty = (key, label) => ({ account: key, label, billed: 0, collected: 0, refunded: 0, net: 0, outstanding: 0, cancelled: 0, lines: 0 });
    const acc = Object.fromEntries(ACCOUNTS.map((k) => [k, empty(k, ACCOUNT_LABELS[k])]));
    for (const r of this.all(
      'SELECT account, status, SUM(amount) AS total, COUNT(*) AS n FROM charges WHERE created_at >= ? AND created_at < ? GROUP BY account, status', a, b,
    )) {
      const x = acc[r.account];
      if (r.status === 'annulee') x.cancelled += r.total;
      else {
        x.billed += r.total;
        x.lines += r.n;
      }
      if (r.status === 'due') x.outstanding += r.total;
    }
    for (const r of this.all(
      `SELECT pa.account, SUM(pa.amount) AS total FROM payment_allocations pa JOIN payments p ON p.id = pa.payment_id
       WHERE p.paid_at >= ? AND p.paid_at < ? GROUP BY pa.account`, a, b,
    )) acc[r.account].collected += r.total;
    for (const r of this.all('SELECT account, SUM(amount) AS total FROM refunds WHERE created_at >= ? AND created_at < ? GROUP BY account', a, b)) {
      acc[r.account].refunded += r.total;
    }
    const accounts = ACCOUNTS.map((k) => {
      acc[k].net = acc[k].collected - acc[k].refunded;
      return acc[k];
    });
    const total = empty('total', 'Total');
    for (const x of accounts) for (const f of ['billed', 'collected', 'refunded', 'net', 'outstanding', 'cancelled', 'lines']) total[f] += x[f];
    const methods = this.all(
      'SELECT method, SUM(amount) AS total, COUNT(*) AS n FROM payments WHERE paid_at >= ? AND paid_at < ? GROUP BY method ORDER BY total DESC', a, b,
    );
    return { from, to, accounts, total, methods };
  }

  journal(from, to) {
    const [a, b] = this.periodBounds(from, to);
    const payments = this.all(
      `SELECT p.*, m.first_name, m.last_name, m.member_no, u.name AS created_by_name FROM payments p
       JOIN members m ON m.id = p.member_id LEFT JOIN users u ON u.id = p.created_by
       WHERE p.paid_at >= ? AND p.paid_at < ? ORDER BY p.paid_at DESC`, a, b,
    ).map((p) => this.paymentDTO(p));
    const refunds = this.all(
      `SELECT rf.*, c.label, c.member_id, c.reservation_id, m.first_name, m.last_name, u.name AS created_by_name FROM refunds rf
       JOIN charges c ON c.id = rf.charge_id JOIN members m ON m.id = c.member_id LEFT JOIN users u ON u.id = rf.created_by
       WHERE rf.created_at >= ? AND rf.created_at < ? ORDER BY rf.created_at DESC`, a, b,
    ).map((r) => ({ ...r, member_name: `${r.first_name} ${r.last_name}`, account_label: ACCOUNT_LABELS[r.account] }));
    return { from, to, payments, refunds };
  }

  auditLog(query = {}) {
    const limit = Math.min(1000, Math.max(1, Number(query.limit) || 200));
    return this.all(
      `SELECT a.*, u.name AS user_name FROM audit_log a LEFT JOIN users u ON u.id = a.user_id ORDER BY a.id DESC LIMIT ?`, limit,
    ).map((a) => ({ ...a, details: a.details ? JSON.parse(a.details) : null }));
  }

  // ---------------------------------------------------------------- exports (CSV and Excel)

  // One table per export: header and rows, money cells as { money: minor } so each format can
  // render them (decimal text for CSV, numbers in currency units for Excel).
  exportTable(kind, query) {
    const s = this.settings();
    const tz = s.timezone;
    const from = query.from;
    const to = query.to ?? query.from;
    const [a, b] = this.periodBounds(from, to);
    const account = ACCOUNTS.includes(query.account) ? query.account : null;
    const money = (minor) => ({ money: minor });
    const when = (iso) => {
      const p = localParts(Date.parse(iso), tz);
      return `${p.date} ${p.time}`;
    };
    const cur = `(${s.currency.label})`;
    let header;
    let rows;
    switch (kind) {
      case 'lignes': {
        header = ['Date', 'N° ligne', 'Sous-compte', 'Type', 'N° membre', 'Membre', 'Réservation', 'Libellé', 'Quantité',
          `Prix unitaire ${cur}`, `Montant ${cur}`, 'Statut', 'Tarif validé', 'Saisi par'];
        rows = this.all(`${CHARGE_SELECT} WHERE c.created_at >= ? AND c.created_at < ? ${account ? 'AND c.account = ?' : ''} ORDER BY c.created_at`,
          ...(account ? [a, b, account] : [a, b]))
          .map((c) => [when(c.created_at), c.id, ACCOUNT_LABELS[c.account], CHARGE_KIND[c.kind], c.member_no, `${c.first_name} ${c.last_name}`,
            c.reservation_id ?? '', c.label, c.quantity, money(c.unit_price), money(c.amount), CHARGE_STATUS[c.status],
            c.tariff_validated ? 'oui' : 'non', c.created_by_name ?? '']);
        break;
      }
      case 'encaissements': {
        header = ['Date', 'N° encaissement', 'N° membre', 'Membre', 'Moyen', 'Référence', 'Sous-compte', 'N° ligne', 'Libellé',
          `Montant ${cur}`, 'Saisi par'];
        rows = this.all(
          `SELECT p.id, p.paid_at, p.method, p.reference, pa.account, pa.amount, pa.charge_id, c.label, m.member_no, m.first_name, m.last_name,
             u.name AS created_by_name
           FROM payment_allocations pa JOIN payments p ON p.id = pa.payment_id JOIN charges c ON c.id = pa.charge_id
           JOIN members m ON m.id = p.member_id LEFT JOIN users u ON u.id = p.created_by
           WHERE p.paid_at >= ? AND p.paid_at < ? ${account ? 'AND pa.account = ?' : ''} ORDER BY p.paid_at, pa.id`,
          ...(account ? [a, b, account] : [a, b]),
        ).map((r) => [when(r.paid_at), r.id, r.member_no, `${r.first_name} ${r.last_name}`, r.method, r.reference ?? '',
          ACCOUNT_LABELS[r.account], r.charge_id, r.label, money(r.amount), r.created_by_name ?? '']);
        break;
      }
      case 'remboursements': {
        header = ['Date', 'N° remboursement', 'N° ligne', 'Membre', 'Sous-compte', 'Libellé', `Montant ${cur}`, 'Moyen', 'Référence', 'Motif',
          'Remis en stock', 'Saisi par'];
        rows = this.journal(from, to).refunds.filter((r) => !account || r.account === account)
          .map((r) => [when(r.created_at), r.id, r.charge_id, r.member_name, ACCOUNT_LABELS[r.account], r.label, money(r.amount),
            r.method, r.reference ?? '', r.reason, r.restocked ? 'oui' : 'non', r.created_by_name ?? '']);
        break;
      }
      case 'synthese': {
        header = ['Sous-compte', `Facturé ${cur}`, `Encaissé ${cur}`, `Remboursé ${cur}`, `Net encaissé ${cur}`, `Reste à payer ${cur}`,
          `Annulé ${cur}`];
        const sum = this.financeSummary(from, to);
        rows = [...sum.accounts, sum.total].map((x) => [x.label, money(x.billed), money(x.collected), money(x.refunded), money(x.net),
          money(x.outstanding), money(x.cancelled)]);
        break;
      }
      case 'reservations': {
        header = ['N°', 'Journée', 'Début', 'Fin', 'Durée (min)', 'N° membre', 'Membre', 'Statut', 'Minutes incluses', 'Minutes payantes',
          `Supplément ${cur}`, 'Hors horaires', 'Autorisé par', 'Saisi par'];
        rows = this.all(`${RES_SELECT} WHERE r.biz_day >= ? AND r.biz_day <= ? ORDER BY r.start_ms`, from, to)
          .map((r) => this.reservationDTO(r))
          .map((r) => [r.id, r.biz_day, `${r.start_date} ${r.start_time}`, `${r.end_date} ${r.end_time}`, r.duration_min, r.member_no,
            r.member_name, r.status_label, r.included_minutes, r.paid_minutes, money(r.supplement_amount), r.off_hours ? 'oui' : 'non',
            r.off_hours_authorized_by_name ?? '', r.created_by_name ?? '']);
        break;
      }
      case 'stock': {
        header = ['Date', 'Produit', 'Référence', 'Catégorie', 'Mouvement', 'Quantité', 'Stock après', 'N° ligne', 'Motif', 'Saisi par'];
        rows = this.all(
          `SELECT sm.*, p.name, p.reference, p.category, u.name AS created_by_name FROM stock_movements sm
           JOIN products p ON p.id = sm.product_id LEFT JOIN users u ON u.id = sm.created_by
           WHERE sm.created_at >= ? AND sm.created_at < ? ORDER BY sm.id`, a, b,
        ).map((m) => [when(m.created_at), m.name, m.reference, m.category === 'cigare' ? 'Cigare' : 'Bouteille', STOCK_KIND[m.kind],
          m.quantity, m.stock_after, m.charge_id ?? '', m.reason ?? '', m.created_by_name ?? '']);
        break;
      }
      case 'operations': {
        header = ['Date', 'N°', 'Type', 'Catégorie', 'Sous-compte', 'Compte', 'Vers', 'Libellé', 'Référence', `Montant ${cur}`,
          'Statut', 'Saisi par', "Motif d'annulation"];
        rows = this.listEntries({ from, to }, null).entries.reverse()
          .map((e) => [e.biz_date, e.id, e.kind_label, e.category_name ?? '', e.account_label ?? '', e.method, e.to_method ?? '',
            e.label, e.reference ?? '', money(e.amount), e.status_label, e.created_by_name ?? '', e.cancel_reason ?? '']);
        break;
      }
      case 'grand-livre': {
        const book = this.ledgerBook({ from, to, method: query.method, account: query.account });
        header = ['Journée', 'Heure', 'Pièce', 'Type', 'Libellé', 'Détail', 'Sous-compte', 'Compte', `Entrée ${cur}`, `Sortie ${cur}`,
          `Solde ${cur}`];
        rows = book.rows.map((r) => [r.biz_day, r.time, r.ref, r.type_label, r.label, r.detail ?? '', r.account_label ?? '', r.method,
          r.in ? money(r.in) : '', r.out ? money(r.out) : '', r.balance == null ? '' : money(r.balance)]);
        if (book.opening != null) rows.unshift([from, '', '', 'Solde au début de la période', '', '', '', book.method ?? 'Tous', '', '', money(book.opening)]);
        break;
      }
      case 'tresorerie': {
        const t = this.treasuryBalances(from, to);
        header = ['Compte', `Solde initial ${cur}`, `Entrées ${cur}`, `Sorties ${cur}`, `Solde final ${cur}`];
        rows = [...t.accounts, t.total].map((x) => [x.method, money(x.opening), money(x.in), money(x.out), money(x.closing)]);
        break;
      }
      default:
        throw invalid("Type d'export inconnu.");
    }
    const suffix = account ? `-${account}` : '';
    return { name: `${kind}${suffix}_${from}_${to}`, sheet: EXPORT_SHEETS[kind], header, rows };
  }

  exportJson(kind, query) {
    const t = this.exportTable(kind, query);
    const value = (v) => (v && typeof v === 'object' ? v.money / 100 : (v ?? ''));
    return { filename: `${t.name}.xlsx`, sheet: t.sheet, header: t.header, rows: t.rows.map((r) => r.map(value)) };
  }

  exportCsv(kind, query) {
    const t = this.exportTable(kind, query);
    const dec = this.settings().currency.decimals;
    const header = t.header;
    const rows = t.rows;
    const cell = (v) => {
      if (v && typeof v === 'object') return (v.money / 100).toFixed(dec).replace('.', ',');
      const str = String(v ?? '');
      const safe = /^[=+\-@\t\r]/.test(str) && !/^-?\d+(,\d+)?$/.test(str) ? `'${str}` : str;
      return /[";\n\r]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
    };
    const body = [header, ...rows].map((r) => r.map(cell).join(';')).join('\r\n');
    return { filename: `${t.name}.csv`, content: `\ufeff${body}\r\n` };
  }

  // ---------------------------------------------------------------- demo space

  // The demo space is a second club (its own database, `demo` set) that copies the real club's
  // configuration and holds fictitious data only. Its methods refuse to run on the real club: they
  // rewrite accounts and wipe data.
  assertDemo() {
    if (!this.demo) throw conflict('MODE_DEMO_INACTIF', "Cette opération n'existe que dans l'espace démo.");
  }

  // What the demo space takes from the real club (this method runs on the real club). Accounts come
  // as identities only (id, name, role, active): neither a login nor a password hash leaves the real
  // club, and the demo space has no use for them (it gives each account the login u<id>). The treasury
  // starting point stays out: the demo sets its own, with fictitious amounts. `demo_mode` is not a
  // stored setting any more.
  demoConfig() {
    return {
      users: this.all('SELECT id, name, role, active FROM users ORDER BY id'),
      settings: this.all(
        "SELECT key, value, updated_at, updated_by FROM settings WHERE key NOT IN ('demo_mode', 'opening_balances') ORDER BY key",
      ),
      plans: this.all('SELECT * FROM plans ORDER BY id'),
      rooms: this.all('SELECT * FROM rooms ORDER BY id'),
      categories: this.all('SELECT * FROM categories ORDER BY id'),
    };
  }

  // The demo records and the copied settings point at accounts (created_by, updated_by...), so the
  // real accounts exist here under the same ids. Identity only: the login is `u<id>` and the hash '!'
  // is not the output of any password, so nobody can sign in to the demo space. This runs on every
  // demo request: an account that already says the same is left alone (the WHERE of the update), so a
  // request that changes nothing writes nothing.
  mirrorUsers(users) {
    this.assertDemo();
    for (const u of users) {
      this.run(
        `INSERT INTO users (id, login, name, role, password_hash, active, created_at) VALUES (?, ?, ?, ?, '!', ?, ?)
         ON CONFLICT(id) DO UPDATE SET login = excluded.login, name = excluded.name, role = excluded.role,
           password_hash = excluded.password_hash, active = excluded.active
         WHERE login IS NOT excluded.login OR name IS NOT excluded.name OR role IS NOT excluded.role
           OR password_hash IS NOT excluded.password_hash OR active IS NOT excluded.active`,
        u.id, `u${u.id}`, u.name, u.role, u.active ? 1 : 0, this.nowIso(),
      );
    }
  }

  // Replaces a table's rows by the given ones, ids included, column by column (the columns are those
  // of the source rows, which only ever come from the real club's demoConfig).
  replaceRows(table, rows) {
    this.run(`DELETE FROM ${table}`);
    for (const row of rows) {
      const columns = Object.keys(row);
      this.run(
        `INSERT INTO ${table} (${columns.join(', ')}) VALUES (${columns.map(() => '?').join(', ')})`,
        ...columns.map((column) => row[column]),
      );
    }
  }

  // Gets the demo space ready for a request. The first time (no `demo_seeded` mark) it copies the
  // real club's configuration and fills the space with fictitious data, all in one transaction. After
  // that only the accounts are mirrored again, so a new, renamed or deactivated account is followed at
  // once, while the settings stay as copied until the next reset.
  prepareDemo(config) {
    this.assertDemo();
    this.tx(() => {
      // First, whatever the case: the rows copied below refer to these accounts.
      this.mirrorUsers(config.users);
      if (this.get("SELECT 1 AS x FROM meta WHERE key = 'demo_seeded'")) return;
      // Nothing refers to these tables yet: the space is new, or resetDemo has just emptied it.
      this.replaceRows('settings', config.settings);
      this.replaceRows('plans', config.plans);
      this.replaceRows('rooms', config.rooms);
      this.replaceRows('categories', config.categories);
      this.run(
        `INSERT INTO users (id, login, name, role, password_hash, active, created_at)
         VALUES (?, 'auteur.demo.0', 'Démonstration', 'admin', '!', 1, ?) ON CONFLICT(id) DO NOTHING`,
        DEMO_AUTHOR_ID, this.nowIso(),
      );
      this.cachedSettings = null;
      // The seed sells both plans, even if the real club has stopped offering one of them: that choice
      // is put back once the data is in.
      const withdrawn = config.plans.filter((p) => !p.active);
      this.run('UPDATE plans SET active = 1');
      seedDemo(this, { actor: this.get('SELECT * FROM users WHERE id = ?', DEMO_AUTHOR_ID) });
      for (const p of withdrawn) this.run('UPDATE plans SET active = 0 WHERE id = ?', p.id);
      this.run("INSERT INTO meta (key, value) VALUES ('demo_seeded', ?)", this.nowIso());
    });
  }

  // Empties the demo space and fills it again from the real club's current configuration. The wipe
  // and the refill commit together or not at all. The journal entry is written last: the wipe
  // empties the journal.
  resetDemo(config, actor) {
    this.assertDemo();
    this.tx(() => {
      for (const table of WIPE_ORDER) this.run(`DELETE FROM ${table}`);
      this.run("DELETE FROM meta WHERE key = 'demo_seeded'");
      this.prepareDemo(config);
      this.audit(actor, 'demo.remettre_a_neuf', null, null, null);
    });
    return { ok: true };
  }
}

Object.assign(Club.prototype, ledgerMethods);
Object.assign(Club.prototype, loungeMethods);
