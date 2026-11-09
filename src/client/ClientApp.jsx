// The client space (/client): what a club member or a regular client sees on his phone. It stands alone: nothing of the
// staff application is booted here (no /api/me, no staff session, no demo header); it talks to /api/client/* only, and
// every request that loses the session sends back to its own sign-in. Three screens in the bottom bar (Compte,
// Boutique, Historique) and, from the account, the reservation request.
import { Component, useEffect, useRef, useState } from 'react';
import { HashRouter, Routes, Route, NavLink, Navigate, useNavigate } from 'react-router-dom';
import BrandLogo from '../components/ui/BrandLogo.jsx';
import Icon from '../components/ui/Icon.jsx';
import { Toasts } from '../components/ui/toast.jsx';
import { clientApi, setClientHandlers } from './clientApi.js';
import { useStore } from '../store/useStore.js';
import { ClientLogin, ClientPassword } from './pages/ClientLogin.jsx';
import ClientHome from './pages/ClientHome.jsx';
import ClientHistory from './pages/ClientHistory.jsx';
import ClientTicket from './pages/ClientTicket.jsx';
import ClientShop from './pages/ClientShop.jsx';
import ClientBooking from './pages/ClientBooking.jsx';
import './client.css';

// The screens write money and dates with the club's currency and time zone (src/lib/format.js reads them from the
// store): the sign-in and /me answers carry them. Set before any screen is drawn, as some compute today's date at once.
function applyClub(club) {
  useStore.setState({ settings: { club_name: club.name, currency: club.currency, timezone: club.timezone } });
  document.title = `${club.name} — Mon espace`;
}

// Dark only when the client chose it in the app before, else the phone's own setting.
function applyClientTheme() {
  let t = null;
  try { t = localStorage.getItem('theme'); } catch { /* storage unavailable */ }
  if (t === 'dark' || t === 'light') document.documentElement.dataset.theme = t;
  else delete document.documentElement.dataset.theme;
}

// « Add to home screen » takes the page's manifest: the client's opens /client, never the staff's sign-in (index.html
// links the staff's manifest, for every path).
function applyClientManifest() {
  document.querySelector('link[rel="manifest"]')?.setAttribute('href', '/client.webmanifest');
}

class CrashBoundary extends Component {
  state = { crashed: false };

  static getDerivedStateFromError() { return { crashed: true }; }

  componentDidCatch(error, info) { console.error(error, info.componentStack); }

  render() {
    if (!this.state.crashed) return this.props.children;
    return (
      <div className="login-page"><div className="login-card">
        <h1>Un problème d’affichage est survenu</h1>
        <p className="muted">Rechargez la page pour continuer : ce qui est déjà enregistré n’est pas perdu.</p>
        <button type="button" className="btn btn-primary" onClick={() => window.location.reload()}>Recharger</button>
      </div></div>
    );
  }
}

