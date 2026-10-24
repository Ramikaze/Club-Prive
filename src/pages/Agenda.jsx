import { useEffect, useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { api, qs } from '../lib/api.js';
import { useLoad } from '../lib/hooks.js';
import { money, fmtDuration, dayLabel, win, bizToday, parts, relLabel, tz, STATUS } from '../lib/format.js';
import { useSettings, useRooms } from '../store/useStore.js';
import Icon from '../components/ui/Icon.jsx';
import { Chip, Empty, Loaded, PageHead } from '../components/ui/ui.jsx';
import {
  openBookingDialog,
  openConsumptionDialog,
  openQuickPayReservation,
  quickStartReservation,
  quickFinishReservation,
  quickUpdatePartySize,
} from '../dialogs/index.js';
import { addDays, daysBetween, isValidDate, startOfWeek, localToUtcMs, fmtHHMM } from '../../shared/time.js';

const DAY_SLOT_H = 34;
const WEEK_SLOT_H = 18;
const MAX_RANGE_DAYS = 92; // listReservations (worker/club.js) answers 93 days at most
const VIEWS = [['jour', 'Jour'], ['semaine', 'Semaine'], ['liste', 'Liste']];

const relOf = (day, ms) => {
  const p = parts(ms);
  return daysBetween(day, p.date) * 1440 + p.minutes;
};

function slotStartMs(day, rel) {
  return localToUtcMs(rel >= 1440 ? addDays(day, 1) : day, fmtHHMM(rel % 1440), tz());
}

function Event({ r, day, slotH, compact, settings }) {
  const w = win();
  const slot = settings.booking.slot_min;
  const s = relOf(day, r.start_ms);
  const e = relOf(day, r.end_ms);
  const top = ((s - w.open) / slot) * slotH;
  const height = Math.max(((e - s) / slot) * slotH - 2, compact ? 14 : 22);
  const roomText = r.room_name || 'Salon';
  const label = `${r.member_name} (${roomText}, ${r.party_size || 1} pers.), ${r.start_time} à ${r.end_time}, ${STATUS.res[r.status][0]}`;
  return (
    <Link
      className={`ev ${r.status} ${r.off_hours ? 'off-hours' : ''}`}
      to={`/reservations/${r.id}`}
      style={{ top: `${top + 1}px`, height: `${height}px` }}
      aria-label={label}
      title={label}
    >
      <span className="ev-title">{r.member_name} · {roomText} ({r.party_size || 1} pers.)</span>
      {!compact && (
        <span className="ev-meta">
          {r.start_time} – {r.end_time} · {STATUS.res[r.status][0]}
          {r.items_summary ? ` · ${r.items_summary}` : ''}
          {r.due_amount ? ` · reste ${money(r.due_amount)}` : ''}
        </span>
      )}
    </Link>
  );
}

function slots(day, reservations, { compact = false, now, settings, maxRooms = 1, onSlot }) {
  const w = win();
  const slot = settings.booking.slot_min;
  const busy = reservations.map((r) => [relOf(day, r.start_ms), relOf(day, r.end_ms)]);
  const rows = [];
  // The whole business day, every slot bookable: the club has no opening hours.
  for (let rel = w.open; rel < w.maxEnd; rel += slot) {
    const busyCount = busy.filter(([a, b]) => a <= rel && rel < b).length;
    const occupied = busyCount >= maxRooms;
    const past = slotStartMs(day, rel) + slot * 60000 <= now;
    const canBook = !occupied && !past;
    const classes = `tl-row ${rel % 60 === 0 ? 'hour' : 'half'} ${rel === 1440 ? 'midnight' : ''}`;
    const compactClass = compact && rel % 60 ? 'half' : '';
    const time = relLabel(rel);
    const button = (
      <button
        key={compact ? rel : undefined}
        type="button"
        className={`tl-slot ${compactClass}`}
        onClick={() => onSlot(day, time)}
        {...(canBook ? { 'aria-label': `Réserver le ${dayLabel(day, 'medium')} à ${time}` } : { disabled: true, tabIndex: -1 })}
      >
        {canBook && !compact ? `+ ${time}` : ''}
      </button>
    );
    rows.push(compact ? button : (
      <div key={rel} className={classes}><div className="tl-label">{rel % 60 === 0 ? time : ''}</div>{button}</div>
    ));
  }
  return rows;
}

function NowLine({ day, slotH, now, settings }) {
  if (day !== bizToday()) return null;
  const w = win();
  const rel = relOf(day, now);
  if (rel < w.open || rel > w.maxEnd) return null;
  return <div className="now-line" style={{ top: `${((rel - w.open) / settings.booking.slot_min) * slotH}px` }} aria-hidden="true" />;
}

function DayView({ day, list, now, settings, maxRooms, onSlot }) {
  const active = list.filter((r) => r.status !== 'annulee');
  const cancelled = list.filter((r) => r.status === 'annulee');
  return (
    <>
      <section className="card agenda-card">
        <div className="tl" style={{ '--slot-h': `${DAY_SLOT_H}px` }}>
          {slots(day, active, { now, settings, maxRooms, onSlot })}
          <div className="tl-events">{active.map((r) => <Event key={r.id} r={r} day={day} slotH={DAY_SLOT_H} compact={false} settings={settings} />)}</div>
          <NowLine day={day} slotH={DAY_SLOT_H} now={now} settings={settings} />
        </div>
        <div className="legend">
          <span><i style={{ background: 'var(--info-soft)', borderLeft: '3px solid var(--info)' }} /> Réservée</span>
          <span><i style={{ background: 'var(--ok-soft)', borderLeft: '3px solid var(--ok)' }} /> En cours</span>
          <span><i style={{ background: 'var(--surface-3)', borderLeft: '3px solid var(--text-3)' }} /> Terminée</span>
        </div>
      </section>
      {cancelled.length > 0 && (
        <section className="card section-gap">
          <div className="card-head"><h2>Annulées ce jour</h2></div>
          <div className="list">
            {cancelled.map((r) => (
              <Link key={r.id} className="list-item" to={`/reservations/${r.id}`}>
                <span className="time">{r.start_time} – {r.end_time}</span>
                <div className="grow"><div className="title">{r.member_name} ({r.room_name})</div><div className="meta">{r.cancel_reason ?? ''}</div></div>
                <Chip group="res" value={r.status} />
              </Link>
            ))}
          </div>
        </section>
      )}
    </>
  );
}

function WeekView({ from, list, now, settings, maxRooms, onSlot }) {
  const days = Array.from({ length: 7 }, (_, i) => addDays(from, i));
  const w = win();
  const slot = settings.booking.slot_min;
  const labels = [];
  for (let rel = w.open; rel < w.maxEnd; rel += slot) labels.push(<div key={rel} className="lbl">{rel % 60 === 0 ? relLabel(rel) : ''}</div>);
  const today = bizToday();
  return (
    <section className="card agenda-card">
      <div className="week-scroll">
        <div className="week">
          <div className="week-head" />
          {days.map((d) => (
            <div key={d} className={`week-head ${d === today ? 'today' : ''}`}>
              <Link to={`/agenda?vue=jour&date=${d}`}>
                <span>{dayLabel(d, 'medium').split(' ')[0]}</span><span className="d">{Number(d.slice(8))}</span>
              </Link>
            </div>
          ))}
          <div className="week-labels">{labels}</div>
          {days.map((d) => {
            const items = list.filter((r) => r.biz_day === d && r.status !== 'annulee');
            return (
              <div key={d} className="week-col" style={{ '--slot-h': `${WEEK_SLOT_H}px` }}>
                {slots(d, items, { compact: true, now, settings, maxRooms, onSlot })}
                {items.map((r) => <Event key={r.id} r={r} day={d} slotH={WEEK_SLOT_H} compact settings={settings} />)}
                <NowLine day={d} slotH={WEEK_SLOT_H} now={now} settings={settings} />
              </div>
            );
          })}
        </div>
      </div>
    </section>
  );
}

function ListView({ list, onReload }) {
  if (!list.length) return <section className="card"><Empty icon="calendar">Aucune réservation sur cette période.</Empty></section>;
  return (
    <section className="card">
      <div className="table-wrap">
        <table className="table stack-sm">
          <thead>
            <tr><th>Journée</th><th>Salle</th><th>Horaire</th><th>Membre</th><th>Personnes</th><th>Statut</th><th className="num">Reste dû</th><th><span className="sr-only">Actions</span></th></tr>
          </thead>
          <tbody>
            {list.map((r) => (
              <tr key={r.id} className={r.status === 'annulee' ? 'is-muted' : undefined}>
                <td data-label="Journée">{dayLabel(r.biz_day, 'medium')}</td>
                <td data-label="Salle"><span className="chip">{r.room_name || 'Salon'}</span></td>
                <td data-label="Horaire" className="nowrap">
                  <Link to={`/reservations/${r.id}`}>{r.start_time} – {r.end_time}</Link>
                  {r.off_hours && <>{' '}<span className="chip chip-bronze">nuit</span></>}
                </td>
                <td data-label="Membre">
                  <Link to={`/membres/${r.member_id}`}>{r.member_name}</Link>
                  {r.items_summary ? <div className="subtle" style={{ fontSize: '0.78rem' }}>{r.items_summary}</div> : null}
                </td>
                <td data-label="Personnes">
                  {r.status === 'reservee' || r.status === 'en_cours' ? (
                    <div className="party-stepper party-stepper-inline">
                      <button type="button" className="btn btn-sm btn-ghost" onClick={() => quickUpdatePartySize(r, (r.party_size || 1) - 1, onReload)} disabled={(r.party_size || 1) <= 1}>−</button>
                      <span className="party-badge">{r.party_size || 1} pers.</span>
                      <button type="button" className="btn btn-sm btn-ghost" onClick={() => quickUpdatePartySize(r, (r.party_size || 1) + 1, onReload)}>+</button>
                    </div>
                  ) : `${r.party_size || 1} pers.`}
                </td>
                <td data-label="Statut"><Chip group="res" value={r.status} /></td>
                <td data-label="Reste dû" className="num">{r.due_amount ? money(r.due_amount) : '—'}</td>
                <td className="actions">
                  {r.status === 'reservee' && (
                    <button type="button" className="btn btn-sm btn-primary" onClick={() => quickStartReservation(r, onReload)}>Arrivée</button>
                  )}
                  {(r.status === 'reservee' || r.status === 'en_cours') && (
                    <button type="button" className="btn btn-sm" onClick={() => openConsumptionDialog(r, onReload)}>+ Bouteille / Cigare</button>
                  )}
                  {r.due_amount > 0 && r.status !== 'annulee' && (
                    <button type="button" className="btn btn-sm btn-primary" onClick={() => openQuickPayReservation(r, onReload)}>Encaisser</button>
                  )}
                  {r.status === 'en_cours' && (
                    <button type="button" className="btn btn-sm" onClick={() => quickFinishReservation(r, onReload)}>Terminer</button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

export default function Agenda() {
  const settings = useSettings();
  const rooms = useRooms();
  const activeRooms = rooms.filter((rm) => rm.active);
  const [searchParams, setSearchParams] = useSearchParams();
  const [now, setNow] = useState(() => Date.now());
  const dateInput = useRef(null);
  const toInput = useRef(null);

  const qView = searchParams.get('vue');
  const qDate = searchParams.get('date');
  const qStatus = searchParams.get('statut');
  const qRoom = searchParams.get('salle');
  const qTo = searchParams.get('au');
  const view = ['jour', 'semaine', 'liste'].includes(qView) ? qView : 'jour';
  const date = isValidDate(qDate) ? qDate : bizToday();
  const status = qStatus && STATUS.res[qStatus] ? qStatus : '';
  const roomId = qRoom && activeRooms.some((rm) => String(rm.id) === qRoom) ? qRoom : '';
  let from = date;
  let to = date;
  if (view === 'semaine') {
    from = startOfWeek(date);
    to = addDays(from, 6);
  } else if (view === 'liste') {
    // A range picked with « Du » and « au » (93 days at most, as the server allows), else two weeks.
    to = isValidDate(qTo) && qTo >= date && daysBetween(date, qTo) <= MAX_RANGE_DAYS ? qTo : addDays(date, 13);
  }
  const url = `/api/reservations${qs({ from, to, status: view === 'liste' ? status : '', room_id: roomId })}`;
  const loaded = useLoad(async () => ({ url, list: await api.get(url) }), [url]);
  // Data from a previous period is never drawn on the new one.
  const state = loaded.data && loaded.data.url !== url ? { ...loaded, data: undefined, error: null } : loaded;
  const step = view === 'semaine' ? 7 : view === 'liste' ? daysBetween(from, to) + 1 : 1;
  const periodLabel = view === 'jour'
    ? dayLabel(date, 'title')
    : `Du ${dayLabel(from, 'medium')} au ${dayLabel(to, 'medium')}`;

  const listTo = (shift) => (view === 'liste' ? addDays(to, shift) : '');
  const setQuery = (q) => setSearchParams(Object.fromEntries(Object.entries(q).filter(([, v]) => v !== undefined && v !== null && v !== '')));

  // Refresh the now-line and the past slots every minute.
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 60000);
    return () => clearInterval(timer);
  }, []);

  // Native change events, as in vanilla: a date is applied once picked, not on every keystroke. « Du » keeps the view
  // (the list keeps its length); an « au » after « Du » shows the list of that range, an « au » on « Du » that day.
  useEffect(() => {
    const fromEl = dateInput.current;
    const toEl = toInput.current;
    if (!fromEl || !toEl) return undefined;
    const onFrom = () => {
      if (!isValidDate(fromEl.value)) return;
      const au = view === 'liste' ? addDays(fromEl.value, daysBetween(from, to)) : '';
      setQuery({ vue: view, date: fromEl.value, au, statut: status, salle: roomId });
    };
    const onTo = () => {
      if (!isValidDate(toEl.value)) return;
      const end = toEl.value < from ? from : toEl.value > addDays(from, MAX_RANGE_DAYS) ? addDays(from, MAX_RANGE_DAYS) : toEl.value;
      if (end === from) setQuery({ vue: 'jour', date: from, salle: roomId });
      else setQuery({ vue: 'liste', date: from, au: end, statut: status, salle: roomId });
    };
    fromEl.addEventListener('change', onFrom);
    toEl.addEventListener('change', onTo);
    return () => {
      fromEl.removeEventListener('change', onFrom);
      toEl.removeEventListener('change', onTo);
    };
  });

  const shown = state.data;
  useEffect(() => {
    if (shown && view === 'jour' && date === bizToday()) {
      document.querySelector('.now-line')?.scrollIntoView({ block: 'center', behavior: 'instant' });
    }
  }, [shown]); // eslint-disable-line react-hooks/exhaustive-deps

  const presetRoom = roomId ? Number(roomId) : undefined;
  const maxRooms = roomId ? 1 : Math.max(1, activeRooms.length);
  const book = () => openBookingDialog({ date, room_id: presetRoom }, () => loaded.reload());
  const onSlot = (day, time) => openBookingDialog({ date: day, start_time: time, room_id: presetRoom }, () => loaded.reload());

  return (
    <>
      <PageHead
        title="Agenda"
        lead={periodLabel}
        tour="agenda"
        actions={<button type="button" className="btn btn-primary" onClick={book}><Icon name="plus" /> Réservation</button>}
      />
      <div className="toolbar">
        <div className="segmented" role="group" aria-label="Vue" data-tour="agenda-views">
          {VIEWS.map(([k, label]) => (
            <button key={k} type="button" aria-pressed={view === k} onClick={() => setQuery({ vue: k, date, salle: roomId })}>{label}</button>
          ))}
        </div>
        <div className="segmented" role="group" aria-label="Salle">
          <button type="button" aria-pressed={roomId === ''} onClick={() => setQuery({ vue: view, date, au: listTo(0), statut: status, salle: '' })}>
            Toutes les salles ({activeRooms.length})
          </button>
          {activeRooms.map((rm) => (
            <button
              key={rm.id}
              type="button"
              aria-pressed={roomId === String(rm.id)}
              onClick={() => setQuery({ vue: view, date, au: listTo(0), statut: status, salle: String(rm.id) })}
            >
              {rm.name}
            </button>
          ))}
        </div>
        <div className="date-nav">
          <button type="button" className="btn btn-sm" onClick={() => setQuery({ vue: view, date: addDays(date, -step), au: listTo(-step), statut: status, salle: roomId })} aria-label="Période précédente"><Icon name="left" /></button>
          <button type="button" className="btn btn-sm" onClick={() => setQuery({ vue: view, date: bizToday(), au: view === 'liste' ? addDays(bizToday(), step - 1) : '', statut: status, salle: roomId })}>Aujourd’hui</button>
          <button type="button" className="btn btn-sm" onClick={() => setQuery({ vue: view, date: addDays(date, step), au: listTo(step), statut: status, salle: roomId })} aria-label="Période suivante"><Icon name="right" /></button>
          <label className="date-range-field"><span>Du</span>
            <input key={`du-${from}`} ref={dateInput} type="date" defaultValue={from} aria-label="Premier jour" className="btn-sm" style={{ minHeight: '36px' }} /></label>
          <label className="date-range-field"><span>au</span>
            <input key={`au-${from}-${to}`} ref={toInput} type="date" defaultValue={to} min={from} max={addDays(from, MAX_RANGE_DAYS)} aria-label="Dernier jour" className="btn-sm" style={{ minHeight: '36px' }} /></label>
        </div>
        {view === 'liste' && (
          <select value={status} onChange={(e) => setQuery({ vue: view, date, au: listTo(0), statut: e.target.value, salle: roomId })} aria-label="Filtrer par statut" style={{ width: 'auto', minHeight: '36px' }}>
            <option value="">Tous les statuts</option>
            {Object.entries(STATUS.res).map(([k, [label]]) => <option key={k} value={k}>{label}</option>)}
          </select>
        )}
      </div>
      <Loaded state={state}>
        {({ list }) => (
          <>
            {view === 'jour'
              ? <DayView day={date} list={list} now={now} settings={settings} maxRooms={maxRooms} onSlot={onSlot} />
              : view === 'semaine'
                ? <WeekView from={from} list={list} now={now} settings={settings} maxRooms={maxRooms} onSlot={onSlot} />
                : <ListView list={list} onReload={loaded.reload} />}
            {view === 'jour' && !list.length && (
              <p className="subtle" style={{ marginTop: '10px' }}>Aucune réservation ce jour : touchez un créneau libre pour en créer une.</p>
            )}
          </>
        )}
      </Loaded>
    </>
  );
}

