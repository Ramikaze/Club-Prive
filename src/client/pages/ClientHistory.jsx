// « Historique »: what moved on the client's account, month by month. A payment has its ticket, opened from its row.
import { useState } from 'react';
import { Link } from 'react-router-dom';
import Icon from '../../components/ui/Icon.jsx';
import { Empty, Loaded } from '../../components/ui/ui.jsx';
import { useLoad } from '../../lib/hooks.js';
import { dateTime, money, monthTitle, parts } from '../../lib/format.js';
import { addDays, addMonths } from '../../../shared/time.js';
import { clientApi, qs } from '../clientApi.js';

const STATUS = {
  annule: ['Annulé', 'neutral'], a_regler: ['À régler', 'warn'], rembourse: ['Remboursé', 'danger'], en_cours: ['En cours', 'info'], reservee: ['Réservée', 'info'],
};

export function HistoryRows({ items }) {
  return (
    <ul className="cl-rows">
      {items.map((it, i) => {
        const [label, kind] = STATUS[it.status] ?? [];
        return (
          <li key={`${it.at}-${i}`} className={it.status === 'annule' ? 'is-cancelled' : undefined}>
            <div className="cl-row-main">
              <strong className="title">{it.label}</strong>
              <span className="muted">{dateTime(it.at)}{label && <> · <span className={`chip chip-${kind}`}>{label}</span></>}</span>
              {it.payment_id && <Link className="cl-link" to={`/historique/ticket/${it.payment_id}`}>Voir le ticket</Link>}
            </div>
            <span className="cl-amount">{money(it.amount)}</span>
          </li>
        );
      })}
    </ul>
  );
}

export default function ClientHistory() {
  const current = parts(Date.now()).date.slice(0, 7);
  const [month, setMonth] = useState(current);
  const first = `${month}-01`;
  const last = addDays(addMonths(first, 1), -1);
  const state = useLoad(() => clientApi.get(`/api/client/history${qs({ from: first, to: last })}`), [month]);
  const shift = (n) => setMonth(addMonths(first, n).slice(0, 7));
  return (
    <div className="cl-stack">
      <h1>Historique</h1>
      <div className="cl-months">
        <button type="button" className="icon-btn" aria-label="Mois précédent" onClick={() => shift(-1)}><Icon name="left" /></button>
        <strong>{monthTitle(month)}</strong>
        <button type="button" className="icon-btn" aria-label="Mois suivant" disabled={month >= current} onClick={() => shift(1)}><Icon name="right" /></button>
      </div>
      <section className="cl-card">
        <Loaded state={state}>
          {(h) => (h.items.length ? <HistoryRows items={h.items} /> : <Empty icon="receipt">Rien sur ce mois.</Empty>)}
        </Loaded>
      </section>
    </div>
  );
}
