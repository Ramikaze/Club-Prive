# Caisses des associés dans « Soldes »

Date : 2026-11-07. Statut : validé par le propriétaire le 2026-11-07.

## Pourquoi

Le club a deux associés. L'un vend le champagne et les autres boissons (rayon `alcool`), l'autre les cigares (rayon
`cigares`). Chacun paie ses fournisseurs avec son propre argent : quand un fournisseur de champagne est payé, l'argent
ne peut venir que de l'associé Boissons. Chaque associé doit donc savoir, à tout moment, combien d'argent lui
appartient d'après ce qu'il a vendu de sa marchandise.

Le propriétaire le résume ainsi : « c'est un peu comme s'il y avait plusieurs caisses, chacune associée à son argent
dans sa caisse, en fonction de ce qu'il vend ». La vraie caisse (espèces, MTN MoMo…) ne change pas : on la partage en
caisses virtuelles, une par propriétaire de l'argent.

Aujourd'hui la tuile « Soldes » de la page Caisse montre quatre chiffres (fond de caisse, argent encaissé, dépenses,
solde en caisse) et ne dit pas à qui est l'argent.

## Décisions du propriétaire (2026-11-07, sur maquettes)

Maquettes dans `.superpowers/brainstorm/74978-1794040146/content/` (non versionnées), la dernière validée étant
`transfert-v11.html` (ordre des tuiles, titres, boutons ; son bouton « Transfert des bénéfices » est remplacé par la
décision 5).

1. **La tuile « Soldes » montre six tuiles, dans cet ordre, de gauche à droite :**
   1. **Fond de caisse** : le fond de départ.
   2. **Solde de crédit sur les cartes clients non utilisées** : l'argent mis sur les cartes des membres et pas encore
      dépensé. Il reste « en attente » tant qu'il n'est pas utilisé en séance, boissons ou cigares.
   3. **Réservation de séance** : l'argent commun des deux associés, à parts égales (« une tuile pour les 2 associés à
      part égale »). Elle reçoit les réservations de séance et paie les dépenses communes du club. Elle affiche « soit
      X chacun ».
   4. **Champagne et autres boissons** : l'argent de l'associé Boissons. Lignes : Vendu champagne, Vendu autres
      boissons, Achats champagne, Achats autres boissons, Bénéfices pris.
   5. **Cigare** : l'argent de l'associé Cigares. Lignes : Vendu, Achats cigares, Bénéfices pris.
   6. **Solde en caisse** : tout l'argent présent, tout à droite (tuile mise en avant, comme aujourd'hui).
2. **Les achats de boissons sont séparés** : la catégorie de dépense « Achats boissons » devient deux catégories,
   « Achats champagne » et « Achats autres boissons ». Les deux sortent de la caisse Champagne et autres boissons, sur
   deux lignes distinctes.
3. **« Payer un fournisseur »** : un bouton sur la tuile Champagne et autres boissons et sur la tuile Cigare. Il ouvre
   la dépense avec la bonne catégorie déjà choisie (sur la tuile Boissons, choix entre champagne et autres boissons).
4. **Prise de bénéfices** : quand un associé récupère son argent, c'est une prise de bénéfices, « pas vraiment une
   dépense », « mais c'est vrai qu'il retire de l'argent de la caisse ». Donc : l'argent sort de la caisse réelle
   (le Solde en caisse baisse) et de la caisse de l'associé, mais ce n'est ni une dépense ni une baisse du résultat
   du club. Bouton « Prendre des bénéfices » et ligne « Bénéfices pris » sur les deux tuiles d'associé, et sur
   Réservation de séance (décision 5).
5. **Retrait direct sur Réservation de séance**, pas de transfert entre caisses. La réunion des associés du 6 novembre
   a posé « zéro compensation » entre les caisses, et le propriétaire a choisi le « Retrait direct » (2026-11-07). Le
   « Transfert des bénéfices » d'abord prévu disparaît. La caisse commune a son propre bouton « Prendre des
   bénéfices » : le montant sort de la caisse réelle et se partage moitié-moitié entre les deux associés. Il ne passe
   jamais par les caisses Champagne et autres boissons ou Cigare.
