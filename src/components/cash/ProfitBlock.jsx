// The real profit of the products (GET /api/finance/profit, worker/profit.js), for the administrator and the associés:
// the card of « Trésorerie & Bilans » (per caisse, then per product) and the band under « Recette du jour par
// catégorie » on the cash page. A cost is shown as what it takes from the profit (− when bought, + when goods come
// back). Never shown to the manager.
import { Link } from 'react-router-dom';
import { SortTh, Sorted } from '../ui/Sortable.jsx';
import { money } from '../../lib/format.js';
import { qs } from '../../lib/api.js';
import { missingText } from './profitText.js';

const CAISSE_LABEL = { alcool: 'Champagne et autres boissons', cigares: 'Cigare' };
const effect = (n) => (n ? money(-n) : '—');
const percent = (m) => (m == null ? '—' : `${Math.round(m * 100)} %`);

// What the profit leaves out, and where to complete it.
function Missing({ m }) {
  const text = missingText(m, money);
  if (!text) return null;
  return (
    <p className="subtle cash-note">
      {text} <Link to="/produits?revient=manquant">Voir les produits à compléter</Link>
    </p>
  );
}

const Incomplete = ({ r }) => (r.complete ? null : <span className="chip chip-warn">incomplet</span>);

function FiguresRow({ label, f }) {
  return (
    <tr>
      <td data-label="Caisse">{label}</td>
      <td data-label="Ventes" className="num">{money(f.sales)}</td>
      <td data-label="Prix d’achat" className="num">{effect(f.cost)}</td>
      <td data-label="Offerts" className="num">{effect(f.gifts_cost)}</td>
      <td data-label="Bénéfice" className={`num${f.profit < 0 ? ' amount-out' : ''}`}><strong>{money(f.profit)}</strong></td>
    </tr>
  );
}

export function ProfitCard({ report: r }) {
  return (
    <section className="card section-gap" aria-labelledby="profit-title">
      <div className="card-head"><h2 id="profit-title">Bénéfice réel des produits <Incomplete r={r} /></h2></div>
      <div className="table-wrap"><table className="table stack-sm">
        <thead><tr>
          <th>Caisse</th><th className="num">Ventes</th><th className="num">Prix d’achat</th><th className="num">Offerts</th><th className="num">Bénéfice</th>
        </tr></thead>
        <tbody>{r.accounts.map((a) => <FiguresRow key={a.account} label={CAISSE_LABEL[a.account] ?? a.label} f={a} />)}</tbody>
        <tfoot><FiguresRow label="Total" f={r.total} /></tfoot>
      </table></div>
      <Missing m={r.total.missing} />
      {r.products.length === 0 ? <p className="subtle cash-note">Aucune vente de produit sur la période.</p> : (
        <div className="table-wrap section-gap">
          <Sorted rows={r.products} columns={{
            name: (p) => p.name,
            quantity: (p) => p.quantity,
            sales: (p) => p.sales,
            cost: (p) => p.cost,
            gifts: (p) => p.gifts_cost,
            profit: (p) => p.profit ?? -Infinity,
            margin: (p) => p.margin ?? -Infinity,
          }}>{(sorter) => (
            <table className="table stack-sm">
              <thead><tr>
                <SortTh sorter={sorter} col="name">Produit</SortTh><SortTh sorter={sorter} col="quantity" className="num">Qté</SortTh>
                <SortTh sorter={sorter} col="sales" className="num">Ventes</SortTh><SortTh sorter={sorter} col="cost" className="num">Prix d’achat</SortTh>
                <SortTh sorter={sorter} col="gifts" className="num">Offerts</SortTh><SortTh sorter={sorter} col="profit" className="num">Bénéfice</SortTh>
                <SortTh sorter={sorter} col="margin" className="num">Marge</SortTh>
              </tr></thead>
              <tbody>{sorter.rows.map((p) => (
                <tr key={p.product_id}>
                  <td data-label="Produit">{p.name} <span className="subtle mono">{p.reference}</span>
                    {p.cost_missing && <> <span className="chip chip-warn">prix de revient à renseigner</span></>}</td>
                  <td data-label="Qté" className="num">{p.quantity}{p.gifts_quantity ? <span className="subtle"> + {p.gifts_quantity} offert{p.gifts_quantity > 1 ? 's' : ''}</span> : null}</td>
                  <td data-label="Ventes" className="num">{money(p.sales)}</td>
                  <td data-label="Prix d’achat" className="num">{effect(p.cost)}</td>
                  <td data-label="Offerts" className="num">{effect(p.gifts_cost)}</td>
                  {/* An unknown cost leaves the profit unknown: « — », never a profit counted at a cost of 0. */}
                  <td data-label="Bénéfice" className={`num${p.profit < 0 ? ' amount-out' : ''}`}>{p.profit === null ? '—' : money(p.profit)}</td>
                  <td data-label="Marge" className="num">{percent(p.margin)}</td>
                </tr>
              ))}</tbody>
            </table>
          )}</Sorted>
        </div>
      )}
      <p className="subtle cash-note">
        Ventes moins prix d’achat des produits vendus et des produits offerts. Une annulation ou un remboursement compte le jour où il a lieu.
        Ce bénéfice ne s’additionne pas au résultat de la période : les achats aux fournisseurs y sont déjà des dépenses.
      </p>
    </section>
  );
}

// One line under the columns of the cash page: each caisse's sales less their purchase cost, the gifts apart, the total.
export function ProfitBand({ report: r, oneDay }) {
  const caisse = (key) => r.accounts.find((a) => a.account === key);
  const before = (f) => (f ? f.sales - f.cost : 0);
  return (
    <div className="profit-band">
      <div>
        <strong>Bénéfice réel {oneDay ? 'du jour' : 'de la période'}</strong>{' '}
        <span>Champagne et autres boissons {money(before(caisse('alcool')))}</span>
        {' · '}<span>Cigare {money(before(caisse('cigares')))}</span>
        {r.total.gifts_cost !== 0 && <>{' · '}<span>Offerts {money(-r.total.gifts_cost)}</span></>}
        {' · '}<span>Total <strong className={r.total.profit < 0 ? 'amount-out' : undefined}>{money(r.total.profit)}</strong></span>{' '}
        <Incomplete r={r} />
      </div>
      <Missing m={r.total.missing} />
      <Link to={`/tresorerie${qs({ from: r.from, to: r.to })}`}>Détail dans Bilans</Link>
    </div>
  );
}
