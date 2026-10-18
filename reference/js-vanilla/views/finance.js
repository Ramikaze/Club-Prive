import { api, html, raw, isAdmin, money, dayLabel, dateTime, accountTag, hypothesis, qs, bizToday, ACCOUNT_LABEL, state } from '../core.js';
import { icon, empty, formValues } from '../ui.js';
import { openPaymentDialog } from './dialogs.js';
import { addDays, isValidDate } from '/shared/time.js';

const ventilation = (byAccount) => Object.entries(byAccount).filter(([, v]) => v)
  .map(([k, v]) => html`<span class="nowrap" style="margin-right:10px"><i class="dot dot-${k}"></i> ${ACCOUNT_LABEL[k]} ${money(v)}</span>`);

const journalTable = (payments) => (payments.length ? html`<div class="table-wrap"><table class="table stack-sm">
  <thead><tr><th>Date</th><th>N°</th><th>Membre</th><th>Moyen</th><th>Ventilation</th><th class="num">Total</th><th>Par</th></tr></thead>
  <tbody>${payments.map((p) => html`<tr>
    <td data-label="Date" class="nowrap">${dateTime(p.paid_at)}</td>
    <td data-label="N°">${p.reservation_id ? html`<a href="#/reservations/${p.reservation_id}">${p.id}</a>` : p.id}</td>
    <td data-label="Membre"><a href="#/membres/${p.member_id}">${p.member_name}</a></td>
    <td data-label="Moyen">${p.method}${p.reference ? html` <span class="subtle">${p.reference}</span>` : ''}</td>
    <td data-label="Ventilation">${ventilation(p.by_account)}</td>
    <td data-label="Total" class="num"><strong>${money(p.amount)}</strong></td>
    <td data-label="Par">${p.created_by_name ?? ''}</td></tr>`)}</tbody></table></div>` : empty('Aucun encaissement sur la période.', 'wallet'));

const refundsTable = (refunds) => (refunds.length ? html`<div class="table-wrap"><table class="table stack-sm">
  <thead><tr><th>Date</th><th>Membre</th><th>Ligne</th><th>Sous-compte</th><th class="num">Montant</th><th>Motif</th><th>Par</th></tr></thead>
  <tbody>${refunds.map((r) => html`<tr>
    <td data-label="Date" class="nowrap">${dateTime(r.created_at)}</td>
    <td data-label="Membre">${r.member_name}</td>
    <td data-label="Ligne">${r.reservation_id ? html`<a href="#/reservations/${r.reservation_id}">${r.label}</a>` : r.label}</td>
    <td data-label="Sous-compte">${accountTag(r.account)}</td>
    <td data-label="Montant" class="num">${money(r.amount)}</td>
    <td data-label="Motif">${r.reason}</td>
    <td data-label="Par">${r.created_by_name ?? ''}</td></tr>`)}</tbody></table></div>` : empty('Aucun remboursement sur la période.', 'check'));

const openTable = (groups) => (groups.length ? html`<div class="list">${groups.map((g) => html`<div class="list-item">
  <div class="grow"><div class="title"><a href="#/membres/${g.member_id}">${g.member_name}</a> <span class="subtle">${g.member_no}</span></div>
    <div class="meta">${g.lines.length} ligne(s) · ${ventilation(g.by_account)}</div></div>
  <strong class="num">${money(g.total)}</strong>
  <button class="btn btn-sm btn-primary" data-act="pay" data-id="${g.member_id}">Encaisser</button></div>`)}</div>`
  : empty('Aucune somme en attente.', 'check'));

function accountCard(a, total = false) {
  return html`<div class="account-card ${total ? 'total' : ''}">
    <h3>${total ? 'Total' : html`<i class="dot dot-${a.account}"></i> ${a.label}`}</h3>
    <div class="big">${money(a.net)}</div>
    <div class="calc-line"><span>Facturé (dû)</span><span>${money(a.billed)}</span></div>
    <div class="calc-line"><span>Encaissé</span><span>${money(a.collected)}</span></div>
    <div class="calc-line"><span>Remboursé</span><span>${money(a.refunded)}</span></div>
    <div class="calc-line"><span>Net encaissé</span><span>${money(a.net)}</span></div>
    <div class="calc-line"><span>Reste à payer</span><span>${money(a.outstanding)}</span></div>
    ${a.cancelled ? html`<div class="calc-line"><span>Annulé</span><span>${money(a.cancelled)}</span></div>` : ''}
  </div>`;
}

