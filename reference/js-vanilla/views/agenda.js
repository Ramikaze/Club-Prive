import { api, html, raw, state, money, fmtDuration, dayLabel, chip, win, bizToday, parts, relLabel, tz, STATUS } from '../core.js';
import { icon, empty } from '../ui.js';
import { openBookingDialog } from './dialogs.js';
import { addDays, daysBetween, isValidDate, startOfWeek, localToUtcMs, fmtHHMM } from '/shared/time.js';

const DAY_SLOT_H = 34;
const WEEK_SLOT_H = 18;

const relOf = (day, ms) => {
  const p = parts(ms);
  return daysBetween(day, p.date) * 1440 + p.minutes;
};

function slotStartMs(day, rel) {
  return localToUtcMs(rel >= 1440 ? addDays(day, 1) : day, fmtHHMM(rel % 1440), tz());
}

function eventTpl(r, day, slotH, compact) {
  const w = win();
  const slot = state.settings.booking.slot_min;
  const s = relOf(day, r.start_ms);
  const e = relOf(day, r.end_ms);
  const top = ((s - w.open) / slot) * slotH;
  const height = Math.max(((e - s) / slot) * slotH - 2, compact ? 14 : 22);
  const label = `${r.member_name}, ${r.start_time} à ${r.end_time}, ${STATUS.res[r.status][0]}`;
  return html`<a class="ev ${r.status} ${r.off_hours ? 'off-hours' : ''}" href="#/reservations/${r.id}" style="top:${top + 1}px;height:${height}px" aria-label="${label}" title="${label}">
    <span class="ev-title">${r.member_name}</span>
    ${compact ? '' : html`<span class="ev-meta">${r.start_time} – ${r.end_time} · ${STATUS.res[r.status][0]}${r.off_hours ? ' · hors horaires' : ''}${r.due_amount ? ` · reste ${money(r.due_amount)}` : ''}</span>`}
  </a>`;
}

function slotsTpl(day, reservations, { compact = false } = {}) {
  const w = win();
  const { slot_min: slot, min_duration_min: minDur } = state.settings.booking;
  const now = Date.now();
  const busy = reservations.map((r) => [relOf(day, r.start_ms), relOf(day, r.end_ms)]);
  const rows = [];
  for (let rel = w.open; rel < w.maxEnd; rel += slot) {
    const occupied = busy.some(([a, b]) => a <= rel && rel < b);
    const past = slotStartMs(day, rel) + slot * 60000 <= now;
    const canBook = !occupied && !past && rel + minDur <= w.maxEnd;
    const classes = `tl-row ${rel % 60 === 0 ? 'hour' : 'half'} ${rel >= w.close ? 'off' : ''} ${rel === 1440 ? 'midnight' : ''}`;
    const compactClass = compact ? `${rel >= w.close ? 'off' : ''} ${rel % 60 ? 'half' : ''}` : '';
    const button = html`<button type="button" class="tl-slot ${compactClass}" data-act="slot" data-day="${day}" data-time="${relLabel(rel)}"
      ${canBook ? raw(`aria-label="Réserver le ${dayLabel(day, 'medium')} à ${relLabel(rel)}"`) : raw('disabled tabindex="-1"')}>${canBook && !compact ? `+ ${relLabel(rel)}` : ''}</button>`;
    rows.push(compact ? button : html`<div class="${classes}"><div class="tl-label">${rel % 60 === 0 ? relLabel(rel) : ''}</div>${button}</div>`);
  }
  return rows;
}

function nowLine(day, slotH) {
  if (day !== bizToday()) return '';
  const w = win();
  const rel = relOf(day, Date.now());
  if (rel < w.open || rel > w.maxEnd) return '';
  return html`<div class="now-line" style="top:${((rel - w.open) / state.settings.booking.slot_min) * slotH}px" aria-hidden="true"></div>`;
}

