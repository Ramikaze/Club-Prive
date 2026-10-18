import {
  api, html, isAdmin, money, fmtDuration, dayLabel, dateTime, chip, accountTag, demoChip, subStateLabel, newKey,
} from '../core.js';
import { icon, empty, setHTML, actionDialog, toast } from '../ui.js';
import {
  openBookingDialog, openMemberDialog, openSubscriptionDialog, openCardDialog, openAdjustCreditDialog, openPaymentDialog,
} from './dialogs.js';

const debounce = (fn, ms) => {
  let t;
  return (...args) => {
    clearTimeout(t);
    t = setTimeout(() => fn(...args), ms);
  };
};

const creditCell = (sub) => (sub?.credit ? fmtDuration(sub.credit.available) : '—');

function membersTable(items) {
  if (!items.length) return html`<section class="card">${empty('Aucun membre ne correspond à la recherche.', 'users')}</section>`;
  return html`<section class="card"><div class="table-wrap"><table class="table stack-sm">
    <thead><tr><th>Membre</th><th>Téléphone</th><th>Formule</th><th>État</th><th class="num">Crédit disponible</th></tr></thead>
    <tbody>${items.map((m) => html`<tr>
      <td data-label="Membre"><a href="#/membres/${m.id}"><strong>${m.name}</strong></a> <span class="subtle">${m.member_no}</span> ${demoChip(m.is_demo)}</td>
      <td data-label="Téléphone" class="nowrap">${m.phone}</td>
      <td data-label="Formule">${subStateLabel(m.subscription)}</td>
      <td data-label="État">${chip('sub', m.subscription.state)}</td>
      <td data-label="Crédit disponible" class="num">${creditCell(m.subscription)}</td></tr>`)}</tbody>
  </table></div></section>`;
}

export async function membersView(ctx) {
  const q = ctx.query.q ?? '';
  const list = await api.get(`/api/members${q ? `?q=${encodeURIComponent(q)}` : ''}`);
  let seq = 0;
  ctx.render(html`
    <div class="page-head">
      <div><h1>Membres et cartes</h1><p class="lead">${list.length} membre(s)${q ? ' trouvé(s)' : ''}. La carte de membre est nécessaire pour accéder au club.</p></div>
      <div class="actions"><button class="btn btn-primary" data-act="new">${icon('plus')} Nouveau membre</button></div>
    </div>
    <form class="toolbar" data-form="search" role="search">
      <div class="search" style="flex:1;min-width:220px">${icon('search')}
        <input type="search" name="q" value="${q}" data-input="q" placeholder="Nom, téléphone, n° de membre ou de carte" aria-label="Rechercher un membre" autocomplete="off"></div>
    </form>
    <div id="member-results">${membersTable(list)}</div>`, {
    actions: { new: () => openMemberDialog(null, (m) => ctx.go(`/membres/${m.id}`)) },
    forms: { search: () => {} },
    inputs: {
      q: debounce(async (el) => {
        const v = el.value.trim();
        history.replaceState(null, '', `#/membres${v ? `?q=${encodeURIComponent(v)}` : ''}`);
        const n = (seq += 1);
        try {
          const items = await api.get(`/api/members${v ? `?q=${encodeURIComponent(v)}` : ''}`);
          if (n === seq && ctx.isCurrent()) setHTML(ctx.main.querySelector('#member-results'), membersTable(items));
        } catch (e) {
          toast(e.message, 'error');
        }
      }, 220),
    },
  });
}

