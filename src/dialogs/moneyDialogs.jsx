// Payment, refund and line cancellation dialogs, and the member card's money: recharge, outside meal and their
// cancellation. Each dialog keeps one idempotency key for its whole life, so a double click or a retry after a
// network error never records the operation twice.
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api, newKey } from '../lib/api.js';
import { money, parseMoney, dateTime } from '../lib/format.js';
import { useStore, useSettings, isAdminNow } from '../store/useStore.js';
import { openDialog, Modal, actionDialog } from '../components/ui/Modal.jsx';
import { toast } from '../components/ui/toast.jsx';
import { Hypothesis, AccountTag, FormError, Notice } from '../components/ui/ui.jsx';
import { useLoad, useSubmit } from '../lib/hooks.js';
import { CARD_METHOD } from '../../shared/rules.js';
import { renewalWhatsAppText } from '../../shared/wallet.js';
import { sendWhatsAppText } from './reservationDialogs.jsx';

// ---------------------------------------------------------------- payment (full payment of selected lines)

// The member card is offered first when it holds money: it pays what it can, and only then is a method asked for
// the rest. The balance comes from the member's record (one member per payment).
function PaymentDialog({ close, due, memberName, onDone }) {
  const methods = useSettings().payment_methods;
  const [key] = useState(newKey);
  const { busy, error, submit } = useSubmit();
  const navigate = useNavigate();
  const [checked, setChecked] = useState(() => new Set(due.map((c) => c.id)));
  const [picked, setPicked] = useState(null); // null until the manager chooses: the card when it holds money
  const [restMethod, setRestMethod] = useState(methods[0] ?? '');
  const memberId = due[0]?.member_id;
  const memberState = useLoad(() => (memberId ? api.get(`/api/members/${memberId}`) : Promise.resolve(null)), [memberId]);
  const balance = memberState.data?.wallet?.balance ?? 0;

  const selected = due.filter((c) => checked.has(c.id));
  const by = { reservations: 0, alcool: 0, cigares: 0 };
  for (const c of selected) by[c.account] += c.amount;
  const total = by.reservations + by.alcool + by.cigares;
  const method = picked ?? (balance > 0 ? CARD_METHOD : (methods[0] ?? ''));
  const byCard = method === CARD_METHOD;
  const cardPart = byCard ? Math.min(balance, total) : 0;
  const rest = total - cardPart;
  const loadingBalance = Boolean(memberId) && memberState.data === undefined && !memberState.error;

  const toggle = (id, on) => setChecked((prev) => {
    const next = new Set(prev);
    if (on) next.add(id);
    else next.delete(id);
    return next;
  });

  const onSubmit = (e) => {
    e.preventDefault();
    submit(async () => {
      const ids = selected.map((c) => c.id);
      if (!ids.length) throw new Error('Cochez au moins une ligne.');
      const body = byCard
        ? { charge_ids: ids, card: true, method: rest > 0 ? restMethod : undefined }
        : { charge_ids: ids, method };
      const res = await api.post('/api/payments', body, key);
      close();
      toast(`Encaissement enregistré : ${money(res.payment.amount)}.`);
      // The cash receipt is the next thing the manager needs: open its page (print, WhatsApp).
      navigate(`/caisse/ticket/${res.payment.id}`);
      onDone?.(res);
    });
  };

  return (
    <Modal title="Encaisser" size="wide" onClose={close}>
      <form className="form-grid" onSubmit={onSubmit} noValidate>
        <p className="muted">Membre : <strong>{memberName}</strong>. Chaque ligne cochée est encaissée <strong>intégralement</strong>{' '}
          (pas de paiement partiel en version 1) ; le montant est ventilé automatiquement entre les sous-comptes.</p>
        <div className="table-wrap"><table className="table">
          <thead><tr><th><span className="sr-only">Inclure</span></th><th>Ligne</th><th>Sous-compte</th><th className="num">Montant</th></tr></thead>
          <tbody>{due.map((c) => (
            <tr key={c.id}>
              <td><input type="checkbox" name="charge" value={c.id} checked={checked.has(c.id)}
                onChange={(e) => toggle(c.id, e.target.checked)} aria-label={`Encaisser ${c.label}`} /></td>
              <td>{c.label}{c.quantity > 1 ? ` × ${c.quantity}` : ''} {c.tariff_validated ? null : <Hypothesis title="Montant fondé sur un tarif non validé." label="tarif à valider" />}</td>
              <td><AccountTag account={c.account} /></td><td className="num">{money(c.amount)}</td>
            </tr>
          ))}</tbody>
        </table></div>
        <div id="pay-sum"><dl className="calc">
          {Object.entries(by).map(([k, v]) => <div key={k}><dt><AccountTag account={k} /></dt><dd>{money(v)}</dd></div>)}
          <div className="total"><dt>Total encaissé</dt><dd>{money(total)}</dd></div>
          {byCard ? (
            <>
              <div><dt>Payé par la carte membre</dt><dd>{money(cardPart)}</dd></div>
              <div><dt>Reste à payer</dt><dd>{money(rest)}</dd></div>
            </>
          ) : null}</dl></div>
        <div className="form-row">
          <label className="field"><span>Moyen de paiement</span>
            <select name="method" required value={method} onChange={(e) => setPicked(e.target.value)}>
              {balance > 0 ? <option value={CARD_METHOD}>{`${CARD_METHOD} (${money(balance)} disponibles)`}</option> : null}
              {methods.map((x) => <option key={x}>{x}</option>)}</select></label>
          {byCard && rest > 0 ? (
            <label className="field"><span>{`Moyen pour le reste (${money(rest)})`}</span>
              <select name="rest_method" required value={restMethod} onChange={(e) => setRestMethod(e.target.value)}>
                {methods.map((x) => <option key={x}>{x}</option>)}</select></label>
          ) : null}
        </div>
        {byCard ? <p className="subtle">Le ticket imprimé est à faire signer par le membre.</p> : null}
        <FormError error={error} />
        <div className="modal-actions"><button type="button" className="btn" onClick={close}>Annuler</button>
          <button type="submit" className="btn btn-primary" id="pay-submit" disabled={busy || loadingBalance || selected.length === 0} aria-busy={busy}>
            {selected.length ? `Encaisser ${money(total)}` : 'Encaisser'}</button></div>
      </form>
    </Modal>
  );
}