6. **Le bloc « Par catégorie » existant reste** sous « Soldes » (« Recette du jour » en haut à droite, colonne Boisson
   divisée en Champagne | Autres boissons). Il suit le même schéma : même ordre, chaque colonne sous sa tuile de
   « Soldes » (rien sous Fond de caisse ni sous le crédit des cartes).
7. **Un montant ne se coupe jamais sur deux lignes** (défaut vu sur la maquette : « 50 000 » coupé). Seul un titre
   peut passer à la ligne.
8. **Un associé absent ne bloque rien** : « Si un des deux associés n'est pas disponible, il faut que l'autre associé
   puisse manipuler. C'est un cas de figure qui peut arriver. » Un associé peut donc aussi agir sur la caisse de
   l'autre : payer un de ses fournisseurs, rembourser une de ses ventes, annuler une de ses opérations.
9. **On ne paie pas un fournisseur plus que ce que contient la caisse** : « On ne peut pas payer un fournisseur plus
   que ce que la caisse contient. » Si la caisse ne suffit pas, il faut d'abord y remettre de l'argent.
10. **Une caisse ne passe jamais en négatif** : « Une caisse ne peut pas passer en négatif. » Ça vaut pour les trois
    caisses (Réservation de séance, Champagne et autres boissons, Cigare), y compris après un remboursement ou une
    annulation.

Déjà décidé dans des projets précédents et repris ici : les repas extérieurs ne sont pas une recette, leur argent
entre et ressort pour le restaurant (catégorie « Avance repas client », hors résultat) ; le crédit des cartes n'est
jamais remboursé et n'expire jamais.

## La règle centrale

**Fond de caisse + crédit des cartes + Réservation de séance + Champagne et autres boissons + Cigare = Solde en
caisse**, au franc près, à tout moment. Chaque mouvement d'argent de la caisse réelle va dans exactement une des cinq
tuiles de gauche, ou s'annule avec un autre (argent de passage). Un test doit le vérifier sur des journées variées.

## Où va chaque mouvement

| Mouvement | Tuile qui monte ou baisse |
|---|---|
| Réservation de séance, temps supplémentaire, abonnement payé | Réservation de séance (+) |
| Vente de champagne ou d'autre boisson payée | Champagne et autres boissons (+) |
| Vente de cigares payée | Cigare (+) |
| Vente Boutique payée | la tuile de son rayon (+) |
| Approvisionnement d'une carte | Crédit des cartes (+) |
| Annulation d'un approvisionnement | Crédit des cartes (−) |
| Vente payée avec la carte | Crédit des cartes (−), tuile de la vente (+) : le Solde en caisse ne bouge pas |
| Remboursement | la tuile de la vente (−) ; remboursé sur la carte : Crédit des cartes (+) |
| Note non payée | rien tant qu'elle n'est pas payée |
| Repas extérieur | rien (l'avance au livreur et le paiement du membre s'annulent ; payé par carte : Crédit des cartes (−)) |
| Achats champagne, Achats autres boissons | Champagne et autres boissons (−) |
| Achats cigares | Cigare (−) |
| Toute autre dépense (loyer, électricité, salaires, entretien, divers…) | Réservation de séance (−) |
| Prise de bénéfices | la tuile de l'associé (−) et le Solde en caisse (−) |
| Apport d'un associé (entrée diverse « Apport des associés ») | la caisse choisie (+) |
| Autre entrée diverse | Réservation de séance (+) |
| Prise de bénéfices sur la caisse commune | Réservation de séance (−) et Solde en caisse (−), moitié pour chaque associé |
| Transfert entre moyens de paiement (Espèces → MoMo) | rien |
| Écart de caisse (comptage) | Réservation de séance (+ ou −) |

