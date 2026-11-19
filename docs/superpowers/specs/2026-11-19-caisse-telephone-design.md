# Page Caisse sur téléphone — conception courte

Date : 2026-11-19 · Taille : petit changement

## Pourquoi
Le propriétaire, au téléphone : « Cette page est trop brouillon … ça prend trop de place et ce n'est pas professionnel ». Aujourd'hui, avant les chiffres, on empile 8 boutons sur 4 lignes, 3 onglets, 4 boutons de période sur 2 lignes, 2 dates et le choix de la caisse : les Soldes n'arrivent qu'après un écran entier.

## Ce qui change (téléphone, largeur < 900 px, la même limite que le reste de l'application)
En haut de la page Caisse (administrateur et associés) :

1. **Une ligne d'actions** : `+ Dépense` (bouton principal, le plus large), `+ Entrée`, `⇄ Transfert`, puis un bouton `⋯` (« Plus »).
2. **« Plus » ouvre une fenêtre** avec deux groupes :
   - CONSULTER : Historique des tickets, Journal des opérations
   - COMPTABILITÉ : Trésorerie et bilans, Grand livre, Clôture mensuelle
3. **Les onglets** Caisse / Boutique / Offerts : inchangés.
4. **Une ligne de filtres** : `Aujourd'hui ▾` et `Toutes les caisses ▾`.
   - `Aujourd'hui ▾` ouvre une fenêtre avec les 4 périodes (Aujourd'hui, 7 jours, Mois en cours, Mois précédent) et les dates Du / au. Le bouton affiche la période choisie (ex. « 7 jours », ou « 3 nov. – 19 nov. » pour des dates libres).
   - `Toutes les caisses ▾` : le choix actuel « Caisse ou compte », sans son texte à gauche.

## Choix faits par Claude (à corriger si besoin)
- « Plus » ne répète pas Entrée et Transfert, déjà visibles.
- Le sélecteur de période compact s'applique à toutes les pages qui en ont un (Trésorerie, Grand livre, Historique des tickets, Relevé, onglets Boutique et Offerts) : même comportement partout sur téléphone.

## Ce qui ne change pas
- Ordinateur (≥ 900 px) : la page reste telle quelle.
- Page du gérant : un seul bouton « Nouvelle dépense », déjà sobre.
- Ce que fait chaque bouton, et les droits.

## Approches considérées
- A · « Nouvelle dépense » + « Plus » qui contient tout le reste.
- B · Trois saisies visibles, comptabilité en carte au bas de la page.
- **Retenu : le mélange** (choix du propriétaire) — les trois saisies de B en haut, le menu « Plus » de A pour les consultations et la comptabilité.

## Laissé au constructeur
- Comment basculer entre les deux affichages (CSS ou JS), la forme exacte des fenêtres (réutiliser `Modal`).
