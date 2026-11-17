// The Digibox accounts import (spec docs/superpowers/specs/2026-11-17-dette-reprise-design.md): a temporary door for a
// script on the owner's computer (scripts/import-reprise.mjs), open only while the IMPORT_TOKEN secret exists. One
// call carries the whole file: the regular clients, each with the « Dette reprise » he owed in Digibox, and the
// suppliers, each with the « Solde reporté » the club owed. Mixed into Club (end of club.js) like credit.js: `this` is
// the Club instance, and the API runs the call in one transaction, so a refused file writes nothing.
//
// Nothing is ever doubled or written over: a client or a supplier that already exists is not created again, an account
// that already holds its Digibox debt is « déjà repris », and an account that already moved in the app (a client who
// owes, a supplier with operations, a member of the same name, a deactivated client) is left alone and reported as a
// conflict for the owner to decide. `dry_run` answers the same plan and writes nothing. The door has no session: the
// rows are written with no author (created_by NULL), as the catalogue import does.
import { AppError, invalid } from './errors.js';
import { int } from './validate.js';
import { formatFirstName, formatLastName } from '../shared/rules.js';

const MAX_FCFA = 1000000000;
const CARRYOVER_NOTE = 'Reprise Digibox';
const REPORT_LABEL = 'Solde Digibox';
const CLIENT_CAISSES = ['cigares', 'alcool'];