## Mes choix (à vérifier par le propriétaire en relisant)

- **Les tuiles sont des soldes cumulés**, depuis le début du suivi (date du fond de caisse, ou depuis toujours)
  jusqu'à la fin de la période affichée. Le choix de la période ne change que la date de fin. Les lignes de détail
  (Vendu, Achats, Bénéfices pris) sont cumulées de la même façon, pour que le calcul se lise dans la tuile. Le bloc
  « Par catégorie » garde, lui, la période choisie.
- **La caisse qui paie une dépense est son « sous-compte »**, champ qui existe déjà dans « Nouvelle dépense » (« Sous-compte
  concerné » : Frais généraux, Réservations, Alcool, Cigares). « Frais généraux » et « Réservations » paient depuis
  Réservation de séance ; « Alcool » depuis Champagne et autres boissons ; « Cigares » depuis Cigare. Les trois
  catégories d'achats fixent leur sous-compte, sans choix possible, et la migration le remplit sur leurs dépenses
  passées qui n'en ont pas. Une autre dépense marquée Alcool ou Cigares (exemple : entretien de la cave à cigares) sort
  de la caisse de l'associé, sur une ligne « Autres dépenses » de sa tuile, affichée seulement si elle n'est pas nulle.
  Le lien entre une catégorie et sa caisse ne dépend pas de son nom (l'administrateur peut renommer une catégorie dans
  Paramètres).
- **Point de départ** : toutes les caisses partent de zéro à la date du fond de caisse (ou depuis le début s'il n'y en a
  pas). Le propriétaire a dit qu'aucun fournisseur n'a encore été payé : il n'y a pas d'historique à reprendre, et
  aucun solde de départ par caisse n'est prévu.
- **Catégories existantes** : « Achats boissons » est renommée « Achats champagne » (ses dépenses passées restent
  dedans) et « Achats autres boissons » est créée. Si un administrateur a déjà renommé ou supprimé « Achats boissons »,
  le constructeur choisit le comportement le plus sûr et le signale.
- **Montants plafonnés** (décisions 9 et 10) : tout ce qui fait baisser une caisse est refusé si la caisse ne contient
  pas assez. Ça couvre le paiement d'un fournisseur, toute autre dépense (y compris les dépenses communes et celles du
  gérant), la prise de bénéfices, le remboursement ou l'annulation d'une vente, l'annulation d'un apport, et un écart
  de caisse négatif au comptage. L'application refuse, dit
  combien la caisse contient et qu'il faut d'abord y remettre de l'argent. Le serveur vérifie au moment de
  l'opération. Conséquence à connaître : quand Réservation de séance est vide, le gérant ne peut plus enregistrer de
  dépense tant qu'un associé n'y a pas remis d'argent.
- **Prise de bénéfices sur la caisse commune** : on saisit un montant total, partagé automatiquement moitié-moitié
  entre les deux associés (le propriétaire a dit « à parts égales ») ; la ligne « Bénéfices pris » de Réservation de
  séance montre la part de chacun. Les deux parts sortent ensemble, par le même moyen de paiement. Si le montant ne se
  coupe pas exactement en deux, le constructeur choisit qui reçoit l'unité en trop.
- **Prise de bénéfices** : on choisit le moyen de paiement d'où sort l'argent (Espèces, MTN MoMo…), comme pour une
  dépense.
