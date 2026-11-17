# Dette reprise et reprise Digibox — plan de construction

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** a regular client can carry a debt from before the app (« Dette reprise »), paid by the usual settlement; a
temporary import door and a script load the Digibox clients, their debts and the two suppliers automatically.

**Architecture:** a dette reprise is a `charges` row flagged `carryover = 1` (no shop sale, no product, kind
`produit`), so the existing settlement, caisses, tickets and refunds handle its money unchanged; every « sale » reader
(billed lines, finance summary, purchase history, open notes) leaves it out. The import door mirrors the catalogue
door (`IMPORT_TOKEN`, no session, actor `null`), one call for the whole file, with a `dry_run` that writes nothing.

**Tech Stack:** Cloudflare Worker + Durable Object SQLite (`worker/`), React (`src/`), `node --test` (`test/`).

**Spec:** `docs/superpowers/specs/2026-11-17-dette-reprise-design.md`

## Global Constraints

- Money is stored in hundredths (`UM = 100` in `test/harness.js`); the import file is in whole FCFA.
- Migration is **V29**, added after V28 in `worker/schema.js`, `ALTER TABLE ... ADD COLUMN` only (no table rebuild).
- Only the administrator and the associés (`isBoss`) add or cancel a dette reprise; the gérant gets 403.
- Copy (French, verbatim): button « Dette reprise » ; statement line label = the stored label, which is
  `Dette reprise — <note>` ; cancelled line « Dette reprise annulée ».
- The real client list never enters the repository (public): tests use made-up names; the data lives in
  `reprise-digibox.local` (git-ignored).
- Members keep first name and phone required; only `kind = 'client'` files may leave them empty.
- A dette reprise is dated the day it is entered (no date field: the note says where it comes from) **(builder's
  call, simplifies spec item 1)**.

## Review Focus

1. A settlement larger than the reprise alone, on a client with a reprise and a later credit sale: the reprise is paid
   first, the rest goes on the sale, each part in its own caisse (Task 2 test).
2. Cancelling a settlement that paid a reprise: the debt comes back, the caisse gives the money back, no stock moves
   (Task 2 test).
3. A client without phone asked for a client-space access: clear refusal, not a WhatsApp error (Task 4 test).
4. Running the import twice: nothing doubles; a client who already owes in the app gets no reprise and is reported
   (Task 6 test).
5. The day a reprise is entered: « facturé », recette by category, Caisse › Boutique and the open notes do not move
   (Task 3 test).

---

### Task 1: V29 and the dette reprise itself

**Files:**
- Modify: `worker/schema.js` (add `V29`, register it like V28)
- Modify: `worker/credit.js` (owed, due lines, add, cancel, account statement)
- Modify: `worker/api.js` (two routes next to `/api/clients/:id/settlements`)
- Test: `test/dette-reprise.test.js` (new; same setup as `test/credit-clients.test.js`)

**Interfaces:**
- Produces: column `charges.carryover INTEGER NOT NULL DEFAULT 0 CHECK (carryover IN (0, 1))`.
- Produces: `addCarryover(actor, id, input) -> clientAccount` with `input = { amount (hundredths, ≥1), account
  ('cigares'|'alcool'), note (text, required, max 120) }`; route `POST /api/clients/:id/carryovers`.
- Produces: `cancelCarryover(actor, chargeId, input) -> clientAccount` with `input = { reason (required) }`; route
  `POST /api/clients/carryovers/:id/cancel`.
- Produces: statement moves `kind: 'reprise'` (`due = amount`, carries `charge_id`, `status`, `settled`) and
  `kind: 'annulation_reprise'` (`paid = amount`, `detail = cancel_reason`).

- [ ] **Step 1: Write the failing tests** in `test/dette-reprise.test.js`:
  - `dette reprise : seuls l'administrateur et les associés l'ajoutent` — gérant 403; associé OK; the returned account
    has `owed === 150000 * UM` and one move `{ kind: 'reprise', label: 'Dette reprise — Reprise Digibox', due: 150000 * UM }`;
    audit row `client.dette_reprise` exists; `credit_limit` stays 0.
  - `dette reprise : refus` — amount 0 → 400; account `'reservations'` → 400; note missing → 400; a member (not a client)
    → 409 `PAS_CLIENT`; an inactive client → 409.
  - `dette reprise : annulation` — cancel by gérant 403; cancel without reason 400; cancel by admin → `owed === 0`, a
    move `annulation_reprise` with `paid = amount`, audit `client.dette_reprise_annulee`; cancelling again → 409.