// How two names are told apart: capitals, accents, hyphens, apostrophes and spaces do not count (« Jean-Pierre » is
// « jean pierre », « Élodie » is « elodie »).
const nameKey = (name) => String(name ?? '').normalize('NFD').replace(/\p{M}/gu, '').toLocaleLowerCase('fr')
  .replace(/[-'’]/g, ' ').replace(/\s+/g, ' ').trim();
// The last 8 digits of a phone, whatever its form (« +242 06… », « 06 … »); null when too short to tell.
const phoneKey = (phone) => {
  const digits = String(phone ?? '').replace(/\D/g, '');
  return digits.length >= 8 ? digits.slice(-8) : null;
};
const listOf = (v, label) => {
  if (v === undefined || v === null) return [];
  if (!Array.isArray(v)) throw invalid(`${label} : une liste est attendue.`);
  return v;
};
// Whole francs in the file; 0 or nothing means no debt.
const francs = (v, label) => (v === undefined || v === null || v === 0 ? 0 : int(v, label, { min: 1, max: MAX_FCFA }));
const isObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
// A refused row says which one it is.
const rowError = (what, i, fn) => {
  try {
    return fn();
  } catch (e) {
    if (e instanceof AppError && e.status === 400) throw invalid(`${what} n° ${i + 1} : ${e.message}`);
    throw e;
  }
};

export const importAccountsMethods = {
  importAccounts(input) {
    if (!isObject(input)) throw invalid('Fichier d’import invalide.');
    const dryRun = input.dry_run === true;
    const clients = listOf(input.clients, 'Clients').map((c, i) => rowError('Client', i, () => this.importClientRow(c)));
    const suppliers = listOf(input.suppliers, 'Fournisseurs').map((s, i) => rowError('Fournisseur', i, () => this.importSupplierRow(s)));
    for (const [rows, what] of [[clients, 'Le client'], [suppliers, 'Le fournisseur']]) {
      const seen = new Set();
      for (const r of rows) {
        if (seen.has(r.key)) throw invalid(`${what} « ${r.name} » figure deux fois dans le fichier.`);
        seen.add(r.key);
      }
    }

    const today = this.bizToday();
    const answer = { dry_run: dryRun, clients: [], suppliers: [], total_debt: 0 };
    let createdClients = 0;
    let debts = 0;
    for (const c of clients) {
      const exact = this.findFileByName(c.key);
      // Not the same name, but probably the same person: left alone, for the owner to decide (never a second file).
      const probable = exact ? null : this.findProbableFile(c);
      const found = exact ?? probable;
      const action = probable ? 'conflit_homonyme' : this.importClientAction(found, c);
      let memberNo = found?.member_no ?? null;
      const entersDebt = c.debt > 0 && (action === 'creer_avec_dette' || action === 'existe_dette_ajoutee');
      const debt = { amount: c.debt * 100, account: c.account, note: CARRYOVER_NOTE };
      if (!dryRun && (action === 'creer' || action === 'creer_avec_dette')) {
        const created = this.createClient(null, c.fields);
        memberNo = created.member_no;
        createdClients += 1;
        if (entersDebt) this.insertCarryover(null, this.fileRow(created.id), debt);
      } else if (!dryRun && entersDebt) {
        this.insertCarryover(null, this.fileRow(found.id), debt);
      }
      if (entersDebt) {
        debts += 1;
        answer.total_debt += c.debt;
      }
      answer.clients.push({ name: c.name, action, member_no: memberNo, debt: entersDebt ? c.debt : 0 });
    }

    let createdSuppliers = 0;
    for (const s of suppliers) {
      const found = this.get('SELECT id FROM suppliers WHERE name = ?', s.fields.name);
      const action = this.importSupplierAction(found);
      if (!dryRun && (action === 'creer' || action === 'existe_solde_ajoute')) {
        if (s.carried_over > 0) this.assertSupplierMonthOpen(today, 'Ce solde reporté');
        let id = found?.id;
        if (!id) {
          const f = s.fields;
          id = this.insert(
            `INSERT INTO suppliers (name, account, country, currency, contact, notes, active, is_demo, created_at, created_by)
             VALUES (?, ?, ?, ?, ?, ?, 1, 0, ?, NULL)`,
            f.name, f.account, f.country, f.currency, f.contact, f.notes, this.nowIso(),
          );
          this.audit(null, 'fournisseur.creer', 'supplier', id, { nom: f.name, pays: f.country, devise: f.currency });
          createdSuppliers += 1;
        }
        if (s.carried_over > 0) {
          const amount = s.carried_over * 100;
          const purchaseId = this.insert(
            `INSERT INTO supplier_purchases (supplier_id, kind, biz_date, amount, label, status, is_demo, created_at, created_by)
             VALUES (?, 'report', ?, ?, ?, 'active', 0, ?, NULL)`,
            id, today, amount, REPORT_LABEL, this.nowIso(),
          );
          this.audit(null, 'fournisseur.achat', 'supplier', id, {
            nom: s.fields.name, type: 'Solde reporté', date: today, montant: amount, achat: purchaseId,
          });
        }
      }
      answer.suppliers.push({ name: s.fields.name, action, carried_over: s.carried_over });
    }

    if (!dryRun) {
      this.audit(null, 'import.digibox', null, null, {
        clients: createdClients, dettes: debts, total_dettes: answer.total_debt * 100, fournisseurs: createdSuppliers,
      });
    }
    return answer;
  },

  // A client row of the file, checked with the app's own rules for a regular client's file.
  importClientRow(c) {
    if (!isObject(c)) throw invalid('fiche invalide.');
    const f = this.memberFields(c, {}, { client: true });
    const account = c.account ?? 'cigares';
    if (!CLIENT_CAISSES.includes(account)) throw invalid('Caisse invalide : Cigare ou Champagne et autres boissons.');
    const name = `${f.first} ${f.last}`.trim();
    return {
      name, key: nameKey(name), first: nameKey(f.first), last: nameKey(f.last), phone: phoneKey(f.phone), account, debt: francs(c.debt, 'Dette'),
      fields: { first_name: f.first, last_name: f.last, phone: f.phone, email: f.email, notes: f.notes },
    };
  },

  importSupplierRow(s) {
    if (!isObject(s)) throw invalid('fiche invalide.');
    const fields = this.supplierFields(s);
    return { name: fields.name, key: nameKey(fields.name), fields, carried_over: francs(s.carried_over, 'Solde reporté') };
  },

  realFiles() {
    return this.all('SELECT id, kind, member_no, first_name, last_name, phone, active FROM members WHERE is_demo = 0 ORDER BY id');
  },

  // A file of the real club (never a demo row) with the same first and last name.
  findFileByName(key) {
    return this.realFiles()
      .find((m) => nameKey(`${formatFirstName(m.first_name ?? '')} ${formatLastName(m.last_name ?? '')}`) === key) ?? null;
  },

  // A file that is probably the same person under another name: the same phone, or the same last name when one of the
  // two has no first name (the Digibox list often gives only « Mr X »).
  findProbableFile(c) {
    return this.realFiles().find((m) => {
      if (c.phone && phoneKey(m.phone) === c.phone) return true;
      const noFirst = !c.first || !nameKey(m.first_name);
      return noFirst && nameKey(m.last_name) === c.last;
    }) ?? null;
  },

  importClientAction(found, c) {
    if (!found) return c.debt > 0 ? 'creer_avec_dette' : 'creer';
    if (found.kind !== 'client') return 'conflit_membre';
    if (this.get("SELECT 1 AS x FROM charges WHERE member_id = ? AND carryover = 1 AND status <> 'annulee'", found.id)) return 'deja_repris';
    if (c.debt === 0) return 'existe';
    if (found.active === 0) return 'conflit_inactif';
    if (this.creditOwed(found.id) > 0) return 'conflit_doit_deja';
    return 'existe_dette_ajoutee';
  },

  importSupplierAction(found) {
    if (!found) return 'creer';
    if (this.get("SELECT 1 AS x FROM supplier_purchases WHERE supplier_id = ? AND kind = 'report' AND label = ? AND status = 'active'", found.id, REPORT_LABEL)) {
      return 'deja_repris';
    }
    return this.supplierOrThrow(found.id).has_operations ? 'conflit_operations' : 'existe_solde_ajoute';
  },
};
