// « Recettes »: the summary by type, then every recette of the period, newest first, and the total.
import { Link } from 'react-router-dom';
import Icon from '../ui/Icon.jsx';
import { DemoChip } from '../ui/ui.jsx';
import { CashRow, EntryCancel, TotalLine, metaLine } from './CashRow.jsx';
import { receiptRows, receiptSummary } from './flows.js';
import { formatTicketNumber } from '../../../shared/ticket.js';
import { CARD_METHOD } from '../../../shared/rules.js';
import { money, paymentMethodText, paymentPurpose } from '../../lib/format.js';

const ticketLink = (id, label) => <Link to={`/caisse/ticket/${id}`} aria-label={label}>{formatTicketNumber(id)}</Link>;
const memberLink = (id, name) => (id ? <Link to={`/membres/${id}`}>{name}</Link> : name);

// What a sale paid for: its lines' labels, each once.
const saleTitle = (p) => paymentPurpose(p) ?? ([...new Set((p.allocations ?? []).map((a) => a.label))].join(', ') || 'Encaissement');

function Row({ row, isAdmin, onChange }) {
  if (row.type === 'payment') {
    const { p } = row;
    return (
      <CashRow
        title={<>{saleTitle(p)}{p.cancelled_at && <> <span className="chip chip-danger" title={p.cancel_reason ?? ''}>annulé</span></>}</>}
        meta={metaLine(row.when, ticketLink(p.id, `Ticket ${formatTicketNumber(p.id)}`), memberLink(p.member_id, p.member_name),
          <>{paymentMethodText(p)}{p.reference ? ` ${p.reference}` : ''}</>, p.kind === 'recharge' && 'hors total')}
        note={p.cancelled_at && p.cancel_reason ? `Annulé : ${p.cancel_reason}` : null}
        amount={p.amount} sign="+" cancelled={!!p.cancelled_at}
      />
    );
  }
  if (row.type === 'refund') {
    const { r } = row;
    const card = r.card_amount ?? 0;
    const method = card && r.method !== CARD_METHOD ? `${CARD_METHOD} ${money(card)} + ${r.method} ${money(r.amount - card)}` : r.method;
    return (
      <CashRow
        title={`Remboursement : ${r.label}`}
        meta={metaLine(row.when, ticketLink(r.payment_id, `Ticket d’origine ${formatTicketNumber(r.payment_id)}`), memberLink(r.member_id, r.member_name), method)}
        note={`Motif : ${r.reason}`}
        amount={r.amount} sign="−"
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

export default function ReceiptsBlock({ journal, entries, oneDay, isAdmin, onChange, title = 'Recettes' }) {
  const sum = receiptSummary(journal, entries);
  const rows = receiptRows(journal, entries, oneDay);
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
            {sum.recharges > 0 && (
              <div><dt>Approvisionnements cartes <span className="subtle">(hors total)</span></dt><dd>{money(sum.recharges)}</dd></div>
            )}
          </dl>
          {sum.recharges > 0 && (
            <p className="subtle cash-note">L’argent mis sur les cartes est dans la caisse ; il devient une recette quand le membre consomme.</p>
          )}
          <h3 className="sub-section-title cash-list-title">Détail ({rows.length})</h3>
          <div className="list">{rows.map((row) => <Row key={row.key} row={row} isAdmin={isAdmin} onChange={onChange} />)}</div>
          <TotalLine label="Total des recettes" amount={sum.total} />
        </>
      ) : <p className="subtle">Aucune recette sur la période.</p>}
    </section>
  );
}
