import { Link, useParams } from 'react-router-dom';
import Icon from '../components/ui/Icon.jsx';
import { Chip, Empty, Loaded, Notice, PageHead, StocksTabs } from '../components/ui/ui.jsx';
import { actionDialog } from '../components/ui/Modal.jsx';
import { api, newKey } from '../lib/api.js';
import { useLoad } from '../lib/hooks.js';
import { dateTime, parts } from '../lib/format.js';
import { useIsAdmin } from '../store/useStore.js';
import { openHumidorForm, openReadingForm } from '../dialogs/loungeDialogs.jsx';

const decimal = (v) => v == null ? '—' : new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 1 }).format(v);

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
  return <Loaded state={state}>{(d) => <>
    <StocksTabs />
    <PageHead title="Cave" lead="Suivi d’humidité et de température des caves du club." tour="lounge"
      actions={<>
        <button type="button" className="btn" onClick={state.reload}><Icon name="reset" /> Actualiser</button>
        {admin && <button type="button" className="btn btn-primary" onClick={() => openHumidorForm(null, state.reload)}><Icon name="plus" /> Nouvelle cave</button>}
      </>} />

    <section className="lounge-overview" aria-label="Situation des caves">
      <div className="lounge-intro"><Icon name="humidor" /><div><h2>Chaque détail compte.</h2><p>Relevés manuels · actualisé à {parts(d.now).time}</p></div></div>
      <dl className="lounge-stats">
        <div><dt>Caves suivies</dt><dd>{d.summary.humidors}</dd></div>
        <div><dt>Caves hors seuils</dt><dd>{d.summary.alerts}<span>/ {d.summary.humidors}</span></dd></div>
        <div><dt>Contrôles à faire</dt><dd>{d.summary.checks_due}</dd></div>
      </dl>
    </section>

    {d.humidors.length ? <div className="humidor-grid">{d.humidors.map((h) => <HumidorCard h={h} reload={state.reload} key={h.id} />)}</div>
      : <section className="card lounge-empty"><Empty icon="humidor"><h2>Une place pour chaque collection.</h2><p>Ajoutez votre première cave et définissez ses seuils pour commencer les contrôles.</p></Empty>
        {admin ? <button type="button" className="btn btn-primary" onClick={() => openHumidorForm(null, state.reload)}>Configurer une cave</button> : <p className="muted">Un administrateur peut créer la première cave.</p>}
      </section>}
    <p className="lounge-note"><Icon name="info" />Les alertes reflètent le dernier relevé saisi et les seuils définis par votre club. Un contrôle en retard ne permet pas de confirmer l’état actuel de la cave.</p>
  </>}</Loaded>;
}

// The chart uses actual timestamps, with the configured band and all raw readings in the table below.
function ReadingChart({ h, field, label, unit }) {
  const rows = h.readings.filter((r) => !r.voided_at).slice(0, 30).reverse();
  if (rows.length < 2) return <div className="chart-placeholder"><Icon name={field === 'humidity' ? 'humidity' : 'temperature'} /><p>Deux relevés valides permettront d’afficher l’évolution {field === 'humidity' ? 'de l’humidité' : 'de la température'}.</p></div>;
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
  const cancel = (reading) => {
    const key = newKey();
    actionDialog({ title: 'Annuler ce relevé', message: `${dateTime(reading.measured_at)} · ${decimal(reading.humidity)} % · ${decimal(reading.temperature)} °C. Le relevé et le motif resteront dans l’historique.`,
      confirmLabel: 'Annuler le relevé', danger: true, reasonLabel: 'Motif de correction',
      run: async ({ reason }) => { await api.post(`/api/humidor-readings/${reading.id}/void`, { reason }, key); state.reload(); },
    });
  };
  return <Loaded state={state}>{(h) => <>
    <PageHead title={h.name} lead={h.location} back={{ to: '/lounge', label: 'Cave' }} actions={<>
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
      <div className="card-head"><div><h2>Journal des contrôles</h2><p className="subtle">Les 60 derniers relevés, annulations comprises.</p></div></div>
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