export function openPaymentDialog({ lines, memberName }, onDone) {
  const due = lines.filter((c) => c.status === 'due');
  if (!due.length) {
    toast('Aucune ligne à encaisser.', 'error');
    return;
  }
  openDialog(PaymentDialog, { due, memberName, onDone });
}

// ---------------------------------------------------------------- refund (explicit, traced)

function RefundDialog({ close, charge, onDone }) {
  const methods = useSettings().payment_methods;
  const [key] = useState(newKey);
  const { busy, error, submit } = useSubmit();
  const [reason, setReason] = useState('');
  const [method, setMethod] = useState(methods[0] ?? '');
  const [restock, setRestock] = useState(false);

  const onSubmit = (e) => {
    e.preventDefault();
    submit(async () => {
      if (String(reason ?? '').trim().length < 3) throw new Error('Indiquez un motif (3 caractères minimum).');
      const res = await api.post(`/api/charges/${charge.id}/refund`, { reason, method, restock: Boolean(restock) }, key);
      close();
      toast('Remboursement enregistré.');
      onDone?.(res);
    });
  };

  return (
    <Modal title="Rembourser une ligne" onClose={close}>
      <form className="form-grid" onSubmit={onSubmit} noValidate>
        <dl className="calc">
          <div><dt>Ligne</dt><dd>{charge.label}{charge.quantity > 1 ? ` × ${charge.quantity}` : ''}</dd></div>
          <div><dt>Sous-compte</dt><dd><AccountTag account={charge.account} /></dd></div>
          <div className="total"><dt>Montant remboursé</dt><dd>{money(charge.amount)}</dd></div>
        </dl>
        <p className="subtle">Version 1 : remboursement intégral de la ligne. Les règles de remboursement restent à valider.</p>
        <label className="field"><span>Motif</span>
          <textarea name="reason" required minLength={3} maxLength={300} value={reason} onChange={(e) => setReason(e.target.value)} /></label>
        <div className="form-row">
          <label className="field"><span>Moyen de remboursement</span>
            <select name="method" value={method} onChange={(e) => setMethod(e.target.value)}>
              {methods.map((x) => <option key={x}>{x}</option>)}</select></label>
        </div>
        {charge.product_id ? (
          <label className="check"><input type="checkbox" name="restock" value="1" checked={restock} onChange={(e) => setRestock(e.target.checked)} />
            <span>{`Remettre le produit en stock (${charge.quantity})`}</span></label>
        ) : null}
        <FormError error={error} />
        <div className="modal-actions"><button type="button" className="btn" onClick={close}>Annuler</button>
          <button type="submit" className="btn btn-danger" disabled={busy} aria-busy={busy}>{`Rembourser ${money(charge.amount)}`}</button></div>
      </form>
    </Modal>
  );
}

