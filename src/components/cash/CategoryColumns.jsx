// « Par catégorie »: the Caisse in three columns (Réservation de séance, Champagne et autres boissons with its
// Champagne and Autres boissons halves, Cigare), each under its tile of « Soldes » on all accounts (same grid), each with its net at the top and, under it, what was billed in the period. Their sum is
// « Recette du jour » (owner's rule, 2026-11-07: the recette is these three columns and nothing else), and one line
// under them goes from it to « Argent encaissé », the box of « Soldes ».
import { Link } from 'react-router-dom';
import Icon from '../ui/Icon.jsx';
import { CashRow, metaLine } from './CashRow.jsx';
import { categoryColumns, lineTexts } from './categories.js';
import { recetteToCash, tillFigures } from './flows.js';
import { bizDayOf } from './when.js';
import { dateTime, money } from '../../lib/format.js';

// An amount that may be negative (a period with more refunded than collected), with a true minus sign.
const amount = (v) => (v < 0 ? `−${money(-v)}` : money(v));

// The origin, with the member's name linked to his file when the line has a member (a day client has none).
function Origin({ line, text }) {
  if (!line.member_id || !text.endsWith(line.member_name)) return text;
  return <>{text.slice(0, text.length - line.member_name.length)}<Link to={`/membres/${line.member_id}`}>{line.member_name}</Link></>;
}

function BilledLine({ line }) {
  const { title, origin } = lineTexts(line);
  const gone = line.status === 'annulee' || line.status === 'remboursee';
  const ticket = line.payment_id && <Link to={`/caisse/ticket/${line.payment_id}`} aria-label={`Ticket ${line.ticket_number}`}>{line.ticket_number}</Link>;
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

// « Argent encaissé = recette du jour … + argent mis sur les cartes … − ventes payées par carte membre … = … »: the
// terms that are not zero, each with its sign and amount, ending on the box's own figure (`cash`, all accounts).
// Should the two ever differ, the line says so instead of showing a false equality.
function Bridge({ bridge, cash, oneDay }) {
  const terms = bridge.terms.filter((x) => x.amount !== 0);
  const gap = cash - bridge.cash;
  return (
    <p className="subtle cash-note cat-bridge">
      {/* Each term is kept whole on its line: a narrow screen breaks the sum between terms only. */}
      <strong>Argent encaissé</strong> ={' '}
      <span className="nowrap">{oneDay ? 'recette du jour' : 'recette de la période'} {amount(bridge.recette)}</span>
      {terms.map((x) => <span key={x.key}>{' '}<span className="nowrap">{x.amount < 0 ? '−' : '+'} {x.label} {money(Math.abs(x.amount))}</span></span>)}
      {' '}<span className="nowrap">= <strong className="num">{amount(bridge.cash)}</strong>.</span>
      {gap !== 0 && <> Écart non expliqué de {amount(gap)} avec la case « Argent encaissé » : signalez-le.</>}
    </p>
  );
}

// `journal`, `entries`, `t` (the treasury) and `openingBalances`: what « Soldes » reads, for the line under the
// columns. The columns ignore the account filter, so the line is shown on all accounts only.
export default function CategoryColumns({ sum, billed, method, oneDay, journal, entries, t, openingBalances }) {
  const bridge = !method && recetteToCash(sum, journal, entries, { to: t.to, dayOf: bizDayOf });
  const cash = !method && tillFigures(t, '', { entries, journal, openingBalances, dayOf: bizDayOf }).in;
  return (
    <section id="caisse-categories" className="card cash-block">
      <div className="card-head">
        <h2><Icon name="list" /> Par catégorie {method && <span className="subtle">toutes caisses et comptes</span>}</h2>
        {/* The three accounts are the only ones, so the total is exactly the sum of the three column heads. */}
        <span className="cat-total"><span className="subtle">{oneDay ? 'Recette du jour' : 'Recette de la période'}</span> <strong className="cash-block-total num">{money(sum.total.net)}</strong></span>
      </div>
      {!billed ? <p className="subtle">Les lignes facturées n’ont pas pu être chargées. Rechargez la page.</p> : (
      <div className="cat-columns">
        {/* The three columns share the whole width of the block, so each reads at ease (owner, 2026-11-08: no longer
            set under their tiles of « Soldes »). */}
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
      )}
      {method ? <p className="subtle cash-note">Choisissez « Toutes » les caisses et comptes pour voir le passage de la recette à l’argent encaissé.</p>
        : <Bridge bridge={bridge} cash={cash} oneDay={oneDay} />}
      <p className="subtle cash-note">La recette compte chaque vente le jour où elle est payée (carte membre comprise) ou remboursée ; la liste montre ce qui a été facturé à la date de facturation, payé ou non.</p>
    </section>
  );
}
