// Conservation and members' private storage. All writes run inside the API transaction,
// including audit and idempotency. Private cigars never affect the club's sale inventory.
import { invalid, conflict, notFound } from './errors.js';
import { text, int, toId, flag } from './validate.js';
import { localParts, isValidDate, daysBetween } from '../shared/time.js';

function decimal(value, label, min, max) {
  const raw = typeof value === 'string' ? value.trim().replace(',', '.') : value;
  if (raw === '' || raw == null || !['number', 'string'].includes(typeof raw)) throw invalid(`${label} : valeur obligatoire.`);
  const n = Number(raw);
  if (!Number.isFinite(n) || n < min || n > max || Math.abs(n * 10 - Math.round(n * 10)) > 1e-8) {
    throw invalid(`${label} : entre ${min} et ${max}, avec une décimale maximum.`);
  }
  return n;
}

const LOCKERS = `SELECT l.*, h.name AS humidor_name,
  a.id AS assignment_id, a.member_id, a.start_date, a.end_date, a.notes AS assignment_notes,
  m.first_name || ' ' || m.last_name AS member_name, m.member_no,
  COALESCE((SELECT SUM(i.quantity) FROM locker_items i WHERE i.assignment_id = a.id), 0) AS cigar_count
  FROM lockers l JOIN humidors h ON h.id = l.humidor_id
  LEFT JOIN locker_assignments a ON a.locker_id = l.id AND a.released_at IS NULL
  LEFT JOIN members m ON m.id = a.member_id`;