export function openRefundDialog(charge, onDone) {
  openDialog(RefundDialog, { charge, onDone });
}

export function cancelChargeDialog(charge, onDone) {
  const key = newKey();
  actionDialog({
    title: 'Annuler une ligne',
    message: `${charge.label}${charge.quantity > 1 ? ` × ${charge.quantity}` : ''} — ${money(charge.amount)}${charge.product_id ? ' (le produit retourne en stock)' : ''}.`,
    reasonLabel: 'Motif',
    danger: true,
    confirmLabel: 'Annuler la ligne',
    run: async (v) => {
      const res = await api.post(`/api/charges/${charge.id}/cancel`, { reason: v.reason }, key);
      toast('Ligne annulée.');
      onDone?.(res);
    },
  });
}

export const canRefund = () => isAdminNow() || !useStore.getState().settings.refunds_admin_only;

// ---------------------------------------------------------------- member card: recharge, outside meal

// Money paid at the till onto the card. The receipt opens next: it is printed for the member to sign, then sent
// to him on WhatsApp from there.
function RechargeDialog({ close, member, onDone }) {
  const settings = useSettings();
  const methods = settings.payment_methods;
  const [key] = useState(newKey);
  const { busy, error, submit } = useSubmit();
  const navigate = useNavigate();
  const [amountText, setAmountText] = useState('');
  const [method, setMethod] = useState(methods[0] ?? '');
  const amount = parseMoney(amountText);
  const balance = member.wallet?.balance ?? 0;

  const onSubmit = (e) => {
    e.preventDefault();
    submit(async () => {
      if (!amount) throw new Error('Indiquez le montant de l’approvisionnement.');
      const res = await api.post(`/api/members/${member.id}/wallet/recharge`, { amount, method }, key);
      close();
      toast(`Carte approvisionnée de ${money(amount)} : nouveau solde ${money(res.wallet.balance)}.${res.renewed?.length ? ' L’abonnement a été renouvelé sur la carte.' : ''}`);
      onDone?.(res);
      navigate(`/caisse/ticket/${res.payment.id}`);
    });
  };

  return (
    <Modal title="Approvisionner la carte" onClose={close}>
      <form className="form-grid" onSubmit={onSubmit} noValidate>
        <p className="muted">Membre : <strong>{member.name}</strong>. L’argent reçu à la caisse est crédité sur la carte, en {settings.currency.label} ; il n’est jamais rendu en espèces ni perdu.</p>
        <div className="form-row">
          <label className="field"><span>Montant reçu</span>
            <input name="amount" inputMode="decimal" autoComplete="off" placeholder="100 000" required autoFocus value={amountText} onChange={(e) => setAmountText(e.target.value)} /></label>
          <label className="field"><span>Moyen de paiement</span>
            <select name="method" required value={method} onChange={(e) => setMethod(e.target.value)}>
              {methods.map((x) => <option key={x}>{x}</option>)}</select></label>
        </div>
        <dl className="calc">
          <div><dt>Solde actuel</dt><dd>{money(balance)}</dd></div>
          <div className="total"><dt>Nouveau solde</dt><dd>{money(balance + (amount ?? 0))}</dd></div>
        </dl>
        <p className="subtle">Le n° de reçu est attribué automatiquement. Le ticket s’ouvre ensuite : imprimez-le pour la signature du membre, puis envoyez-lui le reçu par WhatsApp.</p>
        <FormError error={error} />
        <div className="modal-actions"><button type="button" className="btn" onClick={close}>Annuler</button>
          <button type="submit" className="btn btn-primary" disabled={busy || !amount} aria-busy={busy}>
            {amount ? `Approvisionner ${money(amount)}` : 'Approvisionner'}</button></div>
      </form>
    </Modal>
  );
}

