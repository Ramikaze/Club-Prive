import { Outlet, NavLink, useNavigate } from 'react-router-dom';
import { LayoutDashboard, BookOpen, Lock, LogOut, Tags, ArrowUpRight, ArrowDownRight } from 'lucide-react';
import { useStore } from '../../store/useStore';

export function Sidebar() {
  const { logout } = useStore();
  const navigate = useNavigate();

  const handleLogout = () => {
    logout();
    navigate('/login');
  };

  const navItems = [
    { name: 'Dashboard Global', path: '/dashboard', icon: LayoutDashboard },
    { name: 'Recettes', path: '/incomes', icon: ArrowUpRight },
    { name: 'Dépenses', path: '/expenses', icon: ArrowDownRight },
    { name: 'Grand Livre (Ledger)', path: '/ledger', icon: BookOpen },
    { name: 'Catégories', path: '/categories', icon: Tags },
    { name: 'Clôture Financière', path: '/close', icon: Lock },
  ];

  return (
    <aside style={{ width: '260px', backgroundColor: 'var(--bg-sidebar)', color: 'var(--text-inverse)', display: 'flex', flexDirection: 'column' }}>
      <div style={{ padding: '1.5rem', borderBottom: '1px solid rgba(255,255,255,0.1)' }}>
        <h1 style={{ fontSize: '1.25rem', fontWeight: 700 }}>Meiji Business Manager</h1>
        <p style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>Gestion Financière</p>
      </div>
      <nav style={{ flex: 1, padding: '1.5rem 1rem', display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
        {navItems.map(item => (
          <NavLink 
            key={item.path} 
            to={item.path}
            style={({isActive}) => ({
              display: 'flex', alignItems: 'center', gap: '0.75rem', padding: '0.75rem 1rem',
              borderRadius: 'var(--radius-md)', textDecoration: 'none',
              backgroundColor: isActive ? 'var(--primary)' : 'transparent',
              color: isActive ? '#fff' : '#cbd5e1',
              fontWeight: 500, transition: 'all 0.2s'
            })}
          >
            <item.icon size={20} />
            {item.name}
          </NavLink>
        ))}
      </nav>
      <div
        onClick={handleLogout}
        style={{ padding: '1.5rem', borderTop: '1px solid rgba(255,255,255,0.1)', display: 'flex', alignItems: 'center', gap: '1rem', cursor: 'pointer', transition: 'background 0.2s', borderRadius: '0 0 0 0' }}
        onMouseEnter={e => e.currentTarget.style.background = 'rgba(239,68,68,0.1)'}
        onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
        title="Se déconnecter"
      >
        <div style={{ width: 36, height: 36, borderRadius: '50%', backgroundColor: 'rgba(239,68,68,0.15)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <LogOut size={18} color="#f87171" />
        </div>
        <div>
          <p style={{ fontSize: '0.875rem', fontWeight: 600, color: '#f8fafc' }}>Direction</p>
          <p style={{ fontSize: '0.75rem', color: '#f87171' }}>Se déconnecter</p>
        </div>
      </div>
    </aside>
  );
}

export function Topbar() {
  const { currentEntity, setEntity, dateFilter, setDateFilter } = useStore();

  const handleDateTypeChange = (e) => {
    const type = e.target.value;
    const today = new Date().toISOString().split('T')[0];
    if (type === 'all') {
      setDateFilter({ type, value: '', start: '', end: '' });
    } else if (type === 'custom') {
      setDateFilter({ type, value: '', start: today, end: today });
    } else {
      setDateFilter({ type, value: type === 'month' ? today.substring(0, 7) : today, start: '', end: '' });
    }
  };

  return (
    <header style={{ height: '70px', backgroundColor: 'var(--bg-surface)', borderBottom: '1px solid var(--border)', display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '0 2rem' }}>
      <div style={{ fontWeight: 700, fontSize: '1.25rem', color: 'var(--primary)' }}>
        Meiji Business Manager
      </div>
      
      <div className="flex items-center gap-6">
        
        {/* Date Filter */}
        <div className="flex items-center gap-2">
          <span style={{ fontSize: '0.875rem', color: 'var(--text-muted)' }}>Période :</span>
          <select 
            className="form-input" 
            value={dateFilter.type} 
            onChange={handleDateTypeChange}
            style={{ fontWeight: 600, cursor: 'pointer', padding: '0.4rem' }}
          >
            <option value="all">Toutes périodes</option>
            <option value="day">Journée</option>
            <option value="month">Mois</option>
            <option value="custom">Personnalisé</option>
          </select>

          {dateFilter.type === 'custom' && (
            <div className="flex items-center gap-2">
              <input type="date" className="form-input" value={dateFilter.start} onChange={e => setDateFilter({ ...dateFilter, start: e.target.value })} style={{ padding: '0.4rem' }} />
              <span style={{ fontSize: '0.875rem', color: 'var(--text-muted)' }}>au</span>
              <input type="date" className="form-input" value={dateFilter.end} onChange={e => setDateFilter({ ...dateFilter, end: e.target.value })} style={{ padding: '0.4rem' }} />
            </div>
          )}

          {dateFilter.type === 'day' && (
            <input type="date" className="form-input" value={dateFilter.value} onChange={e => setDateFilter({ ...dateFilter, value: e.target.value })} style={{ padding: '0.4rem' }} />
          )}
          {dateFilter.type === 'month' && (
            <input type="month" className="form-input" value={dateFilter.value} onChange={e => setDateFilter({ ...dateFilter, value: e.target.value })} style={{ padding: '0.4rem' }} />
          )}
        </div>

        {/* Entity Selector */}
        <div className="flex items-center gap-2">
          <span style={{ fontSize: '0.875rem', color: 'var(--text-muted)' }}>Société :</span>
          <select 
            className="form-input" 
            value={currentEntity} 
            onChange={(e) => setEntity(e.target.value)}
            style={{ width: '220px', fontWeight: 600, cursor: 'pointer', padding: '0.4rem' }}
          >
            <option value="global">🌍 Meiji Group (Consolidé)</option>
            <option value="pn">📍 Meiji PN</option>
            <option value="brazza">📍 Meiji Brazza</option>
          </select>
        </div>
      </div>
    </header>
  );
}

export default function AppShell() {
  return (
    <div className="flex h-full" style={{ height: '100vh', overflow: 'hidden' }}>
      <Sidebar />
      <div className="flex-col w-full" style={{ display: 'flex', flex: 1, overflow: 'hidden' }}>
        <Topbar />
        <main style={{ flex: 1, overflowY: 'auto', padding: '2rem' }}>
          <Outlet />
        </main>
      </div>
    </div>
  );
}
