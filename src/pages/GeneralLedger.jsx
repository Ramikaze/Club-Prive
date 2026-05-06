import { useState } from 'react';
import { useStore, formatFCFA, formatUSD } from '../store/useStore';
import { Plus, Search, Filter, Loader2, Trash2 } from 'lucide-react';

export default function GeneralLedger() {
  const { getFilteredTransactions, addTransaction, deleteTransaction, deleteTransactions, currentEntity, isPeriodClosed, isLoading, usdRate, categories } = useStore();
  const transactions = getFilteredTransactions();
  
  const [sortConfig, setSortConfig] = useState({ key: 'date', direction: 'desc' });
  const [showModal, setShowModal] = useState(false);
  const [selectedIds, setSelectedIds] = useState([]);

  const handleSelectAll = (e) => {
    if (e.target.checked) {
      setSelectedIds(transactions.map(tx => tx.id));
    } else {
      setSelectedIds([]);
    }
  };

  const handleSelectOne = (id) => {
    setSelectedIds(prev => prev.includes(id) ? prev.filter(i => i !== id) : [...prev, id]);
  };

  const handleBulkDelete = async () => {
    if (window.confirm(`Voulez-vous vraiment supprimer les ${selectedIds.length} transactions sélectionnées ?`)) {
      await deleteTransactions(selectedIds);
      setSelectedIds([]);
    }
  };
  const [formData, setFormData] = useState({
    date: new Date().toISOString().split('T')[0],
    type: 'income',
    entityId: currentEntity === 'global' ? 'pn' : currentEntity,
    account: 'Espèces',
    category: '',
    department: '',
    amount: '',
    description: ''
  });

  const handleSubmit = async (e) => {
    e.preventDefault();
    
    // Soft Close Check
    if (isPeriodClosed(formData.date)) {
      const confirmOverride = window.confirm(
        "ATTENTION: Cette période comptable a été CLÔTURÉE.\n\nVoulez-vous quand même effectuer cette modification et impacter le Grand Livre ?"
      );
      if (!confirmOverride) return;
    }

    try {
      await addTransaction({
        ...formData,
        amount: Number(formData.amount)
      });
      setShowModal(false);
      
      // Reset form
      setFormData(prev => ({ ...prev, category: '', amount: '', description: '' }));
    } catch (err) {
      alert("Erreur lors de l'enregistrement : " + err.message);
    }
  };

  const handleSort = (key) => {
    let direction = 'asc';
    if (sortConfig.key === key && sortConfig.direction === 'asc') {
      direction = 'desc';
    }
    setSortConfig({ key, direction });
  };

  const sortedTransactions = [...transactions].sort((a, b) => {
    if (a[sortConfig.key] < b[sortConfig.key]) {
      return sortConfig.direction === 'asc' ? -1 : 1;
    }
    if (a[sortConfig.key] > b[sortConfig.key]) {
      return sortConfig.direction === 'asc' ? 1 : -1;
    }
    return 0;
  });

  const SortIcon = ({ columnKey }) => {
    if (sortConfig.key === columnKey) {
      return sortConfig.direction === 'asc' ? ' ↑' : ' ↓';
    }
    return ' ↕';
  };

  return (
    <div className="flex-col gap-6" style={{ display: 'flex' }}>
      <div className="flex justify-between items-center">
        <div>
          <h2 style={{ fontSize: '1.5rem', fontWeight: 700 }}>Grand Livre (General Ledger)</h2>
          <p style={{ color: 'var(--text-muted)' }}>Saisie et consultation comptable multi-dimensionnelle.</p>
        </div>
        <div className="flex" style={{ gap: '0.75rem' }}>
          {selectedIds.length > 0 && (
            <button onClick={handleBulkDelete} className="btn" style={{ backgroundColor: 'var(--danger)', color: 'white' }}>
              <Trash2 size={18} style={{ marginRight: '0.5rem' }} /> Supprimer sélection ({selectedIds.length})
            </button>
          )}
          <button className="btn btn-primary" onClick={() => setShowModal(true)}>
            <Plus size={18} /> Nouvelle Écriture
          </button>
        </div>
      </div>

      <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
        <div style={{ padding: '1rem 1.5rem', borderBottom: '1px solid var(--border)', display: 'flex', gap: '1rem' }}>
          <div className="flex items-center" style={{ border: '1px solid var(--border)', borderRadius: '0.5rem', padding: '0.5rem', flex: 1 }}>
            <Search size={18} color="var(--text-muted)" style={{ marginRight: '0.5rem' }} />
            <input type="text" placeholder="Rechercher par description, compte..." style={{ border: 'none', outline: 'none', width: '100%', backgroundColor: 'transparent' }} />
          </div>
          <button className="btn btn-outline">
            <Filter size={18} /> Filtrer les dimensions
          </button>
        </div>

        <div className="table-container">
          {isLoading ? (
            <div style={{ padding: '4rem', textAlign: 'center', color: 'var(--text-muted)' }}>
              <Loader2 className="animate-spin" size={32} style={{ margin: '0 auto', marginBottom: '1rem' }} />
              Chargement des écritures...
            </div>
          ) : (
            <table className="data-table">
              <thead>
                <tr>
                  <th style={{ width: '40px', textAlign: 'center' }}><input type="checkbox" onChange={handleSelectAll} checked={transactions.length > 0 && selectedIds.length === transactions.length} /></th>
                  <th onClick={() => handleSort('date')} style={{cursor: 'pointer'}}>Date<span style={{opacity: 0.5}}><SortIcon columnKey="date" /></span></th>
                  <th onClick={() => handleSort('type')} style={{cursor: 'pointer'}}>Type<span style={{opacity: 0.5}}><SortIcon columnKey="type" /></span></th>
                  <th onClick={() => handleSort('entityId')} style={{cursor: 'pointer'}}>Entité<span style={{opacity: 0.5}}><SortIcon columnKey="entityId" /></span></th>
                  <th onClick={() => handleSort('department')} style={{cursor: 'pointer'}}>Département<span style={{opacity: 0.5}}><SortIcon columnKey="department" /></span></th>
                  <th onClick={() => handleSort('category')} style={{cursor: 'pointer'}}>Catégorie<span style={{opacity: 0.5}}><SortIcon columnKey="category" /></span></th>
                  <th onClick={() => handleSort('account')} style={{cursor: 'pointer'}}>Trésorerie<span style={{opacity: 0.5}}><SortIcon columnKey="account" /></span></th>
                  <th onClick={() => handleSort('description')} style={{cursor: 'pointer'}}>Description<span style={{opacity: 0.5}}><SortIcon columnKey="description" /></span></th>
                  <th onClick={() => handleSort('amount')} style={{ textAlign: 'right', cursor: 'pointer' }}>Montant<span style={{opacity: 0.5}}><SortIcon columnKey="amount" /></span></th>
                  <th style={{ textAlign: 'center', width: '50px' }}>Action</th>
                </tr>
              </thead>
              <tbody>
                {sortedTransactions.length === 0 ? (
                  <tr>
                    <td colSpan="10" style={{ textAlign: 'center', padding: '3rem', color: 'var(--text-muted)' }}>
                      Aucune transaction trouvée pour cette entité.
                    </td>
                  </tr>
                ) : (
                  sortedTransactions.map(tx => (
                    <tr key={tx.id} style={selectedIds.includes(tx.id) ? { backgroundColor: 'var(--bg-app)' } : {}}>
                      <td style={{ textAlign: 'center' }}><input type="checkbox" checked={selectedIds.includes(tx.id)} onChange={() => handleSelectOne(tx.id)} /></td>
                      <td>{tx.date}</td>
                      <td>
                        <span className={`badge \${tx.type === 'income' ? 'badge-success' : 'badge-danger'}`}>
                          {tx.type === 'income' ? 'Recette' : 'Dépense'}
                        </span>
                      </td>
                      <td>
                        <span className="badge badge-primary">{tx.entityId.toUpperCase()}</span>
                      </td>
                      <td>{tx.department}</td>
                      <td>{tx.category}</td>
                      <td>{tx.account}</td>
                      <td>{tx.description}</td>
                      <td style={{ textAlign: 'right' }}>
                        <div style={{ fontWeight: 600, color: tx.type === 'income' ? 'var(--success)' : 'var(--danger)' }}>
                          {tx.type === 'income' ? '+' : '-'} {formatFCFA(tx.amount)}
                        </div>
                        <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>
                          {formatUSD(tx.amount, usdRate)}
                        </div>
                      </td>
                      <td style={{ textAlign: 'center' }}>
                        <button onClick={() => { if(window.confirm('Voulez-vous vraiment supprimer cette transaction ?')) deleteTransaction(tx.id); }} style={{ background: 'none', border: 'none', cursor: 'pointer', padding: '0.25rem', color: 'var(--danger)' }} title="Supprimer">
                          <Trash2 size={16} />
                        </button>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          )}
        </div>
      </div>

      {showModal && (
        <div style={{ position: 'fixed', inset: 0, backgroundColor: 'rgba(0,0,0,0.5)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000 }}>
          <div className="card" style={{ width: '100%', maxWidth: '600px' }}>
            <h3 style={{ fontSize: '1.25rem', fontWeight: 600, marginBottom: '1.5rem' }}>Nouvelle Écriture Comptable</h3>
            <form onSubmit={handleSubmit}>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem' }}>
                <div className="form-group">
                  <label className="form-label">Type</label>
                  <select className="form-input" value={formData.type} onChange={e => setFormData({...formData, type: e.target.value})}>
                    <option value="income">Recette (AR)</option>
                    <option value="expense">Dépense (AP)</option>
                  </select>
                </div>
                <div className="form-group">
                  <label className="form-label">Date Comptable</label>
                  <input type="date" className="form-input" required value={formData.date} onChange={e => setFormData({...formData, date: e.target.value})} />
                </div>
                
                {/* Dimensions */}
                <div className="form-group">
                  <label className="form-label">Location (Entité)</label>
                  <select className="form-input" value={formData.entityId} onChange={e => setFormData({...formData, entityId: e.target.value})}>
                    <option value="pn">Meiji PN</option>
                    <option value="brazza">Meiji Brazza</option>
                  </select>
                </div>
                <div className="form-group">
                  <label className="form-label">Département</label>
                  <select className="form-input" required value={formData.department} onChange={e => setFormData({...formData, department: e.target.value})}>
                    <option value="">Sélectionner...</option>
                    <option value="Cuisine">Cuisine</option>
                    <option value="Bar">Bar / Shisha</option>
                    <option value="Finance">Finance / Admin</option>
                    <option value="Opérations">Opérations</option>
                  </select>
                </div>

                <div className="form-group">
                  <label className="form-label">Compte de Trésorerie</label>
                  <select className="form-input" value={formData.account} onChange={e => setFormData({...formData, account: e.target.value})}>
                    <option value="Espèces">Espèces</option>
                    <option value="Banque">Banque</option>
                    <option value="MTN Momo">MTN Momo</option>
                    <option value="Airtel Money">Airtel Money</option>
                  </select>
                </div>
                <div className="form-group">
                  <label className="form-label">Compte GL (Catégorie)</label>
                  <select className="form-input" required value={formData.category} onChange={e => setFormData({...formData, category: e.target.value})}>
                    <option value="">Sélectionner une catégorie...</option>
                    {categories.filter(c => c.type === formData.type).map(cat => (
                      <option key={cat.id} value={cat.name}>{cat.name}</option>
                    ))}
                  </select>
                </div>
              </div>
              
              <div className="form-group" style={{ marginTop: '1rem' }}>
                <label className="form-label">Montant (FCFA)</label>
                <input type="number" min="0" className="form-input" required value={formData.amount} onChange={e => setFormData({...formData, amount: e.target.value})} />
                {formData.amount && (
                  <p style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>
                    Soit environ {formatUSD(Number(formData.amount), usdRate)}
                  </p>
                )}
              </div>
              <div className="form-group">
                <label className="form-label">Description (Memo)</label>
                <input type="text" className="form-input" required value={formData.description} onChange={e => setFormData({...formData, description: e.target.value})} />
              </div>

              <div className="flex justify-between" style={{ marginTop: '2rem' }}>
                <button type="button" className="btn btn-outline" onClick={() => setShowModal(false)} disabled={isLoading}>Annuler</button>
                <button type="submit" className="btn btn-primary" disabled={isLoading}>
                  {isLoading ? <Loader2 className="animate-spin" size={18} /> : "Enregistrer l'Écriture"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