export function openRechargeDialog(member, onDone) {
  openDialog(RechargeDialog, { member, onDone });
}

// A meal ordered from an outside restaurant: the club pays the courier in cash from the till, and the same exact
// amount is taken from the member, the card first, another method for the rest. One action records both.
function OutsideMealDialog({ close, member, onDone }) {
  const methods = useSettings().payment_methods;
  const [key] = useState(newKey);
  const { busy, error, submit } = useSubmit();
  const navigate = useNavigate();
  const [amountText, setAmountText] = useState('');
  const [label, setLabel] = useState('');
  const [restMethod, setRestMethod] = useState(methods[0] ?? '');
  // The member's booking in progress or to come, to tie the meal to it (optional).
  const bookings = (member.reservations ?? []).filter((r) => r.member_id === member.id && ['reservee', 'en_cours'].includes(r.status));
  const [reservationId, setReservationId] = useState(() => String(bookings.find((r) => r.status === 'en_cours')?.id ?? ''));
  const amount = parseMoney(amountText);
  const balance = member.wallet?.balance ?? 0;
  const cardPart = Math.min(balance, amount ?? 0);
  const rest = (amount ?? 0) - cardPart;

  const onSubmit = (e) => {
    e.preventDefault();
    submit(async () => {
      if (!amount) throw new Error('Indiquez le montant du repas.');
      if (label.trim().length < 1) throw new Error('Indiquez le restaurant ou le plat.');
      const body = {
        amount, label, rest_method: rest > 0 ? restMethod : undefined,
        reservation_id: reservationId ? Number(reservationId) : undefined,
      };
      const res = await api.post(`/api/members/${member.id}/outside-meal`, body, key);
      close();
      toast(`Repas enregistré : ${money(amount)}, livreur payé en espèces.`);
      onDone?.(res);
      navigate(`/caisse/ticket/${res.payment.id}`);
    });
  };

  return (
    <Modal title="Repas commandé à l’extérieur" onClose={close}>
      <form className="form-grid" onSubmit={onSubmit} noValidate>
        <p className="muted">Membre : <strong>{member.name}</strong>. Le livreur est payé en espèces avec l’argent de la caisse, et le même montant exact est débité du crédit CFA de la carte.</p>
        <label className="field"><span>Prix payé au livreur (espèces)</span>
          <input name="amount" inputMode="decimal" autoComplete="off" placeholder="18 500" required autoFocus value={amountText} onChange={(e) => setAmountText(e.target.value)} /></label>
        <label className="field"><span>Restaurant ou plat</span>
          <input name="label" maxLength={100} required placeholder="Ex. : Le Gourmet, poulet braisé" value={label} onChange={(e) => setLabel(e.target.value)} /></label>
        {bookings.length ? (
          <label className="field"><span>Réservation (facultatif)</span>
            <select name="reservation_id" value={reservationId} onChange={(e) => setReservationId(e.target.value)}>
              <option value="">Aucune</option>
              {bookings.map((r) => <option key={r.id} value={r.id}>{`${r.room_name} · ${r.start_time} – ${r.end_time}${r.status === 'en_cours' ? ' (en cours)' : ''}`}</option>)}
            </select></label>
        ) : null}
        <dl className="calc">
          <div><dt>Solde de la carte</dt><dd>{money(balance)}</dd></div>
          <div><dt>Payé par la carte</dt><dd>{money(cardPart)}</dd></div>
          <div className="total"><dt>Reste à payer</dt><dd>{money(rest)}</dd></div>
        </dl>
        {rest > 0 ? (
          <div className="form-row">
            <label className="field"><span>{`Moyen pour le reste (${money(rest)})`}</span>
              <select name="rest_method" required value={restMethod} onChange={(e) => setRestMethod(e.target.value)}>
                {methods.map((x) => <option key={x}>{x}</option>)}</select></label>
          </div>
        ) : null}
        <FormError error={error} />
        <div className="modal-actions"><button type="button" className="btn" onClick={close}>Annuler</button>
          <button type="submit" className="btn btn-primary" disabled={busy || !amount} aria-busy={busy}>
            {amount ? `Enregistrer le repas (${money(amount)})` : 'Enregistrer le repas'}</button></div>
      </form>
    </Modal>
  );
}

