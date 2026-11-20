# Bloc « Argent encaissé » lisible d'un coup d'œil — conception courte

Date : 2026-11-20 · Taille : petit changement

## Pourquoi
Le propriétaire, sur une capture du bloc : « c'est beaucoup trop brouillon on y comprend rien les infos doivent être compréhensibles rapidement ». Sur la capture, 3 des 4 « Entrées diverses » sont des annulations barrées qui prennent autant de place que les vraies opérations. Chaque ligne aligne 5 à 7 informations. Tous les montants des lignes sont verts et gras comme les totaux, et le bouton « Annuler l'opération » est écrit en toutes lettres sur chaque ligne.

## Ce qui change (page Caisse : administrateur, associés et gérant ; téléphone et ordinateur)
Bloc « Argent encaissé » :

1. **Les groupes sont fermés par défaut** (choix du propriétaire, version A de la maquette). On voit d'abord : Ventes et réservations, Boutique, Entrées diverses…, chacun avec son nombre et son montant, puis « Total encaissé ». Un toucher ouvre un groupe.
2. **Les annulations sortent des groupes.** Elles sont rassemblées sous le total, dans une seule ligne repliée « N annulations · non comptées ». Ouverte, chaque annulation montre son titre, son montant barré, sa date, qui l'a annulée et le motif.
3. **Une opération = deux niveaux** : quoi + montant, puis date · client ou catégorie · moyen de paiement · par qui. On retire ce que le groupe dit déjà (« Entrée diverse » dans « Entrées diverses », l'étiquette « Boutique » dans le groupe Boutique, où l'on garde seulement le rayon « Cigares » ou « Champagne »). Le numéro de ticket disparaît de la ligne : c'est le titre qui ouvre le ticket.
4. **Seuls les totaux sont verts et gras.** Le montant d'une opération est écrit dans la couleur du texte.
5. **« Annuler l'opération » devient une petite croix ✕** à droite du montant, avec le texte complet en info-bulle et pour les lecteurs d'écran. La fenêtre de confirmation avec le motif reste la même.
6. **Boutique** : le détail par rayon ne montre que les rayons qui ont de l'argent (plus de « Champagne 0 FCFA »). Il tient sur une petite ligne sous le titre du groupe, sans cadre.

Bloc « Dépenses », qui utilise les mêmes lignes : points 2, 3, 4 et 5. Les dépenses annulées vont dans la même ligne repliée sous « Total des dépenses ». Les barres par catégorie et la liste « Détail » restent comme avant.

## Choix faits par Claude (à corriger si besoin)
- « Dette reprise » reste dans « Ventes et réservations » : le propriétaire n'a pas demandé de groupe à part.
- On garde « par Ali » (et non « Ali » seul comme sur la maquette), pour ne pas confondre la personne qui a saisi l'opération avec le client.
- La croix ✕ remplace aussi le bouton dans « Transferts entre comptes » et « Bénéfices pris », pour que ce soit pareil partout.
- Le bloc « Payé par carte membre, non compté » reste à sa place, replié comme aujourd'hui.

## Ce qui ne change pas
- Les montants, les totaux et ce qui est compté ou non.
- Les droits : seuls les administrateurs annulent ; le gérant voit la journée seulement.
- Les autres listes de la page (Recette du jour par catégorie, onglets Boutique et Offerts).

## Approches considérées
- A · Groupes fermés par défaut : les totaux d'abord, le détail au toucher.
- B · Groupes ouverts par défaut : tout le détail visible, mais nettoyé.
- **Retenu : A** (choix du propriétaire, sur maquette).

## Laissé au constructeur
- Comment détecter qu'une ligne est une annulation (la même règle que l'affichage barré d'aujourd'hui), et le style exact de la croix (réutiliser `Icon` et les boutons existants).
