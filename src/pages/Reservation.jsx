import { useRef, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import Icon from '../components/ui/Icon.jsx';
import SmartSearch from '../components/ui/SmartSearch.jsx';
import { AccountTag, Chip, Empty, FormError, Loaded, Notice, PageHead, Segmented } from '../components/ui/ui.jsx';
import { toast } from '../components/ui/toast.jsx';
import { actionDialog } from '../components/ui/Modal.jsx';
import SessionTimer, { isRunning } from '../components/ui/SessionTimer.jsx';
import SessionConsumptions, {
  PayNowChoice, consumptionOf, payNowBody, cardShort, servedToast,
} from '../components/ui/SessionConsumptions.jsx';
import { api, newKey } from '../lib/api.js';
import { money, fmtDuration, dayLabel, dateTime, ACCOUNT_LABEL, paymentMethodText } from '../lib/format.js';
import { ACTION_LABELS, auditSummary } from '../lib/audit.js';
import { useBusy, useLoad } from '../lib/hooks.js';
import { useIsAdmin, useRooms } from '../store/useStore.js';
import { partyLabel } from '../../shared/rules.js';
import { searchable, smartFilter } from '../../shared/search.js';
import {
  openExtendDialog, openCancelReservationDialog, openPaymentDialog, openRefundDialog, cancelChargeDialog, supplementText, canRefund,
  quickChangeRoom,
} from '../dialogs/index.js';

const CAT_FILTERS = [['tous', 'Tous'], ['cigare', 'Cigares'], ['bouteille', 'Bouteilles']];

function ReservationDetail({ d, products, reload }) {
  const isAdmin = useIsAdmin();
  const rooms = useRooms();
  const activeRooms = rooms.filter((rm) => rm.active || rm.id === d.reservation.room_id);
  const r = d.reservation;
  const sub = d.subscription;
  const itemKey = useRef(newKey());
  const [catFilter, setCatFilter] = useState('tous');
  const [search, setSearch] = useState('');
  const [payWith, setPayWith] = useState(''); // '' = on the note, paid at the end
  const [addingId, setAddingId] = useState(null);
  const [itemError, setItemError] = useState(null);
  const start = useBusy();
  const due = d.charges.filter((c) => c.status === 'due');
  const dueTotal = due.reduce((sum, c) => sum + c.amount, 0);
  const nextDay = r.end_date > r.biz_day ? ' (lendemain)' : '';
  const totals = Object.entries(d.totals);
  const anyLine = d.charges.length > 0;
  const inCategory = products.filter((p) => p.active && (catFilter === 'tous' || p.category === catFilter));
  // The search in « Ajouter en 1 clic »: name, reference, category and description (origin, strength…), typos forgiven.
  const activeProducts = searchable(search)
    ? smartFilter(inCategory, search, (p) => [p.name, p.reference, p.category === 'cigare' ? 'Cigare' : 'Bouteille', p.description])
    : inCategory;
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
    message: `Le crédit engagé du titulaire sera compté comme consommé.${dueTotal ? ` Il reste ${money(dueTotal)} à encaisser sur la note.` : ''}`,
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

  const onQuickAddProduct = async (product) => {
    setItemError(null);
    if (cardShort(payWith, product.price, d.card_balance ?? 0)) {
      setItemError(`Crédit CFA insuffisant sur la carte : ${money(d.card_balance ?? 0)} pour ${money(product.price)}.`);
      return;
    }
    setAddingId(product.id);
    try {
      const res = await api.post(`/api/reservations/${r.id}/items`, { product_id: product.id, quantity: 1, ...payNowBody(payWith) }, itemKey.current);
      itemKey.current = newKey();
      servedToast(product, res, `${product.name} ajouté à la note.`);
      setPayWith('');
      reload();
    } catch (err) {
      setItemError(err.message);
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
            <span className="chip">{r.room_name || 'Salon Principal'}</span> · {partyLabel(r.party_size)} · {dayLabel(r.biz_day, 'title')} · {r.start_time} → {r.end_time}{nextDay} · {fmtDuration(r.duration_min)} <Chip group="res" value={r.status} />
            {r.off_hours ? <>{' '}<span className="chip chip-bronze">hors horaires</span></> : null}
            {r.deposit_amount ? <>{' '}<span className="chip chip-bronze">{`acompte ${money(r.deposit_amount)}`}</span></> : null}
          </>
        )}
        back={{ to: `/agenda?date=${r.biz_day}`, label: 'Agenda' }}
        actions={(
          <>
            <Link className="btn" to={`/membres/${r.member_id}`}><Icon name="users" /> Fiche membre</Link>
            {/* The confirmation to print or send on WhatsApp (picture and message), whatever the booking's status. */}
            <Link className="btn" to={`/reservations/${r.id}/confirmation`}><Icon name="receipt" /> Confirmation</Link>
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
                  <option key={rm.id} value={rm.id}>{`${rm.name} (${rm.capacity} personnes max.)`}</option>
                ))}
              </select>
            ) : <span>{r.room_name}</span>}
          </div>
          <div className="party-line">
            <strong>{partyLabel(r.party_size)}</strong>
            <span className="chip chip-bronze">
              <Link to={`/membres/${r.member_id}`} style={{ color: 'inherit', textDecoration: 'none' }}>{r.member_name}</Link>
              <span style={{ opacity: 0.85, fontWeight: 400 }}>&nbsp;({r.card_code || r.member_no})</span>
            </span>
          </div>
        </div>
        <p className="subtle" style={{ marginTop: 8 }}>Seul membre de la séance, le titulaire paie le temps et les consommations de ses invités.</p>
      </section>

      <div className="grid-2">
        <section className="card">
          <div className="card-head"><h2>Note</h2>
            {due.length ? <button type="button" className="btn btn-primary btn-sm" onClick={() => openPaymentDialog({ lines: d.charges, memberName: r.member_name }, reload)}><Icon name="wallet" /> Encaisser {money(dueTotal)}</button> : null}</div>
          {anyLine ? (
            <>
              {/* A list rather than a table: the note shares its row with « Ajouter en 1 clic », so everything stays inside the tile. */}
              <div className="list note-lines">{d.charges.map((c) => (
                <div key={c.id} className={`list-item note-line${c.status === 'annulee' ? ' is-muted' : ''}`}>
                  <div className="grow">
                    <div className="title"><span className="strike">{c.label}</span></div>
                    <div className="meta"><AccountTag account={c.account} />{c.quantity > 1 ? <> · {c.quantity} × {money(c.unit_price)}</> : null}</div>
                    {c.cancel_reason ? <div className="meta">{c.cancel_reason}</div> : null}{c.refund_reason ? <div className="meta">Remboursé : {c.refund_reason}</div> : null}
                  </div>
                  <div className="note-line-end">
                    <span className="num note-amount"><span className="strike">{money(c.amount)}</span></span>
                    <Chip group="charge" value={c.status} />
                    <div className="note-line-actions">{lineActions(c)}</div>
                  </div>
                </div>
              ))}</div>
              <dl className="calc section-gap">{totals.filter(([, t]) => t.billed || t.refunded).map(([k, t]) => (
                <div key={k}>
                  <dt><AccountTag account={k} /> <span className="subtle">· encaissé {money(t.paid)}</span></dt>
                  <dd>{money(t.billed)}{t.due ? <> <span className="chip chip-warn">reste {money(t.due)}</span></> : null}</dd>
                </div>
              ))}</dl>
            </>
          ) : <Empty icon="list">Aucune ligne : ni supplément ni consommation.</Empty>}
        </section>

        {r.status !== 'annulee' ? (
          <section className="card">
            <div className="card-head">
              <h2>Ajouter en 1 clic</h2>
              <Segmented value={catFilter} options={CAT_FILTERS} label="Catégorie" onChange={setCatFilter} />
            </div>
            <FormError error={itemError} />
            <PayNowChoice value={payWith} onChange={setPayWith} cardBalance={d.card_balance ?? 0} />
            <div className="section-gap">
              <SmartSearch
                value={search}
                onChange={setSearch}
                suggestions={activeProducts.filter((p) => p.stock_qty > 0)}
                onPick={(p) => { setSearch(''); onQuickAddProduct(p); }}
                placeholder="Rechercher un cigare, une bouteille…"
                label="Rechercher un produit à ajouter"
                renderSuggestion={(p) => (
                  <div className="grow">
                    <div className="title">{p.name}</div>
                    <div className="meta">{money(p.price)} · {p.stock_qty} en stock</div>
                  </div>
                )}
              />
            </div>
            {searchable(search) && !activeProducts.length && <p className="subtle section-gap">Aucun produit ne correspond à « {search.trim()} ».</p>}
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
          <div className="card-head"><h2>Consommations de la séance</h2></div>
          <SessionConsumptions lines={consumptionOf(d.charges)} />
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
            {sub ? (
              <>
                <dt>Formule</dt><dd>{sub.plan_name} · {dayLabel(sub.start_date, 'short')} → {dayLabel(sub.end_date, 'short')}</dd>
                <dt>Crédit du membre</dt><dd>{fmtDuration(sub.credit.available)} disponibles · {fmtDuration(sub.credit.committed)} engagées · {fmtDuration(sub.credit.consumed)} consommées</dd>
              </>
            ) : <><dt>Formule</dt><dd>Aucune : le temps est payé avec la carte membre</dd></>}
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
                <div className="grow"><div className="title">{money(p.amount)} — {paymentMethodText(p)}{p.reference ? <> <span className="subtle">{p.reference}</span></> : null}</div>
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
