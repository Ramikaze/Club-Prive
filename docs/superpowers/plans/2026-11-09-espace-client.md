# Espace client — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Members and regular clients sign in to their own space (balance, history, tickets, session countdown, reservation requests, Boutique orders picked up and paid at the club); the staff create their access, receive push notifications, and turn orders into Boutique sales and requests into reservations.

**Architecture:** A second, fully separate authentication for clients: tables `client_accounts` / `client_sessions`, cookie `csid` scoped to `Path=/api/client`, and a route table of its own under `/api/client/*` that never reads `sid` (the staff routes never read `csid`). Client answers are whitelisted views built in `worker/clientView.js`, never staff DTOs. Orders and reservation requests are new tables; the staff turn them into the existing Boutique sale (`createShopSale` + `order_id`) and reservation (`createReservation` + `request_id`). Staff devices get Web Push (VAPID, RFC 8291 aes128gcm with WebCrypto in `worker/push.js`), sent after the write commits. The client interface is a separate React tree drawn when the path starts with `/client`.

**Tech Stack:** Cloudflare Worker + Durable Object on SQLite (`worker/`), React 18 + Vite (`src/`), tests with `node --test` on `node:sqlite` through `test/harness.js`. No new npm dependency.

**Spec:** `docs/superpowers/specs/2026-11-09-espace-client-design.md` (validated by the owner 2026-11-09, « (mon choix) » points included). Read it first; this plan does not repeat its rules.

## Global Constraints

- Migration is **V24**, appended after V23 in `MIGRATIONS` (`worker/schema.js:893`); check `origin/main` has no V24 before starting.
- Amounts are integers in hundredths (`UM = 100` in tests); never floats.
- All user-facing text in French, with French typography (« », `’`), as the code already does.
- Passwords and temporary codes: `hashPassword` / `verifyPassword` / `checkPasswordStrength` from `worker/auth.js` (PBKDF2-SHA256, 100 000 iterations, 10 characters minimum). Never stored, logged or returned in clear, except the temporary code, once, in the answer to the staff member who created it.
- Temporary code: 8 characters from `ABCDEFGHJKMNPQRSTUVWXYZ23456789`, valid **7 days**, single use (it only opens the « choose your password » screen).
- Client login = `waDigits(phone)` (`shared/whatsapp.js:13`), unique among accesses; the client may type his number in any form, the server normalizes it the same way.
- Client session: 30 days, cookie `csid`, `HttpOnly; SameSite=Lax; Path=/api/client; Secure` (Secure on https only, as `sid`).
- Sign-in lockout: the existing `checkThrottle` / `recordFailure` of `worker/api.js` (5 failures → 1 minute per address + login), the dummy hash for unknown logins, one message for both: « Identifiant ou mot de passe incorrect. »
- Every client route takes the member from the session alone; any other id (payment, order, request, product) is checked against that member; a foreign or unknown id answers `404 INTROUVABLE`.
- `/api/client/*` and `/api/push/*` always go to the real club (`ALWAYS_REAL`, `worker/space.js:15`).
- Limits: 3 open orders (`en_attente` or `prete`) and 3 pending requests per client; 1 to 20 per order line; at most 30 lines per order.
- Request slots: every `settings.booking.slot_min` minutes, from now + 60 min to now + 30 days, inside the booking window and rules `planReservation` already enforces.
- Push recipients: order → every active `gerant` + every active `associe` whose `rayon` is in the order; reservation request → every active `gerant` + every active `associe`; never `admin`, never an inactive account. A failed push never fails the write.
- Push secrets: `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT` are Worker secrets (`wrangler secret put`), never in the repo. Without them push is off (`GET /api/push/key` answers `{ key: null }`), everything else works.
- Client accesses do not exist in the demo space: staff access routes carry `ACCOUNTS` (refused there).
- Commit messages in French, ending with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`. Commit only with the user's go-ahead (ask once at the start of execution whether each task may be committed on the local branch).

## Review Focus

1. **A staff cookie on a client route, a client cookie on a staff route.** A browser that holds both cookies (the owner testing on his own phone) must get each space with its own identity only. Test in Task 3 (`séparation`).
2. **A client typing his number differently** (« 06 123 45 67 », « +242061234567 », « 00242061234567 ») must reach the same account; a number that `waDigits` rejects must answer the normal 401, not a 500. Test in Task 3.
3. **The last bottle ordered twice:** two clients ordering the last unit; the second is refused with `STOCK_INSUFFISANT` and the message says how many are left. Test in Task 5.
4. **A pending request for a slot booked meanwhile:** confirming it returns the usual overlap error and the request stays `en_attente`. Test in Task 6.
5. **A member deactivated while signed in:** his next client request answers 401 and his sessions are gone. Test in Task 2.

---

### Task 1: Migration V24

**Files:**
- Modify: `worker/schema.js` (add `V24`, append to `MIGRATIONS`)
- Modify: `worker/club.js:53` (`WIPE_ORDER`)
- Test: `test/client-v24.test.js`

**Interfaces:**
- Produces: the tables below, used by every later task.

```sql
client_accounts (id INTEGER PRIMARY KEY, member_id INTEGER NOT NULL UNIQUE REFERENCES members(id),
  login TEXT NOT NULL UNIQUE, password_hash TEXT, temp_hash TEXT, temp_expires_at TEXT,
  active INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0, 1)), created_at TEXT NOT NULL,
  created_by INTEGER REFERENCES users(id), last_login_at TEXT)
