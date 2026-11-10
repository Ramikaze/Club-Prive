// Caisse › « Offerts »: the products the associés gave away in a period (worker/gifts.js). Per associé, the total at
// cost price of the gifts not cancelled; then each gift, with its cancellation for whoever may. No money: none of these
// figures is in a caisse. An associé sees his rayon only (the server sends nothing else).
import { Link } from 'react-router-dom';
import { actionDialog } from '../ui/Modal.jsx';
import { toast } from '../ui/toast.jsx';
import { CancelledChip, Empty, Loaded, PageHead } from '../ui/ui.jsx';
import PeriodPicker, { usePeriod } from '../ui/PeriodPicker.jsx';
import CashTabs from './CashTabs.jsx';
import { CashRow, metaLine } from './CashRow.jsx';
import { api, newKey, qs } from '../../lib/api.js';
import { dateTime, dayLabel, money } from '../../lib/format.js';
import { useLoad } from '../../lib/hooks.js';
import { RAYON_LABEL } from '../../../shared/roles.js';

function cancelGift(g, onDone) {
  // One key for the dialog: a retry after a lost answer is the same cancellation, not a « déjà annulé » error.
  const key = newKey();
  return actionDialog({
    title: 'Annuler ce cadeau',
    message: `${g.quantity} × ${g.product_name}, offert par ${g.given_by_name}. Le produit revient en stock ; le cadeau reste visible, barré, avec le motif.`,
    reasonLabel: 'Motif de l’annulation',
    confirmLabel: 'Annuler le cadeau',
    danger: true,
    run: async ({ reason }) => {
      await api.post(`/api/gifts/${g.id}/cancel`, { reason }, key);
      toast('Cadeau annulé.');
      onDone();
    },
  });
}

function GiftRow({ g, onDone }) {
  const cancelled = !!g.cancelled_at;
  return (
    <CashRow
      title={<>{g.quantity > 1 ? `${g.quantity}× ` : ''}{g.product_name}{cancelled && <> <CancelledChip /></>}</>}
      meta={metaLine(
        dateTime(g.created_at), `par ${g.given_by_name}`,
        g.member_id ? <>à <Link to={`/membres/${g.member_id}`}>{g.member_name}</Link></> : 'client de passage',
        g.total_cost === null ? 'prix de revient à renseigner' : 'au prix de revient',
        `vendu ${money(g.total_price)}`, g.reason,
      )}
      note={cancelled ? `Annulé le ${dateTime(g.cancelled_at)}${g.cancelled_by_name ? ` par ${g.cancelled_by_name}` : ''} : ${g.cancel_reason ?? ''}` : null}
      amount={g.total_cost ?? 0} cancelled={cancelled}
      action={g.can_cancel && (
        <button type="button" className="btn btn-sm btn-ghost" onClick={() => cancelGift(g, onDone)}>
          Annuler le cadeau<span className="sr-only"> : {g.product_name}</span>
        </button>
      )}
    />
  );
}

export default function GiftsTab() {
  const period = usePeriod('today');
  const { from, to } = period;
  const state = useLoad((signal) => api.get(`/api/gifts${qs({ from, to })}`, { signal }), [from, to]);
  return (
    <>
      <PageHead title="Caisse" lead={from === to ? dayLabel(from, 'title') : `Du ${dayLabel(from, 'medium')} au ${dayLabel(to, 'medium')}`} />
      <CashTabs />
      <div className="toolbar"><PeriodPicker period={period} /></div>
      <Loaded state={state}>{(d) => (
        <div className="stack-cards">
          <section className="card">
            <div className="card-head"><h2>Par associé</h2></div>
            {d.by_associate.length ? (
              <div className="list">{d.by_associate.map((a) => (
                <div className="list-item" key={`${a.user_id}-${a.account}`}>
                  <div className="grow">
                    <div className="title">{a.name}</div>
                    <div className="meta">{metaLine(RAYON_LABEL[a.account], `${a.quantity} produit${a.quantity > 1 ? 's' : ''} offert${a.quantity > 1 ? 's' : ''}`,
                      a.missing_cost > 0 && `${a.missing_cost} sans prix de revient (comptés à 0)`)}</div>
                  </div>
                  <strong className="num">{money(a.total_cost)}</strong>
                </div>
              ))}</div>
            ) : <Empty>Aucun produit offert sur la période.</Empty>}
          </section>
          <section className="card">
            <div className="card-head"><h2>Cadeaux <span className="subtle">({d.gifts.length})</span></h2></div>
            {d.gifts.length
              ? <div className="list">{d.gifts.map((g) => <GiftRow key={g.id} g={g} onDone={state.reload} />)}</div>
              : <Empty>Aucun cadeau sur la période.</Empty>}
            <p className="subtle">Un cadeau ne fait entrer ni sortir aucun argent : il sort le produit du stock et il est compté au prix de revient du jour où il a été fait.</p>
          </section>
        </div>
      )}</Loaded>
    </>
  );
}
