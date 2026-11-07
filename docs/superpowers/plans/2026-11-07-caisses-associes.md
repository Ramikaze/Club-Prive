# Caisses des associés Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn the Caisse page's « Soldes » card into six tiles (cash fund, card credit, the three caisses, the till) that always add up. Each caisse gets its own supplier payment, profit taking and contribution. No operation may take a caisse below zero.

**Architecture:**
- **Server computation.** The server computes the caisses in a new `worker/caisses.js`, mixed into `Club` like `worker/ledger.js`. It uses the movements the treasury already reads, summed from the cash-fund date to the end of the period.
- **Server guard.** The same module enforces « no caisse below zero » on every operation that lowers one.
- **Profit taking** is a new ledger kind, `retrait`.
- **The page** reads `GET /api/caisses` and draws the tiles. « Par catégorie » reuses the tiles' six-column grid.

**Tech Stack:** Cloudflare Worker + Durable Object SQLite (migrations in `worker/schema.js`), React 18 + Vite, `node --test` (`npm test`).

**Spec:** `docs/superpowers/specs/2026-11-07-caisses-associes-design.md` (validated 2026-11-07). Read it first; the decision numbers below are its numbers.

## Global Constraints

**Money and copy**
- Money is stored in hundredths (`UM = 100` in `test/harness.js`). Display money with `money()` from `src/lib/format.js`. Server messages use `this.money()`.
- Every user-facing text is French. Server messages read like the existing ones in `worker/ledger.js`.

**Tiles, lines and buttons** (use these strings verbatim)
- Tile titles: « Fond de caisse », « Solde de crédit sur les cartes clients non utilisées », « Réservation de séance », « Champagne et autres boissons », « Cigare », « Solde en caisse ».
- Lines of « Réservation de séance »: « Réservations », « Dépenses communes », « Apports et entrées » (only when ≠ 0), « Bénéfices pris » (only when ≠ 0). Its hint reads « soit X chacun ».
- Lines of « Champagne et autres boissons »: « Vendu champagne », « Vendu autres boissons », « Achats champagne », « Achats autres boissons », « Autres dépenses » (only when ≠ 0), « Apports » (only when ≠ 0), « Bénéfices pris » (always).
- Lines of « Cigare »: « Vendu », « Achats cigares », « Autres dépenses » (only when ≠ 0), « Apports » (only when ≠ 0), « Bénéfices pris » (always).
- Buttons:
  - « Payer un fournisseur »: on the Champagne… and Cigare tiles.
  - « Prendre des bénéfices »: on all three caisse tiles.
  - « Faire un apport »: on all three caisse tiles.
  - « Compter la caisse »: stays in the card head.

**Categories and layout**
- Expense categories: « Achats champagne », « Achats autres boissons », « Achats cigares ». The receipt category is « Apport des associés ». The code finds them by a stable `code`, never by name.
- An amount never wraps: `white-space: nowrap` on every amount. Only a title may wrap (spec decision 7).
- The six tiles show only when the « Caisse ou compte » filter is « Toutes ». With one method chosen, the current four-figure card stays.
- Under 840 px, the tiles and the « Par catégorie » columns stack.

**Money rules**
- Central rule: fund + card credit + the three caisses = till, to the unit, at every date.
- No operation may take a caisse below zero. Refuse it with HTTP 409, code `CAISSE_INSUFFISANTE`.
- No money ever moves from one caisse to another: no transfer, « zéro compensation » (spec decision 5).
- The gérant keeps his page and rights. His expenses come out of Réservation de séance, so they are refused when it lacks money.

**Tests**
- Never weaken a rule to make an old test pass. Give the test money first, with `fundCaisse` (Task 4).

## Review Focus

1. **Real data already below zero.** On the live club, expenses may already be recorded since the fund date before any sale. The tile must show the true negative figure in red, with « Remettez de l'argent dans cette caisse. », and the page must not crash. Tested in Task 2 (`caisseBalances` returns the negative balance as it is) and Task 5 (`negative` flag).
2. **A period ending before the fund date** (« Hier » when the fund is dated today). `caisseBalances` answers `started: false`, and the page shows « Le suivi des caisses commence le JJ/MM/AAAA. » instead of tiles. Tested in Task 2 and Task 5.
3. **An odd common profit taking** (amount in hundredths). The two halves differ by one unit, the Champagne associé gets the extra one, and the halves add up exactly. Tested in Task 1 (`splitHalves`).
4. **Cancelling an apport whose money is already spent** is refused (`CAISSE_INSUFFISANTE`). Cancelling an expense or a profit taking always works, since it raises the caisse. Tested in Task 4.
5. **A sale paid partly by card, then refunded.** The caisse loses the full amount, the card tile gets its part back, and the till loses the cash part. The central rule still holds. Tested in Task 2.

---

### Task 1: Schema V20, category codes, the purchase categories split

