// The « Journal des opérations » table: date, user, operation (linked to its reservation or member) and detail.
import { Link } from 'react-router-dom';
import { ACTION_LABELS, auditAuthor, auditSummary } from '../lib/audit.js';
import { dateTime } from '../lib/format.js';
import { isoTime } from '../lib/sort.js';
import { SortTh, useSort } from './ui/Sortable.jsx';

export default function AuditTable({ audit }) {
  const sorter = useSort(audit, {
    at: (a) => isoTime(a.at),
    user: (a) => auditAuthor(a),
    op: (a) => ACTION_LABELS[a.action] ?? a.action,
    detail: (a) => auditSummary(a),
  });
  return (
    <div className="table-wrap"><table className="table stack-sm">
      <thead><tr>
        <SortTh sorter={sorter} col="at">Date</SortTh><SortTh sorter={sorter} col="user">Utilisateur</SortTh>
        <SortTh sorter={sorter} col="op">Opération</SortTh><SortTh sorter={sorter} col="detail">Détail</SortTh>
      </tr></thead>
      <tbody>{sorter.rows.map((a) => {
        const label = ACTION_LABELS[a.action] ?? a.action;
        let operation = label;
        if (a.entity === 'reservation' && a.entity_id) operation = <Link to={`/reservations/${a.entity_id}`}>{label}</Link>;
        // The day client's hidden row has no file to open.
        else if (a.entity === 'member' && a.entity_id && a.member_kind !== 'journalier') operation = <Link to={`/membres/${a.entity_id}`}>{label}</Link>;
        return (
          <tr key={a.id}>
            <td data-label="Date" className="nowrap">{dateTime(a.at)}</td>
            <td data-label="Utilisateur">{auditAuthor(a)}</td>
            <td data-label="Opération">{operation}</td>
            <td data-label="Détail" className="subtle">{auditSummary(a)}</td>
          </tr>
        );
      })}</tbody>
    </table></div>
  );
}
