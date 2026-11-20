// « Recettes »: the money received in the period, grouped by nature (subscriptions, sales, card recharges…), each
// group closed on its count and amount, then one total. The cancelled operations come apart under the total, in one
// fold; what the member's card paid comes apart too, muted: that money was received with the recharge.
import { Link } from 'react-router-dom';
import Icon from '../ui/Icon.jsx';
import { CancelledChip, DemoChip } from '../ui/ui.jsx';
import { CancelledFold, CashRow, EntryCancel, TotalLine, metaLine } from './CashRow.jsx';
import { cashOf, onAccount, receiptSummary } from './flows.js';
import { isCancelledRow, shopRayons, splitReceipts } from './receiptGroups.js';
import { bizDayOf, entryWhen, whenText } from './when.js';
import { money, paymentPurpose } from '../../lib/format.js';
import { RAYON_LABEL } from '../../../shared/roles.js';

// A sale or a refund's title opens its ticket.
const ticketTitle = (id, text) => <Link to={`/caisse/ticket/${id}`}>{text}</Link>;
// The day client has no file (it answers 404): his name is text only.
const memberLink = (id, name, kind) => (id && kind !== 'journalier' ? <Link to={`/membres/${id}`}>{name}</Link> : name);

// A Boutique row's buyer with his type (the day client's name already says it).
const BUYER_TYPE = { client: 'client régulier', membre: 'membre' };
const buyerOf = (kind, id, name) => <>{memberLink(id, name, kind)}{BUYER_TYPE[kind] && <span className="subtle"> ({BUYER_TYPE[kind]})</span>}</>;

// What a sale paid for: its lines' labels, each once. A Boutique sale names its products with their quantities.
const saleTitle = (p) => {
  const lines = p.allocations ?? [];
  if (p.shop_sale_id && lines.length) return lines.map((a) => `${a.quantity > 1 ? `${a.quantity}× ` : ''}${a.label}`).join(', ');
  return paymentPurpose(p) ?? ([...new Set(lines.map((a) => a.label))].join(', ') || 'Encaissement');
};

const signed = (amount) => `${amount < 0 ? '−' : ''}${money(Math.abs(amount))}`;

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

// One recette on two levels: what it is and its amount, then when · who · how. What its group already says is left
// out (« Entrée diverse », the « Boutique » tag: only the rayon stays).
function Row({ row, to, isAdmin, onChange }) {
  if (row.type === 'payment') {
    const { p } = row;
    const card = p.card_amount ?? 0;
    const cash = cashOf(p);
    const struck = isCancelledRow(row, to, bizDayOf);
    return (
      <CashRow
        title={<>{ticketTitle(p.id, saleTitle(p))}{p.cancelled_at && !struck && <> <CancelledChip title={p.cancel_reason ?? ''} /></>}</>}
        meta={metaLine(row.when, p.shop_sale_id && RAYON_LABEL[p.shop_account],
          p.shop_sale_id ? buyerOf(p.buyer_kind, p.member_id, p.member_name) : memberLink(p.member_id, p.member_name),
          cash ? <>{p.method}{p.reference ? ` ${p.reference}` : ''}</> : null, card > 0 && cash > 0 && `dont ${money(card)} par carte`)}
        note={cash === 0 ? 'Payé par carte membre : non compté'
          : p.cancelled_at && p.cancel_reason ? `Annulé${p.cancelled_by_name ? ` par ${p.cancelled_by_name}` : ''} : ${p.cancel_reason}` : null}
        amount={cash || p.amount} sign={cash ? '+' : ''} quiet={cash === 0} cancelled={struck}
      />
    );
  }
  if (row.type === 'refund') {
    const { r } = row;
    const card = r.card_amount ?? 0;
    const cash = cashOf(r);
    return (
      <CashRow
        title={ticketTitle(r.payment_id, `Remboursement : ${r.label}`)}
        meta={metaLine(row.when, r.shop_sale_id && RAYON_LABEL[r.account],
          r.shop_sale_id ? buyerOf(r.buyer_kind, r.member_id, r.member_name) : memberLink(r.member_id, r.member_name, r.buyer_kind),
          cash ? r.method : null, card > 0 && cash > 0 && `dont ${money(card)} rendus sur la carte`,
          r.shop_sale_id && r.created_by_name && `par ${r.created_by_name}`)}
        note={cash === 0 ? `Rendu sur la carte membre : non compté · ${r.reason}` : `Motif : ${r.reason}`}
        amount={cash || r.amount} sign={cash ? '−' : ''} quiet={cash === 0}
      />
    );
  }
  const { e } = row;
  const cancelled = e.status !== 'active';
  const by = e.cancelled_by_name ? ` par ${e.cancelled_by_name}` : '';
  return (
    <CashRow
      title={<>{e.label} <DemoChip on={e.is_demo} /></>}
      meta={metaLine(row.when, e.category_name, e.method, e.reference, e.created_by_name && `par ${e.created_by_name}`)}
      note={cancelled ? `Annulée${by}${e.cancel_reason ? ` : ${e.cancel_reason}` : ''}` : null}
      amount={e.amount} sign="+" cancelled={cancelled}
      action={<EntryCancel e={e} isAdmin={isAdmin} onDone={onChange} />}
    />
  );
}

