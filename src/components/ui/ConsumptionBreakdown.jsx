// What each member in the room has consumed: cigars and alcohol in separate parts with their
// subtotals, then the totals of the room. Billing stays with the holder; this shows who took what.
import { money } from '../../lib/format.js';

const PARTS = [['cigares', 'Cigares'], ['alcool', 'Alcool']];
const sum = (lines) => lines.reduce((s, l) => s + l.amount, 0);

// Product lines of a reservation detail (charges) in the shape used below.
export const consumptionOf = (charges = []) => charges.filter((c) => c.kind === 'produit' && (c.status === 'due' || c.status === 'payee'));

export default function ConsumptionBreakdown({ attendees = [], lines = [] }) {
  // Members present (holder first), then anyone who consumed and has since left the room.
  const people = attendees.map((a) => ({ id: a.member_id, name: a.name, primary: a.is_primary }));
  for (const l of lines) {
    if (!people.some((p) => p.id === l.consumer_member_id)) people.push({ id: l.consumer_member_id, name: l.consumer_name, left: true });
  }
  return (
    <div className="conso">
      {people.map((p) => {
        const mine = lines.filter((l) => l.consumer_member_id === p.id);
        return (
          <section key={p.id} className="conso-member" aria-label={`Consommations de ${p.name}`}>
            <div className="conso-member-head">
              <span className="conso-member-name">{p.name}</span>
              {p.primary && <span className="chip chip-bronze">titulaire</span>}
              {p.left && <span className="chip">sorti</span>}
              <span className="conso-member-total">{mine.length ? money(sum(mine)) : '—'}</span>
            </div>
            {mine.length ? PARTS.map(([account, label]) => {
              const part = mine.filter((l) => l.account === account);
              if (!part.length) return null;
              return (
                <div key={account} className="conso-part">
                  <div className="conso-part-head"><i className={`dot dot-${account}`} /> {label}</div>
                  {part.map((l) => (
                    <div key={l.id} className="conso-line">
                      <span>{l.quantity} × {l.label}{l.status === 'payee' && <span className="conso-paid"> · réglé</span>}</span>
                      <span className="num">{money(l.amount)}</span>
                    </div>
                  ))}
                  <div className="conso-subtotal"><span>Sous-total {label.toLowerCase()}</span><span className="num">{money(sum(part))}</span></div>
                </div>
              );
            }) : <p className="subtle">Aucune consommation.</p>}
          </section>
        );
      })}
      <dl className="calc conso-totals">
        {PARTS.map(([account, label]) => (
          <div key={account}><dt>{label}</dt><dd>{money(sum(lines.filter((l) => l.account === account)))}</dd></div>
        ))}
        <div className="total"><dt>Total des consommations</dt><dd>{money(sum(lines))}</dd></div>
      </dl>
    </div>
  );
}

// Who is the next bottle or cigar for: one button per member present.
export function ConsumerPicker({ attendees = [], value, onChange }) {
  if (attendees.length < 2) return null;
  return (
    <div className="member-choice" role="group" aria-label="Pour quel membre ?">
      <span className="subtle">Pour :</span>
      {attendees.map((a) => (
        <button key={a.member_id} type="button" className="btn btn-sm" aria-pressed={value === a.member_id} onClick={() => onChange(a.member_id)}>
          {a.name}
        </button>
      ))}
    </div>
  );
}