export function openOutsideMealDialog(member, onDone) {
  openDialog(OutsideMealDialog, { member, onDone });
}

// Administrator only, with a reason: the money leaves the till today and the card is debited; refused when the
// money has already been spent from the card.
export function openCancelRechargeDialog({ paymentId, amount, at }, onDone) {
  const key = newKey();
  actionDialog({
    title: 'Annuler l’approvisionnement',
    message: `Approvisionnement de ${money(amount)} du ${dateTime(at)}.`,
    body: <Notice kind="warn">Le montant sort de la caisse aujourd’hui et il est retiré de la carte. C’est refusé si cet argent a déjà été dépensé avec la carte.</Notice>,
    reasonLabel: 'Motif de l’annulation',
    danger: true,
    confirmLabel: 'Annuler l’approvisionnement',
    run: async (v) => {
      const res = await api.post(`/api/payments/${paymentId}/cancel-recharge`, { reason: v.reason }, key);
      toast(`Approvisionnement annulé : nouveau solde ${money(res.wallet.balance)}.`);
      onDone?.(res);
    },
  });
}

// Administrator only, with a reason: the courier's expense is cancelled, the card's part goes back on the card and
// the part paid otherwise leaves the till today.
export function openCancelMealDialog(payment, onDone) {
  const key = newKey();
  actionDialog({
    title: 'Annuler le repas',
    message: `${payment.label ?? 'Repas extérieur'} : ${money(payment.amount)} du ${dateTime(payment.paid_at)}.`,
    reasonLabel: 'Motif de l’annulation',
    danger: true,
    confirmLabel: 'Annuler le repas',
    run: async (v) => {
      const res = await api.post(`/api/payments/${payment.id}/cancel-meal`, { reason: v.reason }, key);
      toast(`Repas annulé : nouveau solde de la carte ${money(res.wallet.balance)}.`);
      onDone?.(res);
    },
  });
}

// The renewal alert sent to the member on WhatsApp (shown, never sent, in the demo). `alert` is a renewal status
// (memberDetail.renewal or a dashboard renewal alert).
export function sendRenewalWhatsApp(alert, { firstName, phone }) {
  const { club_name: clubName, currency } = useStore.getState().settings;
  const text = renewalWhatsAppText({
    clubName, firstName, planName: alert.plan_name, endDate: alert.end_date, balance: alert.balance, price: alert.price, state: alert.state, currency,
  });
  sendWhatsAppText(phone, text, { title: 'Alerte de renouvellement' });
}
