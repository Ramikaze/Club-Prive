// The booking confirmation as paper: the same 80 mm roll, black on white, as the cash receipt (TicketSheet), and
// the same element on screen, printed and drawn to a picture for WhatsApp. A booking has no public check, so there
// is no QR code; in the demo the sheet carries the watermark. `detail` is the server's reservationDetail.
import BrandLogo from './BrandLogo.jsx';
import { STATUS, fmtDuration, money } from '../../lib/format.js';
import { weekdayDayText } from '../../../shared/wallet.js';

// What the note of the booking adds up to, over all its accounts (room, drinks, cigars).
export function bookingAmounts(detail) {
  const sum = (key) => Object.values(detail.totals ?? {}).reduce((total, t) => total + (t[key] ?? 0), 0);
  return { billed: sum('billed'), paid: sum('paid'), due: sum('due') };
}

export default function BookingSheet({ detail, settings, demo }) {
  const r = detail.reservation;
  const header = String(settings.ticket_header ?? '').trim();
  const footer = String(settings.ticket_footer ?? '').trim();
  const { billed, paid, due } = bookingAmounts(detail);
  // The day the session starts on, as the member reads it in his calendar (a session at 01:00 is the next day's).
  const nextDay = r.end_date > r.start_date ? ' (lendemain)' : '';
  const people = Math.max(1, Number(r.party_size) || 1);

  return (
    <article className="ticket-sheet" aria-label={`Confirmation de la réservation n° ${r.id}`}>
      {demo && <div className="ts-demo" role="note">DÉMO — SANS VALEUR</div>}

      <header className="ts-head">
        <BrandLogo className="ts-logo" />
        {/* The logo already names the club: its name is kept for screen readers only. */}
        <h2 className="sr-only">{settings.club_name}</h2>
        {header && <p className="ts-header">{header}</p>}
      </header>

      <div className="ts-title">
        <strong>CONFIRMATION DE RÉSERVATION</strong>
        <span className="ts-copy">{STATUS.res[r.status]?.[0] ?? r.status_label}</span>
      </div>

      <dl className="ts-facts">
        <div><dt>Réservation n°</dt><dd>{r.id}</dd></div>
        <div><dt>Client</dt><dd>{r.member_name}{r.member_no ? ` (${r.member_no})` : ''}</dd></div>
        <div><dt>Salle</dt><dd>{r.room_name}</dd></div>
        <div><dt>Jour</dt><dd>{weekdayDayText(r.start_date)}</dd></div>
        <div><dt>Horaire</dt><dd>{r.start_time} – {r.end_time}{nextDay}</dd></div>
        <div><dt>Durée</dt><dd>{fmtDuration(r.duration_min)}</dd></div>
        <div><dt>Personnes</dt><dd>{people} pers.</dd></div>
      </dl>

      {(r.included_minutes > 0 || r.paid_minutes > 0) && (
        <dl className="ts-facts ts-balances">
          {r.included_minutes > 0 && <div><dt>Pris sur l’abonnement</dt><dd>{fmtDuration(r.included_minutes)}</dd></div>}
          {r.paid_minutes > 0 && <div><dt>Temps payant</dt><dd>{fmtDuration(r.paid_minutes)}</dd></div>}
        </dl>
      )}

      <div className="ts-total"><span>TOTAL</span><strong>{money(billed)}</strong></div>

      <dl className="ts-facts">
        {r.deposit_amount > 0 && <div><dt>Acompte</dt><dd>{money(r.deposit_amount)}</dd></div>}
        <div><dt>Payé</dt><dd>{money(paid)}</dd></div>
        {due > 0 && <div><dt>Reste à payer</dt><dd>{money(due)}</dd></div>}
      </dl>

      {footer && <p className="ts-footer">{footer}</p>}
      {demo && <div className="ts-demo" role="note">DÉMO — SANS VALEUR</div>}
    </article>
  );
}
