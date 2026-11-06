// The sale panel of one tab: title and account, buyer, lines, total, payment, « Encaisser » and the ticket line.
// The card of a member pays first and what it cannot pay is asked for by another method, as in the payment dialog.
import { useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import Icon from '../ui/Icon.jsx';
import { FormError, Notice } from '../ui/ui.jsx';
import { toast } from '../ui/toast.jsx';
import BuyerPicker from './BuyerPicker.jsx';
import { api, newKey } from '../../lib/api.js';
import { money } from '../../lib/format.js';
import { useLoad, useSubmit } from '../../lib/hooks.js';
import { useSettings } from '../../store/useStore.js';
import { CARD_METHOD } from '../../../shared/rules.js';
import { SHOP } from '../../../shared/roles.js';

const methodIcon = (m) => (/esp[eè]ce/i.test(m) ? 'cash' : /virement|banque/i.test(m) ? 'bank' : 'wallet');

export default function SalePanel({ account, products, cart, setCart }) {
  const shop = SHOP[account];
  const methods = useSettings().payment_methods.filter((m) => m !== CARD_METHOD);
  const navigate = useNavigate();
  const { busy, error, submit } = useSubmit();
  const { lines, buyer } = cart;
  const [picked, setPicked] = useState(null); // null until chosen: the card when it holds money
  const [restMethod, setRestMethod] = useState(methods[0] ?? '');
  // One key per distinct request: a retry of the same sale is applied once, a changed cart is a new sale.
  const attempt = useRef({ sig: '', key: '' });

  const rows = products.filter((p) => lines[p.id] > 0).map((p) => ({ p, qty: lines[p.id] }));
  const total = rows.reduce((s, r) => s + r.p.price * r.qty, 0);

  const isMember = buyer.kind === 'membre' && buyer.person !== null;
  const memberId = isMember ? buyer.person.id : null;
  const wallet = useLoad(() => (memberId ? api.get(`/api/members/${memberId}`) : Promise.resolve(null)), [memberId]);
  const loadingBalance = isMember && wallet.data === undefined && !wallet.error;
  const balance = isMember ? (wallet.data?.wallet?.balance ?? 0) : 0;
  // The card only counts for a member who holds money: a choice made for a previous buyer falls back to the default.
  const cardUsable = isMember && balance > 0;
  const method = (picked === CARD_METHOD && !cardUsable ? null : picked) ?? (cardUsable ? CARD_METHOD : (methods[0] ?? ''));
  const byCard = cardUsable && method === CARD_METHOD;
  const rest = total - (byCard ? Math.min(balance, total) : 0);
  const needsBuyer = buyer.kind !== 'journalier' && buyer.person === null;

  const setQty = (id, qty) => setCart((c) => {
    const next = { ...c.lines };
    if (qty <= 0) delete next[id];
    else next[id] = qty;
    return { ...c, lines: next };
  });

  const onSubmit = (e) => {
    e.preventDefault();
    submit(async () => {
      const body = {
        account,
        buyer: buyer.kind === 'journalier' ? { kind: 'journalier' } : { kind: buyer.kind, member_id: buyer.person.id },
        lines: rows.map((r) => ({ product_id: r.p.id, quantity: r.qty })),
        ...(byCard ? { card: true, method: rest > 0 ? restMethod : undefined } : { method }),
      };
      const sig = JSON.stringify(body);
      if (attempt.current.sig !== sig) attempt.current = { sig, key: newKey() };
      const res = await api.post('/api/shop/sales', body, attempt.current.key);
      toast(`Vente enregistrée : ${money(res.payment.amount)}.`);
      navigate(`/caisse/ticket/${res.payment.id}`);
    });
  };

  return (
    <form className="card sale-panel" onSubmit={onSubmit} noValidate aria-label={shop.title}>
      <div className="card-head">
        <h2>{shop.title}</h2>
        <span className="chip chip-neutral"><i className={`dot dot-${account}`} /> {shop.tag}</span>
      </div>

      <BuyerPicker buyer={buyer} onChange={(b) => setCart((c) => ({ ...c, buyer: b }))} />
      {isMember && buyer.person.in_room && (
        <Notice kind="warn">Ce membre est en séance : pour une consommation sur place, ajoutez-la à sa séance.</Notice>
      )}

      {rows.length ? (
        <ul className="sale-lines">
          {rows.map(({ p, qty }) => (
            <li key={p.id}>
              <span className="sale-line-name">{p.name}</span>
              <span className="stepper">
                <button type="button" className="btn btn-sm" onClick={() => setQty(p.id, qty - 1)} aria-label={`Retirer un ${p.name}`}>−</button>
                <output aria-label={`Quantité de ${p.name}`}>{qty}</output>
                <button type="button" className="btn btn-sm" disabled={qty >= Math.min(99, p.stock_qty)} onClick={() => setQty(p.id, qty + 1)} aria-label={`Ajouter un ${p.name}`}>+</button>
              </span>
              <span className="sale-line-amount">{money(p.price * qty)}</span>
            </li>
          ))}
        </ul>
      ) : <p className="subtle sale-empty">Le panier est vide. Touchez « Ajouter » sur un produit.</p>}

      <dl className="calc"><div className="total"><dt>Total</dt><dd>{money(total)}</dd></div></dl>

      <fieldset className="field pay-methods">
        <legend>Moyen de paiement</legend>
        {isMember && (
          <label className={`pay-method pay-method-card${balance > 0 ? '' : ' is-empty'}`}>
            <input type="radio" name="method" value={CARD_METHOD} checked={byCard} disabled={balance <= 0 || loadingBalance}
              onChange={() => setPicked(CARD_METHOD)} />
            <Icon name="card" />
            <span><strong>{CARD_METHOD}</strong>
              <span className="subtle">{loadingBalance ? 'Lecture du solde…' : balance > 0 ? `${money(balance)} disponibles` : 'Aucun crédit sur la carte'}</span></span>
          </label>
        )}
        {methods.map((x) => (
          <label key={x} className="pay-method">
            <input type="radio" name="method" value={x} checked={!byCard && method === x} onChange={() => setPicked(x)} />
            <Icon name={methodIcon(x)} />
            <span><strong>{x}</strong></span>
          </label>
        ))}
      </fieldset>
      {byCard && rest > 0 && (
        <label className="field"><span>{`Moyen pour le reste (${money(rest)})`}</span>
          <select name="rest_method" value={restMethod} onChange={(e) => setRestMethod(e.target.value)}>
            {methods.map((x) => <option key={x}>{x}</option>)}</select></label>
      )}

      <FormError error={error} />
      <button type="submit" className="btn btn-primary btn-block" disabled={busy || loadingBalance || !rows.length || needsBuyer} aria-busy={busy}>
        {rows.length ? `Encaisser ${money(total)}` : 'Encaisser'}
      </button>
      {needsBuyer && <p className="subtle">Choisissez l’acheteur pour encaisser.</p>}
      <p className="subtle">{buyer.kind === 'journalier' ? 'Ticket imprimé au format ticket de caisse' : 'Ticket : imprimé ou envoyé sur WhatsApp'}</p>
    </form>
  );
}
