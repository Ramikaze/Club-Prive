// Guided tour of the main screens: one highlighted element per step, after opening its page.
// Screens reserved to administrators are skipped for the manager. Arrow keys move, Escape quits.
// The tour opens by itself on the first visit to the demo space, where a few controls are hidden or
// replaced: a step then words itself differently (`inDemo` replaces the fields it names).
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import Icon from './Icon.jsx';
import { useStore } from '../../store/useStore.js';

// The tour proposes itself by itself on the first entry to the demo space (AppShell), once per browser. The
// key is its own, set only when the tour is closed in the demo: the older `club-tour-done` was set
// wherever the tour was closed, so a browser that had seen it on the real site would never be offered it.
export const TOUR_DEMO_DONE_KEY = 'club-tour-demo-done';

// Each step points at the precise control or block it explains, with fallbacks to the page header
// when that element is not on screen (no occupied room, empty agenda, phone layout...).
const STEPS = [
  {
    route: '/', targets: ['[data-tour="nav"]', '[data-tour="nav-mobile"]'], icon: 'menu', title: 'Le menu du club',
    body: 'Les rubriques suivent la soirée : Accueil, Salles, Agenda, Membres, Stocks & Cave, Caisse. Administration n’apparaît qu’aux administrateurs.',
    features: ['Sur téléphone : rubriques principales en bas de l’écran, les autres dans le menu en haut à droite', 'Les onglets en tête de page passent d’une sous-rubrique à l’autre'],
  },
  {
    route: '/', targets: ['.kpis', '[data-tour="dashboard"]'], icon: 'home', title: 'Les trois repères de l’accueil',
    body: 'Séances du jour, encaissé aujourd’hui et reste à encaisser. Touchez un repère pour ouvrir la page correspondante.',
  },
  {
    route: '/', targets: ['[data-tour="live-rooms"]', '[data-tour="dashboard"]'], icon: 'rooms', title: 'Les salles en direct',
    body: 'Pour chaque salle : le titulaire, le nombre de personnes, l’horaire et le temps déjà passé en salle. Ajoutez une bouteille ou un cigare sans quitter l’accueil.',
  },
  {
    route: '/salles', targets: ['.rooms-grid'], icon: 'rooms', title: 'Salles & salons',
    body: 'Une carte par salle : capacité, état (Disponible, Occupée, Fermée) et prochaine réservation prévue. La liste se met à jour toute seule.',
    features: ['Filtres Toutes, Libres, Occupées', 'Création et modification des salles réservées aux administrateurs'],
  },
  {
    route: '/salles', targets: ['.room-card.is-free .room-card-actions .btn-primary', '.rooms-grid'], icon: 'plus', title: 'Installer un membre',
    body: '« Installer un membre » ouvre une réservation qui commence tout de suite : titulaire, durée et membres présents. Chaque membre doit avoir une carte active, une formule valide et du crédit.',
    features: ['« Réserver un créneau » pour plus tard', 'Le crédit de chaque membre présent est engagé à part'],
  },
  {
    route: '/salles', targets: ['.room-card .session-timer', '.room-card.is-occupied', '.rooms-grid'], icon: 'clock', title: 'Le compteur de séance',
    body: 'Il démarre dès l’arrivée du membre et défile à la seconde : heure d’arrivée, temps passé, temps restant jusqu’à la fin prévue.',
    features: ['Orange dans les 15 dernières minutes', 'Rouge avec la durée du dépassement', '« Prolonger » depuis la carte de la salle'],
  },
  {
    route: '/salles', targets: ['.room-card .conso', '.room-card.is-occupied', '.rooms-grid'], icon: 'receipt', title: 'Consommations par membre',
    body: 'Chaque membre présent avec ce qu’il a pris : Cigares et Alcool dans des parties séparées avec leur sous-total, puis le total du salon en bas.',
    features: ['« Facturer bouteille / cigare » : choisissez le membre puis touchez le produit (+1)', 'La note reste au nom du titulaire', '« Libérer la salle » termine la séance et consomme les crédits'],
  },
  {
    route: '/agenda', targets: ['[data-tour="agenda-views"]', '[data-tour="agenda"]'], icon: 'calendar', title: 'Vues de l’agenda',
    body: 'Jour pour le détail heure par heure, Semaine pour l’ensemble, Liste pour filtrer par statut. Les flèches et « Aujourd’hui » changent de date.',
  },
  {
    route: '/agenda', targets: ['.tl-slot:not([disabled])', '[data-tour="agenda"]'], icon: 'calendar', title: 'Réserver depuis l’agenda',
    body: 'Touchez un créneau libre pour réserver à cette heure : la salle se réserve à toute heure, de jour comme de nuit. Minimum une heure, deux heures le vendredi et le samedi à partir de 18 h.',
    features: ['Le devis affiche crédit utilisé et supplément avant confirmation', 'Une salle ne peut pas être réservée deux fois sur le même créneau'],
  },
  {
    route: '/membres', targets: ['.search', '[data-tour="members"]'], icon: 'search', title: 'Retrouver un membre',
    body: 'Cherchez par nom, téléphone, numéro de membre ou code de carte ; le QR code d’une carte ouvre aussi la fiche, après connexion du personnel.',
    features: ['Formule mensuelle : 2 heures ; annuelle : 24 heures', 'Crédit engagé à la réservation, consommé à la fin, libéré à l’annulation', 'Au-delà : 25 000 l’heure, 15 000 la demi-heure'],
  },
  {
    route: '/membres', targets: ['[data-tour="members"] .actions .btn-primary', '[data-tour="members"]'], icon: 'user-plus', title: 'Nouveau membre',
    body: 'Fiche, formule et carte physique ou virtuelle en une seule étape. La fiche montre ensuite crédit, cartes, séances et paiements.',
  },
  {
    route: '/produits', targets: ['[data-tour="products"]'], icon: 'box', title: 'Catalogue & stocks',
    body: 'Cigares et bouteilles (vendues entières uniquement) avec leur stock. Entrées et ajustements avec motif ; chaque mouvement reste dans l’historique du produit.',
    features: ['Alerte quand un stock passe sous son seuil', 'Onglet Cave pour la conservation'],
  },
  {
    route: '/lounge', targets: ['.humidor-card', '[data-tour="lounge"]'], icon: 'humidor', title: 'Cave à cigares',
    body: 'Relevés manuels d’humidité et de température, seuils propres à chaque cave. Un relevé hors seuils déclenche une alerte ; un contrôle en retard est signalé.',
  },
  {
    route: '/caisse', targets: ['.account-cards', '[data-tour="cash"]'], icon: 'wallet', title: 'Caisse',
    body: 'Les recettes sont ventilées exactement entre Réservations, Alcool et Cigares. Les notes ouvertes s’encaissent ligne par ligne, en totalité.',
    features: ['Remboursement tracé avec son motif', 'Exports CSV et Excel'],
  },
  {
    route: '/depenses', targets: ['[data-tour="expenses"] .actions .btn-primary', '[data-tour="expenses"]'], icon: 'receipt', title: 'Dépenses du jour',
    body: '« Nouvelle dépense » : catégorie, montant, caisse ou compte utilisé, et le sous-compte concerné pour suivre sa marge.',
    features: ['L’administrateur saisit aussi entrées diverses et transferts', 'Annulation avec motif, jamais de suppression'],
  },
  {
    admin: true, route: '/parametres', targets: ['[data-tour="settings"]'], icon: 'settings', title: 'Paramètres',
    body: 'Horaires, tarifs et formules, moyens de paiement, soldes d’ouverture, catégories de dépenses, utilisateurs et journal des actions.',
    inDemo: {
      body: 'Horaires, tarifs et formules, moyens de paiement, soldes d’ouverture, catégories de dépenses et journal des actions. Les changements faits ici restent dans la démo.',
      features: [
        '« Remettre la démo à neuf » (onglet Équipe & Système) efface les essais et remet des données fictives neuves',
        'Les comptes utilisateurs se gèrent hors du mode démo',
      ],
    },
  },
  {
    admin: true, route: '/tresorerie', targets: ['.account-cards', '[data-tour="treasury"]'], icon: 'bank', title: 'Trésorerie',
    body: 'Solde de chaque caisse et compte sur la période choisie, puis le résultat : encaissé net moins dépenses, par sous-compte.',
  },
  {
    admin: true, route: '/grand-livre', targets: ['[data-tour="ledger"]'], icon: 'book', title: 'Grand livre',
    body: 'Tous les mouvements de trésorerie dans l’ordre, avec le solde courant. Filtrez par compte ou par sous-compte ; exportez en CSV ou Excel.',
  },
  {
    admin: true, route: '/cloture', targets: ['[data-tour="closing"]'], icon: 'lock', title: 'Clôture mensuelle',
    body: 'Après trois vérifications (espèces comptées, relevés rapprochés, dépenses saisies), le mois est verrouillé. Une réouverture exige un motif et reste dans l’historique.',
  },
  {
    route: '/', targets: ['[data-tour="account"]', '[data-tour="menu"]'], icon: 'key', title: 'Votre compte',
    body: 'Changez votre mot de passe, passez en thème sombre pour le service du soir (la bascule se fait dans une fumée de cigare), relancez cette visite ou déconnectez-vous.',
    features: ['Le chapeau de diplômé orange ouvre le mode démo : s’entraîner sans toucher aux vraies données'],
    inDemo: {
      icon: 'demo',
      body: 'Passez en thème sombre pour le service du soir (la bascule se fait dans une fumée de cigare), relancez cette visite ou déconnectez-vous.',
      features: ['« Quitter la démo » vous ramène au vrai club', 'Le mot de passe se change hors du mode démo'],
    },
  },
];

