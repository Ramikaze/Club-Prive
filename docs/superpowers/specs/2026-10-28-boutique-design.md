# Boutique — conception

Date : 2026-10-28. Branche à créer : `feat/boutique` (depuis `main`).
Maquettes validées pendant la discussion (privées, à titre de référence) : https://claude.ai/artifact/P41RTemHKe5X418XskRhkW

## Intention

Le club doit pouvoir **vendre des cigares et du champagne en dehors des séances en salle**, à n'importe qui :
un membre, une personne connue qui n'est pas membre, ou quelqu'un de passage.

Deux **associés** se partagent cette activité : l'un vend les **cigares**, l'autre le **champagne**. Chacun suit
son propre argent : les ventes de cigares vont au sous-compte **Cigares**, celles de champagne au sous-compte
**Alcool**. Il faut aussi pouvoir distinguer, dans ces comptes, ce qui a été vendu **à la Boutique** de ce qui a été
consommé **en séance**.

Le propriétaire veut aussi, pour chaque membre et chaque client enregistré, **l'historique de tout ce qu'il a
acheté**, à la Boutique comme en séance.

## Vocabulaire (celui du propriétaire)

- **Boutique** : nouvelle entrée du menu de gauche, où l'on vend hors séance.
- **Client journalier** : personne de passage, **non enregistrée**. Aucune fiche, aucune donnée personnelle.
- **Client régulier** : personne **enregistrée** qui revient acheter à la Boutique sans être membre. Elle a une fiche,
  avec les mêmes informations qu'un membre.
- **Membre** : comme aujourd'hui.
- **Associé** : un des deux propriétaires de l'activité Boutique. Associé « Cigares » ou associé « Champagne ».

## Objectifs

1. Une entrée **« Boutique »** dans le menu, avec deux onglets : **Cigares** et **Champagnes**.
2. Vendre les produits du stock existant (« Stocks & Cave »), **aux mêmes prix qu'en séance**. Chaque vente fait baisser
   le même stock.
3. L'acheteur est au choix un **client journalier**, un **client régulier** ou un **membre**.
4. **Paiement toujours immédiat**, avec les moyens de paiement de la caisse (`settings.payment_methods`, aujourd'hui
   « Espèces » et « MTN MoMo »). Un **membre** peut aussi payer avec sa **carte** : même règle qu'en séance (la carte paie
   ce qu'elle peut, le reste par un autre moyen).
5. **Une vente ne concerne qu'un rayon** : cigares **ou** champagne. Un client qui prend les deux reçoit **deux tickets**,
   donc deux ventes, une par onglet.
6. **Ticket** : un client journalier reçoit un **ticket papier** imprimé au format ticket de caisse, sans WhatsApp. Un
   client régulier ou un membre reçoit son ticket comme aujourd'hui : imprimé ou envoyé sur WhatsApp.
7. Le menu « Membres » devient **« Membres / Clients »**, avec deux onglets : **Membres** et **Clients réguliers**.
8. Un client régulier peut être **passé en membre**. Il garde **tout l'historique de ses achats**.
9. Chaque fiche, membre ou client régulier, montre l'**historique des achats**, Boutique et séance mêlés, avec l'origine
   de chaque achat.
10. Dans la **Caisse**, les ventes Boutique apparaissent dans le journal, marquées « Boutique ». Un nouvel onglet
    **« Boutique »** montre les comptes Boutique Cigares et Boutique Champagne.
11. **Annulation** d'une vente Boutique par l'administrateur, ou par l'associé à qui elle appartient, avec un motif.
12. **Photos** des produits : les cigares les ont déjà ; on doit pouvoir en ajouter aux bouteilles de champagne, depuis
    la Boutique comme depuis Stocks & Cave.
13. Un nouveau rôle d'utilisateur, **« Associé »**, rattaché à un rayon (Cigares ou Champagne).

## Non-objectifs

- Définir ce que le **gérant** peut voir et faire en général : le propriétaire le fera **plus tard**, dans un projet à
  part. Ici, le gérant garde ses droits actuels, plus la vente Boutique (voir « Droits »).
