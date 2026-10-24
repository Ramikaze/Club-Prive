import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { api } from '../lib/api.js';
import { useLoad } from '../lib/hooks.js';
import { money, fmtDuration, dayLabel } from '../lib/format.js';
import { useIsAdmin } from '../store/useStore.js';
import Icon from '../components/ui/Icon.jsx';
import SessionTimer, { isRunning } from '../components/ui/SessionTimer.jsx';
import EndingSoonNotice from '../components/ui/EndingSoonNotice.jsx';
import { Chip, AccountTag, Empty, Loaded, PageHead, Segmented } from '../components/ui/ui.jsx';
import {
  openBookingDialog,
  openMemberDialog,
  openConsumptionDialog,
  openQuickPayReservation,
  quickStartReservation,
  quickFinishReservation,
} from '../dialogs/index.js';

const PERIODS = [['jour', 'Jour'], ['semaine', '7 jours'], ['mois', 'Mois']];

function TodaySessionRow({ r, onReload }) {
  return (
    <div className="list-item list-item-interactive">
      <Link className="list-item-main" to={`/reservations/${r.id}`}>
        <span className="time">{r.start_time} – {r.end_time}</span>
        <div className="grow">
          <div className="title">{r.member_name}</div>
          <div className="meta">
            {r.room_name || 'Salon Principal'} · {r.party_size || 1} pers.
            {r.due_amount ? ` · à régler ${money(r.due_amount)}` : ''}
          </div>
        </div>
      </Link>
      <div className="res-row-actions">
        {r.status === 'reservee' && (
          <button type="button" className="btn btn-sm btn-primary" onClick={() => quickStartReservation(r, onReload)}>
            Arrivée
          </button>
        )}
        {(r.status === 'reservee' || r.status === 'en_cours') && (
          <button type="button" className="btn btn-sm" onClick={() => openConsumptionDialog(r, onReload)}>
            + Conso
          </button>
        )}
        {r.due_amount > 0 && (
          <button type="button" className="btn btn-sm" onClick={() => openQuickPayReservation(r, onReload)}>
            {money(r.due_amount)}
          </button>
        )}
        {r.status === 'en_cours' && (
          <button type="button" className="btn btn-sm btn-ghost" onClick={() => quickFinishReservation(r, onReload)}>
            Libérer
          </button>
        )}
        <Chip group="res" value={r.status} />
      </div>
    </div>
  );
}

