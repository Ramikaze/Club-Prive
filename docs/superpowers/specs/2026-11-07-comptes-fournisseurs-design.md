# Comptes fournisseurs

Date : 2026-11-07. Statut : écrit à la demande de l'utilisateur, qui relaie le propriétaire (« Lance la création, on
verra plus tard tous ces détails »). Deux points ont été décidés par le propriétaire (ci-dessous). Chaque autre choix
est marqué **(mon choix)** : le propriétaire les relit avant la fusion.

## Pourquoi

La réunion des associés du 2026-11-06 a demandé deux comptes fournisseurs de test pour suivre les dettes du club. Les
fournisseurs sont en Europe et au Liban. Ils sont payés en euros ou en dollars. Le club leur achète à crédit, et des
soldes déjà dus sont reportés. Une dette d'un fournisseur de cigares se paie seulement depuis la caisse Cigare
(« zéro compensation » entre caisses).

Aujourd'hui l'application connaît le bouton « Payer un fournisseur » sur les tuiles des associés (une dépense de la
caisse, catégorie « Achats … »), mais elle ne sait pas ce que le club doit à chaque fournisseur.

## Décisions du propriétaire (2026-11-07)

1. **Les comptes fournisseurs sont tenus en FCFA.** « On pourra mettre entre parenthèses le montant en USD ou en euros,
   mais juste pour information. » Le montant en devise n'entre dans aucun calcul ; il n'y a pas de taux de change.
2. **Un fournisseur appartient à une seule caisse** : un fournisseur de cigares est payé seulement depuis la caisse
   Cigare ; un fournisseur de champagne ou d'autres boissons seulement depuis la caisse Champagne et autres boissons.

Repris du projet des caisses (spec `2026-11-07-caisses-associes-design.md`) : on ne paie pas un fournisseur plus que ce
que contient sa caisse ; aucune caisse ne passe en négatif ; un associé absent ne bloque rien, l'autre peut agir sur sa
caisse et ça se voit (fenêtre qui dit de quelle caisse sort l'argent, journal avec le nom de l'auteur).

## Ce qui change

1. **Une entrée « Fournisseurs » dans le menu de gauche, avec sa propre icône** (décision du propriétaire, 2026-11-07,
   sur capture du menu : « Les fournisseurs s'afficheront ici. Ils auront leur icône. »). Elle se place juste sous
   « Caisse », dans « Opérations », et n'apparaît que pour l'administrateur et les associés **(mon choix pour la
   place et les rôles)**. La page liste les fournisseurs : nom, caisse, pays, devise d'information, ce que le club
   doit. En tête, ce que le club doit en tout, par caisse (Cigare ; Champagne et autres boissons). **(mon choix)**
2. **Fiche fournisseur** : nom, caisse (Cigare ou Champagne et autres boissons), pays ou ville (facultatif), devise
   d'information (aucune, EUR ou USD), contact et notes (facultatifs). Le nom est unique. **(mon choix)** La caisse ne
   se change plus dès que le fournisseur a une opération, sinon ses paiements passés sortiraient d'une autre caisse que
   la sienne. Un fournisseur ne se supprime pas ; il se désactive seulement quand le club ne lui doit plus rien, et il
   reste visible dans la liste (« inactifs »).
3. **Enregistrer un achat à crédit** : date (pas dans le futur), montant en FCFA, montant en devise pour information
   (facultatif), numéro de facture (facultatif), libellé (facultatif). Aucun argent ne bouge : ni le Solde en caisse ni
   les caisses des associés ne changent. Seul ce que le club doit au fournisseur monte. **(mon choix)**
4. **Solde reporté** : la même fenêtre propose « Solde reporté » à la place d'« Achat », pour ce que le club devait
   déjà au fournisseur avant d'utiliser l'application. Il se lit comme un achat dans le relevé, avec son propre nom.
   **(mon choix)**
5. **Payer le fournisseur, en entier ou en partie** : montant en FCFA, au plus ce que le club lui doit **(mon choix)** ;
   moyen de paiement (Espèces, MTN MoMo, Virement…) ; date ; montant en devise pour information ; référence. Le
   paiement est une dépense ordinaire de la caisse du fournisseur, dans la catégorie d'achat : « Achats cigares » pour
   un fournisseur Cigare ; « Achats champagne » ou « Achats autres boissons », au choix dans la fenêtre, pour un
   fournisseur Champagne et autres boissons. Il est refusé si la caisse ne contient pas assez (règle des caisses, déjà
   en place). Il apparaît partout comme les autres dépenses (bloc « Dépenses », ligne « Achats » de la tuile, grand
   livre, trésorerie, résultat), avec le nom du fournisseur.
6. **Le bouton « Payer un fournisseur » des tuiles** propose aussi de choisir le fournisseur, parmi ceux de la caisse,
   avec ce que le club lui doit. Le choix reste facultatif (« Aucun : achat payé comptant »). Avec un fournisseur, le
   paiement s'inscrit sur son relevé. **(mon choix)**
7. **Relevé du fournisseur**, sur sa fiche, même forme que la fiche de créance des clients : **Date, Opération, Dû,
   Réglé, Solde**, dans l'ordre des dates. Opérations : Solde reporté, Achat (avec le n° de facture), Paiement (avec le
   moyen de paiement). Le montant en devise s'affiche entre parenthèses à côté du montant en FCFA. Une opération
   annulée reste visible, barrée, avec son motif, et ne compte plus dans le solde. **(mon choix)**
