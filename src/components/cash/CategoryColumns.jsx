// « Par catégorie »: the Caisse in three columns (Réservation séance, Boisson with its Champagne and Autres
// boissons halves, Cigare), each with its net at the top and, under it, what was billed in the period.
import { Link } from 'react-router-dom';
import Icon from '../ui/Icon.jsx';
import { CashRow, metaLine } from './CashRow.jsx';
import { categoryColumns, lineTexts } from './categories.js';
import { dateTime, money } from '../../lib/format.js';
import { formatTicketNumber } from '../../../shared/ticket.js';

// The origin, with the member's name linked to his file when the line has a member (a day client has none).
function Origin({ line, text }) {
  if (!line.member_id || !text.endsWith(line.member_name)) return text;
  return <>{text.slice(0, text.length - line.member_name.length)}<Link to={`/membres/${line.member_id}`}>{line.member_name}</Link></>;
}

function BilledLine({ line }) {
  const { title, origin } = lineTexts(line);
  const gone = line.status === 'annulee' || line.status === 'remboursee';
  const ticket = line.payment_id && <Link to={`/caisse/ticket/${line.payment_id}`} aria-label={`Ticket ${line.ticket_number}`}>{line.ticket_number ?? formatTicketNumber(line.payment_id)}</Link>;
  const chip = line.status === 'due' ? <span className="chip chip-warn" key="due">à encaisser</span>
    : gone ? <span className="chip" key="gone">{line.status === 'annulee' ? 'annulée' : 'remboursée'}</span> : null;
  return (
    <CashRow
      title={title}
      meta={metaLine(dateTime(line.at), ticket, origin && <Origin line={line} text={origin} />, chip)}
      amount={line.amount}
      cancelled={gone}
    />
  );
}

function Part({ p }) {
  return (
    <div className="cat-part">
      {p.title && (
        <div className="cat-part-head">
          <h4>{p.icon && <Icon name={p.icon} />}{p.title}</h4>
          <strong className="num">{money(p.net)}</strong>
        </div>
      )}
      {p.lines.length ? <div className="list">{p.lines.map((l) => <BilledLine key={l.charge_id} line={l} />)}</div>
        : <p className="subtle">Rien de facturé sur la période.</p>}
      {p.truncated && <p className="subtle cash-note">Les {p.lines.length} lignes les plus récentes sur {p.count} : choisissez une période plus courte pour tout voir.</p>}
    </div>
  );
}

export default function CategoryColumns({ sum, billed, method }) {
  return (
    <section id="caisse-categories" className="card cash-block">
      <div className="card-head">
        <h2><Icon name="list" /> Par catégorie {method && <span className="subtle">toutes caisses et comptes</span>}</h2>
      </div>
      <div className="cat-columns">
        <div className="cat-columns-inner">
          {categoryColumns(sum, billed).map((c) => (
            <div key={c.key} className={`cat-col cat-col-${c.key}`}>
              <div className="cat-col-head">
                <h3><Icon name={c.icon} />{c.title}</h3>
                <strong className="cash-block-total num">{money(c.net)}</strong>
              </div>
              <div className="cat-parts">{c.parts.map((p) => <Part key={p.key} p={p} />)}</div>
            </div>
          ))}
        </div>
      </div>
      <p className="subtle cash-note">La recette compte l’argent à la date où il est encaissé (ou rendu) ; la liste montre ce qui a été facturé à la date de facturation, payé ou non.</p>
    </section>
  );
}
