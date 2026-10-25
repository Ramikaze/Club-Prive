// « Soldes »: the till over the period on the account chosen for the page (or all of them), read left to right:
// the cash fund it started with, the recettes, the dépenses, and what is in it at the end. Transfers are neither
// recettes nor dépenses: on all accounts they cancel out; on one account they are shown under the figures, and
// the closing balance includes them. « Compter la caisse » (onCount, administrators) sets the first cash fund, then
// records the gap between the till and the books.
import Icon from '../ui/Icon.jsx';
import { tillFigures } from './flows.js';
import { bizDayOf } from './when.js';
import { bizToday, dayLabel, money } from '../../lib/format.js';

// « +5 000 FCFA » / « −5 000 FCFA »; dépenses read as money out, « −0 FCFA » when there are none.
const signed = (v, out = false) => `${(out ? v >= 0 : v < 0) ? '−' : '+'}${money(Math.abs(v))}`;

export default function CashBalance({ t, method, entries, journal, openingBalances, onCount }) {
  const f = tillFigures(t, method, { entries, journal, openingBalances, dayOf: bizDayOf });
  const end = t.to >= bizToday() ? 'à ce jour' : `au ${dayLabel(t.to, 'short')}`;
  return (
    <section className="card cash-balance-card" aria-labelledby="caisse-soldes-title">
      <div className="card-head">
        <h2 id="caisse-soldes-title"><Icon name="wallet" /> Soldes <span className="subtle">{method || 'toutes les caisses et comptes'}</span></h2>
        {onCount && <button type="button" className="btn btn-sm" onClick={onCount}><Icon name="cash" /> Compter la caisse</button>}
      </div>
      <div className="kpis cash-balance">
        <div className="kpi">
          <div className="label">Fond de caisse</div>
          <div className="value">{money(f.opening)}</div>
          <div className="hint">au {dayLabel(t.from, 'short')}</div>
        </div>
        <div className="kpi">
          <div className="label">Recettes</div>
          <div className="value amount-in">{signed(f.in)}</div>
          <div className="hint">argent reçu, remboursements déduits</div>
        </div>
        <div className="kpi">
          <div className="label">Dépenses</div>
          <div className="value amount-out">{signed(f.out, true)}</div>
          <div className="hint">argent sorti</div>
        </div>
        <div className="kpi accent">
          <div className="label">Solde en caisse</div>
          <div className="value">{money(f.closing)}</div>
          <div className="hint">{end}</div>
        </div>
      </div>
      {method && (f.received > 0 || f.sent > 0) && (
        <p className="subtle cash-note">
          Transferts : +{money(f.received)} reçus, −{money(f.sent)} envoyés. Ils ne sont ni des recettes ni des dépenses ; le solde en caisse en tient compte.
        </p>
      )}
    </section>
  );
}
