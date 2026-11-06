// The « Journal des opérations » table: date, user, operation (linked to its reservation or member) and detail.
import { Link } from 'react-router-dom';
import { ACTION_LABELS, auditSummary } from '../lib/audit.js';
import { dateTime } from '../lib/format.js';

export default function AuditTable({ audit }) {
  return (
    <div className="table-wrap"><table className="table stack-sm">
      <thead><tr><th>Date</th><th>Utilisateur</th><th>Opération</th><th>Détail</th></tr></thead>
      <tbody>{audit.map((a) => {
        const label = ACTION_LABELS[a.action] ?? a.action;
        let operation = label;
        if (a.entity === 'reservation' && a.entity_id) operation = <Link to={`/reservations/${a.entity_id}`}>{label}</Link>;
        // The day client's hidden row has no file to open.
        else if (a.entity === 'member' && a.entity_id && a.member_kind !== 'journalier') operation = <Link to={`/membres/${a.entity_id}`}>{label}</Link>;
        return (
          <tr key={a.id}>
            <td data-label="Date" className="nowrap">{dateTime(a.at)}</td>
            <td data-label="Utilisateur">{a.user_name ?? 'système'}</td>
            <td data-label="Opération">{operation}</td>
            <td data-label="Détail" className="subtle">{auditSummary(a)}</td>
          </tr>
        );
      })}</tbody>
    </table></div>
  );
}
