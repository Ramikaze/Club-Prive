import { useRef, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import Icon from '../components/ui/Icon.jsx';
import { AccountTag, Chip, Empty, FormError, Hypothesis, Loaded, PageHead } from '../components/ui/ui.jsx';
import { toast } from '../components/ui/toast.jsx';
import { actionDialog } from '../components/ui/Modal.jsx';
import { api, newKey } from '../lib/api.js';
import { money, fmtDuration, dayLabel, dateTime, ACCOUNT_LABEL } from '../lib/format.js';
import { ACTION_LABELS, auditSummary } from '../lib/audit.js';
import { useBusy, useLoad, useSubmit } from '../lib/hooks.js';
import { useIsAdmin } from '../store/useStore.js';
import {
  openExtendDialog, openCancelReservationDialog, openPaymentDialog, openRefundDialog, cancelChargeDialog, supplementText, canRefund,
} from '../dialogs/index.js';

const groups = [['cigare', 'Cigares (vente à l’unité)'], ['bouteille', 'Bouteilles (entières uniquement)']];

function ReservationDetail({ d, products, reload }) {
  const isAdmin = useIsAdmin();
  const r = d.reservation;
  const sub = d.subscription;
  // One key per loaded page, as in vanilla: renewed after each recorded consumption.
  const itemKey = useRef(newKey());
  const [productId, setProductId] = useState('');
  const [quantity, setQuantity] = useState('1');
  const item = useSubmit();
  const start = useBusy();
  const due = d.charges.filter((c) => c.status === 'due');
  const dueTotal = due.reduce((sum, c) => sum + c.amount, 0);
  const nextDay = r.end_date > r.biz_day ? ' (lendemain)' : '';
  const totals = Object.entries(d.totals);
  const anyLine = d.charges.length > 0;

  const lineActions = (c) => (
    <>
      {c.status === 'due' && (c.kind === 'produit' || isAdmin) ? <button type="button" className="btn btn-sm btn-ghost" onClick={() => cancelChargeDialog(c, reload)}>Annuler</button> : null}
      {c.status === 'payee' && canRefund() ? <button type="button" className="btn btn-sm btn-ghost" onClick={() => openRefundDialog(c, reload)}>Rembourser</button> : null}
    </>
  );

  const onStart = () => start.run(async () => {
    await api.post(`/api/reservations/${r.id}/start`, {});
    toast('Arrivée enregistrée : réservation en cours.');
    reload();
  });

  const onFinish = () => actionDialog({
    title: 'Terminer la réservation',
    message: `Les ${fmtDuration(r.included_minutes)} incluses engagées seront comptées comme consommées.${dueTotal ? ` Il reste ${money(dueTotal)} à encaisser sur la note.` : ''}`,
    confirmLabel: 'Terminer',
    run: async () => {
      await api.post(`/api/reservations/${r.id}/finish`, {});
      toast('Réservation terminée.');
      reload();
    },
  });

  const onExtend = () => openExtendDialog(r, reload);

  const onItem = (e) => {
    e.preventDefault();
    item.submit(async () => {
      const pid = Number(productId);
      const qty = Number(quantity);
      if (!pid) throw new Error('Choisissez un produit.');
      if (!Number.isInteger(qty) || qty < 1) throw new Error('Quantité : nombre entier à partir de 1.');
      await api.post(`/api/reservations/${r.id}/items`, { product_id: pid, quantity: qty }, itemKey.current);
      itemKey.current = newKey();
      setProductId('');
      setQuantity('1');
      toast('Consommation ajoutée à la note.');
      reload();
    });
  };

  return (
    <>
      <PageHead
        title={r.member_name}
        lead={(
          <>
            {dayLabel(r.biz_day, 'title')} · {r.start_time} → {r.end_time}{nextDay} · {fmtDuration(r.duration_min)} <Chip group="res" value={r.status} />
            {r.off_hours ? <>{' '}<span className="chip chip-bronze">hors horaires</span></> : null}
          </>
        )}
        back={{ to: `/agenda?date=${r.biz_day}`, label: 'Agenda' }}
        actions={(
          <>
            <Link className="btn" to={`/membres/${r.member_id}`}><Icon name="users" /> Fiche membre</Link>
            {r.status === 'reservee' ? (
              <>
                <button type="button" className="btn btn-danger" onClick={() => openCancelReservationDialog(d, reload)}>Annuler</button>
                <button type="button" className="btn" onClick={onExtend}>Prolonger</button>
                <button type="button" className="btn btn-primary" onClick={onStart} disabled={start.busy} aria-busy={start.busy}><Icon name="check" /> Arrivée du membre</button>
              </>
            ) : null}
            {r.status === 'en_cours' ? (
              <>
                <button type="button" className="btn" onClick={onExtend}>Prolonger</button>
                <button type="button" className="btn btn-primary" onClick={onFinish}>Terminer</button>
              </>
            ) : null}
          </>
        )}
        tour="reservation"
      />

      <div className="grid-2">
        <section className="card">
          <div className="card-head"><h2>Détail du calcul</h2></div>
          <dl className="calc">
            <div><dt>Durée réservée</dt><dd>{fmtDuration(r.duration_min)}</dd></div>
            <div><dt>Heures incluses (crédit de la formule)</dt><dd>{fmtDuration(r.included_minutes)}</dd></div>
            <div><dt>Temps payant</dt><dd>{supplementText(r.paid_minutes, r.tariff)}</dd></div>
            <div className="total"><dt>Supplément de temps</dt><dd>{money(r.supplement_amount)}</dd></div>
          </dl>
          <dl className="kv" style={{ marginTop: 14 }}>
            <dt>Formule</dt><dd>{sub.plan_name} · {dayLabel(sub.start_date, 'short')} → {dayLabel(sub.end_date, 'short')}</dd>
            <dt>Crédit du membre</dt><dd>{fmtDuration(sub.credit.available)} disponibles · {fmtDuration(sub.credit.committed)} engagées · {fmtDuration(sub.credit.consumed)} consommées</dd>
            <dt>Tarif appliqué</dt><dd>{money(r.tariff.hour)} / h · {money(r.tariff.half)} / 30 min
              {r.tariff.validated ? null : <>{' '}<Hypothesis title="Tarif annoncé, non validé au moment de la réservation." label="non validé" /></>}</dd>
            {r.off_hours ? <><dt>Hors horaires</dt><dd>Autorisé par {r.off_hours_authorized_by_name ?? '—'}</dd></> : null}
            <dt>Saisie</dt><dd>{r.created_by_name ?? '—'}, {dateTime(r.created_at)}</dd>
            {r.notes ? <><dt>Remarque</dt><dd>{r.notes}</dd></> : null}
            {r.status === 'annulee' ? <><dt>Annulation</dt><dd>{r.cancel_reason} ({dateTime(r.cancelled_at)})</dd></> : null}
          </dl>
          <p className="subtle" style={{ marginTop: 10 }}>Les heures incluses ne génèrent aucun encaissement : elles proviennent du crédit déjà acheté.</p>
        </section>

        <section className="card">
          <div className="card-head"><h2>Note</h2>
            {due.length ? <button type="button" className="btn btn-primary btn-sm" onClick={() => openPaymentDialog({ lines: d.charges, memberName: r.member_name }, reload)}><Icon name="wallet" /> Encaisser {money(dueTotal)}</button> : null}</div>
          {anyLine ? (
            <div className="table-wrap"><table className="table stack-sm">
              <thead><tr><th>Ligne</th><th>Sous-compte</th><th className="num">Montant</th><th>Statut</th><th><span className="sr-only">Actions</span></th></tr></thead>
              <tbody>{d.charges.map((c) => (
                <tr key={c.id} className={c.status === 'annulee' ? 'is-muted' : ''}>
                  <td data-label="Ligne"><span className="strike">{c.label}</span>{c.quantity > 1 ? <> <span className="subtle">{c.quantity} × {money(c.unit_price)}</span></> : null}
                    {c.cancel_reason ? <div className="subtle">{c.cancel_reason}</div> : null}{c.refund_reason ? <div className="subtle">Remboursé : {c.refund_reason}</div> : null}</td>
                  <td data-label="Sous-compte"><AccountTag account={c.account} /></td>
                  <td data-label="Montant" className="num">{money(c.amount)}</td>
                  <td data-label="Statut"><Chip group="charge" value={c.status} /></td>
                  <td className="actions">{lineActions(c)}</td></tr>
              ))}</tbody>
              <tfoot>{totals.filter(([, t]) => t.billed || t.refunded).map(([k, t]) => (
                <tr key={k}>
                  <td data-label="Sous-compte"><AccountTag account={k} /></td><td data-label="Encaissé" className="subtle">encaissé {money(t.paid)}</td>
                  <td data-label="Facturé" className="num">{money(t.billed)}</td><td data-label="Reste">{t.due ? <span className="chip chip-warn">reste {money(t.due)}</span> : null}</td><td /></tr>
              ))}</tfoot>
            </table></div>
          ) : <Empty icon="list">Aucune ligne : ni supplément ni consommation.</Empty>}
        </section>

        {r.status !== 'annulee' ? (
          <section className="card">
            <div className="card-head"><h2>Ajouter une consommation</h2></div>
            <form className="form-grid" onSubmit={onItem} noValidate>
              <div className="form-row">
                <label className="field" style={{ gridColumn: 'span 2' }}><span>Produit</span>
                  <select name="product_id" required value={productId} onChange={(e) => setProductId(e.target.value)}>
                    <option value="">— Choisir —</option>
                    {groups.map(([cat, label]) => (
                      <optgroup key={cat} label={label}>
                        {products.filter((p) => p.category === cat).map((p) => (
                          <option key={p.id} value={p.id} disabled={!p.stock_qty}>{`${p.name} — ${money(p.price)} · ${p.stock_qty ? `${p.stock_qty} en stock` : 'rupture'}`}</option>
                        ))}
                      </optgroup>
                    ))}
                  </select></label>
                <label className="field"><span>Quantité</span><input type="number" name="quantity" min="1" max="99" step="1" value={quantity} onChange={(e) => setQuantity(e.target.value)} inputMode="numeric" required /></label>
              </div>
              <p className="subtle">La vente diminue le stock une seule fois ; une annulation le rétablit avec un mouvement tracé.</p>
              <FormError error={item.error} />
              <div><button type="submit" className="btn btn-primary" disabled={item.busy} aria-busy={item.busy}><Icon name="plus" /> Ajouter à la note</button></div>
            </form>
          </section>
        ) : null}

        <section className="card">
          <div className="card-head"><h2>Encaissements</h2></div>
          {d.payments.length ? (
            <div className="list">{d.payments.map((p) => (
              <div className="list-item" key={p.id}>
                <div className="grow"><div className="title">{money(p.amount)} — {p.method}{p.reference ? <> <span className="subtle">{p.reference}</span></> : null}</div>
                  <div className="meta">{dateTime(p.paid_at)} · {p.created_by_name ?? ''} · {Object.entries(p.by_account).filter(([, v]) => v).map(([k, v]) => `${ACCOUNT_LABEL[k]} ${money(v)}`).join(' · ')}</div></div>
                <span className="chip chip-ok">n° {p.id}</span></div>
            ))}</div>
          ) : <Empty icon="wallet">Aucun encaissement.</Empty>}
        </section>

        <section className="card span-2">
          <div className="card-head"><h2>Historique</h2></div>
          <div className="list">{d.history.map((a, i) => (
            <div className="list-item" key={a.id ?? i}>
              <span className="time subtle">{dateTime(a.at)}</span>
              <div className="grow"><div className="title">{ACTION_LABELS[a.action] ?? a.action}</div><div className="meta">{auditSummary(a)}</div></div>
              <span className="subtle">{a.user_name ?? 'système'}</span></div>
          ))}</div>
        </section>
      </div>
    </>
  );
}

export default function Reservation() {
  const { id } = useParams();
  const state = useLoad(() => Promise.all([api.get(`/api/reservations/${id}`), api.get('/api/products')]), [id]);
  return <Loaded state={state}>{([d, products]) => <ReservationDetail d={d} products={products} reload={state.reload} />}</Loaded>;
}
