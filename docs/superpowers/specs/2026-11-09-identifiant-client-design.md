# Espace client : identifiant choisi par le client, codes donnés par les associés

Date : 2026-11-09. Statut : validé par le propriétaire le 2026-11-09. Modifie `2026-11-09-espace-client-design.md`
(décision 6 et règles « Identifiants et connexion ») ; le reste de l'espace client ne change pas. La piste « connexion
avec Google » est abandonnée par le propriétaire. Les choix qui ne viennent pas du propriétaire sont marqués
**(mon choix)**.

## Pourquoi

Le propriétaire ne veut pas que l'identifiant d'un client soit son numéro de téléphone. Et celui qui remet un code
provisoire pourrait s'en servir pour entrer dans le compte d'un client : seules des personnes de confiance doivent pouvoir
en donner.

## Décisions du propriétaire (2026-11-09)

1. **Seuls les deux associés et l'administrateur** peuvent créer l'accès d'un client et lui donner un code provisoire
   (création de l'accès, « Nouveau code provisoire »). Le gérant ne le peut plus.
2. **Le client choisit son identifiant** à sa première connexion, avec son mot de passe. Le téléphone n'est jamais
   l'identifiant.
3. Le reste du fonctionnement présenté le 2026-11-09 est validé (points ci-dessous).

## Fonctionnement

- **Identifiant provisoire = numéro de membre** du client (M-0012, ou C-0003 pour un client régulier ; un client passé
  en membre peut aussi utiliser son ancien numéro C-…) **(mon choix)**. Le message WhatsApp de l'associé donne
  l'adresse de l'espace, ce numéro et le code provisoire (7 jours, une seule utilisation, comme avant).
- **Première connexion** : numéro de membre + code → écran « Choisissez votre identifiant et votre mot de passe ».
- **Règles de l'identifiant (mon choix)** : 4 à 30 caractères ; lettres sans accent, chiffres, point, tiret ; majuscules
  et minuscules indifférentes (gardé en minuscules) ; unique parmi les accès ; refusé s'il n'est fait que de chiffres
  (points et tirets mis à part), pour éviter le numéro de téléphone ; refusé s'il a la forme d'un numéro de membre
  (`m-…`, `c-…`).
- **Ensuite** : connexion avec l'identifiant choisi et le mot de passe. Le numéro de membre ne sert plus, sauf avec un
  code provisoire en cours.
- **Oubli** : le personnel voit l'identifiant choisi sur la fiche et peut le redire. Mot de passe oublié : un associé ou
  l'administrateur donne un nouveau code ; le client se connecte avec son identifiant **ou** son numéro de membre et ce
  code, puis choisit un nouveau mot de passe ; il peut à ce moment garder ou changer son identifiant **(mon choix)**.
- **Droits sur la fiche** : créer l'accès, « Nouveau code provisoire », « Rétablir l'accès » : associés et administrateur.
  « Couper l'accès » : tout le personnel, gérant compris, car cela protège le client **(mon choix)**. Le gérant voit
  l'état de l'accès et l'identifiant.
- **Accès déjà créés avec le téléphone** : à leur prochaine connexion (téléphone ou numéro de membre, avec leur mot de
  passe ou leur code), le client doit choisir un identifiant avant tout le reste ; ensuite le téléphone ne marche plus.
- Le journal note chaque création, chaque code donné, chaque coupure ou rétablissement, avec la personne ; et le choix
  ou changement d'identifiant par le client.

## Non-objectifs

- Connexion avec Google, SMS.
- Changement d'identifiant par le client en dehors d'un nouveau code.
