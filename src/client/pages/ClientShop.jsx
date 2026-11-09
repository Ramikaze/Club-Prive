// « Boutique »: the cigars and the champagne he can order, to take at the club, and his orders. An order only sets the
// products aside: nothing is paid or taken out of stock until the staff hands them over at the counter.
import { Fragment, useState } from 'react';
import Icon from '../../components/ui/Icon.jsx';
import { Loaded, Segmented } from '../../components/ui/ui.jsx';
import { toast } from '../../components/ui/toast.jsx';
import { useBusy, useLoad } from '../../lib/hooks.js';
import { dateTime, money } from '../../lib/format.js';
import { clientApi, clientPhotoUrl } from '../clientApi.js';

const TABS = [['cigare', 'Cigares'], ['bouteille', 'Champagne']];
const ORDER_STATUS = {
  en_attente: ['En attente', 'warn'], prete: ['Prête au club', 'ok'], retiree: ['Retirée', 'neutral'], annulee: ['Annulée', 'danger'],
};

// The picture, or a cigar or a bottle when the product has none or it cannot be loaded.
function Thumb({ product }) {
  const url = clientPhotoUrl(product);
  const [failed, setFailed] = useState(null);
  const shown = url !== null && failed !== url;
  return (
    <span className={`product-photo product-photo-thumb${shown ? '' : ' is-empty'}`}>
      {shown
        ? <img src={url} alt="" loading="lazy" decoding="async" onError={() => setFailed(url)} />
        : <span className="product-photo-none"><Icon name={product.category === 'bouteille' ? 'bottle' : 'cigar'} /></span>}
    </span>
  );
}

function Orders({ orders, reload }) {
  const [asking, setAsking] = useState(null);
  const { busy, run } = useBusy();
  const cancel = (id) => run(async () => {
    await clientApi.post(`/api/client/orders/${id}/cancel`, {});
    setAsking(null);
    toast('Commande annulée.');
    reload();
  });
  return (
    <section className="cl-card" aria-label="Mes commandes">
      <div className="cl-head"><h2>Mes commandes</h2></div>
      {orders.length === 0 && <p className="muted">Aucune commande pour le moment.</p>}
      <ul className="cl-rows">
        {orders.map((o) => {
          const [label, kind] = ORDER_STATUS[o.status] ?? [o.status, 'neutral'];
          const total = o.lines.reduce((sum, l) => sum + l.quantity * l.unit_price, 0);
          return (
            <li key={o.id}>
              <div className="cl-row-main">
                {/* A closed order tells which lines the client did not take (their products were let go). */}
                <strong>{o.lines.map((l, i) => (
                  <Fragment key={i}>
                    {i > 0 && ', '}{l.quantity} × {l.name}{l.taken === false && <span className="cl-untaken"> (non retiré)</span>}
                  </Fragment>
                ))}</strong>
                <span className="muted">{dateTime(o.created_at)} · {money(total)}</span>
                {o.status === 'annulee' && o.cancel_reason && <span className="cl-reason">Motif : {o.cancel_reason}</span>}
                {o.status === 'prete' && <span className="cl-reason">Votre commande vous attend au club.</span>}
                {o.status === 'en_attente' && (asking === o.id ? (
                  <span className="cl-inline">
                    <button type="button" className="btn btn-sm btn-danger" disabled={busy} onClick={() => cancel(o.id)}>Confirmer l’annulation</button>
                    <button type="button" className="btn btn-sm" onClick={() => setAsking(null)}>Garder</button>
                  </span>
                ) : <button type="button" className="cl-link" onClick={() => setAsking(o.id)}>Annuler</button>)}
              </div>
              <span className={`chip chip-${kind}`}>{label}</span>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

export default function ClientShop() {
  const state = useLoad(async () => {
    const [products, orders] = await Promise.all([clientApi.get('/api/client/products'), clientApi.get('/api/client/orders')]);
    return { products, orders };
  }, [], { refreshMs: 30000 });
  const [tab, setTab] = useState('cigare');
  const [qty, setQty] = useState({});
  const { busy, run } = useBusy();

  const order = (products) => run(async () => {
    const lines = products.filter((p) => (qty[p.id] ?? 0) > 0).map((p) => ({ product_id: p.id, quantity: Math.min(qty[p.id], p.max_order) }));
    await clientApi.post('/api/client/orders', { lines });
    setQty({});
    toast('Commande envoyée : vous la retirerez au club.');
    state.reload();
  });

  return (
    <div className="cl-stack">
      <div><h1>Boutique</h1><p className="muted">À retirer au club</p></div>
      <Loaded state={state}>
        {({ products, orders }) => {
          // A quantity never goes past what is left to order, even if the stock moved since it was chosen.
          const count = (p) => Math.min(qty[p.id] ?? 0, p.max_order);
          const chosen = products.filter((p) => count(p) > 0);
          const articles = chosen.reduce((n, p) => n + count(p), 0);
          const total = chosen.reduce((sum, p) => sum + count(p) * p.price, 0);
          const set = (p, n) => setQty((q) => ({ ...q, [p.id]: Math.max(0, Math.min(p.max_order, n)) }));
          const shown = products.filter((p) => p.category === tab);
          return (
            <>
              <Segmented value={tab} options={TABS} onChange={setTab} label="Rayon" />
              <section className="cl-card" aria-label="Produits">
                {shown.length === 0 && <p className="muted">Rien à commander dans ce rayon.</p>}
                <ul className="cl-rows">
                  {shown.map((p) => (
                    <li key={p.id}>
                      <Thumb product={p} />
                      <div className="cl-row-main">
                        <strong>{p.name}</strong>
                        {p.description && <span className="cl-desc">{p.description}</span>}
                        <span className="muted">{money(p.price)}</span>
                      </div>
                      {p.available ? (
                        <div className="cl-qty" role="group" aria-label={`Quantité de ${p.name}`}>
                          <button type="button" aria-label="Retirer un" disabled={count(p) <= 0} onClick={() => set(p, count(p) - 1)}>−</button>
                          <output aria-live="polite">{count(p)}</output>
                          <button type="button" aria-label="Ajouter un" disabled={count(p) >= p.max_order} onClick={() => set(p, count(p) + 1)}>+</button>
                        </div>
                      ) : <span className="chip">Indisponible</span>}
                    </li>
                  ))}
                </ul>
              </section>
              {articles > 0 && (
                <section className="cl-card cl-basket" aria-label="Panier">
                  <div className="cl-basket-line"><span>{articles} article{articles > 1 ? 's' : ''}</span><strong>{money(total)}</strong></div>
                  <button type="button" className="btn btn-primary btn-block" disabled={busy} aria-busy={busy} onClick={() => order(products)}>
                    Commander · à retirer au club
                  </button>
                </section>
              )}
              <Orders orders={orders} reload={state.reload} />
            </>
          );
        }}
      </Loaded>
    </div>
  );
}