- **Qui peut faire quoi** : l'administrateur peut tout. Chaque associé agit sur sa propre caisse et, quand l'autre
  n'est pas là (décision 8), sur celle de l'autre : payer un de ses fournisseurs, rembourser une de ses ventes,
  annuler une de ses opérations, faire un apport. Quand un associé agit sur la caisse de l'autre, la fenêtre dit
  clairement de quelle caisse sort ou entre l'argent avant de valider, et le journal des opérations garde le nom de
  celui qui l'a fait. Seule exception : la prise de bénéfices reste personnelle. Un associé ne prend des bénéfices que
  dans sa propre caisse (l'administrateur peut le faire pour lui), puisque cet argent lui revient. La prise de
  bénéfices sur la caisse commune, partagée moitié-moitié, peut être faite par les deux associés et l'administrateur,
  qui enregistrent aussi les dépenses communes (loyer…), comme aujourd'hui. Le gérant garde ses droits actuels (dépenses de 5 000 FCFA au plus) et ne voit pas la tuile, comme
  aujourd'hui.
- **Filtre « Caisse ou compte »** : les six tuiles s'affichent sur « Toutes ». Quand on choisit un seul moyen de
  paiement, la tuile garde ses quatre chiffres actuels pour ce moyen (une caisse d'associé par moyen de paiement serait
  confuse).
- **Crédit des cartes déjà présent à la date du fond** : l'argent de ces cartes est déjà physiquement dans le fond. Pour
  que la règle centrale tienne, la tuile Fond de caisse montre le fond moins le crédit des cartes à cette date, avec une
  ligne qui le dit ; la tuile Crédit des cartes montre tout le crédit non utilisé.
- **Remettre de l'argent dans une caisse (apport)** : proposé au propriétaire, pas encore confirmé ; à vérifier en
  relisant. L'entrée diverse « Apport des associés » demande dans quelle caisse va l'argent : Réservation de séance,
  Champagne et autres boissons ou Cigare. Un bouton « Faire un apport » sur chacune de ces trois tuiles l'ouvre avec
  la caisse déjà choisie. Un apport dans Réservation de séance reste de l'argent commun : l'application ne suit pas
  qui l'a apporté (les associés remettent chacun la moitié, entre eux). Les autres entrées diverses (« Autre entrée »)
  vont dans Réservation de séance.
- **Trésorerie, Grand livre, Clôture mensuelle, journal des opérations** : une prise de bénéfices y apparaît comme
  argent sorti, sous un libellé à elle, jamais comme dépense ni dans le résultat. Elle s'annule avec un motif, comme
  les autres opérations, et respecte les périodes clôturées.

## Objectifs

- Chaque associé lit d'un coup d'œil ce qui est à lui et d'où ça vient.
- Payer un fournisseur, prendre ses bénéfices et partager la caisse commune se font depuis la tuile concernée.
- Un associé absent ne bloque rien : l'autre peut agir à sa place, et ça se voit.
- Les six tuiles s'additionnent toujours exactement.

## Non-objectifs

- Pas de vrais comptes bancaires séparés : la caisse réelle reste une.
- Pas de partage automatique des bénéfices : c'est toujours un geste volontaire.
- Pas de changement du contenu du bloc « Par catégorie » (seulement l'ordre et l'alignement).
- Pas de nouveaux droits pour le gérant.

## Anti-objectifs (ce qui serait un échec même si ça marche)

- Des tuiles dont la somme ne fait pas le Solde en caisse.
- Une prise de bénéfices comptée comme une dépense, qui ferait baisser le résultat du club.
- Une opération faite par un associé sur la caisse de l'autre sans que ça se voie (fenêtre qui ne dit pas de quelle
  caisse sort l'argent, journal sans le nom de celui qui l'a faite).
- Un associé qui prend des bénéfices dans la caisse de l'autre.
- Un fournisseur payé pour plus que ce que contient la caisse.
- Une caisse en négatif, quelle que soit l'opération qui l'y amène.
- De l'argent qui passe d'une caisse à une autre (« zéro compensation »).
- Un montant coupé sur deux lignes.

## Laissé au constructeur

Le modèle de données (nouveaux types d'opérations, migration V20, lien catégorie → caisse), les routes de l'API, le
calcul des soldes cumulés (serveur ou navigateur), la mise en page sur téléphone (les six tuiles et les colonnes de
« Par catégorie » s'empilent sous ~840 px), les tests, le mode démo (même comportement, données de démo).
