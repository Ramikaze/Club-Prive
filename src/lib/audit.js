// Human-readable history lines for the audit log (reservation history, settings > journal).
import { money, fmtDuration, dayLabel, ACCOUNT_LABEL } from './format.js';

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
  'utilisateur.acces_reinitialise': 'Accès du propriétaire réinitialisé',
  'membre.creer': 'Membre créé',
  'membre.modifier': 'Fiche membre modifiée',
  'membre.supprimer': 'Membre supprimé',
  'membre.desactiver': 'Membre désactivé',
  'membre.reactiver': 'Membre réactivé',
  'salle.creer': 'Salle créée',
  'salle.modifier': 'Salle modifiée',
  'salle.supprimer': 'Salle supprimée',
  'abonnement.activer': 'Formule activée',
  'abonnement.renouveler': 'Formule renouvelée',
  'abonnement.annuler': 'Abonnement annulé',
  'credit.ajuster': 'Crédit ajusté',
  'carte.emettre': 'Carte émise',
  'carte.desactiver': 'Carte désactivée',
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
  'paiement.enregistrer': 'Encaissement',
  'ligne.annuler': 'Ligne annulée',
  'ligne.rembourser': 'Remboursement',
  'produit.creer': 'Produit créé',
  'produit.modifier': 'Produit modifié',
  'stock.entree': 'Entrée de stock',
  'stock.ajustement': 'Ajustement de stock',
  'categorie.creer': 'Catégorie créée',
  'categorie.modifier': 'Catégorie modifiée',
  'operation.creer': 'Opération de trésorerie',
  'operation.annuler': 'Opération annulée',
  'periode.cloturer': 'Mois clôturé',
  'periode.rouvrir': 'Mois rouvert',
  'donnees.effacer': 'Données effacées',
  'demo.remettre_a_neuf': 'Démo remise à neuf',
};

const ENTRY_KIND = { depense: 'Dépense', recette: 'Entrée diverse', transfert: 'Transfert' };

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
      return `${ENTRY_KIND[d.type] ?? ''} du ${dayLabel(d.date, 'short')} : ${d.libelle} (${money(d.montant)}, ${d.compte}${d.vers ? ` → ${d.vers}` : ''})`;
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
