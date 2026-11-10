// Client access (specs « Espace client » and « Identifiant choisi par le client »). Mixed into Club (end of club.js):
// `this` is the Club instance, and no method opens a transaction of its own. The administrator or an associé creates the
// access of a member or regular client: his provisional identifier is his member number, and a temporary code (hashed by
// the API layer, shown once to the staff) lets him choose his own identifier and password. The code never reaches the
// database or the audit log in clear. The client then signs in on his own routes (worker/clientApi.js), with sessions of
// his own: client_sessions, never the staff's table.
// client_accounts.login is the identifier the client chose (login_chosen = 1), or until then a provisional one
// (login_chosen = 0): his member number in lower case for an access made since V25, his phone as WhatsApp reads it for
// one made before. The three never meet: a chosen identifier has a letter and never a member number's shape.
import { conflict, invalid, notFound } from './errors.js';
import { waDigits } from '../shared/whatsapp.js';

// A client stays signed in on his phone for 30 days.
const CLIENT_SESSION_DAYS = 30;

// A member number (M-0012, C-0003), once in lower case.
const MEMBER_NO = /^[mc]-\d+$/;

// What a client types in the identifier field, read as every lookup reads it: trimmed and in lower case; '' when it is
// not even text.
export const typedLogin = (raw) => (typeof raw === 'string' ? raw.trim().toLowerCase() : '');

// The phone login of an access made before the client chose his identifier (V24), as WhatsApp reads the number typed in
// any form (« 06 123 45 67 », « +242… », « 00242… »). Only text made of a phone number's characters is read so, never an
// identifier with letters in it. Null when it is no usable number.
const legacyPhone = (typed) => (/^[\d\s+().-]+$/.test(typed) ? waDigits(typed) : null);

// The sign-in lockout key: the identifier as the lookup reads it, so another case or spaces around give no fresh tries,
// and a phone number one key whatever its form. It stops one character past the longest identifier (30), so a huge
// value is not kept.
export const clientLoginKey = (raw) => {
  const typed = typedLogin(raw);
  return legacyPhone(typed) ?? typed.slice(0, 31);
};

// The identifier a client chooses: 4 to 30 letters without accents, digits, dots or hyphens, kept in lower case; with
// a letter at least (only digits once the dots and hyphens are set aside would be a phone number), and never a member
// number's shape (m-…, c-…), kept for the provisional identifiers. Returns it, or refuses it (IDENTIFIANT_INVALIDE).
// Whether another access holds it is checked in the transaction (setClientLogin).
export function clientIdentifier(raw) {
  const login = typedLogin(raw);
  if (!/^[a-z0-9.-]{4,30}$/.test(login)) {
    throw invalid('Identifiant : de 4 à 30 caractères, lettres sans accent, chiffres, point ou tiret.', 'IDENTIFIANT_INVALIDE');
  }
  if (/^\d*$/.test(login.replace(/[.-]/g, ''))) {
    throw invalid('L’identifiant doit contenir au moins une lettre : un numéro de téléphone ne peut pas servir d’identifiant.', 'IDENTIFIANT_INVALIDE');
  }
  if (MEMBER_NO.test(login)) {
    throw invalid('L’identifiant ne peut pas avoir la forme d’un numéro de membre : choisissez-en un autre.', 'IDENTIFIANT_INVALIDE');
  }
  return login;
}

