import { api, html, isAdmin, money, fmtDuration, dayLabel, chip, accountTag } from '../core.js';
import { icon, empty } from '../ui.js';
import { openBookingDialog } from './dialogs.js';

const resItem = (r, { withDay = false } = {}) => html`
  <a class="list-item" href="#/reservations/${r.id}">
    <span class="time">${withDay ? html`${dayLabel(r.biz_day, 'medium')}<br>` : ''}${r.start_time} – ${r.end_time}</span>
    <div class="grow"><div class="title">${r.member_name}</div>
      <div class="meta">${fmtDuration(r.duration_min)}${r.off_hours ? ' · hors horaires' : ''}${r.due_amount ? ` · reste ${money(r.due_amount)}` : ''}</div></div>
    ${chip('res', r.status)}
  </a>`;

function revenueBlock(sum) {
  const max = Math.max(1, ...sum.accounts.map((a) => Math.max(a.net, a.billed)));
  return html`<div class="bars">
    ${sum.accounts.map((a) => html`<div class="bar-row">
      <div class="top"><span>${accountTag(a.account)}</span><span class="amount">${money(a.net)}</span></div>
      <div class="bar-track" aria-hidden="true"><div class="bar-fill ${a.account}" style="width:${Math.max(0, Math.round((a.net / max) * 100))}%"></div></div>
      <div class="subtle">Facturé ${money(a.billed)} · reste à payer ${money(a.outstanding)}${a.refunded ? ` · remboursé ${money(a.refunded)}` : ''}</div>
    </div>`)}
    <div class="bar-row"><div class="top"><strong>Total encaissé net</strong><span class="amount">${money(sum.total.net)}</span></div>
      <div class="subtle">Encaissé ${money(sum.total.collected)} − remboursé ${money(sum.total.refunded)}</div></div>
  </div>`;
}