export const loungeMethods = {
  loungeToday() { return localParts(this.nowMs(), this.settings().timezone).date; },

  humidorRow(id) {
    const h = this.get('SELECT * FROM humidors WHERE id = ?', toId(id));
    if (!h) throw notFound('Cave');
    return h;
  },

  humidorValues(input) {
    const name = text(input.name, 'Nom', { required: true, max: 80 });
    const location = text(input.location, 'Emplacement', { max: 100 });
    const notes = text(input.notes, 'Notes', { max: 500 });
    const hmin = decimal(input.humidity_min, 'Humidité minimale', 0, 100);
    const hmax = decimal(input.humidity_max, 'Humidité maximale', 0, 100);
    const tmin = decimal(input.temperature_min, 'Température minimale', -20, 60);
    const tmax = decimal(input.temperature_max, 'Température maximale', -20, 60);
    if (hmin >= hmax || tmin >= tmax) throw invalid('Chaque seuil maximal doit dépasser le seuil minimal.');
    const interval = int(input.reading_interval_hours, 'Fréquence de contrôle (heures)', { min: 1, max: 168 });
    return [name, location, notes, hmin, hmax, tmin, tmax, interval];
  },

  createHumidor(actor, input) {
    const values = this.humidorValues(input);
    if (this.get('SELECT id FROM humidors WHERE name = ? COLLATE NOCASE', values[0])) throw conflict('NOM_UTILISE', 'Une cave porte déjà ce nom.');
    const id = this.insert(`INSERT INTO humidors
      (name, location, notes, humidity_min, humidity_max, temperature_min, temperature_max, reading_interval_hours, created_at, created_by)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`, ...values, this.nowIso(), actor.id);
    this.audit(actor, 'cave.creer', 'humidor', id, { nom: values[0] });
    return this.humidorDetail(id);
  },

  updateHumidor(actor, id, input) {
    const h = this.humidorRow(id);
    const values = this.humidorValues(input);
    if (this.get('SELECT id FROM humidors WHERE name = ? COLLATE NOCASE AND id <> ?', values[0], h.id)) throw conflict('NOM_UTILISE', 'Une cave porte déjà ce nom.');
    this.run(`UPDATE humidors SET name = ?, location = ?, notes = ?, humidity_min = ?, humidity_max = ?,
      temperature_min = ?, temperature_max = ?, reading_interval_hours = ?, updated_at = ? WHERE id = ?`, ...values, this.nowIso(), h.id);
    this.audit(actor, 'cave.modifier', 'humidor', h.id, { nom: values[0], avant: h, apres: input });
    return this.humidorDetail(h.id);
  },

  humidorDTO(h) {
    const latest = this.get(`SELECT r.*, u.name AS created_by_name FROM humidor_readings r
      LEFT JOIN users u ON u.id = r.created_by WHERE r.humidor_id = ? AND r.voided_at IS NULL
      ORDER BY r.measured_at DESC, r.id DESC LIMIT 1`, h.id) ?? null;
    const stale = latest ? this.nowMs() - Date.parse(latest.measured_at) >= h.reading_interval_hours * 3600000 : true;
    const outside = latest ? latest.humidity < h.humidity_min || latest.humidity > h.humidity_max
      || latest.temperature < h.temperature_min || latest.temperature > h.temperature_max : false;
    return { ...h, latest, stale, outside, status: !latest ? 'a_controler' : outside ? 'alerte' : stale ? 'a_controler' : 'conforme' };
  },

  humidorDetail(id) {
    const h = this.humidorRow(id);
    return {
      ...this.humidorDTO(h),
      readings: this.all(`SELECT r.*, u.name AS created_by_name, v.name AS voided_by_name FROM humidor_readings r
        LEFT JOIN users u ON u.id = r.created_by LEFT JOIN users v ON v.id = r.voided_by
        WHERE r.humidor_id = ? ORDER BY r.measured_at DESC, r.id DESC LIMIT 60`, h.id),
    };
  },

  recordHumidorReading(actor, id, input) {
    const h = this.humidorRow(id);
    const humidity = decimal(input.humidity, 'Humidité', 0, 100);
    const temperature = decimal(input.temperature, 'Température', -20, 60);
    const notes = text(input.notes, 'Observation', { max: 500 });
    const readingId = this.insert(`INSERT INTO humidor_readings (humidor_id, humidity, temperature, notes, measured_at, created_by)
      VALUES (?, ?, ?, ?, ?, ?)`, h.id, humidity, temperature, notes, this.nowIso(), actor.id);
    this.audit(actor, 'cave.releve', 'humidor', h.id, { nom: h.name, releve: readingId, humidite: humidity, temperature, notes });
    return this.humidorDetail(h.id);
  },

  voidHumidorReading(actor, id, input) {
    const r = this.get('SELECT * FROM humidor_readings WHERE id = ?', toId(id));
    if (!r) throw notFound('Relevé');
    if (r.voided_at) throw conflict('RELEVE_ANNULE', 'Ce relevé est déjà annulé.');
    const reason = text(input.reason, 'Motif', { required: true, min: 3, max: 300 });
    this.run('UPDATE humidor_readings SET voided_at = ?, voided_by = ?, void_reason = ? WHERE id = ?', this.nowIso(), actor.id, reason, r.id);
    this.audit(actor, 'cave.releve_annuler', 'humidor', r.humidor_id, { releve: r.id, motif: reason });
    return this.humidorDetail(r.humidor_id);
  },

  listLockers() {
    const today = this.loungeToday();
    const warning = this.settings().expiry_warning_days;
    return this.all(`${LOCKERS} ORDER BY l.code COLLATE NOCASE`).map((l) => {
      const days = l.assignment_id ? daysBetween(today, l.end_date) : null;
      return { ...l, days_left: days, status: !l.active ? 'indisponible' : !l.assignment_id ? 'libre'
        : days < 0 ? 'expire' : days <= warning ? 'a_renouveler' : 'occupe' };
    });
  },

  lockerRow(id) {
    const l = this.get('SELECT * FROM lockers WHERE id = ?', toId(id));
    if (!l) throw notFound('Casier');
    return l;
  },

  lockerDetail(id) {
    const row = this.lockerRow(id);
    const locker = this.listLockers().find((l) => l.id === row.id);
    return {
      ...locker,
      items: locker.assignment_id ? this.all('SELECT * FROM locker_items WHERE assignment_id = ? ORDER BY name COLLATE NOCASE', locker.assignment_id) : [],
      assignments: this.all(`SELECT a.*, m.first_name || ' ' || m.last_name AS member_name, u.name AS created_by_name
        FROM locker_assignments a JOIN members m ON m.id = a.member_id LEFT JOIN users u ON u.id = a.created_by
        WHERE a.locker_id = ? ORDER BY a.id DESC LIMIT 30`, row.id),
      movements: this.all(`SELECT mv.*, i.name AS item_name, a.id AS assignment_id,
        m.first_name || ' ' || m.last_name AS member_name, u.name AS created_by_name
        FROM locker_movements mv JOIN locker_items i ON i.id = mv.item_id JOIN locker_assignments a ON a.id = i.assignment_id
        JOIN members m ON m.id = a.member_id LEFT JOIN users u ON u.id = mv.created_by
        WHERE a.locker_id = ? ORDER BY mv.id DESC LIMIT 100`, row.id),
    };
  },

  createLocker(actor, input) {
    const h = this.humidorRow(input.humidor_id);
    const code = text(input.code, 'Numéro du casier', { required: true, max: 20 });
    const notes = text(input.notes, 'Notes', { max: 500 });
    if (this.get('SELECT id FROM lockers WHERE code = ? COLLATE NOCASE', code)) throw conflict('CASIER_EXISTANT', 'Ce numéro de casier existe déjà.');
    const id = this.insert('INSERT INTO lockers (code, humidor_id, notes, created_at, created_by) VALUES (?, ?, ?, ?, ?)', code, h.id, notes, this.nowIso(), actor.id);
    this.audit(actor, 'casier.creer', 'locker', id, { casier: code, cave: h.name });
    return this.lockerDetail(id);
  },

  setLockerAvailability(actor, id, input) {
    const l = this.lockerRow(id);
    if (typeof input.active !== 'boolean') throw invalid('Disponibilité invalide.');
    if (this.get('SELECT id FROM locker_assignments WHERE locker_id = ? AND released_at IS NULL', l.id)) throw conflict('CASIER_OCCUPE', 'Libérez ce casier avant de changer sa disponibilité.');
    const reason = text(input.reason, 'Motif', { required: true, min: 3, max: 300 });
    this.run('UPDATE lockers SET active = ? WHERE id = ?', flag(input.active) ? 1 : 0, l.id);
    this.audit(actor, 'casier.disponibilite', 'locker', l.id, { casier: l.code, disponible: input.active, motif: reason });
    return this.lockerDetail(l.id);
  },

  assignLocker(actor, id, input) {
    const l = this.lockerRow(id);
    if (!l.active) throw conflict('CASIER_INDISPONIBLE', 'Ce casier est indisponible.');
    if (this.get('SELECT id FROM locker_assignments WHERE locker_id = ? AND released_at IS NULL', l.id)) throw conflict('CASIER_OCCUPE', 'Ce casier est déjà attribué.');
    const member = this.memberRow(input.member_id);
    const today = this.loungeToday();
    if (!isValidDate(input.end_date) || input.end_date < today) throw invalid('La date de fin doit être aujourd’hui ou une date ultérieure.');
    const notes = text(input.notes, 'Notes', { max: 500 });
    this.insert(`INSERT INTO locker_assignments (locker_id, member_id, start_date, end_date, notes, created_at, created_by)
      VALUES (?, ?, ?, ?, ?, ?, ?)`, l.id, member.id, today, input.end_date, notes, this.nowIso(), actor.id);
    this.audit(actor, 'casier.attribuer', 'locker', l.id, { casier: l.code, membre: member.id, fin: input.end_date });
    return this.lockerDetail(l.id);
  },

  activeAssignment(id) {
    const a = this.get('SELECT * FROM locker_assignments WHERE id = ?', toId(id));
    if (!a) throw notFound('Attribution');
    if (a.released_at) throw conflict('CASIER_LIBERE', 'Cette attribution est terminée. Rechargez le casier.');
    return a;
  },

  renewLocker(actor, assignmentId, input) {
    const a = this.activeAssignment(assignmentId);
    if (!isValidDate(input.end_date) || input.end_date <= a.end_date || input.end_date < this.loungeToday()) {
      throw invalid('Choisissez une date ultérieure à la fin actuelle et non passée.');
    }
    this.run('UPDATE locker_assignments SET end_date = ? WHERE id = ?', input.end_date, a.id);
    this.audit(actor, 'casier.renouveler', 'locker', a.locker_id, { attribution: a.id, avant: a.end_date, fin: input.end_date });
    return this.lockerDetail(a.locker_id);
  },

  releaseLocker(actor, assignmentId, input) {
    const a = this.activeAssignment(assignmentId);
    if (this.get('SELECT id FROM locker_items WHERE assignment_id = ? AND quantity > 0', a.id)) throw conflict('CASIER_NON_VIDE', 'Enregistrez le retrait de tous les cigares avant de libérer le casier.');
    const reason = text(input.reason, 'Motif', { required: true, min: 3, max: 300 });
    this.run('UPDATE locker_assignments SET released_at = ?, released_by = ?, release_reason = ? WHERE id = ?', this.nowIso(), actor.id, reason, a.id);
    this.audit(actor, 'casier.liberer', 'locker', a.locker_id, { attribution: a.id, motif: reason });
    return this.lockerDetail(a.locker_id);
  },

  depositLockerItems(actor, assignmentId, input) {
    const a = this.activeAssignment(assignmentId);
    if (a.end_date < this.loungeToday()) throw conflict('CASIER_EXPIRE', 'Renouvelez le casier avant un nouveau dépôt. Les retraits restent possibles.');
    const name = text(input.name, 'Cigares déposés', { required: true, max: 100 });
    const quantity = int(input.quantity, 'Quantité', { min: 1, max: 10000 });
    const notes = text(input.notes, 'Observation', { max: 500 });
    let item = this.get('SELECT * FROM locker_items WHERE assignment_id = ? AND name = ? COLLATE NOCASE', a.id, name);
    if (!item) {
      const id = this.insert('INSERT INTO locker_items (assignment_id, name, quantity) VALUES (?, ?, 0)', a.id, name);
      item = { id, quantity: 0 };
    }
    if (item.quantity + quantity > 10000) throw invalid('Maximum 10 000 cigares par référence dans un casier.');
    this.run('UPDATE locker_items SET quantity = quantity + ? WHERE id = ?', quantity, item.id);
    this.insert(`INSERT INTO locker_movements (item_id, kind, quantity, stock_after, notes, created_at, created_by)
      VALUES (?, 'depot', ?, ?, ?, ?, ?)`, item.id, quantity, item.quantity + quantity, notes, this.nowIso(), actor.id);
    this.audit(actor, 'casier.depot', 'locker', a.locker_id, { attribution: a.id, cigare: name, quantite: quantity });
    return this.lockerDetail(a.locker_id);
  },

  withdrawLockerItems(actor, itemId, input) {
    const item = this.get('SELECT * FROM locker_items WHERE id = ?', toId(itemId));
    if (!item) throw notFound('Référence du casier');
    const a = this.activeAssignment(item.assignment_id);
    const quantity = int(input.quantity, 'Quantité', { min: 1, max: 10000 });
    const notes = text(input.notes, 'Observation', { required: true, min: 3, max: 500 });
    if (quantity > item.quantity) throw conflict('CONTENU_INSUFFISANT', `Ce casier contient seulement ${item.quantity} cigare(s) de cette référence.`);
    this.run('UPDATE locker_items SET quantity = quantity - ? WHERE id = ?', quantity, item.id);
    this.insert(`INSERT INTO locker_movements (item_id, kind, quantity, stock_after, notes, created_at, created_by)
      VALUES (?, 'retrait', ?, ?, ?, ?, ?)`, item.id, quantity, item.quantity - quantity, notes, this.nowIso(), actor.id);
    this.audit(actor, 'casier.retrait', 'locker', a.locker_id, { attribution: a.id, cigare: item.name, quantite: quantity, motif: notes });
    return this.lockerDetail(a.locker_id);
  },

  loungeOverview() {
    const humidors = this.all('SELECT * FROM humidors ORDER BY name COLLATE NOCASE').map((h) => this.humidorDTO(h));
    const lockers = this.listLockers();
    return {
      today: this.loungeToday(), now: this.nowIso(), humidors, lockers,
      summary: {
        humidors: humidors.length,
        alerts: humidors.filter((h) => h.outside).length,
        checks_due: humidors.filter((h) => h.stale).length,
        lockers: lockers.length,
        occupied: lockers.filter((l) => l.assignment_id).length,
        available: lockers.filter((l) => l.status === 'libre').length,
        expiring: lockers.filter((l) => ['expire', 'a_renouveler'].includes(l.status)).length,
        cigars: lockers.reduce((sum, l) => sum + l.cigar_count, 0),
      },
    };
  },
};
