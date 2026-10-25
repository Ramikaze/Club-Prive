// The quiet part of the cash page, under the three blocks: what is left to collect, and (administrators) the
// sub-account details, the payment methods and the exports, folded in one « Détails et exports ».
import { Link } from 'react-router-dom';
import Icon from '../ui/Icon.jsx';
import { api, qs } from '../../lib/api.js';
import { ACCOUNT_LABEL, money } from '../../lib/format.js';
import { useBusy } from '../../lib/hooks.js';
import { downloadExcel } from '../../utils/exportExcel.js';
import { openPaymentDialog } from '../../dialogs/index.js';

function Ventilation({ byAccount }) {
  return Object.entries(byAccount).filter(([, v]) => v).map(([k, v]) => (
    <span key={k} className="nowrap" style={{ marginRight: 10 }}><i className={`dot dot-${k}`} /> {ACCOUNT_LABEL[k]} {money(v)}</span>
  ));
}

// « Reste à encaisser »: the open notes, every period; one discreet line when there are none.
export function OpenNotes({ groups, onDone, allPeriods = false }) {
  if (!groups.length) return <p className="subtle cash-quiet"><Icon name="check" /> Reste à encaisser : rien, toutes les notes sont réglées.</p>;
  const total = groups.reduce((s, g) => s + g.total, 0);
  return (
    <section className="card cash-block" id="caisse-reste">
      <div className="card-head">
        <h2>Reste à encaisser {allPeriods && <span className="subtle">toutes périodes</span>}</h2>
        <strong className="num">{money(total)}</strong>
      </div>
      <div className="list">{groups.map((g) => (
        <div key={g.member_id} className="list-item list-item-wrap">
          <div className="grow"><div className="title"><Link to={`/membres/${g.member_id}`}>{g.member_name}</Link> <span className="subtle">{g.member_no}</span></div>
            <div className="meta">{g.lines.length} ligne(s) · <Ventilation byAccount={g.by_account} /></div></div>
          <strong className="num">{money(g.total)}</strong>
          <button type="button" className="btn btn-sm btn-primary"
            onClick={() => openPaymentDialog({ lines: g.lines, memberName: g.member_name }, onDone)}>Encaisser</button>
        </div>
      ))}</div>
    </section>
  );
}

function AccountCard({ a, total = false }) {
  return (
    <div className={`account-card ${total ? 'total' : ''}`}>
      <h3>{total ? 'Total' : <><i className={`dot dot-${a.account}`} /> {a.label}</>}</h3>
      <div className="big">{money(a.net)}</div>
      <div className="calc-line"><span>Facturé (dû)</span><span>{money(a.billed)}</span></div>
      <div className="calc-line"><span>Encaissé</span><span>{money(a.collected)}</span></div>
      <div className="calc-line"><span>Remboursé</span><span>{money(a.refunded)}</span></div>
      <div className="calc-line"><span>Net encaissé</span><span>{money(a.net)}</span></div>
      <div className="calc-line"><span>Reste à payer</span><span>{money(a.outstanding)}</span></div>
      {a.cancelled ? <div className="calc-line"><span>Annulé</span><span>{money(a.cancelled)}</span></div> : null}
    </div>
  );
}

const EXPORTS = [['synthese', 'Synthèse'], ['lignes', 'Lignes facturées'], ['encaissements', 'Encaissements'],
  ['remboursements', 'Remboursements'], ['reservations', 'Réservations'], ['operations', 'Dépenses et opérations'],
  ['stock', 'Mouvements de stock']];

export function DetailsAndExports({ sum, from, to, account, onAccount, currency }) {
  const excel = useBusy();
  const csv = useBusy();
  const exportLink = (kind, label) => (
    <span key={kind} className="row">
      <button type="button" className="btn btn-sm" disabled={csv.busy} aria-busy={csv.busy}
        onClick={() => csv.run(() => api.download(`/api/export/${kind}${qs({ from, to, account })}`))}>
        <Icon name="download" /> {label}</button>
      <button type="button" className="btn btn-sm" title={`${label} (Excel)`} disabled={excel.busy} aria-busy={excel.busy}
        onClick={() => excel.run(() => downloadExcel([{ kind, params: { from, to, account } }]))}>
        <Icon name="excel" /> Excel<span className="sr-only"> : {label}</span></button>
    </span>
  );
  return (
    <details className="card cash-details">
      <summary>Détails et exports</summary>
      <h3 className="sub-section-title cash-list-title">Par sous-compte</h3>
      <div className="account-cards">
        {sum.accounts.map((a) => <AccountCard key={a.account} a={a} />)}
        <AccountCard a={sum.total} total />
      </div>
      <div className="grid-2 section-gap">
        <div>
          <h3 className="sub-section-title">Par moyen de paiement</h3>
          {sum.methods.length ? (
            <dl className="calc">{sum.methods.map((x) => (
              <div key={x.method}><dt>{x.method} <span className="subtle">({x.n})</span></dt><dd>{money(x.total)}</dd></div>
            ))}</dl>
          ) : <p className="subtle">Aucun encaissement sur la période.</p>}
        </div>
        <div>
          <h3 className="sub-section-title">Exports CSV</h3>
          <div className="form-grid">
            <label className="field"><span>Sous-compte</span>
              <select value={account} onChange={(e) => onAccount(e.target.value)}>
                <option value="">Tous les sous-comptes</option>
                {Object.entries(ACCOUNT_LABEL).map(([k, label]) => <option key={k} value={k}>{label}</option>)}
              </select></label>
            <div className="row">{EXPORTS.map(([kind, label]) => exportLink(kind, label))}</div>
            <p className="subtle">Format CSV (séparateur « ; »), lisible dans Excel ou LibreOffice. Les montants sont exprimés en {currency}.</p>
          </div>
        </div>
      </div>
    </details>
  );
}
