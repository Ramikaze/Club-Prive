// The inventory import: a temporary door for a script on the owner's computer (scripts/import-inventaire.mjs), open only
// while the IMPORT_TOKEN secret exists, like the catalogue and the Digibox accounts doors. One call carries the whole
// count: each line names a product by its reference (or a product to create, when the catalogue lacks it) and the
// quantity counted. The stock is set to that quantity by an « ajustement » stock movement carrying the inventory's
// reason, as the « Ajuster » button does; a line already at its count moves nothing. A product may be renamed (a count
// that splits one product in two). Mixed into Club (end of club.js); the API runs the call in one transaction, so a
// refused file writes nothing, and `dry_run` answers the same plan without writing. No session: no author (NULL).
import { AppError, invalid } from './errors.js';
import { int, text } from './validate.js';
import { CATEGORIES } from '../shared/roles.js';

const MAX_PRICE_FCFA = 1000000000;
const MAX_COUNT = 100000;
const sameName = (v) => String(v ?? '').trim().normalize('NFC').toLocaleLowerCase('fr');
const isObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const rowError = (i, fn) => {
  try {
    return fn();
  } catch (e) {
    if (e instanceof AppError && e.status === 400) throw invalid(`Ligne ${i + 1} : ${e.message}`);
    throw e;
  }
};

export const importStockMethods = {
  importStock(input) {
    if (!isObject(input)) throw invalid('Fichier d’inventaire invalide.');
    const dryRun = input.dry_run === true;
    const reason = text(input.reason, 'Motif de l’inventaire', { required: true, min: 3, max: 200 });
    if (!Array.isArray(input.items)) throw invalid('Inventaire : une liste de lignes est attendue.');
    const products = this.all('SELECT * FROM products WHERE is_demo = 0 ORDER BY id');
    const lines = input.items.map((item, i) => rowError(i, () => this.inventoryLine(item, products)));

    // The file is checked as a whole before anything is written: a product counted twice, two products given one name.
    const seen = new Set();
    for (const l of lines) {
      const key = l.product ? `id:${l.product.id}` : `new:${sameName(l.name)}`;
      if (seen.has(key)) throw invalid(`« ${l.name} » est compté deux fois dans l’inventaire.`);
      seen.add(key);
    }
    const names = new Map(products.map((p) => [sameName(p.name), p.id]));
    for (const l of lines.filter((x) => x.rename)) {
      const owner = names.get(sameName(l.rename));
      if (owner !== undefined && owner !== l.product.id) throw invalid(`Un autre produit s’appelle déjà « ${l.rename} ».`);
      names.set(sameName(l.rename), l.product.id);
    }

    const answer = { dry_run: dryRun, items: [] };
    let created = 0;
    let adjusted = 0;
    for (const l of lines) {
      let p = l.product;
      const before = p ? p.stock_qty : 0;
      const renamed = p && l.rename && l.rename !== p.name ? p.name : null;
      let action = 'inchange';
      if (!p) action = 'creer';
      else if (before !== l.count || renamed) action = 'ajuste';
      if (!dryRun) {
        if (!p) {
          p = this.createInventoryProduct(l);
          created += 1;
        }
        if (renamed) {
          this.run('UPDATE products SET name = ?, updated_at = ?, updated_by = NULL WHERE id = ?', l.rename, this.nowIso(), p.id);
          this.audit(null, 'produit.renommer', 'product', p.id, { avant: renamed, apres: l.rename, reference: p.reference });
        }
        const delta = l.count - before;
        if (delta !== 0) {
          this.moveStock(null, p.id, delta, 'ajustement', { reason });
          this.audit(null, 'stock.ajustement', 'product', p.id, { avant: before, apres: l.count, ecart: delta, motif: reason });
          adjusted += 1;
        }
      }
      answer.items.push({
        reference: p?.reference ?? null, name: l.rename ?? l.name, action, before, after: l.count,
        ...(renamed ? { renamed_from: renamed } : {}),
      });
    }
    if (!dryRun) {
      this.audit(null, 'import.inventaire', null, null, { motif: reason, lignes: lines.length, crees: created, ajustes: adjusted });
    }
    return answer;
  },

  // One line of the count: { reference, rename?, count } for a product of the catalogue, or { create: { name, price,
  // category? }, count } for one it lacks. A product to create that already exists under that name (an import run
  // again) is that product: its price is left as the club set it.
  inventoryLine(item, products) {
    if (!isObject(item)) throw invalid('ligne invalide.');
    const count = int(item.count, 'Quantité comptée', { min: 0, max: MAX_COUNT });
    const hasRef = item.reference !== undefined;
    const hasCreate = item.create !== undefined;
    if (hasRef === hasCreate) throw invalid('donnez soit une référence, soit un produit à créer.');
    if (hasRef) {
      const reference = text(item.reference, 'Référence', { required: true, max: 40 });
      const product = products.find((p) => sameName(p.reference) === sameName(reference));
      if (!product) throw invalid(`aucun produit n’a la référence « ${reference} ».`);
      const rename = item.rename === undefined ? null : text(item.rename, 'Nouveau nom', { required: true, max: 80 }).normalize('NFC');
      return { product, name: product.name, rename, count };
    }
    if (!isObject(item.create)) throw invalid('produit à créer invalide.');
    const name = text(item.create.name, 'Nom du produit', { required: true, max: 80 }).normalize('NFC');
    const category = item.create.category ?? 'cigare';
    if (!CATEGORIES.includes(category)) throw invalid('Catégorie invalide (cigare, champagne ou autre boisson).');
    const price = int(item.create.price, 'Prix de vente (en francs)', { min: 0, max: MAX_PRICE_FCFA }) * 100;
    const product = products.find((p) => sameName(p.name) === sameName(name) && p.category === category) ?? null;
    return { product, name, category, price, rename: null, count };
  },

  createInventoryProduct(l) {
    const reference = this.nextReference(l.category);
    const id = this.insert(
      `INSERT INTO products (category, name, reference, description, price, stock_qty, low_stock_threshold, active, is_demo, created_at, created_by)
       VALUES (?, ?, ?, NULL, ?, 0, ?, 1, 0, ?, NULL)`,
      l.category, l.name, reference, l.price, this.settings().low_stock_default, this.nowIso(),
    );
    this.audit(null, 'produit.creer', 'product', id, { name: l.name, reference, price: l.price, source: 'inventaire' });
    return this.get('SELECT * FROM products WHERE id = ?', id);
  },
};