8. **Annuler** (administrateur ou associé, avec un motif) :
   - un achat ou un solde reporté : refusé si le club a déjà payé plus que ce qui resterait dû ; il faut d'abord
     annuler un paiement. Ainsi le club ne doit jamais un montant négatif **(mon choix)** ;
   - un paiement : c'est l'annulation de la dépense, comme toute opération de la caisse (motif, mois non clôturé, jour
     de caisse non fermé). L'argent revient dans la caisse et la dette revient sur le relevé.
9. **Qui fait quoi (mon choix)** : l'administrateur et les deux associés créent, modifient, enregistrent et paient, sur
   les fournisseurs des deux caisses (règle de l'associé absent). La fenêtre de paiement dit de quelle caisse sort
   l'argent. Le journal des opérations garde chaque création, modification, achat, paiement et annulation, avec son
   auteur. Le gérant ne voit pas l'entrée du menu et ne peut ni enregistrer un achat ni payer un fournisseur suivi.
10. **Mois clôturé** : un achat daté dans un mois clôturé est refusé, comme une dépense. Un jour de caisse fermé ne
    bloque pas un achat (aucun argent ne bouge ce jour-là). **(mon choix)**
11. **Mode démo** : même comportement. La démo part vide : on y crée ses fournisseurs d'essai. Le jeu de données
    fictives (celui des tests) ajoute deux fournisseurs : un fournisseur de cigares en Europe (EUR) et un fournisseur
    de boissons au Liban (USD), avec un solde reporté, des achats et un paiement partiel.
12. **« Effacer toutes les données » et la remise à neuf de la démo** effacent aussi les fournisseurs, comme les
    membres. **(mon choix)**

## Demandes du propriétaire sur la fenêtre « Nouvelle dépense » (2026-11-07, faites dans ce projet)

- **Nouveau type de dépense « Transport »** : « Dans la liste des dépenses, il faut également rajouter le transport. »
  Comme « Entretien et réparations », il demande de quel compte sort le paiement : un transport de cigares peut donc
  sortir de la caisse Cigare. Il est ajouté une seule fois aux bases existantes : s'il est ensuite désactivé ou renommé
  dans Paramètres, l'application ne le recrée pas. **(mon choix)**
- **Intitulés** : « Catégorie » devient « Type de dépense » ; « Payé depuis » devient « Mode de paiement » ; le choix de
  la caisse qui paie (« Sous-compte concerné », puis « Caisse qui paie ») devient « De quel compte sort le paiement ? ».
  La fenêtre « Entrée diverse » garde « Catégorie » et « Reçu sur » **(mon choix)**.

## La règle centrale

**Ce que le club doit à un fournisseur = soldes reportés + achats − paiements**, opérations annulées exclues, au franc
près, et jamais négatif. Les achats ne touchent à aucune caisse ; seuls les paiements en sortent, toujours de la
caisse du fournisseur. La règle centrale des caisses (fond + cartes + trois caisses = Solde en caisse) ne change pas.

## Objectifs

- Savoir à tout moment ce que le club doit à chaque fournisseur, depuis quand, et ce qui a déjà été payé.
- Payer en une ou plusieurs fois, depuis la bonne caisse seulement.
- Lire le montant en euros ou en dollars à côté du montant en FCFA, sans qu'il fausse un calcul.

## Non-objectifs

- Pas de conversion ni de taux de change.
- Pas de lien avec le stock : une entrée de stock et le prix de revient restent à part (projet « prix de revient »).
- Pas d'échéance, de relance ni d'intérêts.
- Pas de fournisseur partagé entre deux caisses ; pas de fournisseur payé depuis la caisse Réservation de séance.
- Pas d'avoir : le club ne peut pas avoir payé plus que ce qu'il doit.
- Les tuiles de « Soldes » ne changent pas (une ligne « Dû aux fournisseurs » pourra s'ajouter plus tard).
- Pas de données réelles dans ce projet : les associés créent eux-mêmes leurs deux fournisseurs de test dans
  l'application.

## Anti-objectifs (ce qui serait un échec même si ça marche)

- Un achat à crédit qui fait bouger une caisse ou le Solde en caisse.
- Un fournisseur payé depuis une autre caisse que la sienne.
- Un fournisseur payé plus que ce que contient sa caisse, ou plus que ce que le club lui doit.
- Un solde fournisseur faux après une annulation.
- Un montant en devise utilisé dans un calcul.
- Une dette qui disparaît sans trace dans le journal.

## Construction (choix du constructeur)

- **Migration V21** (à renuméroter V22 si la branche `feat/credit-clients`, qui ajoute aussi une V21, est fusionnée
  avant) : table `suppliers`, table `supplier_purchases` (achats et soldes reportés), et trois colonnes ajoutées à
  `ledger_entries` : `supplier_id`, `foreign_amount`, `foreign_currency`. Aucune table existante n'est reconstruite.
  Les montants en devise sont des entiers en centimes, comme les montants en FCFA.
- **Un paiement est une dépense** (`ledger_entries`, kind `depense`, `supplier_id` renseigné) : caisses, trésorerie,
  grand livre, résultat et annulation fonctionnent sans code à part. `POST /api/ledger/entries` accepte
  `supplier_id`, vérifie la caisse et la catégorie, et plafonne au montant dû.
- **Routes** : `GET /api/suppliers`, `POST /api/suppliers`, `PUT /api/suppliers/:id`, `GET /api/suppliers/:id` (fiche
  et relevé), `POST /api/suppliers/:id/purchases`, `POST /api/suppliers/purchases/:id/cancel`. Réservées à
  l'administrateur et aux associés.
- **Interface** : entrée du menu `/fournisseurs` (liste, icône camion), fiche `/fournisseurs/:id` (relevé et boutons),
  choix du fournisseur dans la fenêtre « Payer un fournisseur ».
