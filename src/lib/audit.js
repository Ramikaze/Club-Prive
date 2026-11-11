// Human-readable history lines for the audit log (reservation history, settings > journal).
import { RAYON_LABEL } from '../../shared/roles.js';
import { money, fmtDuration, dayLabel, ACCOUNT_LABEL } from './format.js';
import { CAISSE_LABEL } from '../../shared/caisses.js';
import { formatForeign } from '../../shared/suppliers.js';

export const ACTION_LABELS = {
  'cave.creer': 'Cave créée',
  'cave.modifier': 'Configuration de cave modifiée',
  'cave.releve': 'Contrôle de conservation',
  'cave.releve_annuler': 'Relevé annulé',
  connexion: 'Connexion',
  'parametres.modifier': 'Paramètres modifiés',
  'formule.modifier': 'Formule modifiée',
  'utilisateur.creer': 'Utilisateur créé',
  'utilisateur.modifier': 'Utilisateur modifié',
  'utilisateur.mot_de_passe_reinitialise': 'Mot de passe réinitialisé',
  'utilisateur.mot_de_passe_modifie': 'Mot de passe modifié',
  'utilisateur.acces_reinitialise': 'Accès de l’administrateur réinitialisé',
  'membre.creer': 'Membre créé',
  'membre.modifier': 'Fiche membre modifiée',
  'membre.supprimer': 'Membre supprimé',
  'membre.desactiver': 'Membre désactivé',
  'membre.reactiver': 'Membre réactivé',
  'client.creer': 'Client régulier créé',
  'client.passer_membre': 'Client régulier passé en membre',
  'client.plafond': 'Plafond de crédit modifié',
  'client.reglement': 'Règlement de créance',
  'client.reglement.annuler': 'Règlement de créance annulé',
  'client.acces.creer': 'Accès client créé',
  'client.acces.code': 'Nouveau code provisoire du client',
  'client.acces.couper': 'Accès client coupé',
  'client.acces.retablir': 'Accès client rétabli',
  'client.identifiant': 'Identifiant choisi par le client',
  'client.mot_de_passe': 'Mot de passe choisi par le client',
  'client.commande': 'Commande Boutique du client',
  'client.commande.annuler': 'Commande annulée par le client',
  'client.demande.creer': 'Demande de réservation du client',
  'client.demande.annuler': 'Demande de réservation annulée par le client',
  'commande.prete': 'Commande prête',
  'commande.annuler': 'Commande annulée',
  'commande.cloturer': 'Commande clôturée (retrait partiel)',
  'demande.refuser': 'Demande de réservation refusée',
  'boutique.vente': 'Vente Boutique',
  'boutique.vente.annuler': 'Vente Boutique annulée',
  'salle.creer': 'Salle créée',
  'salle.modifier': 'Salle modifiée',
  'salle.supprimer': 'Salle supprimée',
  'abonnement.activer': 'Formule activée',
  'abonnement.renouveler': 'Formule renouvelée',
  'abonnement.annuler': 'Abonnement annulé',
  'abonnement.renouveler_auto': 'Formule renouvelée automatiquement',
  'credit.ajuster': 'Crédit ajusté',
  'carte.emettre': 'Carte émise',
  'carte.desactiver': 'Carte désactivée',
  'carte.recharger': 'Carte membre approvisionnée',
  'carte.annuler_recharge': 'Approvisionnement de carte annulé',
  'carte.payer': 'Paiement par carte membre',
  'carte.rembourser': 'Rendu sur la carte membre',
  'carte.repas': 'Repas extérieur',
  'carte.annuler_repas': 'Repas extérieur annulé',
  'reservation.creer': 'Réservation créée',
  'reservation.modifier': 'Salle / nombre de personnes modifié',
  'reservation.prolonger': 'Prolongation',
  'reservation.demarrer': 'Arrivée : réservation démarrée',
  'reservation.terminer': 'Réservation terminée',
  'reservation.depassement': 'Dépassement compté à la sortie',
  'reservation.corriger_depart': 'Heure de départ corrigée',
  'reservation.annuler': 'Réservation annulée',
  'reservation.absence': 'Absence du membre : réservation close',
  'reservation.consommation.ajouter': 'Consommation ajoutée',
  'reservation.retirer_membre': 'Membre retiré de la réservation',
  'paiement.enregistrer': 'Encaissement',
  'ticket.imprimer': 'Ticket imprimé',
  'ticket.whatsapp': 'Ticket envoyé par WhatsApp',
  'ligne.annuler': 'Ligne annulée',
  'ligne.rembourser': 'Remboursement',
  'produit.creer': 'Produit créé',
  'produit.modifier': 'Produit modifié',
  'produit.photo': 'Photo du produit enregistrée',
  'produit.photo_retirer': 'Photo du produit retirée',
  'produit.importer': 'Produit importé du catalogue',
  'produits.desactiver_fictifs': 'Produits de démonstration désactivés',
  'stock.entree': 'Entrée de stock',
  'stock.ajustement': 'Ajustement de stock',
  'categorie.creer': 'Catégorie créée',
  'categorie.modifier': 'Catégorie modifiée',
  'operation.creer': 'Opération de trésorerie',
  'operation.annuler': 'Opération annulée',
  'caisse.compter': 'Caisse comptée',
  'caisse.benefices': 'Prise de bénéfices',
  'fournisseur.creer': 'Fournisseur créé',
  'fournisseur.modifier': 'Fournisseur modifié',
  'fournisseur.achat': 'Achat fournisseur enregistré',
  'fournisseur.achat_annuler': 'Achat fournisseur annulé',
  'caisse.fermer': 'Caisse du jour fermée',
  'caisse.verifier': 'Caisse du jour vérifiée',
  'caisse.rouvrir': 'Caisse du jour rouverte',
  'periode.cloturer': 'Mois clôturé',
  'periode.rouvrir': 'Mois rouvert',
  'donnees.effacer': 'Données effacées',
  'demo.remettre_a_neuf': 'Démo remise à neuf',
};