const WELCOME_FEATURES = [
  ['rooms', 'Salles, compteur de séance'],
  ['receipt', 'Consommations par membre'],
  ['calendar', 'Agenda jour, semaine, liste'],
  ['users', 'Membres, cartes, crédits'],
  ['box', 'Stocks & cave à cigares'],
  ['wallet', 'Caisse, dépenses, comptabilité'],
];

const PAD = 16;

function placeCard(rect, w, h) {
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  if (!rect) return { top: Math.max(PAD, (vh - h) / 2), left: Math.max(PAD, (vw - w) / 2) };
  let top;
  let left;
  if (rect.left + rect.width + PAD + w < vw - PAD) {
    left = rect.left + rect.width + PAD;
    top = rect.top;
  } else if (rect.top + rect.height + PAD + h < vh - PAD) {
    top = rect.top + rect.height + PAD;
    left = rect.left;
  } else if (rect.top - PAD - h > PAD) {
    top = rect.top - PAD - h;
    left = rect.left;
  } else {
    top = vh - h - PAD;
    left = (vw - w) / 2;
  }
  return {
    top: Math.min(Math.max(PAD, top), Math.max(PAD, vh - h - PAD)),
    left: Math.min(Math.max(PAD, left), Math.max(PAD, vw - w - PAD)),
  };
}