// One room of the live board: name and status on top, then who is in it, the timer and what was served.
function LiveRoom({ rm, bizDay, onReload }) {
  const r = rm.current;
  const items = r?.items_summary ? r.items_summary.split(' · ') : [];
  return (
    <article className={`live-room ${r ? 'is-busy' : 'is-free'}`}>
      <header className="live-room-head">
        <Link className="live-room-name" to="/salles">{rm.name}</Link>
        <span className="live-room-cap"><Icon name="users" size={14} /> {rm.capacity} places</span>
        <span className={`chip ${r ? 'chip-warn' : 'chip-ok'}`}>{r ? 'Occupée' : 'Disponible'}</span>
      </header>

      {r ? (
        <>
          <div className="live-room-guest">
            <Link className="live-room-member" to={`/reservations/${r.id}`}>{r.member_name}</Link>
            <div className="live-room-facts">
              <span><Icon name="users" size={14} /> {r.party_size || 1} pers.</span>
              <span><Icon name="clock" size={14} /> {r.start_time} – {r.end_time}</span>
            </div>
          </div>
          {isRunning(r) && <SessionTimer reservation={r} compact />}
          <div className="live-room-items">
            <div className="live-room-label">Consommations</div>
            {items.length
              ? <ul>{items.map((it, i) => <li key={i}>{it}</li>)}</ul>
              : <p className="subtle">Rien de servi pour l’instant</p>}
          </div>
          <EndingSoonNotice reservation={r} onExtended={onReload} />
          <div className="live-room-actions">
            <button type="button" className="btn btn-sm btn-primary" onClick={() => openConsumptionDialog(r, onReload)}>
              <Icon name="plus" /> Bouteille / Cigare
            </button>
          </div>
        </>
      ) : (
        <>
          <p className="live-room-next">
            {rm.next
              ? <><Icon name="clock" size={14} /> Prochaine arrivée à <strong>{rm.next.start_time}</strong> · {rm.next.member_name}</>
              : 'Libre, aucune réservation à venir'}
          </p>
          <div className="live-room-actions">
            <button
              type="button"
              className="btn btn-sm"
              onClick={() => openBookingDialog({ date: bizDay, room_id: rm.id, start_now: true }, onReload)}
            >
              Installer un client
            </button>
          </div>
        </>
      )}
    </article>
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
        </div>
      ))}
      <div className="bar-row" style={{ paddingTop: 8, borderTop: '1px solid var(--border)' }}>
        <div className="top"><strong>Total encaissé net</strong><span className="amount">{money(sum.total.net)}</span></div>
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
        const reload = state.reload;
        const revenue = period === 'semaine' ? d.revenue.week : period === 'mois' ? d.revenue.month : d.cash_today;
        const active = d.today.filter((r) => r.status !== 'annulee');
        const totalMin = active.reduce((sum, r) => sum + r.duration_min, 0);
        const roomsStatus = d.rooms_status ?? [];
        const book = () => openBookingDialog({ date: d.biz_day }, () => reload());
        const newMember = () => openMemberDialog(null, (m) => navigate(`/membres/${m.id}`));

        const humidorAlerts = (d.lounge?.summary?.alerts ?? 0) + (d.lounge?.summary?.checks_due ?? 0);
        const memberAlerts = d.expiring.length + d.expired.length;
        const totalAlerts = d.to_close.length + humidorAlerts + d.stock_alerts.length + memberAlerts;

        return (
          <>
            <PageHead
              title="Accueil"
              lead={dayLabel(d.biz_day, 'title')}
              tour="dashboard"
              actions={(
                <>
                  <button type="button" className="btn" onClick={newMember}><Icon name="plus" /> Nouveau membre</button>
                  <button type="button" className="btn btn-primary" onClick={book}><Icon name="plus" /> Réservation</button>
                </>
              )}
            />

            <section className="kpis" aria-label="Synthèse du club">
              <Link className="kpi kpi-link" to="/agenda">
                <div className="label">Séances du jour</div>
                <div className="value">{active.length}</div>
                <div className="hint">{active.length ? `${fmtDuration(totalMin)} réservées` : 'Aucune séance aujourd’hui'}</div>
              </Link>
              <Link className="kpi kpi-link" to="/caisse">
                <div className="label">Encaissé aujourd’hui</div>
                <div className="value">{money(d.cash_today.total.net)}</div>
                <div className="hint">{d.cash_today.methods.length ? `${d.cash_today.methods.length} mode(s) de règlement` : 'Aucun règlement ce jour'}</div>
              </Link>
              <Link className="kpi kpi-link" to="/caisse">
                <div className="label">Reste à encaisser</div>
                <div className="value">{money(d.outstanding_total)}</div>
                <div className="hint">{d.outstanding_total > 0 ? 'Notes ouvertes à régler' : 'Toutes les notes sont soldées'}</div>
              </Link>
            </section>

            <div className="grid-2">
              <div className="stack-cards">
                <section className="card" data-tour="live-rooms">
                  <div className="card-head">
                    <h2>État des salles en direct</h2>
                    <Link className="btn btn-sm" to="/salles"><Icon name="rooms" /> Gérer les salles</Link>
                  </div>
                  <div className="live-rooms">
                    {roomsStatus.map((rm) => (
                      <LiveRoom key={rm.id} rm={rm} bizDay={d.biz_day} onReload={reload} />
                    ))}
                  </div>
                </section>

                <section className="card">
                  <div className="card-head">
                    <h2>Programme d’aujourd’hui</h2>
                    <Link className="btn btn-sm btn-ghost" to={`/agenda?date=${d.biz_day}`}>Ouvrir l’agenda</Link>
                  </div>
                  {active.length
                    ? <div className="list">{active.map((r) => <TodaySessionRow key={r.id} r={r} onReload={reload} />)}</div>
                    : <Empty icon="calendar">Aucune réservation prévue aujourd’hui.</Empty>}
                </section>
              </div>

              <div className="stack-cards">
                <section className="card">
                  <div className="card-head">
                    <h2>Points d’attention</h2>
                    <span className={`chip ${totalAlerts > 0 ? 'chip-warn' : 'chip-ok'}`}>
                      {totalAlerts > 0 ? `${totalAlerts} à vérifier` : 'Tout est en ordre'}
                    </span>
                  </div>
                  <div className="list">
                    {d.to_close.length > 0 && (
                      <Link className="list-item" to="/agenda?vue=liste">
                        <div className="grow">
                          <div className="title">Séances dont l’horaire est dépassé</div>
                          <div className="meta">{d.to_close.map((r) => r.member_name).join(', ')}</div>
                        </div>
                        <span className="chip chip-warn">{d.to_close.length} à clôturer</span>
                      </Link>
                    )}
                    {d.stock_alerts.length > 0 && (
                      <Link className="list-item" to="/produits">
                        <div className="grow">
                          <div className="title">Cigares & bouteilles à réapprovisionner</div>
                          <div className="meta">{d.stock_alerts.slice(0, 3).map((p) => p.name).join(', ')}{d.stock_alerts.length > 3 ? '…' : ''}</div>
                        </div>
                        <span className="chip chip-danger">{d.stock_alerts.length} produit(s)</span>
                      </Link>
                    )}
                    {humidorAlerts > 0 && (
                      <Link className="list-item" to="/lounge">
                        <div className="grow">
                          <div className="title">Caves à cigares (humidité / température)</div>
                          <div className="meta">Contrôle ou ajustement requis</div>
                        </div>
                        <span className="chip chip-warn">{humidorAlerts} cave(s)</span>
                      </Link>
                    )}
                    {memberAlerts > 0 && (
                      <Link className="list-item" to="/membres">
                        <div className="grow">
                          <div className="title">Abonnements à renouveler</div>
                          <div className="meta">{d.expired.length} expiré(s) · {d.expiring.length} arrivant à échéance</div>
                        </div>
                        <span className="chip chip-info">{memberAlerts} membre(s)</span>
                      </Link>
                    )}
                    {totalAlerts === 0 && (
                      <div className="list-item">
                        <div className="grow">
                          <div className="title">Aucune alerte en cours</div>
                          <div className="meta">Salles, stocks de cigares et bouteilles, caves et abonnements sont à jour.</div>
                        </div>
                        <span className="chip chip-ok"><Icon name="check" /> Parfait</span>
                      </div>
                    )}
                  </div>
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
              </div>
            </div>
          </>
        );
      }}
    </Loaded>
  );
}
