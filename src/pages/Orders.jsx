// « Commandes » (menu): what the client space sends the staff. The open Boutique orders (oldest first) and the pending
// reservation requests, read again every 30 s while the tab is visible. An order is turned into the usual Boutique sale
// (« Encaisser » fills that rayon's cart and opens the Boutique); a request is turned into a booking through the usual
// booking form. After an action, one click opens WhatsApp on a ready message to the client (nothing is sent by itself).
import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import Icon from '../components/ui/Icon.jsx';
import { actionDialog } from '../components/ui/Modal.jsx';
import { Empty, Loaded, Notice, PageHead } from '../components/ui/ui.jsx';
import { toast } from '../components/ui/toast.jsx';
import { openBookingDialog, sendWhatsAppText } from '../dialogs/reservationDialogs.jsx';
import { api, newKey } from '../lib/api.js';
import { dateTime, dayLabel, money } from '../lib/format.js';
import { useBusy, useLoad } from '../lib/hooks.js';
import { disablePush, enablePush, needsHomeScreen, pushActive, pushKey, pushSupported } from '../lib/push.js';
import { useMe, useStore } from '../store/useStore.js';
import { fmtDuration } from '../../shared/rules.js';
import { RAYONS, SHOP, canSellIn } from '../../shared/roles.js';

const REFRESH_MS = 30000;

// « depuis 12 min », « depuis 3 h », « depuis 2 j »: how long it has been waiting.
function since(iso) {
  const minutes = Math.max(0, Math.round((Date.now() - Date.parse(iso)) / 60000));
  if (minutes < 60) return `depuis ${minutes} min`;
  if (minutes < 48 * 60) return `depuis ${Math.round(minutes / 60)} h`;
  return `depuis ${Math.round(minutes / 1440)} j`;
}

const firstName = (name) => name.split(' ')[0];
const readyText = (o) => `Bonjour ${firstName(o.member.name)}, votre commande Limen est prête : vous pouvez passer la retirer au club. À bientôt !\nL’équipe Limen`;
const cancelledText = (o, reason) => `Bonjour ${firstName(o.member.name)}, nous ne pouvons pas préparer votre commande Limen : ${reason}\nL’équipe Limen`;
const confirmedText = (r) => `Bonjour ${firstName(r.member.name)}, votre réservation Limen est confirmée : ${dayLabel(r.date, 'long')} à ${r.start_time}, ${fmtDuration(r.duration_min)}. À bientôt !\nL’équipe Limen`;
const refusedText = (r, message) => `Bonjour ${firstName(r.member.name)}, nous ne pouvons pas confirmer votre demande de réservation Limen : ${message}\nL’équipe Limen`;

const whatsApp = (member, text) => ({ label: 'Prévenir sur WhatsApp', icon: 'message', onClick: () => sendWhatsAppText(member.phone, text) });

// The toggle of this device. Hidden while the server has no push keys; explains what is missing otherwise.
function PushToggle() {
  const key = useLoad(() => pushKey(), []);
  const [on, setOn] = useState(null); // null until read
  const action = useBusy();
  useEffect(() => {
    let alive = true;
    pushActive().then((v) => { if (alive) setOn(v); }, () => { if (alive) setOn(false); });
    return () => { alive = false; };
  }, []);
  if (key.error || key.data === undefined || !key.data) return null;
  if (!pushSupported()) {
    return <p className="subtle">{needsHomeScreen()
      ? 'Sur iPhone, ajoutez d’abord ce site à l’écran d’accueil (Partager, puis « Sur l’écran d’accueil »), puis ouvrez-le depuis l’icône pour activer les notifications.'
      : 'Cet appareil ne permet pas les notifications.'}</p>;
  }
  const toggle = () => action.run(async () => {
    if (on) await disablePush();
    else await enablePush();
    setOn(await pushActive());
    toast(on ? 'Notifications coupées sur cet appareil.' : 'Notifications activées sur cet appareil.');
  });
  return (
    <label className="check" title="Recevoir une notification à chaque nouvelle commande ou demande">
      <input type="checkbox" checked={Boolean(on)} disabled={on === null || action.busy} onChange={toggle} />
      <span>Notifications sur cet appareil</span>
    </label>
  );
}

// A rayon already sold: its ticket is its sale's payment; a sale on credit has no payment yet, hence no ticket.
function Sold({ paymentId }) {
  return paymentId
    ? <Link className="chip chip-neutral" to={`/caisse/ticket/${paymentId}`}>encaissé</Link>
    : <span className="chip chip-neutral">encaissé</span>;
}

