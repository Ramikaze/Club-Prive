// Human-readable history lines for the audit log (reservation history, settings > journal).
import { money, fmtDuration, dayLabel, ACCOUNT_LABEL } from './format.js';

export const ACTION_LABELS = {
  'cave.creer': 'Cave créée',
  'cave.modifier': 'Configuration de cave modifiée',
  'cave.releve': 'Contrôle de conservation',
  'cave.releve_annuler': 'Relevé annulé',
  'casier.creer': 'Casier créé',
  'casier.disponibilite': 'Disponibilité du casier modifiée',
  'casier.attribuer': 'Casier attribué',
  'casier.renouveler': 'Casier renouvelé',
  'casier.liberer': 'Casier libéré',
  'casier.depot': 'Dépôt de cigares privés',
  'casier.retrait': 'Retrait de cigares privés',
  connexion: 'Connexion',
  'parametres.modifier': 'Paramètres modifiés',
  'formule.modifier': 'Formule modifiée',
  'utilisateur.creer': 'Utilisateur créé',
  'utilisateur.modifier': 'Utilisateur modifié',
  'utilisateur.mot_de_passe_reinitialise': 'Mot de passe réinitialisé',
  'utilisateur.mot_de_passe_modifie': 'Mot de passe modifié',
  'membre.creer': 'Membre créé',
  'membre.modifier': 'Fiche membre modifiée',
  'abonnement.activer': 'Formule activée',
  'abonnement.renouveler': 'Formule renouvelée',
  'abonnement.annuler': 'Abonnement annulé',
  'credit.ajuster': 'Crédit ajusté',
  'carte.emettre': 'Carte émise',
  'carte.desactiver': 'Carte désactivée',
  'reservation.creer': 'Réservation créée',
  'reservation.prolonger': 'Prolongation',
  'reservation.demarrer': 'Arrivée : réservation démarrée',
  'reservation.terminer': 'Réservation terminée',
  'reservation.annuler': 'Réservation annulée',
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
    case 'casier.liberer':
      return d.motif;
    case 'casier.creer':
      return `${d.casier} · ${d.cave}`;
    case 'casier.disponibilite':
      return `${d.casier} · ${d.disponible ? 'disponible' : 'hors service'} · ${d.motif}`;
    case 'casier.attribuer':
      return `${d.casier} · membre n° ${d.membre} · jusqu’au ${dayLabel(d.fin, 'short')}`;
    case 'casier.renouveler':
      return `${dayLabel(d.avant, 'short')} → ${dayLabel(d.fin, 'short')}`;
    case 'casier.depot':
    case 'casier.retrait':
      return `${d.cigare} × ${d.quantite}${d.motif ? ` · ${d.motif}` : ''}`;
    case 'reservation.creer':
      return `${fmtDuration(d.duree ?? 0)}, dont ${fmtDuration(d.minutes_incluses ?? 0)} incluses${d.supplement ? ` ; supplément ${money(d.supplement)}` : ''}${d.hors_horaires ? ' ; hors horaires autorisé' : ''}`;
    case 'reservation.prolonger':
      return `+${fmtDuration(d.minutes ?? 0)}${d.supplement_ajoute ? ` ; supplément +${money(d.supplement_ajoute)}` : ''}${d.hors_horaires ? ' ; hors horaires autorisé' : ''}`;
    case 'reservation.terminer':
      return `${fmtDuration(d.minutes_consommees ?? 0)} consommées`;
    case 'reservation.annuler':
      return `${d.motif ?? ''} ; ${fmtDuration(d.minutes_liberees ?? 0)} libérées`;
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
    default:
      return '';
  }
}
