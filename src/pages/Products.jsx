import { useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import Icon from '../components/ui/Icon.jsx';
import { DemoChip, Empty, FormError, Loaded, PageHead, Segmented, StocksTabs } from '../components/ui/ui.jsx';
import { Modal, openDialog } from '../components/ui/Modal.jsx';
import { toast } from '../components/ui/toast.jsx';
import { api, newKey } from '../lib/api.js';
import { dateTime, money, parseMoney, toMajor } from '../lib/format.js';
import { useLoad, useSubmit } from '../lib/hooks.js';
import { useIsAdmin, useSettings } from '../store/useStore.js';

const CATEGORY = { cigare: 'Cigare', bouteille: 'Bouteille' };

const formValues = (form) => Object.fromEntries(new FormData(form));

function StockChip({ p }) {
  if (p.stock_qty === 0) return <span className="chip chip-danger">rupture</span>;
  if (p.low) return <span className="chip chip-warn">{p.stock_qty} · stock faible</span>;
  return <span className="chip chip-ok">{p.stock_qty}</span>;
}

function MovementsTable({ rows, withProduct = true }) {
  if (!rows.length) return <Empty icon="box">Aucun mouvement.</Empty>;
  return (
    <div className="table-wrap"><table className="table stack-sm">
      <thead><tr><th>Date</th>{withProduct && <th>Produit</th>}<th>Mouvement</th><th className="num">Quantité</th><th className="num">Stock après</th><th>Motif</th><th>Par</th></tr></thead>
      <tbody>{rows.map((mv) => (
        <tr key={mv.id}>
          <td data-label="Date" className="nowrap">{dateTime(mv.created_at)}</td>
          {withProduct && <td data-label="Produit">{mv.product_name}</td>}
          <td data-label="Mouvement">{mv.kind_label}</td>
          <td data-label="Quantité" className="num">{mv.quantity > 0 ? `+${mv.quantity}` : mv.quantity}</td>
          <td data-label="Stock après" className="num">{mv.stock_after}</td>
          <td data-label="Motif">{mv.reason ?? ''}</td>
          <td data-label="Par">{mv.created_by_name ?? ''}</td>
        </tr>
      ))}</tbody>
    </table></div>
  );
}

function ProductDialog({ close, product, onDone }) {
  const editing = Boolean(product);
  const [key] = useState(newKey);
  const settings = useSettings();
  const { busy, error, submit } = useSubmit();
  const threshold = product?.low_stock_threshold ?? settings.low_stock_default;

  const onSubmit = (e) => {
    e.preventDefault();
    const v = formValues(e.currentTarget);
    submit(async () => {
      const price = parseMoney(v.price);
      if (price == null) throw new Error('Prix invalide (exemple : 40000 ou 40000,50).');
      const body = {
        category: v.category, reference: v.reference, name: v.name, description: v.description, price,
        low_stock_threshold: Number(v.low_stock_threshold),
      };
      if (editing) {
        body.active = Boolean(v.active);
        await api.put(`/api/products/${product.id}`, body, key);
      } else {
        body.initial_stock = Number(v.initial_stock || 0);
        await api.post('/api/products', body, key);
      }
      close();
      toast(editing ? 'Produit enregistré.' : 'Produit créé.');
      onDone?.();
    });
  };

  return (
    <Modal title={editing ? 'Modifier le produit' : 'Nouveau produit'} size="wide" onClose={close}>
      <form className="form-grid" onSubmit={onSubmit} noValidate>
        <div className="form-row">
          <label className="field"><span>Catégorie</span><select name="category" defaultValue={product?.category ?? 'cigare'}>
            {Object.entries(CATEGORY).map(([k, label]) => <option key={k} value={k}>{label}</option>)}</select></label>
          <label className="field"><span>Référence</span><input name="reference" required maxLength={40} defaultValue={product?.reference ?? ''} /></label>
        </div>
        <label className="field"><span>Nom</span><input name="name" required maxLength={80} defaultValue={product?.name ?? ''} /></label>
        <label className="field"><span>Description (facultatif)</span><input name="description" maxLength={300} defaultValue={product?.description ?? ''} /></label>
        <div className="form-row">
          <label className="field"><span>Prix de vente ({settings.currency.label})</span><input name="price" inputMode="decimal" required defaultValue={toMajor(product?.price)} /></label>
          {!editing && <label className="field"><span>Stock initial</span><input type="number" name="initial_stock" min="0" step="1" defaultValue="0" inputMode="numeric" /></label>}
          <label className="field"><span>Seuil d’alerte</span><input type="number" name="low_stock_threshold" min="0" step="1" defaultValue={threshold} inputMode="numeric" /></label>
        </div>
        {editing && (
          <>
            <label className="check"><input type="checkbox" name="active" value="1" defaultChecked={product.active} /><span>Produit actif (proposé à la vente)</span></label>
            <p className="subtle">Le stock se modifie par une entrée ou un ajustement motivé. Un changement de prix ne modifie pas les ventes déjà saisies.</p>
          </>
        )}
        <FormError error={error} />
        <div className="modal-actions"><button type="button" className="btn" onClick={close}>Annuler</button>
          <button type="submit" className="btn btn-primary" disabled={busy} aria-busy={busy}>{editing ? 'Enregistrer' : 'Créer le produit'}</button></div>
      </form>
    </Modal>
  );
}

function StockDialog({ close, product, kind, onDone }) {
  const [key] = useState(newKey);
  const entry = kind === 'entree';
  const { busy, error, submit } = useSubmit();

  const onSubmit = (e) => {
    e.preventDefault();
    const v = formValues(e.currentTarget);
    submit(async () => {
      const body = entry
        ? { kind: 'entree', quantity: Number(v.quantity), reason: v.reason }
        : { kind: 'ajustement', target_qty: Number(v.target_qty), expected_qty: product.stock_qty, reason: v.reason };
      const res = await api.post(`/api/products/${product.id}/stock`, body, key);
      close();
      toast(`Stock de « ${res.name} » : ${res.stock_qty}.`);
      onDone?.();
    });
  };

  return (
    <Modal title={entry ? 'Entrée de stock' : 'Ajustement de stock'} onClose={close}>
      <form className="form-grid" onSubmit={onSubmit} noValidate>
        <p><strong>{product.name}</strong> · stock enregistré : <strong>{product.stock_qty}</strong></p>
        {entry ? (
          <>
            <label className="field"><span>Quantité reçue</span><input type="number" name="quantity" min="1" step="1" required inputMode="numeric" autoFocus /></label>
            <label className="field"><span>Remarque (facultatif)</span><input name="reason" maxLength={200} placeholder="Fournisseur, bon de livraison…" /></label>
          </>
        ) : (
          <>
            <label className="field"><span>Quantité constatée (inventaire)</span><input type="number" name="target_qty" min="0" step="1" required inputMode="numeric" defaultValue={product.stock_qty} autoFocus /></label>
            <label className="field"><span>Motif (obligatoire)</span><input name="reason" required minLength={3} maxLength={200} placeholder="Casse, inventaire, erreur de saisie…" /></label>
            <p className="subtle">L’écart est enregistré comme un mouvement tracé, avec votre nom et le motif.</p>
          </>
        )}
        <FormError error={error} />
        <div className="modal-actions"><button type="button" className="btn" onClick={close}>Annuler</button>
          <button type="submit" className="btn btn-primary" disabled={busy} aria-busy={busy}>Enregistrer</button></div>
      </form>
    </Modal>
  );
}

function HistoryDialog({ close, product }) {
  const { data, error } = useLoad(() => api.get(`/api/stock-movements?product_id=${product.id}&limit=200`), []);
  let content;
  if (error) content = <div className="form-error">{error.message}</div>;
  else if (data === undefined) content = <p className="subtle">Chargement…</p>;
  else content = <MovementsTable rows={data} withProduct={false} />;
  return <Modal title={`Mouvements — ${product.name}`} size="wide" onClose={close}>{content}</Modal>;
}

const productDialog = (product, onDone) => openDialog(ProductDialog, { product, onDone });
const stockDialog = (product, kind, onDone) => openDialog(StockDialog, { product, kind, onDone });
const historyDialog = (product) => openDialog(HistoryDialog, { product });

export default function Products() {
  const admin = useIsAdmin();
  const [searchParams, setSearchParams] = useSearchParams();
  const catParam = searchParams.get('cat');
  const cat = ['cigare', 'bouteille'].includes(catParam) ? catParam : '';
  const showInactive = searchParams.get('inactifs') === '1';
  const setQuery = (q) => setSearchParams(Object.fromEntries(Object.entries(q).filter(([, v]) => v !== undefined && v !== null && v !== '')));

  const state = useLoad(() => Promise.all([
    api.get(`/api/products${showInactive ? '?all=1' : ''}`),
    api.get('/api/stock-movements?limit=25'),
  ]), [showInactive]);
  const reload = () => state.reload();

  return (
    <Loaded state={state}>{([products, movements]) => {
      const list = products.filter((p) => !cat || p.category === cat);
      return (
        <>
          <StocksTabs />
          <PageHead
            title="Catalogue & Stocks"
            lead="Cigares et bouteilles du club."
            actions={admin ? <button type="button" className="btn btn-primary" onClick={() => productDialog(null, reload)}><Icon name="plus" /> Nouveau produit</button> : null}
            tour="products"
          />
          <div className="toolbar">
            <Segmented
              label="Catégorie"
              value={cat}
              options={[['', 'Tous'], ['cigare', 'Cigares'], ['bouteille', 'Bouteilles']]}
              onChange={(c) => setQuery({ cat: c, inactifs: showInactive ? '1' : '' })}
            />
            {admin && (
              <label className="check"><input type="checkbox" checked={showInactive} onChange={(e) => setQuery({ cat, inactifs: e.target.checked ? '1' : '' })} />
                <span>Afficher les produits inactifs</span></label>
            )}
          </div>
          <section className="card">
            {list.length ? (
              <div className="table-wrap"><table className="table stack-sm">
                <thead><tr><th>Produit</th><th>Catégorie</th><th className="num">Prix</th><th>Stock</th><th><span className="sr-only">Actions</span></th></tr></thead>
                <tbody>{list.map((p) => (
                  <tr key={p.id} className={p.active ? undefined : 'is-muted'}>
                    <td data-label="Produit"><strong>{p.name}</strong> <span className="subtle mono">{p.reference}</span> <DemoChip on={p.is_demo} /> {!p.active && <span className="chip">inactif</span>}
                      {p.description && <div className="subtle">{p.description}</div>}</td>
                    <td data-label="Catégorie">{CATEGORY[p.category]}</td>
                    <td data-label="Prix" className="num">{money(p.price)}</td>
                    <td data-label="Stock"><StockChip p={p} /> <span className="subtle">seuil {p.low_stock_threshold}</span></td>
                    <td className="actions">
                      <button type="button" className="btn btn-sm" onClick={() => stockDialog(p, 'entree', reload)}>Entrée</button>{' '}
                      <button type="button" className="btn btn-sm btn-ghost" onClick={() => stockDialog(p, 'ajustement', reload)}>Ajuster</button>{' '}
                      <button type="button" className="btn btn-sm btn-ghost" onClick={() => historyDialog(p)}>Historique</button>{' '}
                      {admin && <button type="button" className="btn btn-sm btn-ghost" onClick={() => productDialog(p, reload)}><Icon name="edit" /><span className="sr-only">Modifier {p.name}</span></button>}
                    </td>
                  </tr>
                ))}</tbody>
              </table></div>
            ) : <Empty icon="box">Aucun produit dans cette catégorie.</Empty>}
          </section>
          <section className="card section-gap">
            <div className="card-head"><h2>Derniers mouvements de stock</h2></div>
            <MovementsTable rows={movements} />
          </section>
        </>
      );
    }}</Loaded>
  );
}
