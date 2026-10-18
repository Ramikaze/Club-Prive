import { useState } from 'react';
import { Link, useParams, useSearchParams } from 'react-router-dom';
import Icon from '../components/ui/Icon.jsx';
import { Chip, Empty, Loaded, Notice, PageHead, Segmented } from '../components/ui/ui.jsx';
import { actionDialog } from '../components/ui/Modal.jsx';
import { api, newKey } from '../lib/api.js';
import { useLoad, useBusy } from '../lib/hooks.js';
import { dateTime, dayLabel, parts } from '../lib/format.js';
import { useIsAdmin } from '../store/useStore.js';
import { writeWorkbook } from '../utils/exportExcel.js';
import {
  openHumidorForm, openReadingForm, openLockerForm, openAssignmentForm,
  openRenewForm, openDepositForm, openWithdrawForm,
} from '../dialogs/loungeDialogs.jsx';

const decimal = (v) => v == null ? '—' : new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 1 }).format(v);
const normalize = (value) => value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLocaleLowerCase('fr');

function Measurement({ icon, label, value, unit, min, max, stale }) {
  const out = value != null && (value < min || value > max);
  const low = Math.min(min - (max - min), value ?? min);
  const high = Math.max(max + (max - min), value ?? max);
  const pct = (v) => `${((v - low) / (high - low)) * 100}%`;
  return (
    <div className={`measurement ${out ? 'out' : ''} ${stale ? 'stale' : ''}`}>
      <div className="measurement-label"><Icon name={icon} />{label}</div>
      <div className="measurement-value">{decimal(value)}<span>{unit}</span></div>
      <div className="measurement-track" aria-hidden="true">
        <span className="measurement-range" style={{ left: pct(min), width: `${((max - min) / (high - low)) * 100}%` }} />
        {value != null && <i style={{ left: pct(value) }} />}
      </div>
      <p className="subtle">Seuils {decimal(min)}–{decimal(max)} {unit}{out ? ' · hors seuils' : ''}</p>
    </div>
  );
}

function Measurements({ h }) {
  return <div className="measurements">
    <Measurement icon="humidity" label="Humidité relative" value={h.latest?.humidity} unit="%" min={h.humidity_min} max={h.humidity_max} stale={h.stale} />
    <Measurement icon="temperature" label="Température" value={h.latest?.temperature} unit="°C" min={h.temperature_min} max={h.temperature_max} stale={h.stale} />
  </div>;
}

function HumidorCard({ h, reload }) {
  return (
    <article className={`card humidor-card ${h.outside ? 'needs-attention' : ''}`}>
      <div className="card-head"><div><h2><Link to={`/lounge/caves/${h.id}`}>{h.name}</Link></h2><p className="subtle">{h.location || 'Emplacement non précisé'}</p></div><Chip group="humidor" value={h.status} /></div>
      <Measurements h={h} />
      <div className="humidor-foot">
        <p className="subtle"><Icon name="clock" />{h.latest ? `${dateTime(h.latest.measured_at)}${h.stale ? ' · à refaire' : ''}` : 'Premier contrôle à effectuer'}</p>
        <button type="button" className={`btn btn-sm ${h.stale || h.outside ? 'btn-primary' : ''}`} onClick={() => openReadingForm(h, reload)}>Relever</button>
      </div>
    </article>
  );
}

