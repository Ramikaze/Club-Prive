// Payment, refund and line cancellation dialogs. Each dialog keeps one idempotency key for its
// whole life, so a double click or a retry after a network error never records the operation twice.
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api, newKey } from '../lib/api.js';
import { money } from '../lib/format.js';
import { useStore, useSettings, isAdminNow } from '../store/useStore.js';
import { openDialog, Modal, actionDialog } from '../components/ui/Modal.jsx';
import { toast } from '../components/ui/toast.jsx';
import { Hypothesis, AccountTag, FormError } from '../components/ui/ui.jsx';
import { useSubmit } from '../lib/hooks.js';

// ---------------------------------------------------------------- payment (full payment of selected lines)

function PaymentDialog({ close, due, memberName, onDone }) {
  const methods = useSettings().payment_methods;
  const [key] = useState(newKey);
  const { busy, error, submit } = useSubmit();
  const navigate = useNavigate();
  const [checked, setChecked] = useState(() => new Set(due.map((c) => c.id)));
  const [method, setMethod] = useState(methods[0] ?? '');
  const [reference, setReference] = useState('');

  const selected = due.filter((c) => checked.has(c.id));
  const by = { reservations: 0, alcool: 0, cigares: 0 };
  for (const c of selected) by[c.account] += c.amount;
  const total = by.reservations + by.alcool + by.cigares;

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
      const res = await api.post('/api/payments', { charge_ids: ids, method, reference }, key);
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
          <div className="total"><dt>Total encaissé</dt><dd>{money(total)}</dd></div></dl></div>
        <div className="form-row">
          <label className="field"><span>Moyen de paiement</span>
            <select name="method" required value={method} onChange={(e) => setMethod(e.target.value)}>
              {methods.map((x) => <option key={x}>{x}</option>)}</select></label>
          <label className="field"><span>Référence (facultatif)</span>
            <input name="reference" maxLength={80} placeholder="N° de transaction, de reçu…" value={reference} onChange={(e) => setReference(e.target.value)} /></label>
        </div>
        <FormError error={error} />
        <div className="modal-actions"><button type="button" className="btn" onClick={close}>Annuler</button>
          <button type="submit" className="btn btn-primary" id="pay-submit" disabled={busy || selected.length === 0} aria-busy={busy}>
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
  const [reference, setReference] = useState('');
  const [restock, setRestock] = useState(false);

  const onSubmit = (e) => {
    e.preventDefault();
    submit(async () => {
      if (String(reason ?? '').trim().length < 3) throw new Error('Indiquez un motif (3 caractères minimum).');
      const res = await api.post(`/api/charges/${charge.id}/refund`, { reason, method, reference, restock: Boolean(restock) }, key);
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
          <label className="field"><span>Référence (facultatif)</span>
            <input name="reference" maxLength={80} value={reference} onChange={(e) => setReference(e.target.value)} /></label>
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
