// The client space's API (spec « Espace client »): every /api/client/* request, handed over by `handle` (worker/api.js)
// before the staff's route table is even looked at. Its routes, its sessions and its cookie are its own:
//  - the session comes from the `csid` cookie alone, looked up in client_sessions; the staff's `sid` is never read here,
//    as `handle` never reads `csid`, so a browser holding both gets each space with its own identity;
//  - `csid` is sent back to /api/client only (Path), and lasts 30 days;
//  - the client is the one of the session, never an id from the address or the body.
// The same protections as the staff's routes (JSON and known origin for every write, bounded body, security headers,
// sign-in lockout) come from worker/api.js as `helpers`, not copied here.
// A session opened with the temporary code only reaches the routes marked BEFORE_PASSWORD: every other client route,
// known or not, answers 403 MOT_DE_PASSE_A_CHOISIR until the client has chosen his password.
import { AppError, invalid, notSignedIn } from './errors.js';
import { hashPassword, verifyPassword, sha256Hex, newToken, checkPasswordStrength, parseCookies } from './auth.js';
import { clientLogin } from './clientAccess.js';

const badCredentials = () => new AppError(401, 'IDENTIFIANTS', 'Identifiant ou mot de passe incorrect.');
const passwordFirst = () => new AppError(403, 'MOT_DE_PASSE_A_CHOISIR', 'Choisissez d’abord votre mot de passe.');

// What the client learns of himself on signing in and on GET /api/client/me, field by field.
const me = ({ member, mustSetPassword }) => ({
  must_set_password: mustSetPassword,
  member: { first_name: member.first_name, last_name: member.last_name, member_no: member.member_no, kind: member.kind },
});

