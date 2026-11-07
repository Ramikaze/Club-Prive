// The supplier's sheet as a form, to create or edit: name, caisse, country, information currency, contact, notes.
// A supplier belongs to one caisse and is paid from it alone; the caisse no longer changes once it has an operation.
import { useState } from 'react';
import { Modal } from '../ui/Modal.jsx';
import { FormError } from '../ui/ui.jsx';
import { toast } from '../ui/toast.jsx';
import { api, newKey } from '../../lib/api.js';
import { useSubmit } from '../../lib/hooks.js';
import { CAISSE_LABEL } from '../../../shared/caisses.js';
import { FOREIGN_CURRENCIES, FOREIGN_LABEL, SUPPLIER_CAISSES } from '../../../shared/suppliers.js';

export default function SupplierDialog({ close, supplier = null, onDone }) {
  const [key] = useState(newKey);
  const [v, setV] = useState({
    name: supplier?.name ?? '', account: supplier?.account ?? 'cigares', country: supplier?.country ?? '',
    currency: supplier?.currency ?? '', contact: supplier?.contact ?? '', notes: supplier?.notes ?? '',
  });
  const { busy, error, submit } = useSubmit();
  const set = (k) => (e) => setV({ ...v, [k]: e.target.value });
  const locked = !!supplier?.has_operations;

  const onSubmit = (e) => {
    e.preventDefault();
    submit(async () => {
      if (!v.name.trim()) throw new Error('Indiquez le nom du fournisseur.');
      const body = { ...v, currency: v.currency || null };
      const saved = supplier ? await api.put(`/api/suppliers/${supplier.id}`, body, key) : await api.post('/api/suppliers', body, key);
      close();
      toast(supplier ? 'Fournisseur modifié.' : 'Fournisseur créé.');
      onDone?.(saved);
    });
  };

  return (
    <Modal title={supplier ? 'Modifier le fournisseur' : 'Nouveau fournisseur'} onClose={close}>
      <form className="form-grid" onSubmit={onSubmit} noValidate>
        <label className="field"><span>Nom</span>
          <input maxLength={80} required autoComplete="off" value={v.name} onChange={set('name')} /></label>
        <label className="field"><span>Caisse qui le paie</span>
          <select value={v.account} onChange={set('account')} disabled={locked}>
            {SUPPLIER_CAISSES.map((a) => <option key={a} value={a}>{CAISSE_LABEL[a]}</option>)}
          </select>
          <span className="help">{locked
            ? 'Ce fournisseur a déjà des opérations : sa caisse ne se change plus.'
            : 'Il sera payé seulement depuis cette caisse.'}</span></label>
        <div className="form-row">
          <label className="field"><span>Pays ou ville</span>
            <input maxLength={60} placeholder="Espagne, Liban…" value={v.country} onChange={set('country')} /></label>
          <label className="field"><span>Devise de ses factures</span>
            <select value={v.currency} onChange={set('currency')}>
              <option value="">Aucune (FCFA seulement)</option>
              {FOREIGN_CURRENCIES.map((c) => <option key={c} value={c}>{FOREIGN_LABEL[c]}</option>)}
            </select></label>
        </div>
        <p className="subtle">Le compte reste tenu en FCFA. Le montant en devise s’affiche entre parenthèses, pour information.</p>
        <label className="field"><span>Contact</span>
          <input maxLength={120} placeholder="Nom, téléphone ou e-mail" value={v.contact} onChange={set('contact')} /></label>
        <label className="field"><span>Notes</span>
          <textarea maxLength={300} value={v.notes} onChange={set('notes')} /></label>
        <FormError error={error} />
        <div className="modal-actions">
          <button type="button" className="btn" onClick={close}>Annuler</button>
          <button type="submit" className="btn btn-primary" disabled={busy} aria-busy={busy}>Enregistrer</button>
        </div>
      </form>
    </Modal>
  );
}