client_sessions (token_hash TEXT PRIMARY KEY, account_id INTEGER NOT NULL REFERENCES client_accounts(id),
  must_set_password INTEGER NOT NULL DEFAULT 0 CHECK (must_set_password IN (0, 1)), created_at TEXT NOT NULL, expires_at TEXT NOT NULL)
client_idempotency (key TEXT NOT NULL, account_id INTEGER NOT NULL REFERENCES client_accounts(id), request_hash TEXT NOT NULL,
  response TEXT NOT NULL, created_at TEXT NOT NULL, PRIMARY KEY (key, account_id))
client_orders (id INTEGER PRIMARY KEY, member_id INTEGER NOT NULL REFERENCES members(id),
  status TEXT NOT NULL CHECK (status IN ('en_attente', 'prete', 'retiree', 'annulee')), created_at TEXT NOT NULL,
  ready_at TEXT, ready_by INTEGER REFERENCES users(id), closed_at TEXT, closed_by INTEGER REFERENCES users(id),
  cancel_reason TEXT, cancelled_by_client INTEGER NOT NULL DEFAULT 0 CHECK (cancelled_by_client IN (0, 1)))
client_order_lines (id INTEGER PRIMARY KEY, order_id INTEGER NOT NULL REFERENCES client_orders(id),
  product_id INTEGER NOT NULL REFERENCES products(id), account TEXT NOT NULL CHECK (account IN ('cigares', 'alcool')),
  quantity INTEGER NOT NULL CHECK (quantity BETWEEN 1 AND 20), unit_price INTEGER NOT NULL CHECK (unit_price >= 0),
  UNIQUE (order_id, product_id))
client_order_sales (order_id INTEGER NOT NULL REFERENCES client_orders(id), account TEXT NOT NULL CHECK (account IN ('cigares', 'alcool')),
  sale_id INTEGER NOT NULL UNIQUE REFERENCES shop_sales(id), PRIMARY KEY (order_id, account))
reservation_requests (id INTEGER PRIMARY KEY, member_id INTEGER NOT NULL REFERENCES members(id),
  room_id INTEGER NOT NULL REFERENCES rooms(id), date TEXT NOT NULL, start_time TEXT NOT NULL,
  duration_min INTEGER NOT NULL CHECK (duration_min > 0), party_size INTEGER NOT NULL CHECK (party_size >= 1),
  status TEXT NOT NULL CHECK (status IN ('en_attente', 'confirmee', 'refusee', 'annulee')), created_at TEXT NOT NULL,
  decided_at TEXT, decided_by INTEGER REFERENCES users(id), message TEXT,
  reservation_id INTEGER UNIQUE REFERENCES reservations(id))
client_ticket_copies (id INTEGER PRIMARY KEY, payment_id INTEGER NOT NULL REFERENCES payments(id),
  member_id INTEGER NOT NULL REFERENCES members(id), kind TEXT NOT NULL CHECK (kind IN ('impression', 'telechargement')), at TEXT NOT NULL)
push_subscriptions (id INTEGER PRIMARY KEY, user_id INTEGER NOT NULL REFERENCES users(id), endpoint TEXT NOT NULL UNIQUE,
  p256dh TEXT NOT NULL, auth TEXT NOT NULL, created_at TEXT NOT NULL)
