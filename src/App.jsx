// Boot (session check), sign-in, then the routed application. Every rule is enforced by the server;
// the admin guard here only avoids showing pages the server would refuse.
import { useEffect } from 'react';
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
    return (
      <div className="login-page">
        <div className="login-card">
          <h1>Serveur injoignable</h1>
          <p className="muted">{bootError?.message}</p>
          <button type="button" className="btn btn-primary" onClick={() => window.location.reload()}>Réessayer</button>
        </div>
      </div>
    );
  }
  if (status === 'login') return <><Login /><Toasts /></>;

  return (
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
  );
}
