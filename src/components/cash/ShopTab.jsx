// Caisse › Boutique (administrator and associés): the counter sales of the period in two columns, Boutique Cigares
// and Boutique Champagne. Each column has its total and count, the totals by kind of buyer and by payment method
// (the member's card apart), the period's sales (a cancelled one struck through) and its cancellations as
// negative lines. The administrator and the rayon's associé cancel a whole sale, with a reason.
import { Link } from 'react-router-dom';
import Icon from '../ui/Icon.jsx';
import { actionDialog } from '../ui/Modal.jsx';
import { toast } from '../ui/toast.jsx';
import { Loaded, PageHead } from '../ui/ui.jsx';
import PeriodPicker, { usePeriod } from '../ui/PeriodPicker.jsx';
import CashTabs from './CashTabs.jsx';
import { CashRow, metaLine } from './CashRow.jsx';
import { api, qs } from '../../lib/api.js';
import { dateTime, dayLabel, money, paymentMethodText } from '../../lib/format.js';
import { useLoad } from '../../lib/hooks.js';
import { useMe } from '../../store/useStore.js';
import { CARD_METHOD } from '../../../shared/rules.js';
import { RAYONS, RAYON_LABEL, ownsAccount } from '../../../shared/roles.js';

const BUYERS = [['journalier', 'Clients journaliers'], ['client', 'Clients réguliers'], ['membre', 'Membres']];
const BUYER_TYPE = { client: 'client régulier', membre: 'membre' };

// The ticket of a payment, from its id or from its number « T-000123 ».
const ticketLink = (id, number) => (id ? <Link to={`/caisse/ticket/${id}`} aria-label={`Ticket ${number}`}>{number}</Link> : null);

const productsOf = (sale) => sale.lines.map((l) => `${l.quantity > 1 ? `${l.quantity}× ` : ''}${l.label}`).join(', ');

// The day client has no file: his name is text only.
function Buyer({ sale }) {
  const name = sale.member_id ? <Link to={`/membres/${sale.member_id}`}>{sale.member_name}</Link> : sale.member_name;
  return <>{name}{BUYER_TYPE[sale.buyer_kind] && <span className="subtle"> ({BUYER_TYPE[sale.buyer_kind]})</span>}</>;
}

function cancelSale(sale, onDone) {
  return actionDialog({
    title: 'Annuler cette vente',
    message: `Vente ${sale.ticket_number ?? ''} de ${money(sale.amount)}. Toute la vente est annulée : les produits reviennent en stock, l’argent est rendu par le moyen utilisé (la part payée par carte revient sur la carte du membre). La vente reste visible, barrée, avec le motif.`,
    reasonLabel: 'Motif de l’annulation',
    confirmLabel: 'Annuler la vente',
    danger: true,
    run: async ({ reason }) => {
      await api.post(`/api/shop/sales/${sale.id}/cancel`, { reason });
      toast('Vente annulée.');
      onDone();
    },
  });
}

function SaleRow({ sale, canCancel, onDone }) {
  const cancelled = !!sale.cancelled_at;
  return (
    <CashRow
      title={<>{productsOf(sale)}{cancelled && <> <span className="chip chip-danger">annulée</span></>}</>}
      meta={metaLine(dateTime(sale.created_at), ticketLink(sale.payment_id, sale.ticket_number), <Buyer sale={sale} />,
        sale.method && paymentMethodText(sale), sale.created_by_name && `par ${sale.created_by_name}`)}
      note={cancelled ? `Annulée le ${dateTime(sale.cancelled_at)}${sale.cancelled_by_name ? ` par ${sale.cancelled_by_name}` : ''} : ${sale.cancel_reason ?? ''}` : null}
      amount={sale.amount} cancelled={cancelled}
      action={canCancel && !cancelled && (
        <button type="button" className="btn btn-sm btn-ghost" onClick={() => cancelSale(sale, onDone)}>
          Annuler<span className="sr-only"> la vente {sale.ticket_number}</span>
        </button>
      )}
    />
  );
}

// What went back in the period for a cancelled sale: a negative line (the server gives the amount positive).
function CancellationRow({ c }) {
  const id = Number(c.ticket_number?.slice(2)) || null;
  return (
    <CashRow
      title={`Annulation de la vente ${c.ticket_number ?? ''}`}
      meta={metaLine(dateTime(c.at), ticketLink(id, c.ticket_number), c.cancelled_by_name && `par ${c.cancelled_by_name}`)}
      note={`Motif : ${c.reason ?? ''}`}
      amount={c.amount} sign="−"
    />
  );
}

function Column({ col, canCancel, onDone }) {
  const methods = [...col.by_method.filter((x) => x.method !== CARD_METHOD), ...col.by_method.filter((x) => x.method === CARD_METHOD)];
  return (
    <section className="card cash-block" aria-labelledby={`boutique-${col.account}`}>
      <div className="card-head">
        <h2 id={`boutique-${col.account}`}><Icon name="shop" /> Boutique {RAYON_LABEL[col.account]}</h2>
        <span className="cash-block-total">{money(col.total)}</span>
      </div>
      <p className="subtle cash-note">{col.count} vente{col.count > 1 ? 's' : ''} sur la période</p>
      <h3 className="sub-section-title cash-list-title">Par type d’acheteur</h3>
      <dl className="calc">{BUYERS.map(([k, label]) => <div key={k}><dt>{label}</dt><dd>{money(col.by_buyer[k] ?? 0)}</dd></div>)}</dl>
      <h3 className="sub-section-title cash-list-title">Par moyen de paiement</h3>
      {methods.length ? (
        <dl className="calc">{methods.map((x) => <div key={x.method}><dt>{x.method}</dt><dd>{money(x.total)}</dd></div>)}</dl>
      ) : <p className="subtle">Aucune vente sur la période.</p>}
      <h3 className="sub-section-title cash-list-title">Ventes <span className="subtle">({col.sales.length})</span></h3>
      {col.sales.length ? (
        <div className="list">{col.sales.map((s) => <SaleRow key={s.id} sale={s} canCancel={canCancel} onDone={onDone} />)}</div>
      ) : <p className="subtle">Aucune vente sur la période.</p>}
      {col.cancellations.length > 0 && (
        <>
          <h3 className="sub-section-title cash-list-title">Annulations <span className="subtle">({col.cancellations.length})</span></h3>
          <div className="list">{col.cancellations.map((c) => <CancellationRow key={c.sale_id} c={c} />)}</div>
        </>
      )}
    </section>
  );
}

export default function ShopTab() {
  const me = useMe();
  const period = usePeriod('today');
  const { from, to } = period;
  const state = useLoad(() => api.get(`/api/shop/summary${qs({ from, to })}`), [from, to]);
  return (
    <>
      <PageHead title="Caisse" lead={from === to ? dayLabel(from, 'title') : `Du ${dayLabel(from, 'medium')} au ${dayLabel(to, 'medium')}`} />
      <CashTabs />
      <div className="toolbar"><PeriodPicker period={period} /></div>
      <Loaded state={state}>{(d) => (
        <div className="cash-page">
          <div className="cash-columns">
            <div className="cash-columns-inner">
              {RAYONS.map((a) => <Column key={a} col={d.accounts[a]} canCancel={ownsAccount(me, a)} onDone={state.reload} />)}
            </div>
          </div>
          <p className="subtle cash-note">
            Ces ventes comptent aussi dans les comptes Cigares et Alcool de l’onglet Caisse. Une vente payée par carte membre ne fait pas
            entrer d’argent en caisse : cet argent est entré lors de l’approvisionnement de la carte.
          </p>
        </div>
      )}</Loaded>
    </>
  );
}
