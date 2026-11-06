# Autres boissons Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a third product category « Autre boisson » (sold in room sessions only, money in the `alcool` account) and show the Caisse's revenue and billed lines in three columns: « Réservation séance », « Boisson » (Champagne | Autres boissons) and « Cigare ».

**Architecture:** Migration V19 rebuilds `products` so that `category` also accepts `boisson` (`bouteille` stays the champagne value; nothing is renamed in the database). The category labels live in `shared/roles.js`; `accountOfCategory('boisson')` already gives `alcool`, so rayons, sessions and the ledger need no new rule. Once a product has a billed line its category is locked, so the split of `alcool` by the product's current category never moves a past figure. `financeSummary` gains the split of `alcool`; a new read route gives the billed lines per column; the front adds one block under the cash balance.

**Tech Stack:** React 18 + react-router 6 (Vite), Cloudflare Worker + Durable Object SQLite, `node:test` with `test/harness.js`.

**Spec:** `docs/superpowers/specs/2026-11-06-autres-boissons-design.md` (approved by the owner 2026-11-06; mockup validated in the conversation). Read it before any task; where this plan and the spec disagree, the spec wins.

**Branch:** `feat/autres-boissons` (from `main` 6c4c530). Do not switch branches.

## Global Constraints

- Every screen in French, in the app's current tone and layout, light and dark themes, usable on phone and tablet.
- The repository is public: no real brand name, product photo or phone number in code, tests or demo.
- Database changes go through a new migration version (V19); existing data must not move (products, stock, photos, charges, payments, tickets, past cash figures).
- `npm test` green and `npm run build` succeeding after every task.
- Comments in English matching surrounding density; user-facing text in French.
- Commits: one per task on feat/autres-boissons, message in French in the repository's style (e.g. « Autres boissons : … »), ending with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`. Never push, merge or deploy without the owner's explicit yes.
- The Boutique never shows or sells « Autre boisson » products.
- Database values: `cigare`, `bouteille` (= Champagne on screen), `boisson` (= Autre boisson). Screen labels come from one place: `CATEGORY_LABEL` / `CATEGORY_PLURAL` in `shared/roles.js`.
- Amounts are integers in hundredths (`UM = 100` in tests).
- Rayon rule unchanged: `ownsAccount(user, accountOfCategory(category))`; `boisson` belongs to the `alcool` rayon (the champagne associé). The gérant keeps today's product rights.
- Unchanged on purpose (spec): the Boutique (`SHOP`, `worker/shop.js`, `src/pages/Shop.jsx`), the Caisse « Détails » and « Recettes du jour » blocks, the gérant's Caisse (`ManagerCash`), accounts, treasury, ledger and closings. The catalogue import door (`importCatalogItem`) also stays as it is: the import script sends cigars only.

## Review Focus

1. The edit dialog always resends the category: changing the price, name or « actif » of a sold product, category unchanged, must succeed (Task 2 test `modifier un produit vendu reste possible sans changer sa catégorie`).
2. A product whose only line was cancelled still counts as sold — the cancelled amount is in the past figures — so its category stays locked (Task 2 test `une ligne annulée suffit à figer la catégorie`).
3. One payment collecting a champagne line and an autre-boisson line together: each half gets exactly its own line's amount (Task 3 test `un paiement mêlé : chaque moitié reçoit sa ligne`).
4. A line billed one day and paid another: listed on its billing day (« à encaisser » until paid), its money counted on the payment day (Task 3 test `dates : la liste suit la facturation, la recette suit l’encaissement`).
5. A day client's Boutique champagne line in the columns: « Client journalier », no number, no file link (Task 3 test `client journalier sans donnée personnelle dans les colonnes`; Task 5 browser check).

## File map