function periodFor(query) {
  const today = bizToday();
  const p = query.p ?? 'jour';
  if (p === 'semaine') return { p, from: addDays(today, -6), to: today };
  if (p === 'mois') return { p, from: `${today.slice(0, 8)}01`, to: today };
  if (p === 'mois-precedent') {
    const to = addDays(`${today.slice(0, 8)}01`, -1);
    return { p, from: `${to.slice(0, 8)}01`, to };
  }
  if (p === 'perso' && isValidDate(query.du) && isValidDate(query.au) && query.du <= query.au) return { p, from: query.du, to: query.au };
  return { p: 'jour', from: today, to: today };
}

async function managerView(ctx) {
  const [journal, open] = await Promise.all([api.get('/api/finance/journal'), api.get('/api/finance/open')]);
  const by = { reservations: 0, alcool: 0, cigares: 0 };
  for (const p of journal.payments) for (const [k, v] of Object.entries(p.by_account)) by[k] += v;
  for (const r of journal.refunds) by[r.account] -= r.amount;
  const total = by.reservations + by.alcool + by.cigares;
  ctx.render(html`
    <div class="page-head"><div><h1>Encaissements</h1><p class="lead">Caisse du ${dayLabel(journal.from, 'title')}</p></div></div>
    <div class="account-cards" style="margin-bottom:16px">
      ${Object.entries(by).map(([k, v]) => html`<div class="account-card"><h3><i class="dot dot-${k}"></i> ${ACCOUNT_LABEL[k]}</h3><div class="big">${money(v)}</div><div class="subtle">net encaissé aujourd’hui</div></div>`)}
      <div class="account-card total"><h3>Total</h3><div class="big">${money(total)}</div><div class="calc-line"><span>${journal.payments.length} encaissement(s)</span><span></span></div></div>
    </div>
    <div class="grid">
      <section class="card"><div class="card-head"><h2>Reste à encaisser</h2></div>${openTable(open)}</section>
      <section class="card"><div class="card-head"><h2>Encaissements du jour</h2></div>${journalTable(journal.payments)}</section>
      ${journal.refunds.length ? html`<section class="card"><div class="card-head"><h2>Remboursements du jour</h2></div>${refundsTable(journal.refunds)}</section>` : ''}
    </div>
    <p class="subtle" style="margin-top:12px">Les sous-comptes sur une période et les exports sont réservés aux administrateurs.</p>`, {
    actions: {
      pay: (el) => {
        const g = open.find((x) => x.member_id === Number(el.dataset.id));
        openPaymentDialog({ lines: g.lines, memberName: g.member_name }, () => ctx.refresh());
      },
    },
  });
}

