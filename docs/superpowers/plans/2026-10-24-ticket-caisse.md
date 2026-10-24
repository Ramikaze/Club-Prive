# Ticket de caisse — plan de construction

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal :** chaque encaissement donne un ticket de caisse imprimable (80 mm), envoyable par WhatsApp, réimprimable,
vérifiable par QR code sur une page publique, avec l'historique de chaque sortie ; plus le logo sur la carte de membre.

**Architecture :** le ticket est la vue d'une ligne `payments`, à laquelle on ajoute un code de contrôle aléatoire
(`ticket_code`). Une table `ticket_events` trace chaque impression / envoi et donne le n° d'exemplaire. Une route
publique en lecture seule, limitée par IP, sert la vérification ; une page hors connexion l'affiche. Le formatage
partagé (numéro, code, texte WhatsApp, initiales) vit dans `shared/ticket.js`.

**Tech Stack :** Cloudflare Worker + Durable Object SQLite (worker/), React 18 + react-router 6 `HashRouter` +
zustand (src/), tests `node --test` (Node ≥ 24) avec `test/harness.js`.

**Spec :** `docs/superpowers/specs/2026-10-24-ticket-caisse-design.md` (le lire en entier avant chaque tâche).

## Global Constraints

- Dépôt public : aucun téléphone, code de ticket réel ni donnée réelle dans le code ou les tests.
- Montants stockés en centièmes (`UM = 100`), affichés avec `money()` côté front.
- Numéro affiché : `T-` + id sur 6 chiffres au moins (`T-000123`, `T-1234567`).
- Code : 12 caractères de `ABCDEFGHJKMNPQRSTUVWXYZ23456789`, affiché `XXXX-XXXX-XXXX`, comparé sans tirets ni casse.
- Route publique : 5 échecs par IP → 429 pendant 60 s (`checkThrottle` / `recordFailure` existants, clé `${ip}|ticket`).
- Réponse publique : nom du club, numéro, date, lignes (libellé, quantité, montant), total, moyen, initiales, statut
  (`valide` | `partiellement_rembourse` | `rembourse`), montant remboursé. Rien d'autre.
- Réglages : `ticket_header` (≤ 200 caractères, ≤ 4 lignes, défaut `''`), `ticket_footer` (≤ 120 caractères,
  ≤ 2 lignes, défaut `'Merci de votre visite'`).
- Démo : ticket avec filigrane « DÉMO — SANS VALEUR », sans QR ni code ; WhatsApp montre le message sans rien ouvrir.
- Ticket signalé dans l'historique à partir de 3 exemplaires sortis.
- Style : commentaires en anglais comme le code existant, textes d'interface en français, actions d'audit
  françaises pointées (`ticket.imprimer`, `ticket.whatsapp`).
- Ne rien pousser, ne rien mettre en ligne sans l'accord de l'utilisateur ; chaque commit est annoncé à l'utilisateur.

## Review Focus

1. Ancien paiement sans code (créé avant V14) : il reçoit un code au démarrage et se vérifie comme un neuf
   (test Task 2 « les paiements existants reçoivent un code »).
2. Numéro valide + mauvais code, et numéro inexistant : même réponse 404, même corps (test Task 3 « faux ticket »).
3. Code saisi à la main en minuscules, avec tirets ou espaces : accepté (tests Task 1 `normalizeTicketCode`, Task 3).
4. Navigateur resté dans l'espace démo qui ouvre un QR : la vérification lit le vrai club (test Task 3 « espace démo »).
5. Membre sans téléphone utilisable : le bouton WhatsApp ne plante pas, il explique (Task 5 Step 2, vérifié au
   navigateur avec un membre au téléphone invalide).

---

### Task 1 : formatage partagé (`shared/ticket.js`)

**Files :**
- Create : `shared/ticket.js`
- Test : `test/ticket-format.test.js`

