// HTTP API on the Fetch standard (Request in, Response out): routing, sessions, role checks,
// CSRF guard and idempotent writes. It runs inside the Durable Object that owns the club's database
// (worker/index.js) and, unchanged, in the Node tests.
// Each route may have an async `prepare` step (password hashing, token hashing) that runs first;
// the handler itself is synchronous and, for writes, runs in one transaction with the idempotency record.
import { Club } from './club.js';
import { migrate } from './schema.js';
import { seedDemo, DEMO_ACCOUNTS } from './seed.js';
import { AppError, forbidden, invalid, conflict } from './errors.js';
import { hashPassword, verifyPassword, sha256Hex, newToken, checkPasswordStrength } from './auth.js';

const MAX_BODY = 256 * 1024;
const SECURITY_HEADERS = {
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'same-origin',
  'X-Frame-Options': 'DENY',
  'Cache-Control': 'no-store',
};

function parseCookies(header) {
  const out = {};
  for (const part of String(header ?? '').split(';')) {
    const i = part.indexOf('=');
    if (i > 0) {
      try { out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim()); } catch { /* malformed cookie */ }
    }
  }
  return out;
}

function json(status, payload, { cookies = [], replayed = false } = {}) {
  const headers = new Headers({ ...SECURITY_HEADERS, 'Content-Type': 'application/json; charset=utf-8' });
  for (const c of cookies) headers.append('Set-Cookie', c);
  if (replayed) headers.set('Idempotent-Replayed', 'true');
  return new Response(JSON.stringify(payload ?? null), { status, headers });
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

async function readJson(request) {
  if (Number(request.headers.get('content-length') ?? 0) > MAX_BODY) throw new AppError(413, 'TROP_VOLUMINEUX', 'Requête trop volumineuse.');
  const raw = await request.text();
  if (raw.length > MAX_BODY) throw new AppError(413, 'TROP_VOLUMINEUX', 'Requête trop volumineuse.');
  if (!raw) return {};
  try {
    const data = JSON.parse(raw);
    if (data === null || typeof data !== 'object' || Array.isArray(data)) throw new Error('not an object');
    return data;
  } catch {
    throw invalid('Corps de requête JSON invalide.');
  }
}

export function createApi({ db, env = {} }) {
  migrate(db);
  const club = new Club(db, { instanceLabel: env.INSTANCE_LABEL || null });
  club.bootstrap();

  const allowedOrigins = String(env.ALLOWED_ORIGINS ?? '').split(',').map((s) => s.trim()).filter(Boolean);
  const throttle = new Map();
  let dummyHash = null;

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

  // Hashes a new password after the strength check (the business layer only stores hashes).
  const preparePassword = async (ctx, field) => {
    const weak = checkPasswordStrength(ctx.body[field]);
    if (weak) throw invalid(weak);
    ctx.passwordHash = await hashPassword(ctx.body[field]);
  };
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

  const routes = [];
  const add = (method, pattern, opts, handler) => {
    const keys = [];
    const re = new RegExp(`^${pattern.replace(/:(\w+)/g, (_, k) => { keys.push(k); return '([^/]+)'; })}$`);
    routes.push({ method, re, keys, opts, handler });
  };
  const ADMIN = { roles: ['admin'] };
  const READONLY = { readonly: true };

  // Session
  add('POST', '/api/login', {
    public: true,
    prepare: async (ctx) => {
      const key = `${ctx.ip}|${String(ctx.body.login ?? '').toLowerCase()}`;
      checkThrottle(key);
      const user = club.userByLogin(ctx.body.login);
      dummyHash ??= hashPassword('mot-de-passe-factice-pour-egaliser-le-temps');
      const valid = await verifyPassword(String(ctx.body.password ?? ''), user?.password_hash ?? await dummyHash);
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
  add('POST', '/api/me/password', {
    prepare: async (ctx) => {
      const u = club.userRow(ctx.user.id);
      if (!(await verifyPassword(String(ctx.body.current_password ?? ''), u.password_hash))) throw invalid('Mot de passe actuel incorrect.');
      await preparePassword(ctx, 'new_password');
    },
  }, (ctx) => club.changeOwnPassword(ctx.user, ctx.passwordHash, ctx.tokenHash));

  // First start online: the first administrator is created with the SETUP_TOKEN secret.
  add('GET', '/api/setup', { public: true }, () => ({
    needed: !club.hasUsers(), token_configured: !!env.SETUP_TOKEN, instance_label: club.instanceLabel,
  }));
  add('POST', '/api/setup', {
    public: true,
    prepare: async (ctx) => {
      const key = `${ctx.ip}|installation`;
      checkThrottle(key);
      if (club.hasUsers()) throw conflict('DEJA_INSTALLE', 'Le club est déjà configuré : connectez-vous.');
      if (!env.SETUP_TOKEN) {
        throw new AppError(503, 'CODE_ABSENT', "Le code d'installation (secret SETUP_TOKEN) n'est pas configuré sur le serveur.");
      }
      if (await sha256Hex(String(ctx.body.setup_token ?? '')) !== await sha256Hex(env.SETUP_TOKEN)) {
        recordFailure(key);
        throw new AppError(403, 'CODE_INCORRECT', "Code d'installation incorrect.");
      }
      await preparePassword(ctx, 'password');
      await prepareSession(ctx);
    },
  }, (ctx) => {
    if (club.hasUsers()) throw conflict('DEJA_INSTALLE', 'Le club est déjà configuré : connectez-vous.');
    const user = club.createUser(null, { ...ctx.body, role: 'admin', password_hash: ctx.passwordHash });
    return openSession(ctx, user);
  });

  // Administration
  add('PUT', '/api/settings', ADMIN, (ctx) => {
    club.updateSettings(ctx.user, ctx.body);
    return club.bundle(ctx.user);
  });
  add('PUT', '/api/plans/:id', ADMIN, (ctx) => {
    club.updatePlan(ctx.user, ctx.params.id, ctx.body);
    return club.bundle(ctx.user);
  });
  add('GET', '/api/users', ADMIN, () => club.listUsers());
  add('POST', '/api/users', { ...ADMIN, prepare: (ctx) => preparePassword(ctx, 'password') },
    (ctx) => club.createUser(ctx.user, { ...ctx.body, password_hash: ctx.passwordHash }));
  add('PUT', '/api/users/:id', ADMIN, (ctx) => club.updateUser(ctx.user, ctx.params.id, ctx.body));
  add('POST', '/api/users/:id/password', { ...ADMIN, prepare: (ctx) => preparePassword(ctx, 'password') },
    (ctx) => club.setUserPassword(ctx.user, ctx.params.id, ctx.passwordHash));
  add('GET', '/api/audit', ADMIN, (ctx) => club.auditLog(ctx.query));
  add('POST', '/api/admin/demo', ADMIN, (ctx) => {
    seedDemo(club, { actor: ctx.user });
    return club.bundle(ctx.user);
  });
  add('POST', '/api/admin/reset', ADMIN, (ctx) => club.wipeData(ctx.user, ctx.body.confirm));

  // Overview
  add('GET', '/api/dashboard', {}, (ctx) => club.dashboard(ctx.user));

  // Members, subscriptions, cards
  add('GET', '/api/members', {}, (ctx) => club.listMembers(ctx.query.q, ctx.query.statut));
  add('POST', '/api/members', {}, (ctx) => club.createMember(ctx.user, ctx.body));
  add('GET', '/api/members/:id', {}, (ctx) => club.memberDetail(ctx.params.id));
  add('PUT', '/api/members/:id', {}, (ctx) => club.updateMember(ctx.user, ctx.params.id, ctx.body));
  // Members are deactivated, never deleted: their payments and transactions stay in the books.
  add('POST', '/api/members/:id/deactivate', {}, (ctx) => club.deactivateMember(ctx.user, ctx.params.id, ctx.body));
  add('POST', '/api/members/:id/reactivate', {}, (ctx) => club.reactivateMember(ctx.user, ctx.params.id));
  add('POST', '/api/members/:id/subscriptions', {}, (ctx) => club.activateSubscription(ctx.user, ctx.params.id, ctx.body));
  add('POST', '/api/subscriptions/:id/cancel', ADMIN, (ctx) => club.cancelSubscription(ctx.user, ctx.params.id, ctx.body));
  add('POST', '/api/subscriptions/:id/adjust', ADMIN, (ctx) => club.adjustCredit(ctx.user, ctx.params.id, ctx.body));
  add('POST', '/api/members/:id/cards', {}, (ctx) => club.issueCard(ctx.user, ctx.params.id, ctx.body));
  add('POST', '/api/cards/:id/deactivate', {}, (ctx) => club.deactivateCard(ctx.user, ctx.params.id, ctx.body));
  add('GET', '/api/cards/lookup', {}, (ctx) => club.lookupCard(ctx.query.code));
  add('GET', '/api/cards/:id', {}, (ctx) => club.cardView(ctx.params.id));

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
  add('POST', '/api/reservations/:id/finish', {}, (ctx) => club.finishReservation(ctx.user, ctx.params.id));
  add('POST', '/api/reservations/:id/cancel', {}, (ctx) => club.cancelReservation(ctx.user, ctx.params.id, ctx.body));
  add('POST', '/api/reservations/:id/items', {}, (ctx) => club.addItem(ctx.user, ctx.params.id, ctx.body));

  // Money
  add('POST', '/api/charges/:id/cancel', {}, (ctx) => club.cancelCharge(ctx.user, ctx.params.id, ctx.body));
  add('POST', '/api/charges/:id/refund', {}, (ctx) => club.refundCharge(ctx.user, ctx.params.id, ctx.body));
  add('POST', '/api/payments', {}, (ctx) => club.recordPayment(ctx.user, ctx.body));
  add('GET', '/api/finance/summary', ADMIN, (ctx) => club.financeSummary(ctx.query.from, ctx.query.to ?? ctx.query.from));
  add('GET', '/api/finance/journal', {}, (ctx) => {
    if (ctx.user.role !== 'admin') {
      const today = club.bizToday();
      return { ...club.journal(today, today), restricted: true };
    }
    return club.journal(ctx.query.from, ctx.query.to ?? ctx.query.from);
  });
  add('GET', '/api/finance/open', {}, () => club.openCharges());
  add('GET', '/api/export/:kind', ADMIN, (ctx) => (ctx.query.format === 'json'
    ? club.exportJson(ctx.params.kind, ctx.query)
    : { __file: club.exportCsv(ctx.params.kind, ctx.query) }));

  // Expenses, treasury, general ledger, monthly closing
  add('GET', '/api/ledger/categories', {}, () => club.listCategories());
  add('POST', '/api/ledger/categories', ADMIN, (ctx) => club.createCategory(ctx.user, ctx.body));
  add('PUT', '/api/ledger/categories/:id', ADMIN, (ctx) => club.updateCategory(ctx.user, ctx.params.id, ctx.body));
  add('GET', '/api/ledger/entries', {}, (ctx) => club.listEntries(ctx.query, ctx.user));
  add('POST', '/api/ledger/entries', {}, (ctx) => club.createEntry(ctx.user, ctx.body));
  add('POST', '/api/ledger/entries/:id/cancel', ADMIN, (ctx) => club.cancelEntry(ctx.user, ctx.params.id, ctx.body));
  add('GET', '/api/ledger/book', ADMIN, (ctx) => club.ledgerBook(ctx.query));
  add('GET', '/api/treasury', ADMIN, (ctx) => club.treasury(ctx.query.from, ctx.query.to ?? ctx.query.from));
  add('GET', '/api/closings', ADMIN, () => club.closings());
  add('POST', '/api/closings', ADMIN, (ctx) => club.closeMonth(ctx.user, ctx.body));
  add('POST', '/api/closings/:month/reopen', ADMIN, (ctx) => club.reopenMonth(ctx.user, ctx.params.month, ctx.body));

  // Products & stock
  add('GET', '/api/products', {}, (ctx) => club.listProducts({ includeInactive: ctx.query.all === '1' }));
  add('POST', '/api/products', ADMIN, (ctx) => club.createProduct(ctx.user, ctx.body));
  add('PUT', '/api/products/:id', ADMIN, (ctx) => club.updateProduct(ctx.user, ctx.params.id, ctx.body));
  add('POST', '/api/products/:id/stock', {}, (ctx) => club.stockOperation(ctx.user, ctx.params.id, ctx.body));
  add('GET', '/api/stock-movements', {}, (ctx) => club.stockMovements(ctx.query));

  // Lounge: conservation checks of the humidors.
  add('GET', '/api/lounge', {}, () => club.loungeOverview());
  add('POST', '/api/humidors', ADMIN, (ctx) => club.createHumidor(ctx.user, ctx.body));
  add('GET', '/api/humidors/:id', {}, (ctx) => club.humidorDetail(ctx.params.id));
  add('PUT', '/api/humidors/:id', ADMIN, (ctx) => club.updateHumidor(ctx.user, ctx.params.id, ctx.body));
  add('POST', '/api/humidors/:id/readings', {}, (ctx) => club.recordHumidorReading(ctx.user, ctx.params.id, ctx.body));
  add('POST', '/api/humidor-readings/:id/void', ADMIN, (ctx) => club.voidHumidorReading(ctx.user, ctx.params.id, ctx.body));

  function match(method, pathname) {
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
  }

  // Cross-site writes are refused: browsers cannot send application/json cross-origin without a
  // CORS preflight (which this API never grants), and a present Origin must be this site.
  function checkCsrf(request, url) {
    const type = String(request.headers.get('content-type') ?? '');
    if (!type.startsWith('application/json')) throw new AppError(415, 'TYPE_CONTENU', 'Requête refusée : JSON attendu.');
    const origin = request.headers.get('origin');
    if (origin && origin !== url.origin && !allowedOrigins.includes(origin)) throw forbidden('Requête refusée : origine inconnue.');
  }

  async function handle(request) {
    const url = new URL(request.url);
    const cookies = [];
    const secure = url.protocol === 'https:';
    const cookieHeader = (value, maxAge) => [
      `sid=${encodeURIComponent(value)}`, 'Path=/', 'HttpOnly', 'SameSite=Lax', `Max-Age=${maxAge}`, secure ? 'Secure' : null,
    ].filter(Boolean).join('; ');
    try {
      const found = match(request.method, url.pathname);
      if (!found) throw new AppError(404, 'INTROUVABLE', 'Ressource inconnue.');
      const { route, params } = found;
      const writes = request.method !== 'GET';
      if (writes) checkCsrf(request, url);
      const body = writes ? await readJson(request) : {};
      const token = parseCookies(request.headers.get('cookie')).sid || null;
      const ctx = {
        params, body, token, tokenHash: token ? await sha256Hex(token) : null, user: null,
        ip: request.headers.get('cf-connecting-ip') ?? 'local',
        query: Object.fromEntries(url.searchParams),
        setCookie: (value, maxAge) => cookies.push(cookieHeader(value, maxAge)),
      };
      if (!route.opts.public) {
        ctx.user = club.sessionUser(ctx.tokenHash);
        if (!ctx.user) throw new AppError(401, 'NON_CONNECTE', 'Session expirée : veuillez vous reconnecter.');
        if (route.opts.roles && !route.opts.roles.includes(ctx.user.role)) throw forbidden();
      }

      if (!writes || route.opts.readonly) {
        if (route.opts.prepare) await route.opts.prepare(ctx);
        return respond(route.handler(ctx), cookies, false);
      }

      const key = request.headers.get('idempotency-key') ?? undefined;
      if (key !== undefined && !/^[A-Za-z0-9_-]{8,100}$/.test(key)) throw invalid("Clé d'idempotence invalide.");
      const hash = key && ctx.user ? await sha256Hex(JSON.stringify([request.method, url.pathname, body])) : null;
      const replay = () => {
        const prev = club.get('SELECT * FROM idempotency_keys WHERE key = ? AND user_id = ?', key, ctx.user.id);
        if (!prev) return undefined;
        if (prev.request_hash !== hash) {
          throw new AppError(422, 'CLE_REUTILISEE', "Cette opération a déjà été enregistrée avec d'autres données. Rechargez la page.");
        }
        return JSON.parse(prev.response);
      };
      // A retry that already succeeded is answered at once, without redoing the preparation.
      if (hash) {
        const previous = replay();
        if (previous !== undefined) return respond(previous, cookies, true);
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
          'INSERT INTO idempotency_keys (key, user_id, request_hash, status, response, created_at) VALUES (?, ?, ?, 200, ?, ?)',
          key, ctx.user.id, hash, JSON.stringify(result ?? null), new Date().toISOString(),
        );
        return result;
      });
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
          'Content-Disposition': `attachment; filename="${filename.replace(/[^\w.-]/g, '_')}"`,
        },
      });
    }
    return json(200, payload, { cookies, replayed });
  }

  // Local development only: a fresh database gets the demonstration with its known accounts.
  async function init() {
    if (env.DEMO_ACCOUNTS !== '1' || club.hasUsers()) return;
    const accounts = [];
    for (const a of DEMO_ACCOUNTS) accounts.push({ ...a, password_hash: await hashPassword(a.password) });
    if (!club.hasUsers()) seedDemo(club, { accounts });
  }

  return { club, handle, init };
}
