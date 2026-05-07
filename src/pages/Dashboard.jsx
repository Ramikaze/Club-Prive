import { useState } from 'react';
import { useStore, formatFCFA, formatEUR, formatUSD } from '../store/useStore';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip as RechartsTooltip, ResponsiveContainer, Legend } from 'recharts';
import { Building2, Wallet, ArrowUpRight, ArrowDownRight, Settings, X, Activity, Edit3, FileDown } from 'lucide-react';
import { exportMultiSheetExcel, formatTransactionsForExport } from '../utils/exportExcel';

// Account Detail Modal Component
function AccountDetailsModal({ accountName, onClose }) {
  const { getTransactionsByAccount, usdRate } = useStore();
  const txs = getTransactionsByAccount(accountName);

  return (
    <div style={{ position: 'fixed', inset: 0, backgroundColor: 'rgba(0,0,0,0.5)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000, padding: '2rem' }}>
      <div className="card" style={{ width: '100%', maxWidth: '800px', maxHeight: '80vh', display: 'flex', flexDirection: 'column' }}>
        <div className="flex justify-between items-center" style={{ marginBottom: '1.5rem' }}>
          <h3 style={{ fontSize: '1.25rem', fontWeight: 600 }}>Détail du Compte : {accountName}</h3>
          <button onClick={onClose} style={{ background: 'none', border: 'none', cursor: 'pointer' }}><X size={24} color="var(--text-muted)"/></button>
        </div>
        
        <div style={{ overflowY: 'auto', flex: 1 }} className="table-container">
          <table className="data-table">
            <thead>
              <tr>
                <th>Date</th>
                <th>Type</th>
                <th>Description</th>
                <th>Montant (FCFA)</th>
                <th>Équiv. USD</th>
              </tr>
            </thead>
            <tbody>
              {txs.length === 0 ? (
                <tr><td colSpan="5" style={{textAlign: 'center', padding: '2rem'}}>Aucun mouvement.</td></tr>
              ) : (
                txs.map(tx => (
                  <tr key={tx.id}>
                    <td>{tx.date}</td>
                    <td><span className={`badge \${tx.type==='income'?'badge-success':'badge-danger'}`}>{tx.type==='income'?'Entrée':'Sortie'}</span></td>
                    <td>{tx.description}</td>
                    <td style={{ fontWeight: 600, color: tx.type==='income' ? 'var(--success)' : 'var(--danger)' }}>
                      {tx.type==='income'?'+':'-'} {formatFCFA(tx.amount)}
                    </td>
                    <td style={{ color: 'var(--text-muted)', fontSize: '0.75rem' }}>
                      {formatUSD(tx.amount, usdRate)}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

function DayDetailsModal({ date, currentEntity, onClose }) {
  const { getFilteredTransactions } = useStore();
  const txs = getFilteredTransactions(currentEntity).filter(tx => tx.date === date);

  return (
    <div style={{ position: 'fixed', inset: 0, backgroundColor: 'rgba(0,0,0,0.5)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000, padding: '2rem' }}>
      <div className="card" style={{ width: '100%', maxWidth: '900px', maxHeight: '80vh', display: 'flex', flexDirection: 'column' }}>
        <div className="flex justify-between items-center" style={{ marginBottom: '1.5rem' }}>
          <h3 style={{ fontSize: '1.25rem', fontWeight: 600 }}>Détail de la journée : {date}</h3>
          <button onClick={onClose} style={{ background: 'none', border: 'none', cursor: 'pointer' }}><X size={24} color="var(--text-muted)"/></button>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: currentEntity === 'global' ? '1fr 1fr' : '1fr', gap: '1rem', marginBottom: '1.5rem' }}>
          {(currentEntity === 'global' || currentEntity === 'pn') && (
            <div style={{ backgroundColor: 'var(--bg-app)', padding: '1rem', borderRadius: '0.5rem', borderLeft: '4px solid #3b82f6' }}>
              <h4 style={{ fontWeight: 600, marginBottom: '0.5rem', color: '#3b82f6' }}>Meiji PN - Recettes par Mode</h4>
              {Object.entries(txs.filter(t => t.entityId === 'pn' && t.type === 'income').reduce((acc, t) => { acc[t.account] = (acc[t.account] || 0) + t.amount; return acc; }, {})).length === 0 ? (
                <span style={{ fontSize: '0.875rem', color: 'var(--text-muted)' }}>Aucune recette.</span>
              ) : (
                Object.entries(txs.filter(t => t.entityId === 'pn' && t.type === 'income').reduce((acc, t) => { acc[t.account] = (acc[t.account] || 0) + t.amount; return acc; }, {})).map(([acc, amount]) => (
                  <div key={acc} className="flex justify-between items-center" style={{ fontSize: '0.875rem', marginBottom: '0.25rem' }}>
                    <span style={{ color: 'var(--text-muted)' }}>{acc}</span>
                    <span style={{ fontWeight: 600, color: 'var(--success)' }}>{formatFCFA(amount)}</span>
                  </div>
                ))
              )}
            </div>
          )}
          {(currentEntity === 'global' || currentEntity === 'brazza') && (
            <div style={{ backgroundColor: 'var(--bg-app)', padding: '1rem', borderRadius: '0.5rem', borderLeft: '4px solid #8b5cf6' }}>
              <h4 style={{ fontWeight: 600, marginBottom: '0.5rem', color: '#8b5cf6' }}>Meiji Brazza - Recettes par Mode</h4>
              {Object.entries(txs.filter(t => t.entityId === 'brazza' && t.type === 'income').reduce((acc, t) => { acc[t.account] = (acc[t.account] || 0) + t.amount; return acc; }, {})).length === 0 ? (
                <span style={{ fontSize: '0.875rem', color: 'var(--text-muted)' }}>Aucune recette.</span>
              ) : (
                Object.entries(txs.filter(t => t.entityId === 'brazza' && t.type === 'income').reduce((acc, t) => { acc[t.account] = (acc[t.account] || 0) + t.amount; return acc; }, {})).map(([acc, amount]) => (
                  <div key={acc} className="flex justify-between items-center" style={{ fontSize: '0.875rem', marginBottom: '0.25rem' }}>
                    <span style={{ color: 'var(--text-muted)' }}>{acc}</span>
                    <span style={{ fontWeight: 600, color: 'var(--success)' }}>{formatFCFA(amount)}</span>
                  </div>
                ))
              )}
            </div>
          )}
        </div>
        
        <div style={{ overflowY: 'auto', flex: 1 }} className="table-container">
          <table className="data-table">
            <thead>
              <tr>
                <th>Entité</th>
                <th>Type</th>
                <th>Catégorie</th>
                <th>Compte</th>
                <th>Description</th>
                <th>Montant (FCFA)</th>
              </tr>
            </thead>
            <tbody>
              {txs.length === 0 ? (
                <tr><td colSpan="5" style={{textAlign: 'center', padding: '2rem'}}>Aucun mouvement.</td></tr>
              ) : (
                txs.map(tx => (
                  <tr key={tx.id}>
                    <td style={{fontWeight: 600}}>{tx.entityId === 'pn' ? 'Meiji PN' : 'Meiji Brazza'}</td>
                    <td><span className={`badge \${tx.type==='income'?'badge-success':'badge-danger'}`}>{tx.type==='income'?'Recette':'Dépense'}</span></td>
                    <td>{tx.category}</td>
                    <td><span style={{ fontSize: '0.75rem', padding: '0.2rem 0.5rem', backgroundColor: 'var(--bg-app)', borderRadius: '4px' }}>{tx.account}</span></td>
                    <td>{tx.description}</td>
                    <td style={{ fontWeight: 600, color: tx.type==='income' ? 'var(--success)' : 'var(--danger)' }}>
                      {tx.type==='income'?'+':'-'} {formatFCFA(tx.amount)}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

const CustomTooltip = ({ active, payload, label, formatAmount, currentEntity }) => {
  if (active && payload && payload.length) {
    const data = payload[0].payload;
    const totalPN = data.PN_Income - data.PN_Expense;
    const totalBrazza = data.Brazza_Income - data.Brazza_Expense;
    const totalGlobal = totalPN + totalBrazza;
    const totalSingle = data.Income - data.Expense;

    return (
      <div className="card" style={{ padding: '1rem', border: '1px solid var(--border)', boxShadow: '0 10px 15px -3px rgba(0, 0, 0, 0.1)', minWidth: '300px' }}>
        <p style={{ fontWeight: 700, marginBottom: '0.5rem', borderBottom: '1px solid var(--border)', paddingBottom: '0.5rem' }}>{label}</p>
        
        {currentEntity === 'global' ? (
          <>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1.5rem' }}>
              <div>
                <p style={{ fontWeight: 600, color: '#3b82f6', marginBottom: '0.25rem' }}>Meiji PN</p>
                <p style={{ fontSize: '0.875rem' }}>Recettes: <span style={{color: 'var(--success)'}}>{formatAmount(data.PN_Income)}</span></p>
                <p style={{ fontSize: '0.875rem' }}>Dépenses: <span style={{color: 'var(--danger)'}}>{formatAmount(data.PN_Expense)}</span></p>
                <p style={{ fontSize: '0.875rem', fontWeight: 600, marginTop: '0.25rem' }}>Net: {formatAmount(totalPN)}</p>
              </div>
              <div>
                <p style={{ fontWeight: 600, color: '#8b5cf6', marginBottom: '0.25rem' }}>Meiji Brazza</p>
                <p style={{ fontSize: '0.875rem' }}>Recettes: <span style={{color: 'var(--success)'}}>{formatAmount(data.Brazza_Income)}</span></p>
                <p style={{ fontSize: '0.875rem' }}>Dépenses: <span style={{color: 'var(--danger)'}}>{formatAmount(data.Brazza_Expense)}</span></p>
                <p style={{ fontSize: '0.875rem', fontWeight: 600, marginTop: '0.25rem' }}>Net: {formatAmount(totalBrazza)}</p>
              </div>
            </div>
            <div style={{ marginTop: '1rem', paddingTop: '0.5rem', borderTop: '1px solid var(--border)' }}>
              <p style={{ fontWeight: 700, fontSize: '1.125rem' }}>Total Journée: {formatAmount(totalGlobal)}</p>
            </div>
          </>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.25rem' }}>
            <p style={{ fontSize: '0.875rem' }}>Recettes: <span style={{color: 'var(--success)'}}>{formatAmount(data.Income)}</span></p>
            <p style={{ fontSize: '0.875rem' }}>Dépenses: <span style={{color: 'var(--danger)'}}>{formatAmount(data.Expense)}</span></p>
            <p style={{ fontSize: '1rem', fontWeight: 700, marginTop: '0.5rem' }}>Résultat Net: {formatAmount(totalSingle)}</p>
          </div>
        )}
      </div>
    );
  }
  return null;
};

export default function Dashboard() {
  const { currentEntity, getKPIs, getCashBalances, usdRate, setUsdRate, dateFilter, initialBalances, setInitialBalance } = useStore();
  const [selectedAccount, setSelectedAccount] = useState(null);
  const [selectedDay, setSelectedDay] = useState(null);
  const [showBalancesModal, setShowBalancesModal] = useState(false);
  
  const [currencyMode, setCurrencyMode] = useState('FCFA');

  const formatAmount = (amount) => {
    if (currencyMode === 'EUR') return formatEUR(amount);
    if (currencyMode === 'USD') return formatUSD(amount, usdRate);
    return formatFCFA(amount);
  };

  const kpisGlobal = getKPIs('global');
  const kpisPN = getKPIs('pn');
  const kpisBrazza = getKPIs('brazza');
  const balances = getCashBalances(currentEntity);
  const balancesPN = getCashBalances('pn');
  const balancesBrazza = getCashBalances('brazza');

  const allTxs = useStore(state => state.transactions);

  const handleExportGlobal = () => {
    const today = new Date().toISOString().split('T')[0];
    const incomes = formatTransactionsForExport(allTxs.filter(t => t.type === 'income'));
    const expenses = formatTransactionsForExport(allTxs.filter(t => t.type === 'expense'));
    const all = formatTransactionsForExport(allTxs);
    exportMultiSheetExcel([
      { data: all.length ? all : [{ 'Info': 'Aucune transaction' }], sheetName: 'Toutes les transactions' },
      { data: incomes.length ? incomes : [{ 'Info': 'Aucune recette' }], sheetName: 'Recettes' },
      { data: expenses.length ? expenses : [{ 'Info': 'Aucune dépense' }], sheetName: 'Dépenses' },
    ], `Meiji-Export-${today}`);
  };

  // Dynamically compute chart data from filtered transactions
  const filteredTxs = useStore(state => state.getFilteredTransactions(currentEntity));
  const chartDataMap = {};
  
  // Si le filtre est sur un mois complet, on pré-remplit tous les jours du mois pour que l'axe X soit complet
  if (dateFilter.type === 'month' && dateFilter.value) {
    const [year, month] = dateFilter.value.split('-');
    const daysInMonth = new Date(year, month, 0).getDate();
    for (let d = 1; d <= daysInMonth; d++) {
      const dayStr = `${year}-${month}-${d.toString().padStart(2, '0')}`;
      chartDataMap[dayStr] = { name: dayStr, Income: 0, Expense: 0, PN_Income: 0, PN_Expense: 0, Brazza_Income: 0, Brazza_Expense: 0 };
    }
  } else if (dateFilter.type === 'custom' && dateFilter.start && dateFilter.end) {
    const start = new Date(dateFilter.start);
    const end = new Date(dateFilter.end);
    if (start <= end) {
      const diffDays = Math.ceil(Math.abs(end - start) / (1000 * 60 * 60 * 24));
      if (diffDays <= 60) {
        for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
          const dayStr = d.toISOString().split('T')[0];
          chartDataMap[dayStr] = { name: dayStr, Income: 0, Expense: 0, PN_Income: 0, PN_Expense: 0, Brazza_Income: 0, Brazza_Expense: 0 };
        }
      }
    }
  }

  filteredTxs.forEach(tx => {
    const key = tx.date; // Use date as X-Axis
    if (!chartDataMap[key]) {
      chartDataMap[key] = { name: key, Income: 0, Expense: 0, PN_Income: 0, PN_Expense: 0, Brazza_Income: 0, Brazza_Expense: 0 };
    }
    if (tx.type === 'income') {
      chartDataMap[key].Income += tx.amount;
      if (tx.entityId === 'pn') chartDataMap[key].PN_Income += tx.amount;
      if (tx.entityId === 'brazza') chartDataMap[key].Brazza_Income += tx.amount;
    } else {
      chartDataMap[key].Expense += tx.amount;
      if (tx.entityId === 'pn') chartDataMap[key].PN_Expense += tx.amount;
      if (tx.entityId === 'brazza') chartDataMap[key].Brazza_Expense += tx.amount;
    }
  });

  const timelineData = Object.values(chartDataMap).sort((a, b) => a.name.localeCompare(b.name));

  return (
    <div className="flex-col gap-6" style={{ display: 'flex' }}>
      
      {/* Header & Controls */}
      <div className="flex justify-between items-center">
        <div>
          <h2 style={{ fontSize: '1.5rem', fontWeight: 700, marginBottom: '0.25rem' }}>
            {currentEntity === 'global' ? 'Consolidation Globale (Meiji Group)' : currentEntity === 'pn' ? 'Performance Meiji PN' : 'Performance Meiji Brazza'}
          </h2>
          <p style={{ color: 'var(--text-muted)', fontSize: '0.875rem' }}>Vue multi-devises avec drill-down sur la trésorerie.</p>
        </div>
        
        <div className="flex items-center gap-4">
          <div className="flex items-center gap-2" style={{ backgroundColor: 'var(--bg-surface)', padding: '0.5rem', borderRadius: '0.5rem', border: '1px solid var(--border)' }}>
            <span style={{ fontSize: '0.75rem', fontWeight: 600, color: 'var(--text-muted)' }}>DEVISE:</span>
            {['FCFA', 'EUR', 'USD'].map(curr => (
              <button 
                key={curr}
                onClick={() => setCurrencyMode(curr)}
                className="btn"
                style={{ 
                  padding: '0.25rem 0.5rem', 
                  backgroundColor: currencyMode === curr ? 'var(--primary)' : 'transparent',
                  color: currencyMode === curr ? '#fff' : 'var(--text-main)'
                }}
              >
                {curr}
              </button>
            ))}
          </div>
          
          {currencyMode === 'USD' && (
            <div className="flex items-center gap-2">
              <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>Taux USD:</span>
              <input type="number" className="form-input" style={{ width: '80px', padding: '0.25rem' }} value={usdRate} onChange={(e) => setUsdRate(Number(e.target.value))} />
            </div>
          )}

          <button onClick={handleExportGlobal} className="btn btn-outline" style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', fontWeight: 600 }}>
            <FileDown size={16} />
            Export Excel
          </button>
        </div>
      </div>

      {/* Side-by-Side Comparison if Global */}
      {currentEntity === 'global' ? (
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1.5rem' }}>
          {/* PN Column */}
          <div className="card" style={{ borderTop: '4px solid #3b82f6' }}>
            <h3 style={{ fontSize: '1.125rem', fontWeight: 700, marginBottom: '1rem', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
              <Building2 size={18} color="#3b82f6"/> Meiji PN
            </h3>
            <div className="flex-col gap-4" style={{ display: 'flex' }}>
              <div className="flex justify-between items-center pb-2" style={{ borderBottom: '1px solid var(--border)' }}>
                <span style={{ color: 'var(--text-muted)' }}>Chiffre d'Affaires</span>
                <span style={{ fontWeight: 600, color: 'var(--success)' }}>{formatAmount(kpisPN.income)}</span>
              </div>
              <div className="flex justify-between items-center pb-2" style={{ borderBottom: '1px solid var(--border)' }}>
                <span style={{ color: 'var(--text-muted)' }}>Dépenses</span>
                <span style={{ fontWeight: 600, color: 'var(--danger)' }}>{formatAmount(kpisPN.expense)}</span>
              </div>
              <div className="flex justify-between items-center">
                <span style={{ fontWeight: 600 }}>Résultat Net</span>
                <span style={{ fontSize: '1.25rem', fontWeight: 700 }}>{formatAmount(kpisPN.net)}</span>
              </div>
            </div>
          </div>
          
          {/* Brazza Column */}
          <div className="card" style={{ borderTop: '4px solid #8b5cf6' }}>
            <h3 style={{ fontSize: '1.125rem', fontWeight: 700, marginBottom: '1rem', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
              <Building2 size={18} color="#8b5cf6"/> Meiji Brazza
            </h3>
            <div className="flex-col gap-4" style={{ display: 'flex' }}>
              <div className="flex justify-between items-center pb-2" style={{ borderBottom: '1px solid var(--border)' }}>
                <span style={{ color: 'var(--text-muted)' }}>Chiffre d'Affaires</span>
                <span style={{ fontWeight: 600, color: 'var(--success)' }}>{formatAmount(kpisBrazza.income)}</span>
              </div>
              <div className="flex justify-between items-center pb-2" style={{ borderBottom: '1px solid var(--border)' }}>
                <span style={{ color: 'var(--text-muted)' }}>Dépenses</span>
                <span style={{ fontWeight: 600, color: 'var(--danger)' }}>{formatAmount(kpisBrazza.expense)}</span>
              </div>
              <div className="flex justify-between items-center">
                <span style={{ fontWeight: 600 }}>Résultat Net</span>
                <span style={{ fontSize: '1.25rem', fontWeight: 700 }}>{formatAmount(kpisBrazza.net)}</span>
              </div>
            </div>
          </div>
        </div>
      ) : (
        /* Standard KPIs if Single Entity */
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '1.5rem' }}>
          <div className="card">
            <div className="flex justify-between items-center" style={{ marginBottom: '1rem' }}>
              <span style={{ color: 'var(--text-muted)', fontWeight: 500 }}>Chiffre d'Affaires</span>
              <div style={{ padding: '0.5rem', backgroundColor: 'var(--success-bg)', color: 'var(--success)', borderRadius: '0.5rem' }}><ArrowUpRight size={20} /></div>
            </div>
            <div style={{ fontSize: '2rem', fontWeight: 700 }}>{formatAmount(getKPIs().income)}</div>
          </div>
          
          <div className="card">
            <div className="flex justify-between items-center" style={{ marginBottom: '1rem' }}>
              <span style={{ color: 'var(--text-muted)', fontWeight: 500 }}>Dépenses</span>
              <div style={{ padding: '0.5rem', backgroundColor: 'var(--danger-bg)', color: 'var(--danger)', borderRadius: '0.5rem' }}><ArrowDownRight size={20} /></div>
            </div>
            <div style={{ fontSize: '2rem', fontWeight: 700 }}>{formatAmount(getKPIs().expense)}</div>
          </div>

          <div className="card" style={{ borderColor: 'var(--primary)', borderWidth: '2px' }}>
            <div className="flex justify-between items-center" style={{ marginBottom: '1rem' }}>
              <span style={{ color: 'var(--primary)', fontWeight: 600 }}>Résultat Net</span>
              <div style={{ padding: '0.5rem', backgroundColor: 'var(--primary-light)', color: 'var(--primary)', borderRadius: '0.5rem' }}><Building2 size={20} /></div>
            </div>
            <div style={{ fontSize: '2rem', fontWeight: 700 }}>{formatAmount(getKPIs().net)}</div>
          </div>
        </div>
      )}

      {/* Cash Management Drill-Down */}
      {currentEntity === 'global' ? (
        <>
          {/* Global Treasury Total */}
          <div className="flex items-center gap-2" style={{ marginTop: '1rem' }}>
            <Activity size={20} color="var(--primary)" />
            <h3 style={{ fontSize: '1.25rem', fontWeight: 600 }}>Trésorerie Globale</h3>
            <button onClick={() => setShowBalancesModal(true)} style={{ background: 'none', border: '1px solid var(--border)', borderRadius: '0.375rem', padding: '0.35rem 0.75rem', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '0.35rem', fontSize: '0.75rem', color: 'var(--text-muted)', marginLeft: 'auto' }}>
              <Settings size={14} /> Soldes de départ
            </button>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '1rem' }}>
            {Object.entries(balances).map(([account, balance]) => (
              <div key={account} className="card flex items-center gap-4" style={{ padding: '1rem', cursor: 'pointer', border: '1px solid transparent' }} onMouseEnter={e => e.currentTarget.style.borderColor = 'var(--primary)'} onMouseLeave={e => e.currentTarget.style.borderColor = 'transparent'} onClick={() => setSelectedAccount(account)}>
                <div style={{ padding: '0.75rem', backgroundColor: 'var(--bg-app)', borderRadius: '0.5rem' }}><Wallet size={24} color="var(--primary)" /></div>
                <div>
                  <p style={{ fontSize: '0.75rem', color: 'var(--text-muted)', fontWeight: 600, textTransform: 'uppercase' }}>{account}</p>
                  <p style={{ fontSize: '1.125rem', fontWeight: 700 }}>{formatAmount(balance)}</p>
                </div>
              </div>
            ))}
          </div>

          {/* Per-entity treasuries */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1.5rem' }}>
            {/* PN Treasury */}
            <div className="card" style={{ borderTop: '4px solid #3b82f6' }}>
              <h4 style={{ fontSize: '1rem', fontWeight: 600, marginBottom: '1rem', display: 'flex', alignItems: 'center', gap: '0.5rem' }}><Building2 size={16} color="#3b82f6" /> Trésorerie Pointe-Noire</h4>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.75rem' }}>
                {Object.entries(balancesPN).map(([account, balance]) => (
                  <div key={account} className="flex items-center" style={{ padding: '0.75rem', backgroundColor: 'var(--bg-app)', borderRadius: '0.5rem', cursor: 'pointer', gap: '0.75rem' }} onClick={() => setSelectedAccount(account)}>
                    <Wallet size={18} color="#3b82f6" />
                    <div>
                      <p style={{ fontSize: '0.7rem', color: 'var(--text-muted)', fontWeight: 600, textTransform: 'uppercase' }}>{account}</p>
                      <p style={{ fontSize: '1rem', fontWeight: 700 }}>{formatAmount(balance)}</p>
                    </div>
                  </div>
                ))}
              </div>
            </div>
            {/* Brazza Treasury */}
            <div className="card" style={{ borderTop: '4px solid #8b5cf6' }}>
              <h4 style={{ fontSize: '1rem', fontWeight: 600, marginBottom: '1rem', display: 'flex', alignItems: 'center', gap: '0.5rem' }}><Building2 size={16} color="#8b5cf6" /> Trésorerie Brazzaville</h4>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.75rem' }}>
                {Object.entries(balancesBrazza).map(([account, balance]) => (
                  <div key={account} className="flex items-center" style={{ padding: '0.75rem', backgroundColor: 'var(--bg-app)', borderRadius: '0.5rem', cursor: 'pointer', gap: '0.75rem' }} onClick={() => setSelectedAccount(account)}>
                    <Wallet size={18} color="#8b5cf6" />
                    <div>
                      <p style={{ fontSize: '0.7rem', color: 'var(--text-muted)', fontWeight: 600, textTransform: 'uppercase' }}>{account}</p>
                      <p style={{ fontSize: '1rem', fontWeight: 700 }}>{formatAmount(balance)}</p>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </>
      ) : (
        <>
          <div className="flex items-center gap-2" style={{ marginTop: '1rem' }}>
            <Activity size={20} color="var(--primary)" />
            <h3 style={{ fontSize: '1.25rem', fontWeight: 600 }}>Trésorerie Actuelle (Cliquez pour détailler)</h3>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '1rem' }}>
            {Object.entries(balances).map(([account, balance]) => (
              <div key={account} className="card flex items-center gap-4" style={{ padding: '1rem', cursor: 'pointer', border: '1px solid transparent' }} onMouseEnter={e => e.currentTarget.style.borderColor = 'var(--primary)'} onMouseLeave={e => e.currentTarget.style.borderColor = 'transparent'} onClick={() => setSelectedAccount(account)}>
                <div style={{ padding: '0.75rem', backgroundColor: 'var(--bg-app)', borderRadius: '0.5rem' }}><Wallet size={24} color="var(--primary)" /></div>
                <div>
                  <p style={{ fontSize: '0.75rem', color: 'var(--text-muted)', fontWeight: 600, textTransform: 'uppercase' }}>{account}</p>
                  <p style={{ fontSize: '1.125rem', fontWeight: 700 }}>{formatAmount(balance)}</p>
                </div>
              </div>
            ))}
          </div>
        </>
      )}

      {/* Charts */}
      {currentEntity === 'global' ? (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
          <div className="card">
            <h3 style={{ fontSize: '1rem', fontWeight: 600, marginBottom: '1.5rem' }}>Comparaison recettes Brazza/Pointe-Noire</h3>
            <div style={{ width: '100%', height: 300 }}>
              {timelineData.length === 0 ? (
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%', color: 'var(--text-muted)' }}>Aucune donnée pour cette période.</div>
              ) : (
                <ResponsiveContainer>
                  <BarChart data={timelineData}>
                    <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="var(--border)" />
                    <XAxis dataKey="name" axisLine={false} tickLine={false} tick={{fontSize: 12}} />
                    <YAxis axisLine={false} tickLine={false} tickFormatter={(value) => value / 1000 + 'k'} />
                    <RechartsTooltip content={<CustomTooltip formatAmount={formatAmount} currentEntity={currentEntity} />} cursor={{fill: 'var(--bg-app)'}} />
                    <Legend />
                    <Bar dataKey="PN_Income" name="Recettes PN" fill="#3b82f6" radius={[4, 4, 0, 0]} onClick={(data) => setSelectedDay(data.name)} style={{cursor: 'pointer'}} />
                    <Bar dataKey="Brazza_Income" name="Recettes Brazza" fill="#8b5cf6" radius={[4, 4, 0, 0]} onClick={(data) => setSelectedDay(data.name)} style={{cursor: 'pointer'}} />
                  </BarChart>
                </ResponsiveContainer>
              )}
            </div>
          </div>
          <div className="card">
            <h3 style={{ fontSize: '1rem', fontWeight: 600, marginBottom: '1.5rem' }}>Comparaison dépenses Brazza/Pointe-Noire</h3>
            <div style={{ width: '100%', height: 300 }}>
              {timelineData.length === 0 ? (
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%', color: 'var(--text-muted)' }}>Aucune donnée pour cette période.</div>
              ) : (
                <ResponsiveContainer>
                  <BarChart data={timelineData}>
                    <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="var(--border)" />
                    <XAxis dataKey="name" axisLine={false} tickLine={false} tick={{fontSize: 12}} />
                    <YAxis axisLine={false} tickLine={false} tickFormatter={(value) => value / 1000 + 'k'} />
                    <RechartsTooltip content={<CustomTooltip formatAmount={formatAmount} currentEntity={currentEntity} />} cursor={{fill: 'var(--bg-app)'}} />
                    <Legend />
                    <Bar dataKey="PN_Expense" name="Dépenses PN" fill="#ef4444" radius={[4, 4, 0, 0]} onClick={(data) => setSelectedDay(data.name)} style={{cursor: 'pointer'}} />
                    <Bar dataKey="Brazza_Expense" name="Dépenses Brazza" fill="#f97316" radius={[4, 4, 0, 0]} onClick={(data) => setSelectedDay(data.name)} style={{cursor: 'pointer'}} />
                  </BarChart>
                </ResponsiveContainer>
              )}
            </div>
          </div>
        </div>
      ) : (
        <div className="card">
          <h3 style={{ fontSize: '1rem', fontWeight: 600, marginBottom: '1.5rem' }}>Analyse des Flux Dynamique</h3>
          <div style={{ width: '100%', height: 350 }}>
            {timelineData.length === 0 ? (
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%', color: 'var(--text-muted)' }}>Aucune donnée pour cette période.</div>
            ) : (
              <ResponsiveContainer>
                <BarChart data={timelineData}>
                  <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="var(--border)" />
                  <XAxis dataKey="name" axisLine={false} tickLine={false} tick={{fontSize: 12}} />
                  <YAxis axisLine={false} tickLine={false} tickFormatter={(value) => value / 1000 + 'k'} />
                  <RechartsTooltip content={<CustomTooltip formatAmount={formatAmount} currentEntity={currentEntity} />} cursor={{fill: 'var(--bg-app)'}} />
                  <Legend />
                  <Bar dataKey="Income" name="Recettes" fill="var(--success)" radius={[4, 4, 0, 0]} onClick={(data) => setSelectedDay(data.name)} style={{cursor: 'pointer'}} />
                  <Bar dataKey="Expense" name="Dépenses" fill="var(--danger)" radius={[4, 4, 0, 0]} onClick={(data) => setSelectedDay(data.name)} style={{cursor: 'pointer'}} />
                </BarChart>
              </ResponsiveContainer>
            )}
          </div>
        </div>
      )}

      {/* Modal */}
      {selectedAccount && <AccountDetailsModal accountName={selectedAccount} onClose={() => setSelectedAccount(null)} />}
      {selectedDay && <DayDetailsModal date={selectedDay} currentEntity={currentEntity} onClose={() => setSelectedDay(null)} />}
      {showBalancesModal && (
        <div style={{ position: 'fixed', inset: 0, backgroundColor: 'rgba(0,0,0,0.5)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000, padding: '2rem' }}>
          <div className="card" style={{ width: '100%', maxWidth: '600px' }}>
            <div className="flex justify-between items-center" style={{ marginBottom: '1.5rem' }}>
              <h3 style={{ fontSize: '1.25rem', fontWeight: 700 }}>Soldes de Départ — Trésorerie</h3>
              <button onClick={() => setShowBalancesModal(false)} style={{ background: 'none', border: 'none', cursor: 'pointer' }}><X size={24} color="var(--text-muted)" /></button>
            </div>
            <p style={{ fontSize: '0.875rem', color: 'var(--text-muted)', marginBottom: '1.5rem' }}>Définissez le solde initial de chaque compte pour chaque entité. Ces montants servent de point de départ pour le calcul de votre trésorerie.</p>

            {[
              { id: 'pn', label: 'Meiji Pointe-Noire', color: '#3b82f6' },
              { id: 'brazza', label: 'Meiji Brazzaville', color: '#8b5cf6' }
            ].map(entity => (
              <div key={entity.id} style={{ marginBottom: '1.5rem' }}>
                <h4 style={{ fontSize: '0.875rem', fontWeight: 700, marginBottom: '0.75rem', color: entity.color, display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                  <Building2 size={16} /> {entity.label}
                </h4>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.75rem' }}>
                  {['Espèces', 'Banque', 'MTN Momo', 'Airtel Money'].map(account => (
                    <div key={account} style={{ display: 'flex', flexDirection: 'column', gap: '0.25rem' }}>
                      <span style={{ fontSize: '0.7rem', fontWeight: 600, color: 'var(--text-muted)', textTransform: 'uppercase' }}>{account}</span>
                      <input
                        type="number"
                        className="form-input"
                        min="0"
                        value={initialBalances[entity.id][account] || ''}
                        onChange={e => setInitialBalance(entity.id, account, e.target.value)}
                        placeholder="0"
                        style={{ padding: '0.5rem' }}
                      />
                    </div>
                  ))}
                </div>
              </div>
            ))}

            <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: '0.5rem' }}>
              <button className="btn btn-primary" onClick={() => setShowBalancesModal(false)}>Valider</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