- [ ] **Step 2: Run** `node --test test/dette-reprise.test.js` — expect FAIL (404 on the route).
- [ ] **Step 3: Implement.** V29 adds the column. In `worker/credit.js`: `DUE_CREDIT_LINES` and `creditOwed` read
  `charges c LEFT JOIN shop_sales s ...` with `(s.on_credit = 1 OR c.carryover = 1)`, and `DUE_CREDIT_LINES` orders
  `c.carryover DESC, c.created_at, c.id` (the old debt is paid first); `isCreditLine` is true for `c.carryover`.
  `addCarryover`: `isBoss` else 403 « Seuls l’administrateur et les associés ajoutent une dette reprise. »,
  `clientRow`, `assertMemberActive`, insert the charge (`kind 'produit'`, `product_id NULL`, `quantity 1`,
  `unit_price = amount`, `status 'due'`, `carryover 1`, label `Dette reprise — ${note}`, `created_by actor?.id ?? null`),
  audit `client.dette_reprise` `{ nom, montant, caisse, note }`. `cancelCarryover`: boss only; the row must be
  `carryover = 1`, `status 'due'`, `settled = 0`, else 409 `DEJA_REGLEE` « Une partie de cette dette est déjà réglée :
  annulez d’abord le règlement. » (or `DEJA_ANNULEE`); set `annulee` + cancelled_*; audit
  `client.dette_reprise_annulee`. `clientAccount` adds the two move kinds (order 0 for the reprise, 2 for its
  cancellation), by-name from `users`.
- [ ] **Step 4: Run** `node --test test/dette-reprise.test.js test/credit-clients.test.js test/credit-v21.test.js` — PASS.
- [ ] **Step 5: Commit** `feat: dette reprise d'un client régulier (V29, ajout, annulation, relevé)`.

### Task 2: settling a dette reprise

**Files:**
- Test: `test/dette-reprise.test.js`
- Modify (only if a test fails): `worker/credit.js` (`recordSettlement`, settlement cancellation)

**Interfaces:**
- Consumes: Task 1 routes; existing `POST /api/clients/:id/settlements` `{ amount, method }`, its cancel route, and
  `GET /api/caisses`.

- [ ] **Step 1: Write the failing tests:**
  - `règlement : la dette reprise est payée en premier, chaque part dans sa caisse` — client with limit, a credit sale
    of champagne (20 000) made **before** a cigar reprise (50 000); settle 60 000 → reprise `settled = amount`
    (status `payee`), the sale has 10 000 settled; caisse Cigare +50 000, Champagne +10 000; the central rule holds
    (`centralRule` helper of the credit tests); the settlement ticket's lines include `Dette reprise — …`.
  - `règlement annulé : la dette reprise redevient due` — cancel that settlement → `owed` back to 70 000, caisse Cigare
    −50 000, stock of the champagne product unchanged; cancelling the reprise is now allowed again.
  - `plafond : la dette reprise compte` — limit 60 000, reprise 50 000 → a credit sale of 20 000 refused 409
    `PLAFOND_CREDIT`.
- [ ] **Step 2: Run** `node --test test/dette-reprise.test.js` — expect the new tests to FAIL or PASS; fix only real
  failures (the settlement code should already work through `DUE_CREDIT_LINES`).
- [ ] **Step 3: Run** `npm test` — PASS.
- [ ] **Step 4: Commit** `test: règlement d'une dette reprise`.

### Task 3: a dette reprise is not a sale

**Files:**
- Modify: `worker/billed.js` (`billedLines`: `AND c.carryover = 0`)
- Modify: `worker/club.js` (`NOT_CREDIT_SQL` becomes `(c.carryover = 0 AND NOT EXISTS (...))`; the finance summary
  billed query near the `SUM(c.amount - c.settled) AS left_due` group adds `AND c.carryover = 0`; any export reading
  `charges` by `created_at` adds it too)