function dayView(day, list) {
  const active = list.filter((r) => r.status !== 'annulee');
  const cancelled = list.filter((r) => r.status === 'annulee');
  const s = state.settings;
  return html`
    <section class="card agenda-card">
      <div class="tl" style="--slot-h:${DAY_SLOT_H}px">
        ${slotsTpl(day, active)}
        <div class="tl-events">${active.map((r) => eventTpl(r, day, DAY_SLOT_H, false))}</div>
        ${nowLine(day, DAY_SLOT_H)}
      </div>
      <div class="legend">
        <span><i style="background:var(--info-soft);border-left:3px solid var(--info)"></i> Réservée</span>
        <span><i style="background:var(--ok-soft);border-left:3px solid var(--ok)"></i> En cours</span>
        <span><i style="background:var(--surface-3);border-left:3px solid var(--text-3)"></i> Terminée</span>
        <span><i style="background:var(--off-hours)"></i> Après ${s.hours.close} : autorisation requise (fin max. ${s.hours.max_end})</span>
      </div>
    </section>
    ${cancelled.length ? html`<section class="card section-gap"><div class="card-head"><h2>Annulées ce jour</h2></div>
      <div class="list">${cancelled.map((r) => html`<a class="list-item" href="#/reservations/${r.id}"><span class="time">${r.start_time} – ${r.end_time}</span>
        <div class="grow"><div class="title">${r.member_name}</div><div class="meta">${r.cancel_reason ?? ''}</div></div>${chip('res', r.status)}</a>`)}</div></section>` : ''}`;
}

function weekView(from, list) {
  const days = Array.from({ length: 7 }, (_, i) => addDays(from, i));
  const w = win();
  const slot = state.settings.booking.slot_min;
  const labels = [];
  for (let rel = w.open; rel < w.maxEnd; rel += slot) labels.push(html`<div class="lbl">${rel % 60 === 0 ? relLabel(rel) : ''}</div>`);
  const today = bizToday();
  return html`<section class="card agenda-card"><div class="week-scroll"><div class="week">
    <div class="week-head"></div>
    ${days.map((d) => html`<div class="week-head ${d === today ? 'today' : ''}"><a href="#/agenda?vue=jour&date=${d}">
      <span>${dayLabel(d, 'medium').split(' ')[0]}</span><span class="d">${Number(d.slice(8))}</span></a></div>`)}
    <div class="week-labels">${labels}</div>
    ${days.map((d) => {
      const items = list.filter((r) => r.biz_day === d && r.status !== 'annulee');
      return html`<div class="week-col" style="--slot-h:${WEEK_SLOT_H}px">${slotsTpl(d, items, { compact: true })}
        ${items.map((r) => eventTpl(r, d, WEEK_SLOT_H, true))}${nowLine(d, WEEK_SLOT_H)}</div>`;
    })}
  </div></div></section>`;
}

function listView(list) {
  if (!list.length) return html`<section class="card">${empty('Aucune réservation sur cette période.', 'calendar')}</section>`;
  return html`<section class="card"><div class="table-wrap"><table class="table stack-sm">
    <thead><tr><th>Journée</th><th>Horaire</th><th>Membre</th><th>Durée</th><th>Statut</th><th class="num">Supplément</th><th class="num">Reste dû</th></tr></thead>
    <tbody>${list.map((r) => html`<tr class="${r.status === 'annulee' ? 'is-muted' : ''}">
      <td data-label="Journée">${dayLabel(r.biz_day, 'medium')}</td>
      <td data-label="Horaire" class="nowrap"><a href="#/reservations/${r.id}">${r.start_time} – ${r.end_time}</a>${r.off_hours ? html` <span class="chip chip-bronze">nuit</span>` : ''}</td>
      <td data-label="Membre"><a href="#/membres/${r.member_id}">${r.member_name}</a></td>
      <td data-label="Durée">${fmtDuration(r.duration_min)}</td>
      <td data-label="Statut">${chip('res', r.status)}</td>
      <td data-label="Supplément" class="num">${money(r.supplement_amount)}</td>
      <td data-label="Reste dû" class="num">${r.due_amount ? money(r.due_amount) : '—'}</td>
    </tr>`)}</tbody></table></div></section>`;
}

