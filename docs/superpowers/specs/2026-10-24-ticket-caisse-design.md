# Ticket de caisse — conception

Date : 2026-10-24. Branche : `feat/ticket-caisse` (depuis `main`).

## Intention

Quand le gérant encaisse un client (écran « Encaissements & Notes », bouton « Encaisser … FCFA »), il doit pouvoir
lui remettre un **ticket de caisse** : imprimé sur une imprimante à tickets, ou **envoyé par WhatsApp** si le client
ne veut pas de papier. Le ticket doit pouvoir être **réimprimé à volonté**.

Le propriétaire veut que ce ticket **ne soit pas falsifiable** et se protéger à la fois :
- d'un **employé** qui fabriquerait un faux ticket ou garderait l'argent ;
- d'un **client** qui trafiquerait un ticket pour prétendre avoir payé.

Il veut **voir qui a imprimé chaque ticket** et avoir **l'historique des impressions**. Il a validé l'idée du
**QR code**, et veut que **chaque client puisse vérifier lui-même** son ticket.

En plus (même livraison) : **ajouter le logo The Limen sur la carte de membre**.

## Objectifs

1. Un ticket par encaissement, imprimable au format rouleau 80 mm depuis ordinateur, tablette ou téléphone.
2. Envoi du même ticket par WhatsApp, en un clic du gérant, sur le numéro du membre.
3. Réimpression et renvoi à volonté, depuis le journal des encaissements et depuis la fiche du membre.
4. Infalsifiable au sens pratique : toute version modifiée se repère en scannant le QR code ou en saisissant le code
   de contrôle ; seul un vrai encaissement enregistré par le serveur produit un ticket.
5. Historique de chaque impression et envoi : qui, quand, quel type, vers quel numéro.
6. Page publique de vérification, ouverte par le QR code, sans connexion.
7. Logo The Limen sur la carte de membre.

## Non-objectifs

- Piloter l'imprimante directement (Bluetooth, ESC/POS, impression silencieuse) : on passe par la fenêtre
  d'impression du navigateur.
- Joindre une image ou un PDF à WhatsApp (impossible par un lien wa.me) ; pas d'envoi automatique par l'API
  WhatsApp Business.