- Modify: `worker/shop.js` (`purchaseHistory`: `AND c.carryover = 0`)
- Test: `test/dette-reprise.test.js`

- [ ] **Step 1: Write the failing test** `la dette reprise n'est pas une vente du jour` — snapshot before/after adding a
  reprise of 80 000: billed columns (the route `test/finance.test.js` uses for billed lines) unchanged; finance summary
  billed totals unchanged; the client's purchase history has no line; dashboard open-notes `due` unchanged while the
  dashboard « Créances clients » total grows by 80 000; the clients list shows `owed = 80 000`.
- [ ] **Step 2: Run** — FAIL. **Step 3: Implement** the filters above. **Step 4: Run** `npm test` — PASS.
- [ ] **Step 5: Commit** `fix: la dette reprise reste hors des ventes et de la recette`.

### Task 4: client file without first name or phone

**Files:**
- Modify: `worker/club.js` (`memberFields(input, current, { client = false } = {})`: for a client, `first_name` and
  `phone` may be empty — stored as `''`; the phone pattern is checked only when not empty)
- Modify: `worker/shop.js` (`createClient` and the client update pass `{ client: true }`)
- Modify: the client-access creation (`worker/clientAccess.js` / its API) — no phone → 409 `SANS_TELEPHONE`
  « Ajoutez d’abord un téléphone sur la fiche : le code d’accès est envoyé par WhatsApp. »
- Modify: `src/dialogs/clientDialogs.jsx`, `src/components/shop/BuyerPicker.jsx` (no `required` on Prénom and
  Téléphone for a client; label « Prénom (facultatif) », « Téléphone (facultatif) »)
- Test: `test/clients.test.js`

- [ ] **Step 1: Write the failing tests:** `client sans prénom ni téléphone` — `POST /api/clients { last_name: 'société test' }`
  → 200, `last_name 'SOCIÉTÉ TEST'`, `first_name ''`, `phone ''`; a member without phone still 400; a client with phone
  `'abc'` still 400; client access for the phoneless client → 409 `SANS_TELEPHONE`.
- [ ] **Step 2: Run** — FAIL. **Step 3: Implement.** **Step 4: Run** `npm test` — PASS.
- [ ] **Step 5: Commit** `feat: fiche client sans prénom ni téléphone`.

### Task 5: screens — button, dialog, statement, client space

**Files:**
- Modify: `src/components/members/ClientAccount.jsx` (button « Dette reprise » for bosses; render `reprise` and
  `annulation_reprise` moves; « Annuler » on a `reprise` move with `status 'due'` and `settled 0`, bosses only)
