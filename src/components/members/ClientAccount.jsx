// « Compte client »: a regular client's debt (spec docs/superpowers/specs/2026-11-07-credit-clients-design.md). What he
// owes, his limit and the credit still possible, then the statement, newest first: each operation with what it added to
// the debt (Dû), what it took off (Réglé) and the balance after it. The suppliers' accounts are meant to take the same
// shape later. `file` is the loaded client file: when it reloads, so does the account.
import { useEffect, useRef } from 'react';
import { Link } from 'react-router-dom';
import Icon from '../ui/Icon.jsx';
import { CancelledChip, Empty, Loaded } from '../ui/ui.jsx';
import { api } from '../../lib/api.js';
import { useLoad } from '../../lib/hooks.js';
import { money, dateTime } from '../../lib/format.js';
import { useIsBoss } from '../../store/useStore.js';
import { openCancelSettlementDialog, openCreditLimitDialog, openSettlementDialog } from '../../dialogs/creditDialogs.jsx';

function Statement({ movements, isBoss, onChanged }) {
  if (!movements.length) return <Empty icon="receipt">Aucun achat à crédit pour l’instant.</Empty>;
  return (
    <div className="table-wrap"><table className="table stack-sm account-statement">
      <thead><tr><th>Date</th><th>Opération</th><th className="num">Dû</th><th className="num">Réglé</th><th className="num">Solde</th><th><span className="sr-only">Actions</span></th></tr></thead>
      <tbody>{[...movements].reverse().map((x) => (
        <tr key={x.key} className={x.cancelled_at ? 'is-muted' : ''}>
          <td data-label="Date" className="nowrap">{dateTime(x.at)}</td>
          <td data-label="Opération"><span><strong>{x.label}</strong>
            {x.cancelled_at ? <> <CancelledChip /></> : null}
            {x.detail ? <span className="subtle"> · {x.detail}</span> : null}
            {x.by ? <span className="subtle"> · {x.by}</span> : null}</span></td>
          <td data-label="Dû" className="num">{x.due ? money(x.due) : '—'}</td>
          <td data-label="Réglé" className="num">{x.paid ? money(x.paid) : '—'}</td>
          <td data-label="Solde" className="num"><strong>{money(x.balance)}</strong></td>
          <td className="actions"><span className="row-actions">
            {x.kind === 'reglement' ? <Link className="btn btn-sm" to={`/caisse/ticket/${x.payment_id}`} title={x.ticket_number}>Ticket</Link> : null}
            {x.kind === 'reglement' && !x.cancelled_at && isBoss
              ? <button type="button" className="btn btn-sm btn-ghost" onClick={() => openCancelSettlementDialog(x, onChanged)}>Annuler le règlement</button> : null}
          </span></td>
        </tr>
      ))}</tbody>
    </table></div>
  );
}

export default function ClientAccount({ clientId, file, onChanged }) {
  const isBoss = useIsBoss();
  const state = useLoad(() => api.get(`/api/clients/${clientId}/account`), [clientId]);
  const shownFile = useRef(file);
  useEffect(() => {
    if (shownFile.current === file) return;
    shownFile.current = file;
    state.reload();
  }, [file]); // eslint-disable-line react-hooks/exhaustive-deps
  const changed = () => {
    state.reload();
    onChanged?.();
  };
  return (
    <section className="card span-2 client-account" aria-label="Compte client">
      <Loaded state={state}>{(a) => (
        <>
          <div className="card-head"><h2>Compte client</h2>
            <span className="row-actions">
              {isBoss && <button type="button" className="btn btn-sm" onClick={() => openCreditLimitDialog(a, changed)}><Icon name="edit" /> Plafond</button>}
              {a.owed > 0 && <button type="button" className="btn btn-sm btn-primary" onClick={() => openSettlementDialog(a, changed)}>Enregistrer un règlement</button>}
            </span>
          </div>
          <dl className="calc account-figures">
            <div className="total"><dt>Doit</dt><dd>{money(a.owed)}</dd></div>
            <div><dt>Plafond de crédit</dt><dd>{a.credit_limit ? money(a.credit_limit) : 'pas de crédit'}</dd></div>
            <div><dt>Crédit encore possible</dt><dd>{money(a.available)}</dd></div>
          </dl>
          {!a.credit_limit && !a.movements.length && (
            <p className="subtle">{isBoss
              ? 'Pour lui permettre d’acheter à crédit à la Boutique, fixez son plafond.'
              : 'Pas de crédit : un associé ou l’administrateur fixe son plafond.'}</p>
          )}
          <Statement movements={a.movements} isBoss={isBoss} onChanged={changed} />
        </>
      )}</Loaded>
    </section>
  );
}
