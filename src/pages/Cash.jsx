// The cash desk (/caisse), one page: « Soldes » (administrators), then « Recettes » and « Dépenses » side by side,
// each with its summary, its detailed list and its total, and under them what is left to collect, the transfers
// and the folded details and exports. The manager sees the day only, without the balances (treasury is the
// administrators'), and records the day's expenses within his cap.
import { useEffect } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import Icon from '../components/ui/Icon.jsx';
import { openDialog } from '../components/ui/Modal.jsx';
import { Loaded, Notice, PageHead } from '../components/ui/ui.jsx';
import PeriodPicker, { usePeriod } from '../components/ui/PeriodPicker.jsx';
import EntryDialog, { MANAGER_CAP_TEXT } from '../components/cash/EntryDialog.jsx';
import CashBalance from '../components/cash/CashBalance.jsx';
import CountDialog from '../components/cash/CountDialog.jsx';
import ReceiptsBlock from '../components/cash/ReceiptsBlock.jsx';
import ExpensesBlock, { TransfersBlock } from '../components/cash/ExpensesBlock.jsx';
import { DetailsAndExports, OpenNotes } from '../components/cash/CashDetails.jsx';
import { api, qs } from '../lib/api.js';
import { ACCOUNT_LABEL, bizToday, dayLabel } from '../lib/format.js';
import { useBusy, useLoad } from '../lib/hooks.js';
import { useIsAdmin, useSettings } from '../store/useStore.js';
import { downloadExcel } from '../utils/exportExcel.js';
import { isValidDate } from '../../shared/time.js';
import { CARD_METHOD } from '../../shared/rules.js';

// The presets of the former cash page's links (?p=…&du=…&au=…).
const LEGACY = { jour: 'today', semaine: 'week', mois: 'month', 'mois-precedent': 'last-month' };

// The period in the query string (?from=…&to=…), today by default: the cash desk is daily. A link of the former
// page still opens its period, rewritten into from / to.
function useCashPeriod() {
  const period = usePeriod('today');
  const [params, setParams] = useSearchParams();
  const p = params.get('p');
  useEffect(() => {
    if (!p) return;
    const du = params.get('du');
    const au = params.get('au');
    const range = p === 'perso' && isValidDate(du) && isValidDate(au)
      ? { from: du <= au ? du : au, to: du <= au ? au : du }
      : period.presets.find((x) => x.key === LEGACY[p]);
    const next = new URLSearchParams(params);
    for (const k of ['p', 'du', 'au']) next.delete(k);
    // There, « compte » was the sub-account of the exports.
    if (Object.hasOwn(ACCOUNT_LABEL, next.get('compte') ?? '')) {
      next.set('sous_compte', next.get('compte'));
      next.delete('compte');
    }
    if (range) {
      next.set('from', range.from);
      next.set('to', range.to);
    }
    setParams(next, { replace: true });
  }, [p]); // eslint-disable-line react-hooks/exhaustive-deps
  return { ...period, presets: period.presets.map((x) => (x.key === 'month' ? { ...x, label: 'Mois en cours' } : x)) };
}

// A link to a block (the former expenses page, /depenses?type=depense, now redirected here) scrolls to it once
// the page is loaded.
const BLOCKS = { recette: 'caisse-recettes', depense: 'caisse-depenses', transfert: 'caisse-transferts' };
function useScrollToBlock(type, loaded) {
  useEffect(() => {
    if (loaded && BLOCKS[type]) document.getElementById(BLOCKS[type])?.scrollIntoView({ block: 'start' });
  }, [type, loaded]);
}

const periodLabel = (from, to) => (from === to ? dayLabel(from, 'title') : `Du ${dayLabel(from, 'medium')} au ${dayLabel(to, 'medium')}`);

