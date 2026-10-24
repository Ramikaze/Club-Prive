import { useRef, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import Icon from '../components/ui/Icon.jsx';
import { AccountTag, Chip, Empty, FormError, Loaded, Notice, PageHead, Segmented } from '../components/ui/ui.jsx';
import { toast } from '../components/ui/toast.jsx';
import { actionDialog } from '../components/ui/Modal.jsx';
import SessionTimer, { isRunning } from '../components/ui/SessionTimer.jsx';
import ConsumptionBreakdown, { ConsumerPicker, consumptionOf } from '../components/ui/ConsumptionBreakdown.jsx';
import { api, newKey } from '../lib/api.js';
import { money, fmtDuration, dayLabel, dateTime, ACCOUNT_LABEL } from '../lib/format.js';
import { ACTION_LABELS, auditSummary } from '../lib/audit.js';
import { useBusy, useLoad } from '../lib/hooks.js';
import { useIsAdmin, useRooms } from '../store/useStore.js';
import {
  openExtendDialog, openCancelReservationDialog, openPaymentDialog, openRefundDialog, cancelChargeDialog, supplementText, canRefund,
  quickChangeRoom, openAddAttendeeDialog, quickRemoveAttendee, sendWhatsAppConfirmation,
} from '../dialogs/index.js';

const CAT_FILTERS = [['tous', 'Tous'], ['cigare', 'Cigares'], ['bouteille', 'Bouteilles']];

function ReservationDetail({ d, products, reload }) {
  const isAdmin = useIsAdmin();
  const rooms = useRooms();
  const activeRooms = rooms.filter((rm) => rm.active || rm.id === d.reservation.room_id);
  const r = d.reservation;
  const sub = d.subscription;
  const attendees = r.attendees ?? [{
    member_id: r.member_id,
    name: r.member_name,
    member_no: r.member_no,
    included_minutes: r.included_minutes,
    is_primary: true,
  }];
  const itemKey = useRef(newKey());
  const [catFilter, setCatFilter] = useState('tous');
  const [consumer, setConsumer] = useState(null);
  const [addingId, setAddingId] = useState(null);
  const [itemError, setItemError] = useState(null);
  const start = useBusy();
  const due = d.charges.filter((c) => c.status === 'due');
  const dueTotal = due.reduce((sum, c) => sum + c.amount, 0);
  const nextDay = r.end_date > r.biz_day ? ' (lendemain)' : '';
  const totals = Object.entries(d.totals);
  const anyLine = d.charges.length > 0;
  const activeProducts = products.filter((p) => p.active && (catFilter === 'tous' || p.category === catFilter));
  const editableOccupancy = r.status === 'reservee' || r.status === 'en_cours';

  const lineActions = (c) => (
    <>
      {c.status === 'due' && (c.kind === 'produit' || isAdmin) ? <button type="button" className="btn btn-sm btn-ghost" onClick={() => cancelChargeDialog(c, reload)}>Annuler</button> : null}
      {c.status === 'payee' && canRefund() ? <button type="button" className="btn btn-sm btn-ghost" onClick={() => openRefundDialog(c, reload)}>Rembourser</button> : null}
    </>
  );

  const onStart = () => start.run(async () => {
    try {
      await api.post(`/api/reservations/${r.id}/start`, {});
    } catch (e) {
      // A booking secured by a deposit: its balance is taken before the arrival.
      if (e.code !== 'SOLDE_REQUIS') throw e;
      toast(e.message, 'error');
      openPaymentDialog({ lines: d.charges, memberName: r.member_name }, reload);
      return;
    }
    toast('Arrivée enregistrée : réservation en cours.');
    reload();
  });

  const onFinish = () => actionDialog({
    title: 'Terminer la réservation',
    message: `Les crédits engagés des ${attendees.length} membre(s) présent(s) seront comptés comme consommés.${dueTotal ? ` Il reste ${money(dueTotal)} à encaisser sur la note.` : ''}`,
    confirmLabel: 'Terminer',
    run: async () => {
      await api.post(`/api/reservations/${r.id}/finish`, {});
      toast('Réservation terminée.');
      reload();
    },
  });

  // What the server says about extending this booking. "Prolonger" is offered only when it can be (the reason
  // is shown instead); a detail sent without the window keeps the button, and the server decides.
  const extension = d.extension_window;
  const canExtend = !extension || extension.possible;
  const onExtend = () => openExtendDialog(r, reload, extension);
  const extendButton = canExtend ? <button type="button" className="btn" onClick={onExtend}>Prolonger</button> : null;

  const forMember = attendees.find((a) => a.member_id === consumer) ?? attendees[0];

  const onQuickAddProduct = async (product) => {
    setAddingId(product.id);
    setItemError(null);
    try {
      await api.post(`/api/reservations/${r.id}/items`, { product_id: product.id, quantity: 1, consumer_member_id: forMember?.member_id }, itemKey.current);
      itemKey.current = newKey();
      toast(`${product.name} ajouté pour ${forMember?.name ?? r.member_name}.`);
      reload();
    } catch (err) {
      setItemError(err);
    } finally {
      setAddingId(null);
    }
  };

  return (
    <>
      <PageHead
        title={r.member_name}
        lead={(
          <>
            <span className="chip">{r.room_name || 'Salon Principal'}</span> · {attendees.length} membre(s) · {dayLabel(r.biz_day, 'title')} · {r.start_time} → {r.end_time}{nextDay} · {fmtDuration(r.duration_min)} <Chip group="res" value={r.status} />
            {r.off_hours ? <>{' '}<span className="chip chip-bronze">hors horaires</span></> : null}
            {r.deposit_amount ? <>{' '}<span className="chip chip-bronze">{`acompte ${money(r.deposit_amount)}`}</span></> : null}
          </>
        )}
        back={{ to: `/agenda?date=${r.biz_day}`, label: 'Agenda' }}
        actions={(
          <>
            <Link className="btn" to={`/membres/${r.member_id}`}><Icon name="users" /> Fiche membre</Link>
            {r.status === 'reservee' || r.status === 'en_cours' ? (
              <button type="button" className="btn" onClick={() => sendWhatsAppConfirmation(d)}><Icon name="message" /> Renvoyer la confirmation</button>
            ) : null}
            {r.status === 'reservee' ? (
              <>
                <button type="button" className="btn btn-danger" onClick={() => openCancelReservationDialog(d, reload)}>{r.late_cancellation ? 'Absence' : 'Annuler'}</button>
                {extendButton}
                <button type="button" className="btn btn-primary" onClick={onStart} disabled={start.busy} aria-busy={start.busy}><Icon name="check" /> Arrivée du membre</button>
              </>
            ) : null}
            {r.status === 'en_cours' ? (
              <>
                {extendButton}
                <button type="button" className="btn btn-primary" onClick={onFinish}>Terminer</button>
              </>
            ) : null}
          </>
        )}
        tour="reservation"
      />

      {editableOccupancy && !canExtend && extension.reason && <div style={{ marginBottom: 18 }}><Notice kind="info">{extension.reason}</Notice></div>}

      {isRunning(r) && <div className="session-timer-block"><SessionTimer reservation={r} /></div>}

      <section className="card" style={{ marginBottom: 18 }}>
        <div className="row" style={{ justifyContent: 'space-between', flexWrap: 'wrap', gap: 14 }}>
          <div className="row reservation-room-control" style={{ gap: 10 }}>
            <strong>Salle occupée :</strong>
            {editableOccupancy ? (
              <select
                value={r.room_id}
                onChange={(e) => quickChangeRoom(r, e.target.value, reload)}
                aria-label="Choisir la salle"
                style={{ width: 'auto', minHeight: 36, maxWidth: '100%', minWidth: 0 }}
              >
                {activeRooms.map((rm) => (
                  <option key={rm.id} value={rm.id}>{`${rm.name} (${rm.capacity} membres max.)`}</option>
                ))}
              </select>
            ) : <span>{r.room_name}</span>}
          </div>
          <div className="row" style={{ gap: 10 }}>
            <span><strong>Membres présents ({attendees.length}/{r.room_capacity ?? 8})</strong> — carte active & crédit &gt; 0 requis</span>
            {editableOccupancy && Math.max(r.party_size, attendees.length) < (r.room_capacity ?? 8) ? (
              <button type="button" className="btn btn-sm" onClick={() => openAddAttendeeDialog(r, reload)}>
                <Icon name="plus" /> Ajouter un membre présent
              </button>
            ) : null}
          </div>
        </div>
        <div className="attendee-chips" style={{ marginTop: 10 }}>
          {attendees.map((att) => (
            <span
              key={att.member_id}
              className={`chip ${att.is_primary ? 'chip-bronze' : 'chip-ok'}`}
              style={{ gap: 6 }}
            >
              <Link to={`/membres/${att.member_id}`} style={{ color: 'inherit', textDecoration: 'none' }}>
                {att.name}
              </Link>
              <span style={{ opacity: 0.85, fontWeight: 400 }}>
                ({att.card_code || att.member_no} · −{fmtDuration(att.included_minutes)})
              </span>
              {editableOccupancy && !att.is_primary ? (
                <button
                  type="button"
                  className="chip-remove-btn"
                  onClick={() => quickRemoveAttendee(r, att, reload)}
                  aria-label={`Retirer ${att.name} de la salle`}
                >
                  ×
                </button>
              ) : null}
            </span>
          ))}
        </div>
        {r.party_size > attendees.length && <p className="subtle">{r.party_size - attendees.length} invité(s) accompagnant le client.</p>}
      </section>

      <div className="grid-2">
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
            <div className="card-head">
              <h2>Ajouter en 1 clic</h2>
              <Segmented value={catFilter} options={CAT_FILTERS} label="Catégorie" onChange={setCatFilter} />
            </div>
            <FormError error={itemError} />
            <ConsumerPicker attendees={attendees} value={forMember?.member_id} onChange={setConsumer} />
            <div className="quick-product-grid">
              {activeProducts.map((p) => {
                const out = p.stock_qty <= 0;
                const busy = addingId === p.id;
                return (
                  <button
                    key={p.id}
                    type="button"
                    className={`quick-product-btn ${out ? 'is-disabled' : ''}`}
                    disabled={out || addingId !== null}
                    onClick={() => onQuickAddProduct(p)}
                  >
                    <div className="quick-product-top">
                      <span className="quick-product-name">{p.name}</span>
                      <span className="quick-product-price">{money(p.price)}</span>
                    </div>
                    <div className="quick-product-meta">
                      <span>{p.category === 'cigare' ? 'Cigare' : 'Bouteille'}</span>
                      <span className={out ? 'amount-out' : ''}>{out ? 'Rupture' : `${p.stock_qty} en stock`}</span>
                      {busy && <span>Ajout…</span>}
                    </div>
                  </button>
                );
              })}
            </div>
          </section>
        ) : null}

        <section className="card">
          <div className="card-head"><h2>Consommations par membre</h2></div>
          <ConsumptionBreakdown attendees={attendees} lines={consumptionOf(d.charges)} />
        </section>

        <section className="card">
          <div className="card-head"><h2>Détail de la séance</h2></div>
          <dl className="calc">
            <div><dt>Durée réservée</dt><dd>{fmtDuration(r.duration_min)}</dd></div>
            <div><dt>Heures incluses (crédit de la formule)</dt><dd>{fmtDuration(r.included_minutes)}</dd></div>
            <div><dt>Temps payant</dt><dd>{supplementText(r.paid_minutes, r.tariff)}</dd></div>
            <div className="total"><dt>Supplément de temps</dt><dd>{money(r.supplement_amount)}</dd></div>
          </dl>
          <dl className="kv" style={{ marginTop: 14 }}>
            <dt>Formule</dt><dd>{sub.plan_name} · {dayLabel(sub.start_date, 'short')} → {dayLabel(sub.end_date, 'short')}</dd>
            <dt>Crédit du membre</dt><dd>{fmtDuration(sub.credit.available)} disponibles · {fmtDuration(sub.credit.committed)} engagées · {fmtDuration(sub.credit.consumed)} consommées</dd>
            <dt>Tarif appliqué</dt><dd>{money(r.tariff.hour)} / h · {money(r.tariff.half)} / 30 min</dd>
            {r.off_hours ? <><dt>Hors horaires</dt><dd>Autorisé par {r.off_hours_authorized_by_name ?? '—'}</dd></> : null}
            {r.deposit_amount ? <><dt>Acompte (50 %)</dt><dd>{`${money(r.deposit_amount)}, acquis au club ; le solde se règle avant l’entrée en salle`}</dd></> : null}
            {r.cancellable_until && r.status === 'reservee'
              ? <><dt>Annulable jusqu’au</dt><dd>{r.late_cancellation ? 'Délai dépassé : seule l’absence peut être enregistrée' : dateTime(r.cancellable_until)}</dd></>
              : null}
            <dt>Saisie</dt><dd>{r.created_by_name ?? '—'}, {dateTime(r.created_at)}</dd>
            {r.notes ? <><dt>Remarque</dt><dd>{r.notes}</dd></> : null}
            {r.status === 'annulee' ? <><dt>Annulation</dt><dd>{r.cancel_reason} ({dateTime(r.cancelled_at)})</dd></> : null}
          </dl>
        </section>

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