function creditBlock(credit) {
  const total = Math.max(credit.granted, credit.committed + credit.consumed + credit.available, 1);
  const pct = (v) => `${Math.round((v / total) * 1000) / 10}%`;
  return html`
    <div class="gauge" role="img" aria-label="Crédit : ${fmtDuration(credit.consumed)} consommées, ${fmtDuration(credit.committed)} engagées, ${fmtDuration(credit.available)} disponibles">
      <span class="g-consumed" style="width:${pct(credit.consumed)}"></span>
      <span class="g-committed" style="width:${pct(credit.committed)}"></span>
      <span class="g-available" style="width:${pct(credit.available)}"></span>
    </div>
    <div class="credit-legend">
      <div><span class="k">Attribuées</span><span class="v">${fmtDuration(credit.granted)}</span></div>
      <div><span class="k">Engagées</span><span class="v">${fmtDuration(credit.committed)}</span></div>
      <div><span class="k">Consommées</span><span class="v">${fmtDuration(credit.consumed)}</span></div>
      <div><span class="k">Disponibles</span><span class="v">${fmtDuration(credit.available)}</span></div>
    </div>
    ${credit.adjustments ? html`<p class="subtle" style="margin-top:6px">Dont ajustements manuels : ${credit.adjustments > 0 ? '+' : '−'}${fmtDuration(Math.abs(credit.adjustments))}</p>` : ''}
    ${credit.allocation_mode === 'mensuelle' ? html`<p class="subtle" style="margin-top:6px">Attribution mensuelle : ${fmtDuration(credit.allocated)} attribuées à ce jour sur ${fmtDuration(credit.included)}.</p>` : ''}`;
}