```
Plus indexes: `client_orders(member_id)`, `client_orders(status)`, `client_order_lines(order_id)`, `reservation_requests(status)`, `reservation_requests(member_id)`, `client_sessions(account_id)`.

- [ ] **Step 1: Write the failing test** `test/client-v24.test.js`
  - `migration V24 : schema_version = 24 et les tables existent` — a fresh `Server`, `meta.schema_version === '24'`, each table above answers `SELECT 1 FROM <t> LIMIT 1` without error.
  - `effacer toutes les données vide les tables des clients` — insert one row in each client table (direct SQL through `server.db`), `POST /api/admin/reset {confirm:'EFFACER'}` as admin → every client table is empty, `push_subscriptions` still holds its row.
- [ ] **Step 2: Run** `node --test test/client-v24.test.js` — expected FAIL (no such table).
- [ ] **Step 3: Implement** `V24` (comment above it: what it adds and why, as V22/V23 do) and add to `WIPE_ORDER`, children first: `client_ticket_copies`, `client_order_sales`, `client_order_lines`, `client_orders`, `reservation_requests`, `client_idempotency`, `client_sessions`, `client_accounts` — placed before `payments`, `shop_sales`, `reservations`, `members`. `push_subscriptions` is not wiped (staff devices, like `users`).
- [ ] **Step 4: Run** `npm test` — expected all PASS (existing tests included).
- [ ] **Step 5: Commit** `git add worker/schema.js worker/club.js test/client-v24.test.js && git commit -m "Espace client : migration V24"`

### Task 2: Client access from the staff side

**Files:**
- Create: `worker/clientAccess.js` (mixin `clientAccessMethods`, `Object.assign(Club.prototype, …)` at the end of `worker/club.js` like the others)
- Modify: `worker/auth.js` (add `newClientCode()`), `worker/api.js` (routes), `worker/club.js` (`deactivateMember` closes client sessions)
- Test: `test/client-access.test.js`

**Interfaces:**
- Produces:
  - `newClientCode(): string` — 8 chars from the alphabet in Global Constraints, `crypto.getRandomValues`.
  - `club.clientAccessStatus(memberId): { state: 'aucun'|'en_attente'|'actif'|'coupe', login: string|null, created_at, last_login_at, temp_expires_at }` (`en_attente` = has `temp_hash` and no `password_hash` yet).
  - `club.createClientAccess(actor, memberId, { tempHash, expiresAt }): { login, status }` — refuses: walk-in / unknown (`fileRow`), inactive file (`assertMemberActive`), no usable phone (`invalid('Le téléphone de la fiche ne permet pas de créer un identifiant.', 'TELEPHONE')`), access already exists (`conflict('ACCES_EXISTE', …)`), login taken (`conflict('IDENTIFIANT_PRIS', 'Ce numéro sert déjà d’identifiant à un autre client.')`).
  - `club.renewClientCode(actor, memberId, { tempHash, expiresAt }): { login, status }` — login re-read from the file's current phone; clears `password_hash`; deletes the account's `client_sessions`.
  - `club.setClientAccessActive(actor, memberId, active: boolean): status` — `active = 0` deletes the sessions.
  - Routes (all `{ ...ACCOUNTS }`, open to every staff role): `GET /api/members/:id/client-access`, `POST /api/members/:id/client-access` → `{ login, code, expires_at, status }`, `POST /api/members/:id/client-access/code` → same shape, `POST /api/members/:id/client-access/disable`, `POST /api/members/:id/client-access/enable` → status. The two code routes have a `prepare` that sets `ctx.tempCode = newClientCode()`, `ctx.tempHash = await hashPassword(ctx.tempCode)`; the handler returns `code: ctx.tempCode`.
  - Audit actions: `client.acces.creer`, `client.acces.code`, `client.acces.couper`, `client.acces.retablir` (details: `member_no`, `login`; never the code).

- [ ] **Step 1: Write the failing tests** `test/client-access.test.js` (admin and gérant users; one member with phone `06 123 45 67`, one regular client, one member with the unusable phone `12`):
  - `créer l’accès : identifiant = téléphone normalisé, code de 8 caractères` — `login === '242061234567'`, `/^[A-HJ-NP-Z2-9]{8}$/.test(code)`, status `en_attente`; `client_accounts.temp_hash` starts with `pbkdf2-sha256$` and does not contain the code.
  - `le gérant peut créer un accès` — 200 as gérant.
  - `refus : deuxième accès, téléphone inutilisable, numéro déjà pris, fiche désactivée` — 409 `ACCES_EXISTE`, 400 `TELEPHONE`, 409 `IDENTIFIANT_PRIS` (second file with the same phone), 409 `MEMBRE_DESACTIVE`.
  - `le journal ne contient jamais le code` — `SELECT details FROM audit_log WHERE action LIKE 'client.acces%'` contains no returned code.
  - `nouveau code : l’ancien mot de passe et les sessions disparaissent` — insert a `client_sessions` row and a `password_hash`, renew → no session left, `password_hash` null, new code differs.
  - `désactiver la fiche ferme les sessions du client` (Review Focus 5) — session row present, `POST /api/members/:id/deactivate` → `client_sessions` empty for that account.
  - `espace démo : créer un accès est refusé` — on a demo `Site`, 403 `MODE_DEMO`.
- [ ] **Step 2: Run** `node --test test/client-access.test.js` — expected FAIL.
- [ ] **Step 3: Implement** the interfaces above.
- [ ] **Step 4: Run** `npm test` — expected PASS.
- [ ] **Step 5: Commit** `Espace client : accès créé par le personnel`

### Task 3: Client sign-in, sessions and the separate route table

**Files:**
- Create: `worker/clientApi.js` — `createClientRoutes({ club, env, helpers })` returning `{ handleClient(request, url) }`
- Modify: `worker/api.js` (`handle` hands `/api/client/` paths to `handleClient` before `match`), `worker/space.js:15` (`ALWAYS_REAL` gains `client|push`)
- Test: `test/client-auth.test.js`; harness: no change needed (`Client` keeps the last `Set-Cookie`; for the two-cookie test build the header by hand)

**Interfaces:**
- Consumes: `checkThrottle`, `recordFailure`, the dummy hash, `readJson`, `checkCsrf`, `json`, `errorResponse` of `worker/api.js` (pass them as `helpers` instead of duplicating).
- Produces:
  - `club.clientAccountByLogin(raw): row|null` (normalizes with `waDigits`; null when unusable).
  - `club.openClientSession(accountId, tokenHash, { mustSetPassword }): { maxAge }`, `club.clientSessionAccount(tokenHash): { account, member }|null` (null when expired, account inactive, or member inactive), `club.closeClientSession(tokenHash)`, `club.setClientPassword(accountId, passwordHash, keepTokenHash)` (clears `temp_hash`, deletes the other sessions, sets `must_set_password = 0` on the kept one).
  - Routes:
    - `POST /api/client/login {login, password}` — the password is checked against `password_hash`, then against `temp_hash` if not expired; a temp match opens a session with `must_set_password = 1`. Answer `{ must_set_password, member: { first_name, last_name, member_no, kind } }`. Sets `last_login_at`.
    - `POST /api/client/password {current_password?, new_password}` — with `must_set_password = 1` no current password is asked; otherwise it must match.
    - `POST /api/client/logout`, `GET /api/client/me` (same shape as login).
    - Any other client route with a `must_set_password` session → `403 MOT_DE_PASSE_A_CHOISIR`.
  - Client writes carry `Idempotency-Key` stored in `client_idempotency` (same replay rules as the staff one).
  - Audit: sign-in is NOT logged (too frequent); a password change is (`client.mot_de_passe`, `user_id` null, `details.client = member_id`).

- [ ] **Step 1: Write the failing tests** `test/client-auth.test.js`:
  - `première connexion avec le code : choisir son mot de passe d’abord` — login with the code → `must_set_password: true`; `GET /api/client/account` → 403 `MOT_DE_PASSE_A_CHOISIR`; `POST /api/client/password {new_password:'court'}` → 400; with 10+ chars → 200; login again with the code → 401; with the new password → 200, `must_set_password: false`.
  - `le code expire après 7 jours` — set `temp_expires_at` in the past → 401.
  - `le numéro s’écrit comme on veut` (Review Focus 2) — `'06 123 45 67'`, `'+242061234567'`, `'00242061234567'` all sign in; `'12'` → 401 `IDENTIFIANTS`.
  - `cinq échecs bloquent une minute` — 5 × 401 then 429 `TROP_DE_TENTATIVES`, same address and login.
  - `même réponse pour un inconnu et un mauvais mot de passe` — status and body equal.
  - `séparation` (Review Focus 1) — a client session on `GET /api/me`, `/api/members`, `/api/dashboard`, `/api/products`, `POST /api/shop/sales` → 401 each; a staff session on `GET /api/client/me`, `/api/client/account` → 401; a cookie header carrying both `sid` and `csid` gets the staff identity on `/api/me` and the client identity on `/api/client/me`.
  - `le cookie client est limité à /api/client` — the `Set-Cookie` of the login contains `csid=`, `HttpOnly`, `SameSite=Lax`, `Path=/api/client`.
  - `accès coupé ou fiche désactivée : la session ne marche plus` — disable access → `GET /api/client/me` 401.
  - `changer son mot de passe ferme les autres sessions` — two client sessions, change on one → the other gets 401.
- [ ] **Step 2: Run** — expected FAIL.
- [ ] **Step 3: Implement.** The cookie helper mirrors `cookieHeader` in `handle` with name `csid` and `Path=/api/client`. `handleClient` never reads `parseCookies(...).sid`.
- [ ] **Step 4: Run** `npm test` — PASS.
- [ ] **Step 5: Commit** `Espace client : connexion et sessions séparées`

### Task 4: Account, history and tickets (read views)

**Files:**
- Create: `worker/clientView.js` (mixin `clientViewMethods`)
- Modify: `worker/clientApi.js` (routes), `src/components/ui/TicketSheet.jsx` (optional prop `copyText`, default `copyLabel(copyNo)`)
- Test: `test/client-view.test.js`

**Interfaces:**
- Produces:
  - `GET /api/client/account` → `club.clientAccountView(memberId)`:
    `{ member: { first_name, last_name, member_no, kind }, server_now: iso,
       wallet: { balance } | null (membre only),
       subscription: { plan_name, end_date, available_min } | null,
       credit: { owed, limit, available } | null (client only; null when limit 0 and owed 0),
       in_session: { room_name, start_at, end_at } | null (reservation `en_cours` of the member),
       reservations: [{ id, date, start_time, end_time, duration_min, party_size, status }] (status `reservee`, start in the future),
       requests: [{ id, date, start_time, duration_min, party_size, status, message, deposit_amount }] (pending, plus refused of the last 30 days) }`
  - `GET /api/client/history?from&to` (business days, default: this month) → `club.clientHistory(memberId, from, to)`: `{ period: { from, to }, items: [{ at, kind: 'achat'|'seance'|'recharge'|'reglement'|'remboursement'|'abonnement', label, amount, payment_id|null, ticket_number|null, status }] }`, most recent first. Built from `memberStatement` + `purchaseHistory`, field by field: no `by_name`, `created_by_name`, `notes`, `reason`, `cancel_reason`, `reference` key anywhere.
  - `GET /api/client/tickets/:id` → `{ ticket }` = `ticketFor(<non-boss actor>, id).ticket` when `ticket.member_id === memberId` and the buyer is not `journalier`, minus `next_copy_no`, `cancel_reason`, `shop_cancel_reason`; else 404.
  - `POST /api/client/tickets/:id/copies {kind: 'impression'|'telechargement'}` → inserts `client_ticket_copies`; never touches `ticket_events`.
- [ ] **Step 1: Write the failing tests** `test/client-view.test.js` (two members A and B with accesses; A has a card recharge, a Boutique sale, a running session; B a sale):
  - `compte d’un membre : crédit carte, abonnement, séance en cours` — values match `memberDetail` of A.
  - `compte d’un client régulier : ce qu’il doit, plafond, disponible` — after a credit sale; `wallet === null`, `in_session === null`.
  - `aucune donnée interne dans les réponses` — `JSON.stringify` of account and history contains none of `notes`, `by_name`, `created_by_name`, `cancel_reason`, `reason` keys, nor the staff user's name, nor A's file `notes` text.
  - `historique : achats, recharge, séance, du plus récent au plus ancien`.
  - `ticket : A ouvre le sien, pas celui de B (404), pas un numéro inconnu (404)`.
  - `copie client : notée à part, ne change pas les duplicatas` — after `POST …/copies`, `ticket_events` count unchanged and `GET /api/payments/:id/ticket` (staff) `next_copy_no` unchanged.
- [ ] **Step 2: Run** — FAIL. **Step 3: Implement.** **Step 4: Run** `npm test` — PASS.
- [ ] **Step 5: Commit** `Espace client : compte, historique et tickets`

### Task 5: Boutique orders

**Files:**
- Create: `worker/clientOrders.js` (mixin `clientOrderMethods`)
- Modify: `worker/clientApi.js`, `worker/api.js` (staff routes), `worker/shop.js` (`createShopSale` accepts `order_id`)
- Test: `test/client-orders.test.js`

**Interfaces:**
- Produces:
  - `club.heldQuantities(excludeOrderId = null): Map<productId, qty>` — sum of lines of orders `en_attente`/`prete`.
  - `club.orderableQuantity(productId)` = `max(0, stock_qty − held)`.
  - Client: `GET /api/client/products` → `[{ id, name, description, price, account, category, photo_version, available: boolean, max_order: number }]` (active `cigare` and `bouteille` only; `max_order = min(20, orderableQuantity)`; no `stock_qty`). `GET /api/client/products/:id/photo` → the image for a product in that list, else 404 (reuse `productPhoto` and `respond`'s `__image`). `GET /api/client/orders` → `[{ id, status, created_at, cancel_reason, lines: [{ name, quantity, unit_price, account, taken: boolean|null }] }]`. `POST /api/client/orders { lines: [{ product_id, quantity }] }` → order (refusals: `invalid` lines, `conflict('STOCK_INSUFFISANT', 'Il ne reste que N « name » disponible(s).')`, `conflict('TROP_DE_COMMANDES', 'Vous avez déjà 3 commandes en cours.')`, inactive file). `POST /api/client/orders/:id/cancel` → only while `en_attente`.
  - Staff (open to every role, `{}`): `GET /api/orders` → `{ orders: [...open, oldest first, with member {id, name, member_no, kind, phone}, lines with product stock], requests: [...] (Task 6 fills it), counts: { orders, requests } }` — every staff member sees every order and request; `counts.orders` is computed for the caller: all open orders for the gérant and the admin, only those with a line in his `rayon` for an associé (spec B.2); `POST /api/orders/:id/ready`; `POST /api/orders/:id/cancel {reason}` (reason required, 3–300 chars, shown to the client); `POST /api/orders/:id/close` (status `retiree` when at least one sale exists; lines of rayons without a sale count as not taken).
  - `createShopSale(actor, input)` with `input.order_id`: order open, `order.member_id === buyer.member_id`, the order has lines in `input.account`, no sale yet for that rayon; inserts `client_order_sales`; when every rayon of the order has a sale → `retiree`, `closed_at/by`. All in the sale's transaction.
  - Audit: `client.commande` / `client.commande.annuler` (user_id null, `details.client`), `commande.prete`, `commande.annuler`, `commande.cloturer`.
- [ ] **Step 1: Write the failing tests** `test/client-orders.test.js`:
  - `commander met de côté sans toucher au stock` — stock 5, order 2 → `products.stock_qty` still 5, `stock_movements` unchanged, `max_order` for another client = 3.
  - `la dernière bouteille commandée deux fois` (Review Focus 3) — stock 1, A orders 1, B orders 1 → 409 `STOCK_INSUFFISANT`.
  - `produit sans stock : indisponible` — `available: false`, order → 409.
  - `trois commandes ouvertes au plus` — 4th → 409 `TROP_DE_COMMANDES`.
  - `le client annule tant que « En attente », pas après « Prête »`.
  - `encaisser une commande à deux rayons : deux ventes puis « Retirée »` — sale cigares with `order_id` → order still open; sale alcool → `retiree`; stock decreased only now.
  - `retrait partiel : clôturer après une seule vente libère le reste` — close → `retiree`, the other rayon's lines `taken: false`, `heldQuantities` no longer counts them.
  - `vente d’une commande pour un autre acheteur : refusée`.
  - `B ne voit ni n’annule la commande de A` — 404.
  - `réponse produits sans stock exact` — no `stock_qty` key.
- [ ] **Step 2: Run** — FAIL. **Step 3: Implement.** **Step 4: Run** `npm test` — PASS.
- [ ] **Step 5: Commit** `Espace client : commandes Boutique à retirer au club`

### Task 6: Reservation requests

**Files:**
- Create: `worker/clientRequests.js` (mixin `clientRequestMethods`)
- Modify: `worker/clientApi.js`, `worker/api.js`, `worker/club.js` (`createReservation` accepts `request_id`)
- Test: `test/client-requests.test.js`

**Interfaces:**
- Produces:
  - Eligibility: kind `membre`, file active, at least one active card (`!hasDeactivatedCardsOnly` and a card exists), else `403 RESERVATION_NON_OUVERTE` with a French sentence.
  - `GET /api/client/slots?date&duration_min&party_size` → `{ slots: ['HH:MM', …] }` — each start of the single active room's booking window, every `slot_min`, kept when `planReservation({ member_id, room_id, date, start_time, duration_min, party_size, pay_with_card: true })` raises nothing and has no `conflicts` / `gap_conflicts`, and start ≥ now + 60 min, ≤ now + 30 days. Never returns who occupies a slot.
  - `POST /api/client/reservation-requests/quote {date, start_time, duration_min, party_size}` → `{ included_minutes, paid_minutes, supplement_amount, card_amount, deposit_amount }` (from `quoteReservation`, whitelisted).
  - `POST /api/client/reservation-requests {…same}` → request `en_attente` (re-checks the slot; `conflict('TROP_DE_DEMANDES', …)` past 3 pending). `POST /api/client/reservation-requests/:id/cancel` while `en_attente`.
  - Staff: `POST /api/reservation-requests/:id/refuse {message}` (3–300 chars, shown to the client). Confirm = `POST /api/reservations` with `request_id`: request pending and same member; on success `status = 'confirmee'`, `reservation_id`, `decided_at/by`, in the reservation's transaction. Any refusal of `createReservation` (overlap, `ACOMPTE_REQUIS`, …) leaves the request untouched.
  - `GET /api/orders` `requests`: pending requests with member, date, times, party size, estimate.
  - Client view (`clientAccountView.requests[].deposit_amount`) shows the deposit still due for a pending ≥ 3 h request (spec B.4).
- [ ] **Step 1: Write the failing tests** `test/client-requests.test.js` (`lenientTariffs` server):
  - `créneaux : le battement et les réservations existantes sont exclus` — a booking 20:00–22:00 → `'21:00'` and `'22:00'` absent (gap 30), `'23:00'` present.
  - `créneau trop proche : moins d’une heure` — refused.
  - `un client régulier ne peut pas demander` — 403 `RESERVATION_NON_OUVERTE`.
  - `confirmer une demande crée la réservation et la lie` — staff `POST /api/reservations {…, request_id}` → request `confirmee`, `reservation_id` set; client account lists the reservation.
  - `créneau pris entre-temps : la demande reste en attente` (Review Focus 4).
  - `3 h sans acompte couvert : refus ACOMPTE_REQUIS, demande toujours en attente` — card balance 0, 3 h with paid time → 400 `ACOMPTE_REQUIS`; after a recharge covering it, confirm with `pay_with_card` → 200.
  - `refuser : le client voit le mot`.
  - `B ne voit pas la demande de A, ne l’annule pas` — 404.
- [ ] **Step 2: Run** — FAIL. **Step 3: Implement.** **Step 4: Run** `npm test` — PASS.
- [ ] **Step 5: Commit** `Espace client : demandes de réservation`

### Task 7: Web Push to staff devices

**Files:**
- Create: `worker/push.js`, `scripts/vapid-keys.mjs`
- Modify: `worker/api.js` (`createApi({ db, env, demo, sendPush })`, routes, after-commit hook), `wrangler.jsonc` (comment listing the three secrets)
- Test: `test/push.test.js`

**Interfaces:**
- Produces:
  - `encryptPayload(payload: Uint8Array, p256dhB64url: string, authB64url: string): Promise<Uint8Array>` — RFC 8291 `aes128gcm` body (salt 16, rs 4096, keyid = server ECDH public key 65 bytes), WebCrypto only.
  - `vapidAuthorization(endpoint: string, { publicKey, privateKey, subject }): Promise<string>` — `vapid t=<ES256 JWT>, k=<publicKey>`, JWT `aud` = endpoint origin, `exp` = now + 12 h.
  - `sendWebPush(subscription, payloadObject, vapid): Promise<{ status }>` — POST with `TTL: 3600`, `Content-Encoding: aes128gcm`, `Urgency: high`.
  - `club.pushRecipients({ accounts: string[] } | { request: true }): userIds[]` (Global Constraints rule).
  - API: handlers may push to `ctx.after` a function returning `[{ userIds, title, body, url }]`; after the transaction commits, `handle` resolves subscriptions and awaits all sends with a 4 s overall cap; 404/410 answers delete the subscription; errors are `console.error`ed, never thrown. `createApi` option `sendPush(subscription, payload)` (tests inject a recorder; default uses `sendWebPush` with the three env secrets; absent secrets → no send).
  - Routes: `GET /api/push/key` (staff, `{}`) → `{ key: env.VAPID_PUBLIC_KEY ?? null }`; `POST /api/push/subscriptions { endpoint, keys: { p256dh, auth } }` (https endpoint, ≤ 1000 chars; upsert by endpoint onto the current user); `DELETE /api/push/subscriptions { endpoint }` (own only).
  - Notification texts: order → title `Nouvelle commande Boutique`, body `<Rayon(s)> — <Prénom NOM> — <n> article(s)`, url `/#/commandes`; request → title `Demande de réservation`, body `<Prénom NOM> — <jour> <HH:MM>, <durée>`, url `/#/commandes`.
  - `scripts/vapid-keys.mjs` prints the three values to paste into `wrangler secret put` (P-256 key pair, base64url raw public key, base64url `d`).
