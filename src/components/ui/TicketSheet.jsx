// The cash receipt as paper: an 80 mm roll, black on white, whatever the theme. The preview on screen and the
// printed copy are this same component. `copyNo` 1 is the original, then « Duplicata n°X »; `printedBy` and
// `printedAt` say who asked for this copy and when. In the demo the sheet carries a watermark and neither the
// QR code nor the check code, so it cannot pass for a real receipt.
import { useMemo } from 'react';
import BrandLogo from './BrandLogo.jsx';
import { money, dateTime } from '../../lib/format.js';
import { encodeQrMatrix, qrSvgPath } from '../../lib/qrcode.js';
import { formatTicketCode, ticketVerifyUrl } from '../../../shared/ticket.js';

export const copyLabel = (copyNo) => (copyNo <= 1 ? 'Original' : `Duplicata n°${copyNo}`);

function TicketQr({ value }) {
  const { viewBoxSize, path } = useMemo(() => qrSvgPath(encodeQrMatrix(value), 2), [value]);
  return (
    <svg className="ts-qr" role="img" viewBox={`0 0 ${viewBoxSize} ${viewBoxSize}`} shapeRendering="crispEdges">
      <title>QR code de vérification du ticket</title>
      <rect width={viewBoxSize} height={viewBoxSize} fill="#fff" />
      <path d={path} fill="#000" />
    </svg>
  );
}

export default function TicketSheet({ ticket, copyNo, printedBy, printedAt }) {
  const verifiable = !ticket.demo && Boolean(ticket.ticket_code);
  const verifyUrl = verifiable ? ticketVerifyUrl(window.location.origin, ticket.id, ticket.ticket_code) : null;
  const header = String(ticket.header ?? '').trim();
  const footer = String(ticket.footer ?? '').trim();

  return (
    <article className="ticket-sheet" aria-label={`Ticket ${ticket.number}`}>
      {ticket.demo && <div className="ts-demo" role="note">DÉMO — SANS VALEUR</div>}

      <header className="ts-head">
        <BrandLogo className="ts-logo" />
        <h2 className="ts-club">{ticket.club_name}</h2>
        {header && <p className="ts-header">{header}</p>}
      </header>

      <div className="ts-title">
        <strong>TICKET DE CAISSE</strong>
        <span className="ts-copy">{copyLabel(copyNo)}</span>
      </div>

      <dl className="ts-facts">
        <div><dt>N°</dt><dd>{ticket.number}</dd></div>
        <div><dt>Date</dt><dd>{dateTime(ticket.paid_at)}</dd></div>
        <div><dt>Client</dt><dd>{ticket.member_name}{ticket.member_no ? ` (${ticket.member_no})` : ''}</dd></div>
      </dl>

      <ul className="ts-lines">
        {ticket.allocations.map((line, i) => (
          <li key={`${line.charge_id}-${i}`}>
            <span className="ts-label">{line.quantity > 1 ? `${line.quantity} × ` : ''}{line.label}</span>
            <span className="ts-amount">{money(line.amount)}</span>
          </li>
        ))}
      </ul>

      <div className="ts-total"><span>TOTAL</span><strong>{money(ticket.amount)}</strong></div>

      <dl className="ts-facts">
        <div><dt>Payé</dt><dd>{ticket.method}{ticket.reference ? ` (${ticket.reference})` : ''}</dd></div>
        {ticket.created_by_name && <div><dt>Encaissé par</dt><dd>{ticket.created_by_name}</dd></div>}
        <div><dt>Imprimé par</dt><dd>{printedBy}, le {dateTime(printedAt)}</dd></div>
      </dl>

      {ticket.refunds.length > 0 && (
        <div className="ts-refunds">
          {ticket.refunds.map((refund, i) => (
            <p key={i}>Remboursé : {money(refund.amount)} le {dateTime(refund.created_at)}</p>
          ))}
        </div>
      )}

      {verifiable && (
        <div className="ts-verify">
          <TicketQr value={verifyUrl} />
          <p>Vérifiez ce ticket : scannez le QR code</p>
          <p className="ts-code">{formatTicketCode(ticket.ticket_code)}</p>
        </div>
      )}

      {footer && <p className="ts-footer">{footer}</p>}
      {ticket.demo && <div className="ts-demo" role="note">DÉMO — SANS VALEUR</div>}
    </article>
  );
}
