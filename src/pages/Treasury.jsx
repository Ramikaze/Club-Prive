// Treasury (/tresorerie, administrators): balance of each cash box and account over the period,
// and the simplified result (net collected per sub-account minus expenses).
import { Link } from 'react-router-dom';
import Icon from '../components/ui/Icon.jsx';
import { AccountTag, AdminTabs, Loaded, Notice, PageHead } from '../components/ui/ui.jsx';
import PeriodPicker, { usePeriod } from '../components/ui/PeriodPicker.jsx';
import { api, qs } from '../lib/api.js';
import { money, dayLabel } from '../lib/format.js';
import { useLoad } from '../lib/hooks.js';

const methodIcon = (m) => (/esp[eè]ce/i.test(m) ? 'cash' : /carte/i.test(m) ? 'card' : /virement|banque/i.test(m) ? 'bank' : 'wallet');

function AccountCard({ a, from, to, total = false }) {
  return (
    <div className={`account-card ${total ? 'total' : ''}`}>
      <h3>{!total && <Icon name={methodIcon(a.method)} />} {total ? 'Total trésorerie' : a.method}</h3>
      <div className={`big ${a.closing < 0 ? 'negative' : ''}`}>{money(a.closing)}</div>
      <div className="calc-line"><span>Solde au {dayLabel(from, 'short')}</span><span>{money(a.opening)}</span></div>
      <div className="calc-line"><span>Entrées</span><span>+ {money(a.in)}</span></div>
      <div className="calc-line"><span>Sorties</span><span>− {money(a.out)}</span></div>
      <Link className="card-link" to={`/grand-livre${qs({ from, to, compte: total ? '' : a.method })}`}>Voir les mouvements</Link>
    </div>
  );
}

export default function Treasury() {
  const period = usePeriod('month');
  const { from, to } = period;
  const state = useLoad(() => api.get(`/api/treasury${qs({ from, to })}`), [from, to]);

  return (
    <>
      <AdminTabs />
      <PageHead
        title="Trésorerie & Bilans"
        lead="Soldes des caisses et des comptes, et résultat de la période."
        tour="treasury"
      />
      <div className="toolbar"><PeriodPicker period={period} /></div>
      <Loaded state={state}>
        {(t) => {
          const r = t.result;
          const noOpening = !t.opening_date && t.accounts.every((a) => a.opening === 0) && t.total.in + t.total.out === 0;
          return (
            <>
              {noOpening && (
                <div className="toolbar">
                  <Notice kind="bronze">
                    Aucun mouvement ni solde d’ouverture sur la période. Pour partir des soldes réels des caisses et comptes,
                    saisissez-les dans <Link to="/parametres">Paramètres</Link>, rubrique Trésorerie.
                  </Notice>
                </div>
              )}
              <div className="account-cards">
                {t.accounts.map((a) => <AccountCard key={a.method} a={a} from={t.from} to={t.to} />)}
                <AccountCard a={t.total} from={t.from} to={t.to} total />
              </div>
              {t.opening_date && (
                <p className="subtle section-gap">Soldes suivis depuis le {dayLabel(t.opening_date)} ; les mouvements antérieurs ne sont pas comptés.</p>
              )}
              {t.wallet_liability != null && (
                <div className="card section-gap">
                  <dl className="calc">
                    <div className="total"><dt>Crédits CFA des membres (dus en consommations)</dt><dd>{money(t.wallet_liability)}</dd></div>
                  </dl>
                  <p className="subtle" style={{ marginTop: 8 }}>
                    Argent déjà approvisionné sur les cartes au {dayLabel(t.to, 'short')}, que le club doit encore aux membres en consommations.
                    Il est compté en trésorerie à l’approvisionnement, en recette seulement quand la carte paie.
                  </p>
                </div>
              )}
              <div className="grid-2 section-gap">
                <div className="card">
                  <div className="card-head"><h2>Résultat de la période</h2></div>
                  <dl className="calc">
                    <div><dt>Encaissé net (après remboursements)</dt><dd>{money(r.revenue)}</dd></div>
                    <div><dt>Dépenses</dt><dd>− {money(r.expenses)}</dd></div>
                    <div className="total"><dt>Résultat</dt><dd>{money(r.result)}</dd></div>
                  </dl>
                  {r.other_receipts > 0 && (
                    <p className="subtle section-gap">
                      Entrées diverses : {money(r.other_receipts)}. Elles alimentent la trésorerie sans compter dans le résultat (apports des associés, par exemple).
                    </p>
                  )}
                </div>
                <div className="card">
                  <div className="card-head"><h2>Par sous-compte</h2></div>
                  <div className="table-wrap">
                    <table className="table stack-sm">
                      <thead><tr><th>Sous-compte</th><th className="num">Encaissé net</th><th className="num">Dépenses affectées</th><th className="num">Marge</th></tr></thead>
                      <tbody>
                        {r.accounts.map((a) => (
                          <tr key={a.account}>
                            <td data-label="Sous-compte"><AccountTag account={a.account} /></td>
                            <td data-label="Encaissé net" className="num">{money(a.net)}</td>
                            <td data-label="Dépenses affectées" className="num">{a.expenses ? `− ${money(a.expenses)}` : '—'}</td>
                            <td data-label="Marge" className={`num ${a.margin < 0 ? 'amount-out' : ''}`}>{money(a.margin)}</td>
                          </tr>
                        ))}
                        <tr>
                          <td data-label="Sous-compte">Frais généraux</td>
                          <td data-label="Encaissé net" className="num">—</td>
                          <td data-label="Dépenses affectées" className="num">{r.general_expenses ? `− ${money(r.general_expenses)}` : '—'}</td>
                          <td data-label="Marge" className="num">{r.general_expenses ? `− ${money(r.general_expenses)}` : '—'}</td>
                        </tr>
                      </tbody>
                      <tfoot>
                        <tr><td>Total</td><td className="num">{money(r.revenue)}</td><td className="num">− {money(r.expenses)}</td><td className="num">{money(r.result)}</td></tr>
                      </tfoot>
                    </table>
                  </div>
                </div>
              </div>
              {r.expenses_by_category.length > 0 && (
                <div className="card section-gap">
                  <div className="card-head"><h2>Dépenses par catégorie</h2><Link to={`/caisse${qs({ from, to, type: 'depense' })}`}>Détail des dépenses</Link></div>
                  <div className="bars">
                    {r.expenses_by_category.map((c) => (
                      <div className="bar-row" key={c.category_id}>
                        <div className="top"><span>{c.name}</span><span className="amount">{money(c.total)}</span></div>
                        <div className="bar-track"><div className="bar-fill" style={{ width: `${Math.max(2, (c.total / r.expenses_by_category[0].total) * 100)}%` }} /></div>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </>
          );
        }}
      </Loaded>
    </>
  );
}
