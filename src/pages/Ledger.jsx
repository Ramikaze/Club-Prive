// General ledger (/grand-livre, administrators): every cash movement of the period in order, with
// the running balance of one treasury account or of all of them.
import Icon from '../components/ui/Icon.jsx';
import { AccountTag, AdminTabs, Empty, Loaded, Notice, PageHead } from '../components/ui/ui.jsx';
import PeriodPicker, { usePeriod } from '../components/ui/PeriodPicker.jsx';
import { api, qs } from '../lib/api.js';
import { money, dayLabel, ACCOUNT_LABEL } from '../lib/format.js';
import { useLoad, useBusy } from '../lib/hooks.js';
import { useStore } from '../store/useStore.js';
import { downloadExcel } from '../utils/exportExcel.js';

export default function Ledger() {
  const period = usePeriod('month');
  const { from, to } = period;
  const method = period.params.get('compte') ?? '';
  const account = ACCOUNT_LABEL[period.params.get('sous_compte')] ? period.params.get('sous_compte') : '';
  const configured = useStore((s) => s.settings.payment_methods);
  const excel = useBusy();
  const csv = useBusy();
  const filters = { from, to, method, account };
  const state = useLoad(() => api.get(`/api/ledger/book${qs(filters)}`), [from, to, method, account]);
  const methods = [...new Set([...configured, ...(state.data?.methods ?? []), ...(method ? [method] : [])])];

  return (
    <>
      <AdminTabs />
      <PageHead
        title="Grand livre"
        lead="Tous les mouvements de trésorerie dans l’ordre, avec le solde courant."
        tour="ledger"
        actions={(
          <>
            <button type="button" className="btn" disabled={csv.busy} aria-busy={csv.busy}
              onClick={() => csv.run(() => api.download(`/api/export/grand-livre${qs(filters)}`))}>
              <Icon name="download" /> CSV</button>
            <button type="button" className="btn" disabled={excel.busy} aria-busy={excel.busy}
              onClick={() => excel.run(() => downloadExcel([{ kind: 'grand-livre', params: filters }]))}>
              <Icon name="excel" /> Excel</button>
          </>
        )}
      />
      <div className="toolbar">
        <PeriodPicker period={period} />
        <select aria-label="Compte de trésorerie" value={method} onChange={(e) => period.setParam('compte', e.target.value)}>
          <option value="">Tous les comptes</option>
          {methods.map((m) => <option key={m} value={m}>{m}</option>)}
        </select>
        <select aria-label="Sous-compte" value={account} onChange={(e) => period.setParam('sous_compte', e.target.value)}>
          <option value="">Tous les sous-comptes</option>
          {Object.entries(ACCOUNT_LABEL).map(([k, label]) => <option key={k} value={k}>{label}</option>)}
        </select>
      </div>
      <Loaded state={state}>
        {(book) => (
          <div className="card">
            <div className="card-head">
              <h2>{book.method ?? 'Tous les comptes'}{book.account ? ` · ${ACCOUNT_LABEL[book.account]}` : ''}</h2>
              <span className="subtle">Du {dayLabel(book.from, 'short')} au {dayLabel(book.to, 'short')} · {book.rows.length} mouvement(s)</span>
            </div>
            {book.account && (
              <div className="toolbar">
                <Notice>Filtré par sous-compte : les mouvements d’un sous-compte ne forment pas une caisse, il n’y a donc pas de solde courant.</Notice>
              </div>
            )}
            {book.rows.length || book.opening != null ? (
              <div className="table-wrap">
                <table className="table stack-sm">
                  <thead>
                    <tr>
                      <th>Date</th><th>Pièce</th><th>Opération</th><th>Sous-compte</th><th>Compte</th>
                      <th className="num">Entrée</th><th className="num">Sortie</th>{book.account ? null : <th className="num">Solde</th>}
                    </tr>
                  </thead>
                  <tbody>
                    {book.opening != null && (
                      <tr>
                        <td data-label="Date" className="nowrap">{dayLabel(book.from, 'short')}</td>
                        <td data-label="Pièce" />
                        <td data-label="Opération" className="strong">Solde au début de la période</td>
                        <td data-label="Sous-compte" /><td data-label="Compte">{book.method ?? 'Tous'}</td>
                        <td data-label="Entrée" /><td data-label="Sortie" />
                        <td data-label="Solde" className="num strong">{money(book.opening)}</td>
                      </tr>
                    )}
                    {book.rows.map((r) => (
                      <tr key={r.key}>
                        <td data-label="Date" className="nowrap">{dayLabel(r.biz_day, 'short')}{r.time ? ` ${r.time}` : ''}</td>
                        <td data-label="Pièce" className="mono nowrap">{r.ref}</td>
                        <td data-label="Opération">
                          <div className="title">{r.label}</div>
                          <div className="subtle">{r.type_label}{r.detail ? ` · ${r.detail}` : ''}{r.reference ? ` · ${r.reference}` : ''}</div>
                        </td>
                        <td data-label="Sous-compte">{r.account ? <AccountTag account={r.account} /> : '—'}</td>
                        <td data-label="Compte" className="nowrap">{r.method}</td>
                        <td data-label="Entrée" className="num amount-in">{r.in ? money(r.in) : ''}</td>
                        <td data-label="Sortie" className="num amount-out">{r.out ? money(r.out) : ''}</td>
                        {book.account ? null : <td data-label="Solde" className={`num ${r.balance < 0 ? 'amount-out' : ''}`}>{money(r.balance)}</td>}
                      </tr>
                    ))}
                  </tbody>
                  <tfoot>
                    <tr>
                      <td colSpan={5}>{book.account ? 'Totaux' : 'Totaux et solde de fin de période'}</td>
                      <td className="num">{money(book.totals.in)}</td>
                      <td className="num">{money(book.totals.out)}</td>
                      {book.account ? null : <td className="num">{money(book.closing)}</td>}
                    </tr>
                  </tfoot>
                </table>
              </div>
            ) : (
              <Empty icon="book">Aucun mouvement sur cette période.</Empty>
            )}
          </div>
        )}
      </Loaded>
    </>
  );
}
