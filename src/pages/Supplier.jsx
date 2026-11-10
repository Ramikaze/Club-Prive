// A supplier's sheet (/fournisseurs/:id): what the club owes it, and its statement in the order of the dates —
// Date, Opération, Dû, Réglé, Solde, the same form as a client's receivable sheet. A purchase raises the debt without
// moving money; a payment is an expense of the supplier's caisse, cancelled like any operation of the cash desk.
import { useParams } from 'react-router-dom';
import Icon from '../components/ui/Icon.jsx';
import { actionDialog, openDialog } from '../components/ui/Modal.jsx';
import { CancelledChip, DemoChip, Loaded, Notice, PageHead } from '../components/ui/ui.jsx';
import { toast } from '../components/ui/toast.jsx';
import EntryDialog from '../components/cash/EntryDialog.jsx';
import { cancelEntry } from '../components/cash/CashRow.jsx';
import SupplierDialog from '../components/suppliers/SupplierDialog.jsx';
import PurchaseDialog from '../components/suppliers/PurchaseDialog.jsx';
import { api } from '../lib/api.js';
import { dayLabel, money } from '../lib/format.js';
import { useLoad } from '../lib/hooks.js';
import { FOREIGN_SYMBOL, SUPPLIER_DEFAULT_CATEGORY, formatForeign } from '../../shared/suppliers.js';

// An amount in FCFA, with its amount in euros or dollars between brackets (for information).
function Amount({ value, line, strike }) {
  if (!value) return null;
  return (
    <span className="supplier-amount">
      <span className={`nowrap${strike ? ' strike' : ''}`}>{money(value)}</span>
      {line.foreign_amount ? <> <span className="subtle nowrap">({formatForeign(line.foreign_amount, line.foreign_currency)})</span></> : null}
    </span>
  );
}

function Operation({ l }) {
  const extra = l.kind === 'paiement'
    ? [l.label, l.category_name, l.method, l.reference].filter(Boolean)
    : [l.label !== l.kind_label ? l.label : null, l.reference && `Facture ${l.reference}`].filter(Boolean);
  return (
    <div className="supplier-op">
      <strong>{l.kind_label}</strong>{l.status !== 'active' && <> <CancelledChip /></>}
      {extra.length > 0 && <div className="subtle">{extra.join(' · ')}</div>}
      {l.created_by_name && <div className="subtle">par {l.created_by_name}</div>}
      {l.status !== 'active' && l.cancel_reason && <div className="subtle">Annulé par {l.cancelled_by_name} : {l.cancel_reason}</div>}
    </div>
  );
}

