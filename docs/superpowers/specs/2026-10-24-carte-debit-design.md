# Carte de débit — conception

Date : 2026-10-24. S'appuie sur le ticket de caisse (`docs/superpowers/specs/2026-10-24-ticket-caisse-design.md`),
fusionné dans `main` (PR #9) : à construire sur une branche partie de `main`. Plan :
`docs/superpowers/plans/2026-10-24-carte-debit.md`.

## Intention

Le club veut que le membre **paie avec sa carte** plutôt qu'en espèces à chaque verre ou cigare. La carte porte
**deux crédits** :

- **crédit temps** : des heures de salle ;
- **crédit CFA** : de l'argent déposé à la caisse, qui paie tout le reste.

Le client paie à la caisse et **on lui crédite la carte, toujours en CFA** (décision finale du propriétaire : la
carte n'est rechargée qu'en argent). Quand il **réserve la salle**, la durée de la réservation est **payée directement avec
l'argent de sa carte** : pas d'heures achetées d'avance (décision finale du propriétaire). Chaque
fois qu'il consomme des cigares, de l'alcool, ou commande un repas à l'extérieur, **c'est son crédit CFA qui paie**.

Sur la fiche du membre, le propriétaire veut **voir la carte et, en dessous, les deux barres**.

## Objectifs

1. Un solde CFA par membre, rempli à la caisse, qui paie cigares, alcool, repas extérieurs, temps supplémentaire,
   réservations de salle et abonnement.
2. Une réservation de salle payée directement avec le crédit CFA (au-delà des heures de l'abonnement, ou sans
   abonnement).
3. Une tuile « Carte » sur la fiche membre : carte 3D, barre temps, barre CFA, actions.
4. Chaque mouvement sur la carte (recharge, paiement d'une réservation ou d'une note) imprime un **ticket signé par le client**.
5. Renouvellement automatique de l'abonnement sur le crédit CFA, avec alerte et message WhatsApp quand le solde
   ne suffit pas.
6. Reçu WhatsApp en un clic à chaque recharge.

## Non-objectifs

- Paiement en scannant la carte : le gérant **cherche le client dans la liste** (décision du propriétaire). Le QR
  de la carte garde son usage actuel.
- Paiement sans le gérant (borne, application client).
- Remboursement du crédit restant, expiration du crédit CFA : **jamais** (règle du propriétaire).
- Signature électronique : la signature est sur le ticket papier.
- Envoi WhatsApp automatique : toujours un clic du gérant (lien wa.me), comme le reste de l'application.
- Impression de la carte en plastique (dorure, relief) : affaire de l'imprimeur ; l'application fournit la page
  à imprimer.

## Anti-objectifs (échec même si « ça marche »)

- Un solde qu'on peut modifier sans trace : chaque mouvement est une ligne datée, avec son auteur, jamais effacée.
- Un solde CFA négatif.
- Un paiement par carte sans ticket à faire signer.
- Une recharge annulée par un gérant (seul un administrateur annule, avec motif, journalisé).
- Le crédit perdu quand une carte est perdue ou remplacée.
- Un renouvellement qui prend une partie de l'argent sans donner l'abonnement.
- En mode démo : un vrai WhatsApp ouvert, ou des mouvements qui touchent le vrai club.

## Ce qui existe (à réutiliser)

- **Crédit temps** : rattaché à un abonnement (`subscriptions.included_minutes`) et suivi par
  `credit_movements` (engagement, libération, consommation, ajustement). Calcul affiché par `CreditBlock`
  (src/pages/Member.jsx) : attribuées, engagées, consommées, disponibles.
- **Lignes à encaisser** : `charges` (sous-comptes `reservations`, `alcool`, `cigares` ; types
  `temps_supplementaire`, `produit`, `abonnement`), toujours rattachées à un membre.
- **Encaissement** : `recordPayment` (worker/club.js) ; un encaissement = un seul membre, un moyen de paiement ;
  `payment_allocations` impose qu'une ligne soit payée **en entier par un seul encaissement** (`charge_id`
  UNIQUE). Fenêtre `PaymentDialog` (src/dialogs/moneyDialogs.jsx).
