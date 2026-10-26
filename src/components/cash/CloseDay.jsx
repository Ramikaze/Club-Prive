// The evening closing of the till (POST /api/day-closing), for the manager and the administrators, in three steps:
// 1. check every ticket of the day (a reason for those left unchecked), 2. count each till and account (the cash
// note by note, the others as their app or bank shows them), 3. validate (a reason for any gap). The day is then
// locked: no money movement dated on it until an administrator reopens it (POST /api/day-closing/:day/reopen).
import { useState } from 'react';
import Icon from '../ui/Icon.jsx';
import { Modal, actionDialog, openDialog } from '../ui/Modal.jsx';
import { FormError, Loaded } from '../ui/ui.jsx';
import { toast } from '../ui/toast.jsx';
import { gapText } from './CountDialog.jsx';
import { api, newKey, qs } from '../../lib/api.js';
import { bizToday, dateTime, dayLabel, money, parseMoney, paymentPurpose } from '../../lib/format.js';
import { useLoad, useSubmit } from '../../lib/hooks.js';
import { formatTicketNumber } from '../../../shared/ticket.js';

// The notes counted one by one in the cash till; the coins are typed as one amount.
const NOTES = [10000, 5000, 2000, 1000, 500];
const isCash = (method) => /esp[eè]ce/i.test(method);

// The day's tickets, by the key the server checks: P- payments, R- refunds, E- entries; newest first.
function dayTickets(journal, entries) {
  const rows = [
    ...journal.payments.map((p) => ({
      key: `P-${p.id}`, at: p.paid_at, amount: p.amount, method: p.method,
      title: `${formatTicketNumber(p.id)} · ${paymentPurpose(p) ?? ([...new Set((p.allocations ?? []).map((a) => a.label))].join(', ') || 'Encaissement')}`,
      who: p.member_name,
    })),
    ...journal.refunds.map((r) => ({ key: `R-${r.id}`, at: r.created_at, amount: -r.amount, method: r.method, title: `Remboursement : ${r.label}`, who: r.member_name })),
    ...entries.filter((e) => e.status === 'active').map((e) => ({
      key: `E-${e.id}`, at: e.created_at, amount: e.kind === 'depense' ? -e.amount : e.amount, method: e.method,
      title: `${e.kind === 'depense' ? 'Dépense' : e.kind === 'transfert' ? 'Transfert' : 'Entrée diverse'} : ${e.label}`, who: e.created_by_name,
    })),
  ];
  return rows.sort((a, b) => Date.parse(b.at) - Date.parse(a.at));
}

const Steps = ({ step }) => (
  <ol className="close-steps">
    {['Tickets', 'Compter', 'Valider'].map((label, i) => (
      <li key={label} className={i < step ? 'done' : i === step ? 'current' : ''}>{i < step ? <Icon name="check" /> : i + 1} {label}</li>
    ))}
  </ol>
);

function CloseDayDialog({ close, day, onDone }) {
  const state = useLoad(async () => {
    const [closing, journal, ledger] = await Promise.all([
      api.get(`/api/day-closing${qs({ day })}`), api.get(`/api/finance/journal${qs({ from: day, to: day })}`), api.get(`/api/ledger/entries${qs({ from: day, to: day })}`),
    ]);
    return { closing, tickets: dayTickets(journal, ledger.entries) };
  }, [day]);
  return (
    <Modal title={`Fermer la caisse · ${dayLabel(day, 'medium')}`} size="wide" onClose={close}>
      <Loaded state={state}>{(d) => <Wizard close={close} day={day} data={d} onDone={onDone} />}</Loaded>
    </Modal>
  );
}

