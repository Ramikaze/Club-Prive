# Comptes fournisseurs Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Each supplier of the club gets an account in FCFA: credit purchases and carried-over balances raise what the club owes, payments (whole or partial, from the supplier's caisse only) lower it, with an information-only amount in EUR/USD.

**Architecture:** A new Worker module `worker/suppliers.js` (mixed into `Club` like `caisses.js`) owns two new tables, `suppliers` and `supplier_purchases`. A payment is an ordinary expense (`ledger_entries`, kind `depense`) carrying `supplier_id`, so caisses, treasury, ledger book, result and cancellation work unchanged. The interface adds a « Fournisseurs » entry with its own icon to the left menu (owner's request), just under « Caisse », a supplier sheet with its statement, and a supplier choice in the « Payer un fournisseur » dialog.

**Tech Stack:** React 18 + Vite (src/), Cloudflare Worker + SQLite in a Durable Object (worker/), node:test with node:sqlite (test/).

**Spec:** `docs/superpowers/specs/2026-11-07-comptes-fournisseurs-design.md`

## Global Constraints

- Amounts are integers in hundredths (`UM = 100` in tests). Foreign amounts too (cents), in `EUR` or `USD` only.
- A foreign amount never enters a calculation: it is stored and displayed « entre parenthèses » only.
- A supplier's caisse is `alcool` (Champagne et autres boissons) or `cigares` (Cigare); never `reservations`.
- What the club owes a supplier = active `report` + active `achat` − active payments; never below 0.
- No caisse below zero: a payment goes through `assertCaisseCovers` (already called by `createEntry`).
- Roles: administrator and associés (`isBoss`) do everything on both caisses; the gérant sees nothing and pays no tracked supplier.
- Screen text in French, one sentence per idea; a money amount never wraps.
- Migration is V22, after the regular clients' credit (V21, merged into main first).
- Every commit waits for the user's explicit yes.

## Review Focus

- A payment cancelled after the supplier was deactivated: the debt comes back; the list must still show it (inactive with a non-zero due), and « Réactiver » must work.
- A cigar supplier paid with « Achats champagne » chosen by hand in « Nouvelle dépense »: refused, the money must not leave the Boissons caisse.
- Cancelling a purchase when payments already exceed what would remain: refused with a message that says to cancel a payment first.
- A purchase dated in a closed month: refused; dated on a closed cash day: accepted (no money moves).
- The demo data set: its payment must fit the demo caisses, and « Remettre la démo à neuf » / « Effacer toutes les données » must wipe suppliers without a foreign-key error (wipe order).

---

### Task 1: Tables, supplier sheet and purchases (server)

**Files:**
- Modify: `worker/schema.js` (new `V22`, appended to `MIGRATIONS` after the credit V21)
- Create: `shared/suppliers.js`
- Create: `worker/suppliers.js`
- Modify: `worker/club.js` (import + `Object.assign(Club.prototype, supplierMethods)`; `WIPE_ORDER` gets `'supplier_purchases', 'suppliers'` right after `'ledger_entries'`)
- Modify: `worker/api.js` (routes, `CLUB` roles)
- Test: `test/suppliers.test.js`

**Interfaces:**
- Produces (shared/suppliers.js): `FOREIGN_CURRENCIES = ['EUR', 'USD']`; `SUPPLIER_CAISSES = ['alcool', 'cigares']`; `PURCHASE_KIND_LABEL = { achat: 'Achat', report: 'Solde reporté' }`; `formatForeign(minor, currency) -> string` (« 1 250 € », « 980,50 $ »: French grouping, decimals only when cents ≠ 0, `€` for EUR, `$` for USD).
- Produces (worker/suppliers.js, `supplierMethods`, `this` = Club):
  - `supplierDTO(row) -> { id, name, account, account_label, country, currency, contact, notes, active, due, last_date, has_operations }` (`account_label` from `CAISSE_LABEL`).
  - `listSuppliers() -> { suppliers: SupplierDTO[], totals: { alcool: number, cigares: number } }` — active first, then by name; totals = sum of `due` per caisse.
  - `supplierDue(supplierId) -> number`.
  - `createSupplier(actor, input) -> SupplierDTO`; `updateSupplier(actor, id, input) -> SupplierDTO` (fields `name`, `account`, `country`, `currency`, `contact`, `notes`, `active`).
  - `supplierSheet(id) -> { supplier: SupplierDTO, lines: Line[], totals: { purchases, paid, due } }`, `Line = { key, date, kind: 'report'|'achat'|'paiement', kind_label, label, reference, method, due, paid, foreign_amount, foreign_currency, status, cancel_reason, cancelled_by_name, created_by_name, balance, purchase_id, entry_id }` — merged purchases and payments, ordered by `date` then `created_at`; `balance` is the running due after the line, `null` on a cancelled line; `due`/`paid` are 0 when not applicable.
  - `recordSupplierPurchase(actor, supplierId, input) -> SupplierSheet` (input `kind`, `biz_date`, `amount`, `foreign_amount`, `foreign_currency`, `reference`, `label`).
  - `cancelSupplierPurchase(actor, purchaseId, input) -> SupplierSheet` (input `reason`, 3–300 chars).
- Routes (all `CLUB`): `GET /api/suppliers`, `POST /api/suppliers`, `PUT /api/suppliers/:id`, `GET /api/suppliers/:id`, `POST /api/suppliers/:id/purchases`, `POST /api/suppliers/purchases/:id/cancel`.

- [ ] **Step 1: Write the failing tests** in `test/suppliers.test.js` (harness: `Server`, `Client`, `ok`, `UM`; users admin, `cig` associé cigares, `cha` associé alcool, `ger` gérant, as in `test/caisses-retrait.test.js`):
  - `création : l’administrateur et les associés créent un fournisseur, pas le gérant` — `POST /api/suppliers {name:'Casa Habanos', account:'cigares', country:'Espagne', currency:'EUR'}` by `cha` → 200, `account_label === 'Cigare'`, `due === 0`; by `ger` → 403; same name in another case → 409 `FOURNISSEUR_EXISTANT`; `account:'reservations'` → 400.
  - `un achat à crédit ne bouge ni les caisses ni le solde en caisse` — snapshot `GET /api/caisses`; `POST /api/suppliers/:id/purchases {kind:'report', amount: 300000*UM}` then `{kind:'achat', amount: 200000*UM, foreign_amount: 30500, foreign_currency:'EUR', reference:'F-12'}`; `GET /api/caisses` deep-equals the snapshot; sheet `totals.due === 500000*UM`; lines `[report, achat]` with balances `300000*UM, 500000*UM`; the achat line keeps `foreign_amount 30500`, `foreign_currency 'EUR'`, `reference 'F-12'`.
  - `le montant en devise va avec sa devise` — `foreign_amount` without `foreign_currency` → 400; `foreign_currency:'GBP'` → 400.
  - `achat : date future refusée, mois clôturé refusé, jour fermé accepté` — `biz_date` tomorrow → 400; insert a `closed_periods` row for last month (via `server.club.run`) and date the purchase there → 409 `PERIODE_CLOTUREE`; insert a `day_closings` row for today → purchase today → 200 (delete both rows afterwards).
  - `annuler un achat` — cancel the 200 000 achat → due 300 000, line `status 'annulee'`, `balance null`, `cancel_reason` kept; second cancel → 409 `DEJA_ANNULEE`; reason shorter than 3 chars → 400.
  - `la caisse d’un fournisseur ne change plus après une opération ; désactivation seulement à zéro` — `PUT {account:'alcool'}` with operations → 409 `CAISSE_VERROUILLEE`; `PUT {active:false}` with due > 0 → 409 `DETTE_EN_COURS`; purchase on an inactive supplier (created without operations, then deactivated) → 409 `FOURNISSEUR_INACTIF`.
  - `liste : ce que le club doit, par caisse` — `GET /api/suppliers` → `totals.cigares` equals the sum of the cigar suppliers' dues, `totals.alcool` likewise; `GET /api/suppliers` by `ger` → 403.
  - `les fournisseurs sont au journal des opérations` — `audit_log` rows with actions `fournisseur.creer`, `fournisseur.modifier`, `fournisseur.achat`, `fournisseur.achat_annuler`, each with the actor's user id.

- [ ] **Step 2: Run them to see them fail**

Run: `node --test test/suppliers.test.js`
Expected: FAIL (404 on `/api/suppliers`).

- [ ] **Step 3: Add `V22` to `worker/schema.js`**

```sql
CREATE TABLE suppliers (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL UNIQUE COLLATE NOCASE,
  account TEXT NOT NULL CHECK (account IN ('alcool', 'cigares')),
  country TEXT, currency TEXT CHECK (currency IS NULL OR currency IN ('EUR', 'USD')),
  contact TEXT, notes TEXT,
  active INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0, 1)),
  is_demo INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL, created_by INTEGER REFERENCES users(id),
  updated_at TEXT, updated_by INTEGER REFERENCES users(id)
);
CREATE TABLE supplier_purchases (
  id INTEGER PRIMARY KEY,
  supplier_id INTEGER NOT NULL REFERENCES suppliers(id),
  kind TEXT NOT NULL CHECK (kind IN ('achat', 'report')),
  biz_date TEXT NOT NULL,
  amount INTEGER NOT NULL CHECK (amount > 0),
  foreign_amount INTEGER CHECK (foreign_amount IS NULL OR foreign_amount > 0),
  foreign_currency TEXT CHECK (foreign_currency IS NULL OR foreign_currency IN ('EUR', 'USD')),
  reference TEXT, label TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'annulee')),
  is_demo INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL, created_by INTEGER REFERENCES users(id),
  cancelled_at TEXT, cancelled_by INTEGER REFERENCES users(id), cancel_reason TEXT,
  CHECK ((foreign_amount IS NULL) = (foreign_currency IS NULL))
);
CREATE INDEX supplier_purchases_supplier ON supplier_purchases(supplier_id);
ALTER TABLE ledger_entries ADD COLUMN supplier_id INTEGER REFERENCES suppliers(id);
ALTER TABLE ledger_entries ADD COLUMN foreign_amount INTEGER;
ALTER TABLE ledger_entries ADD COLUMN foreign_currency TEXT;
CREATE INDEX ledger_entries_supplier ON ledger_entries(supplier_id);
```

One array entry per statement, with a comment block in the file's style (why, what, and the V22 renumbering note).

- [ ] **Step 4: Implement `shared/suppliers.js` and `worker/suppliers.js`, wire them in `club.js` and `api.js`**

Validation (French messages): name 1–80 chars, required; country ≤ 60; contact ≤ 120; notes ≤ 300; label ≤ 120 (default `PURCHASE_KIND_LABEL[kind]`); reference ≤ 80; amount `int(…, 'Montant', {min:1, max:1e13})`; foreign amount `int(…, 'Montant en devise', {min:1, max:1e13})`. Closed month: a local check on `closed_periods` only (not `day_closings`), code `PERIODE_CLOTUREE`, message in the style of `assertOpen`. Purchase cancel refused when `supplierDue − amount < 0`, code `PAIEMENTS_SUPERIEURS`, message « Le club a déjà payé à « X » plus que ce qui resterait dû : annulez d’abord un paiement (Caisse, bloc Dépenses). ». Audit details with French keys (`nom`, `caisse`, `montant`, `devise`, `montant_devise`, `date`, `motif`), as `caisses.js` does.

- [ ] **Step 5: Run the tests**

Run: `node --test test/suppliers.test.js` then `npm test`
Expected: all PASS (the full suite too: migration and wipe order).

- [ ] **Step 6: Commit (after the user's yes)**

```bash
git add worker/schema.js shared/suppliers.js worker/suppliers.js worker/club.js worker/api.js test/suppliers.test.js
git commit -m "Fournisseurs : fiches, achats à crédit, soldes reportés et relevé"
```

### Task 2: Paying a supplier (server)

**Files:**
- Modify: `worker/ledger.js` (`createEntry`, `entryDTO`, `entryRows`)
- Modify: `worker/suppliers.js` (`supplierPayment(actor, input, category, kind) -> { supplier, foreign_amount, foreign_currency } | null`)
- Test: `test/suppliers.test.js` (new tests in the same file)

**Interfaces:**
- Consumes: `supplierDue`, `supplierSheet` (Task 1).
- Produces: `POST /api/ledger/entries` accepts `supplier_id`, `foreign_amount`, `foreign_currency`; `entryDTO` adds `supplier_id`, `supplier_name`, `foreign_amount`, `foreign_currency`. Default label with a supplier: `Paiement — ${supplier.name}`. Audit `operation.creer` adds `fournisseur: name`.

- [ ] **Step 1: Write the failing tests**
  - `payer en partie : la dette et la caisse du fournisseur baissent ensemble` — a cigar supplier owes 500 000; `fundCaisse(admin, 'cigares', 1000000*UM)`; `POST /api/ledger/entries {kind:'depense', category_id: <achat_cigares>, supplier_id, amount: 200000*UM, method:'Espèces', foreign_amount: 30000, foreign_currency:'EUR'}` by `cha` (the other associé: allowed) → entry `supplier_name 'Casa Habanos'`, `label 'Paiement — Casa Habanos'`, `account 'cigares'`; sheet due 300 000, last line `kind 'paiement'`, `paid 200000*UM`, `method 'Espèces'`, foreign kept; `GET /api/caisses` → `cigares.purchases` up by 200 000, `cigares.balance` down by 200 000, tiles still add up to `till`.
  - `jamais plus que ce que le club doit` — amount 300 001 FCFA → 409 `DEPASSE_DU`, no entry inserted.
  - `jamais plus que ce que contient la caisse` — a supplier owing 5 000 000 while the caisse holds less → 409 `CAISSE_INSUFFISANTE`.
  - `seulement depuis la caisse du fournisseur` — cigar supplier with `achat_champagne` → 400; with `Loyer` → 400; `kind:'recette'` with `supplier_id` → 400.
  - `le gérant ne paie pas un fournisseur suivi` — `ger` with `supplier_id`, 4 000 FCFA → 403.
  - `annuler un paiement rend la dette ; annuler un achat dépassé par les paiements est refusé` — owes 500 000 (report 300 000 + achat 200 000), paid 400 000: cancelling the achat → 409 `PAIEMENTS_SUPERIEURS`; `POST /api/ledger/entries/:id/cancel {reason:'Erreur de saisie'}` on a payment → due back up, line `status 'annulee'`, `balance null`; then the achat cancel succeeds.
  - `devise sans fournisseur refusée` — `foreign_amount` on an expense without `supplier_id` → 400.

- [ ] **Step 2: Run them to see them fail**

Run: `node --test test/suppliers.test.js`
Expected: the new tests FAIL.

- [ ] **Step 3: Implement** — in `createEntry`, once the category and caisse are known and before `assertCaisseCovers`, call `this.supplierPayment(actor, input, category, kind)`. It returns null when `input.supplier_id` is empty and no foreign field is given; otherwise it checks in this order: boss (403 « Seuls l’administrateur et les associés paient un fournisseur suivi. »), kind `depense`, supplier exists (404), `purchaseAccount(category.code) === supplier.account` (400 « « X » est payé depuis la caisse « Y » : choisissez une catégorie d’achat de cette caisse. »), foreign pair valid, `amount <= supplierDue` (409 `DEPASSE_DU`, the message gives the due). The entry is inserted with `supplier_id`, `foreign_amount`, `foreign_currency`. `entryRows` LEFT JOINs `suppliers` for `supplier_name`.

- [ ] **Step 4: Run the tests**

Run: `node --test test/suppliers.test.js` then `npm test`
Expected: all PASS.

- [ ] **Step 5: Commit (after the user's yes)**

```bash
git add worker/ledger.js worker/suppliers.js test/suppliers.test.js
git commit -m "Fournisseurs : paiement entier ou partiel, depuis la caisse du fournisseur seulement"
```

### Task 3: Demo data

**Files:**
- Modify: `worker/seed.js` (after the expenses, before the profit taking)
- Test: `test/caisses-balances.test.js` (one new test, next to the other fictitious-data test)

**Interfaces:**
- Consumes: `createSupplier`, `recordSupplierPurchase`, `createEntry` with `supplier_id`.

- [ ] **Step 1: Write the failing test** `le jeu de démo a deux fournisseurs, dont un payé en partie` — after the demo data set is loaded (as the file's existing tests do), `GET /api/suppliers` → 2 suppliers, one `cigares` with `currency 'EUR'`, one `alcool` with `currency 'USD'`; at least one sheet has a `paiement` line and `due > 0`; the caisses tiles still add up to `till`.
- [ ] **Step 2: Run it** — `node --test test/caisses-balances.test.js`, expected FAIL.
- [ ] **Step 3: Implement** — « Maison Corona (démo) », Cigare, « Espagne », EUR: report 60 days ago 450 000 FCFA (685 €), achat 20 days ago 300 000 FCFA (457 €, « FAC-2026-118 »), payment 10 days ago 150 000 FCFA (228 €) by Virement with `achat_cigares`. « Beyrouth Boissons (démo) », Champagne et autres boissons, « Liban », USD: achat 25 days ago 520 000 FCFA (865 $), no payment. The payment must fit the demo Cigare caisse at its date (raise the demo cigar apport if needed); rows flagged `is_demo = 1`.
- [ ] **Step 4: Run** `npm test`, expected all PASS.
- [ ] **Step 5: Commit (after the user's yes)** — `git commit -m "Fournisseurs : deux fournisseurs fictifs dans la démo"`.

### Task 4: Interface

**Files:**
- Modify: `src/components/layout/AppShell.jsx` (`NAV` item `{ path: '/fournisseurs', label: 'Fournisseurs', short: 'Fournisseurs', icon: 'truck', boss: true }` right after Caisse; both menu filters also drop `boss` items unless `isBoss(me)`)
- Modify: `src/components/ui/Icon.jsx` (lucide `Truck` as `truck`)
- Create: `src/pages/Suppliers.jsx` (list + totals + « Nouveau fournisseur »)
- Create: `src/pages/Supplier.jsx` (sheet: header, « Le club doit », buttons « Enregistrer un achat », « Payer », « Modifier », statement table, cancel buttons)
- Create: `src/components/suppliers/SupplierDialog.jsx` (create/edit), `src/components/suppliers/PurchaseDialog.jsx` (achat / solde reporté), `src/components/suppliers/CancelPurchaseDialog.jsx` (reason)
- Modify: `src/components/cash/EntryDialog.jsx` (prop `supplierId`; supplier select when the category is a purchase and the user is a boss; foreign amount + currency when a supplier is chosen; categories limited to the supplier's caisse when `supplierId` is given)
- Modify: `src/components/cash/ExpensesBlock.jsx` (show `supplier_name` and the foreign amount in parentheses on a supplier payment)
- Modify: `src/App.jsx` (routes `fournisseurs`, `fournisseurs/:id`, both `BossOnly`)
- Modify: `src/lib/audit.js` (labels and summaries of the four `fournisseur.*` actions)
- Modify: `README.md` (one paragraph on supplier accounts, next to the caisses)

**Interfaces:**
- Consumes: the routes of Tasks 1–2; `formatForeign`, `PURCHASE_KIND_LABEL`, `FOREIGN_CURRENCIES` from `shared/suppliers.js`; `CAISSE_LABEL`, `caisseMoneyLine` from `shared/caisses.js`; the existing `Modal`, `openDialog`, `useLoad`, `useSubmit`, `api`, `newKey`, `parseMoney`, `money`, `toast`, `PageHead`, `Loaded`.

- [ ] **Step 1: Build the pages and dialogs** — statement columns exactly « Date », « Opération », « Dû », « Réglé », « Solde »; the foreign amount shown as `(${formatForeign(...)})` after the FCFA amount; cancelled lines struck through with « Annulé : motif ». The sheet's « Payer » opens `EntryDialog` with `kind 'depense'`, `categoryCode` `achat_cigares` (Cigare) or `achat_champagne` (Boissons), `supplierId`, title « Payer un fournisseur ». A payment line's cancel button uses the existing entry-cancel call (`POST /api/ledger/entries/:id/cancel`). Supplier select option text: `Nom — doit 450 000 FCFA`; first option « Aucun : achat payé comptant ». Help under the amount when a supplier is chosen: « Au plus X (ce que le club lui doit). »
- [ ] **Step 2: Build** — `npm run build`, expected no error.
- [ ] **Step 3: Check in the browser** (`.claude/launch.json`, server `club-cloudflare-local`): demo data set loaded; menu entry « Fournisseurs » (truck icon, under « Caisse », absent for the gérant) lists both demo suppliers with totals; « Maison Corona (démo) » statement balances read 450 000 → 750 000 → 600 000; record an achat with a EUR amount; pay part of it from the sheet; a payment above the due is refused with its message; cancel the payment from the cash page; the tile's « Payer un fournisseur » shows the supplier select; phone width (375 px): the table scrolls inside its card, no amount wraps.
- [ ] **Step 4: Run** `npm test`, expected all PASS.
- [ ] **Step 5: Commit (after the user's yes)** — `git commit -m "Fournisseurs : onglet, fiche avec relevé, choix du fournisseur au paiement"`.
