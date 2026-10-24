// Cash receipt history (/caisse/historique-tickets, administrators): every receipt that came out (print requested
// or sent on WhatsApp) over a period, with who did it. A receipt that came out 3 times or more is flagged.
import { Link, useNavigate } from 'react-router-dom';
import { Empty, Loaded, Notice, PageHead } from '../components/ui/ui.jsx';
import { copyLabel } from '../components/ui/TicketSheet.jsx';
import PeriodPicker, { usePeriod } from '../components/ui/PeriodPicker.jsx';
import { api, qs } from '../lib/api.js';
import { dateTime, money } from '../lib/format.js';
import { useLoad } from '../lib/hooks.js';

const KIND_LABEL = { impression: 'Impression demandée', whatsapp: 'WhatsApp' };
const FLAG_FROM = 3;
// The API answers with the latest 1000 events at most.
const API_LIMIT = 1000;

// The ticket number is a real link (keyboard, middle click); the whole row opens the ticket too.
function EventsTable({ events }) {
  const navigate = useNavigate();
  if (!events.length) return <Empty icon="receipt">Aucun ticket sorti sur la période.</Empty>;
  return (
    <div className="table-wrap"><table className="table stack-sm">
      <thead><tr><th>Date</th><th>Ticket</th><th>Client</th><th className="num">Montant</th><th>Type</th><th>Exemplaire</th><th>Par</th></tr></thead>
      <tbody>{events.map((e, i) => (
        <tr key={`${e.payment_id}-${e.copy_no}-${e.at}-${i}`} className="is-clickable" onClick={() => navigate(`/caisse/ticket/${e.payment_id}`)}>
          <td data-label="Date" className="nowrap">{dateTime(e.at)}</td>
          <td data-label="Ticket" className="nowrap">
            <Link to={`/caisse/ticket/${e.payment_id}`} onClick={(ev) => ev.stopPropagation()}><strong>{e.number}</strong></Link></td>
          <td data-label="Client">{e.member_name}</td>
          <td data-label="Montant" className="num">{money(e.amount)}</td>
          <td data-label="Type">{KIND_LABEL[e.kind] ?? e.kind}</td>
          <td data-label="Exemplaire">
            {copyLabel(e.copy_no)}
            {e.copies_total >= FLAG_FROM && <> <span className="chip chip-warn">{FLAG_FROM} sorties ou plus</span></>}
          </td>
          <td data-label="Par">{e.user_name ?? ''}</td>
        </tr>
      ))}</tbody>
    </table></div>
  );
}

export default function TicketHistory() {
  const period = usePeriod('month');
  const { from, to } = period;
  const userId = period.params.get('employe') ?? '';
  // Always both bounds: the server ignores `to` alone.
  const state = useLoad(() => api.get(`/api/ticket-events${qs({ from, to, user_id: userId })}`), [from, to, userId]);
  // The employee list: the account routes are refused in the demo space, where the filter then offers nobody.
  const usersState = useLoad(() => api.get('/api/users').catch(() => []), []);
  const users = usersState.data ?? [];

  return (
    <>
      <PageHead
        title="Historique des tickets"
        lead="Chaque ticket sorti ou envoyé : quand, pour qui et par qui."
        back={{ to: '/caisse', label: 'Encaissements' }}
      />
      <div className="toolbar">
        <PeriodPicker period={period} />
        <select aria-label="Employé" value={userId} onChange={(e) => period.setParam('employe', e.target.value)}>
          <option value="">Tous les employés</option>
          {users.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
          {userId && !users.some((u) => String(u.id) === userId) && <option value={userId}>Employé n°{userId}</option>}
        </select>
      </div>
      <Loaded state={state}>{({ events }) => (
        <>
          {events.length >= API_LIMIT && <Notice kind="warn">Seuls les 1 000 derniers événements sont affichés : réduisez la période.</Notice>}
          <section className="card"><EventsTable events={events} /></section>
        </>
      )}</Loaded>
    </>
  );
}