**Files:**
- Create: `shared/caisses.js`
- Modify: `worker/schema.js` (add `V20`, append it to `MIGRATIONS`)
- Modify: `worker/ledger.js:28-34` (`DEFAULT_CATEGORIES`), `:84-124` (`categoryDTO`, `updateCategory`), add `ensureCategoryCodes()` to `ledgerMethods`
- Modify: `worker/club.js:279-291` (call `this.ensureCategoryCodes()` after the existing category seeding, inside the same boot block)
- Modify: `worker/seed.js:243` (`'Achats boissons'` → `'Achats champagne'`)
- Test: `test/caisses-categories.test.js`

**Interfaces:**
- Produces, in `shared/caisses.js` (pure, no import from worker or src):
  - `CAISSES = ['reservations', 'alcool', 'cigares']`
  - `CAISSE_LABEL = { reservations: 'Réservation de séance', alcool: 'Champagne et autres boissons', cigares: 'Cigare' }`
  - `CATEGORY_CODES = { achat_champagne: { kind: 'depense', name: 'Achats champagne', account: 'alcool', legacy: 'Achats boissons' }, achat_autres_boissons: { kind: 'depense', name: 'Achats autres boissons', account: 'alcool' }, achat_cigares: { kind: 'depense', name: 'Achats cigares', account: 'cigares' }, apport: { kind: 'recette', name: 'Apport des associés', account: null } }`
  - `purchaseAccount(code: string|null) -> 'alcool'|'cigares'|null`
  - `splitHalves(amount: number) -> { alcool: number, cigares: number }`: `alcool = Math.ceil(amount / 2)`, `cigares = Math.floor(amount / 2)`.
- Produces, on the server:
  - `categoryDTO` gains `code: string|null`.
  - `ledger_entries.kind` accepts `'retrait'`. A `retrait` row has no category and must name its `account`.

- [ ] **Step 1: Write the failing tests** in `test/caisses-categories.test.js`. Use `Server`, `Client`, `ok` and `UM` from `./harness.js`, `MIGRATIONS` and `migrate` from `../worker/schema.js`, `nodeDb` from `../worker/db-node.js`.
  - `catégories neuves : achats champagne, autres boissons et cigares, chacune avec son code`: on a fresh server, `GET /api/ledger/categories` holds:
    - `{ name: 'Achats champagne', code: 'achat_champagne' }`,
    - `{ name: 'Achats autres boissons', code: 'achat_autres_boissons' }`,
    - `{ name: 'Achats cigares', code: 'achat_cigares' }`,
    - `{ kind: 'recette', name: 'Apport des associés', code: 'apport' }`,
    - and no category named `'Achats boissons'`.
  - `club existant : « Achats boissons » devient « Achats champagne » et ses dépenses passent dans la caisse Champagne`:
    1. With `server.club.run`, clear every code, rename the `achat_champagne` row back to `'Achats boissons'`, and delete the `'Achats autres boissons'` row.
    2. Insert one `depense` row in that category with `account` NULL.
    3. `await server.restart()`.
    4. Expect the same category id named `'Achats champagne'` with code `achat_champagne`, an `'Achats autres boissons'` row, and the expense's `account === 'alcool'`.
  - `un nom déjà pris n'est pas écrasé`: set up a legacy `'Achats boissons'` row and an uncoded `'Achats champagne'` row, then restart. Expect `'Achats champagne'` to get the code and `'Achats boissons'` to keep its name with `code === null`.
  - `une catégorie des caisses se renomme mais ne se désactive pas`:
    - `PUT /api/ledger/categories/:id { name: 'Achats cigares Cuba' }` is ok, and the code stays `achat_cigares`.
    - `PUT { active: false }` answers 409 `CATEGORIE_PROTEGEE`.
  - `migration V20 : prise de bénéfices sans catégorie, jamais sans caisse`: on an in-memory db run through `migrate(db)`:
    - inserting `kind 'retrait', account 'cigares', category_id NULL` succeeds;
    - the same with `account NULL` throws;
    - a `depense` with `category_id NULL` throws.
  - `splitHalves partage à l'unité près`:
    - `splitHalves(10001)` deep-equals `{ alcool: 5001, cigares: 5000 }`;
    - `splitHalves(10000)` deep-equals `{ alcool: 5000, cigares: 5000 }`.

- [ ] **Step 2: Run them and see them fail**
  Run: `node --test test/caisses-categories.test.js`
  Expected: FAIL (`shared/caisses.js` missing, no `code` on categories).

- [ ] **Step 3: Add `V20`** to `worker/schema.js`, after `V19`, following V19's rebuild pattern and its comment style.
  1. `ALTER TABLE categories ADD COLUMN code TEXT`.
  2. `CREATE UNIQUE INDEX categories_code ON categories(code) WHERE code IS NOT NULL`.
  3. Rebuild `ledger_entries` with the V19 pattern: `PRAGMA defer_foreign_keys = ON`, copy the rows to `ledger_entries_v19`, drop, create again, copy back with the same ids, drop the copy. The new table is the V1 definition with these changes:
     - `kind IN ('depense', 'recette', 'transfert', 'retrait')`;
     - `CHECK (kind IN ('transfert', 'retrait') OR category_id IS NOT NULL)`;
     - a new `CHECK (kind <> 'retrait' OR account IS NOT NULL)`.
  4. Recreate `ledger_entries_date`.
  5. Append `V20` to `MIGRATIONS`.

  Put no data change in V20: the boot step below does it, because a fresh database is seeded only after the migrations.

