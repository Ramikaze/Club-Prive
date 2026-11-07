# Crédit des clients réguliers et fiche de créance

Date : 2026-11-07. Statut : écrit sans questions, à la demande de l'utilisateur (« commence sans questions »). Chaque
choix qui n'a pas été dit par le propriétaire est marqué **(mon choix)** : le propriétaire les relit avant la fusion.

## Pourquoi

Le propriétaire : « Les clients réguliers peuvent acheter à crédit. Ils auront une fiche de créance client. Ce sont des
clients qui ne sont pas membres, mais qui sont des clients réguliers et qui achètent régulièrement. »

La réunion des associés du 2026-11-06 a signalé 5 à 6 millions de FCFA de créances clients restées dans Digibox
(BureauTech, des restaurants) : le suivi doit être meilleur ici. Il faut savoir à tout moment qui doit combien, depuis
quand, et ce qu'il a déjà payé.

## Ce qui existe déjà

- Les clients réguliers (fiches C-…, onglet « Clients réguliers ») achètent à la Boutique ; chaque vente est payée tout
  de suite.
- Une ligne « à encaisser » (note non payée) ne compte dans aucune caisse tant qu'elle n'est pas payée (spec
  `2026-11-07-caisses-associes-design.md`). Une ligne payée compte dans la caisse de son rayon le jour du paiement.

## Ce qui change

1. **Plafond de crédit par client (mon choix).** Chaque client régulier a un plafond, en FCFA, réglé par
   l'administrateur ou un associé sur sa fiche. Par défaut il vaut 0 : le client n'a pas de crédit. Une vente à crédit
   est refusée si ce qu'il doit déjà plus la vente dépasse son plafond ; le message dit combien il doit, le plafond et
   ce qui reste possible. Personne ne passe outre : un associé relève d'abord le plafond.
2. **Vendre à crédit, à la Boutique.** Quand l'acheteur est un client régulier qui a un plafond, le panneau de vente
   propose « À crédit » à côté des moyens de paiement, avec « Crédit disponible : X ». La vente sort du stock comme
   d'habitude, mais aucun argent n'entre : ses lignes restent « à payer » sur la fiche du client. Peut vendre à crédit
   toute personne qui peut vendre dans le rayon, le gérant compris (mon choix : le plafond, fixé par les associés, est
   le garde-fou). Pas de ticket de caisse pour une vente à crédit (aucun argent reçu) ; la vente apparaît sur la fiche.
3. **Fiche de créance (compte client).** Sur la fiche du client, un bloc « Compte client » montre : ce qu'il doit, son
   plafond, le crédit encore disponible, et un relevé dans l'ordre des dates : achats à crédit (montant dû +),
   règlements (−), annulations, avec le solde après chaque opération. Chaque règlement a son ticket.
4. **Règlement, entier ou partiel.** « Enregistrer un règlement » : un montant (au plus ce que le client doit) et un
   moyen de paiement (Espèces, MTN MoMo…). Tout le monde peut l'enregistrer, le gérant compris (comme un encaissement).
   Le montant paie les achats à crédit **du plus ancien au plus récent** (mon choix) ; le dernier peut n'être payé
   qu'en partie. Un ticket de caisse est créé, comme pour tout encaissement.
5. **Caisses des associés et recette.** Une vente à crédit ne compte dans aucune caisse tant qu'elle n'est pas réglée
   (règle déjà en place pour les notes). Un règlement compte, le jour où il est reçu, dans la caisse du rayon de chaque
   achat qu'il paie : la part qui paie du champagne va dans Champagne et autres boissons, celle qui paie des cigares dans
   Cigare. Dans les chiffres « facturé / encaissé / reste à payer », la vente est facturée le jour de la vente,
   encaissée le jour du règlement. Le Solde en caisse et la règle centrale des caisses ne changent pas.
6. **Annuler un règlement** (erreur de saisie) : l'administrateur ou un associé, avec un motif. L'argent ressort le jour
   de l'annulation, de la caisse où il était entré (refusé si cette caisse ne contient pas assez, comme tout
   remboursement) ; les achats qu'il payait redeviennent dus. Le ticket du règlement est marqué annulé.
7. **Annuler une vente à crédit** : comme toute vente Boutique (administrateur ou associé, avec motif, marchandise
   remise en stock). La partie encore due est effacée de la dette ; la partie déjà réglée est rendue au client par le
   moyen de paiement de son règlement (mon choix, comme l'annulation d'une vente payée aujourd'hui).
8. **Liste des clients réguliers** : une colonne « Doit » et, en tête, le total des créances clients.
9. **Passer en membre** est refusé tant que le client doit de l'argent (mon choix : la créance reste attachée à une
   fiche de client, jamais mélangée aux notes des membres). **Désactiver** reste possible ; la dette reste visible et
   un règlement peut toujours être enregistré.
10. **Vente Boutique, onglet Caisse › Boutique** : une vente à crédit apparaît avec le moyen « À crédit ».

## Non-objectifs

- **Reprise des créances Digibox** : pas dans ce projet. Il faut d'abord savoir, du propriétaire, quels clients, quels
  montants, et dans quelle caisse doit entrer l'argent quand ils paieront (argent commun ou d'un associé). La fiche de
  créance est prête à recevoir plus tard une « créance de départ ».
- Pas de crédit pour les membres (ils ont leur carte) ni pour le client journalier.
- Pas d'intérêts, pas d'échéance, pas de relance automatique.
- Pas de comptes fournisseurs (projet à part, en attente des données des associés). Le relevé est présenté sous une
  forme réutilisable (date, opération, dû, réglé, solde) pour qu'ils prennent la même forme.

## Anti-objectifs

- Une vente à crédit comptée dans une caisse avant d'être payée (un associé pourrait dépenser de l'argent absent).
- Un client qui dépasse son plafond.
- Une dette qui disparaît sans trace : tout règlement, annulation et changement de plafond est au journal des
  opérations, avec son auteur.
- Un règlement partiel qui fausse les caisses : chaque franc reçu va dans la caisse de l'achat qu'il paie.

## Construction (choix du constructeur)

- Migration V21 : `members.credit_limit`, `shop_sales.on_credit`, `charges.settled` (part déjà réglée d'une ligne),
  `payments.settlement` ; `payment_allocations` et `refunds` perdent leur unicité par ligne (une ligne peut être payée en
  plusieurs fois, et un règlement annulé puis refait).
- Un règlement est un encaissement ordinaire (`payments` + `payment_allocations`, montant partiel possible sur une
  ligne) : trésorerie, grand livre, caisses et tickets le comptent sans code à part. Son annulation passe par des
  remboursements datés du jour : mêmes protections (jour clôturé, caisse jamais négative).
- Les lignes d'une vente à crédit ne passent jamais par l'encaissement ordinaire des notes (refusé), seulement par le
  règlement ; elles ne figurent pas dans « Reste à encaisser » des notes de séance.
- Le mode démo se comporte de la même façon.
