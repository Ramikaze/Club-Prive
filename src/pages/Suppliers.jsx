// « Fournisseurs » (menu, administrators and associés): every supplier with what the club owes it, in FCFA, and the
// total owed per caisse. A supplier belongs to one associé's caisse and is paid from it alone.
import { Link } from 'react-router-dom';
import Icon from '../components/ui/Icon.jsx';
import { openDialog } from '../components/ui/Modal.jsx';
import { DemoChip, Empty, Loaded, PageHead } from '../components/ui/ui.jsx';
import SupplierDialog from '../components/suppliers/SupplierDialog.jsx';
import { api } from '../lib/api.js';
import { dayLabel, money } from '../lib/format.js';
import { useLoad } from '../lib/hooks.js';
import { CAISSE_LABEL } from '../../shared/caisses.js';
import { FOREIGN_SYMBOL } from '../../shared/suppliers.js';

export default function Suppliers() {
  const state = useLoad(() => api.get('/api/suppliers'), []);
  const add = () => openDialog(SupplierDialog, { onDone: state.reload });
  return (
    <>
      <PageHead
        title="Fournisseurs"
        lead="Ce que le club doit à chaque fournisseur, en FCFA."
        actions={<button type="button" className="btn btn-primary" onClick={add}><Icon name="plus" /> Nouveau fournisseur</button>}
      />
      <Loaded state={state}>{({ suppliers, totals }) => (
        <div className="supplier-page">
          <section className="card">
            <div className="card-head"><h2>Dû aux fournisseurs</h2><span className="subtle">payé seulement depuis la caisse du fournisseur</span></div>
            <dl className="calc">
              <div><dt>{CAISSE_LABEL.cigares}</dt><dd className="nowrap">{money(totals.cigares)}</dd></div>
              <div><dt>{CAISSE_LABEL.alcool}</dt><dd className="nowrap">{money(totals.alcool)}</dd></div>
              <div className="total"><dt>Total</dt><dd className="nowrap">{money(totals.cigares + totals.alcool)}</dd></div>
            </dl>
          </section>
          {suppliers.length ? (
            <section className="card"><div className="table-wrap"><table className="table stack-sm">
              <thead><tr>
                <th>Fournisseur</th><th>Caisse</th><th>Pays</th><th>Devise</th><th className="num">Le club doit</th><th>Dernière opération</th>
                <th><span className="sr-only">Actions</span></th>
              </tr></thead>
              <tbody>{suppliers.map((s) => (
                <tr key={s.id} className={s.active ? '' : 'is-muted'}>
                  <td data-label="Fournisseur"><Link to={`/fournisseurs/${s.id}`}><strong>{s.name}</strong></Link> <DemoChip on={s.is_demo} />
                    {!s.active && <> <span className="chip">inactif</span></>}</td>
                  <td data-label="Caisse">{s.account_label}</td>
                  <td data-label="Pays">{s.country ?? '—'}</td>
                  <td data-label="Devise">{s.currency ? `${s.currency} (${FOREIGN_SYMBOL[s.currency]})` : '—'}</td>
                  <td data-label="Le club doit" className="num strong nowrap">{money(s.due)}</td>
                  <td data-label="Dernière opération" className="nowrap">{s.last_date ? dayLabel(s.last_date, 'short') : '—'}</td>
                  <td className="actions"><Link className="btn btn-sm btn-ghost" to={`/fournisseurs/${s.id}`}>Fiche</Link></td>
                </tr>
              ))}</tbody>
            </table></div></section>
          ) : (
            <section className="card"><Empty icon="truck">Aucun fournisseur pour l’instant. Créez-en un avec « Nouveau fournisseur ».</Empty></section>
          )}
        </div>
      )}</Loaded>
    </>
  );
}
