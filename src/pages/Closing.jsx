// Monthly closing (/cloture, administrators). A closed month refuses any operation dated inside it;
// reopening needs a reason and stays in the history. Closing follows a short checklist.
import { useState } from 'react';
import Icon from '../components/ui/Icon.jsx';
import { Modal, openDialog, actionDialog } from '../components/ui/Modal.jsx';
import { AdminTabs, ErrorState, FormError, Loaded, Notice, PageHead, Skeleton } from '../components/ui/ui.jsx';
import { toast } from '../components/ui/toast.jsx';
import { api, newKey, qs } from '../lib/api.js';
import { money, monthTitle, dateTime } from '../lib/format.js';
import { useLoad, useSubmit, useBusy } from '../lib/hooks.js';
import { downloadExcel } from '../utils/exportExcel.js';

const CHECKS = [
  'Les espèces ont été comptées et correspondent au solde affiché.',
  'Les relevés bancaires et mobile money ont été rapprochés des soldes affichés.',
  'Toutes les dépenses et entrées du mois sont saisies.',
];

const monthExports = (m) => {
  const params = { from: m.first, to: m.last };
  return [
    { kind: 'tresorerie', params }, { kind: 'synthese', params }, { kind: 'grand-livre', params },
    { kind: 'operations', params }, { kind: 'encaissements', params }, { kind: 'remboursements', params },
  ];
};

function CloseDialog({ close, month, onDone }) {
  const [key] = useState(newKey);
  const [checked, setChecked] = useState(CHECKS.map(() => false));
  const { busy, error, submit } = useSubmit();
  const state = useLoad(() => api.get(`/api/treasury${qs({ from: month.first, to: month.last })}`), [month.month]);
  const blocked = month.open_reservations > 0;
  const onSubmit = (e) => {
    e.preventDefault();
    submit(async () => {
      if (checked.some((c) => !c)) throw new Error('Cochez chaque vérification avant de clôturer.');
      await api.post('/api/closings', { month: month.month }, key);
      close();
      toast(`${monthTitle(month.month)} est clôturé.`);
      onDone?.();
    });
  };
  const t = state.data;
  return (
    <Modal title={`Clôturer ${monthTitle(month.month)}`} size="wide" onClose={close}>
      <form className="form-grid" onSubmit={onSubmit} noValidate>
        <p>Après la clôture, plus aucune opération datée de ce mois ne pourra être saisie ni annulée, et les soldes d’ouverture seront verrouillés.</p>
        {blocked && (
          <Notice kind="danger">
            {month.open_reservations} réservation(s) de ce mois ne sont ni terminées ni annulées : traitez-les dans l’agenda avant la clôture.
          </Notice>
        )}
        {state.error && <ErrorState error={state.error} onRetry={state.retry} />}
        {!t && !state.error && <Skeleton />}
        {t && (
          <div className="grid-2">
            <dl className="calc">
              <div><dt>Encaissé net</dt><dd>{money(t.result.revenue)}</dd></div>
              <div><dt>Dépenses</dt><dd>− {money(t.result.expenses)}</dd></div>
              <div className="total"><dt>Résultat du mois</dt><dd>{money(t.result.result)}</dd></div>
            </dl>
            <dl className="calc">
              {t.accounts.filter((a) => a.opening || a.in || a.out || a.closing).map((a) => (
                <div key={a.method}><dt>{a.method}</dt><dd>{money(a.closing)}</dd></div>
              ))}
              <div className="total"><dt>Trésorerie en fin de mois</dt><dd>{money(t.total.closing)}</dd></div>
              {t.wallet_liability != null && <div><dt>Crédits CFA des membres (dus en consommations)</dt><dd>{money(t.wallet_liability)}</dd></div>}
            </dl>
          </div>
        )}
        <fieldset>
          <legend>Vérifications</legend>
          {CHECKS.map((label, i) => (
            <label className="check" key={label}>
              <input type="checkbox" checked={checked[i]} onChange={(e) => setChecked(checked.map((c, j) => (j === i ? e.target.checked : c)))} />
              <span>{label}</span>
            </label>
          ))}
        </fieldset>
        <FormError error={error} />
        <div className="modal-actions">
          <button type="button" className="btn" onClick={close}>Annuler</button>
          <button type="submit" className="btn btn-primary" disabled={busy || blocked || checked.some((c) => !c)} aria-busy={busy}>
            <Icon name="lock" /> Clôturer le mois</button>
        </div>
      </form>
    </Modal>
  );
}

