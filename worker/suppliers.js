// Supplier accounts (spec docs/superpowers/specs/2026-11-07-comptes-fournisseurs-design.md). These methods are mixed
// into Club (end of club.js) like the ledger's: `this` is the Club instance, and they never open transactions
// themselves. What the club owes a supplier = the balances carried over + the credit purchases − the payments, the
// cancelled ones left out, never below zero. A purchase moves no money: no caisse and no till changes. A payment is an
// ordinary expense of the supplier's caisse (ledger_entries.supplier_id, see createEntry), so the caisses, the
// treasury, the ledger book and the result count it with no code of their own, and it is cancelled like any entry.
// The amounts are kept in FCFA; an amount in euros or dollars rides along, for information only.
import { invalid, forbidden, notFound, conflict } from './errors.js';
import { text, int, toId, flag } from './validate.js';
import { isValidDate } from '../shared/time.js';
import { isBoss } from '../shared/roles.js';
import { CAISSE_LABEL, purchaseAccount } from '../shared/caisses.js';
import { FOREIGN_CURRENCIES, SUPPLIER_CAISSES, PURCHASE_KINDS, PURCHASE_KIND_LABEL } from '../shared/suppliers.js';
import { monthLabel } from './ledger.js';

const LINE_KIND_LABEL = { ...PURCHASE_KIND_LABEL, paiement: 'Paiement' };
const empty = (v) => v === undefined || v === null || v === '';

// The purchases and the payments of one supplier still counted, as SQL on the supplier row `s`.
const PURCHASED_SQL = "(SELECT COALESCE(SUM(amount), 0) FROM supplier_purchases WHERE supplier_id = s.id AND status = 'active')";
const PAID_SQL = "(SELECT COALESCE(SUM(amount), 0) FROM ledger_entries WHERE supplier_id = s.id AND status = 'active')";

function requireBoss(actor) {
  if (!isBoss(actor)) throw forbidden('Seuls l’administrateur et les associés gèrent les comptes fournisseurs.');
}

// An amount in euros or dollars, for information: both the amount and its currency, or neither.
function foreignPair(input) {
  if (empty(input.foreign_amount) && empty(input.foreign_currency)) return { amount: null, currency: null };
  if (empty(input.foreign_amount) || empty(input.foreign_currency)) {
    throw invalid('Montant en devise : indiquez le montant et sa devise (EUR ou USD), ou ni l’un ni l’autre.');
  }
  if (!FOREIGN_CURRENCIES.includes(input.foreign_currency)) throw invalid('Devise invalide : EUR ou USD.');
  return { amount: int(input.foreign_amount, 'Montant en devise', { min: 1, max: 1e13 }), currency: input.foreign_currency };
}

