import { useState } from 'react';
import { useStore } from '../store/useStore';
import { Lock, CheckCircle2, AlertTriangle, FileCheck } from 'lucide-react';

export default function FinancialClose() {
  const { closedPeriods, closePeriod } = useStore();
  const [periodToClose, setPeriodToClose] = useState('');

  const handleClose = () => {
    if (!periodToClose) return;
    if (closedPeriods.includes(periodToClose)) {
      alert("Cette période est déjà clôturée.");
      return;
    }
    
    // Simulate reconciliation checks
    const confirmClose = window.confirm(
      `Attention: Clôturer la période \${periodToClose} va verrouiller définitivement toutes les transactions de ce mois. Voulez-vous continuer ?`
    );
    
    if (confirmClose) {
      closePeriod(periodToClose);
      setPeriodToClose('');
    }
  };

  return (
    <div className="flex-col gap-6" style={{ display: 'flex', maxWidth: '800px', margin: '0 auto' }}>
      <div>
        <h2 style={{ fontSize: '1.5rem', fontWeight: 700 }}>Clôture Financière (Financial Close)</h2>
        <p style={{ color: 'var(--text-muted)' }}>Verrouillez vos périodes comptables pour garantir l'intégrité de vos rapports.</p>
      </div>

      <div className="card flex-col gap-6" style={{ display: 'flex' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '1rem', backgroundColor: 'var(--warning-bg)', padding: '1rem', borderRadius: '0.5rem', color: '#b45309' }}>
          <AlertTriangle size={24} />
          <p style={{ fontSize: '0.875rem', fontWeight: 500 }}>
            Une période clôturée empêche la création, modification ou suppression de toute transaction dans le Grand Livre pour le mois concerné. (Fonctionnalité clé d'auditabilité type Sage Intacct).
          </p>
        </div>

        <div>
          <h3 style={{ fontSize: '1.125rem', fontWeight: 600, marginBottom: '1rem' }}>Périodes actuellement clôturées</h3>
          {closedPeriods.length === 0 ? (
            <p style={{ color: 'var(--text-muted)' }}>Aucune période clôturée.</p>
          ) : (
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.5rem' }}>
              {closedPeriods.map(p => (
                <div key={p} className="badge" style={{ backgroundColor: 'var(--bg-app)', border: '1px solid var(--border)', padding: '0.5rem 1rem', display: 'flex', alignItems: 'center', gap: '0.5rem', fontSize: '0.875rem', color: 'var(--text-main)' }}>
                  <Lock size={14} color="var(--danger)" />
                  Mois : {p}
                </div>
              ))}
            </div>
          )}
        </div>

        <div style={{ borderTop: '1px solid var(--border)', paddingTop: '1.5rem' }}>
          <h3 style={{ fontSize: '1.125rem', fontWeight: 600, marginBottom: '1rem' }}>Checklist de Clôture</h3>
          
          <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem', marginBottom: '2rem' }}>
            <div className="flex items-center gap-4">
              <CheckCircle2 color="var(--success)" />
              <span style={{ fontWeight: 500 }}>Rapprochement Bancaire (Bank Reconciliation) effectué</span>
            </div>
            <div className="flex items-center gap-4">
              <CheckCircle2 color="var(--success)" />
              <span style={{ fontWeight: 500 }}>Comptage des espèces validé</span>
            </div>
            <div className="flex items-center gap-4">
              <CheckCircle2 color="var(--success)" />
              <span style={{ fontWeight: 500 }}>Revenus Multi-Sociétés réconciliés</span>
            </div>
          </div>

          <div style={{ display: 'flex', gap: '1rem', alignItems: 'flex-end' }}>
            <div className="form-group" style={{ marginBottom: 0, flex: 1 }}>
              <label className="form-label">Mois à clôturer (YYYY-MM)</label>
              <input 
                type="month" 
                className="form-input" 
                value={periodToClose}
                onChange={e => setPeriodToClose(e.target.value)}
              />
            </div>
            <button 
              className="btn btn-danger" 
              onClick={handleClose}
              disabled={!periodToClose}
              style={{ opacity: !periodToClose ? 0.5 : 1 }}
            >
              <Lock size={18} /> Clôturer la période
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