- Prix propres à la Boutique, remises, promotions.
- Vente en ligne, livraison, réservation de produits.
- Prix d'achat, marges, partage des bénéfices entre associés.
- Mélanger cigares et champagne sur un même ticket.
- Faire repasser un membre en client régulier.

## Anti-objectifs (ce serait un échec même si « ça marche »)

- Un associé qui peut modifier les produits, ou annuler les ventes, **de l'autre** associé.
- Des ventes Boutique qu'on ne peut plus distinguer des consommations en séance dans les comptes.
- Un client régulier qui **perd son historique** en devenant membre.
- Des données personnelles enregistrées pour un client journalier, ou un envoi WhatsApp qui lui serait proposé.
- Un client régulier qui apparaît là où seuls les membres ont leur place : réservation de salle, abonnements,
  renouvellement automatique, carte membre, compteurs de membres de l'accueil.
- Des chiffres de caisse existants qui changent pour les séances (la Boutique s'ajoute, elle ne déplace rien).

## Droits

Il y a trois sortes de comptes, chacun tenu par une personne différente (jamais deux rôles pour une même personne) :

- **Administrateur** : la personne qui fait l'application. Elle a tous les droits.
- **Associé** : les **deux patrons du club**, l'associé Cigares et l'associé Champagne. Un associé a **tous les droits
  de l'administrateur dans le club**, avec deux exceptions :
  1. Il n'a **pas accès à l'Administration de l'application** : les utilisateurs, les réglages du club, l'effacement
     des données et l'espace démo restent réservés à l'administrateur. **Exceptions** décidées le 2026-10-29 : la
     comptabilité (Trésorerie & Bilans, Grand livre, Clôture mensuelle) et le **journal des opérations** s'ouvrent
     aux associés (le journal est une sécurité : savoir qui a fait quoi). Voir « Liste des droits validée ».
  2. Dans la Boutique, il **ne modifie et n'annule que ce qui est à lui** : ses produits (fiche, prix, photo, stock)
     et ses ventes. Il **voit** les produits et les ventes de l'autre associé, mais ne peut pas les toucher.
- **Gérant** : l'employé des associés. Il garde **ses droits actuels**, et il peut en plus **vendre à la Boutique**.
  Le propriétaire décidera **plus tard**, dans un projet à part, ce que le gérant peut voir et faire en général (« gérer
  le club sans avoir accès à l'intégralité des comptes »). Ce projet n'en anticipe rien.

| Action | Administrateur | Associé (son rayon) | Associé (l'autre rayon) | Gérant |
|---|---|---|---|---|
| Voir la Boutique (les deux onglets) | oui | oui | oui, consultation | oui |
| Vendre à la Boutique | oui | oui | non | oui |
| Annuler une vente Boutique | oui | oui | non | non |
| Voir et consulter le stock | oui | oui | oui | oui (comme aujourd'hui) |
| Créer et modifier un produit, son prix, sa photo, son stock | oui | oui | non | comme aujourd'hui (stock en hausse seulement, pas de photo) |
| Onglet Caisse › Boutique (les deux comptes) | oui | oui | oui | **non** |
| Ventes Boutique du jour dans « Recettes du jour » | oui | oui | oui | oui (il compte le tiroir) |
| Créer un client régulier, le passer en membre | oui | oui | oui | oui (comme pour les membres) |
| Tout le reste du club (salles, agenda, membres, cartes, abonnements, caisse complète, dépenses, clôture…) | oui | oui | oui | comme aujourd'hui |
| Trésorerie & Bilans, Grand livre, Clôture mensuelle | oui | oui | oui | non |
| Journal des opérations | oui | oui | oui | non |
| Menu « Administration » (utilisateurs, réglages, données, démo) | oui | **non** | **non** | non |

« Son rayon » : Cigares pour l'associé Cigares (produits `cigare`, sous-compte `cigares`) ; Champagne pour l'associé
Champagne (produits `bouteille`, sous-compte `alcool`). Le propriétaire a confirmé que **toutes les bouteilles sont du
champagne**.

Conséquence technique : aujourd'hui, une action est soit ouverte à tout utilisateur connecté, soit réservée à
l'administrateur (`ADMIN` dans `worker/api.js`, et des contrôles `role === 'admin'` dans `worker/club.js`,
`worker/ledger.js` et le front). Chaque action réservée à l'administrateur est rangée dans l'une de deux familles.

### Liste des droits validée (propriétaire, 2026-10-29)

**Administration de l'application : reste à l'administrateur seul.**
- Utilisateurs : liste, création, rôle, mot de passe (`/api/users*`).
- Effacement des données (`/api/admin/reset`) et espace démo (`/api/demo/reset`).
- Réglages du club (`PUT /api/settings`) : identité, journée et créneaux, tarif du temps supplémentaire, règles
  d'exploitation, textes du ticket, moyens de paiement. Formules d'abonnement (`PUT /api/plans/:id`). Salles : créer,
  modifier, supprimer (`/api/rooms`). Catégories de dépenses (`/api/ledger/categories`). Soldes d'ouverture
  (`POST /api/treasury/fund`).

**Gestion du club : s'ouvre aussi aux associés.**
- Caisse complète sur toute période (`GET /api/finance/summary`, vue administrateur de la Caisse), compter la caisse
  (`POST /api/treasury/count`), rouvrir une journée fermée (`POST /api/day-closing/:day/reopen`).
- Comptabilité : Trésorerie & Bilans (`GET /api/treasury`), Grand livre (`GET /api/ledger/book`), Clôture mensuelle
  (`/api/closings*`, y compris clôturer et rouvrir un mois).
- Journal des opérations (`GET /api/audit`).
- Dépenses et entrées : sans les limites du gérant (montant, date, nature, `worker/ledger.js`), annulation
  (`POST /api/ledger/entries/:id/cancel`).
- Abonnements : annuler, corriger le crédit temps (`/api/subscriptions/:id/cancel|adjust`).
- Annuler un repas extérieur ou une recharge de carte (`/api/payments/:id/cancel-meal|cancel-recharge`).
- Corriger l'heure de départ d'une séance.
- Rembourser, y compris quand `refunds_admin_only` est coché, et rembourser des lignes autres que des produits.
- Historique des tickets (`GET /api/ticket-events`) et ce que l'administrateur voit aujourd'hui sur un ticket.
- Humidors : créer, modifier, annuler un relevé.
- Produits : créer, modifier (prix compris), photo, baisser le stock (`/api/products*`), **seulement pour son
  rayon**. Il voit ceux de l'autre rayon sans pouvoir les modifier.
- Exports encore présents (`GET /api/export/:kind`).

**Règle du rayon en séance : pas de limite** (décision du propriétaire, 2026-11-06). La règle du rayon ne s'applique
qu'à la Boutique et aux produits (fiche, prix, photo, stock, que ce soit en hausse ou en baisse). En séance, un associé
fait tout ce que fait l'administrateur, sur les deux rayons : il ajoute, annule et rembourse des lignes de cigares
comme de champagne, comme le gérant sert tout ce que le client demande. L'argent va toujours au compte du produit
(cigare → Cigares, bouteille → Alcool), quelle que soit la personne qui saisit la ligne. Le contrôle du rayon reste
écrit à un seul endroit.

Le menu d'un associé est celui de l'administrateur, sans « Administration ». Trésorerie & Bilans, Grand livre,
Clôture mensuelle et le journal des opérations lui sont accessibles depuis la Caisse (pour l'administrateur, ils
restent aussi rangés sous Administration). En se connectant, l'associé arrive sur l'Accueil.

L'administrateur crée les comptes des associés dans Administration › Utilisateurs : rôle « Associé » et choix du rayon
(Cigares ou Champagne). Les règles actuelles sur les utilisateurs restent valables (au moins un administrateur actif,
sessions fermées quand le rôle change).

## Les écrans

### 1. Boutique (nouveau menu, maquette 1)

- Le menu « Opérations » devient : Accueil, Salles, Agenda, Membres / Clients, **Boutique**, Stocks & Cave, Caisse.
- La page a deux onglets : **Cigares** (produits `cigare`) et **Champagnes** (produits `bouteille`). Seuls les produits
  **actifs** apparaissent.
- Une recherche filtre les produits par nom. Il faut utiliser la recherche intelligente déjà en place
  (`smartFilter` dans `shared/search.js`, composant `SmartSearch` dans `src/components/ui/SmartSearch.jsx`).
- Chaque produit s'affiche en carte : **photo** (ou un emplacement vide), nom, prix, stock, bouton « Ajouter ».
  - Un produit **sans photo** affiche « + Ajouter une photo » à ceux qui ont le droit de la changer (administrateur,
    associé du rayon). Il réutilise le même envoi de photo que la fiche produit (`preparePhoto`,
    `PUT /api/products/:id/photo`). C'est refusé en mode démo, comme aujourd'hui.
  - Un produit **en rupture** (stock 0) ne peut pas être ajouté. C'est important : le stock réel des cigares est
    aujourd'hui à 0 par choix du propriétaire, donc aucune vente ne sera possible tant que le stock n'est pas saisi.
- **Chaque onglet a son propre panier**. Changer d'onglet ne vide pas l'autre panier.
- Le panneau de vente contient, dans cet ordre :
  1. Le titre « Vente de cigares » ou « Vente de champagne », et une étiquette du compte : « Compte Cigares ·
     Boutique » ou « Compte Alcool · Boutique ».
  2. L'**acheteur** : trois boutons, « Client journalier » (choisi par défaut), « Client régulier » et « Membre ».
     Pour un client régulier ou un membre, on le cherche dans la liste, avec la même recherche que la page Membres. On
     peut aussi créer un client régulier sur place. Seuls les membres **actifs** et les clients **actifs** sont
     proposés.
  3. Les **lignes** : produit, quantité avec − et +, montant. On ne vend que des quantités entières de 1 à 99, comme
     en séance.
  4. Le **total**.
  5. Le **paiement** : les moyens de la caisse. Pour un membre, il y a en plus « Carte membre », qui affiche son
     solde. La carte paie ce qu'elle peut. S'il reste quelque chose à payer, on choisit un autre moyen pour ce reste,
     comme dans le dialogue de paiement actuel.
  6. Le bouton **« Encaisser N FCFA »**.
  7. Une ligne qui annonce le ticket : « Ticket imprimé au format ticket de caisse » pour un client journalier,
     « Ticket : imprimé ou envoyé sur WhatsApp » sinon.
- Après l'encaissement, le ticket s'ouvre, comme après un encaissement aujourd'hui. Pour un client journalier, il n'y
  a pas de bouton WhatsApp.
- Le stock est vérifié **au moment d'encaisser**, côté serveur. Si un produit manque, on affiche l'erreur actuelle
  (`STOCK_INSUFFISANT`) et rien n'est enregistré.
- Une journée **clôturée** refuse la vente, comme tout encaissement (`assertOpen`).
- Un membre **en séance** peut quand même acheter à la Boutique, par exemple un cigare à emporter. Quand on le
  choisit comme acheteur, un rappel s'affiche : « Ce membre est en séance : pour une consommation sur place,
  ajoutez-la à sa séance. » La vente reste une vente Boutique.

### 2. Membres / Clients (maquette 2)

- Le menu « Membres » est renommé **« Membres / Clients »**. La page a deux onglets : **Membres**, qui montre la liste
  actuelle sans aucun changement, et **Clients réguliers**.
- L'onglet Clients réguliers contient :
  - le bouton « + Nouveau client régulier » ;
  - une recherche ;
  - une liste avec, pour chaque client : numéro, nom, téléphone, nombre et total des achats, date du dernier achat,
    boutons « Fiche » et « Passer en membre ».
- Une phrase rappelle que les clients journaliers n'ont pas de fiche, et que leurs achats se trouvent dans
  Caisse › Boutique.
- **Fiche d'un client régulier** :
  - les mêmes informations qu'un membre (prénom, nom, téléphone obligatoire, courriel, notes), avec les mêmes règles
    d'écriture des noms ;
  - un numéro **C-0001, C-0002…** ;
  - pas de carte, pas d'abonnement, pas de réservation ;
  - l'historique des achats ;
  - la désactivation et la réactivation, comme pour un membre.
- **Passer en membre** : une fenêtre de confirmation dit que la personne reçoit un numéro de membre (M-…) et une carte
  membre, et qu'elle garde ses N achats. Une fois confirmé :
  - elle quitte l'onglet Clients réguliers et apparaît dans Membres ;
  - sa fiche garde ses achats ;
  - elle affiche « ancien client régulier C-0007 » et la date du passage.
  - On ne peut pas revenir en arrière.
  - Le passage est journalisé (audit).

### 3. Historique des achats (maquette 3)

- C'est une nouvelle section **« Historique des achats »** sur la fiche d'un membre et sur celle d'un client régulier.
- Elle montre **les produits achetés** (lignes `produit`), du plus récent au plus ancien. Pour chaque ligne :
  - la date et l'heure ;
  - le produit et la quantité ;
  - le montant ;
  - l'**origine** : Boutique ou Séance (avec le n° de réservation) ;
  - le compte : Cigares ou Alcool ;
  - le moyen de paiement ;
  - le lien vers le ticket.
- Il y a trois filtres (**Tout / Boutique / Séance**) et une ligne de total.
- Les achats faits **en tant que client régulier**, avant le passage en membre, restent dans l'historique et sont
  signalés comme tels.
- Une ligne annulée ou remboursée reste visible, avec son état.
- Les salles et les abonnements gardent leurs sections actuelles : cet historique ne concerne que les produits.

### 4. Caisse, onglet « Caisse » (maquette 5)

La page Caisse a désormais deux onglets : **Caisse**, qui contient tout le contenu actuel, et **Boutique**. Dans
l'onglet Caisse :

- **Soldes** : rien ne change dans les calculs, car la Boutique est de l'argent reçu comme un autre. On ajoute sous
  « Recettes » une mention « dont Boutique N ».
- **Recettes** : un nouveau groupe **« Boutique »** apparaît à côté de « Ventes et réservations ». En tête du groupe,
  deux sous-totaux : Boutique Cigares et Boutique Champagne. Chaque ligne de vente montre :
  - l'heure ;
  - une étiquette « Boutique Cigares » ou « Boutique Champagne » ;
  - le ou les produits ;
  - l'acheteur, avec son étiquette de type : client journalier, client régulier ou membre ;
  - le moyen de paiement ;
  - le lien vers le ticket.
  Une vente Boutique payée **entièrement par carte membre** va dans « Payé par carte membre, non compté », avec son
  étiquette Boutique, comme les séances aujourd'hui. Une vente annulée suit la présentation actuelle des annulations.
- **Détails par sous-compte** : les cartes Alcool et Cigares, et le total, séparent l'argent **Séances** de l'argent
  **Boutique**. On garde les chiffres actuels (Facturé, Encaissé carte membre comprise, Remboursé, Net, Reste à
  payer) et on sépare chacun en Séances et Boutique : les chiffres des séances ne changent pas. La maquette 5, qui
  montre un seul montant « hors carte membre », ne fait pas foi sur ce point.
- **Gérant** : sa caisse du jour (« Recettes du jour ») montre aussi le groupe Boutique du jour, sans l'onglet
  Boutique et sans les sous-totaux par associé.

### 5. Caisse, onglet « Boutique » (maquette 4)

- Cet onglet est réservé à l'**administrateur** et aux **associés**.
- Il utilise le même choix de période que le reste de la caisse (Aujourd'hui, 7 jours, Ce mois, Du / au).
- Il est divisé en deux colonnes : **Boutique Cigares** (compte Cigares) et **Boutique Champagne** (compte Alcool).
  Chaque colonne montre :
  - le total de la période et le nombre de ventes ;
  - le total **par type d'acheteur** (clients journaliers, clients réguliers, membres) ;
  - le total **par moyen de paiement**, avec « Carte membre » à part ;
  - la liste des ventes de la période, avec un lien vers chaque ticket ;
  - pour l'administrateur et l'associé concerné, un bouton « Annuler » sur chaque vente.
- Une annulation compte comme dans l'onglet Caisse :
  - la vente reste dans la période où elle a été faite, marquée « annulée » ;
  - l'argent rendu compte le jour de l'annulation, en ligne négative dans la période qui contient ce jour ;
  - le même jour, les deux s'annulent : la ligne reste visible, barrée, et compte 0.
  Les totaux d'une période passée ne changent donc pas après coup et restent d'accord avec l'onglet Caisse.
- Une note rappelle :
  - que ces ventes comptent aussi dans les comptes Cigares et Alcool de l'onglet Caisse ;
  - qu'une vente payée par carte ne fait pas entrer d'argent en caisse, puisque cet argent est entré au rechargement
    de la carte.

### 6. Annulation d'une vente Boutique

- Elle est faite par l'**administrateur** ou par l'**associé du rayon**, et un **motif** est obligatoire.
- On annule **toute la vente** en une fois, pas ligne par ligne. Cela :
  - remet les produits dans le stock ;
  - fait sortir de la caisse ou du compte l'argent reçu (le jour de l'annulation, comme un remboursement) ;
  - rend sur la carte du membre la part payée par carte ;
  - fait afficher « annulé » au ticket, sur la page de vérification publique comme dans l'application ;
  - est journalisé : qui, quand, motif.
- L'argent ressort **par le moyen qui a servi à payer** (espèces, MTN MoMo…). On ne choisit pas le moyen au moment
  d'annuler.
- Il n'y a **pas de limite de temps**. Si c'est fait le même jour, la vente disparaît des totaux du jour. Si c'est
  fait un autre jour, l'argent sort le jour de l'annulation : la Caisse de ce jour-là montre l'annulation, avec qui l'a
  faite et le motif. Le gérant comprend ainsi pourquoi de l'argent est sorti. Les journées déjà clôturées ne changent
  pas.

### 7. Ticket

- C'est le ticket actuel : même numéro « T-… », code de contrôle, QR, réimpression et historique des impressions.
- La ligne « Client » affiche :
  - « Client journalier » pour un client journalier ;
  - « Prénom NOM (C-0003) » pour un client régulier ;
  - le nom et le numéro actuels pour un membre.
- La page publique de vérification n'affiche jamais de donnée personnelle (règle actuelle).
- La ligne « payé pour » indique **« boutique cigares »** ou **« boutique champagne »**.
- Pour un client journalier, pas de bouton WhatsApp.

### 8. Accueil, visite guidée, mode démo

- Les textes qui citent les rubriques (visite guidée) suivent le nouveau menu.
- En **mode démo**, la Boutique marche comme le reste :
  - la démo part vide, comme aujourd'hui : on y crée soi-même des clients réguliers et des ventes pour essayer, rien
    n'est pré-rempli ;
  - pas de changement de photo ;
  - « Remettre la démo à neuf » efface aussi les clients et les ventes Boutique de démo.

## Contraintes

- Les écrans sont en français, avec le ton et la mise en forme actuels (clair et sombre). Ils doivent marcher sur
  téléphone et sur tablette.
- Le dépôt est **public** : on n'y met ni numéros de téléphone réels, ni photos de produits, ni texte de fabricant.
- Les changements de base de données passent par une nouvelle version de migration : **V18 et suivantes** dans
  `worker/schema.js`. Les données existantes ne doivent pas bouger : séances, paiements, tickets, chiffres de caisse
  des jours passés.
- Les règles actuelles restent valables :
  - les moyens de paiement viennent des Paramètres ;
  - une journée clôturée ne bouge plus ;
  - le solde de la carte ne passe jamais sous 0 ;
  - le stock est vérifié côté serveur.
- Tests : `npm test` (`node --test test/*.test.js`). On ajoute des tests serveur pour :
  - la vente, l'annulation et les droits par rôle et par rayon ;
  - l'historique et le passage client régulier → membre ;
  - les chiffres de caisse avec et sans Boutique.
- Le propriétaire approuve lui-même chaque commit, chaque push et chaque mise en ligne.

## Ce qui est laissé au développeur

Ces points sont libres, à condition de respecter le comportement décrit plus haut :

- **Comment ranger les clients réguliers.**
  - Recommandation : les garder dans la table `members`, avec une colonne de type (membre / client régulier). Leurs
    achats portent alors le même `member_id`, et le passage en membre ne déplace rien.
  - Il faut ensuite vérifier **chaque** requête qui lit `members` (listes, éligibilité salle, abonnements,
    renouvellement, cartes, accueil, export, démo) pour en exclure les clients réguliers là où ils n'ont pas leur place.
  - Le numéro C-… doit avoir son propre compteur.
- **Comment enregistrer une vente à un client journalier**, alors que `charges.member_id` et `payments.member_id` sont
  `NOT NULL` aujourd'hui. Deux pistes :
  - une seule fiche système cachée « Client journalier » ;
  - rendre ces colonnes facultatives et adapter les jointures `INNER JOIN members`. La liste est dans le relevé du code
    (`club.js` 131, 1439, 2747, 2807, 2945, 3347, 3364, 3369).
  Dans les deux cas, aucune donnée personnelle n'est demandée.
- **Comment marquer l'origine** (Séance / Boutique) d'une vente : colonne sur les lignes et/ou sur le paiement. Une
  vente Boutique n'a pas de réservation.
- **Comment annuler une vente entière** : nouveau traitement, ou réutilisation de `writeRefund` ligne par ligne sous
  une seule action. L'effet visible doit être celui décrit plus haut.
- **Comment le rôle associé est stocké** : rôle `associe`, plus le rayon sur l'utilisateur. La contrainte `CHECK` sur
  `users.role` oblige à reconstruire la table, comme dans V15. Le rôle doit aussi exister dans l'espace démo
  (`mirrorUsers`).
- **Comment la caisse et `financeSummary` séparent Séances et Boutique**, et comment l'onglet Boutique obtient ses
  chiffres (nouvelle route, ou extension des routes actuelles).
- Le découpage en composants, et la réutilisation du dialogue de paiement et de la recherche.

## Choix faits pendant la conception (à vérifier à la relecture)

- Le client journalier est l'acheteur par défaut.
- Un membre en séance peut acheter à la Boutique, avec un rappel à l'écran.
- L'annulation rend l'argent par le moyen d'origine, sans limite de temps.
- La carte d'un membre paie ce qu'elle peut, le reste par un autre moyen (même règle qu'en séance).
- Un client régulier peut être désactivé comme un membre. Un membre ne repasse pas client régulier.
- L'historique des achats ne montre que les produits.
- Le gérant peut créer un client régulier et le passer en membre, comme il crée des membres aujourd'hui.
- Le gérant voit les ventes Boutique du jour dans sa caisse du jour, sans les totaux par associé.

Ajoutés le 2026-10-29, à la relecture avant construction :
- Les détails par sous-compte gardent les chiffres actuels, carte membre comprise, séparés en Séances et Boutique.
- Dans l'onglet Boutique, une annulation compte comme dans l'onglet Caisse : vente dans sa période, argent rendu
  le jour de l'annulation.
- La démo n'est pas pré-remplie de clients réguliers ni de ventes.
- En attendant la réponse sur le rayon en séance, la règle du rayon ne vaut qu'à la Boutique et pour les fiches
  produits.
- Pour les associés, la comptabilité et le journal s'ouvrent depuis la Caisse.