- [ ] **Step 4: Create `shared/caisses.js`** with the names and values of the Interfaces block.

- [ ] **Step 5: Implement the codes in `worker/ledger.js`.**
  - In `DEFAULT_CATEGORIES.depense`, replace `'Achats boissons'` with `'Achats champagne', 'Achats autres boissons'`.
  - `ensureCategoryCodes()` handles each entry of `CATEGORY_CODES` in turn:
    1. If a row already has the code, do nothing.
    2. Else, if a row has the same `kind` and `name`, set its code.
    3. Else, for `legacy`: if there is a `depense` row named `legacy`, and no row named `name`, rename that row and set its code.
    4. Else, insert a new row `(kind, name, created_at, code)`.

    After the loop, backfill the purchase expenses:
    `UPDATE ledger_entries SET account = ? WHERE kind = 'depense' AND account IS NULL AND category_id = ?` for the three purchase codes. Run it on every boot: it is idempotent.
  - `updateCategory`: when the category has a code, refuse `active: false` with `conflict('CATEGORIE_PROTEGEE', 'La catégorie « <name> » sert aux caisses des associés : elle peut être renommée, pas désactivée.')`. A rename keeps the code.
  - `categoryDTO` returns `code`.
  - In `worker/club.js`, call `this.ensureCategoryCodes()` right after the `CASH_GAP_CATEGORY` loop. In `worker/seed.js`, use `'Achats champagne'`.

- [ ] **Step 6: Run the tests and see them pass**
  Run: `node --test test/caisses-categories.test.js`, then `npm test`.
  Expected: all PASS. If an old test looks for `'Achats boissons'`, make it read `'Achats champagne'`.

- [ ] **Step 7: Commit**
  ```bash
  git add shared/caisses.js worker/schema.js worker/ledger.js worker/club.js worker/seed.js test/caisses-categories.test.js
  git commit -m "Caisses : catégories d'achats séparées, codes stables, migration V20"
  ```

### Task 2: The caisses' balances on the server

**Files:**
- Create: `worker/caisses.js` (`export const caisseMethods = { … }`)
- Modify: `worker/club.js` (import it, then `Object.assign(Club.prototype, caisseMethods)` next to the others at the end of the file)
- Modify: `worker/api.js` (route next to `/api/treasury`)
- Test: `test/caisses-balances.test.js`

**Interfaces:**
- Consumes: `CAISSES`, `CAISSE_LABEL`, `splitHalves` (Task 1). Also these existing methods: `treasuryBalances(from, to)`, `walletLiability(atIso)`, `walletLiabilityAt(to)`, `dayStartIso(day)`, `periodBounds`, and `DRINK_PART_SQL` from `worker/billed.js`.
- Produces:
  - `caisseBalances(to = this.bizToday()) -> CaisseBalances`:
    ```js
    {
      start,            // opening_balances.date, or null when tracking runs from the beginning
      to,
      started,          // false when start !== null && to < start; then every other figure is 0
      fund: { amount, total, card_credit }, // total = Σ opening amounts; card_credit = cards' balance just before
                                            // the start day (walletLiability(dayStartIso(start) − 1 ms), 0 with no start);
                                            // amount = total − card_credit
      cards,            // walletLiabilityAt(to)
      caisses: {
        reservations: { balance, sold, expenses, apports, taken, halves },  // halves = splitHalves(balance)
        alcool: { balance, sold_champagne, sold_autres, purchases_champagne, purchases_autres, other_expenses, apports, taken },
        cigares: { balance, sold, purchases, other_expenses, apports, taken },
      },
      till,             // treasuryBalances(start ?? '2000-01-01', to).total.closing
    }
    ```
  - `assertCaisseCovers(account, amount, what)`. It reads `caisseBalances(this.bizToday())`. When the balance is below `amount`, it throws:
    ```js
    conflict('CAISSE_INSUFFISANTE', `${what} demande ${money(amount)}, mais la caisse « ${CAISSE_LABEL[account]} » ne contient que ${money(balance)}. Remettez d'abord de l'argent dans cette caisse (Entrée diverse « Apport des associés »).`, { account, balance, needed: amount })
    ```
  - `GET /api/caisses?to=YYYY-MM-DD` with the `CLUB` guard → `caisseBalances(to)`.

**What each figure counts.** All figures cover the business days `[start, to]` (from the beginning when `start` is null), the same instants `cashFlows` uses, and active rows only. Each caisse is an `account`: `reservations`, `alcool` or `cigares`.
- **Sales, by account.** Take Σ `payment_allocations.amount` of the payments `paid_at` in range, minus Σ `refunds.amount` `created_at` in range. This includes the parts paid by card and the Boutique sales. Split the `alcool` account by `DRINK_PART_SQL` into `sold_champagne` and `sold_autres`. `reservations.sold` is the line « Réservations ».
- **Expenses** are `ledger_entries` of kind `depense`, excluding `OUTSIDE_MEAL_CATEGORY`. The caisse is `account ?? 'reservations'`.
  - On `alcool`: category code `achat_champagne` goes to `purchases_champagne`, `achat_autres_boissons` to `purchases_autres`, anything else to `other_expenses`.
  - On `cigares`: code `achat_cigares` goes to `purchases`, anything else to `other_expenses`.
  - On `reservations`: everything goes to `expenses`.