const markDemoDone = () => {
  try { localStorage.setItem(TOUR_DEMO_DONE_KEY, '1'); } catch { /* storage unavailable */ }
};

export default function GuidedTour({ active, onClose, isAdmin, clubName }) {
  const demo = useStore((s) => s.demo);
  const steps = useMemo(
    () => STEPS.filter((s) => isAdmin || !s.admin).map((s) => (demo && s.inDemo ? { ...s, ...s.inDemo } : s)),
    [isAdmin, demo],
  );
  const [index, setIndex] = useState(-1); // -1: welcome, steps.length: finished
  const [rect, setRect] = useState(null);
  const [size, setSize] = useState({ w: 380, h: 240 });
  const card = useRef(null);
  const primary = useRef(null);
  const navigate = useNavigate();
  const location = useLocation();
  const step = index >= 0 && index < steps.length ? steps[index] : null;

  useEffect(() => {
    if (active) setIndex(-1);
  }, [active]);

  const measure = useCallback(() => {
    if (!step) return true;
    const el = step.targets.map((t) => document.querySelector(t)).find((x) => x && x.getClientRects().length);
    if (!el) {
      setRect(null);
      return false;
    }
    let r = el.getBoundingClientRect();
    if (r.top < 0 || r.top > window.innerHeight - 80) {
      el.scrollIntoView({ block: 'center' });
      r = el.getBoundingClientRect();
    }
    setRect({ top: r.top - 6, left: r.left - 6, width: r.width + 12, height: Math.min(r.height + 12, window.innerHeight - r.top) });
    return true;
  }, [step]);

  // Open the step's page, then wait for its element (pages load their data first).
  useEffect(() => {
    if (!active || !step) return undefined;
    if (location.pathname !== step.route) {
      setRect(null);
      navigate(step.route);
      return undefined;
    }
    let tries = 0;
    const timer = setInterval(() => {
      tries += 1;
      if (measure() || tries > 25) clearInterval(timer);
    }, 120);
    const onResize = () => measure();
    window.addEventListener('resize', onResize);
    return () => {
      clearInterval(timer);
      window.removeEventListener('resize', onResize);
    };
  }, [active, step, location.pathname, navigate, measure]);

  useLayoutEffect(() => {
    if (!card.current) return;
    const r = card.current.getBoundingClientRect();
    if (Math.abs(r.width - size.w) > 1 || Math.abs(r.height - size.h) > 1) setSize({ w: r.width, h: r.height });
  });

  useEffect(() => {
    if (active) primary.current?.focus();
  }, [active, index]);

  const quit = () => {
    if (demo) markDemoDone();
    onClose();
  };
  const next = () => setIndex((i) => Math.min(i + 1, steps.length));
  const prev = () => setIndex((i) => Math.max(i - 1, 0));
  const finish = () => {
    quit();
    navigate('/');
  };

  useEffect(() => {
    if (!active) return undefined;
    const onKey = (e) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        quit();
      } else if (e.key === 'ArrowRight' && index < steps.length) next();
      else if (e.key === 'ArrowLeft' && index > 0) prev();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  });

  if (!active) return null;

  if (index < 0) {
    return (
      <div className="tour-center" role="dialog" aria-modal="true" aria-labelledby="tour-title">
        <div className="tour-card">
          <h2 id="tour-title"><Icon name="tour" /> Visite guidée</h2>
          <p>En quelques étapes, découvrez comment {clubName} se gère au quotidien : la salle, les membres, les stocks, la caisse et le suivi financier.</p>
          <ul className="tour-features">
            {WELCOME_FEATURES.map(([icon, label]) => <li key={label}><Icon name={icon} />{label}</li>)}
          </ul>
          <div className="modal-actions">
            <button type="button" className="btn" onClick={quit}>Plus tard</button>
            <button type="button" className="btn btn-primary" ref={primary} onClick={next}>Commencer la visite</button>
          </div>
        </div>
      </div>
    );
  }

  if (!step) {
    return (
      <div className="tour-center" role="dialog" aria-modal="true" aria-labelledby="tour-title">
        <div className="tour-card">
          <h2 id="tour-title"><Icon name="check" /> Visite terminée</h2>
          <p>Vous pouvez la relancer à tout moment avec le bouton « Visite guidée », dans la barre latérale ou dans le menu du compte.</p>
          <div className="modal-actions">
            <button type="button" className="btn" onClick={prev}>Revoir la dernière étape</button>
            <button type="button" className="btn btn-primary" ref={primary} onClick={finish}>Terminer</button>
          </div>
        </div>
      </div>
    );
  }

  const pos = placeCard(rect, size.w, size.h);
  return (
    <div className="tour-layer">
      <div className={`tour-shade ${rect ? '' : 'full'}`} />
      {rect && <div className="tour-ring" style={{ top: rect.top, left: rect.left, width: rect.width, height: rect.height }} />}
      <div className="tour-card" ref={card} style={{ top: pos.top, left: pos.left }} role="dialog" aria-modal="true" aria-labelledby="tour-title">
        <h2 id="tour-title"><Icon name={step.icon} /> {step.title}</h2>
        <p>{step.body}</p>
        {step.features && <ul>{step.features.map((f) => <li key={f}>{f}</li>)}</ul>}
        <div className="tour-foot">
          <span className="tour-count">{index + 1} / {steps.length}</span>
          <div className="tour-progress" aria-hidden="true"><span style={{ width: `${((index + 1) / steps.length) * 100}%` }} /></div>
        </div>
        <div className="modal-actions">
          <button type="button" className="btn btn-ghost btn-sm" onClick={quit}>Quitter</button>
          {index > 0 && <button type="button" className="btn btn-sm" onClick={prev}><Icon name="left" /> Précédent</button>}
          <button type="button" className="btn btn-primary btn-sm" ref={primary} onClick={next}>
            {index < steps.length - 1 ? <>Suivant <Icon name="right" /></> : 'Terminer'}
          </button>
        </div>
      </div>
    </div>
  );
}
