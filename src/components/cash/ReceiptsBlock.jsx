// « Recettes »: the money received in the period, by type, then every recette, newest first, and the total. A sale
// paid with the member's card stays listed, its amount muted: that money was received with the recharge.
import { Link } from 'react-router-dom';
import Icon from '../ui/Icon.jsx';
import { DemoChip } from '../ui/ui.jsx';
import { CashRow, EntryCancel, TotalLine, metaLine } from './CashRow.jsx';
import { cashOf, onAccount, paymentAdds, receiptSummary } from './flows.js';
import { bizDayOf, entryWhen, whenText } from './when.js';
import { formatTicketNumber } from '../../../shared/ticket.js';
import { money, paymentPurpose } from '../../lib/format.js';

const ticketLink = (id, label) => <Link to={`/caisse/ticket/${id}`} aria-label={label}>{formatTicketNumber(id)}</Link>;
const memberLink = (id, name) => (id ? <Link to={`/membres/${id}`}>{name}</Link> : name);

// What a sale paid for: its lines' labels, each once.
const saleTitle = (p) => paymentPurpose(p) ?? ([...new Set((p.allocations ?? []).map((a) => a.label))].join(', ') || 'Encaissement');

// Every recette of the period on the account shown, newest first: the payments (sales, card recharges, outside
// meals), the refunds (money given back) and the other receipts typed in the ledger.
function receiptRows(journal, entries, method, oneDay) {
  const rows = [
    ...journal.payments.filter((p) => onAccount(method, p.method))
      .map((p) => ({ type: 'payment', key: `P-${p.id}`, ms: Date.parse(p.paid_at), when: whenText(p.paid_at, oneDay), p })),
    ...journal.refunds.filter((r) => onAccount(method, r.method))
      .map((r) => ({ type: 'refund', key: `R-${r.id}`, ms: Date.parse(r.created_at), when: whenText(r.created_at, oneDay), r })),
    ...entries.filter((e) => e.kind === 'recette' && onAccount(method, e.method)).map((e) => {
      const w = entryWhen(e, oneDay);
      return { type: 'entry', key: `E-${e.id}`, ms: w.ms, when: w.text, e };
    }),
  ];
  return rows.sort((x, y) => y.ms - x.ms);
}

function Row({ row, to, isAdmin, onChange }) {
  if (row.type === 'payment') {
    const { p } = row;
    const card = p.card_amount ?? 0;
    const cash = cashOf(p);
    const adds = paymentAdds(p, to, bizDayOf);
    return (
      <CashRow
        title={<>{saleTitle(p)}{p.cancelled_at && <> <span className="chip chip-danger" title={p.cancel_reason ?? ''}>annulé</span></>}</>}
        meta={metaLine(row.when, ticketLink(p.id, `Ticket ${formatTicketNumber(p.id)}`), memberLink(p.member_id, p.member_name),
          cash ? <>{p.method}{p.reference ? ` ${p.reference}` : ''}</> : null, card > 0 && cash > 0 && `dont ${money(card)} par carte`)}
        note={cash === 0 ? 'Payé par carte membre : non compté' : p.cancelled_at && p.cancel_reason ? `Annulé : ${p.cancel_reason}` : null}
        amount={cash || p.amount} sign={cash ? '+' : ''} quiet={cash === 0} cancelled={!!p.cancelled_at && adds === 0 && cash > 0}
      />
    );
  }
  if (row.type === 'refund') {
    const { r } = row;
    const card = r.card_amount ?? 0;
    const cash = cashOf(r);
    return (
      <CashRow
        title={`Remboursement : ${r.label}`}
        meta={metaLine(row.when, ticketLink(r.payment_id, `Ticket d’origine ${formatTicketNumber(r.payment_id)}`), memberLink(r.member_id, r.member_name),
          cash ? r.method : null, card > 0 && cash > 0 && `dont ${money(card)} rendus sur la carte`)}
        note={cash === 0 ? `Rendu sur la carte membre : non compté · ${r.reason}` : `Motif : ${r.reason}`}
        amount={cash || r.amount} sign={cash ? '−' : ''} quiet={cash === 0}
      />
    );
  }
  const { e } = row;
  const cancelled = e.status !== 'active';
  return (
    <CashRow
      title={<>{e.label} <DemoChip on={e.is_demo} />{cancelled && <> <span className="chip">annulée</span></>}</>}
      meta={metaLine(row.when, 'Entrée diverse', e.category_name, e.method, e.reference, e.created_by_name && `par ${e.created_by_name}`)}
      note={cancelled && e.cancel_reason ? `Annulée par ${e.cancelled_by_name} : ${e.cancel_reason}` : null}
      amount={e.amount} sign="+" cancelled={cancelled}
      action={<EntryCancel e={e} isAdmin={isAdmin} onDone={onChange} />}
    />
  );
}

export default function ReceiptsBlock({ journal, entries, method = '', oneDay, isAdmin, onChange, title = 'Recettes' }) {
  const to = journal.to ?? journal.from;
  const sum = receiptSummary(journal, entries, { method, to, dayOf: bizDayOf });
  const rows = receiptRows(journal, entries, method, oneDay);
  return (
    <section className="card cash-block" id="caisse-recettes" aria-labelledby="caisse-recettes-title">
      <div className="card-head">
        <h2 id="caisse-recettes-title"><Icon name="deposit" /> {title}</h2>
        <span className="cash-block-total amount-in">{money(sum.total)}</span>
      </div>
      {rows.length ? (
        <>
          <dl className="calc cash-summary">
            {sum.lines.filter(([, v]) => v).map(([label, v, account]) => (
              <div key={label}><dt>{account && <i className={`dot dot-${account}`} />} {label}</dt><dd>{money(v)}</dd></div>
            ))}
            {sum.refunds > 0 && <div><dt>Remboursements</dt><dd>−{money(sum.refunds)}</dd></div>}
            <div className="total"><dt>Total des recettes</dt><dd>{money(sum.total)}</dd></div>
          </dl>
          {sum.card > 0 && (
            <p className="subtle cash-note">Payé par carte membre : {money(sum.card)} — déjà encaissé lors de l’approvisionnement, non compté.</p>
          )}
          <h3 className="sub-section-title cash-list-title">Détail ({rows.length})</h3>
          <div className="list">{rows.map((row) => <Row key={row.key} row={row} to={to} isAdmin={isAdmin} onChange={onChange} />)}</div>
          <TotalLine label="Total des recettes" amount={sum.total} />
        </>
      ) : <p className="subtle">Aucune recette sur la période.</p>}
    </section>
  );
}
