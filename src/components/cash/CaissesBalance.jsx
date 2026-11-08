// « Soldes » on all tills and accounts: six tiles read left to right in the owner's order (2026-11-07): the cash
// fund, the card credit, the three caisses and the till, the five on the left adding up to the last (caisses.js
// builds them from GET /api/caisses). Each caisse shows how it got there and its buttons; « Compter la caisse »
// stays in the head. Amounts never wrap; only a title may.
import Icon from '../ui/Icon.jsx';
import { Modal } from '../ui/Modal.jsx';
import { caisseTiles } from './caisses.js';
import { bizToday, dayLabel, money } from '../../lib/format.js';
import { useMe, useStore } from '../../store/useStore.js';

const ACTION_LABEL = { fournisseur: 'Payer un fournisseur', benefices: 'Prendre des bénéfices', apport: 'Faire un apport' };

export default function CaissesBalance({ b, onCount, onAction }) {
  const me = useMe();
  const currency = useStore((s) => s.settings.currency.label);
  // The lines read as in the owner's mock-up: « +420 000 », the currency once, on the tile's figure.
  const bare = (n) => money(n).replace(currency, '').trim();
  const tiles = caisseTiles(b, me, { money, day: (d) => dayLabel(d, 'short'), today: bizToday() });
  return (
    <section className="card cash-balance-card" aria-labelledby="caisse-soldes-title">
      <div className="card-head">
        <h2 id="caisse-soldes-title"><Icon name="wallet" /> Soldes <span className="subtle">toutes les caisses et comptes</span></h2>
        {onCount && <button type="button" className="btn btn-sm" onClick={onCount}><Icon name="cash" /> Compter la caisse</button>}
      </div>
      {!tiles ? <p className="subtle">Le suivi des caisses commence le {dayLabel(b.start, 'short')}.</p> : (
        <div className="caisses-grid">
          {tiles.map((t) => (
            <div key={t.key} className={`kpi caisse-tile caisse-${t.key}${t.key === 'caisse' ? ' accent' : ''}`}>
              <div className="label">{t.title}</div>
              <div className={`value${t.negative ? ' amount-out' : ''}`}>{money(t.value)}</div>
              {t.pending !== 0 && <div className="caisse-pending">{t.pending > 0 ? '+' : '−'}{bare(Math.abs(t.pending))} en attente</div>}
              {t.lines.length > 0 && (
                <dl className="caisse-lines">
                  {t.lines.map((l) => (
                    <div key={l.label}>
                      <dt>{l.label}</dt>
                      <dd className={l.sign === 'out' ? 'amount-out' : 'amount-in'}>{l.sign === 'out' ? '−' : '+'}{bare(l.amount)}</dd>
                    </div>
                  ))}
                </dl>
              )}
              {t.hints.map((h) => <div key={h} className="hint">{h}</div>)}
              {t.key === 'caisse' && t.pending !== 0 && (
                <div className="caisse-total"><span>En tout</span><strong>{money(t.total)}</strong></div>
              )}
              {t.actions.length > 0 && (
                <div className="caisse-actions">
                  {t.actions.map((a) => (
                    <button key={a} type="button" className="btn btn-sm" onClick={() => onAction(a, t.key)}>{ACTION_LABEL[a]}</button>
                  ))}
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </section>
  );
}

// « Payer un fournisseur » on the Champagne et autres boissons caisse: which purchase, then the expense opens with its
// category chosen (the caisse follows the category).
export function SupplierChoice({ close, onChoose }) {
  const pick = (code) => {
    close();
    onChoose(code);
  };
  return (
    <Modal title="Payer un fournisseur" onClose={close}>
      <p>Quel fournisseur payez-vous depuis la caisse « Champagne et autres boissons » ?</p>
      <div className="modal-actions">
        <button type="button" className="btn" onClick={close}>Annuler</button>
        <button type="button" className="btn btn-primary" onClick={() => pick('achat_champagne')}>Champagne</button>
        <button type="button" className="btn btn-primary" onClick={() => pick('achat_autres_boissons')}>Autres boissons</button>
      </div>
    </Modal>
  );
}
