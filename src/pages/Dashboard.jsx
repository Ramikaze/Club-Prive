import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { api } from '../lib/api.js';
import { useLoad } from '../lib/hooks.js';
import { money, fmtDuration, dayLabel } from '../lib/format.js';
import { useIsAdmin } from '../store/useStore.js';
import Icon from '../components/ui/Icon.jsx';
import { Chip, AccountTag, Empty, Loaded, PageHead, Segmented } from '../components/ui/ui.jsx';
import { openBookingDialog } from '../dialogs/index.js';

const PERIODS = [['jour', 'Jour'], ['semaine', '7 jours'], ['mois', 'Mois']];

function ResItem({ r, withDay = false }) {
  const meta = `${fmtDuration(r.duration_min)}${r.off_hours ? ' · hors horaires' : ''}${r.due_amount ? ` · reste ${money(r.due_amount)}` : ''}`;
  return (
    <Link className="list-item" to={`/reservations/${r.id}`}>
      <span className="time">{withDay && <>{dayLabel(r.biz_day, 'medium')}<br /></>}{r.start_time} – {r.end_time}</span>
      <div className="grow">
        <div className="title">{r.member_name}</div>
        <div className="meta">{meta}</div>
      </div>
      <Chip group="res" value={r.status} />
    </Link>
  );
}

function RevenueBlock({ sum }) {
  const max = Math.max(1, ...sum.accounts.map((a) => Math.max(a.net, a.billed)));
  return (
    <div className="bars">
      {sum.accounts.map((a) => (
        <div className="bar-row" key={a.account}>
          <div className="top"><span><AccountTag account={a.account} /></span><span className="amount">{money(a.net)}</span></div>
          <div className="bar-track" aria-hidden="true">
            <div className={`bar-fill ${a.account}`} style={{ width: `${Math.max(0, Math.round((a.net / max) * 100))}%` }} />
          </div>
          <div className="subtle">Facturé {money(a.billed)} · reste à payer {money(a.outstanding)}{a.refunded ? ` · remboursé ${money(a.refunded)}` : ''}</div>
        </div>
      ))}
      <div className="bar-row">
        <div className="top"><strong>Total encaissé net</strong><span className="amount">{money(sum.total.net)}</span></div>
        <div className="subtle">Encaissé {money(sum.total.collected)} − remboursé {money(sum.total.refunded)}</div>
      </div>
    </div>
  );
}

