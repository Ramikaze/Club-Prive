# Carte de débit — plan de construction

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal :** chaque membre a un crédit CFA rechargé à la caisse, qui paie ses notes, ses réservations de salle, ses
repas commandés dehors et le renouvellement automatique de son abonnement, avec un ticket signé à chaque mouvement ;
la fiche membre montre une carte 3D et, en dessous, la barre crédit temps et la barre crédit CFA.

**Architecture :** le solde est la somme d'une table `wallet_movements` (une ligne par mouvement, jamais modifiée).
Une recharge et un repas extérieur sont des lignes `payments` d'un nouveau type (`payments.kind`), ce qui leur donne
le ticket de caisse existant et les fait entrer dans la trésorerie sans nouvelle requête ; la part payée par la
carte d'un encaissement est `payments.card_amount`, retirée des entrées d'argent. Les réservations peuvent exister
sans abonnement (`reservations.subscription_id` devient facultatif). Le renouvellement automatique est une méthode
du club appelée par une tâche planifiée Cloudflare, après chaque recharge et à l'ouverture de l'Accueil.

**Tech Stack :** Cloudflare Worker + Durable Object SQLite (worker/), React 18 + react-router 6 `HashRouter` +
zustand (src/), tests `node --test` (Node ≥ 24) avec `test/harness.js`.

**Spec :** `docs/superpowers/specs/2026-10-24-carte-debit-design.md` (le lire en entier avant chaque tâche).