- [ ] **Step 1: Write the failing tests** `test/push.test.js`:
  - `chiffrement : le navigateur relit le message` — generate a P-256 "browser" key pair + 16-byte auth in the test, `encryptPayload`, then decrypt in the test per RFC 8291 (ECDH with the keyid, HKDF, AES-128-GCM) → original JSON.
  - `VAPID : jeton ES256 vérifiable` — verify the JWT signature with the public key; `aud` = `https://fcm.googleapis.com`.
  - `commande cigares : le gérant et l’associé cigares, pas l’associé champagne ni l’admin` — recorder captures endpoints of gérant + associé cigares only.
  - `demande de réservation : le gérant et les deux associés`.
  - `compte désactivé : rien`.
  - `un envoi qui échoue ne bloque pas la commande` — recorder throws → order still 200 and stored.
  - `410 : l’abonnement est effacé`.
  - `abonnement : on n’efface que le sien`.
- [ ] **Step 2: Run** — FAIL. **Step 3: Implement.** **Step 4: Run** `npm test` — PASS.
- [ ] **Step 5: Commit** `Notifications push du personnel : commandes et demandes de réservation`

### Task 8: Staff interface

**Files:**
- Create: `src/pages/Orders.jsx` (page « Commandes »), `src/components/members/ClientAccessBlock.jsx`, `src/lib/push.js`, `public/sw.js`, `public/manifest.webmanifest`
- Modify: `src/App.jsx` (route `commandes`), `src/components/layout/AppShell.jsx:21` (entry « Commandes » under « Boutique », the closest existing icon, with the counter), `src/pages/Member.jsx` (block on members and regular clients), `src/pages/Shop.jsx` + `src/components/shop/SalePanel.jsx` (a cart may carry `order_id`, sent in the body; product card shows « N mis de côté » when held > 0), `src/dialogs/reservationDialogs.jsx` (`openBookingDialog` presets `duration_min`, `party_size`, `request_id`, the last sent in the body), `public/_headers` (`/sw.js` → `Cache-Control: no-cache`), `index.html` (`<link rel="manifest">`), `shared/whatsapp.js`
- Test: `test/whatsapp.test.js` gains the access message test; the rest is checked in the browser (Task 10).

