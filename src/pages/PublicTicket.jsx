// Public check of a cash receipt (#/ticket/<number>/<code>): the page a customer reaches by scanning the QR code
// on the ticket, or by typing the number and code by hand (#/ticket). No account and no session: the Worker
// answers a visitor who holds the right code, and the page shows what it sent (no name, phone or member number).
import { useEffect, useState } from 'react';
import BrandLogo from '../components/ui/BrandLogo.jsx';
import Icon from '../components/ui/Icon.jsx';
import { FormError } from '../components/ui/ui.jsx';
import { api } from '../lib/api.js';
import { formatMoney } from '../../shared/rules.js';
import { localParts } from '../../shared/time.js';
import { TICKET_CODE_LENGTH, normalizeTicketCode } from '../../shared/ticket.js';

// Matches #/ticket and #/ticket/..., not another route that merely starts with the same letters.
export const isPublicTicketHash = (hash) => /^#\/ticket(\/|$)/.test(hash ?? '');

// A visitor has no settings (they come with the session): the currency and time zone come with the ticket itself,
// so the page shows amounts and hours as the club has them set.
const moneyText = (hundredths, currency) => formatMoney(hundredths, currency);
function dateText(iso, timezone) {
  const ms = Date.parse(iso);
  if (Number.isNaN(ms)) return '—';
  const p = localParts(ms, timezone);
  const [y, m, d] = p.date.split('-');
  return `${d}/${m}/${y} à ${p.time}`;
}

// « T-000123 » or « 123 » -> '123'; null when it is not a ticket number.
function parseNumber(text) {
  const digits = String(text ?? '').trim().replace(/^t[-\s]?/i, '');
  return /^\d{1,12}$/.test(digits) ? String(Number(digits)) : null;
}

const decode = (part) => {
  try { return decodeURIComponent(part ?? ''); } catch { return part ?? ''; }
};

// '#/ticket/123/K7QM-2XRP-9TDA' -> { id, code } ; '#/ticket' -> null (the entry form).
function readLink(hash) {
  const [, , rawId, rawCode] = hash.split('?')[0].split('/');
  if (!rawId && !rawCode) return null;
  return { id: parseNumber(decode(rawId)), code: normalizeTicketCode(decode(rawCode)) };
}

const STATUS_TEXT = { valide: 'Valide', partiellement_rembourse: 'Partiellement remboursé', rembourse: 'Remboursé' };
const STATUS_KIND = { valide: 'ok', partiellement_rembourse: 'warn', rembourse: 'danger' };

function Banner({ kind, children }) {
  return (
    <div className={`notice notice-${kind} ticket-public-banner`} role={kind === 'ok' ? 'status' : 'alert'}>
      <Icon name={kind === 'ok' ? 'check' : 'alert'} />
      <div>{children}</div>
    </div>
  );
}

function TicketView({ ticket }) {
  const kind = STATUS_KIND[ticket.status] ?? 'ok';
  return (
    <>
      <article className="card ticket-public-card" aria-label={`Ticket ${ticket.number}`}>
        <header className="ticket-public-head">
          <BrandLogo className="ticket-public-logo" />
          <h2>{ticket.club_name}</h2>
          <p className="ticket-public-kicker">Ticket de caisse</p>
          <p className="ticket-public-number">{ticket.number}</p>
          <p className="muted">{dateText(ticket.paid_at, ticket.timezone)}</p>
        </header>
        <ul className="ticket-public-lines">
          {ticket.lines.map((line, i) => (
            <li key={i}>
              <span className="ticket-public-label">{line.label}{line.quantity !== 1 && <span className="muted"> × {line.quantity}</span>}</span>
              <span className="ticket-public-amount">{moneyText(line.amount, ticket.currency)}</span>
            </li>
          ))}
        </ul>
        <div className="ticket-public-total"><span>Total</span><strong>{moneyText(ticket.total, ticket.currency)}</strong></div>
        <dl className="ticket-public-facts">
          <div><dt>Payé par</dt><dd>{ticket.method}</dd></div>
          {ticket.initials && <div><dt>Client</dt><dd>{ticket.initials}</dd></div>}
          <div>
            <dt>État</dt>
            <dd><span className={`ticket-public-status ticket-public-status-${kind}`}>{STATUS_TEXT[ticket.status] ?? ticket.status}</span></dd>
          </div>
          {ticket.refunded_amount > 0 && <div><dt>Remboursé</dt><dd>{moneyText(ticket.refunded_amount, ticket.currency)}</dd></div>}
        </dl>
      </article>
      <p className="ticket-public-compare">Comparez avec votre ticket : si un montant ou une ligne diffère, votre ticket a été modifié.</p>
    </>
  );
}

