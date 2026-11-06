// One product of the Boutique: photo (or an empty slot), name, price, stock and the « Ajouter » button. A boss of the
// rayon outside the demo also gets « + Ajouter une photo » on a product without one, which reuses the upload of the
// product sheet (preparePhoto, PUT /api/products/:id/photo).
import { useRef } from 'react';
import Icon from '../ui/Icon.jsx';
import { ProductPhoto } from '../ui/ui.jsx';
import { toast } from '../ui/toast.jsx';
import { api } from '../../lib/api.js';
import { money } from '../../lib/format.js';
import { useBusy } from '../../lib/hooks.js';
import { preparePhoto } from '../../lib/photo.js';

export default function ShopProductCard({ product, inCart, canSell, canEditPhoto, onAdd, onPhoto }) {
  const picker = useRef(null);
  const upload = useBusy();
  const out = product.stock_qty <= 0;
  const full = inCart >= Math.min(99, product.stock_qty);

  const onPick = (e) => {
    const input = e.currentTarget;
    const file = input.files?.[0];
    if (!file) return;
    upload.run(async () => {
      try {
        const photo = await preparePhoto(file);
        await api.put(`/api/products/${product.id}/photo`, photo);
        toast('Photo ajoutée.');
        onPhoto?.();
      } finally {
        // Emptied once the file is read, so that choosing the same file again still fires a change.
        input.value = '';
      }
    });
  };

  return (
    <li className={`shop-card${out ? ' is-out' : ''}`}>
      <ProductPhoto product={product} large />
      <div className="shop-card-body">
        <h3 className="shop-card-name">{product.name}</h3>
        <p className="shop-card-price">{money(product.price)}</p>
        <p>
          {out ? <span className="chip chip-danger">rupture</span>
            : product.low ? <span className="chip chip-warn">stock {product.stock_qty} · faible</span>
              : <span className="chip chip-ok">stock {product.stock_qty}</span>}
          {inCart > 0 && <span className="chip chip-neutral">{inCart} au panier</span>}
        </p>
      </div>
      {canEditPhoto && !product.photo_version && (
        <>
          <input ref={picker} type="file" accept="image/*" hidden onChange={onPick} />
          <button type="button" className="btn btn-sm btn-ghost" disabled={upload.busy} aria-busy={upload.busy} onClick={() => picker.current?.click()}>
            {upload.busy ? 'Envoi…' : '+ Ajouter une photo'}
          </button>
        </>
      )}
      {canSell && (
        <button type="button" className="btn btn-sm" disabled={out || full} onClick={() => onAdd(product)}
          aria-label={`Ajouter ${product.name}`}>
          <Icon name="plus" /> Ajouter
        </button>
      )}
    </li>
  );
}