**Interfaces:**
- Consumes: Tasks 2, 5, 6, 7 routes.
- Produces:
  - `clientAccessText({ first_name, url, login, code }): string` in `shared/whatsapp.js` — French message: greeting, the space address (`${origin}/client`), identifier, temporary code, « valable 7 jours », « vous choisirez votre mot de passe à la première connexion », signed « L’équipe Limen ».
  - `ClientAccessBlock({ member })`: state line; buttons « Créer l’accès client », « Nouveau code provisoire », « Couper l’accès » / « Rétablir l’accès »; after a code: a dialog showing it once with « Envoyer sur WhatsApp » (`sendWhatsAppText(member.phone, clientAccessText(…))`) — closing the dialog forgets the code.
  - `Orders` page: polls `GET /api/orders` every 30 s while visible; per order « Marquer prête », « Encaisser <rayon> » (fills `shopCarts[account]` with `{ key: newKey(), lines, buyer: { kind, person }, order_id }` and navigates to `/boutique`), « Clôturer » (after a sale), « Annuler » (reason dialog), « Prévenir sur WhatsApp » (« Votre commande est prête… »); per request « Confirmer » (`openBookingDialog({ member, lockMember: true, date, start_time, duration_min, party_size, room_id, request_id }, reload)`), « Refuser » (message dialog), WhatsApp after either; header toggle « Notifications sur cet appareil » (`enablePush()` / `disablePush()` in `src/lib/push.js`, hidden when `GET /api/push/key` gives null; on an iPhone outside the home-screen app, a one-line hint to add it first).
  - Menu counter: `counts.orders + counts.requests` from the same poll (`useStore` slice `orderCounts`).
  - `public/sw.js`: `push` → `showNotification(title, { body, data: { url }, icon: '/apple-touch-icon.png' })`; `notificationclick` → focus an open window of the site or `clients.openWindow(url)`. No `fetch` handler.