- `worker/schema.js` — V19. `shared/roles.js` — categories and labels. `worker/club.js` — product rules, the lock, `financeSummary`. `worker/billed.js` (new, mixin like `worker/shop.js`) — billed lines per column. `worker/api.js` — one route. `worker/seed.js` — demo categories.
- Front: `src/pages/Products.jsx`, `src/pages/Reservation.jsx`, `src/dialogs/reservationDialogs.jsx`, `src/components/ui/ui.jsx`, `src/components/ui/Icon.jsx`, `src/components/ui/GuidedTour.jsx`, `src/pages/Cash.jsx`, new `src/components/cash/categories.js` (pure) and `src/components/cash/CategoryColumns.jsx`, `src/club.css`.
- Tests: `test/drinks-v19.test.js`, `test/category-lock.test.js`, `test/finance-categories.test.js`, `test/cash-categories.test.js`; small edits to `test/roles-v18.test.js` and `test/rooms.test.js`.

---

### Task 1: Migration V19 and the « boisson » category (server, demo)

**Files:**
- Modify: `worker/schema.js` — add `V19` after V18 (line 709), append to `MIGRATIONS` (line 711)
- Modify: `shared/roles.js` — categories next to `accountOfCategory` (line 16)
- Modify: `worker/club.js` — import (line 26); `addItem` (2661: message 2669-2671, account 2680); `productFields` (3078-3081); `exportTable` case `'stock'` (3574-3582)
- Modify: `worker/seed.js` lines 81, 83, 84
- Modify: `test/roles-v18.test.js` lines 26 and 121 (`'18'` becomes `String(MIGRATIONS.length)`, as `test/catalog.test.js:336` does)
- Modify: `test/rooms.test.js` — the demo test (~338-355)
- Test: `test/drinks-v19.test.js`

**Interfaces:**
- Produces (`shared/roles.js`, pure):
  - `CATEGORIES = ['cigare', 'bouteille', 'boisson']`
  - `CATEGORY_LABEL = { cigare: 'Cigare', bouteille: 'Champagne', boisson: 'Autre boisson' }`
  - `CATEGORY_PLURAL = { cigare: 'Cigares', bouteille: 'Champagne', boisson: 'Autres boissons' }`
  - `accountOfCategory` unchanged (`boisson` → `alcool`); its comment names the three categories.
- Produces (DB): `products.category` accepts `'boisson'`; index `charges_product ON charges(product_id)` (Task 2 reads it for every product).
- Produces: `POST /api/products` / `PUT /api/products/:id` accept `boisson` (rights through the existing `assertRayon`); `POST /api/reservations/:id/items` bills a boisson to `alcool`, whole units only.

- [ ] **Step 1: Write the failing tests** in `test/drinks-v19.test.js` (server `lenientTariffs: true`; accounts `admin`, `ger`, `cig` = associé cigares, `cha` = associé alcool; booking helper as `bookSession` in `test/purchases.test.js` ~line 37)

```js
test('trois catégories ; l’autre boisson va au compte Alcool', () => {
  assert.deepEqual(CATEGORIES, ['cigare', 'bouteille', 'boisson']);
  assert.equal(CATEGORY_LABEL.bouteille, 'Champagne'); assert.equal(CATEGORY_LABEL.boisson, 'Autre boisson');
  assert.equal(CATEGORY_PLURAL.boisson, 'Autres boissons'); assert.equal(accountOfCategory('boisson'), 'alcool');
});

// v18Copy(sourceFile, file): `v17Copy` of test/roles-v18.test.js (~line 79) with MIGRATIONS.slice(0, 18) and version '18'.
test('migration sans perte : V19 garde produits, stocks, photos et ventes', async () => {
  // source (current code): cigar with initial stock 5 and a photo (PUT /api/products/:id/photo, `picture()` body of
  //   test/catalog.test.js ~line 60), bottle with stock 3, a stock entry, a Boutique sale of 1 bottle to a day client.
  // read(db) = products (every column), stock_movements, product_photos (product_id, mime, bytes, updated_at, length(data)),
  //   charges (id, product_id, account, amount, status), payments (id, amount, ticket_code), ordered by id.
  // v18Copy then old.start(): schema_version === String(MIGRATIONS.length); deepEqual(read(old.db), expected);
  // PRAGMA foreign_key_check -> []; no table 'products_v18' left; index 'charges_product' exists;
  // as admin on the migrated base: POST /api/products { category: 'boisson', … } -> 200.
});
test('l’associé du champagne gère les autres boissons, celui des cigares les voit seulement', async () => {
  // cha POST /api/products { category: 'boisson', name: 'Whisky test', reference: 'DRK', price: 30000 * UM, initial_stock: 4 } -> 200
  // cig: same body (other reference) -> 403; PUT on DRK -> 403; photo PUT on DRK -> 403; GET /api/products lists DRK
  // cha: PUT DRK (price) -> 200, photo PUT -> 200; ger: POST /api/products -> 403, stock { kind: 'entree', quantity: 2 } -> 200,
  //   adjustment down -> 403 (today's rule); POST { category: 'soda' } -> 400 « Catégorie invalide (cigare, champagne ou autre boisson). »
});
test('une autre boisson se facture en séance, à l’unité entière, au compte Alcool', async () => {
  // POST /api/reservations/:id/items { product_id: DRK, quantity: 1 } -> the new line has account 'alcool'; stock - 1
  // quantity 1.5 -> 400 « Les autres boissons se vendent à l’unité entière : indiquez un nombre entier (1 à 99). »
  // quantity above the stock -> 409 'STOCK_INSUFFISANT'
});
test('l’export des stocks dit Champagne et Autre boisson', async () => {
  // GET /api/export/stock?from=${today}&format=json as admin: « Catégorie » is 'Champagne' on a bouteille's movement,
  // 'Autre boisson' on DRK's; no row says 'Bouteille'
});
```

