import {
  api, html, raw, isAdmin, money, fmtDuration, dayLabel, dateTime, chip, accountTag, hypothesis, newKey,
  ACTION_LABELS, ACCOUNT_LABEL,
} from '../core.js';
import { icon, empty, submitForm, toast, busy, actionDialog } from '../ui.js';
import {
  openExtendDialog, openCancelReservationDialog, openPaymentDialog, openRefundDialog, cancelChargeDialog, supplementText, canRefund,
} from './dialogs.js';

export function auditSummary(a) {
  const d = a.details ?? {};
  switch (a.action) {
    case 'reservation.creer':
      return `${fmtDuration(d.duree ?? 0)}, dont ${fmtDuration(d.minutes_incluses ?? 0)} incluses${d.supplement ? ` ; supplément ${money(d.supplement)}` : ''}${d.hors_horaires ? ' ; hors horaires autorisé' : ''}`;
    case 'reservation.prolonger':
      return `+${fmtDuration(d.minutes ?? 0)}${d.supplement_ajoute ? ` ; supplément +${money(d.supplement_ajoute)}` : ''}${d.hors_horaires ? ' ; hors horaires autorisé' : ''}`;
    case 'reservation.terminer':
      return `${fmtDuration(d.minutes_consommees ?? 0)} consommées`;
    case 'reservation.annuler':
      return `${d.motif ?? ''} ; ${fmtDuration(d.minutes_liberees ?? 0)} libérées`;
    case 'reservation.consommation.ajouter':
      return `${d.produit} × ${d.quantite} (${money(d.montant)}, ${ACCOUNT_LABEL[d.sous_compte] ?? ''})`;
    case 'paiement.enregistrer':
      return `${money(d.montant)} — ${d.moyen}${d.reference ? ` (${d.reference})` : ''}`;
    case 'ligne.annuler':
      return `${d.libelle} (${money(d.montant)}) — ${d.motif}`;
    case 'ligne.rembourser':
      return `${d.libelle} (${money(d.montant)}) — ${d.motif}${d.remis_en_stock ? ' ; remis en stock' : ''}`;
    case 'abonnement.activer':
    case 'abonnement.renouveler':
      return `${d.formule} du ${dayLabel(d.debut, 'short')} au ${dayLabel(d.fin, 'short')}`;
    case 'carte.emettre':
      return `${d.type} ${d.code}`;
    case 'credit.ajuster':
      return `${d.minutes > 0 ? '+' : ''}${d.minutes} min — ${d.motif}`;
    case 'stock.entree':
      return `+${d.quantite}`;
    case 'stock.ajustement':
      return `${d.avant} → ${d.apres} — ${d.motif}`;
    default:
      return '';
  }
}

