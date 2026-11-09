// Client access, staff side (spec « Espace client »). Mixed into Club (end of club.js): `this` is the Club instance, and
// no method opens a transaction of its own. The staff creates the access of a member or regular client: his login is
// his phone number as WhatsApp reads it, and a temporary code (hashed by the API layer, shown once to the staff) lets
// him choose his own password. The code never reaches the database or the audit log in clear.
import { conflict, invalid, notFound } from './errors.js';
import { waDigits } from '../shared/whatsapp.js';

export const clientAccessMethods = {
  accountRow(memberId) {
    return this.get('SELECT * FROM client_accounts WHERE member_id = ?', memberId);
  },

  // aucun: no access; en_attente: the temporary code is not yet exchanged for a password; actif; coupe: cut by the staff.
  clientAccessStatus(memberId) {
    const a = this.accountRow(memberId);
    if (!a) return { state: 'aucun', login: null, created_at: null, last_login_at: null, temp_expires_at: null };
    const state = a.active === 0 ? 'coupe' : a.password_hash ? 'actif' : 'en_attente';
    return { state, login: a.login, created_at: a.created_at, last_login_at: a.last_login_at, temp_expires_at: a.temp_expires_at };
  },

  createClientAccess(actor, memberId, { tempHash, expiresAt }) {
    const m = this.fileRow(memberId);
    this.assertMemberActive(m, 'de créer un accès');
    const login = waDigits(m.phone);
    if (!login) throw invalid('Le téléphone de la fiche ne permet pas de créer un identifiant.', 'TELEPHONE');
    if (this.accountRow(m.id)) throw conflict('ACCES_EXISTE', 'Ce client a déjà un accès : générez un nouveau code si besoin.');
    if (this.get('SELECT 1 AS x FROM client_accounts WHERE login = ?', login)) {
      throw conflict('IDENTIFIANT_PRIS', 'Ce numéro sert déjà d’identifiant à un autre client.');
    }
    this.run(
      'INSERT INTO client_accounts (member_id, login, temp_hash, temp_expires_at, created_at, created_by) VALUES (?, ?, ?, ?, ?, ?)',
      m.id, login, tempHash, expiresAt, this.nowIso(), actor.id,
    );
    this.audit(actor, 'client.acces.creer', 'member', m.id, { member_no: m.member_no, login });
    return { login, status: this.clientAccessStatus(m.id) };
  },

  // A new temporary code: the old password and every open session are gone. The login follows the file's phone today.
  renewClientCode(actor, memberId, { tempHash, expiresAt }) {
    const m = this.fileRow(memberId);
    this.assertMemberActive(m, 'de renouveler un code');
    const a = this.accountRow(m.id);
    if (!a) throw notFound('Accès client');
    const login = waDigits(m.phone);
    if (!login) throw invalid('Le téléphone de la fiche ne permet pas de créer un identifiant.', 'TELEPHONE');
    if (this.get('SELECT 1 AS x FROM client_accounts WHERE login = ? AND id <> ?', login, a.id)) {
      throw conflict('IDENTIFIANT_PRIS', 'Ce numéro sert déjà d’identifiant à un autre client.');
    }
    this.run(
      'UPDATE client_accounts SET login = ?, password_hash = NULL, temp_hash = ?, temp_expires_at = ? WHERE id = ?',
      login, tempHash, expiresAt, a.id,
    );
    this.closeClientSessions(m.id);
    this.audit(actor, 'client.acces.code', 'member', m.id, { member_no: m.member_no, login });
    return { login, status: this.clientAccessStatus(m.id) };
  },

  setClientAccessActive(actor, memberId, active) {
    const m = this.fileRow(memberId);
    const a = this.accountRow(m.id);
    if (!a) throw notFound('Accès client');
    this.run('UPDATE client_accounts SET active = ? WHERE id = ?', active ? 1 : 0, a.id);
    if (!active) this.closeClientSessions(m.id);
    this.audit(actor, active ? 'client.acces.retablir' : 'client.acces.couper', 'member', m.id, { member_no: m.member_no, login: a.login });
    return this.clientAccessStatus(m.id);
  },

  // The client's open sessions end with his file's deactivation, a new code or a cut.
  closeClientSessions(memberId) {
    this.run('DELETE FROM client_sessions WHERE account_id IN (SELECT id FROM client_accounts WHERE member_id = ?)', memberId);
  },
};
