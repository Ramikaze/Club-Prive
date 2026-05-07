import { useState, useEffect, useCallback, useRef } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import './DemoMode.css';

// ─── Tour Steps Definition ────────────────────────────────────
const TOUR_STEPS = [
  // Step 0: Welcome (no target)
  {
    type: 'welcome',
  },
  // Step 1: Sidebar navigation
  {
    target: '[data-tour="sidebar-nav"]',
    route: '/dashboard',
    title: 'Navigation Principale',
    subtitle: 'BARRE LATÉRALE',
    icon: '🧭',
    iconBg: 'linear-gradient(135deg, #6366f1, #8b5cf6)',
    body: `La barre latérale vous donne accès à <strong>toutes les sections</strong> de l'application en un clic :`,
    features: [
      'Dashboard Global — vue consolidée',
      'Recettes & Dépenses — suivi détaillé',
      'Grand Livre — journal comptable',
      'Catégories & Clôture financière',
    ],
    position: 'right',
  },
  // Step 2: Entity selector
  {
    target: '[data-tour="entity-selector"]',
    route: '/dashboard',
    title: 'Sélecteur de Société',
    subtitle: 'MULTI-ENTITÉ',
    icon: '🏢',
    iconBg: 'linear-gradient(135deg, #3b82f6, #0284c7)',
    body: `Basculez instantanément entre vos entités :
<ul class="demo-feature-list">
<li><strong>Meiji Group (Consolidé)</strong> — vue globale</li>
<li><strong>Meiji PN</strong> — Pointe-Noire</li>
<li><strong>Meiji Brazza</strong> — Brazzaville</li>
</ul>
Toutes les données se recalculent automatiquement.`,
    position: 'bottom',
  },
  // Step 3: Date filter
  {
    target: '[data-tour="date-filter"]',
    route: '/dashboard',
    title: 'Filtre Temporel',
    subtitle: 'PÉRIODE D\'ANALYSE',
    icon: '📅',
    iconBg: 'linear-gradient(135deg, #f59e0b, #d97706)',
    body: `Filtrez vos données par période pour une analyse ciblée :`,
    features: [
      'Toutes périodes — historique complet',
      'Journée — suivi quotidien',
      'Mois — reporting mensuel',
      'Personnalisé — plage libre',
    ],
    position: 'bottom',
  },
  // Step 4: Dashboard KPIs
  {
    target: '[data-tour="dashboard-kpis"]',
    route: '/dashboard',
    title: 'Indicateurs Clés (KPIs)',
    subtitle: 'DASHBOARD',
    icon: '📊',
    iconBg: 'linear-gradient(135deg, #10b981, #059669)',
    body: `Visualisez en un coup d'œil la <strong>performance financière</strong> de chaque entité : <em>Chiffre d'Affaires</em>, <em>Dépenses</em> et <em>Résultat Net</em>. En mode consolidé, comparez côte à côte vos deux sociétés.`,
    position: 'bottom',
  },
  // Step 5: Currency switcher
  {
    target: '[data-tour="currency-switcher"]',
    route: '/dashboard',
    title: 'Multi-Devises',
    subtitle: 'CONVERSION TEMPS RÉEL',
    icon: '💱',
    iconBg: 'linear-gradient(135deg, #8b5cf6, #7c3aed)',
    body: `Basculez entre <strong>3 devises</strong> à tout moment :`,
    features: [
      'FCFA — devise locale',
      'EUR — taux fixe (655,957)',
      'USD — taux variable ajustable',
    ],
    position: 'bottom',
  },
  // Step 6: Treasury
  {
    target: '[data-tour="treasury"]',
    route: '/dashboard',
    title: 'Trésorerie Temps Réel',
    subtitle: 'CASH MANAGEMENT',
    icon: '💰',
    iconBg: 'linear-gradient(135deg, #0284c7, #0369a1)',
    body: `Suivez vos <strong>soldes par compte</strong> (Espèces, Banque, MTN Momo, Airtel Money). Cliquez sur un compte pour voir le <em>détail de chaque mouvement</em>. Vous pouvez aussi configurer les <strong>soldes de départ</strong>.`,
    position: 'top',
  },
  // Step 7: Charts
  {
    target: '[data-tour="dashboard-charts"]',
    route: '/dashboard',
    title: 'Graphiques Interactifs',
    subtitle: 'ANALYSE VISUELLE',
    icon: '📈',
    iconBg: 'linear-gradient(135deg, #ec4899, #db2777)',
    body: `Des graphiques dynamiques comparent vos <strong>recettes et dépenses</strong> par jour. Cliquez sur une barre pour voir le <em>détail de la journée</em>. Les graphiques s'adaptent automatiquement au filtre de période.`,
    position: 'top',
  },
  // Step 8: Excel export
  {
    target: '[data-tour="export-excel"]',
    route: '/dashboard',
    title: 'Export Excel',
    subtitle: 'PORTABILITÉ DES DONNÉES',
    icon: '📥',
    iconBg: 'linear-gradient(135deg, #10b981, #047857)',
    body: `Exportez vos données à tout moment dans un fichier <strong>Excel multi-onglets</strong> (Recettes, Dépenses, Toutes les transactions). Disponible sur chaque page !`,
    position: 'bottom',
  },
  // Step 9: Incomes page
  {
    target: '[data-tour="add-income-btn"]',
    route: '/incomes',
    title: 'Gestion des Recettes',
    subtitle: 'PAGE RECETTES',
    icon: '💚',
    iconBg: 'linear-gradient(135deg, #10b981, #059669)',
    body: `Enregistrez vos recettes avec <strong>ventilation par mode de paiement</strong> (Espèces, Banque, MoMo, Airtel). La page offre :`,
    features: [
      'Graphiques camembert par catégorie',
      'Répartition par entité (vue consolidée)',
      'Évolution journalière en barres',
      'Sélection et suppression en masse',
    ],
    position: 'bottom',
  },
  // Step 10: Expenses page
  {
    target: '[data-tour="add-expense-btn"]',
    route: '/expenses',
    title: 'Gestion des Dépenses',
    subtitle: 'PAGE DÉPENSES',
    icon: '🔴',
    iconBg: 'linear-gradient(135deg, #ef4444, #dc2626)',
    body: `Même richesse fonctionnelle que les Recettes : enregistrez vos dépenses avec <strong>ventilation multi-comptes</strong>, visualisez la répartition par catégorie et par entité, et exportez en Excel.`,
    position: 'bottom',
  },
  // Step 11: General Ledger
  {
    target: '[data-tour="new-entry-btn"]',
    route: '/ledger',
    title: 'Grand Livre (Ledger)',
    subtitle: 'JOURNAL COMPTABLE',
    icon: '📒',
    iconBg: 'linear-gradient(135deg, #f59e0b, #d97706)',
    body: `Le journal comptable central avec <strong>toutes les écritures</strong>. Fonctionnalités avancées :`,
    features: [
      'Tri par colonne (date, type, montant…)',
      'Saisie multi-dimensionnelle (entité, département)',
      'Alerte si la période est clôturée',
      'Suppression individuelle ou en masse',
    ],
    position: 'bottom',
  },
  // Step 12: Categories
  {
    target: '[data-tour="categories-section"]',
    route: '/categories',
    title: 'Catégories Comptables',
    subtitle: 'PLAN COMPTABLE',
    icon: '🏷️',
    iconBg: 'linear-gradient(135deg, #6366f1, #4f46e5)',
    body: `Gérez votre <strong>plan comptable simplifié</strong> :`,
    features: [
      'Créer / modifier / supprimer des catégories',
      'Type : Recette ou Dépense',
      'Utilisées dans tous les formulaires',
    ],
    position: 'bottom',
  },
  // Step 13: Financial Close
  {
    target: '[data-tour="financial-close"]',
    route: '/close',
    title: 'Clôture Financière',
    subtitle: 'AUDIT & CONFORMITÉ',
    icon: '🔒',
    iconBg: 'linear-gradient(135deg, #ef4444, #b91c1c)',
    body: `Verrouillez vos périodes comptables pour <strong>garantir l'intégrité</strong> de vos rapports :`,
    features: [
      'Checklist de clôture pré-remplie',
      'Verrouillage mensuel irréversible',
      'Alerte si saisie en période clôturée',
      'Inspiré de Sage Intacct',
    ],
    position: 'bottom',
  },
  // Step 14: Logout
  {
    target: '[data-tour="logout-btn"]',
    route: '/dashboard',
    title: 'Déconnexion Sécurisée',
    subtitle: 'SÉCURITÉ',
    icon: '🔐',
    iconBg: 'linear-gradient(135deg, #ef4444, #dc2626)',
    body: `Déconnectez-vous en toute sécurité. Votre session est protégée par <strong>mot de passe</strong> et vos données sont persistées localement dans le navigateur.`,
    position: 'right',
  },
  // Step 15: Completion
  {
    type: 'complete',
  },
];