function Wizard({ close, day, data, onDone }) {
  const [key] = useState(newKey);
  const [step, setStep] = useState(0);
  const [checked, setChecked] = useState(() => new Set());
  const [v, setV] = useState({});
  const { busy, error, setError, submit } = useSubmit();
  const { tickets } = data;
  const accounts = data.closing.accounts.filter((a) => a.to_count);
  const unchecked = tickets.filter((t) => !checked.has(t.key));
  const set = (k) => (e) => setV({ ...v, [k]: e.target.value });
  const toggle = (k) => setChecked((s) => { const n = new Set(s); if (n.has(k)) n.delete(k); else n.add(k); return n; });

  // What was counted on an account, in hundredths: the cash note by note plus the coins, the others as typed.
  const countOf = (method) => {
    if (isCash(method)) {
      const coins = parseMoney(v[`${method}:pieces`] || '0');
      if (coins === null) return null;
      return NOTES.reduce((s, n) => s + (Number(v[`${method}:${n}`]) || 0) * n * 100, coins);
    }
    return String(v[method] ?? '').trim() === '' ? null : parseMoney(v[method]);
  };
  const lines = accounts.map((a) => {
    const counted = countOf(a.method);
    return { ...a, counted, gap: counted === null ? null : counted - a.expected };
  });
  const totalGap = lines.reduce((s, l) => s + (l.gap ?? 0), 0);
  const anyGap = lines.some((l) => l.gap);

  const next = () => {
    setError(null);
    if (step === 0 && unchecked.length && (v.unchecked_reason ?? '').trim().length < 3) {
      setError(`${unchecked.length} ticket(s) non pointé(s) : indiquez le motif, ou pointez-les.`);
      return;
    }
    if (step === 1) {
      const missing = lines.find((l) => l.counted === null);
      if (missing) { setError(`${missing.method} : saisissez le montant compté (exemple : 25 000).`); return; }
    }
    setStep(step + 1);
  };

  const finish = () => submit(async () => {
    if (anyGap && (v.gap_reason ?? '').trim().length < 3) throw new Error('Indiquez le motif de l’écart.');
    const cash = accounts.find((a) => isCash(a.method));
    const cashDetail = cash ? Object.fromEntries([...NOTES.map((n) => [n, Number(v[`${cash.method}:${n}`]) || 0]), ['pieces', parseMoney(v[`${cash.method}:pieces`] || '0') ?? 0]]) : {};
    await api.post('/api/day-closing', {
      day, checked: [...checked], unchecked_reason: v.unchecked_reason, gap_reason: v.gap_reason,
      counts: Object.fromEntries(lines.map((l) => [l.method, l.counted])), cash_detail: cashDetail,
    }, key);
    close();
    toast(totalGap === 0 ? 'Caisse fermée : aucun écart.' : `Caisse fermée. Écart enregistré : ${gapText(totalGap)}.`);
    onDone?.();
  });

  return (
    <div className="form-grid">
      <Steps step={step} />
      {step === 0 && (
        <>
          <div className="row" style={{ justifyContent: 'space-between' }}>
            <span className="subtle">{tickets.length - unchecked.length} / {tickets.length} pointé(s)</span>
            {tickets.length > 0 && (
              <button type="button" className="btn btn-sm btn-ghost" onClick={() => setChecked(unchecked.length ? new Set(tickets.map((t) => t.key)) : new Set())}>
                {unchecked.length ? 'Tout pointer' : 'Tout décocher'}</button>
            )}
          </div>
          {tickets.length ? (
            <div className="list close-tickets">{tickets.map((t) => (
              <label key={t.key} className={`list-item close-ticket${checked.has(t.key) ? '' : ' is-open'}`}>
                <input type="checkbox" checked={checked.has(t.key)} onChange={() => toggle(t.key)} />
                <div className="grow"><div className="title">{t.title}</div><div className="meta">{dateTime(t.at)}{t.who ? ` · ${t.who}` : ''} · {t.method}</div></div>
                <span className={`num ${t.amount < 0 ? 'amount-out' : ''}`}>{t.amount < 0 ? '−' : ''}{money(Math.abs(t.amount))}</span>
              </label>
            ))}</div>
          ) : <p className="subtle">Aucun ticket aujourd’hui.</p>}
          {unchecked.length > 0 && tickets.length > 0 && (
            <label className="field"><span>Motif des tickets non pointés</span>
              <input maxLength={300} placeholder="Reçu égaré, paiement à vérifier…" value={v.unchecked_reason ?? ''} onChange={set('unchecked_reason')} /></label>
          )}
        </>
      )}
      {step === 1 && (
        <>
          {lines.length ? lines.map((l) => (
            <fieldset key={l.method} className="close-account">
              <legend><Icon name={isCash(l.method) ? 'cash' : 'bank'} /> {l.method}</legend>
              {isCash(l.method) ? (
                <div className="close-notes">
                  {NOTES.map((n) => (
                    <label key={n} className="close-note"><span>{money(n * 100)} ×</span>
                      <input type="number" min="0" step="1" inputMode="numeric" placeholder="0" value={v[`${l.method}:${n}`] ?? ''} onChange={set(`${l.method}:${n}`)} />
                      <span className="num subtle">{money((Number(v[`${l.method}:${n}`]) || 0) * n * 100)}</span></label>
                  ))}
                  <label className="close-note"><span>Pièces</span>
                    <input inputMode="decimal" placeholder="0" value={v[`${l.method}:pieces`] ?? ''} onChange={set(`${l.method}:pieces`)} /><span /></label>
                </div>
              ) : (
                <label className="field"><span>Solde relevé dans l’appli ou sur le relevé</span>
                  <input inputMode="decimal" autoComplete="off" placeholder="0" value={v[l.method] ?? ''} onChange={set(l.method)} /></label>
              )}
              <div className="close-figures">
                <span>Compté <strong>{l.counted === null ? '—' : money(l.counted)}</strong></span>
                <span>Attendu <strong>{money(l.expected)}</strong></span>
                {l.gap !== null && <span className={l.gap > 0 ? 'amount-in' : l.gap < 0 ? 'amount-out' : ''}>{gapText(l.gap)}</span>}
              </div>
            </fieldset>
          )) : <p className="subtle">Aucune caisse ni compte à compter aujourd’hui.</p>}
        </>
      )}
      {step === 2 && (
        <>
          <dl className="calc">
            <div><dt>Tickets pointés</dt><dd>{tickets.length - unchecked.length} / {tickets.length}</dd></div>
            {lines.map((l) => <div key={l.method}><dt>{l.method}</dt><dd>{money(l.counted)} · {gapText(l.gap)}</dd></div>)}
            <div className="total"><dt>Écart total</dt><dd>{gapText(totalGap)}</dd></div>
          </dl>
          {anyGap && (
            <label className="field"><span>Motif de l’écart</span>
              <input maxLength={300} placeholder="Monnaie rendue en trop, erreur de saisie…" value={v.gap_reason ?? ''} onChange={set('gap_reason')} />
              <span className="help">L’écart est enregistré dans « Écart de caisse » : en recette s’il y a plus, en dépense s’il manque.</span></label>
          )}
          <p className="subtle">Une fois fermée, plus aucun encaissement ni dépense ne peut être daté de ce jour. Seul un administrateur peut rouvrir la journée.</p>
        </>
      )}
      <FormError error={error} />
      <div className="modal-actions">
        {step > 0 ? <button type="button" className="btn" onClick={() => { setError(null); setStep(step - 1); }}>Retour</button>
          : <button type="button" className="btn" onClick={close}>Annuler</button>}
        {step < 2 ? <button type="button" className="btn btn-primary" onClick={next}>Suivant</button>
          : <button type="button" className="btn btn-primary" disabled={busy} aria-busy={busy} onClick={finish}><Icon name="lock" /> Fermer la caisse</button>}
      </div>
    </div>
  );
}