export default function Lounge() {
  const admin = useIsAdmin();
  const state = useLoad(() => api.get('/api/lounge'), [], { refreshMs: 60000 });
  const [params, setParams] = useSearchParams();
  const tab = params.get('vue') === 'casiers' ? 'casiers' : 'caves';
  const [search, setSearch] = useState('');
  const requestedFilter = params.get('statut');
  const filter = ['libre', 'attribues', 'a_renouveler', 'indisponible'].includes(requestedFilter) ? requestedFilter : 'tous';
  const setFilter = (statut) => setParams({ vue: 'casiers', ...(statut !== 'tous' ? { statut } : {}) });
  const [zone, setZone] = useState('');
  return <Loaded state={state}>{(d) => {
    const lockers = d.lockers.filter((l) => (!zone || String(l.humidor_id) === zone)
      && (filter === 'tous' || (filter === 'attribues' ? Boolean(l.assignment_id) : filter === 'a_renouveler' ? ['a_renouveler', 'expire'].includes(l.status) : l.status === filter))
      && normalize(`${l.code} ${l.member_name ?? ''} ${l.member_no ?? ''}`).includes(normalize(search)));
    return <>
      <PageHead title="Cave & casiers" lead="La conservation du club. Les collections de vos membres." tour="lounge"
        actions={<>
          <button type="button" className="btn" onClick={state.reload}><Icon name="reset" /> Actualiser</button>
          {admin && (tab === 'caves'
            ? <button type="button" className="btn btn-primary" onClick={() => openHumidorForm(null, state.reload)}><Icon name="plus" /> Nouvelle cave</button>
            : <button type="button" className="btn btn-primary" disabled={!d.humidors.length} onClick={() => openLockerForm(d.humidors, state.reload)}><Icon name="plus" /> Nouveau casier</button>)}
        </>} />

      <section className="lounge-overview" aria-label="Situation de la cave et des casiers">
        <div className="lounge-intro"><Icon name="humidor" /><div><span className="eyebrow">L’art de recevoir</span><h2>Chaque détail compte.</h2><p>Relevés manuels · actualisé à {parts(d.now).time}</p></div></div>
        <dl className="lounge-stats">
          <div><dt>Caves hors seuils</dt><dd>{d.summary.alerts}<span>/ {d.summary.humidors}</span></dd></div>
          <div><dt>Contrôles à faire</dt><dd>{d.summary.checks_due}</dd></div>
          <div><dt>Casiers attribués</dt><dd>{d.summary.occupied}<span>/ {d.summary.lockers}</span></dd></div>
          <div><dt>Cigares en garde</dt><dd>{d.summary.cigars}</dd></div>
        </dl>
      </section>

      <div className="lounge-tabs"><Segmented value={tab} label="Vue du lounge" options={[
        ['caves', `Caves (${d.humidors.length})`], ['casiers', `Casiers privés (${d.lockers.length})`],
      ]} onChange={(vue) => setParams({ vue })} />
        <span className="subtle">{tab === 'caves' ? 'Contrôles & conservation' : `${d.summary.available} disponible(s) · ${d.summary.expiring} à renouveler`}</span>
      </div>

      {tab === 'caves' ? <>
        {d.humidors.length ? <div className="humidor-grid">{d.humidors.map((h) => <HumidorCard h={h} reload={state.reload} key={h.id} />)}</div>
          : <section className="card lounge-empty"><Empty icon="humidor"><h2>Une place pour chaque collection.</h2><p>Ajoutez votre première cave et définissez ses seuils pour commencer les contrôles.</p></Empty>
            {admin ? <button type="button" className="btn btn-primary" onClick={() => openHumidorForm(null, state.reload)}>Configurer une cave</button> : <p className="muted">Un administrateur peut créer la première cave.</p>}
          </section>}
        <p className="lounge-note"><Icon name="info" />Les alertes reflètent le dernier relevé saisi et les seuils définis par votre club. Un contrôle en retard ne permet pas de confirmer l’état actuel de la cave.</p>
      </> : <>
        <div className="toolbar locker-toolbar">
          <label className="lounge-search"><Icon name="search" /><span className="sr-only">Rechercher un casier ou un membre</span><input type="search" placeholder="Casier, nom ou numéro de membre…" value={search} onChange={(e) => setSearch(e.target.value)} /></label>
          <label><span className="sr-only">Filtrer par statut</span><select value={filter} onChange={(e) => setFilter(e.target.value)}>
            <option value="tous">Tous les statuts</option><option value="libre">Disponibles</option><option value="attribues">Attribués</option><option value="a_renouveler">À renouveler ou échus</option><option value="indisponible">Hors service</option>
          </select></label>
          <label><span className="sr-only">Filtrer par cave</span><select value={zone} onChange={(e) => setZone(e.target.value)}>
            <option value="">Toutes les caves</option>{d.humidors.map((h) => <option key={h.id} value={h.id}>{h.name}</option>)}
          </select></label>
        </div>
        {lockers.length ? <div className="locker-grid">{lockers.map((l) => (
          <Link className={`locker-tile ${l.status}`} to={`/lounge/casiers/${l.id}`} key={l.id}>
            <div className="locker-top"><span className="locker-code">{l.code}</span><Icon name={l.assignment_id ? 'lock' : 'unlock'} /></div>
            <Chip group="locker" value={l.status} />
            <div className="locker-person"><strong>{l.member_name || (l.active ? 'Prêt à accueillir un membre' : 'Indisponible pour attribution')}</strong><span>{l.humidor_name}</span></div>
            <div className="locker-bottom"><span>{l.assignment_id ? `${l.cigar_count} cigare(s) · ${dayLabel(l.end_date, 'short')}` : 'Consulter le casier'}</span><Icon name="right" /></div>
          </Link>
        ))}</div> : <section className="card lounge-empty"><Empty icon="lock"><h2>{d.lockers.length ? 'Aucun casier ne correspond.' : 'Les collections ont leur place.'}</h2><p>{d.lockers.length ? 'Essayez un autre nom ou réinitialisez les filtres.' : d.humidors.length ? 'Créez un casier pour le mettre à disposition d’un membre.' : 'Créez d’abord une cave pour y installer vos casiers.'}</p></Empty>
          {d.lockers.length > 0 && <button type="button" className="btn" onClick={() => { setSearch(''); setFilter('tous'); setZone(''); }}>Réinitialiser les filtres</button>}
        </section>}
        <p className="lounge-note"><Icon name="info" />Les collections personnelles sont suivies séparément du stock de vente du club. Une échéance dépassée conserve l’attribution jusqu’à la restitution des cigares.</p>
      </>}
    </>;
  }}</Loaded>;
}