export default function Supplier() {
  const { id } = useParams();
  const state = useLoad(async () => {
    const [sheet, categories] = await Promise.all([api.get(`/api/suppliers/${id}`), api.get('/api/ledger/categories')]);
    return { ...sheet, categories };
  }, [id]);

  return (
    <Loaded state={state}>{({ supplier: s, lines, totals, categories }) => {
      const reload = state.reload;
      const edit = () => openDialog(SupplierDialog, { supplier: s, onDone: reload });
      const buy = () => openDialog(PurchaseDialog, { supplier: s, onDone: reload });
      const pay = () => openDialog(EntryDialog, {
        kind: 'depense', categories, categoryCode: SUPPLIER_DEFAULT_CATEGORY[s.account], supplier: s,
        title: 'Payer un fournisseur', onDone: reload,
      });
      const setActive = (active) => actionDialog({
        title: active ? 'Réactiver ce fournisseur' : 'Désactiver ce fournisseur',
        message: active
          ? `« ${s.name} » pourra de nouveau recevoir des achats.`
          : `« ${s.name} » ne recevra plus d’achat. Il reste dans la liste, avec son relevé.`,
        confirmLabel: active ? 'Réactiver' : 'Désactiver',
        run: async () => {
          await api.put(`/api/suppliers/${s.id}`, { active });
          toast(active ? 'Fournisseur réactivé.' : 'Fournisseur désactivé.');
          reload();
        },
      });
      const cancelPurchase = (l) => actionDialog({
        title: `Annuler ${l.kind === 'report' ? 'ce solde reporté' : 'cet achat'}`,
        message: `${l.kind_label} du ${dayLabel(l.date, 'short')} — ${money(l.due)}. La dette envers « ${s.name} » baisse d’autant. La ligne reste visible, barrée, avec le motif.`,
        reasonLabel: 'Motif de l’annulation',
        confirmLabel: 'Annuler l’opération',
        danger: true,
        run: async ({ reason }) => {
          await api.post(`/api/suppliers/purchases/${l.purchase_id}/cancel`, { reason });
          toast('Opération annulée.');
          reload();
        },
      });
      const cancelPayment = (l) => cancelEntry(
        { id: l.entry_id, kind: 'depense', account: s.account, label: l.label, amount: l.paid, biz_date: l.date },
        reload,
      );
      const lead = [s.account_label, s.country, s.currency && `factures en ${s.currency} (${FOREIGN_SYMBOL[s.currency]})`].filter(Boolean).join(' · ');
      return (
        <>
          <PageHead
            title={<>{s.name} <DemoChip on={s.is_demo} /></>}
            lead={lead}
            back={{ to: '/fournisseurs', label: 'Fournisseurs' }}
            actions={(
              <>
                <button type="button" className="btn btn-sm btn-ghost" onClick={edit}><Icon name="edit" /> Modifier</button>
                {s.active
                  ? <button type="button" className="btn btn-sm btn-ghost" disabled={s.due > 0} title={s.due > 0 ? 'Possible seulement quand le club ne lui doit plus rien' : undefined} onClick={() => setActive(false)}><Icon name="ban" /> Désactiver</button>
                  : <button type="button" className="btn btn-sm btn-ghost" onClick={() => setActive(true)}><Icon name="undo" /> Réactiver</button>}
                <button type="button" className="btn btn-sm" disabled={!s.active} onClick={buy}><Icon name="plus" /> Enregistrer un achat</button>
                <button type="button" className="btn btn-primary" disabled={s.due <= 0} onClick={pay}><Icon name="withdraw" /> Payer</button>
              </>
            )}
          />
          <div className="supplier-page">
            {!s.active && <Notice kind="warn">Ce fournisseur est désactivé : réactivez-le pour enregistrer un achat.</Notice>}
            <section className="card">
              <div className="card-head"><h2>Le club doit</h2><span className="supplier-due nowrap">{money(totals.due)}</span></div>
              <dl className="calc">
                <div><dt>Achats et soldes reportés</dt><dd className="nowrap">{money(totals.purchases)}</dd></div>
                <div><dt>Déjà payé</dt><dd className="nowrap">{totals.paid ? `− ${money(totals.paid)}` : money(0)}</dd></div>
                <div className="total"><dt>Reste dû</dt><dd className="nowrap">{money(totals.due)}</dd></div>
              </dl>
              <p className="subtle section-gap">Payé seulement depuis la caisse « {s.account_label} ». Les montants en devise, entre parenthèses, sont donnés pour information.</p>
              {(s.contact || s.notes) && <p className="subtle">{[s.contact, s.notes].filter(Boolean).join(' · ')}</p>}
            </section>
            <section className="card">
              <div className="card-head"><h2>Relevé</h2><span className="subtle">{lines.length} opération(s)</span></div>
              {lines.length ? (
                <div className="table-wrap"><table className="table stack-sm supplier-statement">
                  <thead><tr>
                    <th>Date</th><th>Opération</th><th className="num">Dû</th><th className="num">Réglé</th><th className="num">Solde</th>
                    <th><span className="sr-only">Actions</span></th>
                  </tr></thead>
                  <tbody>{lines.map((l) => {
                    const cancelled = l.status !== 'active';
                    return (
                      <tr key={l.key} className={cancelled ? 'is-muted' : ''}>
                        <td data-label="Date" className="nowrap">{dayLabel(l.date, 'short')}</td>
                        <td data-label="Opération"><Operation l={l} /></td>
                        <td data-label="Dû" className={`num${l.due ? '' : ' is-empty'}`}><Amount value={l.due} line={l} strike={cancelled} /></td>
                        <td data-label="Réglé" className={`num${l.paid ? '' : ' is-empty'}`}><Amount value={l.paid} line={l} strike={cancelled} /></td>
                        <td data-label="Solde" className="num strong nowrap">{l.balance == null ? '—' : money(l.balance)}</td>
                        <td className="actions">{!cancelled && (
                          <button type="button" className="btn btn-sm btn-ghost" onClick={() => (l.kind === 'paiement' ? cancelPayment(l) : cancelPurchase(l))}>
                            Annuler<span className="sr-only"> : {l.kind_label} du {dayLabel(l.date, 'short')}</span>
                          </button>
                        )}</td>
                      </tr>
                    );
                  })}</tbody>
                </table></div>
              ) : (
                <p className="subtle">Aucune opération. Commencez par « Enregistrer un achat » (ou un solde reporté).</p>
              )}
            </section>
          </div>
        </>
      );
    }}</Loaded>
  );
}
