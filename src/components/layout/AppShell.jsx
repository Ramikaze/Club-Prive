// Application shell: side navigation (desktop), top bar and tab bar (phone), the signal of the demo
// space (frame, watermark, banner) and its entry, account menu, password change and the guided tour.
import { useEffect, useState } from 'react';
import { Link, Outlet, useLocation, useNavigate } from 'react-router-dom';
import BrandLogo from '../ui/BrandLogo.jsx';
import Icon from '../ui/Icon.jsx';
import { Modal, openDialog, closeAllDialogs } from '../ui/Modal.jsx';
import { FormError, PasswordField } from '../ui/ui.jsx';
import { toast } from '../ui/toast.jsx';
import GuidedTour, { TOUR_DEMO_DONE_KEY } from '../ui/GuidedTour.jsx';
import { api } from '../../lib/api.js';
import { useSubmit } from '../../lib/hooks.js';
import { toggleTheme } from '../../lib/theme.js';
import { enterDemo, leaveDemo } from '../../lib/space.js';
import { ROLE_LABEL } from '../../lib/format.js';
import { useStore } from '../../store/useStore.js';

export const NAV = [
  { group: 'Opérations' },
  { path: '/', label: 'Accueil', short: 'Accueil', icon: 'home', tab: true },
  { path: '/salles', label: 'Salles', short: 'Salles', icon: 'rooms', tab: true },
  { path: '/agenda', label: 'Agenda', short: 'Agenda', icon: 'calendar', tab: true, also: ['/reservations'] },
  { path: '/membres', label: 'Membres', short: 'Membres', icon: 'users', tab: true, also: ['/cartes'] },
  { path: '/produits', label: 'Stocks & Cave', short: 'Stocks', icon: 'box', also: ['/lounge'] },
  { path: '/caisse', label: 'Caisse', short: 'Caisse', icon: 'wallet', tab: true, also: ['/depenses'] },
  { group: 'Administration', admin: true },
  { path: '/parametres', label: 'Administration', short: 'Admin', icon: 'settings', admin: true, also: ['/tresorerie', '/grand-livre', '/cloture'] },
];


const navFor = (pathname) => NAV.find((n) => n.path && (n.path === '/'
  ? pathname === '/'
  : pathname === n.path || pathname.startsWith(`${n.path}/`) || n.also?.some((p) => pathname.startsWith(p))))?.path;

async function logout() {
  try { await api.post('/api/logout', {}); } catch { /* session already gone */ }
  closeAllDialogs();
  useStore.getState().signOut();
}

function PasswordDialog({ close }) {
  const [v, setV] = useState({ current_password: '', new_password: '', confirm: '' });
  const { busy, error, submit } = useSubmit();
  const set = (k) => (e) => setV({ ...v, [k]: e.target.value });
  const onSubmit = (e) => {
    e.preventDefault();
    submit(async () => {
      if (v.new_password !== v.confirm) throw new Error('La confirmation ne correspond pas au nouveau mot de passe.');
      await api.post('/api/me/password', { current_password: v.current_password, new_password: v.new_password });
      close();
      toast('Mot de passe modifié. Vos autres sessions ont été fermées.');
    });
  };
  return (
    <Modal title="Changer mon mot de passe" onClose={close}>
      <form className="form-grid" onSubmit={onSubmit} noValidate>
        <PasswordField label="Mot de passe actuel" autoComplete="current-password" required value={v.current_password} onChange={set('current_password')} />
        <PasswordField label="Nouveau mot de passe" help="10 caractères minimum."
          autoComplete="new-password" minLength={10} required value={v.new_password} onChange={set('new_password')} />
        <PasswordField label="Confirmation" autoComplete="new-password" required value={v.confirm} onChange={set('confirm')} />
        <FormError error={error} />
        <div className="modal-actions">
          <button type="button" className="btn" onClick={close}>Annuler</button>
          <button type="submit" className="btn btn-primary" disabled={busy} aria-busy={busy}>Enregistrer</button>
        </div>
      </form>
    </Modal>
  );
}

const openPasswordDialog = () => openDialog(PasswordDialog);

// On phones: the rubrics that are not in the tab bar, then the account actions.
function AccountMenu({ close, onTour }) {
  const me = useStore((s) => s.me);
  // In the demo space the account is mirrored from the real club (its login there is just u<id>) and
  // its password cannot be changed: neither is shown.
  const demo = useStore((s) => s.demo);
  const navigate = useNavigate();
  const isAdmin = me.role === 'admin';
  const go = (path) => {
    close();
    navigate(path);
  };
  const switchSpace = demo ? leaveDemo : enterDemo;
  return (
    <Modal title={me.name} onClose={close}>
      <div className="menu-list">
        <p className="muted">{ROLE_LABEL[me.role]}{!demo && ` · identifiant ${me.login}`}</p>
        {NAV.filter((n) => n.path && !n.tab && (!n.admin || isAdmin)).map((n) => (
          <button key={n.path} type="button" className="btn btn-block" onClick={() => go(n.path)}><Icon name={n.icon} /> {n.label}</button>
        ))}
        <hr />
        <button type="button" className="btn btn-block btn-demo" onClick={() => { close(); switchSpace(); }}>
          <Icon name="demo" /> {demo ? 'Quitter la démo' : 'Mode démo (entraînement)'}</button>
        {!demo && (
          <button type="button" className="btn btn-block" onClick={() => { close(); openPasswordDialog(); }}><Icon name="key" /> Changer mon mot de passe</button>
        )}
        <button type="button" className="btn btn-block" onClick={toggleTheme}><Icon name="moon" /> Thème clair / sombre</button>
        <button type="button" className="btn btn-block" onClick={() => { close(); onTour(); }}><Icon name="tour" /> Visite guidée</button>
        <button type="button" className="btn btn-block btn-danger" onClick={() => { close(); logout(); }}><Icon name="logout" /> Se déconnecter</button>
      </div>
    </Modal>
  );
}

