import { useState } from 'react';
import { useStore } from '../store/useStore';
import { Plus, Edit2, Trash2, Tag } from 'lucide-react';

export default function Categories() {
  const { categories, addCategory, updateCategory, deleteCategory, isLoading } = useStore();
  const [showModal, setShowModal] = useState(false);
  const [editingCat, setEditingCat] = useState(null);
  const [formData, setFormData] = useState({ name: '', type: 'income' });

  const handleOpenModal = (cat = null) => {
    if (cat) { setEditingCat(cat.id); setFormData({ name: cat.name, type: cat.type }); }
    else { setEditingCat(null); setFormData({ name: '', type: 'income' }); }
    setShowModal(true);
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (editingCat) await updateCategory(editingCat, formData);
    else await addCategory(formData);
    setShowModal(false);
  };

  const handleDelete = async (id) => {
    if (window.confirm("Êtes-vous sûr de vouloir supprimer cette catégorie ?")) await deleteCategory(id);
  };

  return (
    <div className="flex-col gap-6" style={{ display: 'flex' }}>
      <div className="flex justify-between items-center">
        <div>
          <h2 style={{ fontSize: '1.5rem', fontWeight: 700 }}>Catégories Comptables</h2>
          <p style={{ color: 'var(--text-muted)' }}>Gérez votre plan comptable simplifié (Recettes et Dépenses).</p>
        </div>
        <button className="btn btn-primary" onClick={() => handleOpenModal()} disabled={isLoading}>
          <Plus size={18} /> Nouvelle Catégorie
        </button>
      </div>

      <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
        <div className="table-container">
          <table className="data-table">
            <thead><tr><th>Nom de la catégorie</th><th>Type d'opération</th><th style={{ textAlign: 'right' }}>Actions</th></tr></thead>
            <tbody>
              {categories.length === 0 ? (
                <tr><td colSpan="3" style={{ textAlign: 'center', padding: '3rem', color: 'var(--text-muted)' }}>Aucune catégorie.</td></tr>
              ) : categories.map(cat => (
                <tr key={cat.id}>
                  <td style={{ fontWeight: 500 }}><div className="flex items-center gap-2"><Tag size={16} color="var(--text-muted)" />{cat.name}</div></td>
                  <td><span className={`badge ${cat.type === 'income' ? 'badge-success' : 'badge-danger'}`}>{cat.type === 'income' ? 'Recette (AR)' : 'Dépense (AP)'}</span></td>
                  <td style={{ textAlign: 'right' }}>
                    <button className="btn btn-outline" style={{ padding: '0.25rem 0.5rem', marginRight: '0.5rem' }} onClick={() => handleOpenModal(cat)}><Edit2 size={14} /></button>
                    <button className="btn btn-danger" style={{ padding: '0.25rem 0.5rem' }} onClick={() => handleDelete(cat.id)}><Trash2 size={14} /></button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {showModal && (
        <div style={{ position: 'fixed', inset: 0, backgroundColor: 'rgba(0,0,0,0.5)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000 }}>
          <div className="card" style={{ width: '100%', maxWidth: '400px' }}>
            <h3 style={{ fontSize: '1.25rem', fontWeight: 600, marginBottom: '1.5rem' }}>{editingCat ? 'Modifier la catégorie' : 'Nouvelle catégorie'}</h3>
            <form onSubmit={handleSubmit}>
              <div className="form-group">
                <label className="form-label">Nom de la catégorie</label>
                <input type="text" className="form-input" required value={formData.name} onChange={e => setFormData({...formData, name: e.target.value})} placeholder="Ex: Achat Boissons" />
              </div>
              <div className="form-group">
                <label className="form-label">Type</label>
                <select className="form-input" value={formData.type} onChange={e => setFormData({...formData, type: e.target.value})}>
                  <option value="income">Recette (Entrée d'argent)</option>
                  <option value="expense">Dépense (Sortie d'argent)</option>
                </select>
              </div>
              <div className="flex justify-between" style={{ marginTop: '2rem' }}>
                <button type="button" className="btn btn-outline" onClick={() => setShowModal(false)} disabled={isLoading}>Annuler</button>
                <button type="submit" className="btn btn-primary" disabled={isLoading}>{isLoading ? 'Sauvegarde...' : 'Sauvegarder'}</button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
