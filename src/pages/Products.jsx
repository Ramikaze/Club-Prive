import { useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import Icon from '../components/ui/Icon.jsx';
import SmartSearch from '../components/ui/SmartSearch.jsx';
import { DemoChip, Empty, FormError, Loaded, PageHead, ProductPhoto, Segmented, StocksTabs } from '../components/ui/ui.jsx';
import { Modal, actionDialog, openDialog } from '../components/ui/Modal.jsx';
import { toast } from '../components/ui/toast.jsx';
import { api, newKey } from '../lib/api.js';
import { dateTime, money, parseMoney, toMajor } from '../lib/format.js';
import { useBusy, useLoad, useSubmit } from '../lib/hooks.js';
import { preparePhoto } from '../lib/photo.js';
import { useIsAdmin, useSettings, useStore } from '../store/useStore.js';
import { writeWorkbook } from '../utils/exportExcel.js';
import { searchable, smartFilter } from '../../shared/search.js';

const CATEGORY = { cigare: 'Cigare', bouteille: 'Bouteille' };

const formValues = (form) => Object.fromEntries(new FormData(form));

// Excel exports, built here from what the page already loaded: the catalogue as listed (category, search and
// inactive filter applied), and one product's movements.
const fileSlug = (text) => text.normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^\w-]+/g, '-').replace(/^-|-$/g, '');

function exportCatalogue(products, currency) {
  return writeWorkbook([{
    sheet: 'Catalogue',
    header: ['Référence', 'Produit', 'Catégorie', 'Description', `Prix (${currency})`, 'Stock', 'Seuil d’alerte', 'État'],
    rows: products.map((p) => [p.reference, p.name, CATEGORY[p.category], p.description ?? '', p.price / 100, p.stock_qty,
      p.low_stock_threshold, p.active ? 'Actif' : 'Inactif']),
  }], 'catalogue.xlsx');
}

