// « Dépenses »: the expenses by category, then every expense of the period, newest first, and the total. The
// transfers between treasury accounts are neither: they get their own quiet list, only when there are any.
import Icon from '../ui/Icon.jsx';
import { AccountTag, DemoChip } from '../ui/ui.jsx';
import { CashRow, EntryCancel, TotalLine, metaLine } from './CashRow.jsx';
import { byCategory, entryWhen } from './flows.js';
import { money } from '../../lib/format.js';

function EntryTitle({ e }) {
  return (
    <>
      {e.label} <DemoChip on={e.is_demo} />
      {e.status !== 'active' && <> <span className="chip">annulée</span></>}
      {e.period_closed && <> <span className="chip" title="Mois clôturé"><Icon name="lock" /> Clôturé</span></>}
    </>
  );
}

const cancelNote = (e) => (e.status !== 'active' && e.cancel_reason ? `Annulée par ${e.cancelled_by_name} : ${e.cancel_reason}` : null);
const newestFirst = (list, oneDay) => list.map((e) => ({ e, w: entryWhen(e, oneDay) })).sort((x, y) => y.w.ms - x.w.ms);

export default function ExpensesBlock({ entries, oneDay, isAdmin, onChange, title = 'Dépenses' }) {
  const list = entries.filter((e) => e.kind === 'depense');
  const total = list.filter((e) => e.status === 'active').reduce((s, e) => s + e.amount, 0);
  const cats = byCategory(list);
  const max = cats[0]?.[1] ?? 0;
  return (
    <section className="card cash-block" id="caisse-depenses" aria-labelledby="caisse-depenses-title">
      <div className="card-head">
        <h2 id="caisse-depenses-title"><Icon name="withdraw" /> {title}</h2>
        <span className="cash-block-total amount-out">{money(total)}</span>
      </div>
      {list.length ? (
        <>
          {cats.length > 0 && (
            <div className="bars cash-summary">
              {cats.map(([name, amount]) => (
                <div className="bar-row" key={name}>
                  <div className="top"><span>{name}</span><span className="amount">{money(amount)}</span></div>
                  <div className="bar-track"><div className="bar-fill" style={{ width: `${Math.max(2, (amount / max) * 100)}%` }} /></div>
                </div>
              ))}
            </div>
          )}
          <h3 className="sub-section-title cash-list-title">Détail ({list.length})</h3>
          <div className="list">
            {newestFirst(list, oneDay).map(({ e, w }) => (
              <CashRow
                key={e.id}
                title={<EntryTitle e={e} />}
                meta={metaLine(w.text, e.category_name, e.method, e.account && <AccountTag account={e.account} />, e.reference,
                  e.created_by_name && `par ${e.created_by_name}`)}
                note={cancelNote(e)}
                amount={e.amount} sign="−" cancelled={e.status !== 'active'}
                action={<EntryCancel e={e} isAdmin={isAdmin} onDone={onChange} />}
              />
            ))}
          </div>
          <TotalLine label="Total des dépenses" amount={total} />
        </>
      ) : <p className="subtle">Aucune dépense sur la période.</p>}
    </section>
  );
}

export function TransfersBlock({ entries, oneDay, isAdmin, onChange }) {
  const list = entries.filter((e) => e.kind === 'transfert');
  if (!list.length) return null;
  return (
    <section className="card cash-block" id="caisse-transferts">
      <div className="card-head"><h2><Icon name="transfer" /> Transferts entre comptes</h2><span className="subtle">ni recette ni dépense</span></div>
      <div className="list">
        {newestFirst(list, oneDay).map(({ e, w }) => (
          <CashRow
            key={e.id}
            title={<EntryTitle e={e} />}
            meta={metaLine(w.text, `${e.method} → ${e.to_method}`, e.reference, e.created_by_name && `par ${e.created_by_name}`)}
            note={cancelNote(e)}
            amount={e.amount} cancelled={e.status !== 'active'}
            action={<EntryCancel e={e} isAdmin={isAdmin} onDone={onChange} />}
          />
        ))}
      </div>
    </section>
  );
}
