// The member's statement (relevé de compte) as an A4 document, black on white in both themes: the same element on
// screen, printed and drawn into the PDF sent on WhatsApp. `s` is the server's memberStatement. Rows and blocks
// never split across pages (print rules in club.css, cut points in lib/statementPdf.js). In the demo the sheet
// carries a banner and a watermark repeated on every page.
import BrandLogo from './BrandLogo.jsx';
import {
  ACCOUNT_LABEL, STATUS, dateTime, dayLabel, fmtDuration, money, paymentMethodText, subStateLabel,
} from '../../lib/format.js';
import { CARD_METHOD } from '../../../shared/rules.js';

const MOVE_LABEL = {
  recharge: 'Approvisionnement', paiement: 'Paiement', remboursement: 'Remboursement', annulation_recharge: 'Approvisionnement annulé',
};

const WATERMARK = `url("data:image/svg+xml,${encodeURIComponent(
  '<svg xmlns="http://www.w3.org/2000/svg" width="420" height="300"><text x="210" y="150" text-anchor="middle" '
  + 'dominant-baseline="middle" transform="rotate(-30 210 150)" font-family="Arial, Helvetica, sans-serif" font-size="30" '
  + 'font-weight="900" fill="rgba(0,0,0,0.10)">DÉMO — SANS VALEUR</text></svg>',
)}")`;

const signed = (n) => `${n > 0 ? '+' : '−'}${money(Math.abs(n))}`;
const minus = (n) => (n > 0 ? `−${money(n)}` : money(0));
const lineText = (l) => `${Number(l.quantity) > 1 ? `${l.quantity} × ` : ''}${l.label}`;
const accountsOf = (p) => Object.entries(p.by_account ?? {}).filter(([, n]) => n > 0).map(([k]) => ACCOUNT_LABEL[k] ?? k);

function Section({ title, children, empty, count }) {
  return (
    <section className="st-section">
      <h2>{title}</h2>
      {count ? children : <p className="st-empty st-keep">{empty}</p>}
    </section>
  );
}

function Fact({ k, v, strong }) {
  return <div className={strong ? 'st-strong' : undefined}><dt>{k}</dt><dd>{v}</dd></div>;
}

