// The dialog that records a ledger entry: an expense (the manager's, capped, or the administrator's), and for
// administrators an other receipt or a transfer between treasury accounts.
import { useState } from 'react';
import { Modal } from '../ui/Modal.jsx';
import { FormError, Notice } from '../ui/ui.jsx';
import { toast } from '../ui/toast.jsx';
import { api, newKey } from '../../lib/api.js';
import { ACCOUNT_LABEL, bizToday, dayLabel, parseMoney } from '../../lib/format.js';
import { useSubmit } from '../../lib/hooks.js';
import { useIsAdmin, useStore } from '../../store/useStore.js';

const TITLES = { depense: 'Nouvelle dépense', recette: 'Entrée diverse', transfert: 'Transfert entre comptes' };
const DONE = { depense: 'Dépense enregistrée.', recette: 'Entrée enregistrée.', transfert: 'Transfert enregistré.' };

// The largest expense a manager records alone, in hundredths; the server refuses more (MANAGER_EXPENSE_MAX, worker/ledger.js).
export const MANAGER_EXPENSE_MAX = 5000 * 100;
export const MANAGER_CAP_TEXT = 'Le gérant enregistre des dépenses de 5 000 FCFA au plus. Au-delà, adressez-vous à un administrateur.';

export default function EntryDialog({ close, kind, categories, onDone }) {
  const methods = useStore((s) => s.settings.payment_methods);
  const currency = useStore((s) => s.settings.currency.label);
  const isAdmin = useIsAdmin();
  const today = bizToday();
  const [key] = useState(newKey);
  const options = categories.filter((c) => c.kind === kind && c.active);
  const [v, setV] = useState({
    biz_date: today, category_id: options[0]?.id ?? '', amount: '', method: methods[0] ?? '',
    to_method: methods.find((m) => m !== methods[0]) ?? '', account: '', label: '', reference: '',
  });
  const { busy, error, submit } = useSubmit();
  const set = (k) => (e) => setV({ ...v, [k]: e.target.value });
  const category = options.find((c) => String(c.id) === String(v.category_id));
  const managerCapped = !isAdmin && kind === 'depense';

  const onSubmit = (e) => {
    e.preventDefault();
    submit(async () => {
      const amount = parseMoney(v.amount);
      if (!amount) throw new Error('Montant invalide : saisissez un nombre positif (exemple : 25 000).');
      if (managerCapped && amount > MANAGER_EXPENSE_MAX) throw new Error(MANAGER_CAP_TEXT);
      const body = { kind, amount, method: v.method, label: v.label, reference: v.reference };
      if (isAdmin) body.biz_date = v.biz_date;
      if (kind === 'transfert') {
        if (v.to_method === v.method) throw new Error('Choisissez deux comptes différents.');
        body.to_method = v.to_method;
      } else {
        if (!category) throw new Error('Choisissez une catégorie.');
        body.category_id = category.id;
        if (kind === 'depense') body.account = v.account || null;
      }
      const entry = await api.post('/api/ledger/entries', body, key);
      close();
      toast(DONE[kind]);
      onDone?.(entry);
    });
  };

  return (
    <Modal title={TITLES[kind]} onClose={close}>
      <form className="form-grid" onSubmit={onSubmit} noValidate>
        {isAdmin ? (
          <label className="field"><span>Date de l’opération</span>
            <input type="date" value={v.biz_date} max={today} required onChange={set('biz_date')} />
            <span className="help">Une date située dans un mois clôturé est refusée.</span></label>
        ) : (
          <p className="subtle">Date : {dayLabel(today)} (dépenses du jour).</p>
        )}
        {kind !== 'transfert' && (options.length ? (
          <label className="field"><span>Catégorie</span>
            <select value={v.category_id} onChange={set('category_id')}>
              {options.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select></label>
        ) : (
          <Notice kind="warn">Aucune catégorie active. Un administrateur peut en créer dans Paramètres, rubrique Catégories.</Notice>
        ))}
        <label className="field"><span>Montant ({currency})</span>
          <input inputMode="decimal" autoComplete="off" placeholder={managerCapped ? '5 000' : '25 000'} required value={v.amount} onChange={set('amount')} />
          {managerCapped && <span className="help">5 000 {currency} au plus par dépense. Au-delà, un administrateur l’enregistre.</span>}</label>
        <div className="form-row">
          <label className="field"><span>{kind === 'depense' ? 'Payé depuis' : kind === 'recette' ? 'Reçu sur' : 'Depuis'}</span>
            <select value={v.method} onChange={set('method')}>
              {methods.map((m) => <option key={m} value={m}>{m}</option>)}
            </select></label>
          {kind === 'transfert' && (
            <label className="field"><span>Vers</span>
              <select value={v.to_method} onChange={set('to_method')}>
                {methods.filter((m) => m !== v.method).map((m) => <option key={m} value={m}>{m}</option>)}
              </select></label>
          )}
          {kind === 'depense' && (
            <label className="field"><span>Sous-compte concerné</span>
              <select value={v.account} onChange={set('account')}>
                <option value="">Frais généraux</option>
                {Object.entries(ACCOUNT_LABEL).map(([k, label]) => <option key={k} value={k}>{label}</option>)}
              </select></label>
          )}
        </div>
        {kind === 'depense' && (
          <p className="subtle">Affecter un achat de cigares ou de boissons à son sous-compte permet d’en suivre la marge.</p>
        )}
        <label className="field"><span>Libellé</span>
          <input maxLength={120} placeholder={kind === 'transfert' ? 'Dépôt en banque' : (category?.name ?? '')} value={v.label} onChange={set('label')} />
          <span className="help">Facultatif : {kind === 'transfert' ? 'les deux comptes sont indiqués par défaut.' : 'le nom de la catégorie est utilisé par défaut.'}</span></label>
        <label className="field"><span>Référence</span>
          <input maxLength={80} placeholder="N° de facture, de reçu ou de transaction" value={v.reference} onChange={set('reference')} /></label>
        <FormError error={error} />
        <div className="modal-actions">
          <button type="button" className="btn" onClick={close}>Annuler</button>
          <button type="submit" className="btn btn-primary" disabled={busy || (kind !== 'transfert' && !options.length)} aria-busy={busy}>Enregistrer</button>
        </div>
      </form>
    </Modal>
  );
}