- **Apports** are `recette` entries. The caisse is `account ?? 'reservations'`.
- **Taken** is the `retrait` entries, by `account`.
- **Balance** = sales − every expense + apports − taken.

- [ ] **Step 1: Write the failing tests** in `test/caisses-balances.test.js`. Build the money the way `test/cash-categories.test.js` does (same helpers: members, recharges, Boutique and session sales, refunds). Define `const tiles = (b) => b.fund.amount + b.cards + b.caisses.reservations.balance + b.caisses.alcool.balance + b.caisses.cigares.balance`.
  - `les six tuiles s'additionnent au franc près`: record a cash fund `{ 'Espèces': 100000 * UM }`. After each of the steps below, assert `tiles(b) === b.till` (with `b = GET /api/caisses`):
    1. a recharge of 50 000;
    2. a champagne Boutique sale of 30 000 paid by card;
    3. a cigar sale of 20 000 in cash;
    4. a session with one « autre boisson » of 10 000, paid in cash;
    5. the refund of a line paid half by card;
    6. an outside meal of 8 000 paid half by card;
    7. a fresh recharge of 5 000, cancelled;
    8. an `Achats champagne` expense of 12 000;
    9. a `Loyer` expense of 15 000;
    10. a transfer Espèces → MTN MoMo;
    11. a counted surplus of 1 000 (`POST /api/treasury/count`).

    Then check the figures:
    - `alcool.sold_champagne === 30000 * UM` (minus any champagne refund done above);
    - `alcool.sold_autres === 10000 * UM`;
    - `alcool.purchases_champagne === 12000 * UM`;
    - `reservations.expenses === 15000 * UM`;
    - `reservations.apports === 1000 * UM`.
  - `crédit des cartes déjà là le jour du fond : le fond le déduit`:
    1. Set `server.club.at` one day back, recharge a member 40 000, then set it back to `null`.
    2. Record the fund `{ 'Espèces': 100000 * UM }`, dated today.
    3. Expect `fund.card_credit === 40000 * UM`, `fund.amount === 60000 * UM`, `cards === 40000 * UM`, and `tiles(b) === b.till`.
  - `période avant le fond : le suivi n'a pas commencé`: with the fund dated today, `GET /api/caisses?to=<yesterday>` returns `started === false` and every caisse balance 0.
  - `une caisse se lit en négatif sans planter`: insert one active `Loyer` `depense` of 5 000 directly with `server.club.run` (old data, so no rule applies). Expect `caisses.reservations.balance === -5000 * UM` and `tiles(b) === b.till`.
  - `le gérant ne lit pas les caisses`: the manager's `GET /api/caisses` → 403.

- [ ] **Step 2: Run them and see them fail**
  Run: `node --test test/caisses-balances.test.js`
  Expected: FAIL (404 on `/api/caisses`).

- [ ] **Step 3: Implement `caisseMethods`** with `caisseBalances` and `assertCaisseCovers` in `worker/caisses.js`, with one grouped SQL query per source (allocations, refunds, entries). Wire them in `worker/club.js` and add the route in `worker/api.js`.

- [ ] **Step 4: Run the tests and see them pass**
  Run: `node --test test/caisses-balances.test.js`, then `npm test`.
  Expected: all PASS.

- [ ] **Step 5: Commit**
  ```bash
  git add worker/caisses.js worker/club.js worker/api.js test/caisses-balances.test.js
  git commit -m "Caisses : soldes des caisses calculés par le serveur, la règle centrale vérifiée"
  ```

### Task 3: Profit taking (`retrait`)

**Files:**
- Modify: `worker/caisses.js` (add `takeProfits`)
- Modify: `worker/ledger.js`:
  - `ENTRY_KIND.retrait = 'Prise de bénéfices'`;
  - `MOVEMENT_KIND.retrait = 'Prise de bénéfices'`;
  - in `cashFlows`, a `retrait` counts `out` on its method;
  - in `movements()`, a `retrait` becomes a row of type `'retrait'` with label `Prise de bénéfices — <CAISSE_LABEL>`, money out of its method, never in a column of expenses.
- Modify: `worker/api.js` (route `POST /api/caisses/retrait`, `CLUB` guard)
- Modify: `src/lib/audit.js` (label `'caisse.benefices': 'Prise de bénéfices'`, and its detail line: caisse, amount, method)
- Test: `test/caisses-retrait.test.js`

**Interfaces:**
- Consumes: `assertCaisseCovers`, `caisseBalances` (Task 2), `CAISSES`, `CAISSE_LABEL`, `splitHalves` (Task 1).
- Produces: `takeProfits(actor, input: { account, amount, method, biz_date?, label? }) -> { entry: EntryDTO, caisses: CaisseBalances }`.