- [ ] **Step 1:** Add the `clientAccessText` test to `test/whatsapp.test.js` (contains the login and the code, `/client`, `7 jours`); run — FAIL; implement; run — PASS.
- [ ] **Step 2:** Build the page, block, menu entry, presets and service worker. `npm run build` — no error.
- [ ] **Step 3: Commit** `Espace client : page Commandes, accès client sur la fiche, notifications`

### Task 9: Client interface (`/client`)

**Files:**
- Create: `src/client/ClientApp.jsx`, `src/client/clientApi.js`, `src/client/pages/{ClientLogin,ClientHome,ClientHistory,ClientTicket,ClientShop,ClientBooking}.jsx`, `src/client/client.css`
- Modify: `src/App.jsx` (when `window.location.pathname.startsWith('/client')` render `<ClientApp />` and nothing of the staff app: no `boot()`, no `/api/me`)

**Interfaces:**
- Consumes: Tasks 3–6 routes; `TicketSheet` with `copyText="Copie client"`; `sheetPicture` and `rollPrint` for download / print.
- Produces:
  - `clientApi.get/post(url, body)` — same retry and idempotency rules as `src/lib/api.js` but never the demo header; a 401 sends to the client login; a 403 `MOT_DE_PASSE_A_CHOISIR` to the password screen.
  - Screens (maquette validated 2026-11-09, phone first, The Limen look of `src/club.css`): login (téléphone + mot de passe), « Choisissez votre mot de passe » (twice, 10 caractères minimum), Mon compte (cards: solde; « En séance » with a countdown ticking every second from `end_at` corrected by `server_now`; Mes réservations + Mes demandes with status pills and the refusal message / deposit line; « Demander une réservation » for members), Historique (month switcher, rows, « Voir le ticket »), Ticket (sheet + « Imprimer » + « Télécharger », each posts its copy), Boutique (Cigares / Champagne tabs, photo, price, +/− capped by `max_order`, « Indisponible », basket, « Commander · à retirer au club », Mes commandes with cancel while « En attente »), Réserver (day picker over 30 days, duration from the booking settings minimum, party size, free slots list, estimate, « Envoyer la demande »), bottom bar Compte / Boutique / Historique, « Se déconnecter » and « Changer mon mot de passe » in the header menu.