export async function reservationView(ctx) {
  const id = ctx.params[0];
  const [d, products] = await Promise.all([api.get(`/api/reservations/${id}`), api.get('/api/products')]);
  const r = d.reservation;
  const sub = d.subscription;
  const itemKey = newKey();
  const due = d.charges.filter((c) => c.status === 'due');
  const dueTotal = due.reduce((sum, c) => sum + c.amount, 0);
  const nextDay = r.end_date > r.biz_day ? ' (lendemain)' : '';
  const groups = [['cigare', 'Cigares (vente à l’unité)'], ['bouteille', 'Bouteilles (entières uniquement)']];
  const reload = () => ctx.refresh();

  const lineActions = (c) => {
    const out = [];
    if (c.status === 'due' && (c.kind === 'produit' || isAdmin())) out.push(html`<button class="btn btn-sm btn-ghost" data-act="cancel-line" data-id="${c.id}">Annuler</button>`);
    if (c.status === 'payee' && canRefund()) out.push(html`<button class="btn btn-sm btn-ghost" data-act="refund" data-id="${c.id}">Rembourser</button>`);
    return out;
  };

  const totals = Object.entries(d.totals);
  const anyLine = d.charges.length > 0;

  ctx.render(html`
    <a class="back" href="#/agenda?date=${r.biz_day}">${icon('left')} Agenda</a>
    <div class="page-head">
      <div>
        <h1>${r.member_name}</h1>
        <p class="lead">${dayLabel(r.biz_day, 'title')} · ${r.start_time} → ${r.end_time}${nextDay} · ${fmtDuration(r.duration_min)} ${chip('res', r.status)}
          ${r.off_hours ? html`<span class="chip chip-bronze">hors horaires</span>` : ''}</p>
      </div>
      <div class="actions">
        <a class="btn" href="#/membres/${r.member_id}">${icon('users')} Fiche membre</a>
        ${r.status === 'reservee' ? html`
          <button class="btn btn-danger" data-act="cancel">Annuler</button>
          <button class="btn" data-act="extend">Prolonger</button>
          <button class="btn btn-primary" data-act="start">${icon('check')} Arrivée du membre</button>` : ''}
        ${r.status === 'en_cours' ? html`
          <button class="btn" data-act="extend">Prolonger</button>
          <button class="btn btn-primary" data-act="finish">Terminer</button>` : ''}
      </div>
    </div>

    <div class="grid-2">
      <section class="card">
        <div class="card-head"><h2>Détail du calcul</h2></div>
        <dl class="calc">
          <div><dt>Durée réservée</dt><dd>${fmtDuration(r.duration_min)}</dd></div>
          <div><dt>Heures incluses (crédit de la formule)</dt><dd>${fmtDuration(r.included_minutes)}</dd></div>
          <div><dt>Temps payant</dt><dd>${supplementText(r.paid_minutes, r.tariff)}</dd></div>
          <div class="total"><dt>Supplément de temps</dt><dd>${money(r.supplement_amount)}</dd></div>
        </dl>
        <dl class="kv" style="margin-top:14px">
          <dt>Formule</dt><dd>${sub.plan_name} · ${dayLabel(sub.start_date, 'short')} → ${dayLabel(sub.end_date, 'short')}</dd>
          <dt>Crédit du membre</dt><dd>${fmtDuration(sub.credit.available)} disponibles · ${fmtDuration(sub.credit.committed)} engagées · ${fmtDuration(sub.credit.consumed)} consommées</dd>
          <dt>Tarif appliqué</dt><dd>${money(r.tariff.hour)} / h · ${money(r.tariff.half)} / 30 min
            ${r.tariff.validated ? '' : hypothesis('Tarif annoncé, non validé au moment de la réservation.', 'non validé')}</dd>
          ${r.off_hours ? html`<dt>Hors horaires</dt><dd>Autorisé par ${r.off_hours_authorized_by_name ?? '—'}</dd>` : ''}
          <dt>Saisie</dt><dd>${r.created_by_name ?? '—'}, ${dateTime(r.created_at)}</dd>
          ${r.notes ? html`<dt>Remarque</dt><dd>${r.notes}</dd>` : ''}
          ${r.status === 'annulee' ? html`<dt>Annulation</dt><dd>${r.cancel_reason} (${dateTime(r.cancelled_at)})</dd>` : ''}
        </dl>
        <p class="subtle" style="margin-top:10px">Les heures incluses ne génèrent aucun encaissement : elles proviennent du crédit déjà acheté.</p>
      </section>

      <section class="card">
        <div class="card-head"><h2>Note</h2>
          ${due.length ? html`<button class="btn btn-primary btn-sm" data-act="pay">${icon('wallet')} Encaisser ${money(dueTotal)}</button>` : ''}</div>
        ${anyLine ? html`<div class="table-wrap"><table class="table stack-sm">
          <thead><tr><th>Ligne</th><th>Sous-compte</th><th class="num">Montant</th><th>Statut</th><th><span class="sr-only">Actions</span></th></tr></thead>
          <tbody>${d.charges.map((c) => html`<tr class="${c.status === 'annulee' ? 'is-muted' : ''}">
            <td data-label="Ligne"><span class="strike">${c.label}</span>${c.quantity > 1 ? html` <span class="subtle">${c.quantity} × ${money(c.unit_price)}</span>` : ''}
              ${c.cancel_reason ? html`<div class="subtle">${c.cancel_reason}</div>` : ''}${c.refund_reason ? html`<div class="subtle">Remboursé : ${c.refund_reason}</div>` : ''}</td>
            <td data-label="Sous-compte">${accountTag(c.account)}</td>
            <td data-label="Montant" class="num">${money(c.amount)}</td>
            <td data-label="Statut">${chip('charge', c.status)}</td>
            <td class="actions">${lineActions(c)}</td></tr>`)}</tbody>
          <tfoot>${totals.filter(([, t]) => t.billed || t.refunded).map(([k, t]) => html`<tr>
            <td data-label="Sous-compte">${accountTag(k)}</td><td data-label="Encaissé" class="subtle">encaissé ${money(t.paid)}</td>
            <td data-label="Facturé" class="num">${money(t.billed)}</td><td data-label="Reste">${t.due ? html`<span class="chip chip-warn">reste ${money(t.due)}</span>` : ''}</td><td></td></tr>`)}</tfoot>
        </table></div>` : empty('Aucune ligne : ni supplément ni consommation.', 'list')}
      </section>

      ${r.status !== 'annulee' ? html`<section class="card">
        <div class="card-head"><h2>Ajouter une consommation</h2></div>
        <form data-form="item" class="form-grid" novalidate>
          <div class="form-row">
            <label class="field" style="grid-column:span 2"><span>Produit</span><select name="product_id" required>
              <option value="">— Choisir —</option>
              ${groups.map(([cat, label]) => html`<optgroup label="${label}">
                ${products.filter((p) => p.category === cat).map((p) => html`<option value="${p.id}" ${p.stock_qty ? '' : raw('disabled')}>${p.name} — ${money(p.price)} · ${p.stock_qty ? `${p.stock_qty} en stock` : 'rupture'}</option>`)}
              </optgroup>`)}
            </select></label>
            <label class="field"><span>Quantité</span><input type="number" name="quantity" min="1" max="99" step="1" value="1" inputmode="numeric" required></label>
          </div>
          <p class="subtle">La vente diminue le stock une seule fois ; une annulation le rétablit avec un mouvement tracé.</p>
          <div class="form-error" role="alert" hidden></div>
          <div><button type="submit" class="btn btn-primary">${icon('plus')} Ajouter à la note</button></div>
        </form>
      </section>` : ''}

      <section class="card">
        <div class="card-head"><h2>Encaissements</h2></div>
        ${d.payments.length ? html`<div class="list">${d.payments.map((p) => html`<div class="list-item">
          <div class="grow"><div class="title">${money(p.amount)} — ${p.method}${p.reference ? html` <span class="subtle">${p.reference}</span>` : ''}</div>
            <div class="meta">${dateTime(p.paid_at)} · ${p.created_by_name ?? ''} · ${Object.entries(p.by_account).filter(([, v]) => v).map(([k, v]) => `${ACCOUNT_LABEL[k]} ${money(v)}`).join(' · ')}</div></div>
          <span class="chip chip-ok">n° ${p.id}</span></div>`)}</div>` : empty('Aucun encaissement.', 'wallet')}
      </section>

      <section class="card span-2">
        <div class="card-head"><h2>Historique</h2></div>
        <div class="list">${d.history.map((a) => html`<div class="list-item">
          <span class="time subtle">${dateTime(a.at)}</span>
          <div class="grow"><div class="title">${ACTION_LABELS[a.action] ?? a.action}</div><div class="meta">${auditSummary(a)}</div></div>
          <span class="subtle">${a.user_name ?? 'système'}</span></div>`)}</div>
      </section>
    </div>`, {
    actions: {
      start: (el) => busy(el, async () => {
        await api.post(`/api/reservations/${r.id}/start`, {});
        toast('Arrivée enregistrée : réservation en cours.');
        reload();
      }),
      finish: () => actionDialog({
        title: 'Terminer la réservation',
        message: `Les ${fmtDuration(r.included_minutes)} incluses engagées seront comptées comme consommées.${dueTotal ? ` Il reste ${money(dueTotal)} à encaisser sur la note.` : ''}`,
        confirmLabel: 'Terminer',
        run: async () => {
          await api.post(`/api/reservations/${r.id}/finish`, {});
          toast('Réservation terminée.');
          reload();
        },
      }),
      extend: () => openExtendDialog(r, reload),
      cancel: () => openCancelReservationDialog(d, reload),
      pay: () => openPaymentDialog({ lines: d.charges, memberName: r.member_name }, reload),
      refund: (el) => openRefundDialog(d.charges.find((c) => c.id === Number(el.dataset.id)), reload),
      'cancel-line': (el) => cancelChargeDialog(d.charges.find((c) => c.id === Number(el.dataset.id)), reload),
    },
    forms: {
      item: (form) => submitForm(form, async () => {
        const productId = Number(form.product_id.value);
        const quantity = Number(form.quantity.value);
        if (!productId) throw new Error('Choisissez un produit.');
        if (!Number.isInteger(quantity) || quantity < 1) throw new Error('Quantité : nombre entier à partir de 1.');
        await api.post(`/api/reservations/${r.id}/items`, { product_id: productId, quantity }, itemKey);
        toast('Consommation ajoutée à la note.');
        reload();
      }),
    },
  });
}