function AdminCash() {
  const settings = useSettings();
  const period = useCashPeriod();
  const { from, to } = period;
  // The sub-account of the CSV exports, and the treasury account the whole page shows (all of them by default).
  const sub = period.params.get('sous_compte');
  const account = Object.hasOwn(ACCOUNT_LABEL, sub ?? '') ? sub : '';
  const excel = useBusy();
  const state = useLoad(async () => {
    const [sum, journal, open, ledger, categories, treasury] = await Promise.all([
      api.get(`/api/finance/summary${qs({ from, to })}`),
      api.get(`/api/finance/journal${qs({ from, to })}`),
      api.get('/api/finance/open'),
      api.get(`/api/ledger/entries${qs({ from, to })}`),
      api.get('/api/ledger/categories'),
      api.get(`/api/treasury${qs({ from, to })}`),
    ]);
    return { sum, journal, open, entries: ledger.entries, categories, treasury };
  }, [from, to]);
  useScrollToBlock(period.params.get('type'), !!state.data);

  const methods = [...new Set([...settings.payment_methods, ...(state.data?.treasury.accounts.map((a) => a.method) ?? [])])]
    .filter((m) => m !== CARD_METHOD);
  const compte = period.params.get('compte') ?? '';
  const method = methods.includes(compte) ? compte : '';

  const add = (kind) => openDialog(EntryDialog, { kind, categories: state.data?.categories ?? [], onDone: state.reload });
  const count = () => openDialog(CountDialog, { method, onDone: state.reload });
  const params = { from, to };
  const oneDay = from === to;

  return (
    <>
      <PageHead
        title="Caisse"
        lead={periodLabel(from, to)}
        tour="cash"
        actions={(
          <>
            <button type="button" className="btn btn-sm btn-ghost" disabled={!state.data} onClick={() => add('recette')}><Icon name="plus" /> Entrée diverse</button>
            <button type="button" className="btn btn-sm btn-ghost" disabled={!state.data} onClick={() => add('transfert')}><Icon name="transfer" /> Transfert</button>
            <Link className="btn btn-sm btn-ghost" to="/caisse/historique-tickets"><Icon name="receipt" /> Historique des tickets</Link>
            <button type="button" className="btn btn-sm btn-ghost" disabled={excel.busy} aria-busy={excel.busy} title="Synthèse, encaissements, remboursements et opérations de la période"
              onClick={() => excel.run(() => downloadExcel([
                { kind: 'synthese', params }, { kind: 'encaissements', params }, { kind: 'remboursements', params }, { kind: 'operations', params },
              ], `caisse_${from}_${to}.xlsx`))}>
              <Icon name="excel" /> Excel</button>
            <button type="button" className="btn btn-primary" disabled={!state.data} onClick={() => add('depense')}><Icon name="plus" /> Nouvelle dépense</button>
          </>
        )}
      />
      <div className="toolbar">
        <PeriodPicker period={period} />
        <label className="cash-account"><span className="subtle">Caisse ou compte</span>
          <select value={method} onChange={(e) => period.setParam('compte', e.target.value)}>
            <option value="">Toutes</option>
            {methods.map((m) => <option key={m} value={m}>{m}</option>)}
          </select></label>
      </div>
      <Loaded state={state}>{(d) => (
        <div className="cash-page">
          <CashBalance t={d.treasury} method={method} entries={d.entries} journal={d.journal} openingBalances={settings.opening_balances} onCount={count} />
          <div className="cash-columns">
            <div className="cash-columns-inner">
              <ReceiptsBlock journal={d.journal} entries={d.entries} method={method} oneDay={oneDay} isAdmin onChange={state.reload} />
              <ExpensesBlock entries={d.entries} method={method} oneDay={oneDay} isAdmin onChange={state.reload} />
            </div>
          </div>
          <OpenNotes groups={d.open} onDone={state.reload} allPeriods />
          <TransfersBlock entries={d.entries} method={method} oneDay={oneDay} isAdmin onChange={state.reload} />
          <DetailsAndExports sum={d.sum} from={from} to={to} account={account} currency={settings.currency.label}
            onAccount={(k) => period.setParam('sous_compte', k)} />
        </div>
      )}</Loaded>
    </>
  );
}

function ManagerCash() {
  const today = bizToday();
  const state = useLoad(async () => {
    const [journal, open, ledger, categories] = await Promise.all([
      api.get('/api/finance/journal'), api.get('/api/finance/open'), api.get('/api/ledger/entries'), api.get('/api/ledger/categories'),
    ]);
    return { journal, open, entries: ledger.entries, categories };
  }, []);
  const add = () => openDialog(EntryDialog, { kind: 'depense', categories: state.data?.categories ?? [], onDone: state.reload });
  return (
    <>
      <PageHead
        title="Caisse"
        lead={`Caisse du ${dayLabel(state.data?.journal.from ?? today, 'title')}`}
        tour="cash"
        actions={<button type="button" className="btn btn-primary" disabled={!state.data} onClick={add}><Icon name="plus" /> Nouvelle dépense</button>}
      />
      <div className="toolbar">
        <Notice>Vous voyez la caisse du jour et saisissez les dépenses du jour. {MANAGER_CAP_TEXT} L’historique et les annulations sont réservés aux administrateurs.</Notice>
      </div>
      <Loaded state={state}>{(d) => (
        <div className="cash-page">
          <div className="cash-columns">
            <div className="cash-columns-inner">
              <ReceiptsBlock journal={d.journal} entries={d.entries} oneDay isAdmin={false} onChange={state.reload} title="Recettes du jour" />
              <ExpensesBlock entries={d.entries} oneDay isAdmin={false} onChange={state.reload} title="Dépenses du jour" />
            </div>
          </div>
          <OpenNotes groups={d.open} onDone={state.reload} />
        </div>
      )}</Loaded>
    </>
  );
}

export default function Cash() {
  const admin = useIsAdmin();
  return admin ? <AdminCash /> : <ManagerCash />;
}