**Interfaces :**
- Produces :
  - `TICKET_ALPHABET: string`, `TICKET_CODE_LENGTH = 12`
  - `newTicketCode(randomBytes: (n: number) => Uint8Array): string` — tirage par rejet (octet ≥ 248 rejeté, sinon `% 31`)
  - `formatTicketNumber(id: number): string` → `'T-000123'`
  - `formatTicketCode(code: string): string` → `'K7QM-2XRP-9TDA'`
  - `normalizeTicketCode(input: unknown): string` → majuscules, ne garde que les caractères de l'alphabet
  - `memberInitials(firstName, lastName): string` → `'J. D.'` (accents gardés, parties vides ignorées)
  - `ticketVerifyUrl(origin: string, id: number, code: string): string` → `${origin}/#/ticket/${id}/${code}`
  - `ticketWhatsAppText({ clubName, number, copyLabel, paidAt, memberName, memberNo, lines: [{ label, quantity, amount }], total, method, reference, cashier, refunded, verifyUrl, footer, money, dateTime }): string`
    — suit le modèle du spec §5 ; `money` et `dateTime` sont les fonctions de formatage fournies par l'appelant ;
    sans `verifyUrl` (démo) pas de ligne « Vérifiez » ; `refunded > 0` → ligne `Remboursé : …`.

- [ ] **Step 1 : tests qui échouent** :
  - `newTicketCode` avec un générateur déterministe → 12 caractères, tous dans l'alphabet ; les octets ≥ 248 sont rejetés ;
  - `formatTicketNumber(123) === 'T-000123'` ; `formatTicketNumber(1234567) === 'T-1234567'` ;
  - `formatTicketCode('K7QM2XRP9TDA') === 'K7QM-2XRP-9TDA'` ;
  - `normalizeTicketCode(' k7qm-2xrp 9tda ') === 'K7QM2XRP9TDA'` ; `normalizeTicketCode(null) === ''` ;
  - `memberInitials('Élodie', "N'Diaye") === 'É. N.'` ;
  - `ticketWhatsAppText` contient `TICKET DE CAISSE T-000123 (Original)`, `TOTAL : `, `Payé : Espèces`, la ligne
    `Vérifiez ce ticket : <url>`, le pied ; sans `verifyUrl`, aucune ligne « Vérifiez ».
- [ ] **Step 2 :** `node --test test/ticket-format.test.js` → FAIL (module absent).
- [ ] **Step 3 :** écrire `shared/ticket.js` (pur, sans dépendance, importable par worker et src).
- [ ] **Step 4 :** `node --test test/ticket-format.test.js` → PASS.
- [ ] **Step 5 :** commit `Ticket de caisse : formatage partagé (numéro, code, texte WhatsApp)`.

### Task 2 : base de données, code à l'encaissement, réglages

**Files :**
- Modify : `worker/schema.js` (nouveau `V14`, `MIGRATIONS`)
- Modify : `worker/club.js` (`WIPE_ORDER` ~39, `defaultSettings` ~51, `normalizeSetting` ~286, `bootstrap` ~177, `paymentDTO` ~2066, `recordPayment` ~2081)
- Test : `test/ticket.test.js` (nouveau)

**Interfaces :**
- Consumes : `newTicketCode` (Task 1).
- Produces :
  - colonne `payments.ticket_code TEXT` + index unique `payments_ticket_code` (NULL permis le temps du remplissage)
  - table `ticket_events (id INTEGER PRIMARY KEY, payment_id INTEGER NOT NULL REFERENCES payments(id), kind TEXT NOT NULL CHECK (kind IN ('impression','whatsapp')), copy_no INTEGER NOT NULL CHECK (copy_no >= 1), phone TEXT, at TEXT NOT NULL, user_id INTEGER REFERENCES users(id), UNIQUE (payment_id, copy_no))` + index sur `at`
  - `fillTicketCodes()` (méthode du club) appelée par `bootstrap()` : un code pour chaque paiement qui n'en a pas
  - `paymentDTO` gagne `ticket_code`
  - réglages `ticket_header`, `ticket_footer`

- [ ] **Step 1 : tests qui échouent** (`test/ticket.test.js`, serveur `lenientTariffs`, admin + gérant + membre +
  abonnement encaissé comme `test/finance.test.js:78`) :
  - « un encaissement reçoit un code de 12 caractères, différent d'un paiement à l'autre » ;
  - « les paiements existants reçoivent un code » : mettre `ticket_code = NULL` en SQL sur la base du harness,
    relancer le club sur la même base, vérifier que le code est rempli et que montants et dates n'ont pas bougé ;
  - « réglages du ticket » : défauts `''` / `'Merci de votre visite'` ; en-tête de 201 caractères → 400 ;
    en-tête de 5 lignes → 400 ; pied de 3 lignes → 400 ; gérant → 403 ;
  - « effacer toutes les données vide aussi les sorties de tickets ».
