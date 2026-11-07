// Records what raises the debt to a supplier: a credit purchase, or the balance already owed before the application
// (« Solde reporté »). No money moves: no caisse and no till change. The amount in euros or dollars is for information.
import { useState } from 'react';
import { Modal } from '../ui/Modal.jsx';
import { FormError, Segmented } from '../ui/ui.jsx';
import { toast } from '../ui/toast.jsx';
import { api, newKey } from '../../lib/api.js';
import { bizToday, parseMoney } from '../../lib/format.js';
import { useSubmit } from '../../lib/hooks.js';
import { useStore } from '../../store/useStore.js';
import { FOREIGN_CURRENCIES, FOREIGN_SYMBOL, PURCHASE_KIND_LABEL } from '../../../shared/suppliers.js';

export function ForeignFields({ amount, currency, onAmount, onCurrency }) {
  return (
    <div className="form-row">
      <label className="field"><span>Montant en devise (facultatif)</span>
        <input inputMode="decimal" autoComplete="off" placeholder="1 250" value={amount} onChange={(e) => onAmount(e.target.value)} />
        <span className="help">Pour information seulement : il ne compte dans aucun calcul.</span></label>
      <label className="field"><span>Devise</span>
        <select value={currency} onChange={(e) => onCurrency(e.target.value)}>
          {FOREIGN_CURRENCIES.map((c) => <option key={c} value={c}>{c} ({FOREIGN_SYMBOL[c]})</option>)}
        </select></label>
    </div>
  );
}

// The amount in euros or dollars as the server takes it: both fields or neither.
export function foreignBody(amount, currency) {
  if (!String(amount ?? '').trim()) return {};
  const minor = parseMoney(amount);
  if (!minor) throw new Error('Montant en devise invalide : saisissez un nombre positif (exemple : 1 250).');
  return { foreign_amount: minor, foreign_currency: currency };
}

export default function PurchaseDialog({ close, supplier, onDone }) {
  const currencyLabel = useStore((s) => s.settings.currency.label);
  const today = bizToday();
  const [key] = useState(newKey);
  const [v, setV] = useState({
    kind: 'achat', biz_date: today, amount: '', foreign_amount: '', foreign_currency: supplier.currency ?? 'EUR', reference: '', label: '',
  });
  const { busy, error, submit } = useSubmit();
  const set = (k) => (e) => setV({ ...v, [k]: e.target.value });

  const onSubmit = (e) => {
    e.preventDefault();
    submit(async () => {
      const amount = parseMoney(v.amount);
      if (!amount) throw new Error('Montant invalide : saisissez un nombre positif (exemple : 450 000).');
      const body = {
        kind: v.kind, biz_date: v.biz_date, amount, reference: v.reference, label: v.label,
        ...foreignBody(v.foreign_amount, v.foreign_currency),
      };
      const sheet = await api.post(`/api/suppliers/${supplier.id}/purchases`, body, key);
      close();
      toast(v.kind === 'report' ? 'Solde reporté enregistré.' : 'Achat enregistré.');
      onDone?.(sheet);
    });
  };

  return (
    <Modal title={`Ce que le club doit à ${supplier.name}`} onClose={close}>
      <form className="form-grid" onSubmit={onSubmit} noValidate>
        <Segmented
          label="Type d’opération"
          value={v.kind}
          onChange={(kind) => setV({ ...v, kind })}
          options={[['achat', 'Achat à crédit'], ['report', PURCHASE_KIND_LABEL.report]]}
        />
        <p className="subtle">{v.kind === 'report'
          ? 'Ce que le club devait déjà à ce fournisseur avant d’utiliser l’application.'
          : 'Une marchandise reçue et pas encore payée.'} Aucun argent ne sort : seule la dette envers ce fournisseur augmente.</p>
        <label className="field"><span>Date</span>
          <input type="date" value={v.biz_date} max={today} required onChange={set('biz_date')} /></label>
        <label className="field"><span>Montant ({currencyLabel})</span>
          <input inputMode="decimal" autoComplete="off" placeholder="450 000" required value={v.amount} onChange={set('amount')} /></label>
        <ForeignFields
          amount={v.foreign_amount} currency={v.foreign_currency}
          onAmount={(foreign_amount) => setV({ ...v, foreign_amount })} onCurrency={(foreign_currency) => setV({ ...v, foreign_currency })}
        />
        <label className="field"><span>N° de facture</span>
          <input maxLength={80} placeholder="Facultatif" value={v.reference} onChange={set('reference')} /></label>
        <label className="field"><span>Libellé</span>
          <input maxLength={120} placeholder={PURCHASE_KIND_LABEL[v.kind]} value={v.label} onChange={set('label')} />
          <span className="help">Facultatif : exemple « Robustos et coronas ».</span></label>
        <FormError error={error} />
        <div className="modal-actions">
          <button type="button" className="btn" onClick={close}>Annuler</button>
          <button type="submit" className="btn btn-primary" disabled={busy} aria-busy={busy}>Enregistrer</button>
        </div>
      </form>
    </Modal>
  );
}
