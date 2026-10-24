// Expenses and other money movements (/depenses). The manager records the expenses of the day;
// administrators see any period, also record other receipts and transfers between treasury
// accounts, and cancel an entry with a reason (never deleted).
import { useState } from 'react';
import Icon from '../components/ui/Icon.jsx';
import { Modal, openDialog, actionDialog } from '../components/ui/Modal.jsx';
import { AccountTag, CashTabs, Chip, DemoChip, Empty, FormError, Loaded, Notice, PageHead, Segmented } from '../components/ui/ui.jsx';
import PeriodPicker, { usePeriod } from '../components/ui/PeriodPicker.jsx';
import { toast } from '../components/ui/toast.jsx';
import { api, newKey, qs } from '../lib/api.js';
import { money, parseMoney, dayLabel, bizToday, ACCOUNT_LABEL } from '../lib/format.js';
import { useLoad, useSubmit, useBusy } from '../lib/hooks.js';
import { useStore, useIsAdmin } from '../store/useStore.js';
import { downloadExcel } from '../utils/exportExcel.js';

const TITLES = { depense: 'Nouvelle dépense', recette: 'Entrée diverse', transfert: 'Transfert entre comptes' };
const DONE = { depense: 'Dépense enregistrée.', recette: 'Entrée enregistrée.', transfert: 'Transfert enregistré.' };
const KIND_FILTERS = [['', 'Tout'], ['depense', 'Dépenses'], ['recette', 'Entrées'], ['transfert', 'Transferts']];

// The largest expense a manager records alone, in hundredths; the server refuses more (MANAGER_EXPENSE_MAX, worker/ledger.js).
const MANAGER_EXPENSE_MAX = 5000 * 100;
const MANAGER_CAP_TEXT = 'Le gérant enregistre des dépenses de 5 000 FCFA au plus. Au-delà, adressez-vous à un administrateur.';