- **Moyens de paiement** : réglage `payment_methods` (sur le site réel : « Espèces », « MTN MoMo »).
- **Tarif horaire** : réglage `overtime_tariff` (25 000 FCFA l'heure, 15 000 FCFA la demi-heure restante),
  validé par un administrateur.
- **Abonnements** : formules dans Paramètres (mensuelle 50 000 FCFA = 2 h ; annuelle 500 000 FCFA = 24 h, à
  saisir par l'admin) ; `renewal_of` relie un renouvellement au précédent. Aucune tâche planifiée aujourd'hui
  (pas de `cron` dans wrangler.jsonc) ; le serveur est un Durable Object (worker/index.js).
- **Cartes** : table `cards` (physique / virtuelle, code unique, active / désactivée), page d'impression
  src/pages/MemberCard.jsx avec QR (src/lib/qrcode.js).
- **WhatsApp** : shared/whatsapp.js (`waLink`) et le modèle démo `DemoMessageDialog`.
- **Ticket de caisse** (fusionné) : ticket par encaissement, impression 80 mm, WhatsApp, code de
  contrôle, historique des impressions.
- **Journal / trésorerie** : `ledger_entries` (dépense, recette, transfert), `audit_log`.

## Conception

### 1. Les deux crédits

**Crédit CFA**
- Appartient au **membre** (pas au morceau de plastique) : une carte remplacée garde le solde. *(mon choix)*
- Ne descend jamais sous zéro. Jamais remboursé, jamais expiré.
- Monte par **recharge** à la caisse ; descend par **paiement par carte** (réservation, note, abonnement).
- Chaque mouvement est enregistré (type, montant, solde après, ticket, auteur, date). Le solde est la somme des
  mouvements, jamais un chiffre saisi.

**Crédit temps**
- **Seulement les heures de l'abonnement**, comme aujourd'hui. Il n'y a **pas d'heures achetées d'avance**
  (décision finale du propriétaire). La barre temps de la tuile montre donc l'abonnement.
- Une réservation consomme d'abord les heures de l'abonnement ; **le reste de la durée est payé avec le crédit CFA**
  (§3).

### 2. Recharger (gérant)

Bouton **Recharger** sur la tuile. La recharge est **toujours en CFA** : montant, moyen de paiement (Espèces,
MoMo…), référence facultative → le crédit CFA monte.
- **Ticket imprimé et signé**, puis bouton **WhatsApp** (reçu en un clic : montant, nouveau
  solde, date ; en démo, le message s'affiche sans rien ouvrir).
- **Annuler une recharge** : administrateur seulement, motif obligatoire, journalisé ; refusé si l'argent a déjà
  été dépensé au point de rendre le solde négatif.

### 3. Réserver la salle avec la carte (gérant)

Le gérant réserve comme aujourd'hui. La durée non couverte par les heures de l'abonnement (ou toute la durée, si le
membre n'a pas d'abonnement) est **payée directement avec le crédit CFA**.
- Prix = **tarif horaire normal** du réglage `overtime_tariff` (décision du propriétaire) : 25 000 FCFA l'heure,
  15 000 FCFA la demi-heure restante (ex. 2 h = 50 000 FCFA, 1 h 30 = 40 000 FCFA). Tarif non validé → réservation
  payante refusée (règle actuelle).
- **Sans abonnement**, un membre peut réserver s'il paie avec sa carte : l'accès à la salle
  (`verifyMemberRoomAccess`) ne l'exige plus dans ce cas. *(découle des réponses du propriétaire)*
- Moment du paiement : **à la réservation**, prélevé sur la carte ; la fenêtre de réservation affiche le prix et le
  solde. *(mon choix)*
- Crédit CFA insuffisant : la carte paie ce qu'elle a, le reste devient une ligne à encaisser à la caisse (règle
  générale du propriétaire).
- Réservation **annulée, déplacée ou raccourcie** : la différence **retourne sur la carte** ; **prolongée** : le
  supplément est pris sur la carte, comme une réservation. Les règles d'annulation actuelles (délais, acompte)
  s'appliquent. *(mon choix)*
- **Ticket signé** au paiement de la réservation.

### 4. Payer avec la carte (gérant)

Le gérant **cherche le client dans la liste**, ouvre sa fiche ou sa note, clique **Encaisser** comme aujourd'hui.
- Nouveau moyen de paiement dans la fenêtre : **« Carte membre (75 000 FCFA disponibles) »**.
- Solde suffisant : tout est payé par la carte.
- Solde insuffisant : **la carte paie ce qu'elle a, le reste est payé à la caisse** (Espèces / MoMo) dans la même
  fenêtre (règle du propriétaire).
- Ce qui se paie ainsi : cigares, alcool, temps supplémentaire resté à encaisser, abonnement, repas extérieurs.
- **Ticket imprimé et signé** à chaque paiement par carte (voir §7).

### 5. Repas commandé à l'extérieur

Le client commande dans un restaurant depuis la salle. Le club **paie le livreur avec l'argent de la caisse**
(sortie de trésorerie), puis met **le même montant exact** sur la note du client (aucune marge), payé par la carte
comme le reste. Une seule action du gérant enregistre les deux. *(sortie de caisse + ligne sur la note : règle du
propriétaire ; « une seule action » : mon choix)*

### 6. Renouvellement automatique de l'abonnement

- Le jour de l'échéance, si le crédit CFA suffit : le prix de la formule est pris sur la carte et les heures sont
  ajoutées, **sans action du gérant**. Ticket créé (à imprimer quand le client passe, la signature n'est pas
  exigée pour ce mouvement automatique — *mon choix*).
- S'il ne suffit pas : **rien n'est pris**, l'abonnement n'est pas renouvelé ; **alerte** sur l'Accueil et sur la
  fiche (« Renouvellement impossible : 30 000 FCFA sur la carte, 50 000 nécessaires ») avec bouton **WhatsApp**
  (message prêt : il manque X FCFA).
- **Prévenir 3 jours avant** l'échéance si le solde ne suffira pas, même alerte et même bouton. *(mon idée, non
  validée explicitement)*
- **Dès que le client recharge assez**, le renouvellement se fait **automatiquement** (décision du propriétaire).
  Le nouvel abonnement **commence le jour de la recharge** (ex. échu le 23/11, recharge le 2/12 → du 2/12 au
  1/01) : le client ne paie pas les jours sans abonnement (décision du propriétaire). Aucun mouvement n'est donc
  daté dans le passé.
- Ce renouvellement en attente reste armé **30 jours** après l'échéance ; ensuite l'alerte disparaît et
  l'abonnement se réactive à la main. *(mon choix : le propriétaire n'a pas de préférence)*
