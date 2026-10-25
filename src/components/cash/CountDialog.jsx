// « Compter la caisse » (administrators, from « Soldes »). With no cash fund yet, it asks what each till and account
// holds today and records that as the fund (POST /api/treasury/fund: the opening balances dated today). Once a fund
// exists, it compares what was counted on one account with the balance the books expect and records the gap
// (POST /api/treasury/count): a surplus as an other receipt, a shortage as an expense, both « Écart de caisse ». The
// server computes the expected balance itself; the one shown here is only a preview.
import { useState } from 'react';
import { Modal } from '../ui/Modal.jsx';
import { FormError, Loaded } from '../ui/ui.jsx';
import { toast } from '../ui/toast.jsx';
import { api, newKey, qs } from '../../lib/api.js';
import { bizToday, money, parseMoney } from '../../lib/format.js';
import { useLoad, useSubmit } from '../../lib/hooks.js';
import { useStore } from '../../store/useStore.js';
import { CARD_METHOD } from '../../../shared/rules.js';

const CASH = 'Espèces';

// The club's tills and accounts, Espèces first; the card's credit is no till.
const tills = (methods) => {
  const list = methods.filter((m) => m !== CARD_METHOD);
  return list.includes(CASH) ? [CASH, ...list.filter((m) => m !== CASH)] : list;
};

// « +5 000 FCFA (surplus) », « −5 000 FCFA (manque) », « aucun écart ».
export const gapText = (gap) => (gap === 0 ? 'aucun écart' : `${gap > 0 ? '+' : '−'}${money(Math.abs(gap))} (${gap > 0 ? 'surplus' : 'manque'})`);

export default function CountDialog({ close, method, onDone }) {
  const settings = useStore((s) => s.settings);
  const ob = settings.opening_balances ?? { date: null, amounts: {} };
  const hasFund = !!ob.date || Object.keys(ob.amounts ?? {}).length > 0;
  const today = bizToday();
  // Today's balances: what the books expect, and whether anything moved before today.
  const state = useLoad(() => api.get(`/api/treasury${qs({ from: today, to: today })}`), [today]);
  return (
    <Modal title={hasFund ? 'Compter la caisse' : 'Fond de caisse de départ'} onClose={close}>
      <Loaded state={state}>{(t) => (hasFund
        ? <CountForm close={close} t={t} methods={tills(settings.payment_methods)} initial={method} currency={settings.currency.label} onDone={onDone} />
        : <FundForm close={close} t={t} methods={tills(settings.payment_methods)} currency={settings.currency.label} onDone={onDone} />
      )}</Loaded>
    </Modal>
  );
}

function FundForm({ close, t, methods, currency, onDone }) {
  const setBundle = useStore((s) => s.setBundle);
  const [key] = useState(newKey);
  const [v, setV] = useState({});
  const { busy, error, submit } = useSubmit();
  // Dated today, the fund leaves out what moved before: worth saying only when something did.
  const earlier = t.accounts.some((a) => a.opening !== 0);

  const onSubmit = (e) => {
    e.preventDefault();
    submit(async () => {
      const amounts = {};
      for (const m of methods) {
        const raw = String(v[m] ?? '').trim();
        if (raw === '') continue;
        const amount = parseMoney(raw);
        if (amount === null) throw new Error(`${m} : montant invalide (exemple : 25 000).`);
        amounts[m] = amount;
      }
      const res = await api.post('/api/treasury/fund', { amounts }, key);
      setBundle(res.bundle);
      close();
      toast('Fond de caisse enregistré.');
      onDone?.();
    });
  };

  return (
    <form className="form-grid" onSubmit={onSubmit} noValidate>
      <p>Combien y a-t-il dans chaque caisse et compte aujourd’hui ?</p>
      <div className="form-row">{methods.map((m) => (
        <label key={m} className="field"><span>{m} ({currency})</span>
          <input inputMode="decimal" autoComplete="off" placeholder="0" value={v[m] ?? ''} onChange={(e) => setV({ ...v, [m]: e.target.value })} /></label>
      ))}</div>
      <p className="subtle">Laissez vide une caisse ou un compte vide : il compte pour 0.</p>
      {earlier && <p className="subtle">Les mouvements d’avant aujourd’hui ne seront plus comptés dans les soldes.</p>}
      <FormError error={error} />
      <div className="modal-actions">
        <button type="button" className="btn" onClick={close}>Annuler</button>
        <button type="submit" className="btn btn-primary" disabled={busy} aria-busy={busy}>Enregistrer</button>
      </div>
    </form>
  );
}

function CountForm({ close, t, methods, initial, currency, onDone }) {
  const [key] = useState(newKey);
  const [v, setV] = useState({
    method: methods.includes(initial) ? initial : (methods.includes(CASH) ? CASH : methods[0] ?? ''), counted: '', reason: '',
  });
  const { busy, error, submit } = useSubmit();
  const set = (k) => (e) => setV({ ...v, [k]: e.target.value });
  const expected = t.accounts.find((a) => a.method === v.method)?.closing ?? 0;
  const counted = parseMoney(v.counted);

  const onSubmit = (e) => {
    e.preventDefault();
    submit(async () => {
      if (counted === null) throw new Error('Montant compté invalide : saisissez un nombre (exemple : 25 000).');
      const res = await api.post('/api/treasury/count', { method: v.method, counted, reason: v.reason }, key);
      close();
      toast(res.gap === 0 ? 'Caisse juste : aucun écart.' : `Écart enregistré : ${gapText(res.gap)}.`);
      onDone?.(res);
    });
  };

  return (
    <form className="form-grid" onSubmit={onSubmit} noValidate>
      <label className="field"><span>Caisse ou compte</span>
        <select value={v.method} onChange={set('method')}>
          {methods.map((m) => <option key={m} value={m}>{m}</option>)}
        </select></label>
      <p>Solde attendu : <strong>{money(expected)}</strong></p>
      <label className="field"><span>Montant compté ({currency})</span>
        <input inputMode="decimal" autoComplete="off" placeholder="0" required value={v.counted} onChange={set('counted')} />
        <span className="help">Ce qu’il y a vraiment dans la caisse ou sur le compte maintenant.</span></label>
      {counted !== null && (
        <p aria-live="polite">Écart : <strong className={counted > expected ? 'amount-in' : counted < expected ? 'amount-out' : undefined}>{gapText(counted - expected)}</strong></p>
      )}
      <label className="field"><span>Motif</span>
        <input maxLength={120} placeholder="Comptage de caisse" value={v.reason} onChange={set('reason')} />
        <span className="help">Facultatif. Un écart est enregistré dans « Écart de caisse » : en recette s’il y a plus, en dépense s’il manque.</span></label>
      <FormError error={error} />
      <div className="modal-actions">
        <button type="button" className="btn" onClick={close}>Annuler</button>
        <button type="submit" className="btn btn-primary" disabled={busy} aria-busy={busy}>Enregistrer</button>
      </div>
    </form>
  );
}
