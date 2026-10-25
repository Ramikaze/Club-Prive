// What was served in a session: cigars and alcohol in separate parts with their subtotals, then the totals.
// Everything is charged to the holder, the session's only member (the guests are not members). A product can
// be paid on the spot (cigars and drinks may be paid in cash at once) or left on the note, paid at the end.
import { money } from '../../lib/format.js';
import { useSettings } from '../../store/useStore.js';
import { toast } from './toast.jsx';
import { CARD_METHOD, CASH_METHOD } from '../../../shared/rules.js';

const PARTS = [['cigares', 'Cigares'], ['alcool', 'Alcool']];
const sum = (lines) => lines.reduce((s, l) => s + l.amount, 0);

// Product lines of a reservation detail (charges) in the shape used below.
export const consumptionOf = (charges = []) => charges.filter((c) => c.kind === 'produit' && (c.status === 'due' || c.status === 'payee'));

export default function SessionConsumptions({ lines = [] }) {
  return (
    <div className="conso">
      {lines.length ? PARTS.map(([account, label]) => {
        const part = lines.filter((l) => l.account === account);
        if (!part.length) return null;
        return (
          <div key={account} className="conso-part">
            <div className="conso-part-head"><i className={`dot dot-${account}`} /> {label}</div>
            {part.map((l) => (
              <div key={l.id} className="conso-line">
                <span>{l.quantity} × {l.label}{l.status === 'payee' && <span className="conso-paid"> · réglé</span>}</span>
                <span className="num">{money(l.amount)}</span>
              </div>
            ))}
            <div className="conso-subtotal"><span>Sous-total {label.toLowerCase()}</span><span className="num">{money(sum(part))}</span></div>
          </div>
        );
      }) : <p className="subtle">Aucune consommation.</p>}
      <dl className="calc conso-totals">
        {PARTS.map(([account, label]) => (
          <div key={account}><dt>{label}</dt><dd>{money(sum(lines.filter((l) => l.account === account)))}</dd></div>
        ))}
        <div className="total"><dt>Total des consommations</dt><dd>{money(sum(lines))}</dd></div>
      </dl>
    </div>
  );
}

// How the next product is settled: '' leaves it on the session's note (the default), a method pays it now.
// Cash comes first, then the club's other methods, then the holder's card when it holds money.
export function PayNowChoice({ value, onChange, cardBalance = 0 }) {
  const methods = useSettings().payment_methods ?? [];
  const ordered = [...methods.filter((m) => m === CASH_METHOD), ...methods.filter((m) => m !== CASH_METHOD && m !== CARD_METHOD)];
  return (
    <label className="field pay-now-choice">
      <span>Règlement</span>
      <select value={value} onChange={(e) => onChange(e.target.value)}>
        <option value="">À la note (réglé à la fin de la séance)</option>
        <optgroup label="Payer maintenant">
          {ordered.map((m) => <option key={m} value={m}>{`Payer maintenant : ${m}`}</option>)}
          {cardBalance > 0 ? <option value={CARD_METHOD}>{`Payer maintenant : ${CARD_METHOD} (${money(cardBalance)} disponibles)`}</option> : null}
        </optgroup>
      </select>
    </label>
  );
}

// The body fields that settle a product on the spot with `method` (none: it stays on the note).
export const payNowBody = (method) => {
  if (!method) return {};
  return { pay_now: method === CARD_METHOD ? { card: true } : { method } };
};

// The card pays only when it holds the whole price: checked before sending (the server refuses it too).
export const cardShort = (method, price, cardBalance) => method === CARD_METHOD && price > cardBalance;

// After a product is served: paid on the spot, a toast offers its ticket without leaving the session.
export function servedToast(product, res, fallback) {
  const payment = res?.payment;
  if (!payment) {
    toast(fallback);
    return;
  }
  toast(`${product.name} payé : ${money(payment.amount)} (${payment.method}).`, 'ok', {
    label: 'Voir le ticket', icon: 'receipt', onClick: () => { window.location.hash = `#/caisse/ticket/${payment.id}`; },
  });
}