export async function agendaView(ctx) {
  const view = ['jour', 'semaine', 'liste'].includes(ctx.query.vue) ? ctx.query.vue : 'jour';
  const date = isValidDate(ctx.query.date) ? ctx.query.date : bizToday();
  const status = STATUS.res[ctx.query.statut] ? ctx.query.statut : '';
  let from = date;
  let to = date;
  if (view === 'semaine') {
    from = startOfWeek(date);
    to = addDays(from, 6);
  } else if (view === 'liste') {
    to = addDays(date, 13);
  }
  const list = await api.get(`/api/reservations?from=${from}&to=${to}${view === 'liste' && status ? `&status=${status}` : ''}`);
  const step = view === 'semaine' ? 7 : view === 'liste' ? 14 : 1;
  const periodLabel = view === 'jour'
    ? dayLabel(date, 'title')
    : `Du ${dayLabel(from, 'medium')} au ${dayLabel(to, 'medium')}`;

  ctx.render(html`
    <div class="page-head">
      <div><h1>Agenda</h1><p class="lead">${periodLabel}</p></div>
      <div class="actions"><button class="btn btn-primary" data-act="book">${icon('plus')} Réservation</button></div>
    </div>
    <div class="toolbar">
      <div class="segmented" role="group" aria-label="Vue">
        ${[['jour', 'Jour'], ['semaine', 'Semaine'], ['liste', 'Liste']].map(([k, label]) => html`<button type="button" data-act="view" data-v="${k}" aria-pressed="${view === k ? 'true' : 'false'}">${label}</button>`)}
      </div>
      <div class="date-nav">
        <button class="btn btn-sm" data-act="shift" data-n="${-step}" aria-label="Période précédente">${icon('left')}</button>
        <button class="btn btn-sm" data-act="today">Aujourd’hui</button>
        <button class="btn btn-sm" data-act="shift" data-n="${step}" aria-label="Période suivante">${icon('right')}</button>
        <input type="date" value="${date}" data-change="date" aria-label="Choisir une date" class="btn-sm" style="min-height:36px">
      </div>
      ${view === 'liste' ? html`<select data-change="status" aria-label="Filtrer par statut" style="width:auto;min-height:36px">
        <option value="">Tous les statuts</option>
        ${Object.entries(STATUS.res).map(([k, [label]]) => html`<option value="${k}" ${status === k ? raw('selected') : ''}>${label}</option>`)}
      </select>` : ''}
    </div>
    ${view === 'jour' ? dayView(date, list) : view === 'semaine' ? weekView(from, list) : listView(list)}
    ${view === 'jour' && !list.length ? html`<p class="subtle" style="margin-top:10px">Aucune réservation ce jour : touchez un créneau libre pour en créer une.</p>` : ''}`, {
    actions: {
      book: () => openBookingDialog({ date }, () => ctx.refresh()),
      slot: (el) => openBookingDialog({ date: el.dataset.day, start_time: el.dataset.time }, () => ctx.refresh()),
      view: (el) => ctx.setQuery({ vue: el.dataset.v, date }),
      shift: (el) => ctx.setQuery({ vue: view, date: addDays(date, Number(el.dataset.n)), statut: status }),
      today: () => ctx.setQuery({ vue: view, date: bizToday(), statut: status }),
    },
    changes: {
      date: (el) => { if (isValidDate(el.value)) ctx.setQuery({ vue: view, date: el.value, statut: status }); },
      status: (el) => ctx.setQuery({ vue: view, date, statut: el.value }),
    },
  });
  if (view === 'jour' && date === bizToday()) {
    document.querySelector('.now-line')?.scrollIntoView({ block: 'center', behavior: 'instant' });
  }
}
