// Client access (spec « Espace client »). Mixed into Club (end of club.js): `this` is the Club instance, and no method
// opens a transaction of its own. The staff creates the access of a member or regular client: his login is his phone
// number as WhatsApp reads it, and a temporary code (hashed by the API layer, shown once to the staff) lets him choose
// his own password. The code never reaches the database or the audit log in clear. The client then signs in on his own
// routes (worker/clientApi.js), with sessions of his own: client_sessions, never the staff's table.
import { conflict, invalid, notFound } from './errors.js';
import { waDigits } from '../shared/whatsapp.js';

// A client stays signed in on his phone for 30 days.
const CLIENT_SESSION_DAYS = 30;

// The login a client types, in any form (« 06 123 45 67 », « +242… », « 00242… »), read as his login was made: null when
// it is no usable number, or not even text.
export const clientLogin = (raw) => (typeof raw === 'string' ? waDigits(raw) : null);

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

  // ---------------------------------------------------------------- client side: sign-in and sessions

  clientAccountByLogin(raw) {
    const login = clientLogin(raw);
    return login ? this.get('SELECT * FROM client_accounts WHERE login = ?', login) ?? null : null;
  },

  // The access and its file, while both are active: a cut access or a switched-off file opens nothing, whatever the
  // session or the password.
  activeClientAccess(accountId) {
    const account = this.get('SELECT * FROM client_accounts WHERE id = ?', accountId);
    const member = account ? this.get('SELECT * FROM members WHERE id = ?', account.member_id) : null;
    return account?.active === 1 && member?.active === 1 ? { account, member } : null;
  },

  // Stored by the token's hash only, as the staff's sessions are. A session opened with the temporary code only lets
  // the client choose his password (mustSetPassword). Null when the access or the file is no longer active: the API
  // checked them before hashing, this checks them again in the transaction.
  openClientSession(accountId, tokenHash, { mustSetPassword = false } = {}) {
    if (!this.activeClientAccess(accountId)) return null;
    const now = this.nowMs();
    this.run(
      'INSERT INTO client_sessions (token_hash, account_id, must_set_password, created_at, expires_at) VALUES (?, ?, ?, ?, ?)',
      tokenHash, accountId, mustSetPassword ? 1 : 0, new Date(now).toISOString(), new Date(now + CLIENT_SESSION_DAYS * 86400000).toISOString(),
    );
    this.run('UPDATE client_accounts SET last_login_at = ? WHERE id = ?', new Date(now).toISOString(), accountId);
    return { maxAge: CLIENT_SESSION_DAYS * 86400 };
  },

  // The signed-in client: his access and his file, or null when the session is unknown or expired, the access cut or
  // the file switched off.
  clientSessionAccount(tokenHash) {
    if (!tokenHash) return null;
    const s = this.get('SELECT * FROM client_sessions WHERE token_hash = ?', tokenHash);
    if (!s || s.expires_at < this.nowIso()) return null;
    const access = this.activeClientAccess(s.account_id);
    return access ? { ...access, mustSetPassword: s.must_set_password === 1 } : null;
  },

  closeClientSession(tokenHash) {
    if (tokenHash) this.run('DELETE FROM client_sessions WHERE token_hash = ?', tokenHash);
  },

  // The client's own password (the API layer checked the current one, or that the session was opened with the code).
  // The temporary code is spent, the client's other sessions are closed, and the one he used becomes a full session.
  setClientPassword(accountId, passwordHash, keepTokenHash) {
    const a = this.get('SELECT * FROM client_accounts WHERE id = ?', accountId);
    if (!a) throw notFound('Accès client');
    this.run('UPDATE client_accounts SET password_hash = ?, temp_hash = NULL, temp_expires_at = NULL WHERE id = ?', passwordHash, a.id);
    this.run('DELETE FROM client_sessions WHERE account_id = ? AND token_hash <> ?', a.id, keepTokenHash ?? '');
    this.run('UPDATE client_sessions SET must_set_password = 0 WHERE account_id = ? AND token_hash = ?', a.id, keepTokenHash ?? '');
    this.audit(null, 'client.mot_de_passe', 'member', a.member_id, { client: a.member_id });
  },
};
