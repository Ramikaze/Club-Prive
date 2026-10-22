// Conservation checks of the club's humidors. All writes run inside the API transaction,
// including audit and idempotency.
import { invalid, conflict, notFound } from './errors.js';
import { text, int, toId } from './validate.js';
import { localParts } from '../shared/time.js';

function decimal(value, label, min, max) {
  const raw = typeof value === 'string' ? value.trim().replace(',', '.') : value;
  if (raw === '' || raw == null || !['number', 'string'].includes(typeof raw)) throw invalid(`${label} : valeur obligatoire.`);
  const n = Number(raw);
  if (!Number.isFinite(n) || n < min || n > max || Math.abs(n * 10 - Math.round(n * 10)) > 1e-8) {
    throw invalid(`${label} : entre ${min} et ${max}, avec une décimale maximum.`);
  }
  return n;
}

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

  loungeOverview() {
    const humidors = this.all('SELECT * FROM humidors ORDER BY name COLLATE NOCASE').map((h) => this.humidorDTO(h));
    return {
      today: this.loungeToday(), now: this.nowIso(), humidors,
      summary: {
        humidors: humidors.length,
        alerts: humidors.filter((h) => h.outside).length,
        checks_due: humidors.filter((h) => h.stale).length,
      },
    };
  },
};