- [ ] **Step 2 :** `node --test test/ticket.test.js` → FAIL.
- [ ] **Step 3 :** V14 + `fillTicketCodes` (codes tirés avec `crypto.getRandomValues`, nouveau tirage si collision)
  + code tiré dans `recordPayment` et inséré avec le paiement + réglages + `WIPE_ORDER` (`ticket_events` avant `payments`).
- [ ] **Step 4 :** `node --test test/*.test.js` → tout PASS (rien d'existant cassé).
- [ ] **Step 5 :** commit `Ticket de caisse : code de contrôle, table des sorties, réglages`.

### Task 3 : API du ticket (personnel, sorties, vérification publique, historique)

**Files :**
- Modify : `worker/club.js` (nouvelles méthodes), `worker/api.js` (routes près de « Money », ~293), `worker/space.js:16` (`ALWAYS_REAL`)
- Test : `test/ticket.test.js`

**Interfaces :**
- Consumes : Task 2 ; `formatTicketNumber`, `normalizeTicketCode`, `memberInitials` (Task 1) ; `timingSafeEqual` (worker/auth.js).
- Produces :
  - `GET /api/payments/:id/ticket` (tous rôles) → `{ ticket: { ...paymentDTO, number, member_phone, refunded_amount, refunds: [{ amount, created_at }], status, next_copy_no, header, footer, club_name, demo }, events?: [{ at, kind, copy_no, phone, user_name }] }` ; `events` seulement pour l'admin.
  - `POST /api/payments/:id/ticket-events` `{ kind: 'impression' | 'whatsapp' }` (tous rôles) → `{ copy_no, printed_by_name, at }` ;
    `copy_no = max + 1` dans la transaction ; pour `whatsapp`, le serveur enregistre `members.phone` ; audit
    `ticket.imprimer` / `ticket.whatsapp` (entité `payment`, détails `{ copy_no }`).
  - `GET /api/tickets/:id/:code` (`{ public: true }`, lecture seule) → `{ ticket: { club_name, number, paid_at, lines: [{ label, quantity, amount }], total, method, initials, status, refunded_amount } }` ;
    404 `TICKET_INTROUVABLE` « Ticket introuvable. » si l'id est inconnu **ou** le code faux (comparaison à temps
    constant sur `normalizeTicketCode`) ; chaque échec → `recordFailure(`${ip}|ticket`)` ; un succès ne remet pas le
    compteur à zéro.
  - `GET /api/ticket-events?from=&to=&user_id=` (ADMIN) → `{ events: [{ at, kind, copy_no, payment_id, number, member_name, amount, user_id, user_name, copies_total }] }`.
  - `ALWAYS_REAL = /^\/api\/(login|logout|setup|tickets)(\/|$)/`.

- [ ] **Step 1 : tests qui échouent** :
  - « ticket du personnel » : `number` commence par `T-`, `member_phone` présent, `next_copy_no === 1`, `events`
    absent pour le gérant, présent pour l'admin ;
  - « sorties numérotées » : impression → 1, WhatsApp → 2 avec `phone` enregistré, impression → 3 ;
    `next_copy_no === 4` ; `kind` inconnu → 400 ; paiement inconnu → 404 ; sans session → 401 ;
  - « vérification publique » (client sans session) : bon code → 200 et la réponse ne contient aucune des clés
    `member_phone`, `member_name`, `member_no`, `reference`, `created_by_name`, `allocations`, `ticket_code` ;
    code en minuscules avec tirets → 200 ;
  - « faux ticket » : bon id + mauvais code, et id inconnu → même statut 404, même corps ;
  - « limitation » : 5 mauvais codes → la 6e requête répond 429, même avec le bon code ;
  - « remboursement visible » : l'admin rembourse une ligne → statut public `rembourse` (une ligne sur une) et
    `refunded_amount` égal au montant ;
  - « espace démo » : avec `Site` du harness, requête publique portant `x-club-espace: demo` → réponse du vrai club ;
  - « historique admin » : filtres `user_id` et période ; `copies_total === 3` pour le ticket ci-dessus ; gérant → 403.
