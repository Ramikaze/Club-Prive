import { api, html, raw, isAdmin, money, dateTime, demoChip, hypothesis, newKey, parseMoney, toMajor, state } from '../core.js';
import { icon, empty, openModal, submitForm, formValues, toast } from '../ui.js';

const CATEGORY = { cigare: 'Cigare', bouteille: 'Bouteille' };

const stockChip = (p) => {
  if (p.stock_qty === 0) return html`<span class="chip chip-danger">rupture</span>`;
  if (p.low) return html`<span class="chip chip-warn">${p.stock_qty} · stock faible</span>`;
  return html`<span class="chip chip-ok">${p.stock_qty}</span>`;
};

const movementsTable = (rows, { withProduct = true } = {}) => (rows.length ? html`<div class="table-wrap"><table class="table stack-sm">
  <thead><tr><th>Date</th>${withProduct ? html`<th>Produit</th>` : ''}<th>Mouvement</th><th class="num">Quantité</th><th class="num">Stock après</th><th>Motif</th><th>Par</th></tr></thead>
  <tbody>${rows.map((mv) => html`<tr>
    <td data-label="Date" class="nowrap">${dateTime(mv.created_at)}</td>
    ${withProduct ? html`<td data-label="Produit">${mv.product_name}</td>` : ''}
    <td data-label="Mouvement">${mv.kind_label}</td>
    <td data-label="Quantité" class="num">${mv.quantity > 0 ? `+${mv.quantity}` : mv.quantity}</td>
    <td data-label="Stock après" class="num">${mv.stock_after}</td>
    <td data-label="Motif">${mv.reason ?? ''}</td>
    <td data-label="Par">${mv.created_by_name ?? ''}</td></tr>`)}</tbody></table></div>` : empty('Aucun mouvement.', 'box'));

function productDialog(product, onDone) {
  const editing = Boolean(product);
  const key = newKey();
  const m = openModal({ title: editing ? 'Modifier le produit' : 'Nouveau produit', size: 'wide' });
  const threshold = product?.low_stock_threshold ?? state.settings.low_stock_default;
  m.render(html`
    <form data-form="product" class="form-grid" novalidate>
      <div class="form-row">
        <label class="field"><span>Catégorie</span><select name="category">
          ${Object.entries(CATEGORY).map(([k, label]) => html`<option value="${k}" ${product?.category === k ? raw('selected') : ''}>${label}</option>`)}</select></label>
        <label class="field"><span>Référence</span><input name="reference" required maxlength="40" value="${product?.reference ?? ''}"></label>
      </div>
      <label class="field"><span>Nom</span><input name="name" required maxlength="80" value="${product?.name ?? ''}"></label>
      <label class="field"><span>Description (facultatif)</span><input name="description" maxlength="300" value="${product?.description ?? ''}"></label>
      <div class="form-row">
        <label class="field"><span>Prix de vente (${state.settings.currency.label})</span><input name="price" inputmode="decimal" required value="${toMajor(product?.price)}"></label>
        ${editing ? '' : html`<label class="field"><span>Stock initial</span><input type="number" name="initial_stock" min="0" step="1" value="0" inputmode="numeric"></label>`}
        <label class="field"><span>Seuil d’alerte</span><input type="number" name="low_stock_threshold" min="0" step="1" value="${threshold}" inputmode="numeric"></label>
      </div>
      ${editing ? html`<label class="check"><input type="checkbox" name="active" value="1" ${product.active ? raw('checked') : ''}><span>Produit actif (proposé à la vente)</span></label>
        <p class="subtle">Le stock se modifie par une entrée ou un ajustement motivé. Un changement de prix ne modifie pas les ventes déjà saisies.</p>` : ''}
      <div class="form-error" role="alert" hidden></div>
      <div class="modal-actions"><button type="button" class="btn" data-act="close">Annuler</button>
        <button type="submit" class="btn btn-primary">${editing ? 'Enregistrer' : 'Créer le produit'}</button></div>
    </form>`, {
    forms: {
      product: (f) => submitForm(f, async () => {
        const v = formValues(f);
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
        m.close();
        toast(editing ? 'Produit enregistré.' : 'Produit créé.');
        onDone?.();
      }),
    },
  });
}

function stockDialog(product, kind, onDone) {
  const key = newKey();
  const entry = kind === 'entree';
  const m = openModal({ title: entry ? 'Entrée de stock' : 'Ajustement de stock' });
  m.render(html`
    <form data-form="stock" class="form-grid" novalidate>
      <p><strong>${product.name}</strong> · stock enregistré : <strong>${product.stock_qty}</strong></p>
      ${entry
        ? html`<label class="field"><span>Quantité reçue</span><input type="number" name="quantity" min="1" step="1" required inputmode="numeric" autofocus></label>
          <label class="field"><span>Remarque (facultatif)</span><input name="reason" maxlength="200" placeholder="Fournisseur, bon de livraison…"></label>`
        : html`<label class="field"><span>Quantité constatée (inventaire)</span><input type="number" name="target_qty" min="0" step="1" required inputmode="numeric" value="${product.stock_qty}" autofocus></label>
          <label class="field"><span>Motif (obligatoire)</span><input name="reason" required minlength="3" maxlength="200" placeholder="Casse, inventaire, erreur de saisie…"></label>
          <p class="subtle">L’écart est enregistré comme un mouvement tracé, avec votre nom et le motif.</p>`}
      <div class="form-error" role="alert" hidden></div>
      <div class="modal-actions"><button type="button" class="btn" data-act="close">Annuler</button>
        <button type="submit" class="btn btn-primary">Enregistrer</button></div>
    </form>`, {
    forms: {
      stock: (f) => submitForm(f, async () => {
        const v = formValues(f);
        const body = entry
          ? { kind: 'entree', quantity: Number(v.quantity), reason: v.reason }
          : { kind: 'ajustement', target_qty: Number(v.target_qty), expected_qty: product.stock_qty, reason: v.reason };
        const res = await api.post(`/api/products/${product.id}/stock`, body, key);
        m.close();
        toast(`Stock de « ${res.name} » : ${res.stock_qty}.`);
        onDone?.();
      }),
    },
  });
}