// The chart uses actual timestamps, with the configured band and all raw readings in the table below.
function ReadingChart({ h, field, label, unit }) {
  const rows = h.readings.filter((r) => !r.voided_at).slice(0, 30).reverse();
  if (rows.length < 2) return <div className="chart-placeholder"><Icon name={field === 'humidity' ? 'humidity' : 'temperature'} /><p>Deux relevés valides permettront d’afficher l’évolution de {label.toLowerCase()}.</p></div>;
  const minimum = h[`${field}_min`], maximum = h[`${field}_max`];
  const lo = Math.min(minimum, ...rows.map((r) => r[field])) - 2;
  const hi = Math.max(maximum, ...rows.map((r) => r[field])) + 2;
  const first = Date.parse(rows[0].measured_at), last = Date.parse(rows.at(-1).measured_at);
  const x = (r, i) => 40 + (last > first ? (Date.parse(r.measured_at) - first) / (last - first) : i / (rows.length - 1)) * 480;
  const y = (n) => 140 - ((n - lo) / (hi - lo)) * 112;
  return <figure className="reading-chart">
    <figcaption>{label} <span className="subtle">{unit} · {rows.length} derniers relevés valides</span></figcaption>
    <svg viewBox="0 0 560 175" role="img" aria-label={`${label} : de ${decimal(rows[0][field])} à ${decimal(rows.at(-1)[field])} ${unit}. Zone cible de ${decimal(minimum)} à ${decimal(maximum)}. Détails dans le tableau des relevés.`}>
      <rect x="40" y={y(maximum)} width="480" height={y(minimum) - y(maximum)} fill="var(--ok-soft)" />
      {[minimum, maximum].map((n) => <g key={n}><line x1="40" x2="520" y1={y(n)} y2={y(n)} stroke="var(--border-strong)" strokeDasharray="4 4" /><text x="32" y={y(n) + 4} textAnchor="end">{decimal(n)}</text></g>)}
      <polyline points={rows.map((r, i) => `${x(r, i)},${y(r[field])}`).join(' ')} fill="none" stroke="var(--bronze-text)" strokeWidth="2.5" strokeLinejoin="round" />
      {rows.map((r, i) => <circle key={r.id} cx={x(r, i)} cy={y(r[field])} r="3.5" fill={r[field] < minimum || r[field] > maximum ? 'var(--danger)' : 'var(--bronze-text)'}><title>{dateTime(r.measured_at)} · {decimal(r[field])} {unit}</title></circle>)}
      <text x="40" y="165">{dateTime(rows[0].measured_at)}</text><text x="520" y="165" textAnchor="end">{dateTime(rows.at(-1).measured_at)}</text>
    </svg>
  </figure>;
}