// The day's closing on the cash page: a button to close it, or who closed it and the gap, and for an administrator a
// way to reopen it.
export function DayClosingBar({ isAdmin, onChange }) {
  const day = bizToday();
  const state = useLoad(() => api.get(`/api/day-closing${qs({ day })}`), [day]);
  const reload = () => { state.reload(); onChange?.(); };
  const c = state.data?.closed;
  if (!state.data) return null;
  if (!c) {
    return (
      <div className="card close-bar">
        <span><Icon name="unlock" /> La caisse du {dayLabel(day, 'medium')} est ouverte.</span>
        <button type="button" className="btn btn-primary btn-sm" onClick={() => openDialog(CloseDayDialog, { day, onDone: reload })}><Icon name="lock" /> Fermer la caisse</button>
      </div>
    );
  }
  const gap = c.summary.accounts.reduce((s, a) => s + a.gap, 0);
  const reopen = () => actionDialog({
    title: `Rouvrir la caisse du ${dayLabel(day, 'medium')}`,
    message: 'Les encaissements et dépenses pourront de nouveau être datés de ce jour. La réouverture est tracée avec son motif.',
    reasonLabel: 'Motif de la réouverture',
    confirmLabel: 'Rouvrir la journée',
    run: async ({ reason }) => { await api.post(`/api/day-closing/${day}/reopen`, { reason }); toast('Journée rouverte.'); reload(); },
  });
  return (
    <div className="card close-bar is-closed">
      <span><Icon name="lock" /> Caisse fermée le {dateTime(c.closed_at)}{c.closed_by_name ? ` par ${c.closed_by_name}` : ''} · {gapText(gap)}
        {c.summary.unchecked.length > 0 && ` · ${c.summary.unchecked.length} ticket(s) non pointé(s)`}</span>
      {isAdmin && <button type="button" className="btn btn-sm" onClick={reopen}><Icon name="unlock" /> Rouvrir</button>}
    </div>
  );
}
