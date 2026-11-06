# Autres boissons et caisse en trois colonnes

Date : 2026-11-06. Statut : à valider par le propriétaire.

## Pourquoi

Le club ne vend pas que du champagne. À côté du champagne, il sert d'autres boissons pendant les séances (whisky, eau,
sodas…). Aujourd'hui l'application ne connaît que deux sortes de produits : « Cigare » et « Bouteille » (toutes les
bouteilles sont du champagne, confirmé pendant le projet Boutique). Il faut :

1. pouvoir créer un produit « Autre boisson », en plus de « Cigare » et « Champagne » ;
2. voir dans la Caisse la recette et ce qui a été facturé, rangés en trois colonnes : « Réservation séance »,
   « Boisson » (partagée en « Champagne » et « Autres boissons ») et « Cigare ».

Maquette validée par le propriétaire le 2026-11-06 (dans la conversation) : trois colonnes côte à côte ; en haut de
chaque colonne, la recette du jour ; dessous, la liste de ce qui a été facturé dans la catégorie ; la colonne
« Boisson » a deux moitiés, « Champagne » et « Autres boissons », chacune avec sa recette et sa liste.

## Décisions du propriétaire

- **Trois catégories de produits** à la création d'un produit : Cigare, Champagne, Autre boisson.
- **La Boutique ne change pas** : elle ne vend que les cigares et le champagne. Les autres boissons n'y apparaissent
  jamais (ni dans l'onglet Champagnes, ni ailleurs dans la Boutique).
- **Caisse en trois colonnes** : « Réservation séance », « Boisson » (Champagne | Autres boissons), « Cigare ». En haut
  de chaque colonne : la recette ; dans chaque colonne : le récapitulatif de ce qui a été facturé dans sa catégorie.
- Validé sur la maquette (où ces points étaient présentés comme des suppositions, et le propriétaire a répondu « C'est
  très bien comme ça ») :
  - les autres boissons se vendent seulement en séance ;
  - leur argent va dans « Boisson », c'est-à-dire le même sous-compte que le champagne aujourd'hui (`alcool`), montré à
    part dans la colonne ;
  - les ventes Boutique restent dans leur colonne (champagne ou cigare), marquées « Boutique » ;
  - la recette en haut = l'argent encaissé ; la liste = tout ce qui a été facturé, y compris ce qui n'est pas encore
    payé (marqué « à encaisser »).
- **Qui gère les autres boissons** (2026-11-06, « L'associé Champagne est le gérant, normalement ») : l'associé du
  champagne gère les fiches, prix, photos et stocks des autres boissons, comme ceux du champagne (même rayon `alcool`).
  L'administrateur garde tous les droits ; l'associé des cigares les voit sans pouvoir les modifier ; le gérant (l'employé)
  garde ses droits actuels sur les produits.

## Objectifs

1. Le formulaire « Nouveau produit » (et la modification d'un produit) propose trois catégories : « Cigare »,
   « Champagne », « Autre boisson ».
2. Les produits « Autre boisson » se facturent en séance comme les bouteilles aujourd'hui (même fenêtre « Facturer »,
   même règle de stock, vendus à l'unité entière).
3. L'argent d'une autre boisson va au sous-compte `alcool`, comme le champagne.
4. Partout où l'écran affiche la catégorie d'un produit, « Bouteille » devient « Champagne », et la nouvelle catégorie
   s'appelle « Autre boisson » (« Autres boissons » au pluriel : filtres, titres).
5. La Caisse affiche les trois colonnes de la maquette, pour la journée ou la période choisie.
6. La somme des trois colonnes est égale aux chiffres actuels de la Caisse (mêmes règles : remboursements, annulations,
   journées fermées). « Champagne » + « Autres boissons » = le sous-compte `alcool` d'aujourd'hui.
7. L'espace démo a des autres boissons : les bouteilles de démo qui ne sont pas du champagne (whisky, cognac, rhum)
   deviennent « Autre boisson ».

## Anti-objectifs (ce serait un échec même si « ça marche »)

- Une autre boisson qui apparaît dans la Boutique, ou qui peut y être vendue.
- Un chiffre passé (journée, mois, clôture) qui change parce qu'une boisson a changé de catégorie.
- Une donnée existante qui bouge : produits, stocks, photos, lignes facturées, paiements, tickets.
- Une colonne dont la recette ne correspond pas à l'argent réellement encaissé dans sa catégorie.

## Ce qui existe aujourd'hui (pour le constructeur)

- Table `products` : `category TEXT NOT NULL CHECK (category IN ('cigare', 'bouteille'))` (`worker/schema.js`, V1).
  Les migrations vont jusqu'à V18 (projet Boutique). Les produits sont cités par les lignes facturées (`charges`), les
  mouvements de stock, les photos de produits.
- Sous-comptes : `reservations`, `alcool`, `cigares` (libellés écran dans `src/lib/format.js` : « Réservations »,
  « Alcool », « Cigares »). Une ligne de produit va au sous-compte de sa catégorie (`accountOfCategory` dans
  `shared/roles.js` : `cigare` → `cigares`, `bouteille` → `alcool`).
- Règle des rayons (projet Boutique) : un associé ne gère les fiches produits, photos et stocks que de son rayon
  (`ownsAccount` dans `shared/roles.js`). Le rayon « alcool » est celui de l'associé du champagne.
- La Boutique lit `SHOP.alcool.category = 'bouteille'` : elle ne montre que les produits de cette catégorie.
- La Caisse (`src/pages/Cash.jsx`) : bilan, « Recettes du jour » (par nature et moyen de paiement), dépenses, notes
  ouvertes, transferts, et en bas un bloc repliable « Détails » par sous-compte. Les chiffres viennent de
  `financeSummary` (déjà partagé Séances / Boutique) et de `journal`.
- Les bouteilles se vendent seulement entières (`worker/club.js`, message « Les bouteilles se vendent uniquement
  entières… »).
- L'import du catalogue (`importCatalogItem`, porte protégée par code) n'accepte que `cigare` ou `bouteille`.

## Comment (décidé)

- **Nouvelle catégorie en base** : une migration V19 autorise une troisième valeur de `products.category` (la reconstruction
  de table suit le modèle V15/V18, sans rien déplacer). Mon choix : la valeur `boisson`. `bouteille` reste la valeur du
  champagne en base (rien n'est renommé en base) ; seul le libellé écran change.
- **Sous-compte** : `accountOfCategory('boisson')` → `alcool`. Rien de nouveau côté comptes, trésorerie, grand livre ou
  clôture.
- **Boutique** : inchangée ; comme elle filtre sur `bouteille`, les autres boissons n'y entrent pas. Le serveur refuse déjà
  un produit d'une autre catégorie que celle du rayon (`RAYON`).
- **Caisse** : un nouveau bloc « Par catégorie » en trois colonnes, placé juste sous le bilan de la caisse. Mon choix :
  le bloc « Détails » du bas reste tel quel (replié), « Recettes du jour » reste aussi (il sert à compter le tiroir par
  moyen de paiement).
- **Chiffres d'une colonne** (mon choix, à partir de la maquette) :
  - en haut, la recette = encaissé net de la catégorie (encaissé − remboursé), pour la journée ou la période ;
  - dessous, une ligne par élément facturé de la période : séance (salle, durée, membre) ou produit (nom × quantité,
    séance n° ou « Boutique » + acheteur), son montant, et « à encaisser » s'il n'est pas encore payé ; une ligne
    annulée ou remboursée reste visible, barrée.
  - « Réservation séance » = le sous-compte `reservations` (temps de salle, temps supplémentaire, abonnements vendus).
- **Serveur** : `financeSummary` (ou une nouvelle route de lecture) donne aussi le partage du sous-compte `alcool` entre
  « champagne » et « autres boissons », selon la catégorie du produit de chaque ligne, avec la même règle que le partage
  Séances / Boutique (la somme des deux parts = le chiffre existant).

## Choix faits après relecture (mes choix, à vérifier par le propriétaire)

- **Catégorie d'un produit déjà vendu** : elle ne change plus. Le partage Champagne / Autres boissons se calcule à partir
  de la catégorie actuelle du produit ; si on pouvait la changer après une vente, les chiffres passés bougeraient
  (anti-objectif). Une fois qu'un produit a une ligne facturée (séance ou Boutique), le serveur refuse le changement de
  catégorie avec le message « Ce produit a déjà été vendu : sa catégorie ne change plus. Créez un nouveau produit et
  désactivez celui-ci. » Un produit jamais vendu peut toujours changer de catégorie.
- **Dates** : mêmes règles que les chiffres actuels de la Caisse (`financeSummary`) : la recette compte l'argent à la date
  où il est encaissé (ou rendu), la liste montre ce qui a été facturé à la date de facturation. Une note sous les colonnes
  le dit en une phrase.
- **Ligne `alcool` sans produit** (ancienne ligne, produit supprimé) : comptée dans « Champagne », pour que la somme reste
  égale au chiffre actuel.
- **Abonnements** : ils apparaissent dans la colonne « Réservation séance » comme une ligne « Abonnement · formule ·
  membre ».
- **Qui voit les trois colonnes** : comme le bloc « Détails » aujourd'hui, l'administrateur et les associés. La caisse du
  gérant ne change pas (ses droits seront définis plus tard, décision du propriétaire du 2026-10-28).
- **Démo** : les produits de démo sont fixés dans le code de la démo (`worker/seed.js`) : « Champagne brut (démo) » reste
  Champagne ; whisky, cognac et rhum de démo deviennent « Autre boisson ».

## Laissé au constructeur

- Le nom exact de la route ou des champs qui donnent les lignes facturées par catégorie, et la limite de lignes affichées
  sur une longue période (avec un lien « voir tout » vers l'historique si besoin).
- L'icône de la catégorie « Autre boisson » et des colonnes.
- La disposition sur téléphone (les colonnes passent l'une sous l'autre).
- Les textes de la visite guidée et les filtres (« Tous / Cigares / Champagne / Autres boissons ») sur Catalogue &
  Stocks et dans la fenêtre « Facturer » d'une séance.

## Contraintes

- Écrans en français, ton et mise en forme actuels, clair et sombre, téléphone et tablette.
- Dépôt public : aucun vrai nom de marque, photo ou numéro dans le code, les tests ou la démo.
- `npm test` vert, `npm run build` réussi ; chaque changement de base passe par une nouvelle migration.
- Le propriétaire approuve chaque mise en ligne.

## Recette du jour (décision du propriétaire, 2026-11-07)

1. **La recette du jour = les trois colonnes, et rien d'autre** : Réservation séance + Boisson (Champagne + Autres
   boissons) + Cigare, en comptant les ventes payées par carte membre le jour où la carte est utilisée. C'est ce que
   les colonnes montrent déjà. En tête du bloc « Par catégorie » : « Recette du jour » (une journée) ou « Recette de
   la période » (plusieurs jours), égale à la somme des trois colonnes.
2. **Ne sont pas de la recette** : l'argent mis sur une carte membre (il reste « en attente » jusqu'à ce que le membre
   le dépense ; il devient alors recette dans la catégorie de ce qu'il achète) ; un repas extérieur (le club paie un
   restaurant pour rendre service au client : de l'argent qui sort, pas une recette) ; les « entrées diverses »
   (Apport des associés, Écart de caisse, Autre entrée).
3. **La caisse ne change pas** : le « Solde en caisse » reste l'argent réel, celui qu'on compte. Pour éviter la
   confusion, la case « Recettes » du bilan devient « Argent encaissé » (même chiffre, mêmes sous-lignes) ; le bloc
   « Recettes » de la caisse de l'administrateur et des associés, qui montre ce même chiffre, s'appelle aussi
   « Argent encaissé ». La caisse du gérant ne change pas (« Recettes du jour »).
4. **Une petite ligne sous les trois colonnes explique l'écart** entre la recette et l'argent encaissé, avec les
   montants, et tombe exactement sur le chiffre de la case « Argent encaissé » : « Argent encaissé = recette du jour
   … + argent mis sur les cartes … − ventes payées par carte membre … + remboursements rendus sur la carte … + argent
   reçu pour les repas extérieurs (hors carte) … + entrées diverses … = … ». Seuls les termes non nuls sont écrits. Elle se lit sur « Toutes » les
   caisses et comptes ; avec un filtre, une phrase invite à choisir « Toutes ». Chaque terme suit les règles de la
   case (approvisionnement ou repas annulé dans la période : rien ; remboursement rendu sur la carte : aucun argent
   sorti) et est calculé à part, jamais par différence (`recetteToCash`, `src/components/cash/flows.js`, testé dans
   `test/cash-categories.test.js`).
