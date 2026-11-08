// « Compter la caisse » (club management, from « Soldes »; the cash fund form is the administrator's alone). With no cash fund yet, it asks what each till and account
// holds today and records that as the fund (POST /api/treasury/fund: the opening balances dated today). Once a fund
// exists, it shows every till and account one under the other (the cash counted note by note and coin by coin), compares
// what was counted on each with the balance the books expect and records each gap (POST /api/treasury/count, one per
// account filled in): a surplus as an other receipt, a shortage as an expense, both « Écart de caisse ». The server
// computes the expected balance itself; the one shown here is only a preview.
import { useState } from 'react';
import { Modal } from '../ui/Modal.jsx';
import { FormError, Loaded, Notice } from '../ui/ui.jsx';
import { toast } from '../ui/toast.jsx';
import { api, newKey, qs } from '../../lib/api.js';
import { bizToday, money, parseMoney } from '../../lib/format.js';
import { useLoad, useSubmit } from '../../lib/hooks.js';
import { useIsAdmin, useStore } from '../../store/useStore.js';
import { CARD_METHOD } from '../../../shared/rules.js';
import { DENOMINATIONS, cashTotal, lineAmount, parseCount } from './cashCount.js';

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
  const isAdmin = useIsAdmin();
  const today = bizToday();
  // Today's balances: what the books expect, and whether anything moved before today.
  const state = useLoad(() => api.get(`/api/treasury${qs({ from: today, to: today })}`), [today]);
  return (
    <Modal title={hasFund ? 'Compter la caisse' : 'Fond de caisse de départ'} onClose={close}>
      <Loaded state={state}>{(t) => (hasFund
        ? <CountForm close={close} t={t} methods={tills(settings.payment_methods)} initial={method} currency={settings.currency.label} onDone={onDone} />
        : isAdmin
          ? <FundForm close={close} t={t} methods={tills(settings.payment_methods)} currency={settings.currency.label} onDone={onDone} />
          : <NoFund close={close} />
      )}</Loaded>
    </Modal>
  );
}

// An associé cannot enter the fund (POST /api/treasury/fund is the administrator's alone).
function NoFund({ close }) {
  return (
    <div className="stack">
      <Notice kind="info">Le fond de caisse de départ n’est pas encore saisi. Demandez à l’administrateur de le saisir.</Notice>
      <div className="modal-actions"><button type="button" className="btn" onClick={close}>Fermer</button></div>
    </div>
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

// Every till and account at once, one under the other: the cash note by note and coin by coin, each other account by the
// balance it shows (MTN MoMo: the phone). Each shows its expected balance and its gap as it is typed. Only what was
// filled in is recorded, one count per account (POST /api/treasury/count), with the one motif. Each account keeps its
// own idempotency key: if one count fails, sending again does not record the others twice.
function CountForm({ close, t, methods, initial, currency, onDone }) {
  const [keys] = useState(() => Object.fromEntries(methods.map((m) => [m, newKey()])));
  const [cash, setCash] = useState({});
  const [other, setOther] = useState({});
  const [reason, setReason] = useState('');
  const { busy, error, submit } = useSubmit();
  const expectedOf = (m) => t.accounts.find((a) => a.method === m)?.closing ?? 0;
  const cashCount = cashTotal(cash);
  // What one account holds as typed so far; null while untouched or not a number.
  const countedOf = (m) => {
    if (m === CASH) return cashCount.filled && cashCount.invalid.length === 0 ? cashCount.total : null;
    return String(other[m] ?? '').trim() === '' ? null : parseMoney(other[m]);
  };
  // The field that takes the focus: the account the page was showing, else the first note.
  const first = methods.includes(initial) ? initial : methods[0];

  const onSubmit = (e) => {
    e.preventDefault();
    submit(async () => {
      const todo = [];
      for (const m of methods) {
        if (m === CASH) {
          if (!cashCount.filled) continue;
          if (cashCount.invalid.length) throw new Error(`${CASH} : nombre invalide sur la ligne ${cashCount.invalid.join(', ')} (un nombre entier, exemple : 12).`);
          todo.push({ method: m, counted: cashCount.total });
        } else {
          if (String(other[m] ?? '').trim() === '') continue;
          const counted = parseMoney(other[m]);
          if (counted === null) throw new Error(`${m} : montant invalide (exemple : 25 000).`);
          todo.push({ method: m, counted });
        }
      }
      if (todo.length === 0) throw new Error('Rien à enregistrer : comptez les billets et pièces, ou saisissez le solde d’un compte.');
      const done = [];
      for (const c of todo) {
        const res = await api.post('/api/treasury/count', { ...c, reason }, keys[c.method]);
        done.push(`${c.method} : ${res.gap === 0 ? 'juste' : gapText(res.gap)}`);
        onDone?.(res);
      }
      close();
      toast(`Comptage enregistré. ${done.join(' · ')}.`);
    });
  };

  return (
    <form className="form-grid" onSubmit={onSubmit} noValidate>
      {methods.map((m) => {
        const expected = expectedOf(m);
        const counted = countedOf(m);
        return (
          <section key={m} className="count-account" aria-label={m}>
            <div className="count-head">
              <h3>{m}</h3>
              <span className="subtle">Solde attendu : <strong>{money(expected)}</strong></span>
            </div>
            {m === CASH ? (
              <div className="count-notes" role="group" aria-label="Billets et pièces">
                <div className="count-row count-cols subtle"><span>Billet / pièce</span><span>Nombre</span><span>Montant</span></div>
                {DENOMINATIONS.map((d, i) => {
                  const n = parseCount(cash[d.value]);
                  return (
                    <label key={d.value} className="count-row">
                      <span>{d.label} <span className="subtle">{d.kind}</span></span>
                      <input inputMode="numeric" autoComplete="off" placeholder="0" aria-label={`Nombre : ${d.label} (${d.kind})`}
                        autoFocus={m === first && i === 0} aria-invalid={n === null || undefined}
                        value={cash[d.value] ?? ''} onChange={(e) => setCash({ ...cash, [d.value]: e.target.value })} />
                      <span className="count-sum">{n === null ? '—' : money(lineAmount(d.value, n))}</span>
                    </label>
                  );
                })}
                <div className="count-row count-total"><span>Total compté</span><span /><strong>{money(cashCount.total)}</strong></div>
              </div>
            ) : (
              <label className="field"><span>Solde affiché ({currency})</span>
                <input inputMode="decimal" autoComplete="off" placeholder="Laisser vide pour ne pas le compter" autoFocus={m === first}
                  value={other[m] ?? ''} onChange={(e) => setOther({ ...other, [m]: e.target.value })} />
                <span className="help">Ce que montre le compte maintenant (téléphone, relevé).</span></label>
            )}
            {counted !== null && (
              <p className="count-gap" aria-live="polite">Écart : <strong className={counted > expected ? 'amount-in' : counted < expected ? 'amount-out' : undefined}>{gapText(counted - expected)}</strong></p>
            )}
          </section>
        );
      })}
      <label className="field"><span>Motif</span>
        <input maxLength={120} placeholder="Comptage de caisse" value={reason} onChange={(e) => setReason(e.target.value)} />
        <span className="help">Facultatif, commun à tous les comptes. Seuls les comptes remplis sont enregistrés. Un écart va dans « Écart de caisse » : en recette s’il y a plus, en dépense s’il manque.</span></label>
      <FormError error={error} />
      <div className="modal-actions">
        <button type="button" className="btn" onClick={close}>Annuler</button>
        <button type="submit" className="btn btn-primary" disabled={busy} aria-busy={busy}>Enregistrer</button>
      </div>
    </form>
  );
}