// ─── Helper: compute tooltip position ────────────────────────
function computeTooltipPosition(targetRect, position, tooltipW = 420, tooltipH = 280) {
  const padding = 16;
  const arrowOffset = 20;
  let top, left, arrowStyle = {};

  switch (position) {
    case 'right':
      top = targetRect.top + targetRect.height / 2 - tooltipH / 2;
      left = targetRect.right + padding;
      arrowStyle = { top: tooltipH / 2 - 7, left: -7 };
      break;
    case 'left':
      top = targetRect.top + targetRect.height / 2 - tooltipH / 2;
      left = targetRect.left - tooltipW - padding;
      arrowStyle = { top: tooltipH / 2 - 7, right: -7 };
      break;
    case 'bottom':
      top = targetRect.bottom + padding;
      left = targetRect.left + targetRect.width / 2 - tooltipW / 2;
      arrowStyle = { top: -7, left: tooltipW / 2 - 7 };
      break;
    case 'top':
      top = targetRect.top - tooltipH - padding;
      left = targetRect.left + targetRect.width / 2 - tooltipW / 2;
      arrowStyle = { bottom: -7, left: tooltipW / 2 - 7 };
      break;
    default:
      top = targetRect.bottom + padding;
      left = targetRect.left;
  }

  // Clamp to viewport
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  if (left < padding) left = padding;
  if (left + tooltipW > vw - padding) left = vw - tooltipW - padding;
  if (top < padding) top = padding;
  if (top + tooltipH > vh - padding) top = vh - tooltipH - padding;

  return { top, left, arrowStyle };
}