export default function AppShell() {
  const me = useStore((s) => s.me);
  const settings = useStore((s) => s.settings);
  // Every signal of the demo space hangs on the server's answer (bundle.demo), never on the space stored
  // in the browser: the frame must never show over the real club's data.
  const demo = useStore((s) => s.demo);
  const entering = useStore((s) => s.entering);
  useEffect(() => {
    if (!entering) return undefined;
    const t = setTimeout(() => useStore.setState({ entering: false }), 700);
    return () => clearTimeout(t);
  }, [entering]);
  const isAdmin = me.role === 'admin';
  const { pathname } = useLocation();
  const current = navFor(pathname);
  const [tour, setTour] = useState(false);

  useEffect(() => {
    closeAllDialogs();
    window.scrollTo(0, 0);
    document.getElementById('main')?.focus({ preventScroll: true });
  }, [pathname]);

  // The tour opens by itself once per browser, in the demo space: the first entry, whatever the browser
  // did with the tour on the real site (the demo has its own key).
  useEffect(() => {
    if (!demo) return undefined;
    let done = false;
    try { done = localStorage.getItem(TOUR_DEMO_DONE_KEY) === '1'; } catch { /* storage unavailable */ }
    if (done) return undefined;
    const timer = setTimeout(() => setTour(true), 700);
    return () => clearTimeout(timer);
  }, [demo]);

  const startTour = () => setTour(true);
  const aria = (path) => (path === current ? 'page' : undefined);

  return (
    <div className={`shell${entering ? ' is-entering' : ''}${demo ? ' is-demo' : ''}`}>
      <aside className="sidebar" aria-label="Navigation principale">
        <div className="brand"><BrandLogo className="brand-logo" /></div>
        <nav className="side-nav" data-tour="nav">
          {NAV.filter((n) => !n.admin || isAdmin).map((n) => (n.group
            ? <div key={n.group} className="side-nav-label">{n.group}</div>
            : <Link key={n.path} to={n.path} aria-current={aria(n.path)}><Icon name={n.icon} /><span>{n.label}</span></Link>))}
        </nav>
        <div className="side-user" data-tour="account">
          <div><div className="who">{me.name}</div><div className="role">{ROLE_LABEL[me.role]}</div></div>
          <button type="button" className="btn btn-sm btn-block" onClick={startTour}><Icon name="tour" /> Visite guidée</button>
          <div className="row">
            {demo ? (
              <button type="button" className="btn btn-sm btn-block btn-demo" onClick={leaveDemo}><Icon name="demo" /> Quitter la démo</button>
            ) : (
              <button type="button" className="btn btn-sm btn-demo" onClick={enterDemo} title="Mode démo (entraînement)">
                <Icon name="demo" /><span className="sr-only">Mode démo</span></button>
            )}
            {!demo && (
              <button type="button" className="btn btn-sm" onClick={openPasswordDialog} title="Changer mon mot de passe">
                <Icon name="key" /><span className="sr-only">Mot de passe</span></button>
            )}
            <button type="button" className="btn btn-sm" onClick={toggleTheme} title="Thème clair / sombre">
              <Icon name="moon" /><span className="sr-only">Thème</span></button>
            <button type="button" className="btn btn-sm" onClick={logout}><Icon name="logout" /> Déconnexion</button>
          </div>
        </div>
      </aside>
      <div className="main-col">
        <header className="topbar">
          <div className="brand"><BrandLogo className="brand-logo" /></div>
          <button type="button" className="icon-btn" data-tour="menu" aria-label="Compte, rubriques et réglages"
            onClick={() => openDialog(AccountMenu, { onTour: startTour })}><Icon name="menu" /></button>
        </header>
        {demo && (
          <div className="banner banner-demo" role="note">
            <span>MODE DÉMO — base d'essai, rien n'est réel</span>
            <button type="button" className="btn btn-sm" onClick={leaveDemo}>Quitter</button>
          </div>
        )}
        <main id="main" tabIndex={-1}><Outlet /></main>
      </div>
      <nav className="tabbar" aria-label="Navigation" data-tour="nav-mobile">
        {NAV.filter((n) => n.tab).map((n) => (
          <Link key={n.path} to={n.path} aria-current={aria(n.path)}><Icon name={n.icon} /><span>{n.short}</span></Link>
        ))}
      </nav>
      <GuidedTour active={tour} onClose={() => setTour(false)} isAdmin={isAdmin} clubName={settings.club_name} />
      {demo && <div className="demo-watermark" aria-hidden="true">DÉMO</div>}
    </div>
  );
}
