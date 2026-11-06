// « Historique des achats »: the products a member or regular client bought, at the shop or during a session.
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { AccountTag, Chip, Empty, Loaded, Segmented } from '../ui/ui.jsx';
import { api } from '../../lib/api.js';
import { useLoad } from '../../lib/hooks.js';
import { money, dateTime } from '../../lib/format.js';
import { CARD_METHOD } from '../../../shared/rules.js';

const FILTERS = [['tout', 'Tout'], ['boutique', 'Boutique'], ['seance', 'Séance']];

// card_amount is the whole payment's card part, so it only tells that the card took part, never an amount per line.
const methodText = (l) => {
  if (!l.method) return '—';
  return l.card_amount && l.method !== CARD_METHOD ? `${CARD_METHOD} + ${l.method}` : l.method;
};

function Lines({ lines }) {
  return (
    <div className="table-wrap"><table className="table stack-sm">
      <thead><tr><th>Date</th><th>Produit</th><th className="num">Montant</th><th>Origine</th><th>Compte</th><th>Paiement</th><th><span className="sr-only">Ticket</span></th></tr></thead>
      <tbody>{lines.map((l) => (
        <tr key={l.charge_id} className={l.status === 'annulee' || l.status === 'remboursee' ? 'is-muted' : ''}>
          <td data-label="Date" className="nowrap">{dateTime(l.at)}</td>
          <td data-label="Produit"><span>{l.label}{l.quantity > 1 ? ` × ${l.quantity}` : ''}
            {l.status !== 'payee' ? <> <Chip group="charge" value={l.status} /></> : null}
            {l.as_client ? <> <span className="chip" title="Achat fait avant le passage en membre">en tant que client régulier</span></> : null}</span></td>
          <td data-label="Montant" className="num">{money(l.amount)}</td>
          <td data-label="Origine">{l.origin === 'boutique' ? 'Boutique' : <Link to={`/reservations/${l.reservation_id}`}>Séance n° {l.reservation_id}</Link>}</td>
          <td data-label="Compte"><AccountTag account={l.account} /></td>
          <td data-label="Paiement">{methodText(l)}</td>
          <td className="actions">{l.payment_id ? <Link className="btn btn-sm" to={`/caisse/ticket/${l.payment_id}`} title={l.ticket_number}>Ticket</Link> : null}</td>
        </tr>
      ))}</tbody>
    </table></div>
  );
}

export default function PurchaseHistory({ memberId }) {
  const state = useLoad(() => api.get(`/api/members/${memberId}/purchases`), [memberId]);
  const [filter, setFilter] = useState('tout');
  return (
    <section className="card span-2">
      <div className="card-head"><h2>Historique des achats</h2>
        <Segmented label="Origine des achats" value={filter} options={FILTERS} onChange={setFilter} /></div>
      <Loaded state={state}>{({ lines }) => {
        const shown = lines.filter((l) => filter === 'tout' || l.origin === filter);
        if (!shown.length) return <Empty icon="receipt">Aucun achat{filter === 'tout' ? '' : ' dans cette origine'}.</Empty>;
        // Cancelled and refunded lines stay visible but are not counted.
        const total = shown.filter((l) => l.status === 'due' || l.status === 'payee').reduce((n, l) => n + l.amount, 0);
        return (
          <>
            <Lines lines={shown} />
            <p className="subtle"><strong>Total : {money(total)}</strong> (hors lignes annulées ou remboursées)</p>
          </>
        );
      }}</Loaded>
    </section>
  );
}