**Rules of `takeProfits`.**
- **Who.**
  - The actor must be a boss (`isBoss`).
  - `account` must be one of `CAISSES`.
  - An associé may take only from `actor.rayon` or `'reservations'`. Anything else is refused with `forbidden('Un associé ne prend des bénéfices que dans sa propre caisse ou dans la caisse commune.')`.
- **When.** The date follows the same rules as `createEntry` for a boss: not in the future, and `assertOpen`.
- **Checks.** Validate `amount` with `int(…, { min: 1, max: 1e13 })` and `method` with `treasuryAccount(method, 'Payé depuis')`. Then call `assertCaisseCovers(account, amount, 'Cette prise de bénéfices')`.
- **Record.** Insert a `ledger_entries` row of kind `retrait` with no category. The default label is `Prise de bénéfices — ${CAISSE_LABEL[account]}`. Audit `caisse.benefices` with `{ caisse, montant, compte }`, plus `{ parts: splitHalves(amount) }` for `reservations`.
- **Cancel.** The existing `POST /api/ledger/entries/:id/cancel` cancels a profit taking: it raises the caisse, so there is no check.

- [ ] **Step 1: Write the failing tests** in `test/caisses-retrait.test.js`. Set up an admin, an associé `cigares`, an associé `alcool` and a gérant (`server.addUser(login, name, role, password, rayon)`). Give the cigares caisse 100 000 with a cash cigar Boutique sale.
  - `l'associé prend ses bénéfices : la caisse et le solde en caisse baissent, pas le résultat`:
    1. Read `/api/treasury?from=today` before.
    2. The cigares associé posts `{ account: 'cigares', amount: 40000 * UM, method: 'Espèces' }`.
    3. Then expect:
       - `caisses.cigares.taken === 40000 * UM`;
       - `caisses.cigares.balance === 60000 * UM`;
       - `till` is 40 000 lower;
       - `result.expenses` and `result.result` are unchanged;
       - `GET /api/ledger/entries` lists the entry with `kind === 'retrait'` and `kind_label === 'Prise de bénéfices'`;
       - the six tiles still add up.
  - `jamais plus que la caisse`: 100 001 → 409 `CAISSE_INSUFFISANTE`, and nothing is written (`ledger_entries` count unchanged).
  - `un associé ne prend pas dans la caisse de l'autre`:
    - the cigares associé on `alcool` → 403;
    - on `reservations`, after an apport of 10 000 there (a `recette` entry with the `apport` category), → ok.
  - `le gérant ne prend pas de bénéfices` → 403.
  - `annulée avec un motif, la caisse remonte ; un mois clôturé refuse`:
    - cancelling via `/api/ledger/entries/:id/cancel` brings `taken` back to 0;
    - a profit taking dated in a closed month → 409 `PERIODE_CLOTUREE`.
  - `grand livre : une prise de bénéfices, jamais une dépense`: `GET /api/ledger/book` has a row with type `'retrait'` and a label starting `'Prise de bénéfices'`.

- [ ] **Step 2: Run them and see them fail**
  Run: `node --test test/caisses-retrait.test.js`
  Expected: FAIL (404 on the route).

- [ ] **Step 3: Implement `takeProfits`** and the ledger changes listed under Files.

- [ ] **Step 4: Run the tests and see them pass**
  Run: `node --test test/caisses-retrait.test.js`, then `npm test`.
  Expected: all PASS.

- [ ] **Step 5: Commit**
  ```bash
  git add worker/caisses.js worker/ledger.js worker/api.js src/lib/audit.js test/caisses-retrait.test.js
  git commit -m "Caisses : prise de bénéfices, hors dépenses et hors résultat"
  ```

### Task 4: The caisse rules on every operation

**Files:**
- Modify: `worker/ledger.js`: `createEntry`, `cancelEntry` and `recordCashGap` (through `createEntry`).
- Modify: `worker/club.js`: `writeRefund`. Every refund goes through it, including the reservation cancellations at `:2377` and `:2516`.
- Modify: `worker/shop.js:149`. Any boss now cancels a Boutique sale (spec decision 8).
- Modify: `src/components/cash/ShopTab.jsx:138`: `canCancel={isBoss(me)}`.
- Modify: `test/harness.js`: add `fundCaisse`.
- Modify: `worker/seed.js`: apports before the demo's first expense.
- Modify: the old tests that now record an expense or a refund in an empty caisse.
- Test: `test/caisses-rules.test.js`; update `test/shop-cancel.test.js:80-84`.

**Interfaces:**
- Consumes: `assertCaisseCovers` (Task 2), `purchaseAccount`, `CAISSES` (Task 1).
- Produces: `fundCaisse(client, account, amount, method = 'Espèces')` in `test/harness.js`. It finds the `apport` category through `GET /api/ledger/categories` and posts `{ kind: 'recette', category_id, account, amount, method }`.