In `test/rooms.test.js`, demo test (~345, after `seedDemo`): `Whisky 12 ans (démo)`, `Cognac VSOP (démo)`, `Rhum ambré (démo)` have category `'boisson'`, `Champagne brut (démo)` has `'bouteille'` (read with `server.club.all('SELECT name, category FROM products WHERE is_demo = 1')`).

- [ ] **Step 2: Run** `node --test test/drinks-v19.test.js test/rooms.test.js` — Expected: FAIL (`CATEGORIES` not exported; the CHECK refuses `boisson`).
- [ ] **Step 3: Implement**
  - `V19`, with a comment in the style of V15/V18 (why the rebuild, nothing moves, same ids): `'PRAGMA defer_foreign_keys = ON'`, `'CREATE TABLE products_v18 AS SELECT * FROM products'`, `'DROP TABLE products'`, `CREATE TABLE products` exactly as V1 (worker/schema.js 168-183) except `CHECK (category IN ('cigare', 'bouteille', 'boisson'))`, `INSERT INTO products (all 14 V1 columns) SELECT … FROM products_v18`, `'DROP TABLE products_v18'`, `'CREATE INDEX charges_product ON charges(product_id)'`. Drop and create, never rename (V15's comment says why).
  - `productFields`: `CATEGORIES.includes(category)`, else `invalid('Catégorie invalide (cigare, champagne ou autre boisson).')`.
  - `addItem`: `const account = accountOfCategory(p.category)`; the quantity message: cigare → today's cigar text, bouteille → today's bottle text, boisson → the message in the test above.
  - `exportTable` `'stock'`: `CATEGORY_LABEL[m.category]`.
  - `worker/seed.js`: whisky, cognac and rhum created with `'boisson'` (references unchanged).
- [ ] **Step 4: Run** `npm test` — Expected: all PASS (V18 and wallet migration tests included).
- [ ] **Step 5: Commit** — `git add shared/roles.js worker/schema.js worker/club.js worker/seed.js test/drinks-v19.test.js test/roles-v18.test.js test/rooms.test.js docs/superpowers` — « Autres boissons : catégorie en base (V19) » (the spec and this plan go in this first commit).

---

### Task 2: Category locked after a sale; the Boutique stays closed to other drinks

**Files:**
- Modify: `worker/club.js` — `PRODUCT_SELECT` (142-145), `productDTO` (3058-3064), `updateProduct` (3112-3133)
- Test: `test/category-lock.test.js`

**Interfaces:**
- Consumes: `boisson` (Task 1).
- Produces: `productDTO(p).sold: boolean` — the product has at least one charge (any status, session or Boutique); `PRODUCT_SELECT` adds `EXISTS (SELECT 1 FROM charges c WHERE c.product_id = p.id) AS sold` (index from Task 1).
- Produces: `updateProduct` — when `f.category !== p.category` and the product has a charge: `conflict('CATEGORIE_VENDUE', 'Ce produit a déjà été vendu : sa catégorie ne change plus. Créez un nouveau produit et désactivez celui-ci.')`, nothing written. Same category: unchanged behaviour. The `produit.modifier` audit adds `category` to `avant` and `apres`.
- No Boutique code change: `createShopSale` already refuses a product whose category is not `SHOP[account].category` (`worker/shop.js:100`, 400 `RAYON`); this task pins it.

- [ ] **Step 1: Write the failing tests** in `test/category-lock.test.js` (`CHP` bouteille, `DRK` boisson, `CIG` cigare, each with stock; a session as in Task 1)

```js
const LOCKED = 'Ce produit a déjà été vendu : sa catégorie ne change plus. Créez un nouveau produit et désactivez celui-ci.';
test('jamais vendu : la catégorie change librement', async () => {
  // new bouteille, sold === false; PUT { category: 'boisson' } -> 200 category 'boisson'; PUT back to 'bouteille' -> 200
});
test('vendu en séance : la catégorie ne change plus', async () => {
  // DRK added to a session; GET /api/products -> DRK.sold === true
  const r = await admin.put(`/api/products/${DRK}`, { category: 'bouteille' });
  assert.equal(r.status, 409); assert.equal(r.data.error.code, 'CATEGORIE_VENDUE'); assert.equal(r.data.error.message, LOCKED);
  // DRK still 'boisson' in the db
});
test('vendu en Boutique : la catégorie ne change plus', async () => { /* CHP sold to a day client; PUT { category: 'boisson' } -> 409 */ });
test('une ligne annulée suffit à figer la catégorie', async () => {
  // fresh boisson added to a session, then POST /api/charges/:id/cancel { reason: 'Erreur de saisie' } -> PUT { category: 'bouteille' } -> 409
});
test('modifier un produit vendu reste possible sans changer sa catégorie', async () => {
  // PUT DRK { category: 'boisson', name: 'Whisky test 2', price: 31000 * UM, active: false } -> 200 with those values
});
test('la Boutique ne vend jamais une autre boisson', async () => {
  // as cha, ger and admin: POST /api/shop/sales { account: 'alcool', buyer: { kind: 'journalier' }, lines: [{ product_id: DRK, quantity: 1 }],
  //   method: 'Espèces' } -> 400 'RAYON'; account 'cigares' -> 400 'RAYON'; DRK stock and shop_sales count unchanged
});
```

- [ ] **Step 2: Run** `node --test test/category-lock.test.js` — Expected: FAIL (`sold` undefined, PUT answers 200).
- [ ] **Step 3: Implement** the interfaces above.
- [ ] **Step 4: Run** `npm test` — Expected: all PASS.
- [ ] **Step 5: Commit** — « Autres boissons : catégorie figée après une vente ».

---

### Task 3: Caisse figures by category (server)

**Files:**
- Create: `worker/billed.js` — `export const DRINK_PART_SQL`, `export const billedMethods = { billedLines }`; `Object.assign(Club.prototype, billedMethods)` at the end of `worker/club.js` (after line 3772)
- Modify: `worker/club.js` — `financeSummary` (3388-3475)
- Modify: `worker/api.js` — next to `/api/finance/summary` (line 335)
- Test: `test/finance-categories.test.js`

**Interfaces:**
- Produces: `DRINK_PART_SQL = "CASE WHEN pr.category = 'boisson' THEN 'autres_boissons' ELSE 'champagne' END"` (`pr` = the line's product, LEFT JOINed: a line without product is champagne). The only place that rule is written.
- Produces: `financeSummary(from, to)` keeps every field and value; the `alcool` entry of `accounts` (only that one) gains `champagne` and `autres_boissons`, each `{ billed, collected, refunded, net, outstanding, cancelled, lines }`, computed with the same three queries (charges by `created_at`, allocations by `paid_at`, refunds by `created_at`) grouped also by `DRINK_PART_SQL`, so `champagne[f] + autres_boissons[f] === alcool[f]` for every field. Once `products` is joined, qualify every column (`products` also has `created_at`).
- Produces: `billedLines(from, to) -> { from, to, limit: 200, columns: { reservations, champagne, autres_boissons, cigares } }`, each column `{ count: number, truncated: boolean, lines: BilledLine[] }`: the charges with `created_at` in `periodBounds(from, to)`, every status, newest first (`created_at DESC, id DESC`), at most 200 per column. A line's column: its account, and for `alcool` the value of `DRINK_PART_SQL`. Approach: one query, a subquery naming the column, `ROW_NUMBER()` and `COUNT(*) OVER (PARTITION BY col …)` around it, `rn <= 200`.
- `BilledLine = { charge_id, at, kind, label, quantity, amount, status, reservation_id, room_name, plan_name, shop_sale_id, member_id, member_name, member_no, payment_id, ticket_number }` — `room_name` from the reservation's room, `plan_name` from the line's subscription, buyer through `buyerShown(COALESCE(s.buyer_kind, m.kind), m)` (`worker/shop.js`): a day client has `member_id: null`, `member_name: 'Client journalier'`, `member_no: null`; `payment_id` from `payment_allocations`, `ticket_number = formatTicketNumber(payment_id)`, both null while due.
- API: `GET /api/finance/billed?from&to` (`to` defaults to `from`), `CLUB` (administrator and associés; gérant 403).

- [ ] **Step 1: Write the failing tests** in `test/finance-categories.test.js` (server `lenientTariffs: true`; `admin`, `ger`, `cig`, `cha`; `CHP` 20 000, `DRK` 30 000, `CIG` 5 000 FCFA; `summary(d)` = GET `/api/finance/summary?from=d`, `billed(d)` = GET `/api/finance/billed?from=d`; `alcool(s)` = `s.accounts.find((a) => a.account === 'alcool')`; sessions as `bookSession` in `test/purchases.test.js`)

```js
const FIELDS = ['billed', 'collected', 'refunded', 'net', 'outstanding', 'cancelled', 'lines'];
test('Champagne + Autres boissons = Alcool', async () => {
  // session: CHP and 2× DRK paid; Boutique: 1 CHP to a day client; CIG in session paid
  // alcool(s).champagne.collected === before + 40000 * UM; alcool(s).autres_boissons.collected === before + 60000 * UM
  // for every f of FIELDS: champagne[f] + autres_boissons[f] === alcool[f]; reservations, cigares and total have no 'champagne' key
});
test('un paiement mêlé : chaque moitié reçoit sa ligne', async () => {
  // one POST /api/payments { charge_ids: [chpLine, drkLine], method: 'Espèces' } -> champagne.collected +20000*UM, autres_boissons +30000*UM
});
test('remboursement d’une autre boisson : il sort de « Autres boissons »', async () => {
  // POST /api/charges/:drkLine/refund { reason: 'Bouteille entamée', method: 'Espèces' } -> autres_boissons.refunded +30000*UM, champagne.refunded unchanged
});
test('ligne Alcool sans produit : comptée dans Champagne', async () => {
  // server.club.tx(() => server.club.insertCharge(gerant, { account: 'alcool', kind: 'produit', member_id, label: 'Ancienne ligne',
  //   quantity: 1, unit_price: 1000 * UM })) (as test/wallet.test.js ~207), paid -> champagne.collected +1000*UM; listed in columns.champagne
});
test('liste des lignes facturées : chaque ligne dans sa colonne', async () => {
  // columns.autres_boissons: a due DRK line { status: 'due', payment_id: null, reservation_id, kind: 'produit' }
  // columns.cigares: a cancelled CIG line { status: 'annulee' }
  // columns.reservations: the plan line { kind: 'abonnement', plan_name: <MENSUELLE plan's name> } and a time line of a booking
  //   paid with the card (no plan, `pay_with_card: true` after a recharge, as test/demo.test.js ~196) { kind: 'temps_supplementaire', room_name, reservation_id }
  // columns.champagne: the Boutique line { shop_sale_id, ticket_number: /^T-\d+$/ }
});
test('client journalier sans donnée personnelle dans les colonnes', async () => {
  // the Boutique CHP line of a day client: member_id null, member_name 'Client journalier', member_no null
});
test('dates : la liste suit la facturation, la recette suit l’encaissement', async () => {
  // DRK added to a session on the note; its charge's created_at moved to yesterday (server.club.run UPDATE)
  // billed(yesterday) lists it with status 'due'; billed(today) does not; then paid today:
  // summary(today) autres_boissons.collected includes it, summary(yesterday) collected does not; billed(yesterday) now says 'payee'
});
test('le gérant n’a pas les colonnes de la caisse', async () => {
  refused(await ger.get(`/api/finance/billed?from=${today}`), 403);
  ok(await cig.get(`/api/finance/billed?from=${today}`)); ok(await cha.get(`/api/finance/billed?from=${today}`));
});
test('période longue : 200 lignes au plus par colonne, les plus récentes', async () => {
  // 205 CIG lines through insertCharge -> columns.cigares: count >= 205, lines.length 200, truncated true,
  // lines[0].charge_id is the highest id; columns.reservations.truncated false (keep this test last)
});
```

- [ ] **Step 2: Run** `node --test test/finance-categories.test.js` — Expected: FAIL (`champagne` undefined, 404 on `/api/finance/billed`).
- [ ] **Step 3: Implement** the interfaces above.
- [ ] **Step 4: Run** `npm test` — Expected: all PASS (`test/shop-finance.test.js` checks the existing keys and the Séances / Boutique split).
- [ ] **Step 5: Commit** — « Autres boissons : chiffres de caisse par catégorie ».

---

### Task 4: Front — the three categories on every screen

**Files:**
- Modify: `src/components/ui/Icon.jsx` — import `GlassWater`; `drink: GlassWater` next to `bottle` (line 23)
- Modify: `src/components/ui/ui.jsx` line 38 — placeholder icon by category: cigare `cigar`, bouteille `bottle`, boisson `drink`
- Modify: `src/pages/Products.jsx` — `CATEGORY` (17) replaced by `CATEGORY_LABEL` (uses at 32, 258, 313, 375); `ProductDialog` categories (77) from `CATEGORIES` filtered by `ownsAccount`; category select (108-109); `cat` param (297) `CATEGORIES.includes`; lead (320) « Cigares, champagne et autres boissons du club. »; filter options (351) `[['', 'Tous'], ...CATEGORIES.map((k) => [k, CATEGORY_PLURAL[k]])]`
- Modify: `src/pages/Reservation.jsx` — `CAT_FILTERS` (23) `[['tous', 'Tous'], …CATEGORY_PLURAL]`; labels at 46 and 251 `CATEGORY_LABEL[p.category]`; placeholder (223) « Rechercher un cigare, une boisson… »
- Modify: `src/dialogs/reservationDialogs.jsx` — `PRODUCT_GROUPS` (723-726): the three categories with `CATEGORY_PLURAL` (the « Facturer » dialog of Accueil, Salles and Agenda), so other drinks have their own group
- Modify: `src/components/ui/GuidedTour.jsx` — products step (74-77): body « Cigares, champagne et autres boissons (vendus entiers uniquement) avec leur stock. Entrées et ajustements avec motif ; chaque mouvement reste dans l’historique du produit. », features add « Filtres Tous, Cigares, Champagne, Autres boissons »

**Interfaces:**
- Consumes: `CATEGORIES`, `CATEGORY_LABEL`, `CATEGORY_PLURAL` (Task 1, imported from `shared/roles.js` as `Products.jsx` already does), `product.sold` (Task 2).
- Product dialog: with `product?.sold` the category select is disabled, the body sends `product.category`, and under it `<p className="subtle">` reads « Ce produit a déjà été vendu : sa catégorie ne change plus. Pour changer de catégorie, créez un nouveau produit et désactivez celui-ci. » An associé cigares sees « Cigare » only; the champagne associé « Champagne » and « Autre boisson ».
- Action labels « Facturer bouteille / cigare » and « + Bouteille / Cigare » stay (they name an action, not a category).

- [ ] **Step 1:** Make the changes. **Step 2: Run** `npm run build` — Expected: success, no new warning.
- [ ] **Step 3: Verify in the browser** (`npm run build`, then `preview_start` `club-cloudflare-local`, local data only), phone (375) and tablet (768), light and dark: « Nouveau produit » offers Cigare, Champagne, Autre boisson; `/produits` filters read « Tous / Cigares / Champagne / Autres boissons » and the category column « Champagne » / « Autre boisson », never « Bouteille »; a sold product's dialog shows the lock note and a disabled select, an unsold one changes category; a boisson without photo shows the glass icon; a session's filters and the « Facturer » dialog have an « Autres boissons » group and bill it; the Boutique « Champagnes » tab never lists a boisson; signed in as each associé, the dialog lists only his categories.
- [ ] **Step 4: Run** `npm test` — PASS. **Step 5: Commit** — « Autres boissons : libellés et filtres ».

---

### Task 5: Front — the Caisse in three columns

**Files:**
- Create: `src/components/cash/categories.js` (pure, no JSX)
- Create: `src/components/cash/CategoryColumns.jsx`
- Modify: `src/pages/Cash.jsx` — `AdminCash`: `api.get(\`/api/finance/billed${qs({ from, to })}\`)` in the `Promise.all` (74-82) and in the returned object; `<CategoryColumns sum={d.sum} billed={d.billed} method={method} />` right after `<CashBalance …/>` (line 126). `ManagerCash` unchanged.
- Modify: `src/club.css` — next to `.cash-columns` (1086-1088), both themes through the existing tokens
- Modify: `src/components/ui/GuidedTour.jsx` — a `boss: true` step after the Caisse step (83-86)
- Test: `test/cash-categories.test.js`

**Interfaces:**
- Consumes: `financeSummary` with `alcool.champagne` / `alcool.autres_boissons`, `GET /api/finance/billed` and `BilledLine` (Task 3); `CashRow`, `metaLine` (`src/components/cash/CashRow.jsx`); icon `drink` (Task 4).
- Produces (`categories.js`):
  - `categoryColumns(sum, billed) -> Column[]`, `Column = { key: 'reservations'|'boisson'|'cigares', title, icon, net, parts: Part[] }`, `Part = { key, title, net, count, truncated, lines }` (a part's `key` is its `billed.columns` key: `reservations`, `champagne`, `autres_boissons`, `cigares`), in this order: `reservations` « Réservation séance » (icon `rooms`, one part, title null); `boisson` « Boisson » (icon `bottle`, `net` = alcool's, parts « Champagne » then « Autres boissons » (icon `drink`) with their own `net`); `cigares` « Cigare » (icon `cigar`, one part).
  - `lineTexts(line) -> { title, origin }`: `abonnement` → title `Abonnement · ${plan_name} · ${member_name}`, origin `''`; `temps_supplementaire` → title `label`, origin `Séance n° ${reservation_id} · ${room_name} · ${member_name}` (room left out when null); `produit` → title `${label} × ${quantity}`, origin `Boutique · ${member_name}` with `shop_sale_id`, else `Séance n° ${reservation_id} · ${member_name}`, else `member_name`.
- `CategoryColumns`: `<section id="caisse-categories" className="card cash-block">`, title « Par catégorie » (with a subtle « toutes caisses et comptes » when `method` is set: the block ignores that filter). Each column: icon, title, net (`money`) on top; each part: sub-title and net (Boisson only), then its lines as `CashRow` — title from `lineTexts`, meta `metaLine(dateTime(at), ticket link, origin)` with the member name linked to `/membres/{member_id}` only when `member_id` is set, chip « à encaisser » (`chip-warn`) for `due`, `cancelled` (struck) with chip « annulée » / « remboursée » for those statuses, amount without sign. Empty part: « Rien de facturé sur la période. ». Truncated: « Les {lines.length} lignes les plus récentes sur {count} : choisissez une période plus courte pour tout voir. ». Under the columns, `p.subtle.cash-note`: « La recette compte l’argent à la date où il est encaissé (ou rendu) ; la liste montre ce qui a été facturé à la date de facturation, payé ou non. »
- Layout: container query; from 960 px of container, columns `minmax(0, 1fr) minmax(0, 2fr) minmax(0, 1fr)` with Boisson's two parts side by side; below, one column under the other and the parts stacked.
- Tour step: `{ boss: true, route: '/caisse', targets: ['#caisse-categories', '[data-tour="cash"]'], icon: 'list', title: 'Par catégorie', body: 'Trois colonnes : Réservation séance, Boisson (Champagne et Autres boissons) et Cigare. En haut, l’argent encaissé ; dessous, tout ce qui a été facturé, payé ou non.', features: ['« à encaisser » : facturé, pas encore payé', 'Une ligne annulée ou remboursée reste visible, barrée', 'Les ventes Boutique sont marquées « Boutique »'] }`.

- [ ] **Step 1: Write the failing tests** in `test/cash-categories.test.js` (server answers, as `test/cash-flows.test.js` does: CHP, DRK and CIG lines through `insertCharge` with their `product_id`, some paid with `POST /api/payments`)

```js
test('trois colonnes ; Boisson = Champagne + Autres boissons ; la somme = le total', async () => {
  const sum = await summary(); const b = await billed();
  const cols = categoryColumns(sum, b);
  assert.deepEqual(cols.map((c) => c.title), ['Réservation séance', 'Boisson', 'Cigare']);
  assert.deepEqual(cols[1].parts.map((p) => p.title), ['Champagne', 'Autres boissons']);
  assert.equal(cols[1].net, cols[1].parts[0].net + cols[1].parts[1].net);
  assert.equal(cols.reduce((s, c) => s + c.net, 0), sum.total.net);
  assert.deepEqual(cols[1].parts[1].lines, b.columns.autres_boissons.lines);
});
test('textes d’une ligne facturée', () => {
  const base = { member_name: 'Jean TEST', reservation_id: 12, room_name: 'Salon', quantity: 2, label: 'Whisky test' };
  assert.equal(lineTexts({ ...base, kind: 'abonnement', plan_name: 'Mensuelle' }).title, 'Abonnement · Mensuelle · Jean TEST');
  assert.deepEqual(lineTexts({ ...base, kind: 'produit' }), { title: 'Whisky test × 2', origin: 'Séance n° 12 · Jean TEST' });
  assert.equal(lineTexts({ ...base, kind: 'produit', shop_sale_id: 3, reservation_id: null, member_name: 'Client journalier' }).origin, 'Boutique · Client journalier');
  assert.equal(lineTexts({ ...base, kind: 'temps_supplementaire', label: 'Temps supplémentaire (1 h)' }).origin, 'Séance n° 12 · Salon · Jean TEST');
});
```

- [ ] **Step 2: Run** `node --test test/cash-categories.test.js` — Expected: FAIL (module missing).
- [ ] **Step 3: Implement** `categories.js`, `CategoryColumns.jsx`, the `Cash.jsx` wiring, the styles and the tour step.
- [ ] **Step 4: Run** `npm test` and `npm run build` — Expected: PASS, build succeeds.
- [ ] **Step 5: Verify in the browser** (as in Task 4), on a day with a champagne, a boisson and a cigar billed in a session (one left on the note), a booking paid by card, a plan sold, a Boutique champagne sale to a day client and a cancelled line: the block sits right under the balance; the column tops equal « Détails » (Réservations, Alcool = Champagne + Autres boissons, Cigares); « à encaisser » on the open line, the cancelled one struck; the Boutique line reads « Boutique · Client journalier » without link; the period picker changes the block; phone (375) stacks the columns, tablet (768) and desktop, light and dark; the gérant's `/caisse` has no block, an associé's has it; the tour shows « Par catégorie ».
- [ ] **Step 6: Commit** — « Autres boissons : caisse en trois colonnes ».

---

### Task 6: Whole-branch check

- [ ] **Step 1: Run** `npm test` — every test passes; **Run** `npm run build` — success.
- [ ] **Step 2:** Walk the spec's « Objectifs » 1–7 and « Anti-objectifs » one by one against the running app (local `wrangler dev`, fresh database) and write the result in the final report.
- [ ] **Step 3:** Whole-branch review (superpowers:requesting-code-review), fix what it finds, re-run Step 1.
- [ ] **Step 4:** Report to the owner; push, PR, merge and `npm run deploy` only after each explicit yes.
