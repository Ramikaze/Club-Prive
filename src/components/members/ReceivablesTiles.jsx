// The three tiles at the top of « Membres / Clients » (owner's choice, 2026-11-19): the members' open notes, what the
// regular clients owe on credit, and the total owed to the club (GET /api/receivables). The first two open their list.
import { Link } from 'react-router-dom';
import Icon from '../ui/Icon.jsx';
import { api } from '../../lib/api.js';
import { useLoad } from '../../lib/hooks.js';
import { money } from '../../lib/format.js';

const some = (n, one, many) => `${n} ${n > 1 ? many : one}`;

export default function ReceivablesTiles() {
  const state = useLoad(() => api.get('/api/receivables'), []);
  if (state.error && !state.data) {
    return (
      <p className="subtle section-gap"><Icon name="alert" /> Les créances n’ont pas pu être lues.{' '}
        <button type="button" className="btn btn-sm btn-ghost" onClick={state.retry}>Réessayer</button></p>
    );
  }
  const r = state.data;
  if (!r) return null;
  return (
    <section className="kpis" aria-label="Créances du club">
      {/* In the order of the tabs below (owner, 2026-11-19): Membres, then Clients réguliers; each opens its list. */}
      <Link className="kpi kpi-link" to="/membres">
        <div className="label">Membres</div>
        <div className="value">{money(r.members.total)}</div>
        <div className="hint">{r.members.count ? `${some(r.members.count, 'membre', 'membres')} avec une note ouverte` : 'Toutes les notes sont soldées'}</div>
      </Link>
      <Link className="kpi kpi-link" to="/clients">
        <div className="label">Clients réguliers</div>
        <div className="value">{money(r.clients.total)}</div>
        <div className="hint">{r.clients.count ? `${some(r.clients.count, 'client', 'clients')} avec une dette` : 'Aucune dette'}</div>
      </Link>
      <div className="kpi accent">
        <div className="label">Total dû au club</div>
        <div className="value">{money(r.clients.total + r.members.total)}</div>
        <div className="hint">Clients réguliers et membres</div>
      </div>
    </section>
  );
}
