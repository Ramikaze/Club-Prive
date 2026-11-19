# Menu latéral organisé par secteur — conception courte

Date : 2026-11-19 · Taille : petit changement

## Pourquoi
Le propriétaire trouve le menu peu lisible : 9 rubriques sous un seul titre « Opérations ». Il veut les voir rangées par secteur.

## Ce qui change
Le menu latéral (ordinateur) devient :

- Accueil (en haut, sans titre)
- **CLIENTS** : Salles, Agenda, Membres / Clients
- **VENTES** : Boutique, Commandes, Caisse
- **ACHATS ET STOCKS** : Stocks, Fournisseurs
- **ADMINISTRATION** : Administration (administrateur seulement, comme aujourd'hui)

La visite guidée (étape « Le menu du club ») décrit ces sections au lieu de lister les rubriques.

## Ce qui ne change pas
- Droits : le gérant ne voit toujours ni Fournisseurs ni Administration ; les associés voient Fournisseurs.
- Barre du bas sur téléphone : mêmes onglets.
- Menu « compte » sur téléphone : même liste (Commandes, Stocks, Fournisseurs, Administration).
- Menu replié : chaque titre de section reste un trait fin.

## Approches considérées
- **A · Par secteur** (choisie par le propriétaire) : suit le parcours du client, 3 rubriques au plus par section, la Caisse à côté des ventes.
- B · Clients / Produits / Argent : la Caisse se retrouve seule avec l'Administration ; le gérant aurait une section « Argent » d'une seule ligne.
- C · Quotidien / Gestion : met Membres / Clients en « Gestion » alors que le gérant les cherche pendant le service.

## Règle ajoutée (décision technique)
Un titre de section dont aucune rubrique n'est visible pour la personne connectée n'est pas affiché.

## Fichiers
- `src/components/layout/AppShell.jsx` (ordre et titres de `NAV`, filtre des titres vides)
- `src/components/ui/GuidedTour.jsx` (texte de l'étape du menu)
