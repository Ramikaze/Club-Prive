import { useState } from 'react';
import { useStore, formatFCFA, formatEUR, formatUSD } from '../store/useStore';
import { BarChart, Bar, PieChart, Pie, Cell, XAxis, YAxis, CartesianGrid, Tooltip as RechartsTooltip, ResponsiveContainer, Legend } from 'recharts';
import { ArrowDownRight, Activity, Building2, X, Plus, Trash2, FileDown } from 'lucide-react';
import { exportToExcel, formatTransactionsForExport } from '../utils/exportExcel';

function AddExpenseModal({ onClose, onSubmit, categories, isLoading }) {
  const [form, setForm] = useState({ date: new Date().toISOString().split('T')[0], entityId: 'pn', category: '', description: '' });
  const [amounts, setAmounts] = useState({ 'Espèces': '', 'Banque': '', 'MTN Momo': '', 'Airtel Money': '' });
  const expenseCategories = categories.filter(c => c.type === 'expense');
  const total = Object.values(amounts).reduce((s, v) => s + (Number(v) || 0), 0);
  const handleSubmit = (e) => {
    e.preventDefault();
    if (total <= 0) return;
    const txs = Object.entries(amounts)
      .filter(([, v]) => Number(v) > 0)
      .map(([account, amount]) => ({ ...form, type: 'expense', account, amount: Number(amount) }));
    onSubmit(txs);
  };
  const updateAmount = (account, value) => setAmounts(prev => ({ ...prev, [account]: value }));
  const formatTotal = (v) => v.toLocaleString('fr-FR') + ' FCFA';
  return (
    <div style={{ position: 'fixed', inset: 0, backgroundColor: 'rgba(0,0,0,0.5)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000, padding: '2rem' }}>
      <div className="card" style={{ width: '100%', maxWidth: '550px' }}>
        <div className="flex justify-between items-center" style={{ marginBottom: '1.5rem' }}>
          <h3 style={{ fontSize: '1.25rem', fontWeight: 700, color: 'var(--danger)' }}>Nouvelle Dépense</h3>
          <button onClick={onClose} style={{ background: 'none', border: 'none', cursor: 'pointer' }}><X size={24} color="var(--text-muted)" /></button>
        </div>
        <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem' }}>
            <div className="form-group"><label className="form-label">Date</label><input type="date" className="form-input" required value={form.date} onChange={e => setForm({...form, date: e.target.value})} /></div>
            <div className="form-group"><label className="form-label">Entité</label><select className="form-input" value={form.entityId} onChange={e => setForm({...form, entityId: e.target.value})}><option value="pn">Meiji PN</option><option value="brazza">Meiji Brazza</option></select></div>
          </div>
          <div className="form-group"><label className="form-label">Catégorie</label><select className="form-input" required value={form.category} onChange={e => setForm({...form, category: e.target.value})}><option value="">Sélectionner...</option>{expenseCategories.map(c => <option key={c.id} value={c.name}>{c.name}</option>)}</select></div>

          <div style={{ backgroundColor: 'var(--bg-app)', padding: '1rem', borderRadius: '0.5rem', border: '1px solid var(--border)' }}>
            <label className="form-label" style={{ marginBottom: '0.75rem', display: 'block' }}>Ventilation par mode de paiement</label>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.75rem' }}>
              {['Espèces', 'Banque', 'MTN Momo', 'Airtel Money'].map(account => (
                <div key={account} style={{ display: 'flex', flexDirection: 'column', gap: '0.25rem' }}>
                  <span style={{ fontSize: '0.75rem', fontWeight: 600, color: 'var(--text-muted)', textTransform: 'uppercase' }}>{account}</span>
                  <input type="number" className="form-input" min="0" value={amounts[account]} onChange={e => updateAmount(account, e.target.value)} placeholder="0" style={{ padding: '0.5rem' }} />
                </div>
              ))}
            </div>
            <div style={{ marginTop: '0.75rem', paddingTop: '0.75rem', borderTop: '1px solid var(--border)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <span style={{ fontWeight: 600, fontSize: '0.875rem' }}>Total Dépense</span>
              <span style={{ fontWeight: 700, fontSize: '1.125rem', color: total > 0 ? 'var(--danger)' : 'var(--text-muted)' }}>{formatTotal(total)}</span>
            </div>
          </div>

          <div className="form-group"><label className="form-label">Description</label><input type="text" className="form-input" value={form.description} onChange={e => setForm({...form, description: e.target.value})} placeholder="Approvisionnement marché" /></div>
          <div className="flex justify-between" style={{ marginTop: '0.5rem' }}>
            <button type="button" className="btn btn-outline" onClick={onClose}>Annuler</button>
            <button type="submit" className="btn btn-primary" disabled={isLoading || total <= 0}>{isLoading ? 'Enregistrement...' : 'Enregistrer la dépense'}</button>
          </div>
        </form>
      </div>
    </div>
  );
}

function EntityDetailModal({ entityId, entityName, entityColor, txs, formatAmount, onClose }) {
  // Group by category
  const categoryMap = {};
  txs.forEach(tx => {
    categoryMap[tx.category] = (categoryMap[tx.category] || 0) + tx.amount;
  });
  const categories = Object.entries(categoryMap).sort((a, b) => b[1] - a[1]);
  const total = txs.reduce((acc, tx) => acc + tx.amount, 0);

  // Group by account (payment method)
  const accountMap = {};
  txs.forEach(tx => {
    accountMap[tx.account] = (accountMap[tx.account] || 0) + tx.amount;
  });
  const accounts = Object.entries(accountMap).sort((a, b) => b[1] - a[1]);

  return (
    <div style={{ position: 'fixed', inset: 0, backgroundColor: 'rgba(0,0,0,0.5)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000, padding: '2rem' }}>
      <div className="card" style={{ width: '100%', maxWidth: '900px', maxHeight: '85vh', display: 'flex', flexDirection: 'column' }}>
        <div className="flex justify-between items-center" style={{ marginBottom: '1.5rem' }}>
          <h3 style={{ fontSize: '1.25rem', fontWeight: 700, display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
            <Building2 size={20} color={entityColor} /> Détail Dépenses — {entityName}
          </h3>
          <button onClick={onClose} style={{ background: 'none', border: 'none', cursor: 'pointer' }}><X size={24} color="var(--text-muted)" /></button>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem', marginBottom: '1.5rem' }}>
          <div style={{ backgroundColor: 'var(--bg-app)', padding: '1rem', borderRadius: '0.5rem', borderLeft: `4px solid ${entityColor}` }}>
            <h4 style={{ fontWeight: 600, marginBottom: '0.75rem', color: entityColor }}>Par Catégorie</h4>
            {categories.map(([cat, amount]) => (
              <div key={cat} className="flex justify-between items-center" style={{ fontSize: '0.875rem', marginBottom: '0.4rem' }}>
                <span style={{ color: 'var(--text-muted)' }}>{cat}</span>
                <span style={{ fontWeight: 600, color: 'var(--danger)' }}>{formatAmount(amount)}</span>
              </div>
            ))}
          </div>
          <div style={{ backgroundColor: 'var(--bg-app)', padding: '1rem', borderRadius: '0.5rem', borderLeft: `4px solid ${entityColor}` }}>
            <h4 style={{ fontWeight: 600, marginBottom: '0.75rem', color: entityColor }}>Par Mode de Paiement</h4>
            {accounts.map(([acc, amount]) => (
              <div key={acc} className="flex justify-between items-center" style={{ fontSize: '0.875rem', marginBottom: '0.4rem' }}>
                <span style={{ color: 'var(--text-muted)' }}>{acc}</span>
                <span style={{ fontWeight: 600, color: 'var(--danger)' }}>{formatAmount(amount)}</span>
              </div>
            ))}
          </div>
        </div>

        <div style={{ padding: '0.75rem 1rem', backgroundColor: 'var(--bg-app)', borderRadius: '0.5rem', marginBottom: '1rem' }}>
          <span style={{ fontWeight: 700, fontSize: '1.125rem' }}>Total: <span style={{ color: 'var(--danger)' }}>{formatAmount(total)}</span></span>
          <span style={{ color: 'var(--text-muted)', marginLeft: '1rem', fontSize: '0.875rem' }}>({txs.length} transactions)</span>
        </div>

        <div style={{ overflowY: 'auto', flex: 1 }} className="table-container">
          <table className="data-table">
            <thead>
              <tr>
                <th>Date</th>
                <th>Catégorie</th>
                <th>Compte</th>
                <th>Description</th>
                <th>Montant</th>
              </tr>
            </thead>
            <tbody>
              {txs.map(tx => (
                <tr key={tx.id}>
                  <td>{tx.date}</td>
                  <td>{tx.category}</td>
                  <td><span style={{ fontSize: '0.75rem', padding: '0.2rem 0.5rem', backgroundColor: 'var(--bg-app)', borderRadius: '4px' }}>{tx.account}</span></td>
                  <td>{tx.description}</td>
                  <td style={{ fontWeight: 600, color: 'var(--danger)' }}>- {formatAmount(tx.amount)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

const COLORS = ['#ef4444', '#f97316', '#f59e0b', '#eab308', '#84cc16', '#06b6d4', '#6366f1'];

const CustomTooltip = ({ active, payload, label, formatAmount, currentEntity }) => {
  if (active && payload && payload.length) {
    if (currentEntity === 'global') {
      const pn = payload.find(p => p.dataKey === 'PN_Expense')?.value || 0;
      const brazza = payload.find(p => p.dataKey === 'Brazza_Expense')?.value || 0;
      const total = pn + brazza;
      return (
        <div className="card" style={{ padding: '1rem', border: '1px solid var(--border)', boxShadow: '0 10px 15px -3px rgba(0, 0, 0, 0.1)', minWidth: '200px' }}>
          <p style={{ fontWeight: 700, marginBottom: '0.5rem', borderBottom: '1px solid var(--border)', paddingBottom: '0.5rem' }}>{label}</p>
          <p style={{ fontSize: '0.875rem', marginBottom: '0.25rem' }}>Meiji PN: <span style={{fontWeight: 600, color: '#ef4444'}}>{formatAmount(pn)}</span></p>
          <p style={{ fontSize: '0.875rem', marginBottom: '0.5rem' }}>Meiji Brazza: <span style={{fontWeight: 600, color: '#f97316'}}>{formatAmount(brazza)}</span></p>
          <p style={{ fontSize: '1rem', fontWeight: 700, marginTop: '0.5rem', paddingTop: '0.5rem', borderTop: '1px solid var(--border)' }}>Total: {formatAmount(total)}</p>
        </div>
      );
    } else {
      const expense = payload[0].value;
      return (
        <div className="card" style={{ padding: '1rem', border: '1px solid var(--border)', boxShadow: '0 10px 15px -3px rgba(0, 0, 0, 0.1)', minWidth: '200px' }}>
          <p style={{ fontWeight: 700, marginBottom: '0.5rem', borderBottom: '1px solid var(--border)', paddingBottom: '0.5rem' }}>{label}</p>
          <p style={{ fontSize: '1rem', fontWeight: 700 }}>Dépenses: <span style={{color: 'var(--danger)'}}>{formatAmount(expense)}</span></p>
        </div>
      );
    }
  }
  return null;
};

export default function Expenses() {
  const { currentEntity, getFilteredTransactions, addTransaction, deleteTransaction, deleteTransactions, categories, usdRate, dateFilter, isLoading } = useStore();
  const [currencyMode, setCurrencyMode] = useState('FCFA');
  const [selectedEntity, setSelectedEntity] = useState(null);
  const [showAddModal, setShowAddModal] = useState(false);
  const [selectedIds, setSelectedIds] = useState([]);

  const txs = getFilteredTransactions(currentEntity).filter(tx => tx.type === 'expense');

  const handleSelectAll = (e) => {
    if (e.target.checked) {
      setSelectedIds(txs.map(tx => tx.id));
    } else {
      setSelectedIds([]);
    }
  };

  const handleSelectOne = (id) => {
    setSelectedIds(prev => prev.includes(id) ? prev.filter(i => i !== id) : [...prev, id]);
  };

  const handleBulkDelete = async () => {
    if (window.confirm(`Voulez-vous vraiment supprimer les ${selectedIds.length} dépenses sélectionnées ?`)) {
      await deleteTransactions(selectedIds);
      setSelectedIds([]);
    }
  };

  const handleAddExpense = async (entries) => {
    for (const tx of entries) await addTransaction(tx);
    setShowAddModal(false);
  };

  const handleExport = () => {
    const today = new Date().toISOString().split('T')[0];
    const data = formatTransactionsForExport(txs);
    exportToExcel(
      data.length ? data : [{ 'Info': 'Aucune dépense' }],
      'Dépenses',
      `Meiji-Dépenses-${today}`
    );
  };

  const formatAmount = (amount) => {
    if (currencyMode === 'EUR') return formatEUR(amount);
    if (currencyMode === 'USD') return formatUSD(amount, usdRate);
    return formatFCFA(amount);
  };

  // KPI
  const totalExpense = txs.reduce((acc, tx) => acc + tx.amount, 0);

  // Data for Timeline Chart
  const chartDataMap = {};
  
  if (dateFilter.type === 'month' && dateFilter.value) {
    const [year, month] = dateFilter.value.split('-');
    const daysInMonth = new Date(year, month, 0).getDate();
    for (let d = 1; d <= daysInMonth; d++) {
      const dayStr = `${year}-${month}-${d.toString().padStart(2, '0')}`;
      chartDataMap[dayStr] = { name: dayStr, Expense: 0, PN_Expense: 0, Brazza_Expense: 0 };
    }
  } else if (dateFilter.type === 'custom' && dateFilter.start && dateFilter.end) {
    const start = new Date(dateFilter.start);
    const end = new Date(dateFilter.end);
    if (start <= end) {
      const diffDays = Math.ceil(Math.abs(end - start) / (1000 * 60 * 60 * 24));
      if (diffDays <= 60) {
        for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
          const dayStr = d.toISOString().split('T')[0];
          chartDataMap[dayStr] = { name: dayStr, Expense: 0, PN_Expense: 0, Brazza_Expense: 0 };
        }
      }
    }
  }

  txs.forEach(tx => {
    const key = tx.date;
    if (!chartDataMap[key]) {
      chartDataMap[key] = { name: key, Expense: 0, PN_Expense: 0, Brazza_Expense: 0 };
    }
    chartDataMap[key].Expense += tx.amount;
    if (tx.entityId === 'pn') chartDataMap[key].PN_Expense += tx.amount;
    if (tx.entityId === 'brazza') chartDataMap[key].Brazza_Expense += tx.amount;
  });

  const timelineData = Object.values(chartDataMap).sort((a, b) => a.name.localeCompare(b.name));

  // Data for Pie Chart (by Category)
  const categoryMap = {};
  txs.forEach(tx => {
    categoryMap[tx.category] = (categoryMap[tx.category] || 0) + tx.amount;
  });
  const categoryData = Object.entries(categoryMap).map(([name, value]) => ({ name, value })).sort((a, b) => b.value - a.value);

  // Data for Entity Pie Chart (if Global)
  const entityData = currentEntity === 'global' ? [
    { name: 'Meiji PN', value: txs.filter(t => t.entityId === 'pn').reduce((acc, t) => acc + t.amount, 0), color: '#ef4444' },
    { name: 'Meiji Brazza', value: txs.filter(t => t.entityId === 'brazza').reduce((acc, t) => acc + t.amount, 0), color: '#f97316' }
  ] : [];

  return (
    <div className="flex-col gap-6" style={{ display: 'flex' }}>
      <div className="flex justify-between items-center">
        <div>
          <h2 style={{ fontSize: '1.5rem', fontWeight: 700, marginBottom: '0.25rem', color: 'var(--danger)' }}>
            Analyse des Dépenses
          </h2>
          <p style={{ color: 'var(--text-muted)', fontSize: '0.875rem' }}>Vue détaillée des flux sortants pour la période sélectionnée.</p>
        </div>
        
        <div className="flex items-center gap-2">
          <button data-tour="add-expense-btn" className="btn btn-primary" onClick={() => setShowAddModal(true)}><Plus size={18} /> Ajouter une dépense</button>
          <button className="btn btn-outline" onClick={handleExport} style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
            <FileDown size={16} /> Export Excel
          </button>
          <div className="flex items-center gap-2" style={{ backgroundColor: 'var(--bg-surface)', padding: '0.5rem', borderRadius: '0.5rem', border: '1px solid var(--border)' }}>
            <span style={{ fontSize: '0.75rem', fontWeight: 600, color: 'var(--text-muted)' }}>DEVISE:</span>
            {['FCFA', 'EUR', 'USD'].map(curr => (
              <button key={curr} onClick={() => setCurrencyMode(curr)} className="btn" style={{ padding: '0.25rem 0.5rem', backgroundColor: currencyMode === curr ? 'var(--primary)' : 'transparent', color: currencyMode === curr ? '#fff' : 'var(--text-main)' }}>{curr}</button>
            ))}
          </div>
        </div>
      </div>

      {/* KPIs */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(250px, 1fr))', gap: '1.5rem' }}>
        <div className="card" style={{ borderTop: '4px solid var(--danger)' }}>
          <div className="flex justify-between items-center" style={{ marginBottom: '1rem' }}>
            <span style={{ color: 'var(--text-muted)', fontWeight: 500 }}>Total Dépenses</span>
            <div style={{ padding: '0.5rem', backgroundColor: 'var(--danger-bg)', color: 'var(--danger)', borderRadius: '0.5rem' }}><ArrowDownRight size={20} /></div>
          </div>
          <div style={{ fontSize: '2rem', fontWeight: 700, color: 'var(--danger)' }}>{formatAmount(totalExpense)}</div>
        </div>

        {currentEntity === 'global' && (
          <>
            <div className="card" onClick={() => setSelectedEntity('pn')} style={{ cursor: 'pointer', transition: 'transform 0.2s, border-color 0.2s', border: '1px solid transparent' }} onMouseEnter={e => e.currentTarget.style.borderColor = '#ef4444'} onMouseLeave={e => e.currentTarget.style.borderColor = 'transparent'}>
               <div className="flex justify-between items-center" style={{ marginBottom: '1rem' }}>
                <span style={{ color: 'var(--text-muted)', fontWeight: 500 }}>Part Meiji PN</span>
                <div style={{ padding: '0.5rem', backgroundColor: 'rgba(239, 68, 68, 0.1)', color: '#ef4444', borderRadius: '0.5rem' }}><Building2 size={20} /></div>
              </div>
              <div style={{ fontSize: '2rem', fontWeight: 700 }}>{formatAmount(entityData.find(e => e.name === 'Meiji PN')?.value || 0)}</div>
              <p style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginTop: '0.5rem' }}>Cliquez pour voir le détail →</p>
            </div>
            <div className="card" onClick={() => setSelectedEntity('brazza')} style={{ cursor: 'pointer', transition: 'transform 0.2s, border-color 0.2s', border: '1px solid transparent' }} onMouseEnter={e => e.currentTarget.style.borderColor = '#f97316'} onMouseLeave={e => e.currentTarget.style.borderColor = 'transparent'}>
               <div className="flex justify-between items-center" style={{ marginBottom: '1rem' }}>
                <span style={{ color: 'var(--text-muted)', fontWeight: 500 }}>Part Meiji Brazza</span>
                <div style={{ padding: '0.5rem', backgroundColor: 'rgba(249, 115, 22, 0.1)', color: '#f97316', borderRadius: '0.5rem' }}><Building2 size={20} /></div>
              </div>
              <div style={{ fontSize: '2rem', fontWeight: 700 }}>{formatAmount(entityData.find(e => e.name === 'Meiji Brazza')?.value || 0)}</div>
              <p style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginTop: '0.5rem' }}>Cliquez pour voir le détail →</p>
            </div>
          </>
        )}
      </div>

      {/* Charts Grid */}
      <div style={{ display: 'grid', gridTemplateColumns: currentEntity === 'global' ? '1fr 1fr' : '1fr', gap: '1.5rem' }}>
        
        {/* Category Pie Chart */}
        <div className="card">
          <h3 style={{ fontSize: '1rem', fontWeight: 600, marginBottom: '1.5rem', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
            <Activity size={18} color="var(--primary)" /> Répartition par Catégorie
          </h3>
          <div style={{ width: '100%', height: 300 }}>
            {categoryData.length === 0 ? (
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%', color: 'var(--text-muted)' }}>Aucune donnée.</div>
            ) : (
              <ResponsiveContainer>
                <PieChart>
                  <Pie data={categoryData} cx="50%" cy="50%" innerRadius={60} outerRadius={100} paddingAngle={2} dataKey="value" nameKey="name" label={({name, percent}) => `${name} (${(percent * 100).toFixed(0)}%)`}>
                    {categoryData.map((entry, index) => (
                      <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
                    ))}
                  </Pie>
                  <RechartsTooltip formatter={(value) => formatAmount(value)} contentStyle={{ backgroundColor: 'var(--bg-app)', border: '1px solid var(--border)' }} />
                  <Legend />
                </PieChart>
              </ResponsiveContainer>
            )}
          </div>
        </div>

        {/* Entity Pie Chart (Only for global) */}
        {currentEntity === 'global' && (
          <div className="card">
            <h3 style={{ fontSize: '1rem', fontWeight: 600, marginBottom: '1.5rem', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
              <Building2 size={18} color="var(--primary)" /> Répartition par Entité
            </h3>
            <div style={{ width: '100%', height: 300 }}>
              {totalExpense === 0 ? (
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%', color: 'var(--text-muted)' }}>Aucune donnée.</div>
              ) : (
                <ResponsiveContainer>
                  <PieChart>
                    <Pie data={entityData} cx="50%" cy="50%" innerRadius={60} outerRadius={100} paddingAngle={2} dataKey="value" nameKey="name" label={({name, percent}) => `${name} (${(percent * 100).toFixed(0)}%)`}>
                      {entityData.map((entry, index) => (
                        <Cell key={`cell-${index}`} fill={entry.color} />
                      ))}
                    </Pie>
                    <RechartsTooltip formatter={(value) => formatAmount(value)} contentStyle={{ backgroundColor: 'var(--bg-app)', border: '1px solid var(--border)' }} />
                    <Legend />
                  </PieChart>
                </ResponsiveContainer>
              )}
            </div>
          </div>
        )}
      </div>

      {/* Timeline Bar Chart */}
      <div className="card">
        <h3 style={{ fontSize: '1rem', fontWeight: 600, marginBottom: '1.5rem' }}>Évolution Journalière des Dépenses</h3>
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
                {currentEntity === 'global' ? (
                  <>
                    <Bar dataKey="PN_Expense" name="Meiji PN" stackId="a" fill="#ef4444" />
                    <Bar dataKey="Brazza_Expense" name="Meiji Brazza" stackId="a" fill="#f97316" radius={[4, 4, 0, 0]} />
                  </>
                ) : (
                  <Bar dataKey="Expense" name="Dépenses" fill="var(--danger)" radius={[4, 4, 0, 0]} />
                )}
              </BarChart>
            </ResponsiveContainer>
          )}
        </div>
      </div>

      {/* Transactions Table */}
      <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
        <div className="flex justify-between items-center" style={{ padding: '1.25rem 1.5rem', borderBottom: '1px solid var(--border)' }}>
          <div className="flex items-center" style={{ gap: '1rem' }}>
            <h3 style={{ fontSize: '1rem', fontWeight: 600 }}>Liste des Dépenses ({txs.length})</h3>
            {selectedIds.length > 0 && (
              <button onClick={handleBulkDelete} className="btn" style={{ padding: '0.25rem 0.75rem', fontSize: '0.875rem', backgroundColor: 'var(--danger)', color: 'white' }}>
                <Trash2 size={14} style={{ marginRight: '0.25rem' }} /> Supprimer sélection ({selectedIds.length})
              </button>
            )}
          </div>
        </div>
        <div className="table-container" style={{ maxHeight: '500px', overflowY: 'auto' }}>
          <table className="data-table">
            <thead><tr><th style={{ width: '40px', textAlign: 'center' }}><input type="checkbox" onChange={handleSelectAll} checked={txs.length > 0 && selectedIds.length === txs.length} /></th><th>Date</th><th>Entité</th><th>Catégorie</th><th>Mode de paiement</th><th>Description</th><th style={{ textAlign: 'right' }}>Montant</th><th style={{ textAlign: 'center', width: '50px' }}>Action</th></tr></thead>
            <tbody>
              {txs.length === 0 ? (
                <tr><td colSpan="8" style={{ textAlign: 'center', padding: '3rem', color: 'var(--text-muted)' }}>Aucune dépense pour cette période.</td></tr>
              ) : txs.sort((a, b) => b.date.localeCompare(a.date)).map(tx => (
                <tr key={tx.id} style={selectedIds.includes(tx.id) ? { backgroundColor: 'var(--bg-app)' } : {}}>
                  <td style={{ textAlign: 'center' }}><input type="checkbox" checked={selectedIds.includes(tx.id)} onChange={() => handleSelectOne(tx.id)} /></td>
                  <td style={{ whiteSpace: 'nowrap' }}>{tx.date}</td>
                  <td><span style={{ fontSize: '0.75rem', padding: '0.2rem 0.5rem', backgroundColor: tx.entityId === 'pn' ? 'rgba(59,130,246,0.1)' : 'rgba(139,92,246,0.1)', color: tx.entityId === 'pn' ? '#3b82f6' : '#8b5cf6', borderRadius: '4px', fontWeight: 600 }}>{tx.entityId === 'pn' ? 'PN' : 'Brazza'}</span></td>
                  <td>{tx.category}</td>
                  <td><span style={{ fontSize: '0.75rem', padding: '0.2rem 0.5rem', backgroundColor: 'var(--bg-app)', borderRadius: '4px' }}>{tx.account}</span></td>
                  <td>{tx.description}</td>
                  <td style={{ textAlign: 'right', fontWeight: 600, color: 'var(--danger)' }}>- {formatAmount(tx.amount)}</td>
                  <td style={{ textAlign: 'center' }}>
                    <button onClick={() => { if(window.confirm('Voulez-vous vraiment supprimer cette dépense ?')) deleteTransaction(tx.id); }} style={{ background: 'none', border: 'none', cursor: 'pointer', padding: '0.25rem', color: 'var(--danger)' }} title="Supprimer">
                      <Trash2 size={16} />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {selectedEntity && (
        <EntityDetailModal
          entityId={selectedEntity}
          entityName={selectedEntity === 'pn' ? 'Meiji PN' : 'Meiji Brazza'}
          entityColor={selectedEntity === 'pn' ? '#ef4444' : '#f97316'}
          txs={txs.filter(t => t.entityId === selectedEntity)}
          formatAmount={formatAmount}
          onClose={() => setSelectedEntity(null)}
        />
      )}

      {showAddModal && (
        <AddExpenseModal
          onClose={() => setShowAddModal(false)}
          onSubmit={handleAddExpense}
          categories={categories}
          isLoading={isLoading}
        />
      )}
    </div>
  );
}