export async function financeView(ctx) {
  if (!isAdmin()) {
    await managerView(ctx);
    return;
  }
  const { p, from, to } = periodFor(ctx.query);
  const [sum, journal, open] = await Promise.all([
    api.get(`/api/finance/summary${qs({ from, to })}`),
    api.get(`/api/finance/journal${qs({ from, to })}`),
    api.get('/api/finance/open'),
  ]);
  const account = ['reservations', 'alcool', 'cigares'].includes(ctx.query.compte) ? ctx.query.compte : '';
  const exportLink = (kind, label) => html`<a class="btn btn-sm" href="/api/export/${kind}${qs({ from, to, account })}" download>${icon('download')} ${label}</a>`;
  const presets = [['jour', 'Aujourd’hui'], ['semaine', '7 jours'], ['mois', 'Mois en cours'], ['mois-precedent', 'Mois précédent'], ['perso', 'Personnalisée']];
  const revenueAccount = state.settings.subscription_revenue_account;

  ctx.render(html`
    <div class="page-head">
      <div><h1>Encaissements et sous-comptes</h1>
        <p class="lead">${from === to ? dayLabel(from, 'title') : `Du ${dayLabel(from, 'medium')} au ${dayLabel(to, 'medium')}`} · journées d’exploitation (de ${state.settings.hours.open} à ${state.settings.hours.open} le lendemain)</p></div>
    </div>
    <div class="toolbar">
      <div class="segmented" role="group" aria-label="Période">
        ${presets.map(([k, label]) => html`<button type="button" data-act="preset" data-p="${k}" aria-pressed="${p === k ? 'true' : 'false'}">${label}</button>`)}
      </div>
      ${p === 'perso' ? html`<form class="row" data-form="custom">
        <input type="date" name="du" value="${from}" aria-label="Du" style="width:auto"><input type="date" name="au" value="${to}" aria-label="Au" style="width:auto">
        <button class="btn btn-sm" type="submit">Appliquer</button></form>` : ''}
    </div>

    <div class="account-cards">
      ${sum.accounts.map((a) => accountCard(a))}
      ${accountCard(sum.total, true)}
    </div>
    <div class="notice notice-info" style="margin:14px 0">${icon('info')}<span>Suivi des recettes et des encaissements, pas une comptabilité complète.
      Les ventes de formules sont rattachées au sous-compte « ${ACCOUNT_LABEL[revenueAccount]} » ${hypothesis('Affectation des recettes d’abonnement à valider (modifiable dans les paramètres).')}.
      La répartition entre associés reste à définir.</span></div>

    <div class="grid-2">
      <section class="card">
        <div class="card-head"><h2>Exports CSV</h2></div>
        <div class="form-grid">
          <label class="field"><span>Sous-compte</span><select data-change="account">
            <option value="">Tous les sous-comptes</option>
            ${Object.entries(ACCOUNT_LABEL).map(([k, label]) => html`<option value="${k}" ${account === k ? raw('selected') : ''}>${label}</option>`)}
          </select></label>
          <div class="row">
            ${exportLink('synthese', 'Synthèse')} ${exportLink('lignes', 'Lignes facturées')} ${exportLink('encaissements', 'Encaissements')}
            ${exportLink('remboursements', 'Remboursements')} ${exportLink('reservations', 'Réservations')} ${exportLink('stock', 'Mouvements de stock')}
          </div>
          <p class="subtle">Format CSV (séparateur « ; »), lisible dans Excel ou LibreOffice. Les montants sont exprimés en ${state.settings.currency.label}.</p>
        </div>
      </section>
      <section class="card">
        <div class="card-head"><h2>Par moyen de paiement</h2></div>
        ${sum.methods.length ? html`<dl class="calc">${sum.methods.map((x) => html`<div><dt>${x.method} <span class="subtle">(${x.n})</span></dt><dd>${money(x.total)}</dd></div>`)}</dl>`
          : empty('Aucun encaissement sur la période.', 'wallet')}
      </section>
      <section class="card span-2"><div class="card-head"><h2>Reste à encaisser</h2><span class="subtle">toutes périodes</span></div>${openTable(open)}</section>
      <section class="card span-2"><div class="card-head"><h2>Journal des encaissements</h2></div>${journalTable(journal.payments)}</section>
      <section class="card span-2"><div class="card-head"><h2>Remboursements</h2></div>${refundsTable(journal.refunds)}</section>
    </div>`, {
    actions: {
      preset: (el) => ctx.setQuery({ p: el.dataset.p, du: from, au: to, compte: account }),
      pay: (el) => {
        const g = open.find((x) => x.member_id === Number(el.dataset.id));
        openPaymentDialog({ lines: g.lines, memberName: g.member_name }, () => ctx.refresh());
      },
    },
    changes: { account: (el) => ctx.setQuery({ p, du: from, au: to, compte: el.value }) },
    forms: {
      custom: (f) => {
        const v = formValues(f);
        if (isValidDate(v.du) && isValidDate(v.au) && v.du <= v.au) ctx.setQuery({ p: 'perso', du: v.du, au: v.au, compte: account });
      },
    },
  });
}