- [ ] **Step 1:** Build the screens. `npm run build` — no error.
- [ ] **Step 2: Commit** `Espace client : interface du client sur téléphone`

### Task 10: Documentation and verification in the browser

**Files:**
- Modify: `README.md` (client space, the three VAPID secrets and `scripts/vapid-keys.mjs`, where staff enable notifications); `.claude/launch.json` only if the dev server entry is missing.

- [ ] **Step 1:** `npm test` — all PASS (report the count).
- [ ] **Step 2:** Start the dev server with `preview_start` (`.claude/launch.json`), sign in as admin (local `DEMO_ACCOUNTS=1` accounts), create a member with a phone, create his access, read the code from the dialog.
- [ ] **Step 3:** In a second tab, open `/client`, sign in with the code, choose a password, check Mon compte (balance, reservations), the history and a ticket (print + download), order two products from two rayons, request a slot.
- [ ] **Step 4:** Back as staff: « Commandes » shows the order and the request with the counter; « Encaisser » both rayons → order « Retirée » on the client side; confirm the request → « Confirmée » on the client side. Phone width (`resize_window` mobile) for every client screen. No console error.
- [ ] **Step 5:** Push cannot be checked locally without VAPID secrets: say so in the report; the push code is covered by Task 7's tests.
- [ ] **Step 6: Commit** `Espace client : README et vérification`
