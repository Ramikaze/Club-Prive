// Guided tour of the main screens: one highlighted element per step, after opening its page.
// Screens reserved to administrators are skipped for the manager. Arrow keys move, Escape quits.
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import Icon from './Icon.jsx';

export const TOUR_DONE_KEY = 'club-tour-done';

const STEPS = [
  {
    route: '/', targets: ['[data-tour="nav"]', '[data-tour="nav-mobile"]'], icon: 'menu', title: 'Navigation',
    body: 'Chaque rubrique du club est à un clic. Sur téléphone, les rubriques principales sont dans la barre du bas et les autres dans le menu.',
  },
  {
    route: '/', targets: ['[data-tour="dashboard"]'], icon: 'home', title: 'Tableau de bord',
    body: 'La soirée en un coup d’œil : la salle est-elle occupée et jusqu’à quand, les séances du jour, ce qu’il reste à encaisser et les alertes.',
    features: ['Formules qui expirent', 'Stocks bas', 'Séances à clôturer'],
  },
  {
    route: '/agenda', targets: ['[data-tour="agenda-views"]', '[data-tour="agenda"]'], icon: 'calendar', title: 'Agenda de la salle',
    body: 'Vues jour, semaine et liste. Touchez un créneau libre pour réserver. Les hachures signalent les heures hors horaires habituels : jusqu’à 5 h, avec une autorisation explicite.',
  },
  {
    route: '/membres', targets: ['[data-tour="members"]'], icon: 'users', title: 'Membres et cartes',
    body: 'Chaque membre a une formule et une carte, physique ou virtuelle. Le crédit d’heures est engagé à la réservation, consommé à la fin, libéré en cas d’annulation.',
    features: ['Mensuelle : 2 heures', 'Annuelle : 24 heures', 'Au-delà : 25 000 l’heure, 15 000 la demi-heure'],
  },
  {
    route: '/produits', targets: ['[data-tour="products"]'], icon: 'box', title: 'Produits et stocks',
    body: 'Cigares et bouteilles, vendues entières uniquement. Chaque entrée, vente, annulation ou ajustement laisse un mouvement de stock traçable.',
  },
  {
    route: '/lounge', targets: ['[data-tour="lounge"]'], icon: 'humidor', title: 'Cave & casiers',
    body: 'Relevez l’humidité et la température de chaque cave. Attribuez les casiers aux membres et tracez chaque dépôt ou retrait de leurs cigares personnels. Les échéances et les contrôles en retard apparaissent sur le tableau de bord.',
  },
  {
    route: '/caisse', targets: ['[data-tour="cash"]'], icon: 'wallet', title: 'Caisse et sous-comptes',
    body: 'Les recettes sont ventilées exactement entre Réservations, Alcool et Cigares. Chaque ligne est encaissée en totalité ; un remboursement est tracé avec son motif.',
    features: ['Journal des encaissements', 'Exports CSV et Excel'],
  },
  {
    route: '/depenses', targets: ['[data-tour="expenses"]'], icon: 'receipt', title: 'Dépenses',
    body: 'Le gérant saisit les dépenses du jour. L’administrateur saisit aussi les entrées diverses et les transferts entre caisses, et peut annuler une opération en indiquant un motif.',
  },
  {
    admin: true, route: '/tresorerie', targets: ['[data-tour="treasury"]'], icon: 'bank', title: 'Trésorerie',
    body: 'Le solde de chaque caisse et compte sur la période, et le résultat : encaissements nets moins dépenses, par sous-compte.',
  },
  {
    admin: true, route: '/grand-livre', targets: ['[data-tour="ledger"]'], icon: 'book', title: 'Grand livre',
    body: 'Tous les mouvements dans l’ordre chronologique, avec le solde courant. Filtrez par compte ou par sous-compte, puis exportez vers Excel.',
  },
  {
    admin: true, route: '/cloture', targets: ['[data-tour="closing"]'], icon: 'lock', title: 'Clôture mensuelle',
    body: 'Après les vérifications (espèces comptées, relevés rapprochés), le mois est verrouillé : plus aucune opération datée de ce mois. Une réouverture exige un motif et reste dans l’historique.',
  },
  {
    admin: true, route: '/parametres', targets: ['[data-tour="settings"]'], icon: 'settings', title: 'Paramètres',
    body: 'Horaires, tarifs et formules, utilisateurs, soldes d’ouverture, catégories de dépenses, journal des actions et données de démonstration.',
  },
  {
    route: '/', targets: ['[data-tour="account"]', '[data-tour="menu"]'], icon: 'key', title: 'Votre compte',
    body: 'Changez votre mot de passe, passez en thème sombre pour le service du soir, relancez cette visite ou déconnectez-vous.',
  },
];

const WELCOME_FEATURES = [
  ['calendar', 'Agenda jour, semaine, liste'],
  ['users', 'Membres, cartes, crédits'],
  ['box', 'Cigares et bouteilles'],
  ['wallet', 'Caisse en trois sous-comptes'],
  ['bank', 'Dépenses et trésorerie'],
  ['excel', 'Grand livre, clôture, Excel'],
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

const markDone = () => {
  try { localStorage.setItem(TOUR_DONE_KEY, '1'); } catch { /* storage unavailable */ }
};

export default function GuidedTour({ active, onClose, isAdmin, clubName }) {
  const steps = useMemo(() => STEPS.filter((s) => isAdmin || !s.admin), [isAdmin]);
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
    markDone();
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
