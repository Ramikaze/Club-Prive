// Treasury, manual entries (expenses, other receipts, transfers), general ledger and monthly closing.
// These methods are mixed into Club (end of club.js): `this` is the Club instance, and like the rest
// of the business layer they never open transactions themselves.
// A treasury account is a payment method (Espèces, Carte bancaire...). Opening balances count from
// their date; movements before it are ignored, so the club can start tracking cash at any point.
import { invalid, forbidden, notFound, conflict } from './errors.js';
import { text, int, toId, flag } from './validate.js';
import { addDays, addMonths, isValidDate, localParts } from '../shared/time.js';
import { ACCOUNTS, ACCOUNT_LABELS } from '../shared/rules.js';

// The largest expense a manager may record alone, in hundredths (5 000 FCFA); above it, an administrator records it.
export const MANAGER_EXPENSE_MAX = 5000 * 100;
export const ENTRY_KIND = { depense: 'Dépense', recette: 'Entrée diverse', transfert: 'Transfert' };
export const ENTRY_STATUS = { active: 'Enregistrée', annulee: 'Annulée' };
const CATEGORY_KIND = { depense: 'Dépense', recette: 'Entrée diverse' };
const MOVEMENT_KIND = {
  ouverture: "Solde d'ouverture", encaissement: 'Encaissement', remboursement: 'Remboursement',
  depense: 'Dépense', recette: 'Entrée diverse', transfert: 'Transfert',
};

export const DEFAULT_CATEGORIES = {
  depense: [
    'Loyer', 'Électricité et eau', 'Salaires', 'Achats cigares', 'Achats boissons', 'Entretien et réparations',
    'Communication', 'Frais bancaires', 'Divers',
  ],
  recette: ['Apport des associés', 'Autre entrée'],
};

const MONTHS = ['janvier', 'février', 'mars', 'avril', 'mai', 'juin', 'juillet', 'août', 'septembre', 'octobre', 'novembre', 'décembre'];
export const monthLabel = (month) => `${MONTHS[Number(month.slice(5, 7)) - 1]} ${month.slice(0, 4)}`;
const isMonth = (m) => typeof m === 'string' && /^\d{4}-(0[1-9]|1[0-2])$/.test(m);
const monthBounds = (month) => [`${month}-01`, addDays(addMonths(`${month}-01`, 1), -1)];
const EARLIEST = '2000-01-01';