export function HumidorPage() {
  const { id } = useParams();
  const admin = useIsAdmin();
  const state = useLoad(() => api.get(`/api/humidors/${id}`), [id], { refreshMs: 60000 });
  const { busy, run } = useBusy();
  const cancel = (reading) => {
    const key = newKey();
    actionDialog({ title: 'Annuler ce relevé', message: `${dateTime(reading.measured_at)} · ${decimal(reading.humidity)} % · ${decimal(reading.temperature)} °C. Le relevé et le motif resteront dans l’historique.`,
      confirmLabel: 'Annuler le relevé', danger: true, reasonLabel: 'Motif de correction',
      run: async ({ reason }) => { await api.post(`/api/humidor-readings/${reading.id}/void`, { reason }, key); state.reload(); },
    });
  };
  return <Loaded state={state}>{(h) => <>
    <PageHead title={h.name} lead={h.location} back={{ to: '/lounge', label: 'Cave & casiers' }} actions={<>
      {admin && <button type="button" className="btn" onClick={() => openHumidorForm(h, state.reload)}><Icon name="settings" /> Configurer</button>}
      <button type="button" className="btn btn-primary" onClick={() => openReadingForm(h, state.reload)}><Icon name="plus" /> Nouveau relevé</button>
    </>} />
    <section className="card humidor-detail">
      <div className="card-head"><h2>Dernier contrôle</h2><Chip group="humidor" value={h.status} /></div>
      <Measurements h={h} />
      <p className="subtle">{h.latest ? `${dateTime(h.latest.measured_at)} · ${h.latest.created_by_name}` : 'Aucun relevé valide'} · contrôle toutes les {h.reading_interval_hours} h</p>
      {h.latest?.notes && <p className="lounge-observation">{h.latest.notes}</p>}
      {h.stale && <div className="section-gap"><Notice kind="warn">{h.latest ? 'Le dernier contrôle est trop ancien. Effectuez un nouveau relevé.' : 'Effectuez un premier relevé pour connaître les conditions de conservation.'}</Notice></div>}
      {h.notes && <p className="lounge-note">Consignes : {h.notes}</p>}
    </section>
    <section className="card section-gap">
      <div className="card-head"><h2>Évolution de la conservation</h2><span className="subtle">Zone ombrée : seuils actuels</span></div>
      <div className="reading-charts"><ReadingChart h={h} field="humidity" label="Humidité" unit="% HR" /><ReadingChart h={h} field="temperature" label="Température" unit="°C" /></div>
    </section>
    <section className="card section-gap">
      <div className="card-head"><div><h2>Journal des contrôles</h2><p className="subtle">Les 60 derniers relevés, annulations comprises.</p></div>
        <button type="button" className="btn btn-sm" disabled={busy || !h.readings.length} onClick={() => run(() => writeWorkbook([{
          sheet: 'Relevés', header: ['Date', 'Cave', 'Humidité (%)', 'Température (°C)', 'Observation', 'Par', 'Annulé le', 'Motif'],
          rows: h.readings.map((r) => [dateTime(r.measured_at), h.name, r.humidity, r.temperature, r.notes ?? '', r.created_by_name, r.voided_at ? dateTime(r.voided_at) : '', r.void_reason ?? '']),
        }], `cave-${h.id}-releves.xlsx`))}><Icon name="download" /> Exporter</button>
      </div>
      {h.readings.length ? <div className="table-wrap"><table className="table stack-sm"><thead><tr><th>Date & opérateur</th><th>Humidité</th><th>Température</th><th>Observation</th>{admin && <th><span className="sr-only">Actions</span></th>}</tr></thead>
        <tbody>{h.readings.map((r) => <tr key={r.id} className={r.voided_at ? 'is-muted' : ''}>
          <td data-label="Date"><strong>{dateTime(r.measured_at)}</strong><div className="subtle">{r.created_by_name}</div></td>
          <td data-label="Humidité" className="num">{decimal(r.humidity)} %</td><td data-label="Température" className="num">{decimal(r.temperature)} °C</td>
          <td data-label="Observation">{r.notes || '—'}{r.voided_at && <div className="subtle">Annulé le {dateTime(r.voided_at)} par {r.voided_by_name} · {r.void_reason}</div>}</td>
          {admin && <td>{!r.voided_at && <button type="button" className="btn btn-sm btn-ghost" aria-label={`Annuler le relevé du ${dateTime(r.measured_at)}`} onClick={() => cancel(r)}>Annuler</button>}</td>}
        </tr>)}</tbody></table></div> : <Empty icon="list">Votre premier relevé apparaîtra ici.</Empty>}
    </section>
  </>}</Loaded>;
}