// ─── Main Component ──────────────────────────────────────────
export default function DemoMode({ isActive, onClose }) {
  const navigate = useNavigate();
  const location = useLocation();
  const [currentStep, setCurrentStep] = useState(0);
  const [targetRect, setTargetRect] = useState(null);
  const [tooltipSize, setTooltipSize] = useState({ w: 420, h: 300 });
  const tooltipRef = useRef(null);
  const observerRef = useRef(null);

  const step = TOUR_STEPS[currentStep];

  // ─── Find and measure target element ──────
  const measureTarget = useCallback(() => {
    if (!step || step.type === 'welcome' || step.type === 'complete') {
      setTargetRect(null);
      return;
    }

    const el = document.querySelector(step.target);
    if (el) {
      const rect = el.getBoundingClientRect();
      setTargetRect({
        top: rect.top - 6,
        left: rect.left - 6,
        width: rect.width + 12,
        height: rect.height + 12,
        right: rect.right + 6,
        bottom: rect.bottom + 6,
      });

      // Scroll element into view if needed
      const isInView = rect.top >= 0 && rect.bottom <= window.innerHeight;
      if (!isInView) {
        el.scrollIntoView({ behavior: 'smooth', block: 'center' });
        // Re-measure after scroll
        setTimeout(() => {
          const r2 = el.getBoundingClientRect();
          setTargetRect({
            top: r2.top - 6,
            left: r2.left - 6,
            width: r2.width + 12,
            height: r2.height + 12,
            right: r2.right + 6,
            bottom: r2.bottom + 6,
          });
        }, 400);
      }
    } else {
      setTargetRect(null);
    }
  }, [step]);

  // ─── Navigate to correct route then measure ──────
  useEffect(() => {
    if (!isActive || !step) return;
    if (step.type === 'welcome' || step.type === 'complete') return;

    if (step.route && location.pathname !== step.route) {
      navigate(step.route);
      // Wait for page render before measuring
      const timer = setTimeout(measureTarget, 500);
      return () => clearTimeout(timer);
    } else {
      const timer = setTimeout(measureTarget, 200);
      return () => clearTimeout(timer);
    }
  }, [isActive, currentStep, step, location.pathname, navigate, measureTarget]);

  // ─── Measure tooltip size after render ──────
  useEffect(() => {
    if (tooltipRef.current) {
      const rect = tooltipRef.current.getBoundingClientRect();
      setTooltipSize({ w: rect.width, h: rect.height });
    }
  }, [currentStep, targetRect]);

  // ─── Re-measure on window resize ──────
  useEffect(() => {
    if (!isActive) return;
    const handleResize = () => measureTarget();
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, [isActive, measureTarget]);

  // ─── Keyboard navigation ──────
  useEffect(() => {
    if (!isActive) return;
    const handleKey = (e) => {
      if (e.key === 'Escape') onClose();
      if (e.key === 'ArrowRight' || e.key === 'Enter') handleNext();
      if (e.key === 'ArrowLeft') handlePrev();
    };
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, [isActive, currentStep]);

  // ─── Handlers ──────
  const handleNext = () => {
    if (currentStep < TOUR_STEPS.length - 1) {
      setCurrentStep(prev => prev + 1);
    }
  };

  const handlePrev = () => {
    if (currentStep > 0) {
      setCurrentStep(prev => prev - 1);
    }
  };

  const handleFinish = () => {
    localStorage.setItem('meiji-demo-completed', 'true');
    setCurrentStep(0);
    onClose();
    navigate('/dashboard');
  };

  const handleSkip = () => {
    localStorage.setItem('meiji-demo-completed', 'true');
    setCurrentStep(0);
    onClose();
  };

  const handleStartTour = () => {
    setCurrentStep(1);
  };

  if (!isActive) return null;

  // ─── WELCOME SCREEN ──────
  if (step.type === 'welcome') {
    return (
      <div className="demo-welcome-overlay">
        <div className="demo-welcome-card">
          <div className="demo-welcome-icon">🚀</div>
          <h2 className="demo-welcome-title">Bienvenue sur Meiji Business Manager</h2>
          <p className="demo-welcome-subtitle">
            Découvrez toutes les fonctionnalités de votre outil de gestion financière en quelques étapes.
          </p>

          <div className="demo-welcome-features">
            <div className="demo-welcome-feature">
              <span className="demo-welcome-feature-icon">📊</span>
              Dashboard multi-entité
            </div>
            <div className="demo-welcome-feature">
              <span className="demo-welcome-feature-icon">💱</span>
              Multi-devises (FCFA/EUR/USD)
            </div>
            <div className="demo-welcome-feature">
              <span className="demo-welcome-feature-icon">📒</span>
              Grand Livre comptable
            </div>
            <div className="demo-welcome-feature">
              <span className="demo-welcome-feature-icon">💰</span>
              Trésorerie temps réel
            </div>
            <div className="demo-welcome-feature">
              <span className="demo-welcome-feature-icon">📥</span>
              Export Excel avancé
            </div>
            <div className="demo-welcome-feature">
              <span className="demo-welcome-feature-icon">🔒</span>
              Clôture financière
            </div>
          </div>

          <div className="demo-welcome-actions">
            <button className="demo-btn demo-btn-skip" onClick={handleSkip}>
              Passer la démo
            </button>
            <button className="demo-btn demo-btn-next" onClick={handleStartTour}>
              🎯 Commencer la visite guidée
            </button>
          </div>
        </div>
      </div>
    );
  }

  // ─── COMPLETION SCREEN ──────
  if (step.type === 'complete') {
    return (
      <div className="demo-complete-overlay">
        <div className="demo-complete-card">
          <div className="demo-complete-icon">🎉</div>
          <h2 className="demo-complete-title">Visite Terminée !</h2>
          <p className="demo-complete-text">
            Vous êtes maintenant prêt à utiliser <strong style={{color: '#f8fafc'}}>Meiji Business Manager</strong> comme un pro. 
            Toutes les fonctionnalités sont à portée de clic. 
            <br/><br/>
            💡 Vous pouvez <em style={{color: '#6366f1'}}>relancer cette démo</em> à tout moment depuis le bouton dans la barre latérale.
          </p>
          <div className="demo-welcome-actions">
            <button className="demo-btn demo-btn-finish" onClick={handleFinish}>
              ✅ C'est parti !
            </button>
          </div>
        </div>
      </div>
    );
  }

  // ─── GUIDED STEP WITH SPOTLIGHT ──────
  const spotlightPadding = 8;
  const tooltipPos = targetRect
    ? computeTooltipPosition(targetRect, step.position, tooltipSize.w, tooltipSize.h)
    : { top: window.innerHeight / 2 - 150, left: window.innerWidth / 2 - 210, arrowStyle: {} };

  const totalSteps = TOUR_STEPS.filter(s => s.type !== 'welcome' && s.type !== 'complete').length;
  const currentNumber = currentStep; // step 0 = welcome, so step 1 = first real step = number 1
  const progress = (currentNumber / totalSteps) * 100;

  return (
    <div className="demo-overlay demo-overlay--active">
      {/* SVG Spotlight */}
      <svg className="demo-spotlight-svg" width="100%" height="100%">
        <defs>
          <mask id="demo-mask">
            <rect x="0" y="0" width="100%" height="100%" fill="white" />
            {targetRect && (
              <rect
                x={targetRect.left}
                y={targetRect.top}
                width={targetRect.width}
                height={targetRect.height}
                rx="10"
                ry="10"
                fill="black"
              />
            )}
          </mask>
        </defs>
        <rect
          x="0" y="0"
          width="100%" height="100%"
          fill="rgba(0,0,0,0.65)"
          mask="url(#demo-mask)"
        />
      </svg>

      {/* Pulsing ring around target */}
      {targetRect && (
        <div
          className="demo-spotlight-ring"
          style={{
            top: targetRect.top,
            left: targetRect.left,
            width: targetRect.width,
            height: targetRect.height,
          }}
        />
      )}

      {/* Click catcher */}
      <div className="demo-click-catcher" onClick={() => {}} />

      {/* Tooltip */}
      <div
        ref={tooltipRef}
        className="demo-tooltip"
        key={currentStep}
        style={{
          top: tooltipPos.top,
          left: tooltipPos.left,
        }}
      >
        {/* Arrow */}
        {targetRect && (
          <div
            className={`demo-tooltip-arrow demo-tooltip-arrow--${
              step.position === 'bottom' ? 'bottom' :
              step.position === 'top' ? 'top' :
              step.position === 'left' ? 'left' : 'right'
            }`}
            style={tooltipPos.arrowStyle}
          />
        )}

        {/* Header */}
        <div className="demo-tooltip-header">
          <div
            className="demo-tooltip-icon"
            style={{ background: step.iconBg }}
          >
            {step.icon}
          </div>
          <div>
            <div className="demo-tooltip-subtitle">{step.subtitle}</div>
            <div className="demo-tooltip-title">{step.title}</div>
          </div>
        </div>

        {/* Body */}
        <div
          className="demo-tooltip-body"
          dangerouslySetInnerHTML={{ __html: step.body }}
        />

        {/* Feature list */}
        {step.features && (
          <div style={{ padding: '0 1.5rem 0.5rem' }}>
            <ul className="demo-feature-list">
              {step.features.map((f, i) => (
                <li key={i}>{f}</li>
              ))}
            </ul>
          </div>
        )}

        {/* Footer */}
        <div className="demo-tooltip-footer">
          <div className="demo-progress">
            <span className="demo-progress-text">{currentNumber}/{totalSteps}</span>
            <div className="demo-progress-bar">
              <div className="demo-progress-bar-fill" style={{ width: `${progress}%` }} />
            </div>
          </div>
          <div className="demo-tooltip-actions">
            <button className="demo-btn demo-btn-skip" onClick={handleSkip}>
              Quitter
            </button>
            {currentStep > 1 && (
              <button className="demo-btn demo-btn-prev" onClick={handlePrev}>
                ← Préc.
              </button>
            )}
            {currentStep < TOUR_STEPS.length - 2 ? (
              <button className="demo-btn demo-btn-next" onClick={handleNext}>
                Suivant →
              </button>
            ) : (
              <button className="demo-btn demo-btn-finish" onClick={handleNext}>
                Terminer ✨
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