export async function memberView(ctx) {
  const m = await api.get(`/api/members/${ctx.params[0]}`);
  const summary = m.subscription;
  const current = m.subscriptions.find((s) => s.id === summary.id && ['active', 'expire_bientot'].includes(summary.state));
  const canBook = Boolean(current) || summary.state === 'a_venir';
  const due = m.charges.filter((c) => c.status === 'due');
  const dueTotal = due.reduce((sum, c) => sum + c.amount, 0);
  const reload = () => ctx.refresh();
  const memberForDialogs = { ...m };

  ctx.render(html`
    <a class="back" href="#/membres">${icon('left')} Membres</a>
    <div class="page-head">
      <div><h1>${m.name}</h1><p class="lead">${m.member_no} ${chip('sub', summary.state)} ${demoChip(m.is_demo)}</p></div>
      <div class="actions">
        <button class="btn" data-act="edit">${icon('edit')} Modifier</button>
        ${canBook ? html`<button class="btn btn-primary" data-act="book">${icon('plus')} Réservation</button>` : ''}
      </div>
    </div>

    <div class="grid-2">
      <section class="card">
        <div class="card-head"><h2>Abonnement</h2>
          <button class="btn btn-sm ${current ? '' : 'btn-primary'}" data-act="subscribe">${summary.state === 'aucun' ? 'Activer une formule' : 'Renouveler'}</button></div>
        ${current ? html`
          <p><strong>${current.plan_name}</strong> · du ${dayLabel(current.start_date, 'short')} au ${dayLabel(current.end_date, 'short')}
            ${summary.state === 'expire_bientot' ? html`<span class="chip chip-warn">${summary.days_left === 0 ? 'dernier jour' : `encore ${summary.days_left} j`}</span>` : ''}</p>
          ${creditBlock(current.credit)}
          ${isAdmin() ? html`<div class="row" style="margin-top:12px">
            <button class="btn btn-sm" data-act="adjust">Ajuster le crédit</button>
            <button class="btn btn-sm btn-danger" data-act="cancel-sub">Annuler l’abonnement</button></div>` : ''}`
          : html`<div class="notice ${summary.state === 'expiree' ? 'notice-danger' : 'notice-info'}">${icon(summary.state === 'expiree' ? 'alert' : 'info')}
            <span>${summary.state === 'expiree'
              ? `Formule expirée le ${dayLabel(summary.end_date, 'short')} : les réservations sont refusées jusqu’au renouvellement.`
              : summary.state === 'a_venir' ? `Formule ${summary.plan_name} à partir du ${dayLabel(summary.start_date, 'short')}.` : 'Aucune formule : activez une formule pour permettre les réservations.'}</span></div>`}
        <p class="subtle" style="margin-top:10px">Report des heures non utilisées, suspension et renouvellement automatique : règles à confirmer (non gérés en version 1).</p>
      </section>

      <section class="card">
        <div class="card-head"><h2>Cartes</h2><button class="btn btn-sm" data-act="card">${icon('card')} Émettre une carte</button></div>
        ${m.cards.length ? html`<div class="list">${m.cards.map((c) => html`<div class="list-item">
          <div class="grow"><div class="title"><span class="mono">${c.code}</span></div>
            <div class="meta">Carte ${c.kind} · émise le ${dateTime(c.issued_at)}${c.deactivation_reason ? ` · ${c.deactivation_reason}` : ''}</div></div>
          ${c.status === 'active' ? html`<span class="chip chip-ok">active</span>` : html`<span class="chip">désactivée</span>`}
          <a class="btn btn-sm btn-ghost" href="#/cartes/${c.id}">${icon('printer')}<span class="sr-only">Afficher ou imprimer la carte ${c.code}</span></a>
          ${c.status === 'active' ? html`<button class="btn btn-sm btn-ghost" data-act="deactivate" data-id="${c.id}">Désactiver</button>` : ''}
        </div>`)}</div>` : empty('Aucune carte émise.', 'card')}
        <p class="subtle" style="margin-top:8px">Carte physique ou virtuelle : même membre, même abonnement, aucun crédit supplémentaire.</p>
      </section>

      <section class="card">
        <div class="card-head"><h2>Coordonnées</h2></div>
        <dl class="kv">
          <dt>Téléphone</dt><dd>${m.phone}</dd>
          <dt>Courriel</dt><dd>${m.email ?? '—'}</dd>
          <dt>Notes</dt><dd>${m.notes ?? '—'}</dd>
          <dt>Membre depuis</dt><dd>${dateTime(m.created_at)}</dd>
        </dl>
      </section>

      <section class="card">
        <div class="card-head"><h2>À encaisser</h2>${due.length ? html`<button class="btn btn-sm btn-primary" data-act="pay">Encaisser ${money(dueTotal)}</button>` : ''}</div>
        ${due.length ? html`<div class="list">${due.map((c) => html`<div class="list-item">
          <div class="grow"><div class="title">${c.label}${c.quantity > 1 ? ` × ${c.quantity}` : ''}</div><div class="meta">${accountTag(c.account)}${c.reservation_id ? html` · <a href="#/reservations/${c.reservation_id}">réservation n° ${c.reservation_id}</a>` : ''}</div></div>
          <span class="num">${money(c.amount)}</span></div>`)}</div>` : empty('Rien à encaisser.', 'check')}
      </section>

      <section class="card span-2">
        <div class="card-head"><h2>Réservations</h2></div>
        ${m.reservations.length ? html`<div class="table-wrap"><table class="table stack-sm">
          <thead><tr><th>Journée</th><th>Horaire</th><th>Durée</th><th>Incluses</th><th class="num">Supplément</th><th>Statut</th></tr></thead>
          <tbody>${m.reservations.map((r) => html`<tr class="${r.status === 'annulee' ? 'is-muted' : ''}">
            <td data-label="Journée"><a href="#/reservations/${r.id}">${dayLabel(r.biz_day, 'medium')}</a></td>
            <td data-label="Horaire" class="nowrap">${r.start_time} – ${r.end_time}</td>
            <td data-label="Durée">${fmtDuration(r.duration_min)}</td>
            <td data-label="Incluses">${fmtDuration(r.included_minutes)}</td>
            <td data-label="Supplément" class="num">${money(r.supplement_amount)}</td>
            <td data-label="Statut">${chip('res', r.status)}</td></tr>`)}</tbody></table></div>` : empty('Aucune réservation.', 'calendar')}
      </section>

      <section class="card">
        <div class="card-head"><h2>Historique des formules</h2></div>
        ${m.subscriptions.length ? html`<div class="list">${m.subscriptions.map((s) => html`<div class="list-item">
          <div class="grow"><div class="title">${s.plan_name}</div>
            <div class="meta">${dayLabel(s.start_date, 'short')} → ${dayLabel(s.end_date, 'short')} · ${s.price == null ? 'prix non défini' : money(s.price)}${s.price != null && !s.price_validated ? ' (tarif à confirmer)' : ''}
              · ${fmtDuration(s.credit.consumed)} consommées sur ${fmtDuration(s.credit.granted)}${s.cancel_reason ? ` · annulée : ${s.cancel_reason}` : ''}</div></div>
          ${chip('sub', s.state)}</div>`)}</div>` : empty('Aucune formule.', 'info')}
      </section>

      <section class="card">
        <div class="card-head"><h2>Paiements</h2></div>
        ${m.payments.length ? html`<div class="list">${m.payments.map((p) => html`<div class="list-item">
          <div class="grow"><div class="title">${money(p.amount)} — ${p.method}</div>
            <div class="meta">${dateTime(p.paid_at)}${p.reservation_id ? html` · <a href="#/reservations/${p.reservation_id}">réservation n° ${p.reservation_id}</a>` : ' · abonnement'}</div></div>
          <span class="chip chip-ok">n° ${p.id}</span></div>`)}</div>` : empty('Aucun paiement.', 'wallet')}
      </section>
    </div>`, {
    actions: {
      edit: () => openMemberDialog(m, reload),
      book: () => openBookingDialog({ member: { id: m.id, name: m.name, member_no: m.member_no, subscription: summary }, lockMember: true },
        (det) => ctx.go(`/reservations/${det.reservation.id}`)),
      subscribe: () => openSubscriptionDialog(memberForDialogs, reload),
      card: () => openCardDialog(memberForDialogs, reload),
      adjust: () => openAdjustCreditDialog(m, current, reload),
      pay: () => openPaymentDialog({ lines: due, memberName: m.name }, reload),
      'cancel-sub': () => {
        const key = newKey();
        actionDialog({
          title: 'Annuler l’abonnement',
          message: `${current.plan_name} (${dayLabel(current.start_date, 'short')} → ${dayLabel(current.end_date, 'short')}). La ligne d’abonnement non encaissée sera annulée ; un remboursement éventuel est une action distincte.`,
          reasonLabel: 'Motif', danger: true, confirmLabel: 'Annuler l’abonnement',
          run: async (v) => {
            await api.post(`/api/subscriptions/${current.id}/cancel`, { reason: v.reason }, key);
            toast('Abonnement annulé.');
            reload();
          },
        });
      },
      deactivate: (el) => {
        const card = m.cards.find((c) => c.id === Number(el.dataset.id));
        const key = newKey();
        actionDialog({
          title: 'Désactiver la carte', message: `Carte ${card.kind} ${card.code}.`, reasonLabel: 'Motif (perte, remplacement…)',
          danger: true, confirmLabel: 'Désactiver',
          run: async (v) => {
            await api.post(`/api/cards/${card.id}/deactivate`, { reason: v.reason }, key);
            toast('Carte désactivée.');
            reload();
          },
        });
      },
    },
  });
}

