// The Boutique: counter sales of cigars and champagne. Two tabs, each with its own cart, kept when switching tabs
// and while the ticket of the other one is printed (the carts live in the store). A user who cannot sell in the
// open tab sees it read-only.
import { useState } from 'react';
import SmartSearch from '../components/ui/SmartSearch.jsx';
import { Empty, Loaded, Notice, PageHead, ProductPhoto, Segmented } from '../components/ui/ui.jsx';
import ShopProductCard from '../components/shop/ShopProductCard.jsx';
import SalePanel from '../components/shop/SalePanel.jsx';
import { api, newKey } from '../lib/api.js';
import { money } from '../lib/format.js';
import { useLoad } from '../lib/hooks.js';
import { useMe, useStore } from '../store/useStore.js';
import { searchable, smartFilter } from '../../shared/search.js';
import { SHOP, RAYONS, canSellIn, ownsAccount } from '../../shared/roles.js';

// The key is created with the cart and kept for its whole life: a retry after a lost answer never records the sale twice.
const emptyCart = () => ({ key: newKey(), lines: {}, buyer: { kind: 'journalier', person: null } });

export default function Shop() {
  const me = useMe();
  const demo = useStore((s) => s.demo);
  const [fresh] = useState(() => ({ cigares: emptyCart(), alcool: emptyCart() }));
  const carts = useStore((s) => s.shopCarts) ?? fresh;
  const setCarts = useStore((s) => s.setShopCarts);
  // Back from a ticket, the tab whose cart still waits opens first.
  const [account, setAccount] = useState(() => {
    const sellable = RAYONS.filter((a) => canSellIn(me, a));
    return sellable.find((a) => Object.keys(carts[a].lines).length) ?? sellable[0] ?? 'cigares';
  });
  const [search, setSearch] = useState('');
  const state = useLoad(() => api.get('/api/products'), []);

  const shop = SHOP[account];
  const canSell = canSellIn(me, account);
  const setCart = (update) => setCarts((stored) => {
    const all = stored ?? fresh;
    return { ...all, [account]: typeof update === 'function' ? update(all[account]) : update };
  });
  const cart = carts[account];

  return (
    <Loaded state={state}>{(all) => {
      const products = all.filter((p) => p.active && p.category === shop.category);
      const list = searchable(search) ? smartFilter(products, search, (p) => [p.name, p.reference, p.description]) : products;
      const inCart = (p) => cart.lines[p.id] ?? 0;
      const count = Object.values(cart.lines).reduce((s, n) => s + n, 0);
      const amount = products.reduce((s, p) => s + p.price * inCart(p), 0);
      const add = (p) => setCart((c) => ({ ...c, lines: { ...c.lines, [p.id]: Math.min(99, p.stock_qty, (c.lines[p.id] ?? 0) + 1) } }));

      return (
        <>
          <PageHead title="Boutique" lead="Vente au comptoir : cigares et champagne." />
          <div className="toolbar">
            <Segmented label="Rayon" value={account} options={RAYONS.map((a) => [a, SHOP[a].tab])} onChange={(a) => { setAccount(a); setSearch(''); }} />
            <SmartSearch
              value={search}
              onChange={setSearch}
              suggestions={list}
              onPick={(p) => setSearch(p.name)}
              placeholder="Nom du produit"
              label="Rechercher un produit"
              renderSuggestion={(p) => (
                <>
                  <ProductPhoto product={p} />
                  <div className="grow">
                    <div className="title">{p.name}</div>
                    <div className="meta">{money(p.price)} · stock {p.stock_qty}</div>
                  </div>
                </>
              )}
            />
          </div>
          {!canSell && <Notice kind="info">Consultation seule : la vente de ce rayon est réservée à son associé, à l’administrateur et au gérant.</Notice>}
          <div data-tour="shop" className={`shop-layout${canSell ? '' : ' is-readonly'}`}>
            <section aria-label={shop.tab}>
              {list.length ? (
                <ul className="shop-grid">
                  {list.map((p) => (
                    <ShopProductCard
                      key={p.id} product={p} inCart={inCart(p)} canSell={canSell} onAdd={add} onPhoto={state.reload}
                      canEditPhoto={ownsAccount(me, account) && !demo}
                    />
                  ))}
                </ul>
              ) : (
                <div className="card"><Empty icon="box">{searchable(search) ? `Aucun produit ne correspond à « ${search.trim()} ».` : 'Aucun produit actif dans ce rayon.'}</Empty></div>
              )}
            </section>
            {canSell && (
              <aside className="shop-side" id="shop-sale">
                {/* A paid cart starts again empty, with a new key: the next sale can never replay this one. A refused
                    sale (stock, closed day…) keeps the cart and its key, and the stock is read again. */}
                <SalePanel
                  key={account} account={account} products={products} cart={cart} setCart={setCart}
                  onSold={() => setCart(emptyCart())} onRefused={state.reload}
                />
              </aside>
            )}
          </div>
          {canSell && count > 0 && (
            <button type="button" className="btn btn-primary shop-cart-jump"
              onClick={() => document.getElementById('shop-sale')?.scrollIntoView({ behavior: 'smooth' })}>
              Panier · {count} · {money(amount)}
            </button>
          )}
        </>
      );
    }}</Loaded>
  );
}
