# Dette reprise des clients réguliers, et reprise des comptes Digibox

Date : 2026-11-17. Statut : conception courte, à approuver par l'utilisateur. Les choix marqués **(mon choix)** n'ont
pas été dits par l'utilisateur : il peut les corriger.

## Pourquoi

L'application remplace Digibox (réunion des associés du 2026-11-06 ; double saisie jusqu'à fin novembre). L'utilisateur
a envoyé le 2026-11-17 les relevés tirés de Digibox : la fiche de tous les clients (avec leurs dettes), les relevés
détaillés de sept clients et les relevés de deux fournisseurs. Il veut que
ces clients et fournisseurs soient dans l'application, avec ce qu'ils doivent, entrés automatiquement à partir des PDF.

Les fournisseurs ont déjà leur « Solde reporté ». Les clients n'ont rien d'équivalent : leur dette ne vient que des
ventes à crédit faites dans l'application (la spec `2026-11-07-credit-clients-design.md` avait laissé la « créance de
départ » pour plus tard).

## Approches

- **A. « Dette reprise » sur la fiche du client (choisie par l'utilisateur).** Une ligne due, sans vente ni stock, qui
  compte dans « Doit » et se paie avec le règlement habituel.
- B. Créer seulement les fiches et laisser les dettes dans Digibox jusqu'à leur paiement : rien à programmer, mais deux
  endroits à suivre, alors que Digibox doit s'arrêter.
- (Écartée) Une fausse vente à crédit d'un produit : elle sortirait du stock et gonflerait les ventes du jour.

## Décisions de l'utilisateur (2026-11-17)

1. Approche A.
2. Un client présent deux fois sur la liste : **une seule fiche, les deux dettes additionnées**.
3. Un client dont la liste et le relevé détaillé diffèrent : **le montant de la liste**.
4. Fournisseur Europe et Fournisseur Liban : **tous deux de la caisse Cigare**.
5. Plafond de crédit des clients repris : **0** ; les associés le fixent ensuite sur chaque fiche.

## Ce qui change dans l'application

1. **Bouton « Dette reprise »** sur la fiche d'un client régulier, pour l'administrateur et les associés **(mon choix,
   comme le plafond)**. Fenêtre : montant en FCFA, caisse qui recevra le paiement (Cigare ou Champagne et autres
   boissons ; Cigare par défaut pour l'associé Cigare), note obligatoire (ex. « Reprise Digibox au 17/11/2026 »). Elle
   est datée du jour où elle est entrée ; la note dit d'où elle vient. **(mon choix)**
2. **Elle se lit comme une dette** : elle compte dans « Doit » (fiche, liste des clients, total des créances), s'affiche
   dans le relevé « Compte client » sous le nom « Dette reprise » avec sa note, et compte dans le plafond de crédit.
3. **Elle se paie avec « Enregistrer un règlement »**, sans rien de nouveau : le règlement paie les dettes de la plus
   ancienne à la plus récente, et l'argent entre, le jour du paiement, dans la caisse choisie pour la dette reprise.
4. **Ce n'est pas une vente** : elle n'entre ni dans la recette ou le « facturé » du jour, ni dans Caisse › Boutique, ni
   dans le stock, ni dans l'historique d'un produit. Seul l'argent du règlement compte, comme pour toute vente à crédit.
5. **Annuler une dette reprise** (administrateur ou associé, avec un motif) : refusé si une partie est déjà réglée ; il
   faut d'abord annuler le règlement. Elle reste visible, barrée, avec son motif. Tout passe au journal des opérations
   avec son auteur. **(mon choix)**
6. **Espace client** : le client voit sa dette reprise dans son historique, « à régler ». **(mon choix)**
7. **Fiche client sans prénom ni téléphone** : pour un client régulier seulement, le prénom et le téléphone deviennent
   facultatifs (entreprises ; clients connus par un seul nom ; 5 clients de la liste sans numéro). Les membres gardent prénom et téléphone obligatoires. Le nom reste obligatoire. **(mon choix)**
8. **Mode démo et « Effacer des données »** : même comportement ; les dettes reprises s'effacent avec les clients.

## Anti-objectifs

- Une dette reprise comptée comme vente ou recette du jour où elle est saisie.
- Une dette reprise qui fait bouger une caisse ou le stock avant son règlement.
- Une dette qui disparaît sans trace.

## Reprise des données : automatique (décision de l'utilisateur, 2026-11-17)

« Je ne vais pas m'amuser à rentrer les dettes une par une. Tu vas le faire automatiquement. » Personne ne saisit à la
main : comme pour le catalogue, un programme lancé depuis l'ordinateur envoie tout au site par une **porte d'import
temporaire**, ouverte seulement le temps de l'import par un code secret (le secret `IMPORT_TOKEN` du Worker, créé puis
supprimé avec l'accord de l'utilisateur). **(mon choix pour la façon de faire)**

- **Les données restent hors de GitHub** : le dépôt est public. La liste (29 clients, leurs téléphones, adresses de
  livraison et dettes ; 2 fournisseurs et leurs soldes) vit dans un fichier local ignoré par git,
  `reprise-digibox.local`, tiré des PDF. Ce document n'en garde que les règles.
- **Fournisseurs** : Fournisseur Europe et Fournisseur Liban, caisse Cigare, devise
  d'information EUR et USD **(mon choix)**, un « Solde reporté » chacun, daté du jour de l'import, libellé « Solde
  Digibox ».
- **Clients** : nom en majuscules sans « Mr » ; prénom seulement quand la liste en donne un ; adresse de
  livraison dans les notes ; téléphones écrits au format habituel (« 0-12345678 » devient « 01 234 56 78 ») ; une
  dette reprise par client qui doit, datée du jour de l'import, caisse Cigare, note « Reprise Digibox ». Le total entré
  doit égaler le total de la liste.
- **Sans doublon, sans écraser** : un client ou un fournisseur qui existe déjà sous le même nom (majuscules, accents,
  tirets et apostrophes ne comptent pas) n'est pas recréé. Une fiche proche (même téléphone, ou même nom quand l'une des
  deux n'a pas de prénom) n'est ni recréée ni modifiée : c'est un conflit. Si un client existant doit déjà quelque chose
  dans l'application, ou si un fournisseur existant a déjà des opérations, sa dette n'est pas entrée. Chaque conflit est
  signalé et Claude demande à l'utilisateur. Relancer le programme ne double rien.
- **Contrôle d'abord** : le programme tourne une première fois sans rien envoyer (il affiche ce qu'il ferait), puis sur
  une copie locale de l'application, puis sur le site.
- **Journal** : chaque création et chaque dette passent au journal des opérations, sans auteur (comme l'import du
  catalogue), plus une ligne « Reprise des comptes Digibox » qui les compte. **(mon choix)**
- **Après l'import** : le secret `IMPORT_TOKEN` est supprimé (`npx wrangler secret delete IMPORT_TOKEN`) ; la porte
  répond alors 503.

## Laissé au constructeur

La forme technique (table ou colonnes, migration V29), les routes, l'écran, et les tests (dette reprise exclue de toute
recette et vente ; règlement partiel qui la paie avant les ventes à crédit plus récentes ; argent dans la bonne caisse ;
annulation refusée après règlement).