**Rules.**
- **Expense in `createEntry`.** The caisse is `purchaseAccount(category.code)` when the category is a purchase (any `input.account` is ignored), else `input.account ?? null`. Before the insert, call `assertCaisseCovers(account ?? 'reservations', amount, 'Cette dépense')`.
- **Receipt in `createEntry`.** With the `apport` category, `account` is `input.account` when it is one of `CAISSES`, else null, which means Réservation de séance. Any other receipt has `account` null.
- **`cancelEntry`.** A `recette` first calls `assertCaisseCovers(e.account ?? 'reservations', e.amount, 'Cette annulation')`. Cancelling an expense or a `retrait` is never checked.
- **`recordCashGap`.** A shortage goes through `createEntry`, so it is refused when Réservation de séance cannot cover it. This applies to « Compter la caisse » and to the day closing.
- **`writeRefund`.** Before the insert, call `assertCaisseCovers(c.account, c.amount, 'Ce remboursement')`.
- **`cancelShopSale`.** Allow it when `isBoss(actor)`. Any other actor gets `forbidden('Seul un administrateur ou un associé annule une vente Boutique.')`. The audit keeps who did it.

- [ ] **Step 1: Write the failing tests** in `test/caisses-rules.test.js`.
  - `payer un fournisseur : jamais plus que la caisse, et toujours de la bonne caisse`: give the cigares caisse 50 000 from a cigar sale.
    - An `Achats cigares` expense of 60 000 → 409 `CAISSE_INSUFFISANTE` with `error.details.balance === 50000 * UM`.
    - The same expense at 50 000, posted with `account: 'alcool'`, → ok, and the stored `account === 'cigares'`.
  - `dépense du gérant refusée quand Réservation de séance est vide`:
    - the gérant's `Divers` expense of 2 000 → 409 `CAISSE_INSUFFISANTE`;
    - after `fundCaisse(admin, 'reservations', 10000 * UM)`, the same expense → ok.
  - `apport dans la caisse choisie ; son annulation refusée une fois l'argent parti`:
    1. An apport of 30 000 into `alcool` gives `alcool.apports === 30000 * UM`.
    2. An `Achats champagne` expense of 30 000 is ok.
    3. Cancelling the apport → 409.
    4. After cancelling the expense, cancelling the apport is ok.
  - `remboursement refusé quand la caisse de la vente est vide`:
    1. Make a cash champagne Boutique sale of 20 000.
    2. The alcool associé takes 20 000 of profits.
    3. Cancelling the sale → 409 `CAISSE_INSUFFISANTE`.
    4. The product's stock and the sale's `cancelled_at` are unchanged.
  - `comptage : un manque plus grand que Réservation de séance est refusé`:
    - with a fund of `Espèces` 100 000 and an empty Réservation de séance, counting 90 000 → 409;
    - after `fundCaisse(admin, 'reservations', 10000 * UM)`, the count is ok.
  - `fermeture de journée : même règle`: `closeDay` with a shortage larger than Réservation de séance → 409.
  - In `test/shop-cancel.test.js`, rename `ni le gérant ni l'autre associé n'annulent` to `le gérant n'annule pas ; l'autre associé annule en l'absence du premier`:
    - the gérant gets 403;
    - the champagne associé cancels the cigar sale and gets ok;
    - the audit row's `user_id` is the champagne associé's.

- [ ] **Step 2: Run them and see them fail**
  Run: `node --test test/caisses-rules.test.js test/shop-cancel.test.js`
  Expected: FAIL (operations accepted, other associé refused).

- [ ] **Step 3: Implement the rules** listed above.

- [ ] **Step 4: Fix the demo and the old tests**
  - In `worker/seed.js`, before the first `expense(…)`, add three apports dated 70 days ago (`entry(70, { kind: 'recette', category_id: <apport>, account, amount, method: method('Espèces'), label: 'Apport des associés (démo)' })`): `reservations` 1 500 000, `alcool` 400 000 and `cigares` 300 000 (× 100). Split the demo's `Achats champagne` 120 000 into `Achats champagne` 90 000 and `Achats autres boissons` 30 000.
  - Run `npm test`. Each failure caused by `CAISSE_INSUFFISANTE` comes from a test that spends from an empty caisse. Fix it by adding `fundCaisse` in that test's setup, never by changing the rule. Expected files: `cash-categories`, `cash-flows`, `cash-count`, `day-closing`, `finance-categories`, `finance`, `roles-rights`, `purchases`, `shop-finance`, `statement`, `scenarios`, `ticket`, `shop-sale`, `wallet`, `demo`. Where a test asserts treasury totals, the added apport changes them by its amount: adjust the expected figure, never the code.

- [ ] **Step 5: Run everything**
  Run: `npm test`
  Expected: all PASS.

- [ ] **Step 6: Commit**
  ```bash
  git add worker/ledger.js worker/club.js worker/shop.js worker/seed.js src/components/cash/ShopTab.jsx test/
  git commit -m "Caisses : aucune caisse sous zéro, apport dans la caisse choisie, l'autre associé peut annuler"
  ```

### Task 5: The six tiles on the Caisse page