async function historyDialog(product) {
  const m = openModal({ title: `Mouvements — ${product.name}`, size: 'wide' });
  m.render(html`<p class="subtle">Chargement…</p>`);
  try {
    const rows = await api.get(`/api/stock-movements?product_id=${product.id}&limit=200`);
    m.render(movementsTable(rows, { withProduct: false }));
  } catch (e) {
    m.render(html`<div class="form-error">${e.message}</div>`);
  }
}

export async function productsView(ctx) {
  const cat = ['cigare', 'bouteille'].includes(ctx.query.cat) ? ctx.query.cat : '';
  const showInactive = ctx.query.inactifs === '1';
  const [products, movements] = await Promise.all([
    api.get(`/api/products${showInactive ? '?all=1' : ''}`),
    api.get('/api/stock-movements?limit=25'),
  ]);
  const list = products.filter((p) => !cat || p.category === cat);
  const find = (el) => products.find((p) => p.id === Number(el.dataset.id));
  const reload = () => ctx.refresh();
  const anyDemo = products.some((p) => p.is_demo);

  ctx.render(html`
    <div class="page-head">
      <div><h1>Produits et stocks</h1><p class="lead">Cigares et bouteilles d’alcool. Les ventes se saisissent depuis la note d’une réservation.</p></div>
      ${isAdmin() ? html`<div class="actions"><button class="btn btn-primary" data-act="new">${icon('plus')} Nouveau produit</button></div>` : ''}
    </div>
    ${anyDemo ? html`<div class="notice notice-bronze" style="margin-bottom:14px">${icon('info')}<span>Catalogue fictif de démonstration : la liste réelle des cigares et des bouteilles, les prix et les quantités seront renseignés ultérieurement.
      ${hypothesis('La vente de cigares à l’unité est une hypothèse à confirmer.', 'cigares à l’unité')}</span></div>` : ''}
    <div class="toolbar">
      <div class="segmented" role="group" aria-label="Catégorie">
        ${[['', 'Tous'], ['cigare', 'Cigares'], ['bouteille', 'Bouteilles']].map(([k, label]) => html`<button type="button" data-act="cat" data-c="${k}" aria-pressed="${cat === k ? 'true' : 'false'}">${label}</button>`)}
      </div>
      ${isAdmin() ? html`<label class="check"><input type="checkbox" data-change="inactive" ${showInactive ? raw('checked') : ''}><span>Afficher les produits inactifs</span></label>` : ''}
    </div>
    <section class="card">
      ${list.length ? html`<div class="table-wrap"><table class="table stack-sm">
        <thead><tr><th>Produit</th><th>Catégorie</th><th class="num">Prix</th><th>Stock</th><th><span class="sr-only">Actions</span></th></tr></thead>
        <tbody>${list.map((p) => html`<tr class="${p.active ? '' : 'is-muted'}">
          <td data-label="Produit"><strong>${p.name}</strong> <span class="subtle mono">${p.reference}</span> ${demoChip(p.is_demo)} ${p.active ? '' : html`<span class="chip">inactif</span>`}
            ${p.description ? html`<div class="subtle">${p.description}</div>` : ''}</td>
          <td data-label="Catégorie">${CATEGORY[p.category]}</td>
          <td data-label="Prix" class="num">${money(p.price)}</td>
          <td data-label="Stock">${stockChip(p)} <span class="subtle">seuil ${p.low_stock_threshold}</span></td>
          <td class="actions">
            <button class="btn btn-sm" data-act="entry" data-id="${p.id}">Entrée</button>
            <button class="btn btn-sm btn-ghost" data-act="adjust" data-id="${p.id}">Ajuster</button>
            <button class="btn btn-sm btn-ghost" data-act="history" data-id="${p.id}">Historique</button>
            ${isAdmin() ? html`<button class="btn btn-sm btn-ghost" data-act="edit" data-id="${p.id}">${icon('edit')}<span class="sr-only">Modifier ${p.name}</span></button>` : ''}
          </td></tr>`)}</tbody></table></div>` : empty('Aucun produit dans cette catégorie.', 'box')}
    </section>
    <section class="card section-gap">
      <div class="card-head"><h2>Derniers mouvements de stock</h2></div>
      ${movementsTable(movements)}
    </section>`, {
    actions: {
      new: () => productDialog(null, reload),
      edit: (el) => productDialog(find(el), reload),
      entry: (el) => stockDialog(find(el), 'entree', reload),
      adjust: (el) => stockDialog(find(el), 'ajustement', reload),
      history: (el) => historyDialog(find(el)),
      cat: (el) => ctx.setQuery({ cat: el.dataset.c, inactifs: showInactive ? '1' : '' }),
    },
    changes: { inactive: (el) => ctx.setQuery({ cat, inactifs: el.checked ? '1' : '' }) },
  });
}
