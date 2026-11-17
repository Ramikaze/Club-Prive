// A regular client's account statement (« Relevé de compte client ») as an A4 document, black on white in both themes:
// the same element on screen, printed and drawn into the PDF sent on WhatsApp (lib/statementPdf.js reads the
// `.statement-sheet` and its `.st-keep` cut points). `a` is the server's clientAccount: what the client owes, his
// limit, and every operation of his account (credit purchases, dettes reprises, settlements, their cancellations) in
// date order with the balance after each. In the demo the sheet carries a banner and a watermark.
import BrandLogo from './BrandLogo.jsx';
import { dateTime, money } from '../../lib/format.js';

const WATERMARK = `url("data:image/svg+xml,${encodeURIComponent(
  '<svg xmlns="http://www.w3.org/2000/svg" width="420" height="300"><text x="210" y="150" text-anchor="middle" '
  + 'dominant-baseline="middle" transform="rotate(-30 210 150)" font-family="Arial, Helvetica, sans-serif" font-size="30" '
  + 'font-weight="900" fill="rgba(0,0,0,0.10)">DÉMO — SANS VALEUR</text></svg>',
)}")`;

function Fact({ k, v, strong }) {
  return <div className={strong ? 'st-strong' : undefined}><dt>{k}</dt><dd>{v}</dd></div>;
}

export default function ClientStatementSheet({ a, settings, demo }) {
  const header = String(settings.ticket_header ?? '').trim();
  const totalDue = a.movements.reduce((n, x) => n + x.due, 0);
  const totalPaid = a.movements.reduce((n, x) => n + x.paid, 0);

  return (
    <article className={`statement-sheet${demo ? ' is-demo' : ''}`} style={demo ? { backgroundImage: WATERMARK } : undefined}
      aria-label={`Relevé de compte client de ${a.name}`}>
      {demo && <div className="st-demo st-keep" role="note">DÉMO — SANS VALEUR</div>}

      <header className="st-head st-keep">
        <div className="st-brand">
          <BrandLogo className="st-logo" />
          <h2 className="sr-only">{settings.club_name}</h2>
          {header && <p className="st-header">{header}</p>}
        </div>
        <div className="st-ident">
          <strong className="st-title">RELEVÉ DE COMPTE CLIENT</strong>
          <div className="st-name">{a.name}</div>
          <dl className="st-facts">
            <Fact k="Client n°" v={a.member_no} />
            <Fact k="Téléphone" v={a.phone || '—'} />
            <Fact k="Émis le" v={dateTime(a.issued_at)} />
          </dl>
        </div>
      </header>

      <section className="st-section st-summary st-keep">
        <h2>Résumé</h2>
        <dl className="st-facts st-facts-wide">
          <Fact k="Total dû" v={money(totalDue)} />
          <Fact k="Total réglé" v={money(totalPaid)} />
          <Fact k="Reste à payer" v={money(a.owed)} strong />
        </dl>
      </section>

      <section className="st-section">
        <h2>Opérations</h2>
        {a.movements.length ? (
          <table className="st-table">
            <thead><tr><th>Date</th><th>Opération</th><th className="st-num">Dû</th><th className="st-num">Réglé</th><th className="st-num">Solde</th></tr></thead>
            <tbody>{a.movements.map((x) => (
              <tr key={x.key} className={x.cancelled_at ? 'is-cancelled' : undefined}>
                <td className="st-nowrap">{dateTime(x.at)}</td>
                <td>
                  {x.label}
                  {x.ticket_number ? <div className="st-sub">Ticket {x.ticket_number}</div> : null}
                  {x.detail ? <div className="st-sub">{x.detail}</div> : null}
                  {x.cancelled_at ? <div className="st-sub">Annulé le {dateTime(x.cancelled_at)}</div> : null}
                </td>
                <td className="st-num">{x.due ? money(x.due) : '—'}</td>
                <td className="st-num">{x.paid ? money(x.paid) : '—'}</td>
                <td className="st-num"><span className="st-amount">{money(x.balance)}</span></td>
              </tr>
            ))}</tbody>
          </table>
        ) : <p className="st-empty st-keep">Aucune opération sur ce compte.</p>}
      </section>

      <section className="st-section st-keep">
        <dl className="st-facts st-facts-wide">
          <Fact k="Net à payer" v={money(a.owed)} strong />
        </dl>
      </section>

      <footer className="st-foot st-keep">
        {settings.club_name} · relevé établi le {dateTime(a.issued_at)} · montants en {settings.currency?.label ?? 'FCFA'}
      </footer>
      {demo && <div className="st-demo st-keep" role="note">DÉMO — SANS VALEUR</div>}
    </article>
  );
}