function MonthRow({ m, closing, onClose, onReopen, onExport, exporting }) {
  return (
    <tr>
      <td data-label="Mois" className="strong">{monthTitle(m.month)}</td>
      <td data-label="État">
        {m.closed && <span className="chip chip-ok"><Icon name="lock" /> Clôturé</span>}
        {!m.closed && m.current && <span className="chip chip-info">En cours</span>}
        {!m.closed && !m.current && <span className="chip">Ouvert</span>}
      </td>
      <td data-label="Réservations">
        {m.open_reservations > 0
          ? <span className="chip chip-warn">{m.open_reservations} à terminer ou annuler</span>
          : <span className="subtle">—</span>}
      </td>
      <td data-label="Clôture" className="subtle">{closing ? `${dateTime(closing.closed_at)} par ${closing.closed_by_name ?? '—'}` : ''}</td>
      <td className="actions">
        <span className="row">
          <button type="button" className="btn btn-sm" disabled={exporting} onClick={() => onExport(m)} title={`Exporter ${monthTitle(m.month)} vers Excel`}>
            <Icon name="excel" /><span className="sr-only">Exporter vers Excel</span></button>
          {m.closable && <button type="button" className="btn btn-sm btn-primary" onClick={() => onClose(m)}><Icon name="lock" /> Clôturer…</button>}
          {m.closed && <button type="button" className="btn btn-sm" onClick={() => onReopen(m)}><Icon name="unlock" /> Rouvrir…</button>}
        </span>
      </td>
    </tr>
  );
}

export default function Closing() {
  const state = useLoad(() => api.get('/api/closings'), []);
  const excel = useBusy();
  const closeMonth = (m) => openDialog(CloseDialog, { month: m, onDone: state.reload });
  const reopen = (m) => actionDialog({
    title: `Rouvrir ${monthTitle(m.month)}`,
    message: 'Les opérations datées de ce mois pourront de nouveau être saisies ou annulées. La réouverture est enregistrée dans l’historique avec son motif et la synthèse établie à la clôture.',
    reasonLabel: 'Motif de la réouverture',
    confirmLabel: 'Rouvrir le mois',
    run: async ({ reason }) => {
      await api.post(`/api/closings/${m.month}/reopen`, { reason });
      toast(`${monthTitle(m.month)} est rouvert.`);
      state.reload();
    },
  });
  const exportMonth = (m) => excel.run(() => downloadExcel(monthExports(m), `mois_${m.month}.xlsx`));

  return (
    <>
      <AdminTabs />
      <PageHead
        title="Clôture mensuelle"
        lead="Verrouillage mensuel des écritures comptables."
        tour="closing"
      />
      <Loaded state={state}>
        {(data) => {
          const closings = new Map(data.closed.map((c) => [c.month, c]));
          return (
            <>
              <div className="card">
                <div className="card-head"><h2>Les douze derniers mois</h2><span className="subtle">Seul un mois terminé peut être clôturé.</span></div>
                <div className="table-wrap">
                  <table className="table stack-sm">
                    <thead><tr><th>Mois</th><th>État</th><th>Réservations</th><th>Clôture</th><th /></tr></thead>
                    <tbody>
                      {data.months.map((m) => (
                        <MonthRow key={m.month} m={m} closing={closings.get(m.month)} onClose={closeMonth} onReopen={reopen}
                          onExport={exportMonth} exporting={excel.busy} />
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
              {data.closed.length > 0 && (
                <div className="card section-gap">
                  <div className="card-head"><h2>Synthèses établies à la clôture</h2></div>
                  <div className="table-wrap">
                    <table className="table stack-sm">
                      <thead>
                        <tr><th>Mois</th><th className="num">Encaissé net</th><th className="num">Dépenses</th><th className="num">Résultat</th><th className="num">Trésorerie fin</th><th className="num">Crédits CFA des membres</th></tr>
                      </thead>
                      <tbody>
                        {data.closed.map((c) => (
                          <tr key={c.month}>
                            <td data-label="Mois">{monthTitle(c.month)}</td>
                            <td data-label="Encaissé net" className="num">{money(c.summary.result.revenue)}</td>
                            <td data-label="Dépenses" className="num">{money(c.summary.result.expenses)}</td>
                            <td data-label="Résultat" className={`num ${c.summary.result.result < 0 ? 'amount-out' : ''}`}>{money(c.summary.result.result)}</td>
                            <td data-label="Trésorerie fin" className="num">{money(c.summary.treasury.total.closing)}</td>
                            {/* Closings made before the member card have no such figure. */}
                            <td data-label="Crédits CFA des membres" className="num">{c.summary.wallet_liability == null ? '—' : money(c.summary.wallet_liability)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}
            </>
          );
        }}
      </Loaded>
    </>
  );
}
