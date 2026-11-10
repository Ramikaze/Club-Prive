// HTTP API on the Fetch standard (Request in, Response out): routing, sessions, role checks,
// CSRF guard and idempotent writes. It runs inside the Durable Object that owns the club's database
// (worker/index.js) and, unchanged, in the Node tests.
// Each route may have an async `prepare` step (password hashing, token hashing) that runs before the handler;
// the handler itself is synchronous and, for writes, runs in one transaction with the idempotency record.
// A route whose credential is not in the body may also have a `guard`: the same kind of step, before the body is read.
// The same API also serves the demo space (`demo: true`, a second Durable Object with its own database).
// That instance opens no session: the real club vouches for the signed-in account (demoContext) and the
// demo space serves the request as that account (handleDemo).
import { Club } from './club.js';
import { migrate } from './schema.js';
import { DEMO_ACCOUNTS } from './seed.js';
import { AppError, forbidden, invalid, conflict, notSignedIn } from './errors.js';
import { hashPassword, verifyPassword, sha256Hex, newToken, newClientCode, checkPasswordStrength, parseCookies } from './auth.js';
import { ALWAYS_REAL } from './space.js';
import { createClientRoutes } from './clientApi.js';
import { sendWebPush, PUSH_TIMEOUT_MS } from './push.js';
import { isBoss } from '../shared/roles.js';

const MAX_BODY = 256 * 1024;
// A photo travels in base64, a third bigger than the picture: 200 KB of picture is 273 KB of text. The routes that
// carry one (a photo, the catalogue import) read a larger body than the 256 KB the others are held to.
const MAX_PHOTO_BODY = 300 * 1024;
const SECURITY_HEADERS = {
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'same-origin',
  'X-Frame-Options': 'DENY',
  'Cache-Control': 'no-store',
};

function json(status, payload, { cookies = [], replayed = false } = {}) {
  const headers = new Headers({ ...SECURITY_HEADERS, 'Content-Type': 'application/json; charset=utf-8' });
  for (const c of cookies) headers.append('Set-Cookie', c);
  if (replayed) headers.set('Idempotent-Replayed', 'true');
  return new Response(JSON.stringify(payload ?? null), { status, headers });
}

// A photo never changes at its address (the version in it changes with the photo): kept a year, by the signed-in
// browser alone. This answer's Cache-Control replaces the no-store of the other answers. It is a picture and nothing
// else: opened as a page, it would be allowed to load and run nothing.
function imageResponse({ mime, data }) {
  return new Response(data, {
    status: 200,
    headers: {
      ...SECURITY_HEADERS,
      'Content-Type': mime,
      'Cache-Control': 'private, max-age=31536000, immutable',
      'Content-Security-Policy': "default-src 'none'; sandbox",
    },
  });
}

function errorResponse(err) {
  if (err instanceof AppError) {
    return json(err.status, { error: { code: err.code, message: err.message, details: err.details ?? null } });
  }
  const msg = String(err?.message ?? '');
  if (msg.includes('CHEVAUCHEMENT')) {
    return json(409, { error: { code: 'CHEVAUCHEMENT', message: 'La salle est déjà réservée sur ce créneau.' } });
  }
  if (msg.includes('constraint failed')) {
    return json(409, { error: { code: 'CONTRAINTE', message: 'Opération refusée : elle rendrait les données incohérentes.' } });
  }
  console.error(err);
  return json(500, { error: { code: 'ERREUR_SERVEUR', message: "Erreur interne. L'opération n'a pas été enregistrée." } });
}

async function readJson(request, limit = MAX_BODY) {
  if (Number(request.headers.get('content-length') ?? 0) > limit) throw new AppError(413, 'TROP_VOLUMINEUX', 'Requête trop volumineuse.');
  const raw = await request.text();
  if (raw.length > limit) throw new AppError(413, 'TROP_VOLUMINEUX', 'Requête trop volumineuse.');
  if (!raw) return {};
  try {
    const data = JSON.parse(raw);
    if (data === null || typeof data !== 'object' || Array.isArray(data)) throw new Error('not an object');
    return data;
  } catch {
    throw invalid('Corps de requête JSON invalide.');
  }
}

// A route table: `add` registers a method and a path (its `:name` parts become `params`), `match` finds the route of a
// request: null for an unknown path, 405 for a known path asked with another method. The staff's routes and the
// client's (worker/clientApi.js) each have their own.
function routeTable() {
  const routes = [];
  const add = (method, pattern, opts, handler) => {
    const keys = [];
    const re = new RegExp(`^${pattern.replace(/:(\w+)/g, (_, k) => { keys.push(k); return '([^/]+)'; })}$`);
    routes.push({ method, re, keys, opts, handler });
  };
  const match = (method, pathname) => {
    let pathMatched = false;
    for (const r of routes) {
      const m = r.re.exec(pathname);
      if (!m) continue;
      pathMatched = true;
      if (r.method !== method) continue;
      let params;
      try {
        params = Object.fromEntries(r.keys.map((k, i) => [k, decodeURIComponent(m[i + 1])]));
      } catch {
        throw invalid('Adresse invalide.');
      }
      return { route: r, params };
    }
    if (pathMatched) throw new AppError(405, 'METHODE', 'Méthode non autorisée.');
    return null;
  };
  return { add, match };
}

// The client space's paths (worker/clientApi.js): served by their own route table, with their own sessions.
const CLIENT_PATH = /^\/api\/client(\/|$)/;