export const ledgerMethods = {
  // ---------------------------------------------------------------- periods

  dayStartIso(day) {
    return this.periodBounds(day, day)[0];
  },

  assertOpen(day, what) {
    if (this.get('SELECT 1 AS x FROM closed_periods WHERE month = ?', day.slice(0, 7))) {
      throw conflict(
        'PERIODE_CLOTUREE',
        `${what} tombe en ${monthLabel(day.slice(0, 7))}, une période clôturée. Un administrateur doit d'abord la rouvrir.`,
      );
    }
  },

  normalizeOpeningBalances(v, current) {
    if (!v || typeof v !== 'object' || Array.isArray(v)) throw invalid("Soldes d'ouverture invalides.");
    const date = v.date === undefined || v.date === null || v.date === '' ? null : v.date;
    if (date !== null && !isValidDate(date)) throw invalid("Date des soldes d'ouverture invalide.");
    if (v.amounts !== undefined && (v.amounts === null || typeof v.amounts !== 'object' || Array.isArray(v.amounts))) {
      throw invalid("Soldes d'ouverture invalides.");
    }
    const amounts = {};
    for (const [k, n] of Object.entries(v.amounts ?? {})) {
      const key = text(k, 'Compte de trésorerie', { required: true, max: 40 });
      const amount = int(n, `Solde d'ouverture (${key})`, { min: -1e13, max: 1e13 });
      if (amount !== 0) amounts[key] = amount;
    }
    const same = (a, b) => JSON.stringify(Object.entries(a).sort()) === JSON.stringify(Object.entries(b).sort());
    const changed = date !== current.date || !same(amounts, current.amounts);
    if (changed && this.get('SELECT 1 AS x FROM closed_periods LIMIT 1')) {
      throw conflict('PERIODE_CLOTUREE', "Des mois sont clôturés : rouvrez-les avant de modifier les soldes d'ouverture.");
    }
    return { date, amounts };
  },

  // ---------------------------------------------------------------- categories

  categoryDTO(c) {
    return { id: c.id, kind: c.kind, kind_label: CATEGORY_KIND[c.kind], name: c.name, active: !!c.active };
  },

  listCategories() {
    return this.all('SELECT * FROM categories ORDER BY kind, active DESC, name').map((c) => this.categoryDTO(c));
  },

  createCategory(actor, input) {
    if (!CATEGORY_KIND[input.kind]) throw invalid('Type de catégorie invalide.');
    const name = text(input.name, 'Nom de la catégorie', { required: true, max: 60 });
    if (this.get('SELECT 1 AS x FROM categories WHERE kind = ? AND name = ?', input.kind, name)) {
      throw conflict('CATEGORIE_EXISTANTE', 'Cette catégorie existe déjà.');
    }
    const id = this.insert(
      'INSERT INTO categories (kind, name, created_at, created_by) VALUES (?, ?, ?, ?)', input.kind, name, this.nowIso(), actor.id,
    );
    this.audit(actor, 'categorie.creer', 'category', id, { type: input.kind, nom: name });
    return this.listCategories();
  },

  updateCategory(actor, categoryId, input) {
    const c = this.get('SELECT * FROM categories WHERE id = ?', toId(categoryId, 'Catégorie'));
    if (!c) throw notFound('Catégorie');
    const name = input.name !== undefined ? text(input.name, 'Nom de la catégorie', { required: true, max: 60 }) : c.name;
    const active = input.active !== undefined ? flag(input.active) : !!c.active;
    if (this.get('SELECT 1 AS x FROM categories WHERE kind = ? AND name = ? AND id <> ?', c.kind, name, c.id)) {
      throw conflict('CATEGORIE_EXISTANTE', 'Cette catégorie existe déjà.');
    }
    this.run('UPDATE categories SET name = ?, active = ? WHERE id = ?', name, active ? 1 : 0, c.id);
    this.audit(actor, 'categorie.modifier', 'category', c.id, {
      avant: { nom: c.name, active: !!c.active }, apres: { nom: name, active },
    });
    return this.listCategories();
  },

  // ---------------------------------------------------------------- manual entries

  entryDTO(e) {
    return {
      id: e.id, kind: e.kind, kind_label: ENTRY_KIND[e.kind], biz_date: e.biz_date,
      category_id: e.category_id, category_name: e.category_name ?? null,
      account: e.account, account_label: e.account ? ACCOUNT_LABELS[e.account] : null,
      method: e.method, to_method: e.to_method, amount: e.amount, label: e.label, reference: e.reference,
      status: e.status, status_label: ENTRY_STATUS[e.status], is_demo: !!e.is_demo,
      created_at: e.created_at, created_by_name: e.created_by_name ?? null,
      cancelled_at: e.cancelled_at, cancelled_by_name: e.cancelled_by_name ?? null, cancel_reason: e.cancel_reason,
      period_closed: !!e.period_closed,
    };
  },

  entryRows(where, ...params) {
    return this.all(
      `SELECT e.*, c.name AS category_name, u.name AS created_by_name, cu.name AS cancelled_by_name,
         EXISTS (SELECT 1 FROM closed_periods cp WHERE cp.month = substr(e.biz_date, 1, 7)) AS period_closed
       FROM ledger_entries e
       LEFT JOIN categories c ON c.id = e.category_id
       LEFT JOIN users u ON u.id = e.created_by
       LEFT JOIN users cu ON cu.id = e.cancelled_by
       WHERE ${where} ORDER BY e.biz_date DESC, e.id DESC`,
      ...params,
    ).map((e) => this.entryDTO(e));
  },

  // The manager only sees the current business day, like the cash journal.
  listEntries(query, actor) {
    const restricted = !!actor && actor.role !== 'admin';
    const from = restricted ? this.bizToday() : query.from;
    const to = restricted ? from : (query.to ?? query.from);
    this.periodBounds(from, to);
    const kind = ENTRY_KIND[query.kind] ? query.kind : null;
    const entries = kind
      ? this.entryRows('e.biz_date >= ? AND e.biz_date <= ? AND e.kind = ?', from, to, kind)
      : this.entryRows('e.biz_date >= ? AND e.biz_date <= ?', from, to);
    return { from, to, restricted, entries };
  },

  treasuryAccount(v, label) {
    const method = text(v, label, { required: true, max: 40 });
    if (!this.settings().payment_methods.includes(method)) throw invalid(`${label} : compte de trésorerie non configuré.`);
    return method;
  },

  createEntry(actor, input, { demo = false } = {}) {
    const kind = input.kind;
    if (!ENTRY_KIND[kind]) throw invalid("Type d'opération invalide.");
    const isAdmin = actor.role === 'admin';
    if (!isAdmin && kind !== 'depense') {
      throw forbidden('Seul un administrateur peut enregistrer une entrée diverse ou un transfert.');
    }
    const today = this.bizToday();
    const date = input.biz_date === undefined || input.biz_date === null || input.biz_date === '' ? today : input.biz_date;
    if (!isValidDate(date)) throw invalid('Date invalide.');
    if (date > today) throw invalid('La date ne peut pas être dans le futur.');
    if (!isAdmin && date !== today) {
      throw forbidden("Le gérant enregistre les dépenses du jour. Pour une autre date, adressez-vous à un administrateur.");
    }
    this.assertOpen(date, 'Cette opération');
    const amount = int(input.amount, 'Montant', { min: 1, max: 1e13 });
    if (!isAdmin && amount > MANAGER_EXPENSE_MAX) {
      throw forbidden("Le gérant enregistre des dépenses de 5 000 FCFA au plus. Au-delà, adressez-vous à un administrateur.");
    }
    const method = this.treasuryAccount(input.method, kind === 'transfert' ? 'Compte de départ' : kind === 'depense' ? 'Payé depuis' : 'Reçu sur');
    let toMethod = null;
    let category = null;
    let account = null;
    if (kind === 'transfert') {
      toMethod = this.treasuryAccount(input.to_method, "Compte d'arrivée");
      if (toMethod === method) throw invalid("Les comptes de départ et d'arrivée doivent être différents.");
    } else {
      category = this.get('SELECT * FROM categories WHERE id = ?', toId(input.category_id, 'Catégorie'));
      if (!category || category.kind !== kind || !category.active) throw invalid('Catégorie invalide ou inactive.');
      if (kind === 'depense' && input.account) {
        if (!ACCOUNTS.includes(input.account)) throw invalid('Sous-compte invalide.');
        account = input.account;
      }
    }
    const label = text(input.label, 'Libellé', { max: 120 }) ?? (kind === 'transfert' ? `Transfert ${method} → ${toMethod}` : category.name);
    const reference = text(input.reference, 'Référence', { max: 80 });
    const id = this.insert(
      `INSERT INTO ledger_entries (kind, biz_date, category_id, account, method, to_method, amount, label, reference,
         status, is_demo, created_at, created_by)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'active', ?, ?, ?)`,
      kind, date, category?.id ?? null, account, method, toMethod, amount, label, reference, demo ? 1 : 0, this.nowIso(), actor.id,
    );
    this.audit(actor, 'operation.creer', 'ledger', id, {
      type: kind, date, montant: amount, compte: method, vers: toMethod, categorie: category?.name ?? null,
      sous_compte: account, libelle: label,
    });
    return this.entryRows('e.id = ?', id)[0];
  },

  cancelEntry(actor, entryId, input) {
    const e = this.get('SELECT * FROM ledger_entries WHERE id = ?', toId(entryId, 'Opération'));
    if (!e) throw notFound('Opération');
    if (e.status !== 'active') throw conflict('DEJA_ANNULEE', 'Opération déjà annulée.');
    this.assertOpen(e.biz_date, 'Cette opération');
    const reason = text(input.reason, "Motif d'annulation", { required: true, min: 3, max: 300 });
    this.run(
      "UPDATE ledger_entries SET status = 'annulee', cancelled_at = ?, cancelled_by = ?, cancel_reason = ? WHERE id = ?",
      this.nowIso(), actor.id, reason, e.id,
    );
    this.audit(actor, 'operation.annuler', 'ledger', e.id, { type: e.kind, date: e.biz_date, montant: e.amount, motif: reason });
    return this.entryRows('e.id = ?', e.id)[0];
  },

  // ---------------------------------------------------------------- treasury

  treasuryMethods() {
    const s = this.settings();
    const methods = new Set(s.payment_methods);
    for (const k of Object.keys(s.opening_balances.amounts)) methods.add(k);
    for (const r of this.all(
      `SELECT method FROM payments UNION SELECT method FROM refunds UNION SELECT method FROM ledger_entries
       UNION SELECT to_method FROM ledger_entries WHERE to_method IS NOT NULL`,
    )) methods.add(r.method);
    return [...methods];
  },

  // Inflows and outflows per treasury account over the business days [from, to].
  cashFlows(from, to) {
    const flows = {};
    const add = (method, field, amount) => {
      flows[method] ??= { in: 0, out: 0 };
      flows[method][field] += amount;
    };
    if (to < from) return flows;
    const a = this.dayStartIso(from);
    const b = this.dayStartIso(addDays(to, 1));
    for (const r of this.all('SELECT method, SUM(amount) AS total FROM payments WHERE paid_at >= ? AND paid_at < ? GROUP BY method', a, b)) {
      add(r.method, 'in', r.total);
    }
    for (const r of this.all('SELECT method, SUM(amount) AS total FROM refunds WHERE created_at >= ? AND created_at < ? GROUP BY method', a, b)) {
      add(r.method, 'out', r.total);
    }
    for (const r of this.all(
      `SELECT kind, method, to_method, SUM(amount) AS total FROM ledger_entries
       WHERE status = 'active' AND biz_date >= ? AND biz_date <= ? GROUP BY kind, method, to_method`, from, to,
    )) {
      if (r.kind === 'depense') add(r.method, 'out', r.total);
      else if (r.kind === 'recette') add(r.method, 'in', r.total);
      else {
        add(r.method, 'out', r.total);
        add(r.to_method, 'in', r.total);
      }
    }
    return flows;
  },

  treasuryBalances(from, to) {
    this.periodBounds(from, to);
    const ob = this.settings().opening_balances;
    const start = ob.date ?? EARLIEST;
    const before = start < from ? this.cashFlows(start, addDays(from, -1)) : {};
    const during = this.cashFlows(start > from ? start : from, to);
    const initialBefore = !ob.date || ob.date < from;
    const initialDuring = !!ob.date && ob.date >= from && ob.date <= to;
    const accounts = this.treasuryMethods().map((method) => {
      const initial = ob.amounts[method] ?? 0;
      const opening = (initialBefore ? initial : 0) + (before[method]?.in ?? 0) - (before[method]?.out ?? 0);
      const inflow = (initialDuring ? Math.max(initial, 0) : 0) + (during[method]?.in ?? 0);
      const outflow = (initialDuring ? Math.max(-initial, 0) : 0) + (during[method]?.out ?? 0);
      return { method, opening, in: inflow, out: outflow, closing: opening + inflow - outflow };
    });
    const total = { method: 'Total', opening: 0, in: 0, out: 0, closing: 0 };
    for (const x of accounts) for (const f of ['opening', 'in', 'out', 'closing']) total[f] += x[f];
    return { from, to, opening_date: ob.date, accounts, total };
  },

  // Simplified result: net collected per sub-account minus expenses. Other receipts (such as
  // partners' contributions) move cash but are not revenue, so they are shown apart.
  periodResult(from, to) {
    const sales = this.financeSummary(from, to);
    const byAccount = { reservations: 0, alcool: 0, cigares: 0 };
    const byCategory = new Map();
    let general = 0;
    let expenses = 0;
    for (const r of this.all(
      `SELECT e.category_id, c.name, e.account, SUM(e.amount) AS total FROM ledger_entries e
       JOIN categories c ON c.id = e.category_id
       WHERE e.status = 'active' AND e.kind = 'depense' AND e.biz_date >= ? AND e.biz_date <= ?
       GROUP BY e.category_id, e.account`, from, to,
    )) {
      expenses += r.total;
      if (r.account) byAccount[r.account] += r.total;
      else general += r.total;
      const cat = byCategory.get(r.category_id) ?? { category_id: r.category_id, name: r.name, total: 0 };
      cat.total += r.total;
      byCategory.set(r.category_id, cat);
    }
    const { other } = this.get(
      `SELECT COALESCE(SUM(amount), 0) AS other FROM ledger_entries
       WHERE status = 'active' AND kind = 'recette' AND biz_date >= ? AND biz_date <= ?`, from, to,
    );
    return {
      from, to,
      revenue: sales.total.net, expenses, result: sales.total.net - expenses, other_receipts: other,
      accounts: sales.accounts.map((x) => ({
        account: x.account, label: x.label, net: x.net, expenses: byAccount[x.account], margin: x.net - byAccount[x.account],
      })),
      general_expenses: general,
      expenses_by_category: [...byCategory.values()].sort((x, y) => y.total - x.total),
    };
  },

  treasury(from, to) {
    return { ...this.treasuryBalances(from, to), result: this.periodResult(from, to) };
  },

  // ---------------------------------------------------------------- general ledger

  movements(from, to) {
    const s = this.settings();
    const tz = s.timezone;
    const ob = s.opening_balances;
    const start = ob.date && ob.date > from ? ob.date : from;
    const rows = [];
    if (start > to) return rows;
    const a = this.dayStartIso(start);
    const b = this.dayStartIso(addDays(to, 1));
    const when = (iso) => {
      const ms = Date.parse(iso);
      return { at: iso, biz_day: this.bizDayOf(ms), time: localParts(ms, tz).time };
    };
    if (ob.date && ob.date >= from && ob.date <= to) {
      for (const [method, amount] of Object.entries(ob.amounts)) {
        rows.push({
          key: `O-${method}`, at: this.dayStartIso(ob.date), biz_day: ob.date, time: '', type: 'ouverture', ref: '',
          label: "Solde d'ouverture", detail: '', reference: null, account: null, method,
          in: Math.max(amount, 0), out: Math.max(-amount, 0),
        });
      }
    }
    for (const r of this.all(
      `SELECT pa.id, pa.account, pa.amount, p.id AS payment_id, p.paid_at, p.method, p.reference, c.label, m.first_name, m.last_name
       FROM payment_allocations pa JOIN payments p ON p.id = pa.payment_id JOIN charges c ON c.id = pa.charge_id
       JOIN members m ON m.id = p.member_id
       WHERE p.paid_at >= ? AND p.paid_at < ? ORDER BY p.paid_at, pa.id`, a, b,
    )) {
      rows.push({
        key: `E-${r.id}`, ...when(r.paid_at), type: 'encaissement', ref: `ENC-${r.payment_id}`, label: r.label,
        detail: `${r.first_name} ${r.last_name}`, reference: r.reference, account: r.account, method: r.method, in: r.amount, out: 0,
      });
    }
    for (const r of this.all(
      `SELECT rf.*, c.label, m.first_name, m.last_name FROM refunds rf
       JOIN charges c ON c.id = rf.charge_id JOIN members m ON m.id = c.member_id
       WHERE rf.created_at >= ? AND rf.created_at < ? ORDER BY rf.created_at, rf.id`, a, b,
    )) {
      rows.push({
        key: `R-${r.id}`, ...when(r.created_at), type: 'remboursement', ref: `RMB-${r.id}`, label: `Remboursement : ${r.label}`,
        detail: `${r.first_name} ${r.last_name} — ${r.reason}`, reference: r.reference, account: r.account, method: r.method,
        in: 0, out: r.amount,
      });
    }
    for (const e of this.all(
      `SELECT e.*, c.name AS category_name FROM ledger_entries e LEFT JOIN categories c ON c.id = e.category_id
       WHERE e.status = 'active' AND e.biz_date >= ? AND e.biz_date <= ? ORDER BY e.biz_date, e.id`, start, to,
    )) {
      // An entry typed on its own day keeps its time; a backdated one sits at the start of its day.
      const created = when(e.created_at);
      const at = created.biz_day === e.biz_date ? created : { at: this.dayStartIso(e.biz_date), biz_day: e.biz_date, time: '' };
      const base = { ...at, ref: `OP-${e.id}`, label: e.label, reference: e.reference, account: e.account };
      if (e.kind === 'transfert') {
        rows.push({ ...base, key: `T-${e.id}-out`, type: 'transfert', detail: `Vers ${e.to_method}`, method: e.method, in: 0, out: e.amount });
        rows.push({ ...base, key: `T-${e.id}-in`, type: 'transfert', detail: `Depuis ${e.method}`, method: e.to_method, in: e.amount, out: 0 });
      } else {
        rows.push({
          ...base, key: `${e.kind === 'depense' ? 'D' : 'C'}-${e.id}`, type: e.kind, detail: e.category_name ?? '', method: e.method,
          in: e.kind === 'recette' ? e.amount : 0, out: e.kind === 'depense' ? e.amount : 0,
        });
      }
    }
    rows.sort((x, y) => (x.at < y.at ? -1 : x.at > y.at ? 1 : 0));
    return rows.map((r) => ({ ...r, type_label: MOVEMENT_KIND[r.type], account_label: r.account ? ACCOUNT_LABELS[r.account] : null }));
  },

  // Chronological book of every cash movement. The running balance is the treasury balance (one
  // account or all of them); filtered by sub-account, the rows are shown without a balance.
  ledgerBook(query) {
    const from = query.from;
    const to = query.to ?? query.from;
    this.periodBounds(from, to);
    const method = query.method ? text(query.method, 'Compte', { max: 40 }) : null;
    const account = ACCOUNTS.includes(query.account) ? query.account : null;
    let rows = this.movements(from, to);
    if (method) rows = rows.filter((r) => r.method === method);
    if (account) rows = rows.filter((r) => r.account === account);
    let opening = null;
    if (!account) {
      const t = this.treasuryBalances(from, to);
      opening = method ? (t.accounts.find((x) => x.method === method)?.opening ?? 0) : t.total.opening;
    }
    let balance = opening ?? 0;
    const lines = rows.map((r) => {
      balance += r.in - r.out;
      return { ...r, balance: account ? null : balance };
    });
    const totals = rows.reduce((t, r) => ({ in: t.in + r.in, out: t.out + r.out }), { in: 0, out: 0 });
    return {
      from, to, method, account, opening, rows: lines, totals, closing: account ? null : balance,
      methods: this.treasuryMethods(),
    };
  },

  // ---------------------------------------------------------------- monthly closing

  closings() {
    const current = this.bizToday().slice(0, 7);
    const closed = this.all(
      `SELECT cp.*, u.name AS closed_by_name FROM closed_periods cp LEFT JOIN users u ON u.id = cp.closed_by
       ORDER BY cp.month DESC`,
    ).map((c) => ({
      month: c.month, label: monthLabel(c.month), closed_at: c.closed_at, closed_by_name: c.closed_by_name ?? null,
      summary: JSON.parse(c.summary),
    }));
    const closedMonths = new Set(closed.map((c) => c.month));
    const months = [];
    let month = current;
    for (let i = 0; i < 12; i += 1) {
      const [first, last] = monthBounds(month);
      const { n } = this.get(
        "SELECT COUNT(*) AS n FROM reservations WHERE biz_day >= ? AND biz_day <= ? AND status IN ('reservee', 'en_cours')", first, last,
      );
      months.push({
        month, label: monthLabel(month), first, last, current: month === current, closed: closedMonths.has(month),
        closable: month < current && !closedMonths.has(month), open_reservations: n,
      });
      month = addMonths(first, -1).slice(0, 7);
    }
    return { current_month: current, months, closed };
  },

  closeMonth(actor, input) {
    const month = input.month;
    if (!isMonth(month)) throw invalid('Mois invalide (format AAAA-MM).');
    if (month >= this.bizToday().slice(0, 7)) throw invalid('Seul un mois terminé peut être clôturé.');
    if (this.get('SELECT 1 AS x FROM closed_periods WHERE month = ?', month)) {
      throw conflict('DEJA_CLOTURE', `Le mois de ${monthLabel(month)} est déjà clôturé.`);
    }
    const [first, last] = monthBounds(month);
    const { n } = this.get(
      "SELECT COUNT(*) AS n FROM reservations WHERE biz_day >= ? AND biz_day <= ? AND status IN ('reservee', 'en_cours')", first, last,
    );
    if (n > 0) {
      throw conflict('RESERVATIONS_OUVERTES', `${n} réservation(s) de ${monthLabel(month)} ne sont ni terminées ni annulées : traitez-les avant la clôture.`);
    }
    const summary = { treasury: this.treasuryBalances(first, last), result: this.periodResult(first, last) };
    this.run(
      'INSERT INTO closed_periods (month, closed_at, closed_by, summary) VALUES (?, ?, ?, ?)',
      month, this.nowIso(), actor.id, JSON.stringify(summary),
    );
    this.audit(actor, 'periode.cloturer', 'period', null, {
      mois: month, resultat: summary.result.result, tresorerie_fin: summary.treasury.total.closing,
    });
    return this.closings();
  },

  reopenMonth(actor, month, input) {
    if (!isMonth(month)) throw invalid('Mois invalide (format AAAA-MM).');
    const row = this.get('SELECT * FROM closed_periods WHERE month = ?', month);
    if (!row) throw conflict('NON_CLOTURE', `Le mois de ${monthLabel(month)} n'est pas clôturé.`);
    const reason = text(input.reason, 'Motif de réouverture', { required: true, min: 3, max: 300 });
    this.run('DELETE FROM closed_periods WHERE month = ?', month);
    this.audit(actor, 'periode.rouvrir', 'period', null, {
      mois: month, motif: reason, cloture_du: row.closed_at, synthese_a_la_cloture: JSON.parse(row.summary),
    });
    return this.closings();
  },
};