**Branche :** partir de `main` (qui contient le ticket de caisse, PR #9). L'ancienne branche locale
`feat/carte-debit` (7744f4d, déjà contenue dans `main`) est à recréer depuis `main` avec l'accord de l'utilisateur.

## Global Constraints

- Montants stockés en centièmes (`UM = 100` dans les tests), entiers, affichés avec `money()` côté front.
- Le crédit CFA ne descend **jamais sous 0** ; il n'est **jamais remboursé en espèces** ni **expiré**.
- Rien n'est effacé ni modifié : une annulation est un mouvement inverse avec motif et auteur, journalisé.
- Annuler une recharge : **administrateur seulement**, motif obligatoire (3 à 300 caractères).
- Moyen de paiement réservé : `CARD_METHOD = 'Carte membre'` (shared/rules.js) ; il n'est **jamais** dans le
  réglage `payment_methods` et n'est jamais compté comme entrée d'argent en trésorerie.
- Prix du temps de salle payé par la carte = réglage `overtime_tariff` (25 000 FCFA l'heure, 15 000 FCFA la
  demi-heure restante), par `supplementAmount` existant ; tarif non validé → refus (`TARIF_NON_VALIDE`), sauf démo.
- Renouvellement : même formule, prix actuel de la formule ; alerte 3 jours avant l'échéance (`RENEWAL_WARNING_DAYS
  = 3`) ; attente d'une recharge **30 jours** après l'échéance (`RENEWAL_GRACE_DAYS = 30`) ; renouvellement en
  retard daté **du jour de la recharge**.
- Mois clôturés : tout mouvement passe par `assertOpen(this.bizToday(), …)` comme les encaissements.
- Démo : tout marche dans l'espace démo ; WhatsApp montre le message sans rien ouvrir (`DemoMessageDialog`).
- Dépôt public : aucun numéro de téléphone, ni donnée réelle, ni fichier logo du client ailleurs que `public/`.
- Style : commentaires en anglais comme le code existant, textes d'interface en français, actions d'audit
  françaises pointées (`carte.recharger`, `carte.annuler_recharge`, `carte.payer`, `abonnement.renouveler_auto`).
- Ne rien pousser, ne rien mettre en ligne sans l'accord de l'utilisateur ; chaque commit est annoncé à l'utilisateur.

## Review Focus

1. Deux débits qui dépasseraient ensemble le solde (deux onglets) : le second est refusé `SOLDE_INSUFFISANT`, le
   solde reste ≥ 0 (test Task 1 « jamais négatif », vérifié dans la transaction, pas seulement dans l'interface).
2. Recharge annulée après que l'argent a été dépensé : refus clair, rien ne bouge (test Task 1).
3. Carte perdue, désactivée puis remplacée : solde et historique intacts (test Task 1 « le solde suit le membre »).
4. Base existante avec des réservations, crédits et lignes : la migration V15 ne perd ni ne change aucune ligne
   (test Task 1 « migration sans perte »).
5. Renouvellement relancé deux fois le même jour (tâche planifiée + Accueil + recharge) : un seul abonnement, un seul
   débit (test Task 5 « idempotent »).

---

### Task 1 : schéma V15, portefeuille, recharge et annulation, trésorerie

**Files :**
- Modify : `worker/schema.js` (nouveau `V15`, `MIGRATIONS`)
- Modify : `shared/rules.js` (`CARD_METHOD`)
- Modify : `worker/club.js` (`WIPE_ORDER`, `memberDetail`, nouvelles méthodes portefeuille, `paymentDTO`,
  `normalizeSetting` pour `payment_methods`)
- Modify : `worker/ledger.js` (flux de trésorerie ~243 : `amount - card_amount`, annulations de recharge)
- Modify : `worker/api.js` (routes)
- Test : `test/wallet.test.js` (nouveau)

**Interfaces :**
- Produces :
  - `V15` :
    - `wallet_movements (id INTEGER PRIMARY KEY, member_id INTEGER NOT NULL REFERENCES members(id), kind TEXT NOT NULL CHECK (kind IN ('recharge','annulation_recharge','paiement','remboursement')), amount INTEGER NOT NULL CHECK (amount <> 0), payment_id INTEGER REFERENCES payments(id), refund_id INTEGER REFERENCES refunds(id), reason TEXT, created_at TEXT NOT NULL, created_by INTEGER REFERENCES users(id))` + index `(member_id, id)` ; `amount` signé (+ crédit, − débit).
    - `payments` gagne `kind TEXT NOT NULL DEFAULT 'encaissement' CHECK (kind IN ('encaissement','recharge','repas'))`, `card_amount INTEGER NOT NULL DEFAULT 0 CHECK (card_amount >= 0)`, `label TEXT`, `cancelled_at TEXT`, `cancelled_by INTEGER REFERENCES users(id)`, `cancel_reason TEXT`.
    - `refunds` gagne `card_amount INTEGER NOT NULL DEFAULT 0 CHECK (card_amount >= 0)`.
    - `reservations` reconstruite avec `subscription_id INTEGER REFERENCES subscriptions(id)` **sans** `NOT NULL`, toutes colonnes actuelles (dont `room_id`, `party_size`, `deposit_amount`), index et les deux déclencheurs de V4 recréés à l'identique. Méthode : `PRAGMA defer_foreign_keys = ON`, `CREATE TABLE reservations_v15 …`, `INSERT … SELECT`, `DROP TABLE reservations`, `ALTER TABLE reservations_v15 RENAME TO reservations`, puis index et déclencheurs (copier leur texte de V1/V4).
  - `CARD_METHOD = 'Carte membre'` (shared/rules.js)
  - club : `walletBalance(memberId) → number` ; `walletMove(actor, memberId, kind, amount, { paymentId, refundId, reason }) → id` (lève `conflict('SOLDE_INSUFFISANT', …)` si le solde deviendrait < 0) ; `walletDTO(memberId) → { balance, last_recharge: { amount, at } | null, movements: [{ id, kind, amount, balance_after, at, by_name, payment_id, reason }] }` (50 derniers) ; `rechargeWallet(actor, memberId, { amount, method, reference }) → { payment, wallet }` ; `cancelRecharge(actor, paymentId, { reason }) → { wallet }`
  - `memberDetail(id).wallet` = `walletDTO(id)` ; `paymentDTO` gagne `kind`, `card_amount`, `label`, `cancelled_at`, `cancel_reason`
  - routes : `POST /api/members/:id/wallet/recharge` (tout le personnel), `POST /api/payments/:id/cancel-recharge` (ADMIN)
  - `walletLiability(atIso = now) → number` (somme de tous les soldes : ce que le club doit en consommations),
    ajouté aux réponses de la trésorerie (`wallet_liability`) et de la clôture du mois (figé dans son résumé)

- [ ] **Step 1 : tests qui échouent** (`test/wallet.test.js`, admin + gérant + membre comme `test/finance.test.js`) :
  - « recharge » : gérant recharge 100 000 en Espèces → solde 100 000, un `payments` `kind='recharge'` sans ligne
    d'allocation, avec `ticket_code`, audit `carte.recharger` ; montant 0, négatif, non entier → 400 ; moyen
    `Carte membre` ou non configuré → 400 ; membre désactivé → 409.
  - « trésorerie » : la recharge entre dans les flux du jour sur Espèces ; elle n'apparaît **pas** dans les recettes
    (`financeSummary(...).total.collected` inchangé).
  - « annulation » : gérant → 403 ; admin sans motif → 400 ; admin avec motif → solde 0, mouvement
    `annulation_recharge`, sortie d'argent sur Espèces le jour de l'annulation ; seconde annulation → 409.
  - « jamais négatif » : recharge 10 000, `walletMove(…, 'paiement', -6 000)` deux fois → la seconde lève
    `SOLDE_INSUFFISANT`, solde 4 000 ; annuler la recharge alors → 409 `SOLDE_INSUFFISANT`, solde inchangé.
  - « le solde suit le membre » : désactiver la carte, en émettre une nouvelle → même solde, mêmes mouvements.
  - « mois clôturé » : recharge datée dans un mois clôturé → refus de `assertOpen`.
  - « réglage » : `payment_methods` contenant `Carte membre` → 400.
  - « crédits des membres » : deux membres rechargés 100 000 et 30 000, 20 000 dépensés → `wallet_liability`
    110 000 dans la trésorerie ; clôture du mois → la valeur est figée dans le résumé de clôture.
  - « migration sans perte » : base du harness avec réservations, crédits engagés et lignes ; remettre
    `schema_version` à 14 et rouvrir le club → mêmes lignes `reservations` (toutes colonnes), mêmes
    `credit_movements` et `charges` ; une réservation avec `subscription_id = NULL` s'insère ; les déclencheurs de
    chevauchement refusent toujours deux réservations superposées dans la même salle.
  - « effacer toutes les données vide aussi les mouvements de carte ».
- [ ] **Step 2 :** `node --test test/wallet.test.js` → FAIL.
- [ ] **Step 3 :** V15, `CARD_METHOD`, méthodes, routes, `WIPE_ORDER` (`wallet_movements` avant `payments`),
  `ledger.js` : entrées = `SUM(amount - card_amount)` par moyen, en ignorant `CARD_METHOD` ; sorties += recharges
  annulées (`kind='recharge' AND cancelled_at` dans la période, par `method`).
- [ ] **Step 4 :** `node --test test/*.test.js` → tout PASS.
- [ ] **Step 5 :** commit `Carte de débit : portefeuille CFA, recharge et annulation`.

### Task 2 : payer une note avec la carte (mixte) et remboursement vers la carte

**Files :**
- Modify : `worker/club.js` (`recordPayment` ~2121, `refundCharge` ~2165, `financeSummary` ~2649)
- Test : `test/wallet.test.js`

**Interfaces :**
- Consumes : `walletBalance`, `walletMove`, `CARD_METHOD` (Task 1).
- Produces :
  - `recordPayment(actor, { charge_ids, card: true, method?, reference? })` : `card_amount = min(solde, total)` ;
    si `card_amount === total` → `method = CARD_METHOD` (le `method` reçu est ignoré) ; sinon `method` du reste est
    obligatoire et configuré. Un mouvement `paiement` de `-card_amount` lié au `payment_id`. Audit `carte.payer`.
    Sans `card`, comportement actuel inchangé.
  - `refundCharge` : part carte = `min(c.amount, payment.card_amount − parts carte déjà remboursées sur ce paiement)`,
    remise par un mouvement `remboursement` ; le reste par le `method` reçu (obligatoire seulement s'il reste
    quelque chose). `refunds.card_amount` enregistré ; trésorerie sortie = `amount − card_amount`.
  - `financeSummary(...).methods` : la part carte apparaît sous `CARD_METHOD`, le reste sous son moyen.

- [ ] **Step 1 : tests qui échouent** :
  - « tout par la carte » : solde 50 000, deux lignes 20 000 + 10 000 → `method='Carte membre'`, `card_amount`
    30 000, solde 20 000, aucune entrée d'argent en trésorerie, recettes +30 000 sur leurs sous-comptes.
  - « carte puis espèces » : solde 5 000, ligne 20 000, `card:true, method:'Espèces'` → `card_amount` 5 000,
    solde 0, trésorerie Espèces +15 000 ; sans `method` → 400 et rien n'est enregistré.
  - « solde nul » : `card:true` avec solde 0 → tout sur `method`, `card_amount` 0, aucun mouvement.
  - « remboursement » (admin) : ligne payée tout par carte → solde remonte, aucune sortie d'argent ; ligne d'un
    paiement mixte 5 000 carte + 15 000 espèces (deux lignes 10 000) → 1re ligne remboursée : 5 000 sur la carte +
    5 000 Espèces ; 2e : 10 000 Espèces.
- [ ] **Step 2 :** `node --test test/wallet.test.js` → FAIL.
- [ ] **Step 3 :** implémenter dans la transaction existante (solde relu juste avant `walletMove`).
- [ ] **Step 4 :** `node --test test/*.test.js` → PASS.
- [ ] **Step 5 :** commit `Carte de débit : payer une note avec la carte, remboursement vers la carte`.

### Task 3 : réserver la salle en payant avec la carte

**Files :**
- Modify : `worker/club.js` (`verifyMemberRoomAccess` ~1176, `planReservation` ~1401, `quoteReservation` ~1480,
  `createReservation` ~1517, `cancelReservation` ~1874, `extendReservation` ~1729, `reservationDTO`)
- Test : `test/wallet.test.js`

**Interfaces :**
- Consumes : `recordPayment(..., { card: true })` (Task 2), `walletBalance`.
- Produces :
  - `verifyMemberRoomAccess(memberId, bizDay, { requireRemainingCredit, allowWithoutSubscription = false })` :
    sans abonnement et `allowWithoutSubscription` → `{ member, sub: null, credit: null }` (aucune autre règle ne
    change ; les accompagnants gardent l'exigence d'abonnement).
  - entrée `pay_with_card` (booléen) de `quote` / `create` / `extend` :
    - sans abonnement, `pay_with_card` obligatoire (sinon `ABONNEMENT_INVALIDE` actuel), toute la durée payante ;
    - devis : `card_balance`, `card_amount = min(solde, supplément)`, `rest_amount` ;
    - création : lignes de temps payant comme aujourd'hui (acompte + solde si ≥ 3 h, sinon une ligne), puis
      encaissement par la carte de ces lignes dans la même transaction ; si le solde ne couvre pas, la carte paie ce
      qu'elle peut et le reste est payé par `deposit_method` s'il est fourni, sinon le montant non couvert **reste à
      encaisser** : la dernière ligne concernée est découpée en deux lignes libellées « … — payé par carte » et
      « … — reste à encaisser ».
    - `subscription_id` NULL et aucun `creditMove` quand il n'y a pas d'abonnement.
  - annulation : lignes payées par la carte remises sur la carte par le même calcul que `refundCharge` (Task 2),
    audit `carte.rembourser` ; en absence tardive, la ligne d'acompte reste au club (règle actuelle), seule la ligne
    de solde revient sur la carte.
  - prolongation avec `pay_with_card` : la ligne de temps supplémentaire est payée par la carte comme à la création.
  - `reservationDTO` gagne `paid_by_card` (somme des `card_amount` de ses paiements).

- [ ] **Step 1 : tests qui échouent** :
  - « avec abonnement » : 2 h d'abonnement disponibles, réservation 3 h `pay_with_card`, solde 100 000 → 2 h
    engagées, 1 h payée 25 000 par la carte, solde 75 000, aucune ligne due.
  - « sans abonnement » : membre sans formule, solde 100 000, 2 h `pay_with_card` → réservée, `subscription_id`
    NULL, 50 000 débités ; même demande sans `pay_with_card` → 409 `ABONNEMENT_INVALIDE`.
  - « solde insuffisant » : sans abonnement, solde 30 000, 2 h → 30 000 par la carte, une ligne due de 20 000 ;
    avec `deposit_method:'Espèces'` → aucune ligne due, Espèces +20 000.
  - « 3 h ou plus » : sans abonnement, 3 h (75 000), solde 100 000 → acompte et solde payés par la carte ;
    annulation la veille → 75 000 reviennent ; absence le jour → seul le solde (37 500) revient.
  - « tarif non validé » (club réel, sans `lenientTariffs`) → 409 `TARIF_NON_VALIDE`, solde inchangé.
  - « prolongation » : +30 min `pay_with_card` → 15 000 débités.
- [ ] **Step 2 :** `node --test test/wallet.test.js` → FAIL.
- [ ] **Step 3 :** implémenter ; vérifier que les autres usages de `p.sub` / `r.subscription_id`
  (`cancelReservation`, `finishReservation`, `planExtension`, `committedFor`, `reservationDTO`, `cardCreditAtEntry`)
  acceptent NULL.
- [ ] **Step 4 :** `node --test test/*.test.js` → PASS (rooms, gap, rules, scenarios inchangés).
- [ ] **Step 5 :** commit `Carte de débit : réserver la salle en payant avec la carte`.

### Task 4 : repas commandé à l'extérieur

**Files :**
- Modify : `worker/club.js` (nouvelle méthode, catégorie par défaut au `bootstrap`), `worker/api.js`
- Test : `test/wallet.test.js`

**Interfaces :**
- Consumes : `walletMove`, `CARD_METHOD`, catégories de dépense (`ledger_entries`).
- Produces :
  - catégorie de dépense par défaut « Avance repas client » (créée au `bootstrap` si absente, comme les autres).
  - `recordOutsideMeal(actor, memberId, { amount, label, courier_method, rest_method?, reservation_id? }) → { payment, wallet }` :
    dans une transaction : dépense `ledger_entries` de `amount` (catégorie ci-dessus, moyen `courier_method`, libellé
    « Repas extérieur — <label> — <membre> ») ; `payments` `kind='repas'`, `label`, `amount`, `card_amount =
    min(solde, amount)`, `method` = `CARD_METHOD` si tout est couvert, sinon `rest_method` (obligatoire) ; mouvement
    `paiement`. Aucune ligne `charges` (ce n'est pas une recette du club). Audit `carte.repas`.
  - route `POST /api/members/:id/outside-meal`.

- [ ] **Step 1 : tests qui échouent** : « repas couvert » (solde 50 000, repas 18 500 payé au livreur en Espèces →
  Espèces −18 500, solde 31 500, recettes inchangées, ticket présent) ; « repas en partie » (solde 10 000, repas
  18 500, `rest_method:'MTN MoMo'` → MoMo +8 500, Espèces −18 500, solde 0) ; sans `rest_method` dans ce cas → 400
  et rien n'est enregistré ; montant ≤ 0 → 400.
- [ ] **Step 2 :** FAIL. **Step 3 :** implémenter. **Step 4 :** `node --test test/*.test.js` → PASS.
- [ ] **Step 5 :** commit `Carte de débit : repas commandé à l'extérieur payé par la carte`.

### Task 5 : renouvellement automatique et alertes

**Files :**
- Modify : `worker/club.js` (nouvelles méthodes ; `activateSubscription` ~967 réutilisé ; `dashboard` ~2587 ;
  `memberDetail` ; `rechargeWallet`)
- Modify : `worker/api.js` (méthode exposée au Durable Object), `worker/index.js` (`scheduled`, RPC
  `ClubDO.runRenewals()`), `wrangler.jsonc` (`"triggers": { "crons": ["0 5 * * *"] }` : 06:00 à Brazzaville)
- Modify : `shared/rules.js` (`RENEWAL_WARNING_DAYS = 3`, `RENEWAL_GRACE_DAYS = 30`)
- Test : `test/wallet.test.js`

**Interfaces :**
- Consumes : `walletBalance`, `recordPayment(..., { card: true })`, `activateSubscription`.
- Produces :
  - `SYSTEM_ACTOR = { id: null, name: 'Renouvellement automatique', role: 'admin' }` (club.js).
  - `runRenewals(today = this.bizToday(), memberId = null) → { renewed: [subscription_id], blocked: [member_id] }` :
    pour chaque membre actif (ou ce seul membre) dont le dernier abonnement non annulé finit avant `today` (au plus
    `RENEWAL_GRACE_DAYS` jours avant), sans abonnement suivant, et dont la formule est active : si solde ≥ prix →
    `activateSubscription` (même formule ; début = lendemain de la fin si `today` est ce lendemain, sinon `today`)
    puis paiement de la ligne d'abonnement par la carte (`SYSTEM_ACTOR`), audit `abonnement.renouveler_auto` ;
    sinon rien. Idempotent.
  - appelé par : la tâche planifiée, `rechargeWallet` (après le mouvement, pour ce membre), et `dashboard()` en tête.
  - `renewalStatus(memberId, today) → null | { state: 'bientot' | 'bloque', plan_name, price, balance, missing, end_date }` :
    `bientot` si la fin est dans ≤ `RENEWAL_WARNING_DAYS` jours et le solde < prix ; `bloque` si échu depuis
    ≤ `RENEWAL_GRACE_DAYS` jours sans renouvellement. `memberDetail(id).renewal` et, dans `dashboard()`, la liste
    `renewal_alerts: [{ member_id, member_name, phone_ok, ...renewalStatus }]`.

- [ ] **Step 1 : tests qui échouent** (horloge du harness avancée comme dans `test/rules.test.js`) :
  - « à l'heure » : mensuelle 50 000 finissant hier, solde 60 000 → nouvel abonnement du jour, 2 h, solde 10 000,
    ligne d'abonnement payée par la carte, `created_by` NULL.
  - « idempotent » : `runRenewals` trois fois → un seul abonnement, un seul débit.
  - « bloqué puis rechargé » : solde 30 000 → rien ne bouge, `renewalStatus.state='bloque'`, `missing` 20 000 ;
    9 jours plus tard, recharge 20 000 → abonnement du jour de la recharge au mois suivant − 1 jour, solde 0.
  - « délai dépassé » : recharge 31 jours après l'échéance → pas de renouvellement, plus d'alerte.
  - « bientôt » : fin dans 2 jours, solde 0 → `bientot` ; fin dans 4 jours → null.
  - « annulé » : abonnement annulé par l'admin → jamais renouvelé.
  - « formule annuelle » : se renouvelle en annuelle à son prix.
- [ ] **Step 2 :** FAIL. **Step 3 :** implémenter. **Step 4 :** `node --test test/*.test.js` → PASS.
- [ ] **Step 5 :** commit `Carte de débit : renouvellement automatique de l'abonnement et alertes`.

### Task 6 : ticket et messages WhatsApp de la carte

**Files :**
- Create : `shared/wallet.js`
- Modify : `worker/club.js` (`ticketFor`), `src/pages/Ticket.jsx` (`TicketSheet`)
- Test : `test/ticket-format.test.js`, `test/wallet.test.js`

**Interfaces :**
- Consumes : `payments.kind`, `card_amount`, `label` (Task 1), `walletDTO`.
- Produces :
  - `ticketFor(...).ticket` gagne `kind`, `card_amount`, `label`, `wallet_balance_after` (solde juste après ce
    paiement : somme des mouvements jusqu'au sien), `time_available` (crédit temps disponible du membre à
    l'impression, ou null), `signature_required` (`card_amount > 0` ou `kind` ≠ `encaissement`, et `created_by`
    non NULL).
  - `TicketSheet` : recharge → une ligne « Recharge carte membre » ; repas → `label` ; « Payé par carte membre :
    X » puis « Reste payé (moyen) : Y » quand `card_amount > 0` ; « Solde carte : X FCFA » et « Crédit temps : … » ;
    si `signature_required`, cadre « Signature du client » de 2 lignes en bas.
  - `shared/wallet.js` : `rechargeWhatsAppText({ clubName, firstName, amount, balance, at })` et
    `renewalWhatsAppText({ clubName, firstName, planName, endDate, balance, price, state })` (montants formatés par
    `formatMoney`, aucune donnée en dur).
- [ ] **Step 1 : tests** : textes WhatsApp exacts (recharge 100 000 → contient « 100 000 FCFA » et « nouveau solde
  100 000 FCFA ») ; `ticketFor` d'une recharge, d'un paiement mixte, d'un repas, d'un renouvellement automatique
  (`signature_required` false).
- [ ] **Step 2 :** FAIL. **Step 3 :** implémenter. **Step 4 :** `node --test test/*.test.js` → PASS ;
  `npm run build` OK.
- [ ] **Step 5 :** commit `Carte de débit : ticket signé, solde et messages WhatsApp`.

### Task 7 : tuile « Carte » et fenêtres de la fiche membre

**Files :**
- Create : `src/components/ui/MemberCard3D.jsx` (carte recto / verso, inclinaison, reflet), `public/limen-or-noir.jpg`
  (copie de « WhatsApp Image 2026-10-24 at 12.16.18.jpeg » fournie par l'utilisateur dans ~/Downloads)
- Modify : `src/pages/Member.jsx` (tuile qui remplace « Abonnement » et « Cartes »), `src/dialogs/moneyDialogs.jsx`
  (`PaymentDialog` : option carte ; nouvelles `RechargeDialog`, `OutsideMealDialog`, `CancelRechargeDialog`),
  `src/dialogs/reservationDialogs.jsx` (case « Payer avec la carte » et devis), `src/dialogs/index.js`,
  `src/pages/Dashboard.jsx` (alertes de renouvellement + WhatsApp), `src/club.css`
- Test : navigateur (preview locale)

**Interfaces :**
- Consumes : routes Tasks 1–5, `memberDetail(id).wallet` / `.renewal`, `dashboard().renewal_alerts`, textes Task 6.
- Produces : `MemberCard3D({ name, code, active, qrPath, interactive = true })` (réutilisée par Task 8).

- [ ] **Step 1 :** `MemberCard3D` selon la maquette validée
  (`.superpowers/brainstorm/78270-1792877320/content/carte-3d.html`, option 2) : noire, bordure dorée fine, puce
  dorée, logo au recto, nom + code en bas à gauche ; inclinaison ±8° / ±11° et reflet qui suit le pointeur ;
  clic ou Entrée → verso avec le vrai QR (`encodeQrMatrix` / `qrSvgPath`) en grand + code ; `role="button"`,
  `aria-label` ; `prefers-reduced-motion` → pas d'inclinaison ni de reflet mobile.
- [ ] **Step 2 :** tuile « Carte » (spec §8, maquette `tuile-carte-v3.html` pour les barres) : état ; carte ; barre
  crédit temps (`CreditBlock` actuel resserré : disponibles en gros, ligne de détail, ou « Aucune formule : les
  réservations sont payées avec le crédit CFA ») ; barre crédit CFA (solde en gros, largeur = solde / dernière
  recharge, ligne « sur X rechargés le JJ/MM ») ; alerte de renouvellement + bouton WhatsApp ; boutons
  **Recharger** (principal), **Réserver**, **Repas extérieur**, **Imprimer la carte** ; discrets : Ajuster (admin),
  Désactiver la carte, Renouveler / Activer une formule, Annuler l'abonnement (admin) ; historique replié des
  mouvements (admin : « Annuler la recharge » sur une recharge). Sans carte : carte grisée + « Émettre une carte ».
  Anciennes cartes : liste repliée.
- [ ] **Step 3 :** `RechargeDialog` (montant, moyen, référence) → page du ticket, puis bouton WhatsApp (texte Task
  6 ; démo → `DemoMessageDialog`). `PaymentDialog` : choix « Carte membre (X disponibles) » en tête quand le solde
  > 0 ; reste affiché et moyen du reste demandé seulement s'il en reste. Fenêtre de réservation : case « Payer avec la
  carte » (cochée d'office sans abonnement), devis carte / reste. Accueil : liste des alertes de renouvellement avec
  WhatsApp. Trésorerie et Clôture : ligne « Crédits CFA des membres (dus en consommations) » = `wallet_liability`.
- [ ] **Step 4 :** `npm run build` ; navigateur (local, démo) : recharge → ticket avec signature → WhatsApp démo ;
  encaisser une note tout carte puis mixte ; réservation sans abonnement payée par carte ; repas extérieur ; carte
  qui s'incline et se retourne ; largeur téléphone (375 px) sans défilement horizontal ; captures.
- [ ] **Step 5 :** commit `Carte de débit : tuile carte 3D, crédit temps et crédit CFA sur la fiche membre`.

### Task 8 : carte imprimée recto / verso, démo, mode d'emploi

**Files :**
- Modify : `src/pages/MemberCard.jsx`, `src/club.css` (`@media print`), `README.md`, `test/demo.test.js`

- [ ] **Step 1 :** la page « Carte & QR » imprime les deux faces côte à côte (format carte 85,6 × 54 mm, sans
  inclinaison) avec `MemberCard3D` (`interactive={false}`) ; le logo dessiné `BrandLogo` y est remplacé par le vrai.
- [ ] **Step 2 :** test démo : recharge, paiement par carte et renouvellement dans l'espace démo ne touchent pas la
  base du vrai club (modèle des tests existants de `test/demo.test.js`).
- [ ] **Step 3 :** README : recharger, payer par carte, réserver sans abonnement, repas extérieur, annuler une
  recharge (admin), renouvellement automatique et tâche planifiée.
- [ ] **Step 4 :** `node --test test/*.test.js` → PASS ; `npm run build` ; aperçu d'impression (capture).
- [ ] **Step 5 :** commit `Carte de débit : carte imprimée recto verso, démo et mode d'emploi`.