export const clientAccessMethods = {
  accountRow(memberId) {
    return this.get('SELECT * FROM client_accounts WHERE member_id = ?', memberId);
  },

  // aucun: no access; en_attente: the temporary code is not yet exchanged for a password; actif; coupe: cut by the staff.
  clientAccessStatus(memberId) {
    const a = this.accountRow(memberId);
    if (!a) {
      return { state: 'aucun', login: null, login_chosen: false, created_at: null, last_login_at: null, temp_expires_at: null };
    }
    const state = a.active === 0 ? 'coupe' : a.password_hash ? 'actif' : 'en_attente';
    return {
      state, login: a.login, login_chosen: a.login_chosen === 1, created_at: a.created_at, last_login_at: a.last_login_at,
      temp_expires_at: a.temp_expires_at,
    };
  },

  // The provisional identifier is the member number, which no other file ever holds (nextMemberNo): the file's phone
  // plays no part.
  createClientAccess(actor, memberId, { tempHash, expiresAt }) {
    const m = this.fileRow(memberId);
    this.assertMemberActive(m, 'de créer un accès');
    if (this.accountRow(m.id)) throw conflict('ACCES_EXISTE', 'Ce client a déjà un accès : générez un nouveau code si besoin.');
    const login = m.member_no.toLowerCase();
    this.run(
      `INSERT INTO client_accounts (member_id, login, login_chosen, temp_hash, temp_expires_at, temp_issued_by, created_at, created_by)
       VALUES (?, ?, 0, ?, ?, ?, ?, ?)`,
      m.id, login, tempHash, expiresAt, actor.id, this.nowIso(), actor.id,
    );
    this.audit(actor, 'client.acces.creer', 'member', m.id, { member_no: m.member_no, login });
    return { login, status: this.clientAccessStatus(m.id) };
  },

  // A new temporary code: the old password and every open session are gone. The identifier stays as it is, chosen or
  // not: the client signs in with it, or with his member number, and the code.
  renewClientCode(actor, memberId, { tempHash, expiresAt }) {
    const m = this.fileRow(memberId);
    this.assertMemberActive(m, 'de renouveler un code');
    const a = this.accountRow(m.id);
    if (!a) throw notFound('Accès client');
    this.run(
      'UPDATE client_accounts SET password_hash = NULL, temp_hash = ?, temp_expires_at = ?, temp_issued_by = ? WHERE id = ?',
      tempHash, expiresAt, actor.id, a.id,
    );
    this.closeClientSessions(m.id);
    this.audit(actor, 'client.acces.code', 'member', m.id, { member_no: m.member_no, login: a.login });
    return { login: a.login, status: this.clientAccessStatus(m.id) };
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

  // A staff member loses the right to give codes (deactivated, or no longer administrator or associé): the codes he gave
  // that no client has used yet stop working, and the sessions opened with them (identifier and password not yet
  // chosen) are closed. A client who already chose his password keeps it. Tells how many codes were voided.
  voidCodesIssuedBy(userId) {
    const { n } = this.get('SELECT COUNT(*) AS n FROM client_accounts WHERE temp_issued_by = ? AND temp_hash IS NOT NULL', userId);
    this.run(
      'DELETE FROM client_sessions WHERE must_set_password = 1 AND account_id IN (SELECT id FROM client_accounts WHERE temp_issued_by = ?)',
      userId,
    );
    this.run('UPDATE client_accounts SET temp_hash = NULL, temp_expires_at = NULL, temp_issued_by = NULL WHERE temp_issued_by = ?', userId);
    return n;
  },

  // ---------------------------------------------------------------- client side: sign-in and sessions

  // The access a client names on signing in, and what may open it: { account, codeOnly }, or null.
  //  1. the identifier he chose, in any case;
  //  2. the phone of an access made before identifiers were chosen, in any form, until he chooses one;
  //  3. his member number, or his former regular-client number, in any case, only while a temporary code is live: then
  //     the code alone is checked (codeOnly), never a password. Without a live code, a member number names nothing.
  // A provisional member-number login is never matched as such: only 3 reaches it.
  clientAccountByLogin(raw) {
    const typed = typedLogin(raw);
    if (!typed) return null;
    const chosen = this.get('SELECT * FROM client_accounts WHERE login = ? AND login_chosen = 1', typed);
    if (chosen) return { account: chosen, codeOnly: false };
    const phone = legacyPhone(typed);
    const legacy = phone ? this.get('SELECT * FROM client_accounts WHERE login = ? AND login_chosen = 0', phone) : null;
    if (legacy) return { account: legacy, codeOnly: false };
    const byNumber = this.get(
      `SELECT a.* FROM client_accounts a JOIN members m ON m.id = a.member_id
       WHERE (lower(m.member_no) = ? OR lower(m.former_client_no) = ?) AND a.temp_hash IS NOT NULL AND a.temp_expires_at > ?`,
      typed, typed, this.nowIso(),
    );
    return byNumber ? { account: byNumber, codeOnly: true } : null;
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
  // the file switched off. Until he has chosen his identifier (loginChosen) and, after a sign-in with the code, his
  // password (mustSetPassword), the session only reaches the « choose » step (worker/clientApi.js).
  clientSessionAccount(tokenHash) {
    if (!tokenHash) return null;
    const s = this.get('SELECT * FROM client_sessions WHERE token_hash = ?', tokenHash);
    if (!s || s.expires_at < this.nowIso()) return null;
    const access = this.activeClientAccess(s.account_id);
    if (!access) return null;
    // A session opened with the code lives only as long as the code: once it has expired or been voided, its holder
    // can no longer choose the identifier and the password with it.
    const code = access.account;
    if (s.must_set_password === 1 && (!code.temp_hash || !(code.temp_expires_at > this.nowIso()))) return null;
    return { ...access, mustSetPassword: s.must_set_password === 1, loginChosen: access.account.login_chosen === 1 };
  },

  closeClientSession(tokenHash) {
    if (tokenHash) this.run('DELETE FROM client_sessions WHERE token_hash = ?', tokenHash);
  },

  // The identifier the client chose (clientIdentifier checked its form): no other access may hold it. Noted in the log
  // when it is chosen or changed, as the client's own act (no staff member), with the one it replaces.
  setClientLogin(accountId, login) {
    const a = this.get('SELECT * FROM client_accounts WHERE id = ?', accountId);
    if (!a) throw notFound('Accès client');
    if (this.get('SELECT 1 AS x FROM client_accounts WHERE login = ? AND id <> ?', login, a.id)) {
      throw conflict('IDENTIFIANT_PRIS', 'Cet identifiant est déjà pris : choisissez-en un autre.');
    }
    this.run('UPDATE client_accounts SET login = ?, login_chosen = 1 WHERE id = ?', login, a.id);
    if (a.login !== login) this.audit(null, 'client.identifiant', 'member', a.member_id, { client: a.member_id, avant: a.login, apres: login });
  },

  // The client's own password (the API layer checked the current one, or that the session was opened with the code),
  // with the identifier he chose at the same time, if any (`login`, checked by clientIdentifier). The temporary code is
  // spent, the client's other sessions are closed, and the one he used becomes a full session.
  setClientPassword(accountId, passwordHash, keepTokenHash, login = null) {
    const a = this.get('SELECT * FROM client_accounts WHERE id = ?', accountId);
    if (!a) throw notFound('Accès client');
    if (login) this.setClientLogin(a.id, login);
    this.run(
      'UPDATE client_accounts SET password_hash = ?, temp_hash = NULL, temp_expires_at = NULL, temp_issued_by = NULL WHERE id = ?',
      passwordHash, a.id,
    );
    this.run('DELETE FROM client_sessions WHERE account_id = ? AND token_hash <> ?', a.id, keepTokenHash ?? '');
    this.run('UPDATE client_sessions SET must_set_password = 0 WHERE account_id = ? AND token_hash = ?', a.id, keepTokenHash ?? '');
    this.audit(null, 'client.mot_de_passe', 'member', a.member_id, { client: a.member_id });
  },
};