- [ ] **Step 2 :** `node --test test/ticket.test.js` → FAIL.
- [ ] **Step 3 :** méthodes `ticketFor(actor, id)`, `recordTicketEvent(actor, id, input)`, `publicTicket(id, code)`,
  `ticketEvents(query)` dans `club.js` ; routes ; `ALWAYS_REAL`.
- [ ] **Step 4 :** `node --test test/*.test.js` → PASS.
- [ ] **Step 5 :** commit `Ticket de caisse : API (ticket, sorties, vérification publique, historique)`.

### Task 4 : page publique de vérification

**Files :**
- Create : `src/pages/PublicTicket.jsx`
- Modify : `src/App.jsx` (avant les tests de `status`, ~110), `src/lib/api.js:35` (option pour ne pas envoyer
  `X-Club-Espace`), `src/club.css` (styles de la page)

**Interfaces :**
- Consumes : `GET /api/tickets/:id/:code` (Task 3) ; `formatTicketCode`, `normalizeTicketCode`, `formatTicketNumber` (Task 1).
- Produces : `PublicTicket()`, rendue quand `window.location.hash` commence par `#/ticket`, quel que soit `status`
  (même `boot`) ; suit `hashchange`.

- [ ] **Step 1 :** `App.jsx` : hash en `#/ticket…` → `<PublicTicket />` + `<Toasts />`, sans attendre la session.
- [ ] **Step 2 :** `PublicTicket` : `#/ticket/:id/:code` → appel public sans en-tête démo ; succès → bandeau vert
  « Ticket authentique enregistré par The Limen », ticket (logo, numéro, date, lignes, total, moyen, initiales,
  statut, remboursé), phrase de comparaison du spec §2 ; 404 → bandeau rouge « Ticket introuvable : ce ticket n'a pas
  été émis par The Limen » ; 429 → « Trop de tentatives. Réessayez dans une minute. » ; `#/ticket` seul → formulaire
  n° + code qui va vers `#/ticket/:id/:code` normalisé (le n° accepte `T-000123` ou `123`).
- [ ] **Step 3 :** `npm run build` → OK ; navigateur (preview locale, onglet sans session) : bon lien, mauvais code,
  formulaire, largeur 375 px.
- [ ] **Step 4 :** commit `Ticket de caisse : page publique de vérification`.

### Task 5 : page du ticket, impression 80 mm, WhatsApp, réimpression

**Files :**
- Create : `src/pages/Ticket.jsx` (page `#/caisse/ticket/:id`), `src/components/ui/TicketSheet.jsx` (le papier)
- Modify : `src/App.jsx` (route `caisse/ticket/:id`), `src/dialogs/moneyDialogs.jsx:36-44` (après succès : aller à
  la page), `src/pages/Cash.jsx:19-37` (`JournalTable` : bouton « Ticket »), `src/pages/Member.jsx:219-229` (bouton
  « Ticket » par paiement), `src/club.css` (`@media print`)

**Interfaces :**
- Consumes : `GET /api/payments/:id/ticket`, `POST /api/payments/:id/ticket-events` (Task 3) ;
  `ticketWhatsAppText`, `ticketVerifyUrl`, `formatTicketCode` (Task 1) ; `waDigits`, `waLink` (`shared/whatsapp.js`) ;
  `DemoMessageDialog` (src/dialogs/reservationDialogs.jsx ~583, à exporter si besoin) ; `encodeQrMatrix`,
  `qrSvgPath` (`src/lib/qrcode.js`) ; `BrandLogo`.
- Produces : `TicketSheet({ ticket, copyNo, printedBy, printedAt })`, utilisé par l'aperçu et l'impression.

- [ ] **Step 1 :** `TicketSheet` : contenu du spec §3, points 1 à 10, dans cet ordre ; `copyNo === 1` → « Original »,
  sinon « Duplicata n°X » ; `ticket.demo` → filigrane « DÉMO — SANS VALEUR », ni QR ni code ;
  QR = `ticketVerifyUrl(location.origin, id, code)`.
