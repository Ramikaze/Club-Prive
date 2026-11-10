// The sale panel of one tab: title and account, buyer, lines, total, payment, « Encaisser » and the ticket line.
// The card of a member pays first and what it cannot pay is asked for by another method, as in the payment dialog.
// A regular client with a credit limit may buy « À crédit »: nothing is paid, the sale waits on his account.
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import Icon from '../ui/Icon.jsx';
import { FormError, Notice } from '../ui/ui.jsx';
import { toast } from '../ui/toast.jsx';
import BuyerPicker from './BuyerPicker.jsx';
import { api } from '../../lib/api.js';
import { money } from '../../lib/format.js';
import { useLoad, useSubmit } from '../../lib/hooks.js';
import { useSettings } from '../../store/useStore.js';
import { CARD_METHOD, CREDIT_LABEL } from '../../../shared/rules.js';
import { SHOP } from '../../../shared/roles.js';

const methodIcon = (m) => (/esp[eè]ce/i.test(m) ? 'cash' : /virement|banque/i.test(m) ? 'bank' : 'wallet');

export default function SalePanel({ account, products, cart, setCart, onSold, onRefused }) {
  const shop = SHOP[account];
  const methods = useSettings().payment_methods.filter((m) => m !== CARD_METHOD);
  const navigate = useNavigate();
  const { busy, error, submit } = useSubmit();
  const { lines, buyer } = cart;
  const [picked, setPicked] = useState(null); // null until chosen: the card when it holds money
  const [restMethod, setRestMethod] = useState(methods[0] ?? '');

  const rows = products.filter((p) => lines[p.id] > 0).map((p) => ({ p, qty: lines[p.id] }));
  const total = rows.reduce((s, r) => s + r.p.price * r.qty, 0);

  const isMember = buyer.kind === 'membre' && buyer.person !== null;
  const memberId = isMember ? buyer.person.id : null;
  const wallet = useLoad(() => (memberId ? api.get(`/api/members/${memberId}`) : Promise.resolve(null)), [memberId]);
  const loadingBalance = isMember && wallet.data === undefined && !wallet.error;
  // A balance that could not be read is not « no credit »: the sale waits until it is read again.
  const balanceUnread = isMember && wallet.data === undefined && Boolean(wallet.error);
  const balance = isMember ? (wallet.data?.wallet?.balance ?? 0) : 0;
  // The card only counts for a member who holds money: a choice made for a previous buyer falls back to the default.
  const cardUsable = isMember && balance > 0;
  // A regular client's account: his limit and what he may still owe (worker/credit.js).
  const clientId = buyer.kind === 'client' && buyer.person !== null ? buyer.person.id : null;
  const credit = useLoad(() => (clientId ? api.get(`/api/clients/${clientId}/account`) : Promise.resolve(null)), [clientId]);
  const loadingCredit = clientId !== null && credit.data === undefined && !credit.error;
  const creditUnread = clientId !== null && credit.data === undefined && Boolean(credit.error);
  const creditAvailable = clientId ? (credit.data?.available ?? 0) : 0;
  const creditUsable = clientId !== null && (credit.data?.credit_limit ?? 0) > 0 && creditAvailable >= total;
  // « À crédit » stays chosen while the buyer is a regular client, even when the cart grows past what he may still
  // owe: the sale is then blocked with a message, never silently switched to cash.
  const fallback = picked === CARD_METHOD ? !cardUsable : picked === CREDIT_LABEL ? buyer.kind !== 'client' : false;
  const method = (fallback ? null : picked) ?? (cardUsable ? CARD_METHOD : (methods[0] ?? ''));
  const byCard = cardUsable && method === CARD_METHOD;
  const onCredit = buyer.kind === 'client' && method === CREDIT_LABEL;
  const creditBlocked = onCredit && clientId !== null && !loadingCredit && !creditUnread && !creditUsable;
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
        ...(cart.order_id ? { order_id: cart.order_id } : {}),
        ...(onCredit ? { credit: true } : byCard ? { card: true, method: rest > 0 ? restMethod : undefined } : { method }),
      };
      // The cart's own key, kept across edits and failed attempts: the server stores it only after a successful sale.
      let res;
      try {
        res = await api.post('/api/shop/sales', body, cart.key);
      } catch (err) {
        // What the refusal may come from is read again: the stock on the cards, the member's card balance.
        onRefused?.();
        if (memberId) wallet.reload();
        if (clientId) credit.reload();
        throw err;
      }
      if (!res.payment) {
        // A credit sale: no ticket (no money received); the client's file shows what he owes now.
        toast(`Vente à crédit enregistrée : ${money(res.sale.amount)} à payer par ${res.sale.member_name}.`);
        onSold?.();
        navigate(`/membres/${res.sale.member_id}`);
        return;
      }
      toast(`Vente enregistrée : ${money(res.payment.amount)}.`);
      onSold?.();
      navigate(`/caisse/ticket/${res.payment.id}`);
    });
  };

  return (
    <form className="card sale-panel" onSubmit={onSubmit} noValidate aria-label={shop.title}>
      <div className="card-head">
        <h2>{shop.title}</h2>
        <span className="chip chip-neutral"><i className={`dot dot-${account}`} /> {shop.tag}</span>
      </div>

      {cart.order_id ? (
        <Notice kind="info">Commande en ligne de {buyer.person?.name} : quantités modifiables au comptoir. Changer d’acheteur détache la commande.</Notice>
      ) : null}
      {/* Another buyer is no longer the order's: the sale would be refused, so the link is dropped. */}
      <BuyerPicker buyer={buyer} onChange={(b) => setCart(({ order_id: _order, ...c }) => ({ ...c, buyer: b }))} />
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
        {/* Shown as soon as « Membre » is chosen, so staff know the card can pay; usable once a member with money is picked. */}
        {buyer.kind === 'membre' && (
          <label className={`pay-method pay-method-card${balance > 0 ? '' : ' is-empty'}`}>
            <input type="radio" name="method" value={CARD_METHOD} checked={byCard} disabled={balance <= 0 || loadingBalance}
              onChange={() => setPicked(CARD_METHOD)} />
            <Icon name="card" />
            <span><strong>{CARD_METHOD}</strong>
              <span className="subtle">{!isMember ? 'Choisissez le membre pour voir son solde'
                : loadingBalance ? 'Lecture du solde…' : balanceUnread ? 'Solde illisible'
                  : balance > 0 ? `${money(balance)} disponibles` : 'Aucun crédit sur la carte'}</span></span>
          </label>
        )}
        {buyer.kind === 'client' && (
          <label className={`pay-method pay-method-card${creditUsable || onCredit ? '' : ' is-empty'}`}>
            <input type="radio" name="method" value={CREDIT_LABEL} checked={onCredit} disabled={(!creditUsable && !onCredit) || loadingCredit}
              onChange={() => setPicked(CREDIT_LABEL)} />
            <Icon name="receipt" />
            <span><strong>{CREDIT_LABEL}</strong>
              <span className="subtle">{clientId === null ? 'Choisissez le client pour voir son crédit'
                : loadingCredit ? 'Lecture du crédit…'
                  : creditUnread ? 'Crédit illisible'
                  : !(credit.data?.credit_limit > 0) ? 'Pas de crédit (plafond à fixer sur sa fiche)'
                    : `${money(creditAvailable)} de crédit disponible${creditAvailable < total ? ' : pas assez pour ce panier' : ''}`}</span></span>
          </label>
        )}
        {methods.map((x) => (
          <label key={x} className="pay-method">
            <input type="radio" name="method" value={x} checked={!byCard && !onCredit && method === x} onChange={() => setPicked(x)} />
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

      {(balanceUnread || creditUnread) && (
        <Notice kind="warn">
          {balanceUnread ? 'Le solde de la carte n’a pas pu être lu' : 'Le crédit du client n’a pas pu être lu'} : vérifiez le
          réseau, puis réessayez avant d’encaisser.{' '}
          <button type="button" className="btn btn-sm" onClick={balanceUnread ? wallet.retry : credit.retry}>Réessayer</button>
        </Notice>
      )}
      {creditBlocked && rows.length > 0 && (
        <Notice kind="warn">Crédit insuffisant pour ce panier : retirez un produit ou choisissez un autre moyen de paiement.</Notice>
      )}
      <FormError error={error} />
      <button type="submit" className="btn btn-primary btn-block" disabled={busy || loadingBalance || loadingCredit || balanceUnread || creditUnread || creditBlocked || !rows.length || needsBuyer} aria-busy={busy}>
        {!rows.length ? 'Encaisser' : onCredit ? `Vendre à crédit ${money(total)}` : `Encaisser ${money(total)}`}
      </button>
      {needsBuyer && <p className="subtle">Choisissez l’acheteur pour encaisser.</p>}
      <p className="subtle">{onCredit ? 'Pas de ticket : la vente s’ajoute au compte du client, à régler plus tard.'
        : buyer.kind === 'journalier' ? 'Ticket imprimé au format ticket de caisse' : 'Ticket : imprimé ou envoyé sur WhatsApp'}</p>
    </form>
  );
}