- Le moment exact du contrôle (tâche planifiée Cloudflare, alarme du Durable Object, ou contrôle à la première
  requête du jour) est laissé au constructeur ; l'effet doit être le même que si c'était fait à l'heure.

### 7. Ticket de caisse pour la carte

Reprend le ticket du projet ticket de caisse, avec en plus :
- la part payée par la carte (« Payé par carte membre : 25 000 FCFA ») et le reste éventuel avec son moyen ;
- le **nouveau solde** : temps et CFA ;
- une ligne **« Signature du client »**.
Imprimé pour : paiement par carte (note ou réservation), recharge. Le club garde le
ticket signé, le client reçoit sa copie par WhatsApp en un clic. *(mon choix)*

### 8. Tuile « Carte » sur la fiche membre

Remplace les tuiles « Abonnement » et « Cartes » de src/pages/Member.jsx. Maquette validée :
`.superpowers/brainstorm/78270-1792877320/content/carte-3d.html` (option 2) et `tuile-carte-v3.html` (barres).

De haut en bas :
1. Titre « Carte » + état (active / désactivée).
2. **La carte en 3D** : noire, bordure dorée fine, puce dorée, **vrai logo The Limen** doré au recto, nom et code
   en bas à gauche. Elle **s'incline** sous la souris ou le doigt avec un **reflet doré** qui suit le geste ; **un
   clic la retourne** : verso = **QR en grand** + code. (Le logo : fichiers reçus sur WhatsApp, or sur noir et or
   sur blanc, 1080×719 JPEG, à mettre dans `public/` ; demander au club le fichier vectoriel pour l'impression.)
3. **Barre crédit temps** : disponibles en gros ; segments engagées / disponibles (consommées) ; ligne
   « 2 h attribuées · 1 h engagée · 0 min consommée · formule mensuelle jusqu'au 23/11 ». Sans abonnement :
   barre vide et « Aucune formule : les réservations sont payées avec le crédit CFA ».
4. **Barre crédit CFA** : solde en gros ; barre comparée à la dernière recharge (« sur 100 000 FCFA rechargés le
   24/10 »).
5. Boutons : **Recharger** (principal), **Réserver**, **Imprimer la carte** ; discrets pour
   l'administrateur : Ajuster, Désactiver. Les actions d'abonnement existantes (Renouveler / Activer une formule,
   Annuler l'abonnement) restent accessibles dans la tuile.
6. Alerte de renouvellement (§6) dans la tuile quand elle existe.

Membre **sans carte** : carte grisée + bouton « Émettre une carte » ; les barres restent visibles. *(mon choix)*
Plusieurs cartes (ancienne désactivée + nouvelle) : la tuile montre la carte active ; les anciennes restent dans
une liste repliée. *(mon choix)*
Mouvement réduit demandé par l'appareil (`prefers-reduced-motion`) : pas d'inclinaison, le retournement reste.

### 9. Carte imprimée

La page « Carte & QR » (src/pages/MemberCard.jsx) imprime **les deux faces** de la même carte : recto avec le
logo, verso avec le QR. Sans effet 3D (papier / plastique). *(mon choix)* L'étape 7 du plan du ticket de caisse
(logo sur l'ancienne carte) est remplacée par ce projet.

## Contraintes

- Argent en entiers (FCFA), comme le reste ; jamais de nombres à virgule.
- Rien n'est effacé : annulations par mouvement inverse, avec motif et auteur.
- Le mode démo garde son espace séparé (DemoDO) ; tout ce projet doit y marcher sans toucher au vrai club.
- Mois clôturés (`closed_periods`) : aucun mouvement daté dans un mois clôturé.
- Le dépôt GitHub est public : pas de numéro du club ni de donnée client dans le code.
- Interface en français, format de l'application (tablette, téléphone, ordinateur).

## Choix faits par moi (à vérifier par le propriétaire)

- L'argent compte **en trésorerie à la recharge**, **en recette à la consommation** (cigares, alcool, temps,
  abonnement, repas).
- Le solde appartient au membre, pas à la carte.
- Ticket signé aussi pour la recharge ; pas de signature exigée pour le renouvellement
  automatique.
- Alerte 3 jours avant l'échéance.
- Carte imprimée recto / verso.
- Le renouvellement automatique s'applique à **tout** abonnement en cours (pas d'option à cocher : règle du
  propriétaire « il se renouvelle automatiquement ») et reprend **la même formule** au prix actuel de la formule.
  **Annuler l'abonnement** l'arrête.
- **Remboursement d'une ligne payée par la carte** : la part payée par la carte retourne sur le crédit CFA (pas en
  espèces) ; la part payée en espèces / MoMo est rendue par ce moyen. Règle de partage pour un paiement mixte :
  au constructeur.
- **Pas d'ajustement manuel du crédit CFA** : une erreur se corrige en annulant la recharge (admin) ou en
  rechargeant. « Ajuster » reste pour le crédit temps, comme aujourd'hui.
- **Trésorerie** : un paiement par carte n'est pas une entrée d'argent (l'argent est entré à la recharge) ; le
  total des crédits CFA détenus par les membres (argent que le club leur doit en consommations) est affiché dans
  Trésorerie et dans la clôture du mois.

## Laissé au constructeur

- Les tables (portefeuille, mouvements CFA) et le lien entre une réservation et son paiement par carte
  (aujourd'hui la ligne `temps_supplementaire` créée à la réservation).
- Comment le paiement mixte (carte + espèces) s'accorde avec `payment_allocations` (une ligne = un seul
  encaissement aujourd'hui).
- Le sous-compte et le type des repas extérieurs (`charges.account` / `kind` n'ont pas de valeur pour eux).
- Le mécanisme du renouvellement automatique (§6).
- L'enchaînement exact avec le ticket de caisse une fois celui-ci fini.