function OrderCard({ order: o, reload }) {
  const me = useMe();
  const navigate = useNavigate();
  const action = useBusy();
  const byRayon = RAYONS.map((account) => ({ account, lines: o.lines.filter((l) => l.account === account) })).filter((r) => r.lines.length);
  const sold = Object.keys(o.sales).length > 0;

  const ready = () => action.run(async () => {
    await api.post(`/api/orders/${o.id}/ready`, {});
    toast(`Commande de ${o.member.name} prête.`, 'ok', whatsApp(o.member, readyText(o)));
    reload();
  });
  const close = () => action.run(async () => {
    await api.post(`/api/orders/${o.id}/close`, {});
    toast('Commande clôturée : ce qui n’a pas été retiré est libéré.');
    reload();
  });
  const cancel = () => actionDialog({
    title: 'Annuler la commande', message: `Commande de ${o.member.name}. Le motif est visible du client.`, reasonLabel: 'Motif', confirmLabel: 'Annuler la commande', danger: true,
    run: async ({ reason }) => {
      await api.post(`/api/orders/${o.id}/cancel`, { reason });
      toast('Commande annulée : les produits sont libérés.', 'ok', whatsApp(o.member, cancelledText(o, reason)));
      reload();
    },
  });
  // Fills this rayon's cart of the Boutique with the order (client, products, quantities) and opens it. A cart that
  // already holds something for this rayon is replaced only after a confirmation.
  const fill = (account) => {
    const lines = Object.fromEntries(o.lines.filter((l) => l.account === account).map((l) => [l.product_id, l.quantity]));
    const go = () => {
      const blank = () => ({ key: newKey(), lines: {}, buyer: { kind: 'journalier', person: null } });
      useStore.getState().setShopCarts((carts) => ({
        ...(carts ?? { cigares: blank(), alcool: blank() }),
        [account]: {
          key: newKey(), lines, order_id: o.id,
          buyer: { kind: o.member.kind, person: { id: o.member.id, name: o.member.name, member_no: o.member.member_no, in_room: false } },
        },
      }));
      navigate('/boutique');
    };
    const current = useStore.getState().shopCarts?.[account];
    if (current && Object.keys(current.lines).length) {
      actionDialog({
        title: `Panier ${SHOP[account].tab} déjà rempli`, message: 'Le panier en cours de ce rayon sera remplacé par la commande.', confirmLabel: 'Remplacer le panier',
        run: async () => go(),
      });
    } else go();
  };

  return (
    <article className="card order-card">
      <div className="card-head">
        <h2><Link to={`/membres/${o.member.id}`}>{o.member.name}</Link> <span className="subtle">{o.member.member_no}</span></h2>
        <span>{o.status === 'prete' ? <span className="chip chip-ok">prête</span> : <span className="chip chip-warn">en attente</span>}
          {' '}<span className="subtle" title={dateTime(o.created_at)}>{since(o.created_at)}</span></span>
      </div>
      {byRayon.map(({ account, lines }) => (
        <div className="order-rayon" key={account}>
          <h3>{SHOP[account].tab} {o.sales[account] ? <Sold paymentId={o.tickets?.[account]} /> : null}</h3>
          <ul className="order-lines">
            {lines.map((l) => (
              <li key={l.product_id}>{l.quantity} × {l.name} <span className="subtle">({money(l.unit_price)})</span>
                {!o.sales[account] && l.stock_qty < l.quantity ? <> <span className="chip chip-danger">stock {l.stock_qty}</span></> : null}</li>
            ))}
          </ul>
        </div>
      ))}
      <div className="order-actions">
        {o.status === 'en_attente' ? <button type="button" className="btn" disabled={action.busy} onClick={ready}><Icon name="check" /> Marquer prête</button> : null}
        {byRayon.filter((r) => !o.sales[r.account] && canSellIn(me, r.account)).map((r) => (
          <button key={r.account} type="button" className="btn btn-primary" onClick={() => fill(r.account)}><Icon name="shop" /> Encaisser {SHOP[r.account].tab}</button>
        ))}
        {sold ? <button type="button" className="btn" disabled={action.busy} onClick={close}>Clôturer</button> : null}
        {!sold ? <button type="button" className="btn btn-danger" onClick={cancel}><Icon name="x" /> Annuler</button> : null}
        {o.status === 'prete' ? (
          <button type="button" className="btn btn-ghost" onClick={() => sendWhatsAppText(o.member.phone, readyText(o))}><Icon name="message" /> Prévenir sur WhatsApp</button>
        ) : null}
      </div>
    </article>
  );
}

