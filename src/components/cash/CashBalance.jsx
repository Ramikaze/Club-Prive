// « Soldes »: the till over the period, read left to right: the cash fund it started with, the recettes, the
// dépenses, and what is in it at the end. One account at a time, the cash till first; « Tous » adds them up (a
// transfer between two of them then cancels out). Transfers are neither recettes nor dépenses: for one account
// they are shown under the figures, and the closing balance includes them.
import { useState } from 'react';
import Icon from '../ui/Icon.jsx';
import { Segmented } from '../ui/ui.jsx';
import { tillFigures } from './flows.js';
import { bizToday, dayLabel, money } from '../../lib/format.js';
import { CASH_METHOD } from '../../../shared/rules.js';

// « +5 000 FCFA » / « −5 000 FCFA ».
const signed = (v) => `${v < 0 ? '−' : '+'}${money(Math.abs(v))}`;

export default function CashBalance({ t, entries, journal }) {
  const [method, setMethod] = useState(t.accounts.some((a) => a.method === CASH_METHOD) ? CASH_METHOD : '');
  const f = tillFigures(t, method, entries, journal);
  const end = t.to >= bizToday() ? 'à ce jour' : `au ${dayLabel(t.to, 'short')}`;
  return (
    <section className="card cash-balance-card" aria-labelledby="caisse-soldes-title">
      <div className="card-head">
        <h2 id="caisse-soldes-title"><Icon name="wallet" /> Soldes <span className="subtle">{method || 'tous les comptes'}</span></h2>
        {t.accounts.length > 1 && (
          <Segmented label="Caisse ou compte" value={method} onChange={setMethod}
            options={[...t.accounts.map((x) => [x.method, x.method]), ['', 'Tous']]} />
        )}
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
          <div className="hint" title="La part payée avec la carte membre est entrée lors de l’approvisionnement.">argent reçu, remboursements déduits</div>
        </div>
        <div className="kpi">
          <div className="label">Dépenses</div>
          <div className="value amount-out">{f.out < 0 ? '+' : '−'}{money(Math.abs(f.out))}</div>
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