export default function Dashboard() {
  const admin = useIsAdmin();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const state = useLoad(() => api.get('/api/dashboard'), [], { refreshMs: 60000 });
  const q = searchParams.get('periode');
  const period = ['jour', 'semaine', 'mois'].includes(q) && admin ? q : 'jour';

  return (
    <Loaded state={state}>
      {(d) => {
        const revenue = period === 'semaine' ? d.revenue.week : period === 'mois' ? d.revenue.month : d.cash_today;
        const active = d.today.filter((r) => r.status !== 'annulee');
        const totalMin = active.reduce((sum, r) => sum + r.duration_min, 0);
        const current = d.current[0];
        const next = d.upcoming[0];
        const nextText = next
          ? `Prochaine arrivée : ${next.member_name}, ${next.biz_day === d.biz_day ? '' : `${dayLabel(next.biz_day, 'medium')} `}${next.start_time}`
          : 'Aucune réservation à venir';
        const book = () => openBookingDialog({ date: d.biz_day }, (det) => navigate(`/reservations/${det.reservation.id}`));

        return (
          <>
            <PageHead
              title="Tableau de bord"
              lead={dayLabel(d.biz_day, 'title')}
              tour="dashboard"
              actions={(
                <>
                  <Link className="btn" to="/agenda"><Icon name="calendar" /> Agenda</Link>
                  <button type="button" className="btn btn-primary" onClick={book}><Icon name="plus" /> Réservation</button>
                </>
              )}
            />

            <section className="kpis" aria-label="Situation du club">
              <div className={`kpi ${current ? 'accent status-busy' : ''}`}>
                <div className="label">Salle en ce moment</div>
                <div className="value">{current ? 'Occupée' : 'Libre'}</div>
                <div className="hint">
                  {current
                    ? <><Link to={`/reservations/${current.id}`}>{current.member_name}</Link> jusqu’à {current.end_time}</>
                    : nextText}
                </div>
              </div>
              <div className="kpi">
                <div className="label">Réservations du jour</div>
                <div className="value">{active.length}</div>
                <div className="hint">{fmtDuration(totalMin)} de privatisation</div>
              </div>
              <div className="kpi">
                <div className="label">Encaissé aujourd’hui</div>
                <div className="value">{money(d.cash_today.total.net)}</div>
                <div className="hint">{d.cash_today.methods.map((x) => `${x.method} ${money(x.total)}`).join(' · ') || 'Aucun encaissement'}</div>
              </div>
              <div className="kpi">
                <div className="label">Reste à encaisser</div>
                <div className="value">{money(d.outstanding_total)}</div>
                <div className="hint"><Link to="/caisse">Voir les lignes ouvertes</Link></div>
              </div>
            </section>

            <section className="service-priorities" aria-label="Priorités de service">
              <div className="service-priority-title"><Icon name="humidor" /><div><h2>Cave & casiers</h2><p className="subtle">À vérifier pendant le service</p></div></div>
              <div className="service-priority-links">
                {d.lounge.summary.alerts > 0 && <Link className="priority-link danger" to="/lounge"><strong>{d.lounge.summary.alerts}</strong> cave(s) hors seuils <Icon name="right" /></Link>}
                {d.lounge.summary.checks_due > 0 && <Link className="priority-link" to="/lounge"><strong>{d.lounge.summary.checks_due}</strong> contrôle(s) à faire <Icon name="right" /></Link>}
                {d.lounge.summary.expiring > 0 && <Link className="priority-link" to="/lounge?vue=casiers&statut=a_renouveler"><strong>{d.lounge.summary.expiring}</strong> casier(s) à renouveler <Icon name="right" /></Link>}
                {!d.lounge.summary.humidors && <Link className="priority-link" to="/lounge">Configurer le suivi de la cave <Icon name="right" /></Link>}
                {d.lounge.summary.humidors > 0 && !d.lounge.summary.alerts && !d.lounge.summary.checks_due && !d.lounge.summary.expiring && <Link className="priority-link ok" to="/lounge"><Icon name="check" /> Contrôles à jour <Icon name="right" /></Link>}
              </div>
            </section>

            <div className="grid-2">
              <section className="card">
                <div className="card-head">
                  <h2>Réservations du jour</h2>
                  <Link className="subtle" to={`/agenda?date=${d.biz_day}`}>Ouvrir l’agenda</Link>
                </div>
                {d.today.length
                  ? <div className="list">{d.today.map((r) => <ResItem key={r.id} r={r} />)}</div>
                  : <Empty icon="calendar">Aucune réservation aujourd’hui.</Empty>}
              </section>

              <section className="card">
                <div className="card-head">
                  <h2>Recettes par activité</h2>
                  {admin
                    ? <Segmented value={period} options={PERIODS} label="Période" onChange={(k) => setSearchParams({ periode: k })} />
                    : <span className="subtle">Caisse du jour</span>}
                </div>
                <RevenueBlock sum={revenue} />
              </section>

              {d.to_close.length > 0 && (
                <section className="card">
                  <div className="card-head"><h2>À clôturer</h2><span className="chip chip-warn">{d.to_close.length}</span></div>
                  <p className="subtle" style={{ marginBottom: '6px' }}>Horaire dépassé : terminez la réservation pour consommer le crédit, ou vérifiez la note.</p>
                  <div className="list">{d.to_close.map((r) => <ResItem key={r.id} r={r} withDay />)}</div>
                </section>
              )}

              <section className="card">
                <div className="card-head"><h2>Prochaines arrivées</h2></div>
                {d.upcoming.length
                  ? <div className="list">{d.upcoming.map((r) => <ResItem key={r.id} r={r} withDay />)}</div>
                  : <Empty icon="clock">Aucune arrivée prévue.</Empty>}
              </section>

              <section className="card">
                <div className="card-head"><h2>Abonnements à surveiller</h2></div>
                {d.expiring.length || d.expired.length ? (
                  <div className="list">
                    {d.expiring.map((x) => (
                      <Link key={`e${x.id}`} className="list-item" to={`/membres/${x.member_id}`}>
                        <div className="grow">
                          <div className="title">{x.member_name}</div>
                          <div className="meta">{x.plan_name} · fin le {dayLabel(x.end_date, 'short')}</div>
                        </div>
                        <span className="chip chip-warn">{x.days_left === 0 ? 'dernier jour' : `${x.days_left} j`}</span>
                      </Link>
                    ))}
                    {d.expired.map((x) => (
                      <Link key={`x${x.id}`} className="list-item" to={`/membres/${x.member_id}`}>
                        <div className="grow">
                          <div className="title">{x.member_name}</div>
                          <div className="meta">{x.plan_name} · expirée le {dayLabel(x.end_date, 'short')}</div>
                        </div>
                        <span className="chip chip-danger">expirée</span>
                      </Link>
                    ))}
                  </div>
                ) : <Empty icon="check">Aucun abonnement n’arrive à expiration.</Empty>}
              </section>

              <section className="card">
                <div className="card-head"><h2>Alertes de stock</h2><Link className="subtle" to="/produits">Produits</Link></div>
                {d.stock_alerts.length ? (
                  <div className="list">
                    {d.stock_alerts.map((p) => (
                      <Link key={p.id} className="list-item" to="/produits">
                        <div className="grow">
                          <div className="title">{p.name}</div>
                          <div className="meta">{p.category === 'cigare' ? 'Cigare' : 'Bouteille'} · seuil {p.low_stock_threshold}</div>
                        </div>
                        <span className={`chip ${p.stock_qty === 0 ? 'chip-danger' : 'chip-warn'}`}>{p.stock_qty === 0 ? 'rupture' : `${p.stock_qty} en stock`}</span>
                      </Link>
                    ))}
                  </div>
                ) : <Empty icon="check">Aucun produit sous le seuil d’alerte.</Empty>}
              </section>
            </div>
          </>
        );
      }}
    </Loaded>
  );
}