function EntryDialog({ close, kind, categories, onDone }) {
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

function byCategory(entries) {
  const map = new Map();
  for (const e of entries) {
    if (e.status !== 'active' || e.kind !== 'depense') continue;
    map.set(e.category_name, (map.get(e.category_name) ?? 0) + e.amount);
  }
  return [...map.entries()].sort((a, b) => b[1] - a[1]);
}

function byMethod(entries, methods) {
  const rows = new Map(methods.map((m) => [m, { method: m, in: 0, out: 0 }]));
  const row = (m) => {
    if (!rows.has(m)) rows.set(m, { method: m, in: 0, out: 0 });
    return rows.get(m);
  };
  for (const e of entries) {
    if (e.status !== 'active') continue;
    if (e.kind === 'depense') row(e.method).out += e.amount;
    else if (e.kind === 'recette') row(e.method).in += e.amount;
    else {
      row(e.method).out += e.amount;
      row(e.to_method).in += e.amount;
    }
  }
  return [...rows.values()].filter((r) => r.in || r.out);
}

function EntryRow({ e, isAdmin, onCancel }) {
  const muted = e.status !== 'active';
  const tone = e.kind === 'depense' ? 'amount-out' : e.kind === 'recette' ? 'amount-in' : '';
  return (
    <tr className={muted ? 'is-muted' : ''}>
      <td data-label="Date" className="nowrap">{dayLabel(e.biz_date, 'short')}</td>
      <td data-label="Opération">
        <div className="title">{e.label} <DemoChip on={e.is_demo} /></div>
        <div className="subtle">
          {e.kind_label}{e.category_name ? ` · ${e.category_name}` : ''}{e.reference ? ` · ${e.reference}` : ''}
          {e.account && <> · <AccountTag account={e.account} /></>}
        </div>
        {muted && e.cancel_reason && <div className="subtle">Annulée par {e.cancelled_by_name} : {e.cancel_reason}</div>}
      </td>
      <td data-label="Compte" className="nowrap">{e.kind === 'transfert' ? `${e.method} → ${e.to_method}` : e.method}</td>
      <td data-label="Montant" className={`num ${muted ? '' : tone}`}><span className={muted ? 'strike' : ''}>{money(e.amount)}</span></td>
      <td data-label="Statut">
        <span className="row">
          <Chip group="entry" value={e.status} />
          {e.period_closed && <span className="chip" title="Mois clôturé"><Icon name="lock" /> Clôturé</span>}
        </span>
      </td>
      <td data-label="Saisi par">{e.created_by_name ?? '—'}</td>
      <td className="actions">
        {isAdmin && !muted && !e.period_closed && (
          <button type="button" className="btn btn-sm btn-danger" onClick={() => onCancel(e)}>Annuler</button>
        )}
      </td>
    </tr>
  );
}

export default function Expenses() {
  const isAdmin = useIsAdmin();
  const methods = useStore((s) => s.settings.payment_methods);
  const period = usePeriod('month');
  const kind = isAdmin ? (period.params.get('type') ?? '') : '';
  const excel = useBusy();
  const state = useLoad(async () => {
    const [list, categories] = await Promise.all([
      api.get(`/api/ledger/entries${qs({ from: period.from, to: period.to, kind })}`),
      api.get('/api/ledger/categories'),
    ]);
    return { ...list, categories };
  }, [period.from, period.to, kind]);

  const open = (entryKind) => openDialog(EntryDialog, { kind: entryKind, categories: state.data?.categories ?? [], onDone: state.reload });
  const cancel = (e) => actionDialog({
    title: 'Annuler cette opération',
    message: `${e.label} — ${money(e.amount)}, ${dayLabel(e.biz_date, 'short')}. L’opération reste visible, barrée, avec le motif.`,
    reasonLabel: 'Motif de l’annulation',
    confirmLabel: 'Annuler l’opération',
    danger: true,
    run: async ({ reason }) => {
      await api.post(`/api/ledger/entries/${e.id}/cancel`, { reason });
      toast('Opération annulée.');
      state.reload();
    },
  });

  return (
    <>
      <CashTabs />
      <PageHead
        title={isAdmin ? 'Dépenses & mouvements' : 'Dépenses du jour'}
        lead={isAdmin
          ? 'Dépenses, entrées diverses et transferts entre caisses et comptes.'
          : 'Achats et factures réglés aujourd’hui depuis la caisse ou un compte.'}
        tour="expenses"
        actions={(
          <>
            {isAdmin && (
              <button type="button" className="btn" disabled={excel.busy} aria-busy={excel.busy}
                onClick={() => excel.run(() => downloadExcel([{ kind: 'operations', params: { from: period.from, to: period.to } }]))}>
                <Icon name="excel" /> Excel</button>
            )}
            {isAdmin && <button type="button" className="btn" disabled={!state.data} onClick={() => open('transfert')}><Icon name="transfer" /> Transfert</button>}
            {isAdmin && <button type="button" className="btn" disabled={!state.data} onClick={() => open('recette')}><Icon name="plus" /> Entrée diverse</button>}
            <button type="button" className="btn btn-primary" disabled={!state.data} onClick={() => open('depense')}><Icon name="plus" /> Nouvelle dépense</button>
          </>
        )}
      />
      {isAdmin ? (
        <div className="toolbar">
          <PeriodPicker period={period} />
          <Segmented label="Type d’opération" value={kind} options={KIND_FILTERS} onChange={(k) => period.setParam('type', k)} />
        </div>
      ) : (
        <div className="toolbar">
          <Notice>Vous voyez et saisissez les dépenses du jour ({dayLabel(bizToday())}). L’historique complet et les annulations sont réservés aux administrateurs.</Notice>
        </div>
      )}
      <Loaded state={state}>
        {(data) => {
          const cats = byCategory(data.entries);
          const max = cats[0]?.[1] ?? 0;
          const flows = byMethod(data.entries, methods);
          const active = data.entries.filter((e) => e.status === 'active');
          const total = (k) => active.filter((e) => e.kind === k).reduce((s, e) => s + e.amount, 0);
          return (
            <>
              <div className="grid-2">
                <div className="card">
                  <div className="card-head"><h2>Dépenses par catégorie</h2><span className="subtle">{money(total('depense'))}</span></div>
                  {cats.length ? (
                    <div className="bars">
                      {cats.map(([name, amount]) => (
                        <div className="bar-row" key={name}>
                          <div className="top"><span>{name}</span><span className="amount">{money(amount)}</span></div>
                          <div className="bar-track"><div className="bar-fill" style={{ width: `${Math.max(2, (amount / max) * 100)}%` }} /></div>
                        </div>
                      ))}
                    </div>
                  ) : <p className="subtle">Aucune dépense sur la période.</p>}
                </div>
                <div className="card">
                  <div className="card-head"><h2>Par caisse et compte</h2></div>
                  {flows.length ? (
                    <div className="table-wrap">
                      <table className="table">
                        <thead><tr><th>Compte</th><th className="num">Sorties</th><th className="num">Entrées</th></tr></thead>
                        <tbody>
                          {flows.map((r) => (
                            <tr key={r.method}><td>{r.method}</td><td className="num">{r.out ? money(r.out) : '—'}</td><td className="num">{r.in ? money(r.in) : '—'}</td></tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  ) : <p className="subtle">Aucun mouvement sur la période.</p>}
                  {total('recette') > 0 && <p className="subtle section-gap">Entrées diverses : {money(total('recette'))}.</p>}
                </div>
              </div>
              <div className="card section-gap">
                <div className="card-head">
                  <h2>Opérations</h2>
                  <span className="subtle">
                    {data.from === data.to ? dayLabel(data.from) : `Du ${dayLabel(data.from, 'short')} au ${dayLabel(data.to, 'short')}`} · {data.entries.length} opération(s)
                  </span>
                </div>
                {data.entries.length ? (
                  <div className="table-wrap">
                    <table className="table stack-sm">
                      <thead>
                        <tr><th>Date</th><th>Opération</th><th>Compte</th><th className="num">Montant</th><th>Statut</th><th>Saisi par</th><th /></tr>
                      </thead>
                      <tbody>
                        {data.entries.map((e) => <EntryRow key={e.id} e={e} isAdmin={isAdmin} onCancel={cancel} />)}
                      </tbody>
                    </table>
                  </div>
                ) : (
                  <Empty icon="receipt">
                    <p>Aucune opération sur cette période.</p>
                    <button type="button" className="btn btn-primary" onClick={() => open('depense')}><Icon name="plus" /> Nouvelle dépense</button>
                  </Empty>
                )}
              </div>
            </>
          );
        }}
      </Loaded>
    </>
  );
}