export function createClientRoutes({ club, helpers }) {
  const { routeTable, checkThrottle, recordFailure, clearFailures, dummyHash, readJson, checkCsrf, json, errorResponse } = helpers;
  const { add, match } = routeTable();
  // The routes a session opened with the temporary code may reach.
  const BEFORE_PASSWORD = { beforePassword: true };

  add('POST', '/api/client/login', {
    public: true,
    prepare: async (ctx) => {
      // The key reads the number as the account lookup does, so writing it another way gives no fresh tries. Text that
      // is no number shares one key per address: it opens no account anyway.
      const key = `${ctx.ip}|client|${clientLogin(ctx.body.login) ?? ''}`;
      checkThrottle(key);
      const account = club.clientAccountByLogin(ctx.body.login);
      const password = String(ctx.body.password ?? '');
      const codeLive = !!account?.temp_hash && String(account.temp_expires_at ?? '') > club.nowIso();
      let valid = false;
      let viaCode = false;
      if (account?.password_hash) valid = await verifyPassword(password, account.password_hash);
      if (!valid && codeLive) valid = viaCode = await verifyPassword(password, account.temp_hash);
      // No account, or one with neither password nor a live code: a dummy hash is checked all the same, so the answer
      // takes as long, and says the same, whether the number is known or not.
      if (!account?.password_hash && !codeLive) await verifyPassword(password, await dummyHash());
      if (!valid || !club.activeClientAccess(account.id)) {
        recordFailure(key);
        throw badCredentials();
      }
      clearFailures(key);
      ctx.signIn = { accountId: account.id, viaCode };
      ctx.newToken = newToken();
      ctx.newTokenHash = await sha256Hex(ctx.newToken);
    },
  }, (ctx) => {
    const opened = club.openClientSession(ctx.signIn.accountId, ctx.newTokenHash, { mustSetPassword: ctx.signIn.viaCode });
    if (!opened) throw badCredentials();
    ctx.setCookie(ctx.newToken, opened.maxAge);
    return me(club.clientSessionAccount(ctx.newTokenHash));
  });

  add('GET', '/api/client/me', BEFORE_PASSWORD, (ctx) => me(ctx));

  add('POST', '/api/client/logout', BEFORE_PASSWORD, (ctx) => {
    club.closeClientSession(ctx.tokenHash);
    ctx.setCookie('', 0);
    return { ok: true };
  });

  // A session opened with the code chooses the password without the current one; any other must give it. The body
  // holds passwords: the route keeps no idempotency record, whose request hash would be a fast hash of them.
  add('POST', '/api/client/password', {
    ...BEFORE_PASSWORD,
    noIdempotency: true,
    prepare: async (ctx) => {
      if (!ctx.mustSetPassword && !(await verifyPassword(String(ctx.body.current_password ?? ''), ctx.account.password_hash))) {
        throw invalid('Mot de passe actuel incorrect.');
      }
      const weak = checkPasswordStrength(ctx.body.new_password);
      if (weak) throw invalid(weak);
      ctx.passwordHash = await hashPassword(ctx.body.new_password);
    },
  }, (ctx) => {
    // The session may have been closed (access cut, password changed elsewhere) while the password was hashed.
    if (!club.clientSessionAccount(ctx.tokenHash)) throw notSignedIn();
    club.setClientPassword(ctx.account.id, ctx.passwordHash, ctx.tokenHash);
    return me(club.clientSessionAccount(ctx.tokenHash));
  });

  add('GET', '/api/client/account', {}, (ctx) => club.clientAccountView(ctx.member.id));
  add('GET', '/api/client/history', {}, (ctx) => club.clientHistory(ctx.member.id, ctx.query.from || undefined, ctx.query.to || undefined));
  add('GET', '/api/client/tickets/:id', {}, (ctx) => club.clientTicket(ctx.member.id, ctx.params.id));
  add('POST', '/api/client/tickets/:id/copies', {}, (ctx) => club.recordClientTicketCopy(ctx.member.id, ctx.params.id, ctx.body));

  async function handleClient(request, url) {
    const cookies = [];
    const secure = url.protocol === 'https:';
    // As the staff's cookie (cookieHeader in worker/api.js), under its own name and sent back to /api/client only.
    const cookieHeader = (value, maxAge) => [
      `csid=${encodeURIComponent(value)}`, 'Path=/api/client', 'HttpOnly', 'SameSite=Lax', `Max-Age=${maxAge}`, secure ? 'Secure' : null,
    ].filter(Boolean).join('; ');
    try {
      const found = match(request.method, url.pathname);
      const route = found?.route ?? null;
      const writes = request.method !== 'GET';
      if (writes) checkCsrf(request, url);
      const token = parseCookies(request.headers.get('cookie')).csid || null;
      const ctx = {
        params: found?.params ?? {}, body: null, token, tokenHash: token ? await sha256Hex(token) : null,
        account: null, member: null, mustSetPassword: false,
        headers: request.headers,
        ip: request.headers.get('cf-connecting-ip') ?? 'local',
        query: Object.fromEntries(url.searchParams),
        setCookie: (value, maxAge) => cookies.push(cookieHeader(value, maxAge)),
      };
      // An unknown path asks for a session like any other client route: without one the answer is 401, whatever exists.
      if (!route?.opts.public) {
        const session = club.clientSessionAccount(ctx.tokenHash);
        if (!session) throw notSignedIn();
        Object.assign(ctx, session);
        if (ctx.mustSetPassword && !route?.opts.beforePassword) throw passwordFirst();
      }
      if (!route) throw new AppError(404, 'INTROUVABLE', 'Ressource inconnue.');
      ctx.body = writes ? await readJson(request, route.opts.maxBody) : {};

      if (!writes) {
        if (route.opts.prepare) await route.opts.prepare(ctx);
        return json(200, route.handler(ctx), { cookies });
      }

      // Every client write runs below: the same idempotency rules as the staff's (worker/api.js), recorded per client
      // account in client_idempotency. A retry that already succeeded is answered at once, without redoing anything.
      const key = route.opts.noIdempotency ? undefined : request.headers.get('idempotency-key') ?? undefined;
      if (key !== undefined && !/^[A-Za-z0-9_-]{8,100}$/.test(key)) throw invalid("Clé d'idempotence invalide.");
      const hash = key && ctx.account ? await sha256Hex(JSON.stringify([request.method, url.pathname, ctx.body])) : null;
      const replay = () => {
        const prev = club.get('SELECT * FROM client_idempotency WHERE key = ? AND account_id = ?', key, ctx.account.id);
        if (!prev) return undefined;
        if (prev.request_hash !== hash) {
          throw new AppError(422, 'CLE_REUTILISEE', "Cette opération a déjà été enregistrée avec d'autres données. Rechargez la page.");
        }
        return JSON.parse(prev.response);
      };
      if (hash) {
        const previous = replay();
        if (previous !== undefined) return json(200, previous, { cookies, replayed: true });
      }
      if (route.opts.prepare) await route.opts.prepare(ctx);
      let replayed = false;
      // The whole write, including the idempotency record, commits or rolls back as one unit.
      const payload = club.tx(() => {
        if (!hash) return route.handler(ctx);
        const previous = replay();
        if (previous !== undefined) {
          replayed = true;
          return previous;
        }
        const result = route.handler(ctx);
        club.run(
          'INSERT INTO client_idempotency (key, account_id, request_hash, response, created_at) VALUES (?, ?, ?, ?, ?)',
          key, ctx.account.id, hash, JSON.stringify(result ?? null), new Date().toISOString(),
        );
        return result;
      });
      return json(200, payload, { cookies, replayed });
    } catch (err) {
      return errorResponse(err);
    }
  }

  return { handleClient };
}