// The result of one check. `state` is { loading } | { ticket } | { error }.
function Check({ id, code }) {
  const [state, setState] = useState({ loading: true });
  // A link that cannot be a ticket (no number, or a code of the wrong length) is refused here: asking the
  // server would only use up the visitor's five tries.
  const valid = id !== null && code.length === TICKET_CODE_LENGTH;

  useEffect(() => {
    if (!valid) {
      setState({ error: { status: 404 } });
      return undefined;
    }
    let current = true;
    setState({ loading: true });
    api.getPublic(`/api/tickets/${encodeURIComponent(id)}/${encodeURIComponent(code)}`)
      .then((data) => { if (current) setState({ ticket: data.ticket }); })
      .catch((error) => { if (current) setState({ error }); });
    return () => { current = false; };
  }, [id, code, valid]);

  if (state.loading) return <div className="card ticket-public-wait" role="status">Vérification du ticket…</div>;
  if (state.ticket) {
    return (
      <>
        <Banner kind="ok">Ticket authentique enregistré par The Limen</Banner>
        <TicketView ticket={state.ticket} />
      </>
    );
  }
  const { status, message } = state.error;
  if (status === 404) return <Banner kind="danger">Ticket introuvable : ce ticket n&apos;a pas été émis par The Limen</Banner>;
  if (status === 429) return <Banner kind="warn">Trop de tentatives. Réessayez dans une minute.</Banner>;
  return <Banner kind="warn">{message || 'Vérification impossible pour le moment. Réessayez dans un instant.'}</Banner>;
}

// Manual entry, for a ticket whose QR code is damaged. It only builds the address; the check then runs as for a scan.
function EntryForm() {
  const [number, setNumber] = useState('');
  const [code, setCode] = useState('');
  const [error, setError] = useState(null);

  const onSubmit = (e) => {
    e.preventDefault();
    const id = parseNumber(number);
    const clean = normalizeTicketCode(code);
    if (id === null) return setError('Saisissez le numéro du ticket, par exemple T-000123.');
    if (clean.length !== TICKET_CODE_LENGTH) return setError('Le code de contrôle compte 12 caractères, par exemple XXXX-XXXX-XXXX.');
    setError(null);
    window.location.hash = `#/ticket/${id}/${clean}`;
    return undefined;
  };

  return (
    <form className="card ticket-public-form" onSubmit={onSubmit} noValidate>
      <div>
        <h2>Vérifier un ticket</h2>
        <p className="muted">Saisissez le numéro et le code de contrôle imprimés sur votre ticket.</p>
      </div>
      <label className="field"><span>N° du ticket</span>
        <input inputMode="text" autoComplete="off" autoCapitalize="characters" spellCheck="false" placeholder="T-000123"
          value={number} onChange={(e) => setNumber(e.target.value)} /></label>
      <label className="field"><span>Code de contrôle</span>
        <input autoComplete="off" autoCapitalize="characters" spellCheck="false" placeholder="XXXX-XXXX-XXXX"
          value={code} onChange={(e) => setCode(e.target.value)} /></label>
      <FormError error={error} />
      <button className="btn btn-primary btn-block" type="submit">Vérifier</button>
    </form>
  );
}

export default function PublicTicket({ hash }) {
  const link = readLink(hash);

  useEffect(() => {
    const before = document.title;
    document.title = 'Vérification du ticket';
    return () => { document.title = before; };
  }, []);

  return (
    <div className="ticket-public" role="main">
      <div className="ticket-public-column">
        {link ? (
          <>
            <Check id={link.id} code={link.code} />
            <a className="ticket-public-again" href="#/ticket">Vérifier un autre ticket</a>
          </>
        ) : <EntryForm />}
      </div>
    </div>
  );
}