function exportHistory(product, rows) {
  return writeWorkbook([{
    sheet: 'Mouvements',
    header: ['Date', 'Mouvement', 'Quantité', 'Stock après', 'Motif', 'Par'],
    rows: rows.map((mv) => [dateTime(mv.created_at), mv.kind_label, mv.quantity, mv.stock_after, mv.reason ?? '', mv.created_by_name ?? '']),
  }], `mouvements-${fileSlug(product.reference || product.name)}.xlsx`);
}

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
  const isAdmin = useIsAdmin();
  const { busy, error, submit } = useSubmit();

  const onSubmit = (e) => {
    e.preventDefault();
    const v = formValues(e.currentTarget);
    submit(async () => {
      if (!entry && !isAdmin && Number(v.target_qty) < product.stock_qty) {
        throw new Error('Le gérant peut seulement ajouter des quantités. Pour en retirer, adressez-vous à un administrateur.');
      }
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
            <label className="field"><span>Quantité constatée (inventaire)</span><input type="number" name="target_qty" min={isAdmin ? 0 : product.stock_qty} step="1" required inputMode="numeric" defaultValue={product.stock_qty} autoFocus />
              {!isAdmin && <span className="help">Vous pouvez seulement augmenter le stock. Pour le diminuer, un administrateur fait l’ajustement.</span>}</label>
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
  const excel = useBusy();
  let content;
  if (error) content = <div className="form-error">{error.message}</div>;
  else if (data === undefined) content = <p className="subtle">Chargement…</p>;
  else {
    content = (
      <>
        {data.length > 0 && (
          <div className="row" style={{ justifyContent: 'flex-end', marginBottom: 12 }}>
            <button type="button" className="btn btn-sm" disabled={excel.busy} aria-busy={excel.busy}
              onClick={() => excel.run(() => exportHistory(product, data))}><Icon name="excel" /> Exporter en Excel</button>
          </div>
        )}
        <MovementsTable rows={data} withProduct={false} />
      </>
    );
  }
  return <Modal title={`Mouvements — ${product.name}`} size="wide" onClose={close}>{content}</Modal>;
}

// The sheet of a product, open to everyone: its photo large, its description, its price and stock. An administrator
// outside the demo also keeps the photo up here. A picture is saved the moment it is chosen (not with the Save
// button of a form), and the list behind is refreshed so that its thumbnail follows.
function ProductSheet({ close, product, onDone }) {
  const admin = useIsAdmin();
  const demo = useStore((s) => s.demo);
  const [p, setP] = useState(product);
  const { busy, error, submit } = useSubmit();
  const picker = useRef(null);
  // The server refuses photos in the demo space anyway: the buttons are not even offered there.
  const canEditPhoto = admin && !demo;

  const onPick = (e) => {
    const input = e.currentTarget;
    const file = input.files?.[0];
    if (!file) return;
    submit(async () => {
      try {
        const photo = await preparePhoto(file);
        setP(await api.put(`/api/products/${p.id}/photo`, photo));
        toast(p.photo_version ? 'Photo remplacée.' : 'Photo ajoutée.');
        onDone?.();
      } finally {
        // Emptied once the file is read (a phone may drop the file when the field is emptied first), so that choosing
        // the same file again still fires a change.
        input.value = '';
      }
    });
  };

  const onRemove = () => actionDialog({
    title: 'Retirer la photo',
    danger: true,
    confirmLabel: 'Retirer la photo',
    message: `Retirer la photo de « ${p.name} » ? Le produit reste au catalogue, sans photo.`,
    run: async () => {
      setP(await api.del(`/api/products/${p.id}/photo`));
      toast('Photo retirée.');
      onDone?.();
    },
  });

  return (
    <>
      {/* Outside the window on purpose: the window puts its first field in focus when it opens, and this one is hidden. */}
      {canEditPhoto && <input ref={picker} type="file" accept="image/*" hidden onChange={onPick} />}
      <Modal title="Fiche produit" size="wide" onClose={close}>
        <div className="product-sheet">
          <ProductPhoto product={p} large />
          <div className="product-sheet-info">
            <div>
              <h3 className="product-sheet-name">{p.name}</h3>
              <p className="subtle"><span className="mono">{p.reference}</span> · {CATEGORY[p.category]} <DemoChip on={p.is_demo} /> {!p.active && <span className="chip">inactif</span>}</p>
            </div>
            {p.description && <p>{p.description}</p>}
            <dl className="kv">
              <dt>Prix de vente</dt><dd>{money(p.price)}</dd>
              <dt>Stock</dt><dd><StockChip p={p} /></dd>
            </dl>
            {canEditPhoto && (
              <div className="row">
                <button type="button" className="btn" disabled={busy} aria-busy={busy} onClick={() => picker.current?.click()}>
                  <Icon name="photo" /> {busy ? 'Envoi de la photo…' : p.photo_version ? 'Changer la photo' : 'Ajouter une photo'}
                </button>
                {p.photo_version && (
                  <button type="button" className="btn btn-danger" disabled={busy} onClick={onRemove}><Icon name="trash" /> Retirer la photo</button>
                )}
              </div>
            )}
            {admin && demo && <p className="subtle">Les photos se gèrent hors du mode démo.</p>}
            <FormError error={error} />
          </div>
        </div>
        <div className="modal-actions"><button type="button" className="btn" onClick={close}>Fermer</button></div>
      </Modal>
    </>
  );
}

const productDialog = (product, onDone) => openDialog(ProductDialog, { product, onDone });
const sheetDialog = (product, onDone) => openDialog(ProductSheet, { product, onDone });
const stockDialog = (product, kind, onDone) => openDialog(StockDialog, { product, kind, onDone });
const historyDialog = (product) => openDialog(HistoryDialog, { product });

export default function Products() {
  const admin = useIsAdmin();
  const settings = useSettings();
  const excel = useBusy();
  const [searchParams, setSearchParams] = useSearchParams();
  const catParam = searchParams.get('cat');
  const cat = ['cigare', 'bouteille'].includes(catParam) ? catParam : '';
  const showInactive = searchParams.get('inactifs') === '1';
  const [search, setSearch] = useState('');
  const setQuery = (q) => setSearchParams(Object.fromEntries(Object.entries(q).filter(([, v]) => v !== undefined && v !== null && v !== '')));

  const state = useLoad(() => Promise.all([
    api.get(`/api/products${showInactive ? '?all=1' : ''}`),
    api.get('/api/stock-movements?limit=25'),
  ]), [showInactive]);
  const reload = () => state.reload();

  return (
    <Loaded state={state}>{([products, movements]) => {
      const inCategory = products.filter((p) => !cat || p.category === cat);
      const searching = searchable(search);
      const list = searching
        ? smartFilter(inCategory, search, (p) => [p.name, p.reference, CATEGORY[p.category], p.description])
        : inCategory;
      return (
        <>
          <StocksTabs />
          <PageHead
            title="Catalogue & Stocks"
            lead="Cigares et bouteilles du club."
            actions={(
              <>
                <button type="button" className="btn" disabled={excel.busy || !list.length} aria-busy={excel.busy}
                  onClick={() => excel.run(() => exportCatalogue(list, settings.currency.label))}><Icon name="excel" /> Exporter en Excel</button>
                {admin && <button type="button" className="btn btn-primary" onClick={() => productDialog(null, reload)}><Icon name="plus" /> Nouveau produit</button>}
              </>
            )}
            tour="products"
          />
          <div className="toolbar">
            <SmartSearch
              value={search}
              onChange={setSearch}
              suggestions={list}
              onPick={(p) => sheetDialog(p, reload)}
              placeholder="Nom, référence, origine…"
              label="Rechercher un produit"
              renderSuggestion={(p) => (
                <>
                  <ProductPhoto product={p} />
                  <div className="grow">
                    <div className="title">{p.name}</div>
                    <div className="meta">{p.reference} · {money(p.price)} · stock {p.stock_qty}</div>
                  </div>
                </>
              )}
            />
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
                    <td data-label="Produit" className="cell-product">
                      <div className="product-cell">
                        <ProductPhoto product={p} />
                        <div className="product-cell-text">
                          <button type="button" className="product-open" title="Voir la fiche du produit" onClick={() => sheetDialog(p, reload)}><strong>{p.name}</strong></button>{' '}
                          <span className="subtle mono">{p.reference}</span> <DemoChip on={p.is_demo} /> {!p.active && <span className="chip">inactif</span>}
                          {p.description && <div className="subtle product-desc">{p.description}</div>}
                        </div>
                      </div>
                    </td>
                    <td data-label="Catégorie">{CATEGORY[p.category]}</td>
                    <td data-label="Prix" className="num">{money(p.price)}</td>
                    <td data-label="Stock"><StockChip p={p} /> <span className="subtle">seuil {p.low_stock_threshold}</span></td>
                    <td className="actions">
                      <div className="product-actions">
                        <button type="button" className="btn btn-sm" onClick={() => stockDialog(p, 'entree', reload)}>Entrée</button>
                        <button type="button" className="btn btn-sm btn-ghost" onClick={() => stockDialog(p, 'ajustement', reload)}>Ajuster</button>
                        <button type="button" className="btn btn-sm btn-ghost" onClick={() => historyDialog(p)}>Historique</button>
                        {admin && <button type="button" className="btn btn-sm btn-ghost" onClick={() => productDialog(p, reload)}><Icon name="edit" /><span className="sr-only">Modifier {p.name}</span></button>}
                      </div>
                    </td>
                  </tr>
                ))}</tbody>
              </table></div>
            ) : <Empty icon="box">{searching ? `Aucun produit ne correspond à « ${search.trim()} ».` : 'Aucun produit dans cette catégorie.'}</Empty>}
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