export default function StatementSheet({ s, settings, demo }) {
  const m = s.member;
  const sum = s.summary;
  const { from, to } = s.period;
  const header = String(settings.ticket_header ?? '').trim();
  const sub = s.subscription;
  const credit = sub.credit;

  return (
    <article className={`statement-sheet${demo ? ' is-demo' : ''}`} style={demo ? { backgroundImage: WATERMARK } : undefined}
      aria-label={`Relevé de compte de ${m.name}`}>
      {demo && <div className="st-demo st-keep" role="note">DÉMO — SANS VALEUR</div>}

      <header className="st-head st-keep">
        <div className="st-brand">
          <BrandLogo className="st-logo" />
          <h2 className="sr-only">{settings.club_name}</h2>
          {header && <p className="st-header">{header}</p>}
        </div>
        <div className="st-ident">
          <strong className="st-title">RELEVÉ DE COMPTE</strong>
          <div className="st-name">Monsieur {m.name}</div>
          <dl className="st-facts">
            <Fact k="Membre n°" v={m.member_no} />
            <Fact k="Téléphone" v={m.phone} />
            <Fact k="Période" v={`du ${dayLabel(from, 'short')} au ${dayLabel(to, 'short')}`} />
            <Fact k="Émis le" v={dateTime(s.issued_at)} />
          </dl>
        </div>
      </header>

      <section className="st-section st-summary st-keep">
        <h2>Résumé</h2>
        <div className="st-summary-grid">
          <dl className="st-facts">
            <Fact k={`Solde carte au ${dayLabel(from, 'short')}`} v={money(sum.balance_start)} />
            <Fact k="Approvisionné" v={money(sum.recharged)} />
            {sum.recharge_cancelled > 0 && <Fact k="Approvisionnements annulés" v={minus(sum.recharge_cancelled)} />}
            <Fact k="Payé par la carte" v={minus(sum.card_paid)} />
            {sum.card_refunded > 0 && <Fact k="Rendu sur la carte" v={`+${money(sum.card_refunded)}`} />}
            <Fact k={`Solde carte au ${dayLabel(to, 'short')}`} v={money(sum.balance_end)} strong />
          </dl>
          <dl className="st-facts">
            <Fact k="Total encaissé" v={money(sum.collected)} strong />
            {sum.collected_card > 0 && <Fact k="dont payé par la carte" v={money(sum.collected_card)} />}
            {sum.refunded > 0 && <Fact k="Remboursé" v={minus(sum.refunded)} />}
            <Fact k="Reste à encaisser (à ce jour)" v={money(sum.due_now)} strong />
          </dl>
        </div>
      </section>

      <Section title="Carte CFA" count={s.wallet.length} empty="Aucun mouvement de la carte sur la période.">
        <table className="st-table">
          <thead><tr><th>Date</th><th>Libellé</th><th>Ticket</th><th className="st-num">Montant</th><th className="st-num">Solde</th></tr></thead>
          <tbody>{s.wallet.map((w) => (
            <tr key={w.id}>
              <td className="st-nowrap">{dateTime(w.at)}</td>
              <td>{MOVE_LABEL[w.kind] ?? w.kind}{w.reason ? <div className="st-sub">{w.reason}</div> : null}</td>
              <td className="st-nowrap">{w.number ?? '—'}</td>
              <td className="st-num">{signed(w.amount)}</td>
              <td className="st-num">{money(w.balance_after)}</td>
            </tr>
          ))}</tbody>
        </table>
      </Section>

      <Section title="Encaissements" count={s.payments.length + s.refunds.length} empty="Aucun encaissement sur la période.">
        {s.payments.length ? (
          <table className="st-table">
            <thead><tr><th>Date</th><th>Ticket</th><th>Objet</th><th>Moyen</th><th className="st-num">Montant</th></tr></thead>
            <tbody>{s.payments.map((p) => (
              <tr key={p.id} className={p.cancelled_at ? 'is-cancelled' : undefined}>
                <td className="st-nowrap">{dateTime(p.paid_at)}</td>
                <td className="st-nowrap">{p.number}</td>
                <td>
                  {p.lines.map(lineText).join(' · ') || '—'}
                  {accountsOf(p).length ? <div className="st-sub">{accountsOf(p).join(', ')}</div> : null}
                  {p.cancelled_at ? <div className="st-sub">Annulé le {dateTime(p.cancelled_at)} : {p.cancel_reason}</div> : null}
                </td>
                <td>{paymentMethodText(p)}</td>
                <td className="st-num"><span className="st-amount">{money(p.amount)}</span></td>
              </tr>
            ))}</tbody>
          </table>
        ) : null}
        {s.refunds.length ? (
          <>
            <h3>Remboursements</h3>
            <table className="st-table">
              <thead><tr><th>Date</th><th>Ticket</th><th>Ligne</th><th>Moyen</th><th className="st-num">Montant</th></tr></thead>
              <tbody>{s.refunds.map((r) => (
                <tr key={r.id}>
                  <td className="st-nowrap">{dateTime(r.at)}</td>
                  <td className="st-nowrap">{r.number}</td>
                  <td>{lineText(r)}<div className="st-sub">{r.reason}</div></td>
                  <td>{r.card_amount > 0 && r.card_amount < r.amount
                    ? `${CARD_METHOD} ${money(r.card_amount)} + ${r.method} ${money(r.amount - r.card_amount)}`
                    : r.card_amount > 0 ? CARD_METHOD : r.method}</td>
                  <td className="st-num">−{money(r.amount)}</td>
                </tr>
              ))}</tbody>
            </table>
          </>
        ) : null}
      </Section>

      <Section title="Réservations" count={s.reservations.length} empty="Aucune réservation sur la période.">
        <table className="st-table">
          <thead><tr><th>Jour</th><th>Horaire</th><th>Salle</th><th>Durée</th><th>Pers.</th><th>Abonnement</th><th>Payant</th><th>Statut</th></tr></thead>
          <tbody>{s.reservations.map((r) => (
            <tr key={r.id} className={r.status === 'annulee' ? 'is-cancelled' : undefined}>
              <td className="st-nowrap">{dayLabel(r.biz_day, 'short')}</td>
              <td className="st-nowrap">{r.start_time} – {r.end_time}</td>
              <td>{r.room_name}</td>
              <td className="st-nowrap">{fmtDuration(r.duration_min)}</td>
              <td>{Math.max(1, Number(r.party_size) || 1)}</td>
              <td className="st-nowrap">{r.included_minutes > 0 ? fmtDuration(r.included_minutes) : '—'}</td>
              <td className="st-nowrap">{r.paid_minutes > 0 ? fmtDuration(r.paid_minutes) : '—'}</td>
              <td>{STATUS.res[r.status]?.[0] ?? r.status_label}</td>
            </tr>
          ))}</tbody>
        </table>
      </Section>

      <section className="st-section st-keep">
        <h2>Abonnement</h2>
        <dl className="st-facts st-facts-wide">
          <Fact k="Formule" v={subStateLabel(sub)} />
          {sub.start_date && <Fact k="Dates" v={`du ${dayLabel(sub.start_date, 'short')} au ${dayLabel(sub.end_date, 'short')}`} />}
          {credit && <Fact k="Heures attribuées" v={fmtDuration(credit.granted)} />}
          {credit && <Fact k="Heures consommées" v={fmtDuration(credit.consumed)} />}
          {credit?.committed > 0 && <Fact k="Heures réservées (à venir)" v={fmtDuration(credit.committed)} />}
          {credit && <Fact k="Heures disponibles" v={fmtDuration(credit.available)} strong />}
        </dl>
        {s.subscriptions.length ? (
          <table className="st-table">
            <thead><tr><th>Formules de la période</th><th>Du</th><th>Au</th><th className="st-num">Prix</th><th>Consommées</th><th>État</th></tr></thead>
            <tbody>{s.subscriptions.map((x) => (
              <tr key={x.id}>
                <td>{x.plan_name}</td>
                <td className="st-nowrap">{dayLabel(x.start_date, 'short')}</td>
                <td className="st-nowrap">{dayLabel(x.end_date, 'short')}</td>
                <td className="st-num">{x.price == null ? '—' : money(x.price)}</td>
                <td className="st-nowrap">{fmtDuration(x.credit.consumed)} / {fmtDuration(x.credit.granted)}</td>
                <td>{STATUS.sub[x.state]?.[0] ?? x.state}</td>
              </tr>
            ))}</tbody>
          </table>
        ) : null}
      </section>

      <footer className="st-foot st-keep">
        {settings.club_name} · relevé établi le {dateTime(s.issued_at)} · montants en {settings.currency?.label ?? 'FCFA'}
      </footer>
      {demo && <div className="st-demo st-keep" role="note">DÉMO — SANS VALEUR</div>}
    </article>
  );
}