function RequestCard({ request: r, reload }) {
  const rooms = useStore((s) => s.rooms);
  const action = useBusy();
  const room = rooms.find((x) => x.id === r.room_id);
  const est = r.estimate;
  const confirm = () => action.run(async () => {
    const file = await api.get(`/api/members/${r.member.id}`);
    openBookingDialog({
      member: { id: file.id, name: file.name, member_no: file.member_no, card_code: file.card_code, subscription: file.subscription, active: file.active, cards_deactivated: file.cards_deactivated },
      lockMember: true, date: r.date, start_time: r.start_time, duration_min: r.duration_min, party_size: r.party_size, room_id: r.room_id, request_id: r.id,
    }, () => {
      toast('Demande confirmée.', 'ok', whatsApp(r.member, confirmedText(r)));
      reload();
    });
  });
  const refuse = () => actionDialog({
    title: 'Refuser la demande', message: `Demande de ${r.member.name}. Le mot est visible du client.`, reasonLabel: 'Message pour le client', confirmLabel: 'Refuser la demande', danger: true,
    run: async ({ reason }) => {
      await api.post(`/api/reservation-requests/${r.id}/refuse`, { message: reason });
      toast('Demande refusée.', 'ok', whatsApp(r.member, refusedText(r, reason)));
      reload();
    },
  });
  return (
    <article className="card order-card">
      <div className="card-head">
        <h2><Link to={`/membres/${r.member.id}`}>{r.member.name}</Link> <span className="subtle">{r.member.member_no}</span></h2>
        <span className="subtle" title={dateTime(r.created_at)}>{since(r.created_at)}</span>
      </div>
      <p><strong>{dayLabel(r.date, 'long')}</strong> à {r.start_time} · {fmtDuration(r.duration_min)} · {r.party_size} pers.{room ? ` · ${room.name}` : ''}</p>
      {est ? (
        <p className="subtle">
          {est.available ? <span className="chip chip-ok">créneau libre</span> : <span className="chip chip-danger">créneau pris</span>}
          {est.supplement_amount > 0 ? ` Supplément ${money(est.supplement_amount)}.` : ''}
          {est.deposit_amount > 0 ? ` Acompte ${money(est.deposit_amount)}.` : ''}
        </p>
      ) : null}
      <div className="order-actions">
        <button type="button" className="btn btn-primary" disabled={action.busy} onClick={confirm}><Icon name="check" /> Confirmer</button>
        <button type="button" className="btn btn-danger" onClick={refuse}><Icon name="x" /> Refuser</button>
      </div>
    </article>
  );
}

export default function Orders() {
  const state = useLoad(() => api.get('/api/orders'), [], { refreshMs: REFRESH_MS });
  const setCounts = useStore((s) => s.setOrderCounts);
  // The menu's counter follows what this page just read (the shell stops asking while the page is open).
  useEffect(() => {
    if (state.data) setCounts(state.data.counts.orders + state.data.counts.requests);
  }, [state.data, setCounts]);
  return (
    <>
      <PageHead title="Commandes" lead="Ce que vos clients ont commandé ou demandé depuis leur espace." actions={<PushToggle />} />
      <Loaded state={state}>{({ orders, requests }) => (
        <div className="stack">
          {state.error ? <Notice kind="warn">{state.error.message}</Notice> : null}
          <section aria-label="Commandes Boutique">
            <h2>Commandes Boutique</h2>
            {orders.length ? <div className="order-list">{orders.map((o) => <OrderCard key={o.id} order={o} reload={state.reload} />)}</div>
              : <div className="card"><Empty icon="shop">Aucune commande en attente.</Empty></div>}
          </section>
          <section aria-label="Demandes de réservation">
            <h2>Demandes de réservation</h2>
            {requests.length ? <div className="order-list">{requests.map((r) => <RequestCard key={r.id} request={r} reload={state.reload} />)}</div>
              : <div className="card"><Empty icon="calendar">Aucune demande de réservation en attente.</Empty></div>}
          </section>
        </div>
      )}</Loaded>
    </>
  );
}