// The Boutique group's money by rayon (for the bosses), on one small line under its title; the empty rayons left out.
function ShopSplit({ group }) {
  const parts = shopRayons(group);
  if (!parts.length) return null;
  return (
    <span className="subtle cash-group-sub">
      {parts.map(({ account, amount }, i) => <span key={account}>{i ? ' · ' : ''}<span>{RAYON_LABEL[account]} {signed(amount)}</span></span>)}
    </span>
  );
}

// `emptyText`: what the block says when nothing was received, worded after its title.
export default function ReceiptsBlock({
  journal, entries, method = '', oneDay, isAdmin, onChange, title = 'Recettes', emptyText = 'Aucune recette sur la période.', shopSplit = false,
}) {
  const to = journal.to ?? journal.from;
  const sum = receiptSummary(journal, entries, { method, to, dayOf: bizDayOf });
  const rows = receiptRows(journal, entries, method, oneDay);
  const { groups, cancelled, byCard } = splitReceipts(rows, to, bizDayOf);
  const rowList = (list) => <div className="list">{list.map((row) => <Row key={row.key} row={row} to={to} isAdmin={isAdmin} onChange={onChange} />)}</div>;
  return (
    <section className="card cash-block cash-block-plain" id="caisse-recettes" aria-labelledby="caisse-recettes-title">
      <div className="card-head">
        <h2 id="caisse-recettes-title"><Icon name="deposit" /> {title}</h2>
        <span className="cash-block-total amount-in">{money(sum.total)}</span>
      </div>
      {rows.length ? (
        <>
          {groups.length > 0 && <h3 className="sub-section-title cash-group-title">Argent reçu</h3>}
          {groups.map((g) => (
            <details key={g.nature} className="cash-group">
              <summary>
                <span>
                  {g.label} <span className="subtle">({g.list.length})</span>
                  {shopSplit && g.nature === 'boutique' && <ShopSplit group={g} />}
                </span>
                <span className="num">{signed(g.amount)}</span>
              </summary>
              {rowList(g.list)}
            </details>
          ))}
          <TotalLine label="Total encaissé" amount={sum.total} />
          <CancelledFold count={cancelled.length}>{rowList(cancelled)}</CancelledFold>
          {byCard.length > 0 && (
            <details className="cash-group cash-group-card">
              <summary>
                <span><Icon name="card" /> Payé par carte membre, non compté <span className="subtle">({byCard.length})</span></span>
                <span className="num">{money(sum.card)}</span>
              </summary>
              <p className="subtle cash-note">Déjà encaissé lors de l’approvisionnement de la carte.</p>
              {rowList(byCard)}
            </details>
          )}
        </>
      ) : <p className="subtle">{emptyText}</p>}
    </section>
  );
}