export function LockerPage() {
  const { id } = useParams();
  const admin = useIsAdmin();
  const state = useLoad(() => api.get(`/api/lockers/${id}`), [id], { refreshMs: 60000 });
  const { busy, run } = useBusy();
  const release = (l) => {
    const key = newKey();
    actionDialog({ title: `Libérer le casier ${l.code}`, message: `Mettre fin à l’attribution de ${l.member_name}. Le casier doit être vide et l’historique sera conservé.`,
      danger: true, reasonLabel: 'Motif de fin d’attribution', confirmLabel: 'Libérer le casier',
      run: async ({ reason }) => { await api.post(`/api/locker-assignments/${l.assignment_id}/release`, { reason }, key); state.reload(); },
    });
  };
  const availability = (l) => {
    const key = newKey();
    actionDialog({ title: l.active ? 'Mettre le casier hors service' : 'Remettre le casier en service', message: `Casier ${l.code}.`, reasonLabel: 'Motif',
      run: async ({ reason }) => { await api.put(`/api/lockers/${l.id}/availability`, { active: !l.active, reason }, key); state.reload(); },
    });
  };
  return <Loaded state={state}>{(l) => {
    const today = parts(Date.now()).date;
    return <>
      <PageHead title={`Casier ${l.code}`} lead={<>{l.humidor_name} <Chip group="locker" value={l.status} /></>}
        back={{ to: '/lounge?vue=casiers', label: 'Casiers privés' }} actions={<>
          <button type="button" className="btn" onClick={state.reload}><Icon name="reset" /> Actualiser</button>
          {l.assignment_id ? <button type="button" className="btn btn-primary" disabled={l.status === 'expire'} onClick={() => openDepositForm(l, state.reload)}><Icon name="deposit" /> Déposer des cigares</button>
            : l.active ? <button type="button" className="btn btn-primary" onClick={() => openAssignmentForm(l, today, state.reload)}><Icon name="user-plus" /> Attribuer à un membre</button> : null}
        </>} />
      {l.status === 'expire' && <div className="section-gap"><Notice kind="warn">Attribution échue le {dayLabel(l.end_date, 'short')}. Renouvelez le casier pour accepter de nouveaux dépôts. Les retraits restent possibles.</Notice></div>}
      <div className="locker-detail-layout section-gap">
        <section className="card">
          <div className="card-head"><h2>Collection personnelle</h2><span className="chip">{l.cigar_count} cigare(s)</span></div>
          {l.items.some((i) => i.quantity > 0) ? <div className="list">{l.items.filter((i) => i.quantity > 0).map((i) => <div className="list-item" key={i.id}>
            <div className="grow"><div className="title">{i.name}</div><div className="meta">{i.quantity} cigare(s) en garde</div></div>
            <button type="button" className="btn btn-sm" onClick={() => openWithdrawForm(i, l, state.reload)}><Icon name="withdraw" /> Retirer</button>
          </div>)}</div> : <Empty icon="humidor">{l.assignment_id ? 'Le casier est vide. Enregistrez le premier dépôt du membre.' : 'Ce casier ne contient aucun cigare.'}</Empty>}
          <p className="lounge-note">Inventaire personnel du membre, indépendant des ventes du club.</p>
        </section>
        <aside className="card locker-owner">
          <div className="card-head"><h2>Attribution</h2><Icon name="key" /></div>
          {l.assignment_id ? <>
            <Link className="owner-name" to={`/membres/${l.member_id}`}>{l.member_name}</Link><p className="subtle">{l.member_no}</p>
            <dl className="kv"><dt>Depuis le</dt><dd>{dayLabel(l.start_date, 'short')}</dd><dt>Jusqu’au</dt><dd>{dayLabel(l.end_date, 'short')}</dd></dl>
            {l.assignment_notes && <p className="muted">{l.assignment_notes}</p>}
            <div className="row"><button type="button" className="btn btn-sm" onClick={() => openRenewForm(l, today, state.reload)}>Renouveler</button>
              <button type="button" className="btn btn-sm btn-ghost" disabled={l.cigar_count > 0} onClick={() => release(l)}>Libérer</button></div>
            {l.cigar_count > 0 && <p className="subtle">Restituez tous les cigares pour libérer le casier.</p>}
          </> : <p className="muted">Aucun membre attribué.</p>}
          {l.notes && <p className="subtle">{l.notes}</p>}
          {admin && !l.assignment_id && <button type="button" className="btn btn-sm" onClick={() => availability(l)}>{l.active ? 'Mettre hors service' : 'Remettre en service'}</button>}
        </aside>
      </div>
      <section className="card section-gap">
        <div className="card-head"><div><h2>Journal des dépôts & retraits</h2><p className="subtle">100 derniers mouvements · toutes les attributions</p></div>
          <button type="button" className="btn btn-sm" disabled={busy || !l.movements.length} onClick={() => run(() => writeWorkbook([{
            sheet: 'Mouvements', header: ['Date', 'Casier', 'Membre', 'Cigares', 'Mouvement', 'Quantité', 'Restant', 'Observation', 'Par'],
            rows: l.movements.map((m) => [dateTime(m.created_at), l.code, m.member_name, m.item_name, m.kind === 'depot' ? 'Dépôt' : 'Retrait', m.quantity, m.stock_after, m.notes ?? '', m.created_by_name]),
          }], `casier-${l.id}-mouvements.xlsx`))}><Icon name="download" /> Exporter</button>
        </div>
        {l.movements.length ? <div className="table-wrap"><table className="table stack-sm"><thead><tr><th>Date & opérateur</th><th>Cigares & membre</th><th>Mouvement</th><th className="num">Restant</th><th>Observation</th></tr></thead><tbody>
          {l.movements.map((m) => <tr key={m.id}><td data-label="Date">{dateTime(m.created_at)}<div className="subtle">{m.created_by_name}</div></td>
            <td data-label="Cigares"><strong>{m.item_name}</strong><div className="subtle">{m.member_name}</div></td>
            <td data-label="Mouvement"><span className={`chip chip-${m.kind === 'depot' ? 'ok' : 'neutral'}`}>{m.kind === 'depot' ? '+' : '−'}{m.quantity} · {m.kind === 'depot' ? 'Dépôt' : 'Retrait'}</span></td>
            <td data-label="Restant" className="num">{m.stock_after}</td><td data-label="Observation">{m.notes || '—'}</td></tr>)}
        </tbody></table></div> : <Empty icon="list">Les dépôts et retraits seront consignés ici.</Empty>}
      </section>
      <section className="card section-gap"><div className="card-head"><h2>Historique des attributions</h2><span className="subtle">30 dernières attributions</span></div>
        {l.assignments.length ? <div className="list">{l.assignments.map((a) => <div className="list-item" key={a.id}><div className="grow">
          <div className="title"><Link to={`/membres/${a.member_id}`}>{a.member_name}</Link></div><div className="meta">Du {dayLabel(a.start_date, 'short')} au {dayLabel(a.end_date, 'short')} · attribué par {a.created_by_name}</div>
          {a.released_at && <p className="subtle">Libéré le {dateTime(a.released_at)} · {a.release_reason}</p>}
        </div><span className={`chip ${a.released_at ? '' : 'chip-info'}`}>{a.released_at ? 'Terminée' : 'En cours'}</span></div>)}</div> : <Empty icon="users">Aucune attribution pour le moment.</Empty>}
      </section>
    </>;
  }}</Loaded>;
}