export async function dashboardView(ctx) {
  const d = await api.get('/api/dashboard');
  const period = ['jour', 'semaine', 'mois'].includes(ctx.query.periode) && isAdmin() ? ctx.query.periode : 'jour';
  const revenue = period === 'semaine' ? d.revenue.week : period === 'mois' ? d.revenue.month : d.cash_today;
  const active = d.today.filter((r) => r.status !== 'annulee');
  const totalMin = active.reduce((sum, r) => sum + r.duration_min, 0);
  const current = d.current[0];
  const next = d.upcoming[0];
  const nextText = next
    ? `Prochaine arrivée : ${next.member_name}, ${next.biz_day === d.biz_day ? '' : `${dayLabel(next.biz_day, 'medium')} `}${next.start_time}`
    : 'Aucune réservation à venir';

  ctx.render(html`
    <div class="page-head">
      <div><h1>Tableau de bord</h1><p class="lead">${dayLabel(d.biz_day, 'title')}</p></div>
      <div class="actions">
        <a class="btn" href="#/agenda">${icon('calendar')} Agenda</a>
        <button class="btn btn-primary" data-act="book">${icon('plus')} Réservation</button>
      </div>
    </div>

    <section class="kpis" aria-label="Situation du club">
      <div class="kpi ${current ? 'accent status-busy' : ''}">
        <div class="label">Salle en ce moment</div>
        <div class="value">${current ? 'Occupée' : 'Libre'}</div>
        <div class="hint">${current ? html`<a href="#/reservations/${current.id}">${current.member_name}</a> jusqu’à ${current.end_time}` : nextText}</div>
      </div>
      <div class="kpi"><div class="label">Réservations du jour</div><div class="value">${active.length}</div>
        <div class="hint">${fmtDuration(totalMin)} de privatisation</div></div>
      <div class="kpi"><div class="label">Encaissé aujourd’hui</div><div class="value">${money(d.cash_today.total.net)}</div>
        <div class="hint">${d.cash_today.methods.map((x) => `${x.method} ${money(x.total)}`).join(' · ') || 'Aucun encaissement'}</div></div>
      <div class="kpi"><div class="label">Reste à encaisser</div><div class="value">${money(d.outstanding_total)}</div>
        <div class="hint"><a href="#/caisse">Voir les lignes ouvertes</a></div></div>
    </section>

    <div class="grid-2">
      <section class="card">
        <div class="card-head"><h2>Réservations du jour</h2><a class="subtle" href="#/agenda?date=${d.biz_day}">Ouvrir l’agenda</a></div>
        ${d.today.length ? html`<div class="list">${d.today.map((r) => resItem(r))}</div>` : empty('Aucune réservation aujourd’hui.', 'calendar')}
      </section>

      <section class="card">
        <div class="card-head"><h2>Recettes par activité</h2>
          ${isAdmin() ? html`<div class="segmented" role="group" aria-label="Période">
            ${[['jour', 'Jour'], ['semaine', '7 jours'], ['mois', 'Mois']].map(([k, label]) => html`<button type="button" data-act="period" data-p="${k}" aria-pressed="${period === k ? 'true' : 'false'}">${label}</button>`)}
          </div>` : html`<span class="subtle">Caisse du jour</span>`}
        </div>
        ${revenueBlock(revenue)}
      </section>

      ${d.to_close.length ? html`<section class="card">
        <div class="card-head"><h2>À clôturer</h2><span class="chip chip-warn">${d.to_close.length}</span></div>
        <p class="subtle" style="margin-bottom:6px">Horaire dépassé : terminez la réservation pour consommer le crédit, ou vérifiez la note.</p>
        <div class="list">${d.to_close.map((r) => resItem(r, { withDay: true }))}</div>
      </section>` : ''}

      <section class="card">
        <div class="card-head"><h2>Prochaines arrivées</h2></div>
        ${d.upcoming.length ? html`<div class="list">${d.upcoming.map((r) => resItem(r, { withDay: true }))}</div>` : empty('Aucune arrivée prévue.', 'clock')}
      </section>

      <section class="card">
        <div class="card-head"><h2>Abonnements à surveiller</h2></div>
        ${d.expiring.length || d.expired.length ? html`<div class="list">
          ${d.expiring.map((x) => html`<a class="list-item" href="#/membres/${x.member_id}"><div class="grow"><div class="title">${x.member_name}</div>
            <div class="meta">${x.plan_name} · fin le ${dayLabel(x.end_date, 'short')}</div></div>
            <span class="chip chip-warn">${x.days_left === 0 ? 'dernier jour' : `${x.days_left} j`}</span></a>`)}
          ${d.expired.map((x) => html`<a class="list-item" href="#/membres/${x.member_id}"><div class="grow"><div class="title">${x.member_name}</div>
            <div class="meta">${x.plan_name} · expirée le ${dayLabel(x.end_date, 'short')}</div></div>
            <span class="chip chip-danger">expirée</span></a>`)}
        </div>` : empty('Aucun abonnement n’arrive à expiration.', 'check')}
      </section>

      <section class="card">
        <div class="card-head"><h2>Alertes de stock</h2><a class="subtle" href="#/produits">Produits</a></div>
        ${d.stock_alerts.length ? html`<div class="list">${d.stock_alerts.map((p) => html`<a class="list-item" href="#/produits">
          <div class="grow"><div class="title">${p.name}</div><div class="meta">${p.category === 'cigare' ? 'Cigare' : 'Bouteille'} · seuil ${p.low_stock_threshold}</div></div>
          <span class="chip ${p.stock_qty === 0 ? 'chip-danger' : 'chip-warn'}">${p.stock_qty === 0 ? 'rupture' : `${p.stock_qty} en stock`}</span></a>`)}</div>`
          : empty('Aucun produit sous le seuil d’alerte.', 'check')}
      </section>
    </div>`, {
    actions: {
      book: () => openBookingDialog({ date: d.biz_day }, (det) => ctx.go(`/reservations/${det.reservation.id}`)),
      period: (el) => ctx.setQuery({ periode: el.dataset.p }),
    },
  });
}
