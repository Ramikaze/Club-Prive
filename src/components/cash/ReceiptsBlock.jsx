// « Recettes »: the money received in the period, grouped by nature (subscriptions, sales, card recharges…), each
// group folding its recettes, newest first, then one total. What the member's card paid comes apart, muted: that
// money was received with the recharge.
import { Link } from 'react-router-dom';
import Icon from '../ui/Icon.jsx';
import { DemoChip } from '../ui/ui.jsx';
import { CashRow, EntryCancel, TotalLine, metaLine } from './CashRow.jsx';
import { cancelledBy, cashOf, onAccount, paymentAdds, receiptSummary, saleCashByAccount } from './flows.js';
import { bizDayOf, entryWhen, whenText } from './when.js';
import { formatTicketNumber } from '../../../shared/ticket.js';
import { money, paymentPurpose } from '../../lib/format.js';
import { RAYONS, RAYON_LABEL } from '../../../shared/roles.js';

const ticketLink = (id, label) => <Link to={`/caisse/ticket/${id}`} aria-label={label}>{formatTicketNumber(id)}</Link>;
// The day client has no file (it answers 404): his name is text only.
const memberLink = (id, name, kind) => (id && kind !== 'journalier' ? <Link to={`/membres/${id}`}>{name}</Link> : name);

// A Boutique row's tag and its buyer with his type (the day client's name already says it).
const shopTag = (account) => <span className="chip" key="tag">Boutique {RAYON_LABEL[account]}</span>;
const BUYER_TYPE = { client: 'client régulier', membre: 'membre' };
const buyerOf = (kind, id, name) => <>{memberLink(id, name, kind)}{BUYER_TYPE[kind] && <span className="subtle"> ({BUYER_TYPE[kind]})</span>}</>;

// What a sale paid for: its lines' labels, each once. A Boutique sale names its products with their quantities.
const saleTitle = (p) => {
  const lines = p.allocations ?? [];
  if (p.shop_sale_id && lines.length) return lines.map((a) => `${a.quantity > 1 ? `${a.quantity}× ` : ''}${a.label}`).join(', ');
  return paymentPurpose(p) ?? ([...new Set(lines.map((a) => a.label))].join(', ') || 'Encaissement');
};

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

// The groups, in this order. A row's nature, and what it counts in the total, as receiptSummary counts it, so the
// groups add up to the total.
const GROUPS = [['abonnement', 'Abonnements'], ['vente', 'Ventes et réservations'], ['boutique', 'Boutique'], ['repas', 'Repas extérieurs'],
  ['recharge', 'Recharges cartes'], ['entree', 'Entrées diverses'], ['refund', 'Remboursements']];

function natureOf(row) {
  if (row.type === 'entry') return 'entree';
  if (row.type === 'refund') return cashOf(row.r) === 0 ? 'card' : row.r.shop_sale_id ? 'boutique' : 'refund';
  const { p } = row;
  if (cashOf(p) === 0) return 'card';
  if (p.shop_sale_id) return 'boutique';
  return ['abonnement', 'recharge', 'repas'].includes(p.kind) ? p.kind : 'vente';
}

function countedOf(row, to) {
  if (row.type === 'entry') return row.e.status === 'active' ? row.e.amount : 0;
  if (row.type === 'refund') return -cashOf(row.r);
  const { p } = row;
  if (p.kind === 'recharge') return paymentAdds(p, to, bizDayOf);
  if (p.kind === 'repas') return cancelledBy(p, to, bizDayOf) ? 0 : cashOf(p);
  return Object.values(saleCashByAccount(p)).reduce((a, b) => a + b, 0);
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
        meta={metaLine(row.when, p.shop_sale_id && shopTag(p.shop_account), ticketLink(p.id, `Ticket ${formatTicketNumber(p.id)}`),
          p.shop_sale_id ? buyerOf(p.buyer_kind, p.member_id, p.member_name) : memberLink(p.member_id, p.member_name),
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
        meta={metaLine(row.when, r.shop_sale_id && shopTag(r.account), ticketLink(r.payment_id, `Ticket d’origine ${formatTicketNumber(r.payment_id)}`),
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

// `emptyText`: what the block says when nothing was received, worded after its title.
export default function ReceiptsBlock({
  journal, entries, method = '', oneDay, isAdmin, onChange, title = 'Recettes', emptyText = 'Aucune recette sur la période.', shopSplit = false,
}) {
  const to = journal.to ?? journal.from;
  const sum = receiptSummary(journal, entries, { method, to, dayOf: bizDayOf });
  const rows = receiptRows(journal, entries, method, oneDay);
  const groups = GROUPS.map(([nature, label]) => {
    const list = rows.filter((row) => natureOf(row) === nature);
    return { nature, label, list, amount: list.reduce((s, row) => s + countedOf(row, to), 0) };
  }).filter((g) => g.list.length);
  const byCard = rows.filter((row) => natureOf(row) === 'card');
  // The Boutique group's two sub-totals (bosses): each rayon's sales less what its cancellations gave back.
  const rayonOf = (row) => (row.type === 'refund' ? row.r.account : row.p.shop_account);
  const rayonTotal = (g, a) => g.list.filter((row) => rayonOf(row) === a).reduce((s, row) => s + countedOf(row, to), 0);
  const rowList = (list) => <div className="list">{list.map((row) => <Row key={row.key} row={row} to={to} isAdmin={isAdmin} onChange={onChange} />)}</div>;
  return (
    <section className="card cash-block" id="caisse-recettes" aria-labelledby="caisse-recettes-title">
      <div className="card-head">
        <h2 id="caisse-recettes-title"><Icon name="deposit" /> {title}</h2>
        <span className="cash-block-total amount-in">{money(sum.total)}</span>
      </div>
      {rows.length ? (
        <>
          {groups.length > 0 && <h3 className="sub-section-title cash-group-title">Argent reçu</h3>}
          {groups.map((g) => (
            <details key={g.nature} className="cash-group" open>
              <summary>
                <span>{g.label} <span className="subtle">({g.list.length})</span></span>
                <span className="num">{g.amount < 0 ? '−' : ''}{money(Math.abs(g.amount))}</span>
              </summary>
              {shopSplit && g.nature === 'boutique' && (
                <dl className="calc cash-shop-split">
                  {RAYONS.map((a) => <div key={a}><dt>Boutique {RAYON_LABEL[a]}</dt><dd>{money(rayonTotal(g, a))}</dd></div>)}
                </dl>
              )}
              {rowList(g.list)}
            </details>
          ))}
          <TotalLine label="Total encaissé" amount={sum.total} />
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
