// « Prendre des bénéfices » on one caisse: the amount, the till or account it leaves, the day. On the common caisse
// (Réservation de séance) the amount is shared in two halves, one per associé. It is no expense: the club's result
// does not change, but the till holds less. The server refuses more than the caisse holds.
import { useState } from 'react';
import { Modal } from '../ui/Modal.jsx';
import { FormError } from '../ui/ui.jsx';
import { toast } from '../ui/toast.jsx';
import { api, newKey } from '../../lib/api.js';
import { bizToday, money, parseMoney } from '../../lib/format.js';
import { useSubmit } from '../../lib/hooks.js';
import { useStore } from '../../store/useStore.js';
import { CAISSE_LABEL, splitHalves } from '../../../shared/caisses.js';

export default function ProfitDialog({ close, account, balance, onDone }) {
  const methods = useStore((s) => s.settings.payment_methods);
  const currency = useStore((s) => s.settings.currency.label);
  const today = bizToday();
  const [key] = useState(newKey);
  const [v, setV] = useState({ biz_date: today, amount: '', method: methods[0] ?? '', label: '' });
  const { busy, error, submit } = useSubmit();
  const set = (k) => (e) => setV({ ...v, [k]: e.target.value });
  const amount = parseMoney(v.amount);
  const name = CAISSE_LABEL[account];

  const onSubmit = (e) => {
    e.preventDefault();
    submit(async () => {
      if (!amount) throw new Error('Montant invalide : saisissez un nombre positif (exemple : 25 000).');
      if (amount > balance) throw new Error(`La caisse « ${name} » ne contient que ${money(balance)}.`);
      const res = await api.post('/api/caisses/retrait', { account, amount, method: v.method, biz_date: v.biz_date, label: v.label }, key);
      close();
      toast('Bénéfices pris.');
      onDone?.(res);
    });
  };

  return (
    <Modal title="Prendre des bénéfices" onClose={close}>
      <form className="form-grid" onSubmit={onSubmit} noValidate>
        <p>Caisse « {name} » : <strong className="num nowrap">{money(balance)}</strong> disponibles.</p>
        <label className="field"><span>Date de l’opération</span>
          <input type="date" value={v.biz_date} max={today} required onChange={set('biz_date')} />
          <span className="help">Une date située dans un mois clôturé est refusée.</span></label>
        <label className="field"><span>Montant ({currency})</span>
          <input inputMode="decimal" autoComplete="off" placeholder="25 000" required value={v.amount} onChange={set('amount')} />
          {account === 'reservations' && amount > 0 && <span className="help">soit {money(splitHalves(amount).cigares)} pour chaque associé</span>}</label>
        <label className="field"><span>Payé depuis</span>
          <select value={v.method} onChange={set('method')}>
            {methods.map((m) => <option key={m} value={m}>{m}</option>)}
          </select></label>
        <label className="field"><span>Libellé</span>
          <input maxLength={120} placeholder={`Prise de bénéfices — ${name}`} value={v.label} onChange={set('label')} />
          <span className="help">Facultatif.</span></label>
        <p className="subtle">L’argent sort de la caisse « {name} » et du solde en caisse. Ce n’est pas une dépense : le résultat du club ne change pas.</p>
        <FormError error={error} />
        <div className="modal-actions">
          <button type="button" className="btn" onClick={close}>Annuler</button>
          <button type="submit" className="btn btn-primary" disabled={busy} aria-busy={busy}>Prendre les bénéfices</button>
        </div>
      </form>
    </Modal>
  );
}