export async function cardView(ctx) {
  const v = await api.get(`/api/cards/${ctx.params[0]}`);
  const sub = v.subscription;
  const valid = ['active', 'expire_bientot'].includes(sub.state);
  const active = v.card.status === 'active';
  ctx.render(html`
    <a class="back no-print" href="#/membres/${v.member.id}">${icon('left')} ${v.member.name}</a>
    <div class="page-head no-print">
      <div><h1>Carte ${v.card.kind}</h1><p class="lead">Format carte bancaire (85,6 × 54 mm), prête à imprimer ou à présenter à l’écran.</p></div>
      <div class="actions"><button class="btn btn-primary" data-act="print">${icon('printer')} Imprimer</button></div>
    </div>
    ${active ? '' : html`<div class="notice notice-danger no-print" style="margin-bottom:14px">${icon('alert')}<span>Carte désactivée${v.card.deactivation_reason ? ` : ${v.card.deactivation_reason}` : ''}.</span></div>`}
    <div class="member-card ${active ? '' : 'inactive'}" role="img" aria-label="Carte de membre de ${v.member.name}, numéro ${v.card.code}">
      <div class="mc-top"><div class="mc-club">${v.club_name}</div><div class="mc-kind">Carte de membre · ${v.card.kind}</div></div>
      <div><div class="mc-name">${v.member.name}</div><div class="mc-code">${v.card.code}</div></div>
      <div class="mc-foot">
        <div>N° membre<strong>${v.member.member_no}</strong></div>
        <div>Formule<strong>${valid ? sub.plan_name : 'Aucune formule active'}</strong></div>
        <div>Validité<strong>${valid ? `jusqu’au ${dayLabel(sub.end_date, 'short')}` : '—'}</strong></div>
      </div>
    </div>
    <p class="subtle no-print" style="margin-top:14px;max-width:560px">La carte n’affiche ni téléphone ni courriel. Le QR code de recherche du membre (amélioration facultative)
      n’est pas inclus dans cette version ; il ne devra ouvrir la fiche qu’à un utilisateur connecté.</p>`, {
    actions: { print: () => window.print() },
  });
}