export const supplierMethods = {
  supplierDTO(s) {
    return {
      id: s.id, name: s.name, account: s.account, account_label: CAISSE_LABEL[s.account],
      country: s.country ?? null, currency: s.currency ?? null, contact: s.contact ?? null, notes: s.notes ?? null,
      active: !!s.active, is_demo: !!s.is_demo, due: s.due, last_date: s.last_date ?? null, has_operations: !!s.has_operations,
    };
  },

  supplierRows(where, ...params) {
    return this.all(
      `SELECT s.*, ${PURCHASED_SQL} - ${PAID_SQL} AS due,
         (SELECT MAX(biz_date) FROM supplier_purchases WHERE supplier_id = s.id AND status = 'active') AS last_purchase,
         (SELECT MAX(biz_date) FROM ledger_entries WHERE supplier_id = s.id AND status = 'active') AS last_payment,
         EXISTS (SELECT 1 FROM supplier_purchases WHERE supplier_id = s.id)
           OR EXISTS (SELECT 1 FROM ledger_entries WHERE supplier_id = s.id) AS has_operations
       FROM suppliers s WHERE ${where} ORDER BY s.active DESC, s.name`,
      ...params,
    ).map((s) => {
      const dates = [s.last_purchase, s.last_payment].filter(Boolean).sort();
      return this.supplierDTO({ ...s, last_date: dates.at(-1) ?? null });
    });
  },

  supplierOrThrow(id) {
    const s = this.supplierRows('s.id = ?', toId(id, 'Fournisseur'))[0];
    if (!s) throw notFound('Fournisseur');
    return s;
  },

  supplierDue(supplierId) {
    return this.get(`SELECT ${PURCHASED_SQL} - ${PAID_SQL} AS due FROM suppliers s WHERE s.id = ?`, supplierId)?.due ?? 0;
  },

  // Every supplier, active ones first, with what the club owes each, and the total owed per caisse.
  listSuppliers() {
    const suppliers = this.supplierRows('1 = 1');
    const totals = { alcool: 0, cigares: 0 };
    for (const s of suppliers) totals[s.account] += s.due;
    return { suppliers, totals };
  },

  // The fields of a supplier sheet, from the input over the current values (an update changes only what it sends).
  supplierFields(input, current = {}) {
    const pick = (k) => (input[k] === undefined ? current[k] : input[k]);
    const account = pick('account');
    if (!SUPPLIER_CAISSES.includes(account)) {
      throw invalid('Caisse invalide : un fournisseur est payé depuis la caisse « Cigare » ou « Champagne et autres boissons ».');
    }
    const currency = empty(pick('currency')) ? null : pick('currency');
    if (currency !== null && !FOREIGN_CURRENCIES.includes(currency)) throw invalid('Devise invalide : EUR ou USD.');
    return {
      name: text(pick('name'), 'Nom du fournisseur', { required: true, max: 80 }),
      account,
      country: text(pick('country'), 'Pays ou ville', { max: 60 }),
      currency,
      contact: text(pick('contact'), 'Contact', { max: 120 }),
      notes: text(pick('notes'), 'Notes', { max: 300 }),
    };
  },

  assertSupplierNameFree(name, exceptId = 0) {
    if (this.get('SELECT 1 AS x FROM suppliers WHERE name = ? AND id <> ?', name, exceptId)) {
      throw conflict('FOURNISSEUR_EXISTANT', `Un fournisseur s’appelle déjà « ${name} ».`);
    }
  },

  createSupplier(actor, input, { demo = false } = {}) {
    requireBoss(actor);
    const f = this.supplierFields(input ?? {});
    this.assertSupplierNameFree(f.name);
    const id = this.insert(
      `INSERT INTO suppliers (name, account, country, currency, contact, notes, active, is_demo, created_at, created_by)
       VALUES (?, ?, ?, ?, ?, ?, 1, ?, ?, ?)`,
      f.name, f.account, f.country, f.currency, f.contact, f.notes, demo ? 1 : 0, this.nowIso(), actor.id,
    );
    this.audit(actor, 'fournisseur.creer', 'supplier', id, { nom: f.name, caisse: CAISSE_LABEL[f.account], pays: f.country, devise: f.currency });
    return this.supplierOrThrow(id);
  },

  // The caisse is locked once the supplier has an operation (its payments left that caisse); a supplier is
  // deactivated only when the club owes it nothing.
  updateSupplier(actor, id, input) {
    requireBoss(actor);
    const s = this.supplierOrThrow(id);
    const f = this.supplierFields(input ?? {}, s);
    const active = input?.active === undefined ? s.active : flag(input.active);
    if (f.account !== s.account && s.has_operations) {
      throw conflict(
        'CAISSE_VERROUILLEE',
        `« ${s.name} » a déjà des opérations : sa caisse ne se change plus. Ses paiements sont sortis de la caisse « ${CAISSE_LABEL[s.account]} ».`,
      );
    }
    if (!active && s.active && s.due > 0) {
      throw conflict('DETTE_EN_COURS', `Le club doit encore ${this.money(s.due)} à « ${s.name} » : il se désactive seulement quand il ne lui doit plus rien.`);
    }
    this.assertSupplierNameFree(f.name, s.id);
    this.run(
      `UPDATE suppliers SET name = ?, account = ?, country = ?, currency = ?, contact = ?, notes = ?, active = ?, updated_at = ?, updated_by = ?
       WHERE id = ?`,
      f.name, f.account, f.country, f.currency, f.contact, f.notes, active ? 1 : 0, this.nowIso(), actor.id, s.id,
    );
    const before = { nom: s.name, caisse: CAISSE_LABEL[s.account], pays: s.country, devise: s.currency, contact: s.contact, notes: s.notes, actif: s.active };
    const after = { nom: f.name, caisse: CAISSE_LABEL[f.account], pays: f.country, devise: f.currency, contact: f.contact, notes: f.notes, actif: active };
    this.audit(actor, 'fournisseur.modifier', 'supplier', s.id, { avant: before, apres: after });
    return this.supplierOrThrow(s.id);
  },

  // A purchase moves no money: a cash day closed does not stop it, a closed month does (like any operation).
  assertSupplierMonthOpen(day, what) {
    if (this.get('SELECT 1 AS x FROM closed_periods WHERE month = ?', day.slice(0, 7))) {
      throw conflict(
        'PERIODE_CLOTUREE',
        `${what} tombe en ${monthLabel(day.slice(0, 7))}, une période clôturée. Un administrateur ou un associé doit d'abord la rouvrir.`,
      );
    }
  },

  // A credit purchase, or the balance owed before the application (« Solde reporté »): the debt goes up, nothing else.
  recordSupplierPurchase(actor, supplierId, input, { demo = false } = {}) {
    requireBoss(actor);
    const s = this.supplierOrThrow(supplierId);
    const kind = input?.kind ?? 'achat';
    if (!PURCHASE_KINDS.includes(kind)) throw invalid('Type d’opération invalide : achat ou solde reporté.');
    if (!s.active) throw conflict('FOURNISSEUR_INACTIF', `« ${s.name} » est désactivé : réactivez-le avant d’enregistrer un achat.`);
    const today = this.bizToday();
    const date = empty(input.biz_date) ? today : input.biz_date;
    if (!isValidDate(date)) throw invalid('Date invalide.');
    if (date > today) throw invalid('La date ne peut pas être dans le futur.');
    this.assertSupplierMonthOpen(date, kind === 'report' ? 'Ce solde reporté' : 'Cet achat');
    const amount = int(input.amount, 'Montant', { min: 1, max: 1e13 });
    const foreign = foreignPair(input);
    const reference = text(input.reference, 'N° de facture', { max: 80 });
    const label = text(input.label, 'Libellé', { max: 120 }) ?? PURCHASE_KIND_LABEL[kind];
    const id = this.insert(
      `INSERT INTO supplier_purchases (supplier_id, kind, biz_date, amount, foreign_amount, foreign_currency, reference, label,
         status, is_demo, created_at, created_by)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'active', ?, ?, ?)`,
      s.id, kind, date, amount, foreign.amount, foreign.currency, reference, label, demo ? 1 : 0, this.nowIso(), actor.id,
    );
    this.audit(actor, 'fournisseur.achat', 'supplier', s.id, {
      nom: s.name, type: PURCHASE_KIND_LABEL[kind], date, montant: amount, montant_devise: foreign.amount, devise: foreign.currency,
      reference, achat: id,
    });
    return this.supplierSheet(s.id);
  },

  // Cancelling a purchase lowers the debt; refused when the club has already paid more than would remain owed (the
  // debt never goes below zero: cancel a payment first).
  cancelSupplierPurchase(actor, purchaseId, input) {
    requireBoss(actor);
    const p = this.get('SELECT * FROM supplier_purchases WHERE id = ?', toId(purchaseId, 'Achat'));
    if (!p) throw notFound('Achat');
    if (p.status !== 'active') throw conflict('DEJA_ANNULEE', 'Opération déjà annulée.');
    const reason = text(input?.reason, "Motif d'annulation", { required: true, min: 3, max: 300 });
    this.assertSupplierMonthOpen(p.biz_date, p.kind === 'report' ? 'Ce solde reporté' : 'Cet achat');
    const s = this.supplierOrThrow(p.supplier_id);
    if (s.due - p.amount < 0) {
      throw conflict(
        'PAIEMENTS_SUPERIEURS',
        `Le club a déjà payé à « ${s.name} » plus que ce qui resterait dû : annulez d’abord un paiement (Caisse, bloc Dépenses).`,
      );
    }
    this.run(
      "UPDATE supplier_purchases SET status = 'annulee', cancelled_at = ?, cancelled_by = ?, cancel_reason = ? WHERE id = ?",
      this.nowIso(), actor.id, reason, p.id,
    );
    this.audit(actor, 'fournisseur.achat_annuler', 'supplier', s.id, {
      nom: s.name, type: PURCHASE_KIND_LABEL[p.kind], date: p.biz_date, montant: p.amount, motif: reason, achat: p.id,
    });
    return this.supplierSheet(s.id);
  },

  // The supplier's statement: Date, Opération, Dû, Réglé, Solde (the same form as a client's receivable sheet), in
  // the order of the dates. A cancelled line stays, with its reason, and no longer counts (no running balance).
  supplierSheet(id) {
    const supplier = this.supplierOrThrow(id);
    const lines = [];
    for (const p of this.all(
      `SELECT p.*, u.name AS created_by_name, cu.name AS cancelled_by_name FROM supplier_purchases p
       LEFT JOIN users u ON u.id = p.created_by LEFT JOIN users cu ON cu.id = p.cancelled_by WHERE p.supplier_id = ?`, supplier.id,
    )) {
      lines.push({
        key: `A-${p.id}`, date: p.biz_date, created_at: p.created_at, kind: p.kind, kind_label: LINE_KIND_LABEL[p.kind],
        label: p.label, reference: p.reference, method: null, category_name: null, due: p.amount, paid: 0,
        foreign_amount: p.foreign_amount, foreign_currency: p.foreign_currency, status: p.status, cancel_reason: p.cancel_reason,
        cancelled_at: p.cancelled_at, cancelled_by_name: p.cancelled_by_name ?? null, created_by_name: p.created_by_name ?? null,
        purchase_id: p.id, entry_id: null,
      });
    }
    for (const e of this.all(
      `SELECT e.*, c.name AS category_name, u.name AS created_by_name, cu.name AS cancelled_by_name FROM ledger_entries e
       LEFT JOIN categories c ON c.id = e.category_id LEFT JOIN users u ON u.id = e.created_by
       LEFT JOIN users cu ON cu.id = e.cancelled_by WHERE e.supplier_id = ?`, supplier.id,
    )) {
      lines.push({
        key: `P-${e.id}`, date: e.biz_date, created_at: e.created_at, kind: 'paiement', kind_label: LINE_KIND_LABEL.paiement,
        label: e.label, reference: e.reference, method: e.method, category_name: e.category_name ?? null, due: 0, paid: e.amount,
        foreign_amount: e.foreign_amount, foreign_currency: e.foreign_currency, status: e.status, cancel_reason: e.cancel_reason,
        cancelled_at: e.cancelled_at, cancelled_by_name: e.cancelled_by_name ?? null, created_by_name: e.created_by_name ?? null,
        purchase_id: null, entry_id: e.id,
      });
    }
    lines.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : a.created_at < b.created_at ? -1 : a.created_at > b.created_at ? 1 : 0));
    let balance = 0;
    const totals = { purchases: 0, paid: 0, due: 0 };
    for (const l of lines) {
      if (l.status !== 'active') {
        l.balance = null;
        continue;
      }
      balance += l.due - l.paid;
      totals.purchases += l.due;
      totals.paid += l.paid;
      l.balance = balance;
    }
    totals.due = balance;
    return { supplier, lines, totals };
  },

  // The supplier a ledger entry pays (createEntry), checked: only the administrator and the associés pay a tracked
  // supplier; only by an expense of a purchase category of the supplier's caisse; never more than the club owes. The
  // amount in euros or dollars goes only with a supplier's payment. Returns null for an entry that pays no supplier.
  supplierPayment(actor, input, { kind, category, amount }) {
    if (empty(input.supplier_id)) {
      if (!empty(input.foreign_amount) || !empty(input.foreign_currency)) {
        throw invalid('Un montant en devise accompagne seulement le paiement d’un fournisseur.');
      }
      return null;
    }
    if (!isBoss(actor)) throw forbidden('Seuls l’administrateur et les associés paient un fournisseur suivi.');
    if (kind !== 'depense') throw invalid('Seule une dépense paie un fournisseur.');
    const supplier = this.get('SELECT * FROM suppliers WHERE id = ?', toId(input.supplier_id, 'Fournisseur'));
    if (!supplier) throw notFound('Fournisseur');
    if (purchaseAccount(category?.code) !== supplier.account) {
      throw invalid(`« ${supplier.name} » est payé depuis la caisse « ${CAISSE_LABEL[supplier.account]} » : choisissez un type de dépense d’achat de cette caisse.`);
    }
    const foreign = foreignPair(input);
    const due = this.supplierDue(supplier.id);
    if (amount > due) {
      throw conflict(
        'DEPASSE_DU',
        due > 0
          ? `Le club doit ${this.money(due)} à « ${supplier.name} » : le paiement ne peut pas dépasser ce montant.`
          : `Le club ne doit rien à « ${supplier.name} » : enregistrez d’abord l’achat sur sa fiche.`,
        { due },
      );
    }
    return { supplier, foreign_amount: foreign.amount, foreign_currency: foreign.currency };
  },
};
