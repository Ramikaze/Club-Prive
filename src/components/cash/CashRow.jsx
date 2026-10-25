// One operation in a list of the cash page, compact enough for a column: what it is, then a muted line (when,
// ticket, client or category, account), the signed amount on the right and the action under it.
import { actionDialog } from '../ui/Modal.jsx';
import { toast } from '../ui/toast.jsx';
import { api } from '../../lib/api.js';
import { dayLabel, money } from '../../lib/format.js';

// sign: '+' money in, '−' money out, '' neither (a transfer). A cancelled row is struck through, without colour; a
// quiet amount (paid with the member's card) is muted: it is listed but adds nothing.
export function CashRow({ title, meta, note, amount, sign = '', cancelled = false, quiet = false, action }) {
  const tone = cancelled || quiet ? '' : sign === '+' ? 'amount-in' : sign === '−' ? 'amount-out' : '';
  return (
    <div className={`list-item cash-row${cancelled ? ' is-muted is-cancelled' : ''}`}>
      <div className="grow">
        <div className="title">{title}</div>
        <div className="meta">{meta}</div>
        {note && <div className="meta">{note}</div>}
      </div>
      <div className="cash-row-end">
        <span className={`num cash-amount ${tone}${quiet ? ' is-quiet' : ''}`}><span className={cancelled ? 'strike' : ''}>{sign}{money(amount)}</span></span>
        {action}
      </div>
    </div>
  );
}

// The muted line: its parts joined by « · », the empty ones left out.
export const metaLine = (...items) => items.filter(Boolean).map((x, i) => <span key={i}>{i ? ' · ' : ''}{x}</span>);

export function TotalLine({ label, amount, sign = '' }) {
  return <dl className="calc section-gap"><div className="total"><dt>{label}</dt><dd>{sign}{money(amount)}</dd></div></dl>;
}

// Administrators cancel a ledger entry with a reason; it stays listed, struck through.
export function cancelEntry(e, onDone) {
  return actionDialog({
    title: 'Annuler cette opération',
    message: `${e.label} — ${money(e.amount)}, ${dayLabel(e.biz_date, 'short')}. L’opération reste visible, barrée, avec le motif.`,
    reasonLabel: 'Motif de l’annulation',
    confirmLabel: 'Annuler l’opération',
    danger: true,
    run: async ({ reason }) => {
      await api.post(`/api/ledger/entries/${e.id}/cancel`, { reason });
      toast('Opération annulée.');
      onDone();
    },
  });
}

export function EntryCancel({ e, isAdmin, onDone }) {
  if (!isAdmin || e.status !== 'active' || e.period_closed) return null;
  return <button type="button" className="btn btn-sm btn-ghost" onClick={() => cancelEntry(e, onDone)}>Annuler<span className="sr-only"> : {e.label}</span></button>;
}