function Shell({ session, onLoggedOut, onPasswordChanged }) {
  const { member, club } = session;
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const menu = useRef(null);
  useEffect(() => {
    if (!open) return undefined;
    const close = (e) => { if (e.type === 'keydown' ? e.key === 'Escape' : !menu.current?.contains(e.target)) setOpen(false); };
    document.addEventListener('keydown', close);
    document.addEventListener('pointerdown', close);
    return () => { document.removeEventListener('keydown', close); document.removeEventListener('pointerdown', close); };
  }, [open]);
  const logout = async () => {
    try { await clientApi.post('/api/client/logout', {}); } catch { /* the session is dropped here whatever the server says */ }
    onLoggedOut();
  };
  return (
    <div className="cl">
      <header className="cl-top">
        <div className="cl-brand">
          <BrandLogo className="cl-logo" />
          <div className="cl-who">
            <strong>{member.first_name} {member.last_name}</strong>
            <span>N° {member.member_no}</span>
          </div>
        </div>
        <div className="cl-menu" ref={menu}>
          <button type="button" className="icon-btn" aria-label="Menu" aria-expanded={open} onClick={() => setOpen((o) => !o)}><Icon name="menu" /></button>
          {open && (
            <div className="cl-menu-list" role="menu">
              <button type="button" role="menuitem" onClick={() => { setOpen(false); navigate('/mot-de-passe'); }}><Icon name="key" /> Changer mon mot de passe</button>
              <button type="button" role="menuitem" onClick={logout}><Icon name="logout" /> Se déconnecter</button>
            </div>
          )}
        </div>
      </header>
      <main className="cl-main">
        <Routes>
          <Route index element={<ClientHome member={member} />} />
          <Route path="boutique" element={<ClientShop />} />
          <Route path="historique" element={<ClientHistory />} />
          <Route path="historique/ticket/:id" element={<ClientTicket />} />
          <Route path="reserver" element={member.kind === 'membre' ? <ClientBooking club={club} /> : <Navigate to="/" replace />} />
          <Route path="mot-de-passe" element={<ClientPassword first={false} onDone={(me) => { onPasswordChanged(me); navigate('/'); }} onCancel={() => navigate('/')} />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </main>
      <nav className="cl-nav" aria-label="Navigation">
        <NavLink to="/" end><Icon name="home" /><span>Compte</span></NavLink>
        <NavLink to="/boutique"><Icon name="shop" /><span>Boutique</span></NavLink>
        <NavLink to="/historique"><Icon name="receipt" /><span>Historique</span></NavLink>
      </nav>
    </div>
  );
}

function Message({ title, text, action, onAction }) {
  return (
    <div className="login-page"><div className="login-card">
      <h1>{title}</h1>
      {text && <p className="muted">{text}</p>}
      <button type="button" className="btn btn-primary" onClick={onAction}>{action}</button>
    </div></div>
  );
}

export default function ClientApp() {
  // phase: boot | login | password (the identifier and/or the password are still to choose) | ready | offline
  const [phase, setPhase] = useState('boot');
  const [choose, setChoose] = useState({ mustSetPassword: true, login: null });
  const [session, setSession] = useState(null);
  const [error, setError] = useState(null);

  const enter = (me) => {
    applyClub(me.club);
    setSession({ member: me.member, club: me.club });
    setChoose({ mustSetPassword: Boolean(me.must_set_password), login: me.login ?? null });
    setPhase(me.must_set_password || me.login_chosen === false ? 'password' : 'ready');
  };
  const leave = () => {
    setSession(null);
    setPhase('login');
    try { window.history.replaceState(null, '', window.location.pathname); } catch { /* nothing to reset */ }
  };

  useEffect(() => {
    applyClientTheme();
    applyClientManifest();
    // A 403 « to choose first » (identifier or password): ask the server which, then show that screen.
    setClientHandlers({
      signedOut: leave,
      passwordFirst: () => { clientApi.get('/api/client/me').then(enter, () => {}); },
    });
    let cancelled = false;
    clientApi.get('/api/client/me').then((me) => { if (!cancelled) enter(me); }, (e) => {
      if (cancelled || e.status === 401) return;
      setError(e);
      setPhase('offline');
    });
    return () => { cancelled = true; };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  let screen;
  if (phase === 'boot') screen = <div className="boot">Chargement…</div>;
  else if (phase === 'offline') {
    screen = <Message title="Serveur injoignable" text={error?.message} action="Réessayer" onAction={() => window.location.reload()} />;
  } else if (phase === 'login') screen = <ClientLogin onSignedIn={enter} />;
  else if (phase === 'password') screen = <ClientPassword first mustSetPassword={choose.mustSetPassword} login={choose.login} onDone={enter} onLogout={leave} />;
  else {
    screen = (
      <HashRouter>
        <Shell session={session} onLoggedOut={leave} onPasswordChanged={enter} />
      </HashRouter>
    );
  }
  return <CrashBoundary>{screen}<Toasts /></CrashBoundary>;
}