- Modify: `src/dialogs/creditDialogs.jsx` (`CarryoverDialog`: montant FCFA, caisse Cigare / Champagne et autres
  boissons — default the associé's rayon, else Cigare —, note required; `CancelCarryoverDialog`: motif required)
- Modify: `worker/clientView.js` (`clientHistory`: one item per carryover charge in the period, kind `'reprise'`,
  label = stored label, status from `CHARGE_STATUS`, ticket of the latest standing payment) and
  `src/client/pages/ClientHistory.jsx` if it needs the kind
- Test: `test/client-view.test.js` (`le client voit sa dette reprise « à régler »`)

- [ ] **Step 1: Write the failing client-view test**, run it (FAIL), implement `clientHistory`, run it (PASS).
- [ ] **Step 2: Build the screens**; `npm run build` passes.
- [ ] **Step 3: Check in the browser** (local server, test data): as associé add a reprise of 50 000, see « Doit »,
  the statement line, settle 20 000, see the balance; as gérant no button. Screenshot.
- [ ] **Step 4: Commit** `feat: écran Dette reprise sur la fiche client`.

### Task 6: the import door

**Files:**
- Create: `worker/importAccounts.js` (mixed into Club like `credit.js`)
- Modify: `worker/club.js` (mix it in), `worker/api.js` (route next to the catalogue door)
- Test: `test/import-accounts.test.js`

**Interfaces:**
- Produces: `POST /api/admin/accounts-import` (`public: true`, `guard: checkImportToken`), body
  `{ dry_run: boolean, clients: [{ first_name?, last_name, phone?, notes?, debt? }], suppliers: [{ name, account,
  country?, currency?, contact?, carried_over }] }`, amounts in whole FCFA; answer
  `{ dry_run, clients: [{ name, action, member_no?, debt }], suppliers: [{ name, action, carried_over }], total_debt }`
  with `action` ∈ `'creer'`, `'creer_avec_dette'`, `'existe'`, `'existe_dette_ajoutee'`, `'conflit_doit_deja'`,
  `'conflit_membre'`, `'conflit_operations'`, `'deja_repris'`.
- Rules: a client is matched among non-demo `members` by lower-cased, NFC, trimmed `first_name + ' ' + last_name`
  after the same formatting the app applies; a `kind = 'membre'` match → `conflit_membre` (nothing written); an
  existing client with a standing carryover → `deja_repris`; with `creditOwed > 0` → `conflit_doit_deja`. A supplier
  matched by name (NOCASE) with any purchase or payment → `conflit_operations`. New rows use the normal create code
  with actor `null`; reprise note « Reprise Digibox », supplier label « Solde Digibox », both dated the business day,
  caisse from the file (`cigares`). `dry_run: true` computes the same answer and writes nothing. Audit
  `import.digibox` with the counts.

- [ ] **Step 1: Write the failing tests** (made-up names): no `IMPORT_TOKEN` → 503; wrong code → 403; dry run returns
  the plan and the DB is unchanged; real run creates 3 clients (one without phone), 2 reprises, 1 supplier with its
  `report`; a second run answers `existe`/`deja_repris` and changes nothing; a pre-existing client with a credit sale →
  `conflit_doit_deja` and no reprise; a member of the same name → `conflit_membre`.
- [ ] **Step 2: Run** — FAIL. **Step 3: Implement.** **Step 4: Run** `npm test` — PASS.
- [ ] **Step 5: Commit** `feat: porte d'import des comptes Digibox`.

### Task 7: the import script

**Files:**
- Create: `scripts/import-reprise.mjs`; add `"import:reprise": "node scripts/import-reprise.mjs"` to `package.json`
- Test: `test/import-reprise.test.js`

**Interfaces:**
- `node scripts/import-reprise.mjs --data <file>` — checks the file (every client has a `last_name`, debts are
  positive integers, the sum of debts equals `expected_total_clients`), prints the list and totals, sends nothing.
- `... --url <site> --dry-run` — asks the door's dry run and prints its plan, conflicts first.
- `... --url <site> --send` — sends for real, prints the answer; exit code 1 on any conflict or error.
- The code comes from the `IMPORT_TOKEN` variable or `--token-file`, never the command line, never printed (same rule
  as `scripts/import-catalogue.mjs`).

- [ ] **Step 1: Write the failing tests** with a made-up file: a wrong total is refused before sending; `--dry-run`
  against a test `Server` prints the plan; `--send` imports.
- [ ] **Step 2: Run** — FAIL. **Step 3: Implement.** **Step 4: Run** `npm test` — PASS.
- [ ] **Step 5: Commit** `feat: script d'import des comptes Digibox`.

### Task 8: rehearsal on a local copy

- [ ] Start the app locally (`npm run start`, `IMPORT_TOKEN` in `.dev.vars`, git-ignored), create the first admin.
- [ ] `node scripts/import-reprise.mjs --data reprise-digibox.local` → the counts and the total match the owner's list (`expected_total_clients`).
- [ ] `--dry-run` then `--send` against `http://localhost:8787`; open the clients list: the « créances » total equals the file's total;
  open Fournisseurs: both suppliers in caisse Cigare with their balances. Run `--send` again: nothing changes.
- [ ] Remove the local `.dev.vars` token.

Going live (PR, merge, deploy, the live `IMPORT_TOKEN` secret, the live dry run, the live import, deleting the secret)
is done with the user's yes at each step, outside this plan.
