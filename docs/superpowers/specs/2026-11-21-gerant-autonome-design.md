# Gérant autonome : payer les fournisseurs et prendre des bénéfices — conception

Demande du propriétaire (2026-11-21) : « Le gérant doit également être en mesure, avec son compte, de payer les
fournisseurs et de prendre des bénéfices sur les soldes. » Pourquoi : « Il doit pouvoir être autonome lorsqu'ils [les
associés] ne sont pas présents, c'est tout. » Il n'a pas voulu d'autres questions (« commence à travailler ») : les
points marqués **(mon choix)** sont ceux de Claude, à relire.

## Aujourd'hui

- Le gérant voit les tuiles « Soldes » du jour (PR #98), sans aucun bouton.
- Il enregistre seulement des dépenses du jour, de 5 000 FCFA au plus (`MANAGER_EXPENSE_MAX`).
- Le serveur lui refuse le paiement d'un fournisseur suivi (`supplierPayment`), la prise de bénéfices (`takeProfits`,
  route réservée `CLUB`) et la liste des fournisseurs (`GET /api/suppliers`, `CLUB`).
- Il n'annule aucune opération (route `CLUB`).

## Ce qui change

1. **Tuiles « Soldes » du gérant** : « Payer un fournisseur » sur Cigare et sur Champagne et autres boissons ;
   « Prendre des bénéfices » sur les trois caisses. Pas de « Faire un apport ».
2. **Prise de bénéfices par le gérant, sur n'importe quelle caisse** **(mon choix)** : il agit pour l'associé absent.
   L'argent de la caisse Cigare revient à l'associé Cigares, celui de Champagne et autres boissons à l'associé
   Champagne, celui de Réservation de séance moitié à chacun (partage existant). Un associé, lui, reste limité à sa
   caisse et à la caisse commune.
3. **Paiement d'un fournisseur suivi par le gérant** : depuis la caisse du fournisseur, jamais plus que ce que le club
   lui doit. Le plafond de 5 000 FCFA ne s'applique pas à ce paiement **(mon choix)** ; il reste pour toute autre
   dépense du gérant, y compris un achat payé comptant sans fournisseur suivi.
4. **Garde-fous inchangés** : seulement l'argent disponible (validé par la vérification, `assertCaisseCovers`) ; une
   journée fermée ou un mois clôturé refuse ; le journal des opérations garde le nom du gérant. Pour le gérant, la
   date est toujours celle du jour **(mon choix, comme ses dépenses)**.
5. **Liste des fournisseurs lisible par le gérant** (`GET /api/suppliers` : nom, caisse, ce que le club doit), pour
   choisir qui il paie **(mon choix)**. La page Fournisseurs (relevés, fiches, achats) reste aux associés et à
   l'administrateur, comme le menu.
6. **Restent aux associés et à l'administrateur** **(mon choix : non demandé)** : annuler une opération, faire un
   apport, enregistrer un achat ou un solde reporté chez un fournisseur, saisir une autre date que le jour.

## Approches

- **A, retenue** : ouvrir au gérant les deux portes existantes (`POST /api/ledger/entries` avec `supplier_id`,
  `POST /api/caisses/retrait`) avec ses limites, et lui donner les boutons des tuiles. Un seul chemin de code et les
  mêmes règles pour tout le monde.
- B : une porte à part pour le gérant (une « remise à l'associé ») : double le code et les règles, sans gain.
- C : une demande du gérant validée ensuite par un associé : contraire à l'autonomie demandée.

## Non-buts

- Pas de plafond chiffré pour ces deux opérations : les limites sont la caisse disponible et la dette du fournisseur.
- Pas de notification à l'associé : le journal et les tuiles suffisent pour l'instant.
- Pas d'annulation par le gérant : une erreur se corrige par un associé ou l'administrateur, même à distance.

## Écrans

- **Caisse du gérant** : les boutons sur les tuiles ; le bloc « Bénéfices pris » du jour s'affiche (sans ✕) ; le
  bandeau du haut dit ses nouveaux gestes.
- **Fenêtre de dépense** : le gérant choisit le fournisseur suivi, avec ce que le club lui doit ; sans fournisseur, le
  plafond de 5 000 FCFA s'affiche comme avant.
- **Fenêtre « Prendre des bénéfices »** : pour le gérant, pas de champ date (« Date : aujourd'hui »).

## Tests

- Serveur : le gérant prend des bénéfices sur les trois caisses, le jour même ; refusé à une autre date ; refusé
  au-delà du disponible. Il paie un fournisseur suivi au-delà de 5 000 FCFA ; sans fournisseur, toujours plafonné ;
  jamais plus que la dette. Il lit la liste des fournisseurs, pas leur fiche, et n'en crée pas.
- Tuiles : les boutons du gérant.