**Files:**
- Create: `src/components/cash/caisses.js` (pure, tested in node)
- Create: `src/components/cash/CaissesBalance.jsx`
- Create: `src/components/cash/ProfitDialog.jsx`
- Modify: `src/pages/Cash.jsx`. In `AdminCash`:
  - add `api.get(`/api/caisses${qs({ to })}`)` to the `Promise.all`;
  - render `CaissesBalance` when `!method`, `CashBalance` otherwise;
  - wire the dialogs.
- Modify: `src/components/cash/EntryDialog.jsx` (props `categoryCode`, `account`; the caisse wording)
- Modify: `src/components/cash/flows.js` (`tillFigures` returns `taken`; `out` excludes it)
- Modify: `src/components/cash/CashBalance.jsx`. Under the figures, add the line « Bénéfices pris : −X. Ils ne sont pas des dépenses ; le solde en caisse en tient compte. » when `f.taken > 0`.
- Modify: `src/components/cash/ExpensesBlock.jsx`. Add `export function ProfitsBlock`, modelled on `TransfersBlock`: the `retrait` entries with `EntryCancel`, titled « Bénéfices pris ». Render it in `Cash.jsx` after `TransfersBlock`.
- Modify: `src/club.css`. Add `.caisses-grid { grid-template-columns: 1fr 1fr 1fr 2fr 1fr 1fr }` from 840 px, one column below. Amounts get `white-space: nowrap; flex-shrink: 0`. A negative value uses the existing `amount-out` colour.
- Test: `test/caisses-tiles.test.js`; extend `test/cash-flows.test.js`.

**Interfaces:**
- Consumes: `CaisseBalances` (Task 2), `POST /api/caisses/retrait` (Task 3), `splitHalves`, `CAISSE_LABEL`, `CATEGORY_CODES` (Task 1), `isBoss` and `ownsAccount` from `shared/roles.js`.
- Produces:
  - `caisseTiles(b: CaisseBalances, me: User) -> Tile[]`, with `Tile = { key, title, value, negative, hint, lines: [{ label, amount, sign: 'in'|'out' }], actions: ('fournisseur'|'benefices'|'apport')[] }`. There are six tiles, in the order and with the titles of Global Constraints.
    - **Keys:** `fond`, `cartes`, `reservations`, `alcool`, `cigares`, `caisse`.
    - **Hints:**
      - the fund tile says `au JJ/MM/AAAA`, plus `dont crédit des cartes déjà là : −X` when `card_credit > 0`;
      - the cards and till tiles say `à ce jour` or `au JJ/MM/AAAA`;
      - the Réservation de séance tile says `soit X chacun` with `X = splitHalves(balance).cigares`;
      - a negative caisse adds `Remettez de l'argent dans cette caisse.`
    - **Actions:**
      - an administrator gets every action on every caisse tile;
      - an associé gets `fournisseur` and `apport` on any caisse tile (decision 8), and `benefices` on his own rayon's tile and on `reservations` only;
      - `fournisseur` never appears on `reservations`.
  - `caisseTiles` returns `null` when `b.started === false`. The page then shows « Le suivi des caisses commence le JJ/MM/AAAA. »
  - `EntryDialog` gets two new optional props.
    - **`categoryCode`** preselects the category with that code.
    - **`account`** preselects the caisse.
    - **A purchase category** shows no caisse choice, only « L'argent sort de la caisse « Champagne et autres boissons ». »
    - **Any other expense** has the select « Caisse qui paie » with the options « Réservation de séance » (value `''`), « Champagne et autres boissons » (`alcool`) and « Cigare » (`cigares`), followed by the same line.
    - **A receipt in the `apport` category** has the select « Caisse qui reçoit l'apport » with the three caisses, followed by « L'argent entre dans la caisse « … ». »
  - `ProfitDialog({ close, account, balance, onDone })` has the fields amount, method, date (boss) and label. It shows « Caisse « … » : X disponibles. » For `reservations`, it also shows « soit X pour chaque associé » live, from `splitHalves`. It posts with `newKey()` as the idempotency key.
  - « Payer un fournisseur »:
    - on the Cigare tile, it opens `EntryDialog` with `kind 'depense'` and `categoryCode 'achat_cigares'`;
    - on the Champagne tile, it first asks « Champagne » or « Autres boissons », then opens it with `achat_champagne` or `achat_autres_boissons`.
  - « Faire un apport » opens `EntryDialog` with `kind 'recette'`, `categoryCode 'apport'` and `account` set to the tile's caisse.

- [ ] **Step 1: Write the failing tests**
  - `test/caisses-tiles.test.js`, on a `CaisseBalances` literal:
    - **Order and titles:** `caisseTiles(b, admin).map((t) => t.title)` deep-equals the six titles, in order.
    - **Alcool lines:** with `other_expenses: 0` and `apports: 0`, the lines are exactly `['Vendu champagne', 'Vendu autres boissons', 'Achats champagne', 'Achats autres boissons', 'Bénéfices pris']`. With `other_expenses: 500`, « Autres dépenses » appears.
    - **Réservation de séance:** its hint contains `soit` when the balance is `125000 * UM`.
    - **Actions:**
      - for `{ role: 'associe', rayon: 'cigares' }`: the alcool tile's actions are `['fournisseur', 'apport']`, the cigares tile's are `['fournisseur', 'benefices', 'apport']`, and the reservations tile's are `['benefices', 'apport']`;
      - the admin gets every action.
    - **Negative and not started:** a caisse with `balance: -5000` has `negative === true` and the « Remettez… » hint. `started: false` returns `null`.
  - In `test/cash-flows.test.js`, `tillFigures sépare les bénéfices pris des dépenses`: with one active `retrait` of 7 000 on Espèces, `f.taken === 7000 * UM`, `f.out` excludes it, and `opening + in − out − taken + received − sent === closing`.

