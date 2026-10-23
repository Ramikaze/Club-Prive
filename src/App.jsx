// Boot (session check), sign-in, then the routed application. Every rule is enforced by the server;
// the admin guard here only avoids showing pages the server would refuse.
import { Component, useEffect } from 'react';
import { HashRouter, Routes, Route, Link } from 'react-router-dom';
import AppShell from './components/layout/AppShell.jsx';
import { DialogRoot, closeAllDialogs } from './components/ui/Modal.jsx';
import { Toasts } from './components/ui/toast.jsx';
import { Empty } from './components/ui/ui.jsx';
import Login from './pages/Login.jsx';
import Dashboard from './pages/Dashboard.jsx';
import Rooms from './pages/Rooms.jsx';
import Agenda from './pages/Agenda.jsx';
import Members from './pages/Members.jsx';
import Member from './pages/Member.jsx';
import MemberCard from './pages/MemberCard.jsx';
import Reservation from './pages/Reservation.jsx';
import Products from './pages/Products.jsx';
import Lounge, { HumidorPage } from './pages/Lounge.jsx';
import Cash from './pages/Cash.jsx';
import Expenses from './pages/Expenses.jsx';
import Treasury from './pages/Treasury.jsx';
import Ledger from './pages/Ledger.jsx';
import Closing from './pages/Closing.jsx';
import Settings from './pages/Settings.jsx';
import { api, setUnauthorizedHandler } from './lib/api.js';
import { isDemoSpace, leaveDemo } from './lib/space.js';
import { applyTheme } from './lib/theme.js';
import { useStore, useIsAdmin } from './store/useStore.js';

function AdminOnly({ children }) {
  const isAdmin = useIsAdmin();
  if (isAdmin) return children;
  return <div className="card"><Empty icon="alert">Cette page est réservée aux administrateurs.</Empty></div>;
}

function NotFound() {
  return (
    <div className="card">
      <Empty icon="alert"><p>Page introuvable.</p><Link className="btn" to="/">Tableau de bord</Link></Empty>
    </div>
  );
}

// A full-page message in the sign-in card's look, with its ways out: reload and, in the demo space, leave
// it. A reload there sends the same demo header again, so a demo that cannot load or display would lock
// this browser out of the real site: leaving is offered, as the user's choice, never automatic (a network
// blip must not throw anyone out of the demo).
function ErrorScreen({ title, message, reloadLabel }) {
  return (
    <div className="login-page">
      <div className="login-card">
        <h1>{title}</h1>
        {message && <p className="muted">{message}</p>}
        <button type="button" className="btn btn-primary" onClick={() => window.location.reload()}>{reloadLabel}</button>
        {isDemoSpace() && <button type="button" className="btn" onClick={leaveDemo}>Quitter la démo</button>}
      </div>
    </div>
  );
}

// An error raised while drawing the signed-in app would leave a white page: this shows a plain screen
// instead. It catches what React raises while rendering, not what a click or a request raises (those
// show their own messages).
class CrashBoundary extends Component {
  state = { crashed: false };

  static getDerivedStateFromError() {
    return { crashed: true };
  }

  componentDidCatch(error, info) {
    console.error(error, info.componentStack);
  }

  render() {
    if (!this.state.crashed) return this.props.children;
    return (
      <ErrorScreen
        title="Un problème d’affichage est survenu"
        message="Rechargez la page pour continuer : ce qui est déjà enregistré n’est pas perdu."
        reloadLabel="Recharger"
      />
    );
  }
}

async function boot() {
  const store = useStore.getState();
  try {
    store.setBundle(await api.get('/api/me'));
  } catch (e) {
    if (e.status === 401) store.signOut();
    else store.setOffline(e);
  }
}

export default function App() {
  const status = useStore((s) => s.status);
  const bootError = useStore((s) => s.bootError);

  useEffect(() => {
    applyTheme();
    setUnauthorizedHandler(() => {
      closeAllDialogs();
      useStore.getState().signOut();
    });
    boot();
  }, []);

  if (status === 'boot') return <div className="boot">Chargement…</div>;
  if (status === 'offline') {
    // The server answered and refused (a 4xx, such as a conflict while the demo fills for the first time):
    // that is no outage, so the title does not claim one. A network error (status 0) or a 5xx is.
    const refused = bootError?.status >= 400 && bootError.status < 500;
    return (
      <ErrorScreen
        title={refused ? 'Impossible d’ouvrir cet espace' : 'Serveur injoignable'}
        message={bootError?.message}
        reloadLabel="Réessayer"
      />
    );
  }
  if (status === 'login') return <><Login /><Toasts /></>;

  return (
    <CrashBoundary>
      <HashRouter>
        <Routes>
          <Route element={<AppShell />}>
            <Route index element={<Dashboard />} />
            <Route path="salles" element={<Rooms />} />
            <Route path="agenda" element={<Agenda />} />
            <Route path="membres" element={<Members />} />
            <Route path="membres/:id" element={<Member />} />
            <Route path="cartes/:id" element={<MemberCard />} />
            <Route path="reservations/:id" element={<Reservation />} />
            <Route path="produits" element={<Products />} />
            <Route path="lounge" element={<Lounge />} />
            <Route path="lounge/caves/:id" element={<HumidorPage />} />
            <Route path="caisse" element={<Cash />} />
            <Route path="depenses" element={<Expenses />} />
            <Route path="tresorerie" element={<AdminOnly><Treasury /></AdminOnly>} />
            <Route path="grand-livre" element={<AdminOnly><Ledger /></AdminOnly>} />
            <Route path="cloture" element={<AdminOnly><Closing /></AdminOnly>} />
            <Route path="parametres" element={<AdminOnly><Settings /></AdminOnly>} />
            <Route path="*" element={<NotFound />} />
          </Route>
        </Routes>
        <DialogRoot />
        <Toasts />
      </HashRouter>
    </CrashBoundary>
  );
}