// `demo`: this API is the demo space's. Everything that differs there (accounts refused, exported file
// names, the reset route, the two entry points below) follows this option, never `club.demo`, which
// the tests also set on a real club to relax the tariffs.
// `sendPush(subscription, message)`: sends one notification to one staff device and gives { status }. The tests pass a
// recorder; otherwise it is Web Push (worker/push.js) with the three VAPID secrets, and without them nothing is sent.
export function createApi({ db, env = {}, demo = false, sendPush: pushSender = null }) {
  migrate(db);
  const club = new Club(db, { demo });
  club.bootstrap();

  // The secrets are pasted by hand: a space or a line break around a value would break every send (and the key the
  // devices subscribe with), so each is trimmed once here.
  const [vapidPublic, vapidPrivate, vapidSubject] = [env.VAPID_PUBLIC_KEY, env.VAPID_PRIVATE_KEY, env.VAPID_SUBJECT]
    .map((v) => String(v ?? '').trim());
  const vapid = vapidPublic && vapidPrivate && vapidSubject
    ? { publicKey: vapidPublic, privateKey: vapidPrivate, subject: vapidSubject }
    : null;
  // The demo space never sends: its accounts are the real club's, and so would be the devices told of a fictitious order.
  const sendPush = demo ? null : pushSender ?? (vapid ? (subscription, message) => sendWebPush(subscription, message, vapid) : null);

  const allowedOrigins = String(env.ALLOWED_ORIGINS ?? '').split(',').map((s) => s.trim()).filter(Boolean);
  const throttle = new Map();
  let dummyHashPromise = null;
  // A password hash no account has: an unknown login is checked against it, so the answer takes as long as for a real one.
  const dummyHash = () => (dummyHashPromise ??= hashPassword('mot-de-passe-factice-pour-egaliser-le-temps'));

  // Five failures in a row lock the key (address + login) for one minute.
  const checkThrottle = (key) => {
    const t = throttle.get(key);
    if (t && t.until > Date.now()) throw new AppError(429, 'TROP_DE_TENTATIVES', 'Trop de tentatives. Réessayez dans une minute.');
  };
  const recordFailure = (key) => {
    const fails = (throttle.get(key)?.fails ?? 0) + 1;
    throttle.set(key, { fails: fails >= 5 ? 0 : fails, until: fails >= 5 ? Date.now() + 60000 : 0 });
    if (throttle.size > 5000) throttle.clear();
  };
  const clearFailures = (key) => throttle.delete(key);

  // Hashes a new password after the strength check (the business layer only stores hashes).
  const preparePassword = async (ctx, field) => {
    const weak = checkPasswordStrength(ctx.body[field]);
    if (weak) throw invalid(weak);
    ctx.passwordHash = await hashPassword(ctx.body[field]);
  };
  // A temporary client code: shown once to the staff member, only its hash is kept. Valid 7 days.
  const prepareClientCode = async (ctx) => {
    ctx.tempCode = newClientCode();
    ctx.tempHash = await hashPassword(ctx.tempCode);
  };
  const CLIENT_CODE_DAYS = 7;
  const clientCode = (ctx) => ({ tempHash: ctx.tempHash, expiresAt: new Date(club.nowMs() + CLIENT_CODE_DAYS * 86400000).toISOString() });
  const clientCodeAnswer = (ctx, res) => ({ ...res, code: ctx.tempCode, expires_at: res.status.temp_expires_at });
  const prepareSession = async (ctx) => {
    ctx.newToken = newToken();
    ctx.newTokenHash = await sha256Hex(ctx.newToken);
  };
  const openSession = (ctx, user) => {
    const res = club.openSession(user, ctx.newTokenHash);
    if (!res) throw new AppError(401, 'IDENTIFIANTS', 'Identifiant ou mot de passe incorrect.');
    ctx.setCookie(ctx.newToken, res.maxAge);
    return club.bundle(res.user);
  };

  const { add, match } = routeTable();
  const ADMIN = { roles: ['admin'] };
  // Club management: the administrator and the associés (ADMIN stays for the application itself).
  const CLUB = { roles: ['admin', 'associe'] };
  const READONLY = { readonly: true };
  // Routes refused in the demo space: they manage accounts, which are mirrored from the real club there,
  // or wipe the data (the demo has its own reset, POST /api/demo/reset).
  const ACCOUNTS = { accounts: true };
  // Photos are kept by the real club alone (the demo space only copies the products, and the interface asks the
  // real club for their pictures): adding or removing one is refused in the demo space.
  const PHOTOS = { photos: true };
  const WITH_PHOTO = { maxBody: MAX_PHOTO_BODY };
  // Exported files are named DEMO_... in the demo space, so nobody takes them for the club's own.
  const exportName = (filename) => (demo ? `DEMO_${filename}` : filename);

  // Session
  add('POST', '/api/login', {
    public: true,
    prepare: async (ctx) => {
      // The key reads the identifier as the account lookup does (trimmed, any case), so spaces or capitals
      // give no fresh tries; it stops one character past the longest identifier (40), so a huge value is not kept.
      const key = `${ctx.ip}|${String(ctx.body.login ?? '').trim().toLowerCase().slice(0, 41)}`;
      checkThrottle(key);
      const user = club.userByLogin(ctx.body.login);
      const valid = await verifyPassword(String(ctx.body.password ?? ''), user?.password_hash ?? await dummyHash());
      if (!user || !valid || !user.active) {
        recordFailure(key);
        throw new AppError(401, 'IDENTIFIANTS', 'Identifiant ou mot de passe incorrect.');
      }
      throttle.delete(key);
      ctx.loginUser = user;
      await prepareSession(ctx);
    },
  }, (ctx) => openSession(ctx, ctx.loginUser));
  add('POST', '/api/logout', {}, (ctx) => {
    club.logout(ctx.tokenHash);
    ctx.setCookie('', 0);
    return { ok: true };
  });
  add('GET', '/api/me', {}, (ctx) => club.bundle(ctx.user));
  // The body holds passwords: the password routes keep no idempotency record, whose request hash would be a fast hash
  // of them (security audit run-2), as the client password route does.
  add('POST', '/api/me/password', {
    ...ACCOUNTS,
    noIdempotency: true,
    prepare: async (ctx) => {
      // The new password's strength is checked first, so a weak one tells nothing about the current one. Wrong current
      // passwords count like failed sign-ins, per account: an open session cannot be used to guess it at will.
      const weak = checkPasswordStrength(ctx.body.new_password);
      if (weak) throw invalid(weak);
      const key = `compte:${ctx.user.id}|mot-de-passe`;
      checkThrottle(key);
      const u = club.userRow(ctx.user.id);
      if (!(await verifyPassword(String(ctx.body.current_password ?? ''), u.password_hash))) {
        recordFailure(key);
        throw invalid('Mot de passe actuel incorrect.');
      }
      clearFailures(key);
      await preparePassword(ctx, 'new_password');
    },
  }, (ctx) => club.changeOwnPassword(ctx.user, ctx.passwordHash, ctx.tokenHash));

  // A secret of the Worker (SETUP_TOKEN, IMPORT_TOKEN) against the code a caller gives, compared by SHA-256
  // digest. Without the secret configured the answer is 503, and five wrong codes in a row lock the caller's
  // address for a minute (each secret has its own count, and the right code starts it again).
  const checkSecret = async (ctx, { scope, secret, given, absent, wrong }) => {
    const key = `${ctx.ip}|${scope}`;
    checkThrottle(key);
    if (!secret) throw new AppError(503, 'CODE_ABSENT', absent);
    if (await sha256Hex(String(given ?? '')) !== await sha256Hex(secret)) {
      recordFailure(key);
      throw new AppError(403, 'CODE_INCORRECT', wrong);
    }
    throttle.delete(key);
  };

  // First start online: the first administrator is created with the SETUP_TOKEN secret. The same
  // installation code gives that account a new identifier and password when they are lost.
  const checkSetupToken = (ctx) => checkSecret(ctx, {
    scope: 'installation',
    secret: env.SETUP_TOKEN,
    given: ctx.body.setup_token,
    absent: "Le code d'installation (secret SETUP_TOKEN) n'est pas configuré sur le serveur.",
    wrong: "Code d'installation incorrect.",
  });
  // The catalogue import door: the code comes in a header of its own, since the door has no session, and is
  // checked before the body is read (the route's `guard`).
  const checkImportToken = (ctx) => checkSecret(ctx, {
    scope: 'import',
    secret: env.IMPORT_TOKEN,
    given: ctx.headers.get('x-import-token'),
    absent: "Le code d'import (secret IMPORT_TOKEN) n'est pas configuré sur le serveur.",
    wrong: "Code d'import incorrect.",
  });
  add('GET', '/api/setup', { public: true }, () => ({ needed: !club.hasUsers(), token_configured: !!env.SETUP_TOKEN }));
  add('POST', '/api/setup', {
    public: true,
    prepare: async (ctx) => {
      if (club.hasUsers()) throw conflict('DEJA_INSTALLE', 'Le club est déjà configuré : connectez-vous.');
      await checkSetupToken(ctx);
      await preparePassword(ctx, 'password');
      await prepareSession(ctx);
    },
  }, (ctx) => {
    if (club.hasUsers()) throw conflict('DEJA_INSTALLE', 'Le club est déjà configuré : connectez-vous.');
    const user = club.createUser(null, { ...ctx.body, role: 'admin', password_hash: ctx.passwordHash });
    return openSession(ctx, user);
  });
  add('POST', '/api/setup/reset', {
    public: true,
    prepare: async (ctx) => {
      if (!club.hasUsers()) throw conflict('NON_INSTALLE', "Le club n'est pas encore installé : créez d'abord le premier compte.");
      await checkSetupToken(ctx);
      await preparePassword(ctx, 'password');
      await prepareSession(ctx);
    },
  }, (ctx) => openSession(ctx, club.resetOwnerAccess({ login: ctx.body.login, password_hash: ctx.passwordHash })));

  // Administration
  add('PUT', '/api/settings', ADMIN, (ctx) => {
    club.updateSettings(ctx.user, ctx.body);
    return club.bundle(ctx.user);
  });
  add('PUT', '/api/plans/:id', ADMIN, (ctx) => {
    club.updatePlan(ctx.user, ctx.params.id, ctx.body);
    return club.bundle(ctx.user);
  });
  add('GET', '/api/users', { ...ADMIN, ...ACCOUNTS }, () => club.listUsers());
  add('POST', '/api/users', { ...ADMIN, ...ACCOUNTS, noIdempotency: true, prepare: (ctx) => preparePassword(ctx, 'password') },
    (ctx) => club.createUser(ctx.user, { ...ctx.body, password_hash: ctx.passwordHash }));
  add('PUT', '/api/users/:id', { ...ADMIN, ...ACCOUNTS }, (ctx) => club.updateUser(ctx.user, ctx.params.id, ctx.body));
  add('POST', '/api/users/:id/password', { ...ADMIN, ...ACCOUNTS, noIdempotency: true, prepare: (ctx) => preparePassword(ctx, 'password') },
    (ctx) => club.setUserPassword(ctx.user, ctx.params.id, ctx.passwordHash));
  add('GET', '/api/audit', CLUB, (ctx) => club.auditLog(ctx.query));
  add('POST', '/api/admin/reset', { ...ADMIN, ...ACCOUNTS }, (ctx) => club.wipeData(ctx.user, ctx.body.confirm));
  // Catalogue import: a temporary door for a script on the owner's computer, one product per call, open only
  // while the IMPORT_TOKEN secret exists. There is no session: the code is the whole credential, so the door
  // belongs to the real club alone (the demo space answers 404).
  if (!demo) {
    add('POST', '/api/admin/catalog-import', { public: true, ...WITH_PHOTO, guard: checkImportToken }, (ctx) => club.importCatalog(ctx.body));
  }
  // Demo space only (the real club answers 404): empties the space and fills it again from the real
  // club's configuration, which handleDemo hands over with the request.
  if (demo) {
    add('POST', '/api/demo/reset', ADMIN, (ctx) => {
      club.resetDemo(ctx.demoConfig, ctx.user);
      return club.bundle(ctx.user);
    });
  }

  // Overview
  // A GET that writes: the home page first renews the subscriptions due today (the demo space has no scheduled
  // task), each member in a transaction of its own, then reads the overview.
  add('GET', '/api/dashboard', {}, (ctx) => {
    renewDue();
    return club.dashboard(ctx.user);
  });

  // Members, subscriptions, cards
  add('GET', '/api/members', {}, (ctx) => club.listMembers(ctx.query.q, ctx.query.statut));
  add('POST', '/api/members', {}, (ctx) => club.createMember(ctx.user, ctx.body));
  add('GET', '/api/clients', {}, (ctx) => club.listClients(ctx.query.q, ctx.query.statut));
  add('POST', '/api/clients', {}, (ctx) => club.createClient(ctx.user, ctx.body));
  // Open to every signed-in user: the rights (gérant, or the boss of the rayon) are checked inside.
  add('POST', '/api/shop/sales', {}, (ctx) => club.createShopSale(ctx.user, ctx.body));
  // Orders placed by the clients (worker/clientOrders.js): every staff member sees them all; the counter turns one into
  // a Boutique sale (POST /api/shop/sales with order_id).
  add('GET', '/api/orders', {}, (ctx) => club.staffOrders(ctx.user));
  add('POST', '/api/reservation-requests/:id/refuse', {}, (ctx) => club.refuseRequest(ctx.user, ctx.params.id, ctx.body));
  add('POST', '/api/orders/:id/ready', {}, (ctx) => club.markOrderReady(ctx.user, ctx.params.id));
  add('POST', '/api/orders/:id/cancel', {}, (ctx) => club.cancelOrder(ctx.user, ctx.params.id, ctx.body));
  add('POST', '/api/orders/:id/close', {}, (ctx) => club.closeOrder(ctx.user, ctx.params.id));
  add('POST', '/api/shop/sales/:id/cancel', {}, (ctx) => club.cancelShopSale(ctx.user, ctx.params.id, ctx.body));
  add('POST', '/api/clients/:id/convert', {}, (ctx) => club.convertClient(ctx.user, ctx.params.id));
  // Credit of the regular clients (worker/credit.js): the account and the settlements are open to every signed-in user
  // (the manager collects them); the limit and a settlement's cancellation are checked inside (administrator, associés).
  add('GET', '/api/clients/:id/account', {}, (ctx) => club.clientAccount(ctx.params.id));
  add('PUT', '/api/clients/:id/credit-limit', {}, (ctx) => club.setCreditLimit(ctx.user, ctx.params.id, ctx.body));
  add('POST', '/api/clients/:id/settlements', {}, (ctx) => club.recordSettlement(ctx.user, ctx.params.id, ctx.body));
  add('POST', '/api/payments/:id/cancel-settlement', {}, (ctx) => club.cancelSettlement(ctx.user, ctx.params.id, ctx.body));
  add('GET', '/api/members/:id', {}, (ctx) => club.memberDetail(ctx.params.id));
  add('GET', '/api/members/:id/purchases', {}, (ctx) => club.purchaseHistory(ctx.params.id));
  add('GET', '/api/members/:id/statement', {}, (ctx) => club.memberStatement(ctx.params.id, ctx.query.from, ctx.query.to));
  add('PUT', '/api/members/:id', {}, (ctx) => club.updateMember(ctx.user, ctx.params.id, ctx.body));
  // Members are deactivated, never deleted: their payments and transactions stay in the books.
  add('POST', '/api/members/:id/deactivate', {}, (ctx) => club.deactivateMember(ctx.user, ctx.params.id, ctx.body));
  // Client space access. Whoever holds a temporary code may enter the client's space: only the administrator and the
  // associés create an access, give a new code or restore a cut access. Every staff member sees the access and may cut
  // it, which only protects the client. The temporary code is returned once, never logged.
  add('GET', '/api/members/:id/client-access', { ...ACCOUNTS }, (ctx) => club.clientAccessStatus(club.fileRow(ctx.params.id).id));
  add('POST', '/api/members/:id/client-access', { ...ACCOUNTS, ...CLUB, noIdempotency: true, prepare: prepareClientCode },
    (ctx) => clientCodeAnswer(ctx, club.createClientAccess(ctx.user, ctx.params.id, clientCode(ctx))));
  add('POST', '/api/members/:id/client-access/code', { ...ACCOUNTS, ...CLUB, noIdempotency: true, prepare: prepareClientCode },
    (ctx) => clientCodeAnswer(ctx, club.renewClientCode(ctx.user, ctx.params.id, clientCode(ctx))));
  add('POST', '/api/members/:id/client-access/disable', { ...ACCOUNTS }, (ctx) => club.setClientAccessActive(ctx.user, ctx.params.id, false));
  add('POST', '/api/members/:id/client-access/enable', { ...ACCOUNTS, ...CLUB }, (ctx) => club.setClientAccessActive(ctx.user, ctx.params.id, true));
  add('POST', '/api/members/:id/reactivate', {}, (ctx) => club.reactivateMember(ctx.user, ctx.params.id));
  add('POST', '/api/members/:id/subscriptions', {}, (ctx) => club.activateSubscription(ctx.user, ctx.params.id, ctx.body));
  add('POST', '/api/subscriptions/:id/cancel', CLUB, (ctx) => club.cancelSubscription(ctx.user, ctx.params.id, ctx.body));
  add('POST', '/api/subscriptions/:id/adjust', CLUB, (ctx) => club.adjustCredit(ctx.user, ctx.params.id, ctx.body));
  add('POST', '/api/members/:id/cards', {}, (ctx) => club.issueCard(ctx.user, ctx.params.id, ctx.body));
  add('POST', '/api/cards/:id/deactivate', {}, (ctx) => club.deactivateCard(ctx.user, ctx.params.id, ctx.body));
  add('GET', '/api/cards/lookup', {}, (ctx) => club.lookupCard(ctx.query.code));
  add('GET', '/api/cards/:id', {}, (ctx) => club.cardView(ctx.params.id));
  // The card's CFA credit: any staff member recharges it, only an administrator cancels a recharge.
  add('POST', '/api/members/:id/wallet/recharge', {}, (ctx) => club.rechargeWallet(ctx.user, ctx.params.id, ctx.body));
  add('POST', '/api/members/:id/outside-meal', {}, (ctx) => club.recordOutsideMeal(ctx.user, ctx.params.id, ctx.body));
  add('POST', '/api/payments/:id/cancel-meal', CLUB, (ctx) => club.cancelOutsideMeal(ctx.user, ctx.params.id, ctx.body));
  add('POST', '/api/payments/:id/cancel-recharge', CLUB, (ctx) => club.cancelRecharge(ctx.user, ctx.params.id, ctx.body));

  // Rooms
  add('GET', '/api/rooms', {}, (ctx) => club.rooms({ includeInactive: ctx.query.all === '1' }));
  add('POST', '/api/rooms', ADMIN, (ctx) => {
    const room = club.createRoom(ctx.user, ctx.body);
    return { room, bundle: club.bundle(ctx.user) };
  });
  add('PUT', '/api/rooms/:id', ADMIN, (ctx) => {
    const room = club.updateRoom(ctx.user, ctx.params.id, ctx.body);
    return { room, bundle: club.bundle(ctx.user) };
  });
  add('DELETE', '/api/rooms/:id', ADMIN, (ctx) => {
    const res = club.deleteRoom(ctx.user, ctx.params.id);
    return { ...res, bundle: club.bundle(ctx.user) };
  });

  // Reservations
  add('GET', '/api/reservations', {}, (ctx) => club.listReservations(ctx.query));
  add('POST', '/api/reservations/quote', READONLY, (ctx) => club.quoteReservation(ctx.user, ctx.body));
  add('POST', '/api/reservations', {}, (ctx) => club.createReservation(ctx.user, ctx.body));
  add('GET', '/api/reservations/:id', {}, (ctx) => club.reservationDetail(ctx.params.id));
  add('PUT', '/api/reservations/:id/occupancy', {}, (ctx) => club.updateReservationOccupancy(ctx.user, ctx.params.id, ctx.body));
  add('POST', '/api/reservations/:id/attendees', {}, (ctx) => club.addReservationAttendee(ctx.user, ctx.params.id, ctx.body));
  add('DELETE', '/api/reservations/:id/attendees/:memberId', {}, (ctx) => club.removeReservationAttendee(ctx.user, ctx.params.id, ctx.params.memberId));
  add('POST', '/api/reservations/:id/extend/quote', READONLY, (ctx) => club.quoteExtension(ctx.user, ctx.params.id, ctx.body));
  add('POST', '/api/reservations/:id/extend', {}, (ctx) => club.extendReservation(ctx.user, ctx.params.id, ctx.body));
  add('POST', '/api/reservations/:id/start', {}, (ctx) => club.startReservation(ctx.user, ctx.params.id));
  add('POST', '/api/reservations/:id/finish', {}, (ctx) => club.finishReservation(ctx.user, ctx.params.id, ctx.body));
  add('POST', '/api/reservations/:id/departure', {}, (ctx) => club.correctDeparture(ctx.user, ctx.params.id, ctx.body));
  add('POST', '/api/reservations/:id/cancel', {}, (ctx) => club.cancelReservation(ctx.user, ctx.params.id, ctx.body));
  add('POST', '/api/reservations/:id/items', {}, (ctx) => club.addItem(ctx.user, ctx.params.id, ctx.body));

  // Money
  add('POST', '/api/charges/:id/cancel', {}, (ctx) => club.cancelCharge(ctx.user, ctx.params.id, ctx.body));
  add('POST', '/api/charges/:id/refund', {}, (ctx) => club.refundCharge(ctx.user, ctx.params.id, ctx.body));
  add('POST', '/api/payments', {}, (ctx) => club.recordPayment(ctx.user, ctx.body));
  add('GET', '/api/payments/:id/ticket', {}, (ctx) => club.ticketFor(ctx.user, ctx.params.id));
  add('POST', '/api/payments/:id/ticket-events', {}, (ctx) => club.recordTicketEvent(ctx.user, ctx.params.id, ctx.body));
  add('GET', '/api/ticket-events', CLUB, (ctx) => club.ticketEvents(ctx.query));
  // Public check of a receipt (the QR code leads here): read-only, five wrong codes in a row lock the caller's
  // address for a minute. A success does not clear the count, so a right code cannot be used to keep guessing.
  add('GET', '/api/tickets/:id/:code', { public: true }, (ctx) => {
    const key = `${ctx.ip}|ticket`;
    checkThrottle(key);
    const ticket = club.publicTicket(ctx.params.id, ctx.params.code);
    if (!ticket) {
      recordFailure(key);
      throw new AppError(404, 'TICKET_INTROUVABLE', 'Ticket introuvable.');
    }
    return { ticket };
  });
  add('GET', '/api/finance/summary', CLUB, (ctx) => club.financeSummary(ctx.query.from, ctx.query.to ?? ctx.query.from));
  add('GET', '/api/finance/billed', CLUB, (ctx) => club.billedLines(ctx.query.from, ctx.query.to ?? ctx.query.from));
  add('GET', '/api/shop/summary', CLUB, (ctx) => club.shopSummary(ctx.query.from, ctx.query.to ?? ctx.query.from));
  add('GET', '/api/finance/journal', {}, (ctx) => {
    if (!isBoss(ctx.user)) {
      const today = club.bizToday();
      return { ...club.journal(today, today), restricted: true };
    }
    return club.journal(ctx.query.from, ctx.query.to ?? ctx.query.from);
  });
  add('GET', '/api/finance/open', {}, () => club.openCharges());
  // The Excel export is built in the browser from this JSON, which names the file; the CSV is a download
  // answered by `respond`. In the demo space both get the DEMO_ prefix.
  add('GET', '/api/export/:kind', CLUB, (ctx) => {
    if (ctx.query.format !== 'json') return { __file: club.exportCsv(ctx.params.kind, ctx.query) };
    const sheet = club.exportJson(ctx.params.kind, ctx.query);
    return { ...sheet, filename: exportName(sheet.filename) };
  });

  // Expenses, treasury, general ledger, monthly closing
  add('GET', '/api/ledger/categories', {}, () => club.listCategories());
  add('POST', '/api/ledger/categories', ADMIN, (ctx) => club.createCategory(ctx.user, ctx.body));
  add('PUT', '/api/ledger/categories/:id', ADMIN, (ctx) => club.updateCategory(ctx.user, ctx.params.id, ctx.body));
  add('GET', '/api/ledger/entries', {}, (ctx) => club.listEntries(ctx.query, ctx.user));
  add('POST', '/api/ledger/entries', {}, (ctx) => club.createEntry(ctx.user, ctx.body));
  add('POST', '/api/ledger/entries/:id/cancel', CLUB, (ctx) => club.cancelEntry(ctx.user, ctx.params.id, ctx.body));
  add('GET', '/api/ledger/book', CLUB, (ctx) => club.ledgerBook(ctx.query));
  add('GET', '/api/treasury', CLUB, (ctx) => club.treasury(ctx.query.from, ctx.query.to ?? ctx.query.from));
  // The associés' caisses: the six tiles of « Soldes » at the end of a business day (today by default).
  add('GET', '/api/caisses', CLUB, (ctx) => club.caisseBalances(ctx.query.to || undefined));
  add('POST', '/api/caisses/retrait', CLUB, (ctx) => club.takeProfits(ctx.user, ctx.body));
  // Supplier accounts: what the club owes each supplier, its credit purchases and the balances carried over (a payment
  // is an expense: POST /api/ledger/entries with supplier_id).
  add('GET', '/api/suppliers', CLUB, () => club.listSuppliers());
  add('POST', '/api/suppliers', CLUB, (ctx) => club.createSupplier(ctx.user, ctx.body));
  add('GET', '/api/suppliers/:id', CLUB, (ctx) => club.supplierSheet(ctx.params.id));
  add('PUT', '/api/suppliers/:id', CLUB, (ctx) => club.updateSupplier(ctx.user, ctx.params.id, ctx.body));
  add('POST', '/api/suppliers/:id/purchases', CLUB, (ctx) => club.recordSupplierPurchase(ctx.user, ctx.params.id, ctx.body));
  add('POST', '/api/suppliers/purchases/:id/cancel', CLUB, (ctx) => club.cancelSupplierPurchase(ctx.user, ctx.params.id, ctx.body));
  // The cash page's « Compter la caisse »: the first cash fund (the settings change, so the bundle comes back), then counts.
  add('POST', '/api/treasury/fund', ADMIN, (ctx) => ({ treasury: club.setCashFund(ctx.user, ctx.body), bundle: club.bundle(ctx.user) }));
  add('POST', '/api/treasury/count', CLUB, (ctx) => club.countCash(ctx.user, ctx.body));
  // The evening closing of the till: the manager or an administrator closes the day; only an administrator reopens it.
  add('GET', '/api/day-closing', {}, (ctx) => club.dayClosing(ctx.query.day, ctx.user));
  add('POST', '/api/day-closing', {}, (ctx) => club.closeDay(ctx.user, ctx.body));
  add('POST', '/api/day-closing/:day/reopen', CLUB, (ctx) => club.reopenDay(ctx.user, ctx.params.day, ctx.body));
  add('POST', '/api/day-closing/:day/verify', CLUB, (ctx) => club.verifyDay(ctx.user, ctx.params.day));
  add('GET', '/api/closings', CLUB, () => club.closings());
  add('POST', '/api/closings', CLUB, (ctx) => club.closeMonth(ctx.user, ctx.body));
  add('POST', '/api/closings/:month/reopen', CLUB, (ctx) => club.reopenMonth(ctx.user, ctx.params.month, ctx.body));

  // Push notifications on the staff's devices (worker/push.js): the public key a browser subscribes with (null while the
  // VAPID secrets are missing: notifications are off), and the device's subscription, kept for the signed-in account. Any
  // role may subscribe a device; pushRecipients decides who is told (never the administrator). The real club's alone.
  if (!demo) {
    add('GET', '/api/push/key', {}, () => ({ key: vapid?.publicKey ?? null }));
    add('POST', '/api/push/subscriptions', {}, (ctx) => club.subscribePush(ctx.user, ctx.body));
    add('DELETE', '/api/push/subscriptions', {}, (ctx) => club.unsubscribePush(ctx.user, ctx.body));
  }

  // Products & stock
  add('GET', '/api/products', {}, (ctx) => club.listProducts({ includeInactive: ctx.query.all === '1' }));
  add('POST', '/api/products', CLUB, (ctx) => club.createProduct(ctx.user, ctx.body));
  add('PUT', '/api/products/:id', CLUB, (ctx) => club.updateProduct(ctx.user, ctx.params.id, ctx.body));
  add('POST', '/api/products/:id/stock', {}, (ctx) => club.stockOperation(ctx.user, ctx.params.id, ctx.body));
  // The picture itself, for a browser's <img> (signed in, no demo header: the real club answers). The address carries
  // the photo's version (?v=) for the browser's cache and the server does not read it.
  add('GET', '/api/products/:id/photo', {}, (ctx) => ({ __image: club.productPhoto(ctx.params.id) }));
  add('PUT', '/api/products/:id/photo', { ...CLUB, ...PHOTOS, ...WITH_PHOTO }, (ctx) => club.setProductPhoto(ctx.user, ctx.params.id, ctx.body));
  add('DELETE', '/api/products/:id/photo', { ...CLUB, ...PHOTOS }, (ctx) => club.removeProductPhoto(ctx.user, ctx.params.id));
  add('GET', '/api/stock-movements', {}, (ctx) => club.stockMovements(ctx.query));

  // Cross-site writes are refused: browsers cannot send application/json cross-origin without a
  // CORS preflight (which this API never grants), and a present Origin must be this site.
  function checkCsrf(request, url) {
    const type = String(request.headers.get('content-type') ?? '');
    if (!type.startsWith('application/json')) throw new AppError(415, 'TYPE_CONTENU', 'Requête refusée : JSON attendu.');
    const origin = request.headers.get('origin');
    if (origin && origin !== url.origin && !allowedOrigins.includes(origin)) throw forbidden('Requête refusée : origine inconnue.');
  }

  // Every write, the staff's (handle) and the client's (worker/clientApi.js), runs here; `records` says where the
  // idempotency records of `ownerId` (the staff account, or the client access) are kept. With an Idempotency-Key, a retry
  // of a write that already succeeded is answered from its record at once (`replayed`), without redoing the preparation;
  // the same key with other data is refused. Otherwise the route's preparation runs, then the handler and the record in
  // one transaction: the whole write commits or rolls back as one unit. A route that answers a secret shown once
  // (noIdempotency) never records nor replays: the answer would sit in the table. Once the transaction has committed, the
  // notifications the handler queued in `ctx.after` go out (notify); a replay, which runs no handler, queues none.
  async function runWrite(request, url, route, ctx, records, ownerId) {
    const key = route.opts.noIdempotency ? undefined : request.headers.get('idempotency-key') ?? undefined;
    if (key !== undefined && !/^[A-Za-z0-9_-]{8,100}$/.test(key)) throw invalid("Clé d'idempotence invalide.");
    const hash = key && ownerId ? await sha256Hex(JSON.stringify([request.method, url.pathname, ctx.body])) : null;
    const replay = () => {
      const prev = club.get(records.find, key, ownerId);
      if (!prev) return undefined;
      if (prev.request_hash !== hash) {
        throw new AppError(422, 'CLE_REUTILISEE', "Cette opération a déjà été enregistrée avec d'autres données. Rechargez la page.");
      }
      return JSON.parse(prev.response);
    };
    if (hash) {
      const previous = replay();
      if (previous !== undefined) return { payload: previous, replayed: true };
    }
    if (route.opts.prepare) await route.opts.prepare(ctx);
    let replayed = false;
    const payload = club.tx(() => {
      if (!hash) return route.handler(ctx);
      const previous = replay();
      if (previous !== undefined) {
        replayed = true;
        return previous;
      }
      const result = route.handler(ctx);
      club.run(records.insert, key, ownerId, hash, JSON.stringify(result ?? null), new Date().toISOString());
      return result;
    });
    if (!replayed) await notify(ctx.after).catch((err) => console.error('Notifications push :', err));
    return { payload, replayed };
  }

  // The notifications a committed write queued: each is a function, called now, that gives the messages to send
  // ([{ userIds, title, body, url }]). Every device of every recipient is sent its message, all at once, and the answer
  // waits for them PUSH_TIMEOUT_MS at most. Nothing here fails the write nor throws: an error is logged (never a key, nor
  // a device's address beyond its push service), and a device its push service no longer knows (404, 410) is forgotten.
  async function notify(after) {
    if (!sendPush || !after?.length) return;
    const sends = [];
    for (const messages of after) {
      try {
        for (const { userIds, title, body, url } of messages()) {
          for (const subscription of club.pushSubscriptionsOf(userIds)) sends.push(pushOne(subscription, { title, body, url }));
        }
      } catch (err) {
        console.error('Notifications push non préparées :', err);
      }
    }
    if (!sends.length) return;
    let timer;
    const late = new Promise((resolve) => { timer = setTimeout(() => resolve(true), PUSH_TIMEOUT_MS); });
    const timedOut = await Promise.race([Promise.allSettled(sends).then(() => false), late]);
    clearTimeout(timer);
    if (timedOut) console.error(`Notifications push : pas de réponse en ${PUSH_TIMEOUT_MS / 1000} s, la réponse part sans les attendre.`);
  }

  async function pushOne(subscription, message) {
    let service = 'un service de notification';
    try {
      service = new URL(subscription.endpoint).origin;
      const status = (await sendPush(subscription, message))?.status;
      if (status === 404 || status === 410) club.forgetPushSubscription(subscription.endpoint);
      else if (!(status >= 200 && status < 300)) console.error(`Notification push refusée par ${service} (statut ${status}).`);
    } catch (err) {
      console.error(`Notification push non envoyée à ${service} : ${err?.message ?? err}`);
    }
  }
  // Where each space keeps its idempotency records: the staff's per account (with the answer's status, always 200), the
  // client's per client access.
  const STAFF_RECORDS = {
    find: 'SELECT * FROM idempotency_keys WHERE key = ? AND user_id = ?',
    insert: 'INSERT INTO idempotency_keys (key, user_id, request_hash, response, created_at, status) VALUES (?, ?, ?, ?, ?, 200)',
  };
  const CLIENT_RECORDS = {
    find: 'SELECT * FROM client_idempotency WHERE key = ? AND account_id = ?',
    insert: 'INSERT INTO client_idempotency (key, account_id, request_hash, response, created_at) VALUES (?, ?, ?, ?, ?)',
  };

  // The client space exists in the real club only, as the staff's accounts do: the demo space has none.
  const clientRoutes = demo ? null : createClientRoutes({
    club, env, helpers: {
      routeTable, checkThrottle, recordFailure, clearFailures, dummyHash, readJson, checkCsrf, json, errorResponse, imageResponse,
      runClientWrite: (request, url, route, ctx) => runWrite(request, url, route, ctx, CLIENT_RECORDS, ctx.account?.id),
    },
  });

  // `user` (the signed-in account's row) and `demoConfig` come from handleDemo alone, never from the
  // network: the demo space reads no cookie and looks up no session, it serves the request as `user`.
  async function handle(request, { user = null, demoConfig = null } = {}) {
    if ((user || demoConfig) && !demo) throw new Error('handle: only the demo space is given an identity.');
    const url = new URL(request.url);
    // A client path never reaches the staff's routes, nor reads their `sid`: worker/clientApi.js serves it whole. In the
    // demo space, which has no client routes, it is an unknown path like any other (and the Worker's router keeps it away).
    if (clientRoutes && CLIENT_PATH.test(url.pathname)) return clientRoutes.handleClient(request, url);
    const cookies = [];
    const secure = url.protocol === 'https:';
    const cookieHeader = (value, maxAge) => [
      `sid=${encodeURIComponent(value)}`, 'Path=/', 'HttpOnly', 'SameSite=Lax', `Max-Age=${maxAge}`, secure ? 'Secure' : null,
    ].filter(Boolean).join('; ');
    try {
      // Sign-in, sign-out and installation belong to the real club, where sessions live: with an identity
      // handed over, the demo space does not know them. The Worker's router keeps them away already.
      const found = user && ALWAYS_REAL.test(url.pathname) ? null : match(request.method, url.pathname);
      if (!found) throw new AppError(404, 'INTROUVABLE', 'Ressource inconnue.');
      const { route, params } = found;
      const writes = request.method !== 'GET';
      if (writes) checkCsrf(request, url);
      const token = user ? null : (parseCookies(request.headers.get('cookie')).sid || null);
      const ctx = {
        params, body: null, token, tokenHash: token ? await sha256Hex(token) : null, user: null, demoConfig,
        headers: request.headers,
        ip: request.headers.get('cf-connecting-ip') ?? 'local',
        query: Object.fromEntries(url.searchParams),
        setCookie: (value, maxAge) => cookies.push(cookieHeader(value, maxAge)),
        after: [],
      };
      // A credential that is not in the body is checked before the body is read, so that a caller without it
      // makes the Worker read and parse nothing (the import door's body may be up to 300 KB). The guard finds no
      // body to look into: `ctx.body` is null until then.
      if (route.opts.guard) await route.opts.guard(ctx);
      ctx.body = writes ? await readJson(request, route.opts.maxBody) : {};
      if (!route.opts.public) {
        ctx.user = user ?? club.sessionUser(ctx.tokenHash);
        // A session's account is active by construction; the one handleDemo hands over may have been deactivated.
        if (!ctx.user?.active) throw notSignedIn();
        if (demo && route.opts.accounts) throw new AppError(403, 'MODE_DEMO', 'Les comptes se gèrent hors du mode démo.');
        if (demo && route.opts.photos) throw new AppError(403, 'MODE_DEMO', 'Les photos se gèrent hors du mode démo.');
        if (route.opts.roles && !route.opts.roles.includes(ctx.user.role)) throw forbidden();
      }

      if (!writes || route.opts.readonly) {
        if (route.opts.prepare) await route.opts.prepare(ctx);
        return respond(route.handler(ctx), cookies, false);
      }

      const { payload, replayed } = await runWrite(request, url, route, ctx, STAFF_RECORDS, ctx.user?.id);
      return respond(payload, cookies, replayed);
    } catch (err) {
      return errorResponse(err);
    }
  }

  function respond(payload, cookies, replayed) {
    if (payload?.__file) {
      const { filename, content } = payload.__file;
      return new Response(content, {
        status: 200,
        headers: {
          ...SECURITY_HEADERS,
          'Content-Type': 'text/csv; charset=utf-8',
          'Content-Disposition': `attachment; filename="${exportName(filename).replace(/[^\w.-]/g, '_')}"`,
        },
      });
    }
    if (payload?.__image) return imageResponse(payload.__image);
    return json(200, payload, { cookies, replayed });
  }

  // Local development only: a fresh database gets the accounts with known passwords, and no data.
  // Never in the demo space: its accounts are mirrored from the real club (Club.mirrorUsers).
  async function init() {
    if (demo || env.DEMO_ACCOUNTS !== '1' || club.hasUsers()) return;
    const accounts = [];
    for (const a of DEMO_ACCOUNTS) accounts.push({ ...a, password_hash: await hashPassword(a.password) });
    if (!club.hasUsers()) club.tx(() => accounts.forEach((a) => club.createUser(null, a)));
  }

  // Real club. Step one of a request made in the demo space: the session (hash of the `sid` cookie) is
  // checked here, where sessions live. Gives null without a valid session, else the account's identity
  // and the configuration the demo space copies. Wrong space is a programming error, not a response.
  function demoContext(tokenHash) {
    if (demo) throw new Error('demoContext: only the real club vouches for a session.');
    const account = club.sessionUser(tokenHash);
    if (!account) return null;
    return { user: { id: account.id, name: account.name, role: account.role }, config: club.demoConfig() };
  }

  // Demo space. Step two: prepares the space (once it is filled, only the accounts are mirrored again),
  // then serves the request as the account the real club vouched for. Only the account's id is taken
  // from `user`: its role and status are those of the mirrored row, so they follow the real club on
  // every request. Without an account (the id of a real one is never 0), nothing is prepared and the
  // answer is the usual 401. A preparation that fails answers like any other error, with a response.
  async function handleDemo(request, context) {
    if (!demo) throw new Error('handleDemo: only the demo space serves demo requests.');
    const { user, config } = context ?? {};
    if (!user?.id) return errorResponse(notSignedIn());
    let account;
    try {
      club.prepareDemo(config);
      account = club.userRow(user.id);
    } catch (err) {
      return errorResponse(err);
    }
    return handle(request, { user: account, demoConfig: config });
  }

  // The automatic renewals due today, each member in a top-level transaction of its own: a member whose renewal
  // fails is rolled back alone and logged, and holds up neither the other members nor the request that ran it.
  // Never called inside a transaction: a nested one joins the outer one, which the caught error would leave half
  // applied.
  function renewDue() {
    if (club.depth > 0) throw new Error('renewDue: each renewal must be a transaction of its own.');
    const result = { renewed: [], blocked: [], failed: [] };
    const today = club.bizToday();
    for (const memberId of club.renewalCandidates(today)) {
      try {
        const { renewed, blocked } = club.tx(() => club.runRenewals(today, memberId));
        result.renewed.push(...renewed);
        result.blocked.push(...blocked);
      } catch (err) {
        console.error(err);
        result.failed.push(memberId);
      }
    }
    return result;
  }

  // The daily scheduled task (worker/index.js): the automatic renewals of every member.
  function runRenewals() {
    return renewDue();
  }

  return { club, handle, init, demoContext, handleDemo, runRenewals };
}