- [ ] **Step 2: Run them and see them fail**
  Run: `node --test test/caisses-tiles.test.js test/cash-flows.test.js`
  Expected: FAIL.

- [ ] **Step 3: Implement** `caisseTiles`, then the components and dialogs, the CSS and the `Cash.jsx` wiring.

- [ ] **Step 4: Run the tests and see them pass**
  Run: `npm test`, then `npm run build`.
  Expected: all PASS, build OK.

- [ ] **Step 5: Check in the browser.** Use `preview_start` with `club-cloudflare-local`, after `npm run build`.
  1. Sign in as the local admin and open `#/caisse`. With « Toutes », six tiles show, and their figures add up to « Solde en caisse ».
  2. Choose « Espèces »: the four-figure card is back.
  3. « Payer un fournisseur » on Cigare opens the expense with « Achats cigares », and the caisse line names « Cigare ».
  4. « Prendre des bénéfices » above the caisse's balance shows the server's message.
  5. At 1280 px and 375 px (`resize_window`), no amount wraps and the console has no error.
  Take one screenshot of each width.

- [ ] **Step 6: Commit**
  ```bash
  git add src/ test/caisses-tiles.test.js test/cash-flows.test.js
  git commit -m "Caisses : six tuiles dans « Soldes », paiement fournisseur, prise de bénéfices et apport"
  ```

### Task 6: « Par catégorie » under the tiles

**Files:**
- Modify: `src/components/cash/categories.js:16-24`. The column titles become `'Réservation de séance'`, `'Champagne et autres boissons'` and `'Cigare'`. The parts keep « Champagne » / « Autres boissons ».
- Modify: `src/components/cash/CategoryColumns.jsx`. When `!method`:
  - `.cat-columns-inner` gets the class `aligned`;
  - two empty `<div className="cat-spacer" aria-hidden="true" />` go before the columns, and one after.
- Modify: `src/club.css`:
  - `.cat-columns-inner.aligned` uses the `.caisses-grid` template from 840 px;
  - `.cat-spacer` is hidden below 840 px, where the columns stack as today.
- Modify: `test/cash-categories.test.js:50` (new titles)

- [ ] **Step 1: Update the failing assertion.** `assert.deepEqual(cols.map((c) => c.title), ['Réservation de séance', 'Champagne et autres boissons', 'Cigare'])`.
- [ ] **Step 2: Run it and see it fail.** Run: `node --test test/cash-categories.test.js`. Expected: FAIL on the titles.
- [ ] **Step 3: Implement** the titles, the spacers and the CSS.
- [ ] **Step 4: Run it and see it pass.** Run: `npm test && npm run build`. Expected: PASS. In the browser at 1280 px, each column sits under its tile and « Recette du jour » is top right. At 375 px, the columns stack.
- [ ] **Step 5: Commit**
  ```bash
  git add src/components/cash/categories.js src/components/cash/CategoryColumns.jsx src/club.css test/cash-categories.test.js
  git commit -m "Caisses : « Par catégorie » aligné sous les tuiles, mêmes titres"
  ```

### Task 7: Demo, guided tour, README, final check

**Files:**
- Modify: `worker/seed.js` (one cigares profit taking of 20 000, dated 3 days ago, through `club.takeProfits`)
- Modify: `src/components/ui/GuidedTour.jsx`:
  - in the Caisse step, the body names the six tiles of « Soldes » and the three buttons;
  - in the « Par catégorie » step, the columns get their new titles.
- Modify: `README.md`. In the Caisse section, add one paragraph on the caisses of the associés: the central rule, never below zero, profit taking out of the result.
- Test: `test/demo.test.js` (run it)

- [ ] **Step 1: Write the change** above, then add to `test/demo.test.js` one assertion: on the freshly seeded demo, `GET /api/caisses` gives `tiles(b) === b.till` and every caisse balance ≥ 0.
- [ ] **Step 2: Run everything.** Run: `npm test && npm run build`. Expected: all PASS.
- [ ] **Step 3: Check the demo in the browser.** Reset the demo in the preview (« Remettre la démo à neuf »), then open `#/caisse` on « Toutes ». The six tiles add up to « Solde en caisse », and the cigares tile shows « Bénéfices pris −20 000 FCFA ».
- [ ] **Step 4: Commit**
  ```bash
  git add worker/seed.js src/components/ui/GuidedTour.jsx README.md test/demo.test.js
  git commit -m "Caisses : démo, visite guidée et README"
  ```