- Ticket pour un remboursement (le remboursement apparaît sur le ticket d'origine et sur la page de vérification).
- La nouvelle carte noire et or (choix du propriétaire en attente) : seul le logo est ajouté à la carte actuelle.
- Facture normalisée / mentions fiscales imposées : le texte libre d'en-tête et de pied (ci-dessous) permet au
  propriétaire d'y mettre ce qu'il veut.

## Anti-objectifs (échec même si « ça marche »)

- Un ticket qu'on peut créer, modifier ou supprimer à la main dans l'application.
- Une page publique qui expose le téléphone, le nom complet, le n° de membre ou l'historique d'un client, ou qui
  permet de deviner les tickets des autres en changeant un chiffre dans l'adresse.
- Une réimpression qui ressemble à l'original (elle doit dire « Duplicata »).
- Un ticket du mode démo qui passe pour un vrai.

## Ce qui existe (à réutiliser)

- Encaissement : `recordPayment` (worker/club.js ~2081) crée `payments` + `payment_allocations`, audite
  `paiement.enregistrer`. `paymentDTO` (~2066) donne déjà les données du ticket (lignes, montants, moyen,
  référence, date, encaisseur), sans le téléphone du membre.
- Remboursement par ligne (`refundCharge`), réservé aux administrateurs quand `refunds_admin_only` est vrai
  (vrai par défaut). Un paiement n'est jamais modifié ni supprimé.
- WhatsApp : `shared/whatsapp.js` (`waDigits`, `waLink`), et le modèle « en démo on montre le message sans rien
  ouvrir » (`DemoMessageDialog`, `sendWhatsAppConfirmation` dans src/dialogs/reservationDialogs.jsx).
- QR : encodeur maison `src/lib/qrcode.js` (`encodeQrMatrix`, `qrSvgPath`), déjà utilisé par la carte de membre.
- Impression : `@media print` dans src/club.css cache la navigation, `.no-print` et `#modal-root` ; donc le ticket
  s'imprime depuis **une page**, pas depuis une fenêtre modale.
- Routes publiques : `{ public: true }` dans worker/api.js, limitation `checkThrottle` / `recordFailure`.
- Routeur : `HashRouter` ; l'application affiche la connexion avant le routeur quand personne n'est connecté.
- Logo : `src/components/ui/BrandLogo.jsx` (SVG, `currentColor`).

## Conception

### 1. Le ticket = l'encaissement

Un ticket n'est pas un objet qu'on saisit : c'est **la vue d'un paiement** (`payments`). Son numéro est le
numéro du paiement, affiché `T-000123` (6 chiffres, plus si besoin). Comme un paiement ne se modifie ni ne se
supprime, le ticket non plus.

Chaque paiement reçoit un **code de contrôle** aléatoire, créé par le serveur, stocké en base :
- 12 caractères dans un alphabet sans ambiguïté (`ABCDEFGHJKMNPQRSTUVWXYZ23456789`, sans 0/O/1/I/L), soit
  ~59 bits ; affiché en trois groupes `K7QM-2XRP-9TDA` ;
- créé à l'encaissement (`recordPayment`) ; les paiements déjà existants en reçoivent un à la migration ;
- jamais modifiable.

*Choix de conception (le mien)* : un code aléatoire stocké plutôt qu'une signature calculée avec une clé secrète :
pas de secret Cloudflare à gérer, et la vérification se fait de toute façon en interrogeant la base.

### 2. Vérification publique (QR code)

- Adresse du QR : `https://club-prive.ramikaze.workers.dev/#/ticket/<numéro>/<code>` (même origine que le site).
- Route API publique `GET /api/tickets/<numéro>/<code>` (pas de session, lecture seule) :
  - numéro et code doivent correspondre exactement (comparaison à temps constant, tirets et casse ignorés) ;
    sinon réponse « Ticket introuvable » **identique** que le numéro existe ou non ;
  - limitée par adresse IP avec `checkThrottle`/`recordFailure` (5 échecs → blocage 60 s, comme les autres portes) ;
  - toujours le **vrai club** (jamais l'espace démo) ;
  - réponse minimale : nom du club, numéro, date et heure, lignes (libellé, quantité, montant), total, moyen de
    paiement, **initiales** du client (« J. D. »), statut : `valide`, `partiellement remboursé` (avec montant
    remboursé), `remboursé`. Rien d'autre : ni téléphone, ni nom complet, ni n° de membre, ni encaisseur, ni
    référence de transaction MoMo.
- Page publique `#/ticket/:numero/:code` : affichée **avant** le contrôle de connexion (le client n'a pas de
  compte). Elle montre le ticket officiel, un bandeau vert « Ticket authentique enregistré par The Limen », ou
  rouge « Ticket introuvable : ce ticket n'a pas été émis par The Limen », et la phrase « Comparez avec votre
  ticket : si un montant ou une ligne diffère, votre ticket a été modifié. »
- Saisie manuelle : la même page propose un formulaire « N° du ticket + code de contrôle » (pour un ticket dont le
  QR est abîmé), à l'adresse `#/ticket`.

### 3. Page du ticket (personnel connecté)

Route `#/caisse/ticket/:id`, pour tous les rôles. Elle montre l'aperçu du ticket (exactement ce qui sortira) et
trois boutons : **Imprimer**, **Envoyer par WhatsApp**, **Retour à la caisse**.

Après un encaissement réussi (`PaymentDialog`), l'application **ouvre cette page** au lieu d'un simple toast.

Contenu du ticket (rouleau 80 mm) :
1. Logo The Limen, nom du club ; sous le logo, le **texte d'en-tête** du ticket (adresse, téléphone, NIU…) —
   nouveau réglage libre, voir §6 ;
2. « TICKET DE CAISSE », **Original** ou **Duplicata n°X** ;
3. N° `T-000123`, date et heure de l'encaissement ;
4. Client : nom et n° de membre ;
5. Lignes : libellé, quantité, montant ; total en gros ;
6. Moyen de paiement (Espèces / MTN MoMo) et sa référence s'il y en a une ;
7. « Encaissé par : <nom> » ; « Imprimé par : <nom>, le <date heure> » ;
8. Si des lignes ont été remboursées depuis : mention « Remboursé : <montant> le <date> » ;
9. QR code + « Vérifiez ce ticket : scannez le QR code » + code de contrôle en clair ;
10. **Texte de pied** (réglage libre, par défaut « Merci de votre visite »).

Impression : `window.print()` ; CSS `@page { size: 80mm auto; margin: 0 }` et une colonne de 72 mm (zone
imprimable des imprimantes 80 mm), noir sur blanc, police lisible ≥ 9 pt.

### 4. Historique des impressions et envois

Nouvelle table `ticket_events` (migration `V14`) :
`id`, `payment_id`, `kind` (`impression` | `whatsapp`), `copy_no` (1 = original, puis 2, 3…), `phone` (pour
WhatsApp, le numéro utilisé), `at`, `user_id`.

- Route `POST /api/payments/:id/ticket-events` `{ kind }` : enregistre l'événement **avant** l'impression
  ou l'ouverture de WhatsApp et renvoie `copy_no` ; le ticket affiche alors « Original » (copy_no 1) ou
  « Duplicata n°copy_no ». Le serveur prend lui-même le téléphone du membre pour WhatsApp (le client n'envoie pas
  de numéro). Un envoi WhatsApp compte aussi comme un exemplaire (le premier envoi d'un ticket jamais imprimé est
  l'original).
- L'aperçu à l'écran n'est pas un événement (on ne trace que ce qui sort). L'aperçu affiche l'exemplaire qui
  sortira au prochain clic (« Original » ou « Duplicata n°X »).
- Limite assumée : le site sait que quelqu'un a demandé l'impression, pas si le papier est sorti. Les écrans disent
  « impression demandée ».
- Écran administrateur **« Historique des tickets »** (admin seulement) : liste des événements, filtres période et
  employé, colonnes Date, Ticket, Client, Montant, Type, Exemplaire, Par. Un ticket sorti **3 fois ou plus** est
  signalé (pastille orange). Chaque ligne ouvre le ticket.
- Sur la page du ticket, l'administrateur voit aussi l'historique de ce ticket.

### 5. WhatsApp

Bouton **Envoyer par WhatsApp** : enregistre l'événement, puis ouvre `waLink(waDigits(téléphone du membre), texte)`.
Le texte (même contenu que le ticket, en texte) :

```
THE LIMEN · Club privé
TICKET DE CAISSE T-000123 (Original)
24/10/2026 20:41
Client : Jean Dupont (M-0012)
- Abonnement Mensuel — 2 heures (24/10 → 23/11)  50 000 FCFA
TOTAL : 50 000 FCFA
Payé : Espèces
Encaissé par : Awa
Vérifiez ce ticket : https://club-prive.ramikaze.workers.dev/#/ticket/123/K7QM2XRP9TDA
Merci de votre visite
```

Si le numéro du membre est inutilisable (`waDigits` nul), le bouton explique pourquoi et renvoie à la fiche du
membre. Le téléphone vient de l'API du ticket (personnel connecté), jamais de la page publique.

### 6. Réglages

Dans Paramètres › Club & Horaires, nouvelle carte « Ticket de caisse » :
- **En-tête du ticket** (texte libre, 4 lignes, 200 caractères max, vide par défaut) ;
- **Pied du ticket** (texte libre, 2 lignes, 120 caractères max, défaut « Merci de votre visite »).

Le réglage existant « Remboursements réservés aux administrateurs » reste à vrai (défaut).

### 7. Réimpression

- Journal des encaissements (Cash.jsx, `JournalTable`) : nouvelle colonne avec un bouton « Ticket » qui ouvre
  `#/caisse/ticket/:id`. Le gérant ne voit que le jour même dans le journal (règle existante) ; l'administrateur
  toutes les dates.
- Fiche du membre (Member.jsx, carte « Paiements ») : même bouton sur chaque paiement.
- Tous les rôles peuvent ouvrir, réimprimer et renvoyer ; chaque sortie est tracée.

### 8. Mode démo

Les tickets de la démo s'affichent et s'impriment avec un filigrane **« DÉMO — SANS VALEUR »**, **sans QR code ni
code de contrôle** ; WhatsApp montre le message sans rien ouvrir (modèle existant). La route publique ne lit que le
vrai club.

### 9. Carte de membre

Ajouter `BrandLogo` en haut de la carte (`.mc-top`), couleur or de la carte, taille adaptée au format 85,6 × 54 mm,
à l'écran comme à l'impression.

## Contraintes

- Le dépôt GitHub est public : aucun numéro de téléphone, code ni donnée réelle dans le code ou les tests.
- Tests : `node --test test/*.test.js` (Node ≥ 24) ; ajouter des tests serveur (code créé à l'encaissement et à la
  migration, vérification publique OK / mauvais code / mauvais numéro / limitation, réponse sans données
  personnelles, événements et numéros d'exemplaire, droits, démo) et des tests de `shared/` pour le texte WhatsApp
  et le format du code.
- Ajouter `ticket_events` à la liste d'effacement (club.js ~39).
- Mise en ligne : comme d'habitude, `npm run deploy` sur le site des clients après validation.

## Choix faits à la relecture (les miens)

- **Adresse du QR** : construite à partir de l'adresse d'où le site est servi (`location.origin`), pas écrite en dur.
  Si le club passe un jour sur son propre nom de domaine, garder l'adresse `workers.dev` active pour que les tickets
  déjà imprimés restent vérifiables.
- **Page publique et espace démo** : l'appel de vérification n'envoie jamais l'en-tête `X-Club-Espace: demo`, même
  si ce navigateur est dans l'espace démo.
- **Codes des paiements existants** : remplis par du code JavaScript juste après la migration V14 (SQLite ne sait
  pas tirer un code aléatoire sûr), une seule fois, sans toucher aux montants.
- **Impression annulée** : la fenêtre d'impression annulée consomme quand même l'exemplaire (« impression
  demandée ») ; l'exemplaire suivant sera un duplicata.
- **Gérant et anciens tickets** : depuis la fiche d'un membre, le gérant peut ouvrir et réimprimer un ticket d'un
  autre jour (tracé comme les autres).

## Laissé au constructeur

- Mise en page exacte du ticket (dans les limites ci-dessus) et de la page publique.
- Nom précis des routes, des fonctions et des actions d'audit (style existant : `ticket.imprimer`, `ticket.whatsapp`).
- Où placer « Historique des tickets » dans le menu (onglet de la Caisse ou de Trésorerie).