// Who did it: the staff member, or « Client » for what a client did in his space (no account, the client in the
// details), else the club on its own (an automatic renewal).
export function auditAuthor(a) {
  if (a.user_name) return a.user_name;
  return a.user_id == null && a.details?.client ? 'Client' : 'système';
}

const BUYER_LABEL = { journalier: 'client journalier', client: 'client régulier', membre: 'membre' };

const ENTRY_KIND = { depense: 'Dépense', recette: 'Entrée diverse', transfert: 'Transfert', retrait: 'Prise de bénéfices' };

export function auditSummary(a) {
  const d = a.details ?? {};
  switch (a.action) {
    case 'cave.creer':
    case 'cave.modifier':
      return d.nom;
    case 'cave.releve':
      return `${d.nom} · ${d.humidite} % HR · ${d.temperature} °C${d.notes ? ` · ${d.notes}` : ''}`;
    case 'cave.releve_annuler':
      return d.motif;
    case 'membre.supprimer':
    case 'membre.reactiver':
      return `${d.nom ?? ''} (${d.member_no ?? ''})`;
    case 'membre.desactiver':
      return `${d.nom ?? ''} (${d.member_no ?? ''}) — ${d.motif ?? ''}`;
    case 'salle.creer':
    case 'salle.modifier':
    case 'salle.supprimer':
      return `${d.name ?? ''}${d.capacity ? ` · ${d.capacity} pers.` : ''}`;
    case 'reservation.creer':
      return `${d.salle ? `${d.salle} · ` : ''}${d.personnes ? `${d.personnes} pers. · ` : ''}${fmtDuration(d.duree ?? 0)}, dont ${fmtDuration(d.minutes_incluses ?? 0)} incluses${d.supplement ? ` ; supplément ${money(d.supplement)}` : ''}${d.hors_horaires ? ' ; hors horaires autorisé' : ''}`;
    case 'reservation.modifier':
      return `${d.salle ?? ''} · ${d.personnes ?? 1} personne(s)`;
    case 'reservation.prolonger':
      return `+${fmtDuration(d.minutes ?? 0)}${d.supplement_ajoute ? ` ; supplément +${money(d.supplement_ajoute)}` : ''}${d.hors_horaires ? ' ; hors horaires autorisé' : ''}`;
    case 'reservation.terminer':
      return `${fmtDuration(d.minutes_consommees ?? 0)} consommées`;
    case 'reservation.depassement':
      return `+${fmtDuration(d.minutes ?? 0)}${d.montant ? ` ; ${money(d.montant)}` : ''}`;
    case 'reservation.corriger_depart':
      return `départ à ${d.depart} ; dépassement de ${fmtDuration(d.minutes_annulees ?? 0)} annulé${d.minutes ? `, ${fmtDuration(d.minutes)} recomptées` : ''}`;
    case 'reservation.annuler':
    case 'reservation.absence':
      return `${d.motif ?? ''} ; ${fmtDuration(d.minutes_liberees ?? 0)} libérées${d.acompte_conserve ? ` ; acompte de ${money(d.acompte_conserve)} conservé` : ''}`;
    case 'reservation.consommation.ajouter':
      return `${d.produit} × ${d.quantite} (${money(d.montant)}, ${ACCOUNT_LABEL[d.sous_compte] ?? ''})`;
    case 'client.creer':
      return `${d.nom ?? ''} (${d.member_no ?? ''})`;
    case 'client.passer_membre':
      return `${d.nom ?? ''} : ${d.ancien_numero ?? ''} → ${d.nouveau_numero ?? ''}`;
    case 'client.plafond':
      return `${d.nom ?? ''} : ${money(d.avant ?? 0)} → ${money(d.apres ?? 0)}`;
    case 'client.reglement':
      return `${money(d.montant)} — ${d.moyen}`;
    case 'client.reglement.annuler':
      return `${money(d.montant)} — ${d.motif}`;
    case 'client.acces.creer':
    case 'client.acces.code':
    case 'client.acces.couper':
    case 'client.acces.retablir':
      return `${d.member_no ?? ''} · identifiant ${d.login ?? ''}`;
    case 'client.identifiant':
      return `${d.avant ?? ''} → ${d.apres ?? ''}`;
    case 'client.commande':
      return (d.lignes ?? []).map((l) => `${l.quantite} × ${l.produit}`).join(', ');
    case 'client.demande.creer':
      return `${dayLabel(d.date, 'short')} à ${d.debut}, ${fmtDuration(d.duree ?? 0)}`;
    case 'commande.annuler':
    case 'demande.refuser':
      return d.motif ?? '';
    case 'caisse.verifier':
      return dayLabel(d.jour, 'short');
    case 'boutique.vente':
      return `${RAYON_LABEL[d.rayon] ?? d.rayon} · ${BUYER_LABEL[d.acheteur] ?? d.acheteur} · ${money(d.montant)}${d.carte > 0 ? ` (dont ${money(d.carte)} par carte)` : ''}`;
    case 'boutique.vente.annuler':
      return `${RAYON_LABEL[d.rayon] ?? d.rayon} · ${money(d.montant)} — ${d.motif}`;
    case 'paiement.enregistrer':
      return `${money(d.montant)} — ${d.moyen}${d.reference ? ` (${d.reference})` : ''}`;
    case 'ligne.annuler':
      return `${d.libelle} (${money(d.montant)}) — ${d.motif}`;
    case 'ligne.rembourser':
      return `${d.libelle} (${money(d.montant)}) — ${d.motif}${d.remis_en_stock ? ' ; remis en stock' : ''}`;
    case 'abonnement.activer':
    case 'abonnement.renouveler':
      return `${d.formule} du ${dayLabel(d.debut, 'short')} au ${dayLabel(d.fin, 'short')}`;
    case 'carte.emettre':
      return `${d.type} ${d.code}`;
    case 'credit.ajuster':
      return `${d.minutes > 0 ? '+' : ''}${d.minutes} min — ${d.motif}`;
    case 'stock.entree':
      return `+${d.quantite}`;
    case 'stock.ajustement':
      return `${d.avant} → ${d.apres} — ${d.motif}`;
    case 'operation.creer':
      return `${ENTRY_KIND[d.type] ?? ''} du ${dayLabel(d.date, 'short')} : ${d.libelle} (${money(d.montant)}${d.montant_devise ? ` (${formatForeign(d.montant_devise, d.devise)})` : ''}, ${d.compte}${d.vers ? ` → ${d.vers}` : ''})${d.fournisseur ? ` ; fournisseur ${d.fournisseur}` : ''}`;
    case 'fournisseur.creer':
      return [d.nom, d.caisse, d.pays, d.devise].filter(Boolean).join(' · ');
    case 'fournisseur.modifier':
      return d.apres?.nom ?? '';
    case 'fournisseur.achat':
      return `${d.nom} · ${d.type} du ${dayLabel(d.date, 'short')} : ${money(d.montant)}${d.montant_devise ? ` (${formatForeign(d.montant_devise, d.devise)})` : ''}${d.reference ? ` · facture ${d.reference}` : ''}`;
    case 'fournisseur.achat_annuler':
      return `${d.nom} · ${d.type} de ${money(d.montant)} — ${d.motif}`;
    case 'caisse.benefices':
      return `${CAISSE_LABEL[d.caisse] ?? d.caisse} : ${money(d.montant)} (${d.compte})${d.parts ? `, soit ${money(d.parts.cigares)} chacun` : ''}`;
    case 'operation.annuler':
      return `${ENTRY_KIND[d.type] ?? ''} de ${money(d.montant)} — ${d.motif}`;
    case 'periode.cloturer':
      return `${d.mois} ; résultat ${money(d.resultat)}`;
    case 'periode.rouvrir':
      return `${d.mois} — ${d.motif}`;
    case 'utilisateur.acces_reinitialise':
      return `Identifiant ${d.avant} → ${d.apres}, avec le code d’installation`;
    default:
      return '';
  }
}