- [ ] **Step 2 :** `Ticket.jsx` : aperçu avec `next_copy_no` ; **Imprimer** = POST `impression`, mise à jour de
  l'exemplaire et de « Imprimé par » avec la réponse, puis `window.print()` après rendu ; **Envoyer par WhatsApp** =
  POST `whatsapp` puis `window.open(waLink(...), '_blank', 'noopener')`, ou `DemoMessageDialog` en démo (sans POST
  vers WhatsApp) ; numéro inutilisable (`waDigits` nul) → bouton désactivé + « Numéro WhatsApp du membre
  inutilisable : corrigez-le sur sa fiche » avec lien ; admin : tableau des sorties sous l'aperçu ; **Retour à la caisse**.
- [ ] **Step 3 :** CSS : `@page { size: 80mm auto; margin: 0 }` seulement pendant que la page du ticket est ouverte
  (classe posée sur `<body>` par la page et retirée en partant), pour ne pas changer l'impression de la carte de
  membre ; colonne 72 mm, noir sur blanc, police ≥ 9 pt.
- [ ] **Step 4 :** `PaymentDialog` : après succès, `close()` puis naviguer vers `/caisse/ticket/${res.payment.id}`
  (garder le toast et `onDone`) ; boutons « Ticket » dans `JournalTable` et dans la carte « Paiements » du membre.
- [ ] **Step 5 :** `npm run build` ; navigateur : encaisser en local → page du ticket ; Imprimer → aperçu
  d'impression 80 mm (capture) avec « Original » ; 2e impression → « Duplicata n°2 » ; WhatsApp ouvre un lien `wa.me` ;
  réimpression depuis le journal et la fiche membre ; membre au téléphone invalide → message ; démo : filigrane, pas
  de QR, message montré sans ouvrir WhatsApp.
- [ ] **Step 6 :** commit `Ticket de caisse : page, impression 80 mm, WhatsApp, réimpression`.

### Task 6 : historique des tickets et réglages du ticket (admin)

**Files :**
- Create : `src/pages/TicketHistory.jsx`
- Modify : `src/App.jsx` (route `caisse/historique-tickets` dans `AdminOnly`), `src/pages/Cash.jsx` (lien depuis la
  vue admin), `src/pages/Settings.jsx` (carte « Ticket de caisse » dans l'onglet Club & Horaires, sur le modèle de
  `PaymentsSection` ~435)

**Interfaces :**
- Consumes : `GET /api/ticket-events` (Task 3), réglages `ticket_header` / `ticket_footer` (Task 2), `PeriodPicker` existant.

- [ ] **Step 1 :** page : période (`PeriodPicker`), filtre employé, colonnes Date, Ticket, Client, Montant, Type
  (« Impression demandée » / « WhatsApp »), Exemplaire, Par ; pastille orange « 3 sorties ou plus » quand
  `copies_total >= 3` ; clic → page du ticket.
- [ ] **Step 2 :** carte de réglages : deux zones de texte (en-tête 4 lignes, pied 2 lignes) avec compteur de caractères.
- [ ] **Step 3 :** `npm run build` ; navigateur : admin (liste, filtres, pastille) ; gérant (pas de lien, route refusée).
- [ ] **Step 4 :** commit `Ticket de caisse : historique des sorties et réglages`.

### Task 7 : logo sur la carte de membre

**Files :**
- Modify : `src/pages/MemberCard.jsx:47-50` (`.mc-top`), `src/club.css` (`.member-card`, impression ~814-822)

- [ ] **Step 1 :** `BrandLogo` dans `.mc-top` à la place du texte `mc-club` (le nom du club reste lisible par les
  lecteurs d'écran via `aria-label`), couleur or de la carte, hauteur ~7 mm, à l'écran et à l'impression 85,6 × 54 mm.
- [ ] **Step 2 :** navigateur : carte à l'écran + aperçu d'impression (capture).
- [ ] **Step 3 :** commit `Logo The Limen sur la carte de membre`.

### Task 8 : vérification finale

- [ ] `node --test test/*.test.js` → tout PASS (plus de tests qu'avant) ; `npm run build` → OK.
- [ ] Parcours complet en local, téléphone (375 px) et ordinateur : encaisser → imprimer → duplicata → WhatsApp →
  ouvrir le lien du QR dans un onglet sans session → rembourser une ligne → statut sur la page publique.
- [ ] README : section caisse (ticket, vérification, historique).
- [ ] Montrer le résultat à l'utilisateur ; PR et mise en ligne seulement avec son accord.
