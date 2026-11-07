// A regular client's credit (spec docs/superpowers/specs/2026-11-07-credit-clients-design.md): the limit set by a boss,
// a settlement (any amount up to the debt, oldest purchases paid first) and its cancellation. Each dialog keeps one
// idempotency key for its whole life.
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api, newKey } from '../lib/api.js';
import { Modal, openDialog, actionDialog } from '../components/ui/Modal.jsx';
import { toast } from '../components/ui/toast.jsx';
import { FormError } from '../components/ui/ui.jsx';
import { money, parseMoney, toMajor } from '../lib/format.js';
import { useSubmit } from '../lib/hooks.js';
import { useSettings } from '../store/useStore.js';
import { CARD_METHOD } from '../../shared/rules.js';

function CreditLimitDialog({ close, account, onDone }) {
  const [key] = useState(newKey);
  const { busy, error, submit } = useSubmit();
  const [text, setText] = useState(account.credit_limit ? toMajor(account.credit_limit) : '');
  const limit = text.trim() === '' ? 0 : parseMoney(text);
  const onSubmit = (e) => {
    e.preventDefault();
    submit(async () => {
      if (limit === null) throw new Error('Indiquez un montant (0 pour aucun crédit).');
      const res = await api.put(`/api/clients/${account.member_id}/credit-limit`, { credit_limit: limit }, key);
      close();
      toast(limit ? `Plafond de crédit : ${money(limit)}.` : 'Crédit fermé pour ce client.');
      onDone?.(res);
    });
  };
  return (
    <Modal title="Plafond de crédit" onClose={close}>
      <form className="form-grid" onSubmit={onSubmit} noValidate>
        <p className="muted">
          Ce que <strong>{account.name}</strong> peut devoir au plus, achats à crédit non réglés compris. 0 : pas de crédit.
          {account.owed > 0 && <> Il doit aujourd’hui {money(account.owed)}.</>}
        </p>
        <label className="field"><span>Plafond</span>
          <input name="credit_limit" inputMode="decimal" autoComplete="off" placeholder="200 000" autoFocus value={text} onChange={(e) => setText(e.target.value)} /></label>
        {limit !== null && limit < account.owed && (
          <p className="subtle">Le plafond est sous la dette actuelle : aucune nouvelle vente à crédit tant qu’il n’a pas réglé.</p>
        )}
        <FormError error={error} />
        <div className="modal-actions"><button type="button" className="btn" onClick={close}>Annuler</button>
          <button type="submit" className="btn btn-primary" disabled={busy || limit === null} aria-busy={busy}>Enregistrer</button></div>
      </form>
    </Modal>
  );
}

export function openCreditLimitDialog(account, onDone) {
  openDialog(CreditLimitDialog, { account, onDone });
}

// The money is received at the till; its ticket opens next, as for any payment.
function SettlementDialog({ close, account, onDone }) {
  const methods = useSettings().payment_methods.filter((m) => m !== CARD_METHOD);
  const [key] = useState(newKey);
  const { busy, error, submit } = useSubmit();
  const navigate = useNavigate();
  const [text, setText] = useState(toMajor(account.owed));
  const [method, setMethod] = useState(methods[0] ?? '');
  const amount = parseMoney(text);
  const tooMuch = amount !== null && amount > account.owed;
  const onSubmit = (e) => {
    e.preventDefault();
    submit(async () => {
      if (!amount) throw new Error('Indiquez le montant reçu.');
      if (tooMuch) throw new Error(`Le client ne doit que ${money(account.owed)}.`);
      const res = await api.post(`/api/clients/${account.member_id}/settlements`, { amount, method }, key);
      close();
      toast(`Règlement de ${money(amount)} enregistré. Reste dû : ${money(res.account.owed)}.`);
      onDone?.(res.account);
      navigate(`/caisse/ticket/${res.payment.id}`);
    });
  };
  return (
    <Modal title="Enregistrer un règlement" onClose={close}>
      <form className="form-grid" onSubmit={onSubmit} noValidate>
        <p className="muted">
          <strong>{account.name}</strong> doit {money(account.owed)}. Le règlement paie ses achats à crédit du plus ancien au plus
          récent ; il peut n’en payer qu’une partie.
        </p>
        <div className="form-row">
          <label className="field"><span>Montant reçu</span>
            <input name="amount" inputMode="decimal" autoComplete="off" required autoFocus value={text} onChange={(e) => setText(e.target.value)} /></label>
          <label className="field"><span>Moyen de paiement</span>
            <select name="method" required value={method} onChange={(e) => setMethod(e.target.value)}>
              {methods.map((x) => <option key={x}>{x}</option>)}</select></label>
        </div>
        <dl className="calc">
          <div><dt>Doit aujourd’hui</dt><dd>{money(account.owed)}</dd></div>
          <div className="total"><dt>Restera dû</dt><dd>{money(Math.max(0, account.owed - (amount ?? 0)))}</dd></div>
        </dl>
        {tooMuch && <p className="subtle">Le montant dépasse la dette.</p>}
        <p className="subtle">Un ticket de caisse est créé, à imprimer ou envoyer sur WhatsApp.</p>
        <FormError error={error} />
        <div className="modal-actions"><button type="button" className="btn" onClick={close}>Annuler</button>
          <button type="submit" className="btn btn-primary" disabled={busy || !amount || tooMuch} aria-busy={busy}>
            {amount ? `Encaisser ${money(amount)}` : 'Encaisser'}</button></div>
      </form>
    </Modal>
  );
}

export function openSettlementDialog(account, onDone) {
  openDialog(SettlementDialog, { account, onDone });
}

export function openCancelSettlementDialog(move, onDone) {
  const key = newKey();
  actionDialog({
    title: `Annuler le règlement ${move.ticket_number}`,
    danger: true,
    confirmLabel: 'Annuler le règlement',
    message: `${money(move.paid)} (${move.method}) ressortent aujourd’hui de la caisse, de la caisse de chaque achat qu’il payait. Ces achats redeviennent dus.`,
    reasonLabel: 'Motif de l’annulation',
    run: async ({ reason }) => {
      const res = await api.post(`/api/payments/${move.payment_id}/cancel-settlement`, { reason }, key);
      toast(`Règlement annulé. Le client doit ${money(res.account.owed)}.`);
      onDone?.(res.account);
    },
  });
}
