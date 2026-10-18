// Dialogs shared by several screens. Each dialog keeps one idempotency key for its whole life,
// so a double click or a retry after a network error never records the operation twice.
import {
  api, html, raw, state, isAdmin, money, fmtDuration, dayLabel, win, bizToday, newKey, parts, relLabel,
  accountTag, hypothesis, subStateLabel,
} from '../core.js';
import { openModal, submitForm, formValues, setHTML, icon, toast, actionDialog } from '../ui.js';
import { addDays, addMonths, daysBetween, parseHHMM } from '/shared/time.js';
import { supplementDetail } from '/shared/rules.js';

const debounce = (fn, ms) => {
  let t;
  return (...args) => {
    clearTimeout(t);
    t = setTimeout(() => fn(...args), ms);
  };
};

export function supplementText(paid, tariff) {
  if (!paid) return 'aucun';
  const d = supplementDetail(paid);
  const pieces = [];
  if (d.hours) pieces.push(`${d.hours} h × ${money(tariff.hour)}`);
  if (d.halves) pieces.push(`1 demi-heure × ${money(tariff.half)}`);
  return `${fmtDuration(paid)} → ${pieces.join(' + ')}`;
}

const notice = (kind, text) => html`<div class="notice notice-${kind}">${icon(kind === 'danger' || kind === 'warn' ? 'alert' : 'info')}<span>${text}</span></div>`;

const startRelOf = (time) => {
  const m = parseHHMM(time);
  return m < win().open ? m + 1440 : m;
};

function defaultStart(date) {
  const w = win();
  const { slot_min: slot, min_duration_min: minDur } = state.settings.booking;
  const last = w.maxEnd - minDur;
  if (date === bizToday()) {
    const p = parts(Date.now());
    let rel = Math.ceil((daysBetween(date, p.date) * 1440 + p.minutes) / slot) * slot;
    if (rel < w.open) rel = w.open;
    if (rel <= last) return relLabel(rel);
  }
  const evening = 18 * 60;
  return relLabel(evening >= w.open && evening <= last ? evening : w.open);
}

const creditLine = (summary) => (summary?.credit
  ? ` · crédit disponible ${fmtDuration(summary.credit.available)}` : '');

// ---------------------------------------------------------------- new reservation

export function openBookingDialog(preset = {}, onDone) {
  const s = state.settings;
  const w = win();
  const { slot_min: slot, min_duration_min: minDur } = s.booking;
  const key = newKey();
  const st = { member: preset.member ?? null, results: [], quote: null, error: null, seq: 0, searchSeq: 0 };
  const date0 = preset.date ?? bizToday();
  const start0 = preset.start_time ?? defaultStart(date0);
  const m = openModal({ title: 'Nouvelle réservation', size: 'wide' });
  const $ = (sel) => m.body.querySelector(sel);

  const startOptions = (selected) => {
    const out = [];
    for (let rel = w.open; rel + minDur <= w.maxEnd; rel += slot) {
      const label = relLabel(rel);
      const note = rel >= 1440 ? ' (après minuit)' : rel >= w.close ? ' (hors horaires)' : '';
      out.push(html`<option value="${label}" ${label === selected ? raw('selected') : ''}>${label}${note}</option>`);
    }
    return out;
  };
  const durationOptions = (startTime, selected) => {
    const rel = startRelOf(startTime);
    const out = [];
    for (let d = minDur; rel + d <= w.maxEnd; d += slot) {
      out.push(html`<option value="${d}" ${d === selected ? raw('selected') : ''}>${fmtDuration(d)}${rel + d > w.close ? ` · après ${s.hours.close}` : ''}</option>`);
    }
    return out;
  };

  const memberArea = () => (st.member
    ? html`<div class="row"><div class="grow" style="flex:1;min-width:0">
        <strong>${st.member.name}</strong> <span class="subtle">${st.member.member_no}</span>
        <div class="subtle">${subStateLabel(st.member.subscription)}${creditLine(st.member.subscription)}</div></div>
        ${preset.lockMember ? '' : html`<button type="button" class="btn btn-sm" data-act="change-member">Changer</button>`}</div>`
    : html`<div class="search">${icon('search')}<input type="search" data-input="search" placeholder="Nom, téléphone, n° de membre ou de carte"
        aria-label="Rechercher un membre" autocomplete="off" autofocus></div>
        <div id="bk-results" class="list" aria-live="polite"></div>`);

  const resultsTpl = (list) => (list.length
    ? list.slice(0, 8).map((x) => html`<button type="button" class="list-item" data-act="pick" data-id="${x.id}">
        <div class="grow"><div class="title">${x.name} <span class="subtle">${x.member_no}</span></div>
        <div class="meta">${subStateLabel(x.subscription)}${creditLine(x.subscription)}</div></div></button>`)
    : html`<p class="subtle">Aucun membre trouvé.</p>`);

  const quoteTpl = (q) => {
    const warnings = [];
    if (q.conflicts.length) {
      warnings.push(notice('danger', `Créneau occupé : ${q.conflicts.map((c) => `${c.member_name} (${c.start_time} – ${c.end_time})`).join(', ')}.`));
    }
    if (q.off_hours) {
      warnings.push(notice('warn', q.can_authorize_off_hours
        ? `Ce créneau dépasse les horaires habituels (${s.hours.open} – ${s.hours.close}) : une autorisation explicite est nécessaire.`
        : 'Ce créneau dépasse les horaires habituels : seul un administrateur peut l’autoriser.'));
    }
    if (q.paid_minutes && q.tariff_blocked) warnings.push(notice('danger', 'Le tarif du temps supplémentaire n’est pas validé par un administrateur.'));
    return html`
      <dl class="calc">
        <div><dt>Horaire</dt><dd>${dayLabel(q.biz_day, 'medium')} · ${q.start_time} → ${q.end_time}${q.end_next_day ? ' (lendemain)' : ''}</dd></div>
        <div><dt>Durée</dt><dd>${fmtDuration(q.duration_min)}</dd></div>
        <div><dt>Formule</dt><dd>${q.subscription.plan_name} · jusqu’au ${dayLabel(q.subscription.end_date, 'short')}</dd></div>
        <div><dt>Crédit disponible</dt><dd>${fmtDuration(q.credit_before.available)}</dd></div>
        <div><dt>Heures incluses utilisées</dt><dd>${fmtDuration(q.included_minutes)}</dd></div>
        <div><dt>Temps payant</dt><dd>${supplementText(q.paid_minutes, q.tariff)}
          ${q.paid_minutes && !q.tariff.validated ? hypothesis('Tarif annoncé dans les messages audio, non encore validé par un administrateur.', 'tarif à valider') : ''}</dd></div>
        <div class="total"><dt>Supplément à régler</dt><dd>${money(q.supplement_amount)}</dd></div>
        <div><dt>Crédit restant après</dt><dd>${fmtDuration(q.credit_after)}</dd></div>
      </dl>
      ${warnings.length ? html`<div class="stack" style="margin-top:10px">${warnings}</div>` : ''}`;
  };

  const payload = () => {
    const f = $('form');
    return {
      member_id: st.member?.id, date: f.date.value, start_time: f.start_time.value, duration_min: Number(f.duration_min.value),
      notes: f.notes.value, authorize_off_hours: f.authorize_off_hours.checked,
    };
  };

  const updateSubmit = () => {
    const q = st.quote;
    const f = $('form');
    $('#bk-submit').disabled = !q || q.conflicts.length > 0 || q.tariff_blocked
      || (q.off_hours && (!q.can_authorize_off_hours || !f.authorize_off_hours.checked));
  };

  const renderQuote = (loading = false) => {
    const box = $('#bk-quote');
    const off = $('#bk-off');
    if (!st.member) {
      setHTML(box, html`<p class="subtle">Choisissez un membre pour afficher le détail du calcul.</p>`);
      off.hidden = true;
      $('#bk-submit').disabled = true;
      return;
    }
    if (loading && !st.quote) {
      setHTML(box, html`<p class="subtle">Calcul en cours…</p>`);
      return;
    }
    if (st.error) {
      setHTML(box, notice('danger', st.error));
      off.hidden = true;
      $('#bk-submit').disabled = true;
      return;
    }
    if (!st.quote) return;
    setHTML(box, quoteTpl(st.quote));
    off.hidden = !st.quote.off_hours || !st.quote.can_authorize_off_hours;
    updateSubmit();
  };

  const requestQuote = debounce(async () => {
    if (!st.member) {
      st.quote = null;
      renderQuote();
      return;
    }
    const n = (st.seq += 1);
    renderQuote(true);
    try {
      const q = await api.preview('/api/reservations/quote', payload());
      if (n !== st.seq) return;
      st.quote = q;
      st.error = null;
    } catch (e) {
      if (n !== st.seq) return;
      st.quote = null;
      st.error = e.message;
    }
    renderQuote();
  }, 180);

  const search = debounce(async (input) => {
    const q = input.value.trim();
    const box = $('#bk-results');
    if (!box) return;
    if (!q) {
      setHTML(box, '');
      return;
    }
    const n = (st.searchSeq += 1);
    try {
      const list = await api.get(`/api/members?q=${encodeURIComponent(q)}`);
      if (n !== st.searchSeq) return;
      st.results = list;
      setHTML(box, resultsTpl(list));
    } catch (e) {
      setHTML(box, notice('danger', e.message));
    }
  }, 200);

  m.render(html`
    <form data-form="book" class="form-grid" novalidate>
      <fieldset><legend>Membre</legend><div id="bk-member">${memberArea()}</div></fieldset>
      <div class="form-row">
        <label class="field"><span>Journée</span><input type="date" name="date" value="${date0}" required data-change="when"></label>
        <label class="field"><span>Début</span><select name="start_time" data-change="start">${startOptions(start0)}</select></label>
        <label class="field"><span>Durée</span><select name="duration_min" data-change="when">${durationOptions(start0, minDur)}</select></label>
      </div>
      <p class="subtle">Créneaux de ${slot} min, ${fmtDuration(minDur)} minimum. Horaires habituels ${s.hours.open} – ${s.hours.close} ;
        fin possible jusqu’à ${s.hours.max_end} (lendemain) avec autorisation.</p>
      <label class="field"><span>Remarque (facultatif)</span><input name="notes" maxlength="300"></label>
      <div id="bk-quote" aria-live="polite"></div>
      <label class="check" id="bk-off" hidden><input type="checkbox" name="authorize_off_hours" data-change="auth">
        <span>J’autorise explicitement le dépassement des horaires habituels (autorisation enregistrée à mon nom).</span></label>
      <div class="form-error" role="alert" hidden></div>
      <div class="modal-actions">
        <button type="button" class="btn" data-act="close">Annuler</button>
        <button type="submit" class="btn btn-primary" id="bk-submit" disabled>Confirmer la réservation</button>
      </div>
    </form>`, {
    actions: {
      pick: (el) => {
        st.member = st.results.find((x) => x.id === Number(el.dataset.id)) ?? null;
        setHTML($('#bk-member'), memberArea());
        requestQuote();
      },
      'change-member': () => {
        st.member = null;
        st.quote = null;
        st.error = null;
        setHTML($('#bk-member'), memberArea());
        $('#bk-member input')?.focus();
        renderQuote();
      },
    },
    inputs: { search },
    changes: {
      when: () => requestQuote(),
      auth: () => updateSubmit(),
      start: () => {
        const f = $('form');
        const current = Number(f.duration_min.value);
        setHTML(f.duration_min, durationOptions(f.start_time.value, current));
        requestQuote();
      },
    },
    forms: {
      book: (f) => submitForm(f, async () => {
        if (!st.member) throw new Error('Choisissez un membre.');
        const detail = await api.post('/api/reservations', payload(), key);
        m.close();
        toast(`Réservation confirmée : ${detail.reservation.member_name}, ${dayLabel(detail.reservation.biz_day, 'medium')} à ${detail.reservation.start_time}.`);
        onDone?.(detail);
      }),
    },
  });
  renderQuote();
  if (st.member) requestQuote();
}

// ---------------------------------------------------------------- extension

export function openExtendDialog(r, onDone) {
  const s = state.settings;
  const w = win();
  const step = s.booking.extension_step_min;
  const end = parts(r.end_ms);
  const endRel = daysBetween(r.biz_day, end.date) * 1440 + end.minutes;
  const options = [];
  for (let d = step; endRel + d <= w.maxEnd; d += step) options.push(d);
  if (!options.length) {
    toast(`Prolongation impossible : la fin maximale (${s.hours.max_end}) est atteinte.`, 'error');
    return;
  }
  const key = newKey();
  const st = { quote: null, error: null, seq: 0 };
  const m = openModal({ title: 'Prolonger la réservation' });
  const $ = (sel) => m.body.querySelector(sel);

  const refresh = () => {
    const q = st.quote;
    const box = $('#ex-quote');
    $('#ex-off').hidden = !q?.off_hours || !q.can_authorize_off_hours;
    if (st.error) {
      setHTML(box, notice('danger', st.error));
      $('#ex-submit').disabled = true;
      return;
    }
    if (!q) return;
    const warnings = [];
    if (q.conflicts.length) warnings.push(notice('danger', `Créneau suivant occupé : ${q.conflicts.map((c) => `${c.member_name} (${c.start_time} – ${c.end_time})`).join(', ')}.`));
    if (q.off_hours) {
      warnings.push(notice('warn', q.can_authorize_off_hours
        ? `La nouvelle fin dépasse les horaires habituels (${s.hours.close}) : autorisation explicite nécessaire.`
        : 'La nouvelle fin dépasse les horaires habituels : seul un administrateur peut l’autoriser.'));
    }
    if (q.tariff_blocked) warnings.push(notice('danger', 'Le tarif de cette réservation n’est pas validé : prolongation payante impossible hors démonstration.'));
    setHTML(box, html`
      <dl class="calc">
        <div><dt>Nouvelle fin</dt><dd>${q.new_end_time}${q.end_next_day ? ' (lendemain)' : ''}</dd></div>
        <div><dt>Crédit disponible</dt><dd>${fmtDuration(q.credit_available)}</dd></div>
        <div><dt>Heures incluses utilisées</dt><dd>${fmtDuration(q.included_minutes)}</dd></div>
        <div><dt>Temps payant ajouté</dt><dd>${fmtDuration(q.paid_minutes)}</dd></div>
        <div><dt>Temps payant total</dt><dd>${supplementText(q.total_paid_minutes, q.tariff)}</dd></div>
        <div><dt>Supplément</dt><dd>${money(q.supplement_before)} → ${money(q.supplement_after)}</dd></div>
        <div class="total"><dt>À ajouter à la note</dt><dd>${money(q.supplement_delta)}</dd></div>
      </dl>
      <p class="subtle" style="margin-top:6px">Le tarif appliqué reste celui de la réservation confirmée (${money(q.tariff.hour)} / h, ${money(q.tariff.half)} / 30 min).</p>
      ${warnings.length ? html`<div class="stack" style="margin-top:10px">${warnings}</div>` : ''}`);
    $('#ex-submit').disabled = q.conflicts.length > 0 || q.tariff_blocked
      || (q.off_hours && (!q.can_authorize_off_hours || !$('form').authorize_off_hours.checked));
  };

  const requestQuote = async () => {
    const n = (st.seq += 1);
    try {
      const q = await api.preview(`/api/reservations/${r.id}/extend/quote`, { minutes: Number($('form').minutes.value) });
      if (n !== st.seq) return;
      st.quote = q;
      st.error = null;
    } catch (e) {
      if (n !== st.seq) return;
      st.quote = null;
      st.error = e.message;
    }
    refresh();
  };

  m.render(html`
    <form data-form="extend" class="form-grid" novalidate>
      <p>${r.member_name} · actuellement ${r.start_time} → ${r.end_time} (${fmtDuration(r.duration_min)}).</p>
      <label class="field"><span>Prolonger de</span><select name="minutes" data-change="q">
        ${options.map((d) => html`<option value="${d}">+ ${fmtDuration(d)} (fin ${endRel + d === 1440 ? 'minuit' : relLabel(endRel + d)}${endRel + d > 1440 ? ', lendemain' : ''})</option>`)}
      </select></label>
      <div id="ex-quote" aria-live="polite"><p class="subtle">Calcul en cours…</p></div>
      <label class="check" id="ex-off" hidden><input type="checkbox" name="authorize_off_hours" data-change="auth">
        <span>J’autorise explicitement le dépassement des horaires habituels.</span></label>
      <div class="form-error" role="alert" hidden></div>
      <div class="modal-actions"><button type="button" class="btn" data-act="close">Annuler</button>
        <button type="submit" class="btn btn-primary" id="ex-submit" disabled>Confirmer la prolongation</button></div>
    </form>`, {
    changes: { q: requestQuote, auth: refresh },
    forms: {
      extend: (f) => submitForm(f, async () => {
        const detail = await api.post(`/api/reservations/${r.id}/extend`, {
          minutes: Number(f.minutes.value), authorize_off_hours: f.authorize_off_hours.checked,
        }, key);
        m.close();
        toast(`Réservation prolongée jusqu’à ${detail.reservation.end_time}.`);
        onDone?.(detail);
      }),
    },
  });
  requestQuote();
}

// ---------------------------------------------------------------- cancellation

export function openCancelReservationDialog(detail, onDone) {
  const r = detail.reservation;
  const key = newKey();
  const committed = detail.credit_movements.reduce((sum, mv) => {
    if (mv.kind === 'engagement') return sum + mv.minutes;
    if (mv.kind === 'liberation' || mv.kind === 'consommation') return sum - mv.minutes;
    return sum;
  }, 0);
  const due = detail.charges.filter((c) => c.status === 'due');
  const paid = detail.charges.filter((c) => c.status === 'payee');
  actionDialog({
    title: 'Annuler la réservation',
    danger: true,
    confirmLabel: 'Annuler la réservation',
    reasonLabel: 'Motif de l’annulation',
    body: html`<ul class="stack" style="padding-left:18px;margin:0">
      <li>${committed ? `${fmtDuration(committed)} de crédit seront libérées et redeviendront disponibles.` : 'Aucune heure incluse à libérer.'}</li>
      <li>${due.length ? `${due.length} ligne(s) non encaissée(s) seront annulées (les produits retournent en stock).` : 'Aucune ligne à annuler.'}</li>
      ${paid.length ? html`<li><strong>${paid.length} ligne(s) déjà encaissée(s)</strong> resteront en l’état : un remboursement éventuel est une action distincte réservée à un administrateur.</li>` : ''}
    </ul>
    <p class="subtle">Les règles d’annulation tardive (frais, délai) restent à définir.</p>`,
    run: async (v) => {
      const res = await api.post(`/api/reservations/${r.id}/cancel`, { reason: v.reason }, key);
      toast('Réservation annulée.');
      onDone?.(res);
    },
  });
}

// ---------------------------------------------------------------- payment (full payment of selected lines)

export function openPaymentDialog({ lines, memberName }, onDone) {
  const due = lines.filter((c) => c.status === 'due');
  if (!due.length) {
    toast('Aucune ligne à encaisser.', 'error');
    return;
  }
  const key = newKey();
  const m = openModal({ title: 'Encaisser', size: 'wide' });
  const methods = state.settings.payment_methods;
  const $ = (sel) => m.body.querySelector(sel);

  const selected = () => [...m.body.querySelectorAll('input[name="charge"]:checked')].map((i) => due.find((c) => c.id === Number(i.value)));

  const updateSum = () => {
    const sel = selected();
    const by = { reservations: 0, alcool: 0, cigares: 0 };
    for (const c of sel) by[c.account] += c.amount;
    const total = by.reservations + by.alcool + by.cigares;
    setHTML($('#pay-sum'), html`<dl class="calc">
      ${Object.entries(by).map(([k, v]) => html`<div><dt>${accountTag(k)}</dt><dd>${money(v)}</dd></div>`)}
      <div class="total"><dt>Total encaissé</dt><dd>${money(total)}</dd></div></dl>`);
    $('#pay-submit').disabled = sel.length === 0;
    $('#pay-submit').textContent = sel.length ? `Encaisser ${money(total)}` : 'Encaisser';
  };

  m.render(html`
    <form data-form="pay" class="form-grid" novalidate>
      <p class="muted">Membre : <strong>${memberName}</strong>. Chaque ligne cochée est encaissée <strong>intégralement</strong>
        (pas de paiement partiel en version 1) ; le montant est ventilé automatiquement entre les sous-comptes.</p>
      <div class="table-wrap"><table class="table">
        <thead><tr><th><span class="sr-only">Inclure</span></th><th>Ligne</th><th>Sous-compte</th><th class="num">Montant</th></tr></thead>
        <tbody>${due.map((c) => html`<tr>
          <td><input type="checkbox" name="charge" value="${c.id}" checked data-change="sum" aria-label="Encaisser ${c.label}"></td>
          <td>${c.label}${c.quantity > 1 ? ` × ${c.quantity}` : ''} ${c.tariff_validated ? '' : hypothesis('Montant fondé sur un tarif non validé.', 'tarif à valider')}</td>
          <td>${accountTag(c.account)}</td><td class="num">${money(c.amount)}</td></tr>`)}</tbody>
      </table></div>
      <div id="pay-sum"></div>
      <div class="form-row">
        <label class="field"><span>Moyen de paiement</span><select name="method" required>
          ${methods.map((x) => html`<option>${x}</option>`)}</select></label>
        <label class="field"><span>Référence (facultatif)</span><input name="reference" maxlength="80" placeholder="N° de transaction, de reçu…"></label>
      </div>
      <div class="form-error" role="alert" hidden></div>
      <div class="modal-actions"><button type="button" class="btn" data-act="close">Annuler</button>
        <button type="submit" class="btn btn-primary" id="pay-submit">Encaisser</button></div>
    </form>`, {
    changes: { sum: updateSum },
    forms: {
      pay: (f) => submitForm(f, async () => {
        const ids = selected().map((c) => c.id);
        if (!ids.length) throw new Error('Cochez au moins une ligne.');
        const res = await api.post('/api/payments', { charge_ids: ids, method: f.method.value, reference: f.reference.value }, key);
        m.close();
        toast(`Encaissement enregistré : ${money(res.payment.amount)}.`);
        onDone?.(res);
      }),
    },
  });
  updateSum();
}

// ---------------------------------------------------------------- refund (explicit, traced)

export function openRefundDialog(charge, onDone) {
  const key = newKey();
  const m = openModal({ title: 'Rembourser une ligne' });
  m.render(html`
    <form data-form="refund" class="form-grid" novalidate>
      <dl class="calc">
        <div><dt>Ligne</dt><dd>${charge.label}${charge.quantity > 1 ? ` × ${charge.quantity}` : ''}</dd></div>
        <div><dt>Sous-compte</dt><dd>${accountTag(charge.account)}</dd></div>
        <div class="total"><dt>Montant remboursé</dt><dd>${money(charge.amount)}</dd></div>
      </dl>
      <p class="subtle">Version 1 : remboursement intégral de la ligne. Les règles de remboursement restent à valider.</p>
      <label class="field"><span>Motif</span><textarea name="reason" required minlength="3" maxlength="300"></textarea></label>
      <div class="form-row">
        <label class="field"><span>Moyen de remboursement</span><select name="method">${state.settings.payment_methods.map((x) => html`<option>${x}</option>`)}</select></label>
        <label class="field"><span>Référence (facultatif)</span><input name="reference" maxlength="80"></label>
      </div>
      ${charge.product_id ? html`<label class="check"><input type="checkbox" name="restock" value="1"><span>Remettre le produit en stock (${charge.quantity})</span></label>` : ''}
      <div class="form-error" role="alert" hidden></div>
      <div class="modal-actions"><button type="button" class="btn" data-act="close">Annuler</button>
        <button type="submit" class="btn btn-danger">Rembourser ${money(charge.amount)}</button></div>
    </form>`, {
    forms: {
      refund: (f) => submitForm(f, async () => {
        const v = formValues(f);
        if (String(v.reason ?? '').trim().length < 3) throw new Error('Indiquez un motif (3 caractères minimum).');
        const res = await api.post(`/api/charges/${charge.id}/refund`, { reason: v.reason, method: v.method, reference: v.reference, restock: Boolean(v.restock) }, key);
        m.close();
        toast('Remboursement enregistré.');
        onDone?.(res);
      }),
    },
  });
}

export function cancelChargeDialog(charge, onDone) {
  const key = newKey();
  actionDialog({
    title: 'Annuler une ligne',
    message: `${charge.label}${charge.quantity > 1 ? ` × ${charge.quantity}` : ''} — ${money(charge.amount)}${charge.product_id ? ' (le produit retourne en stock)' : ''}.`,
    reasonLabel: 'Motif',
    danger: true,
    confirmLabel: 'Annuler la ligne',
    run: async (v) => {
      const res = await api.post(`/api/charges/${charge.id}/cancel`, { reason: v.reason }, key);
      toast('Ligne annulée.');
      onDone?.(res);
    },
  });
}

// ---------------------------------------------------------------- members

const planLabel = (p) => {
  const price = p.price == null ? 'prix non défini' : `${money(p.price)}${p.price_validated ? '' : ' — à confirmer'}`;
  return `${p.name} (${price})`;
};

export function openMemberDialog(member, onDone) {
  const editing = Boolean(member);
  const key = newKey();
  const subKey = newKey();
  const plans = state.plans.filter((p) => p.active);
  const m = openModal({ title: editing ? 'Modifier la fiche' : 'Nouveau membre', size: 'wide' });
  m.render(html`
    <form data-form="member" class="form-grid" novalidate>
      <div class="form-row">
        <label class="field"><span>Prénom</span><input name="first_name" required maxlength="60" value="${member?.first_name ?? ''}" autocomplete="off"></label>
        <label class="field"><span>Nom</span><input name="last_name" required maxlength="60" value="${member?.last_name ?? ''}" autocomplete="off"></label>
      </div>
      <div class="form-row">
        <label class="field"><span>Téléphone</span><input name="phone" type="tel" required maxlength="30" value="${member?.phone ?? ''}" autocomplete="off"></label>
        <label class="field"><span>Courriel (facultatif)</span><input name="email" type="email" maxlength="120" value="${member?.email ?? ''}" autocomplete="off"></label>
      </div>
      <label class="field"><span>Notes (facultatif)</span><textarea name="notes" maxlength="500">${member?.notes ?? ''}</textarea></label>
      ${editing ? '' : html`<fieldset><legend>Formule (facultatif)</legend><div class="form-row">
        <label class="field"><span>Formule</span><select name="plan_id"><option value="">— Plus tard —</option>
          ${plans.map((p) => html`<option value="${p.id}">${planLabel(p)}</option>`)}</select></label>
        <label class="field"><span>Début de validité</span><input type="date" name="start_date" value="${bizToday()}"></label>
      </div></fieldset>`}
      <div class="form-error" role="alert" hidden></div>
      <div class="modal-actions"><button type="button" class="btn" data-act="close">Annuler</button>
        <button type="submit" class="btn btn-primary">${editing ? 'Enregistrer' : 'Créer le membre'}</button></div>
    </form>`, {
    forms: {
      member: (f) => submitForm(f, async () => {
        const v = formValues(f);
        const body = { first_name: v.first_name, last_name: v.last_name, phone: v.phone, email: v.email, notes: v.notes };
        if (editing) {
          const res = await api.put(`/api/members/${member.id}`, body, key);
          m.close();
          toast('Fiche enregistrée.');
          onDone?.(res);
          return;
        }
        const created = await api.post('/api/members', body, key);
        let result = created;
        if (v.plan_id) {
          try {
            result = (await api.post(`/api/members/${created.id}/subscriptions`, { plan_id: Number(v.plan_id), start_date: v.start_date }, subKey)).member;
          } catch (e) {
            toast(`Membre créé, mais formule non activée : ${e.message}`, 'error');
          }
        }
        m.close();
        toast(`Membre ${created.member_no} créé.`);
        onDone?.(result);
      }),
    },
  });
}

export function openSubscriptionDialog(member, onDone) {
  const key = newKey();
  const plans = state.plans.filter((p) => p.active);
  const sub = member.subscription;
  const start0 = sub && ['active', 'expire_bientot', 'a_venir'].includes(sub.state) ? addDays(sub.end_date, 1) : bizToday();
  const renewing = sub && sub.state !== 'aucun';
  const m = openModal({ title: renewing ? 'Renouveler la formule' : 'Activer une formule' });
  const $ = (sel) => m.body.querySelector(sel);
  const info = () => {
    const f = $('form');
    const p = plans.find((x) => x.id === Number(f.plan_id.value));
    if (!p || !f.start_date.value) return;
    const end = addDays(addMonths(f.start_date.value, p.duration_months), -1);
    const annual = p.duration_months > 1;
    const mode = state.settings.annual_allocation_mode;
    setHTML($('#sub-info'), html`<dl class="calc">
      <div><dt>Validité</dt><dd>${dayLabel(f.start_date.value, 'short')} → ${dayLabel(end, 'short')}</dd></div>
      <div><dt>Heures incluses</dt><dd>${fmtDuration(p.included_minutes)}${annual ? (mode === 'mensuelle' ? ' (2 h attribuées chaque mois)' : ' (disponibles dès l’activation)') : ''}
        ${annual ? hypothesis('Mode d’attribution des heures annuelles à confirmer (paramétrable).') : ''}</dd></div>
      <div class="total"><dt>Prix</dt><dd>${p.price == null ? 'non défini' : money(p.price)}</dd></div>
    </dl>
    ${p.price == null ? notice('warn', 'Aucun prix n’est établi pour cette formule : en démonstration, elle est activée sans ligne à encaisser ; en utilisation réelle, l’activation est bloquée.') : ''}
    ${p.price != null && !p.price_validated ? notice('warn', 'Prix à confirmer : utilisable en démonstration, bloqué en utilisation réelle tant qu’un administrateur ne l’a pas validé.') : ''}
    <p class="subtle" style="margin-top:8px">Les heures non utilisées ne sont pas reportées (règle de report à confirmer). Renouvellement manuel uniquement.</p>`);
  };
  m.render(html`
    <form data-form="sub" class="form-grid" novalidate>
      <p>${member.name} · ${subStateLabel(sub)}</p>
      <div class="form-row">
        <label class="field"><span>Formule</span><select name="plan_id" data-change="info">${plans.map((p) => html`<option value="${p.id}">${planLabel(p)}</option>`)}</select></label>
        <label class="field"><span>Début de validité</span><input type="date" name="start_date" value="${start0}" data-change="info" required></label>
      </div>
      <div id="sub-info"></div>
      <div class="form-error" role="alert" hidden></div>
      <div class="modal-actions"><button type="button" class="btn" data-act="close">Annuler</button>
        <button type="submit" class="btn btn-primary">${renewing ? 'Renouveler' : 'Activer'}</button></div>
    </form>`, {
    changes: { info },
    forms: {
      sub: (f) => submitForm(f, async () => {
        const res = await api.post(`/api/members/${member.id}/subscriptions`, { plan_id: Number(f.plan_id.value), start_date: f.start_date.value }, key);
        m.close();
        toast(res.charge_id ? 'Formule activée : la ligne d’abonnement est à encaisser.' : 'Formule activée.');
        onDone?.(res.member);
      }),
    },
  });
  info();
}

export function openCardDialog(member, onDone) {
  const key = newKey();
  const m = openModal({ title: 'Émettre une carte' });
  m.render(html`
    <form data-form="card" class="form-grid" novalidate>
      <div class="notice notice-info">${icon('info')}<span>La carte renvoie au même membre et au même abonnement : elle ne crée pas de second crédit.
        Une nouvelle carte du même type remplace l’ancienne.</span></div>
      <fieldset><legend>Type de carte</legend>
        <label class="check"><input type="radio" name="kind" value="physique" checked><span>Carte physique</span></label>
        <label class="check"><input type="radio" name="kind" value="virtuelle"><span>Carte virtuelle (affichable et imprimable)</span></label>
      </fieldset>
      <label class="field"><span>Numéro imprimé sur la carte physique (facultatif)</span>
        <input name="code" maxlength="40" placeholder="Laisser vide pour générer un numéro" autocomplete="off">
        <span class="help">Lettres, chiffres et tirets. Ignoré pour une carte virtuelle.</span></label>
      <div class="form-error" role="alert" hidden></div>
      <div class="modal-actions"><button type="button" class="btn" data-act="close">Annuler</button>
        <button type="submit" class="btn btn-primary">Émettre la carte</button></div>
    </form>`, {
    forms: {
      card: (f) => submitForm(f, async () => {
        const v = formValues(f);
        const res = await api.post(`/api/members/${member.id}/cards`, { kind: v.kind, code: v.kind === 'physique' ? v.code : '' }, key);
        m.close();
        toast('Carte émise.');
        onDone?.(res);
      }),
    },
  });
}

export function openAdjustCreditDialog(member, sub, onDone) {
  const key = newKey();
  const m = openModal({ title: 'Ajuster le crédit d’heures' });
  m.render(html`
    <form data-form="adj" class="form-grid" novalidate>
      <p>${member.name} · ${sub.plan_name} · disponible ${fmtDuration(sub.credit.available)}</p>
      <div class="form-row">
        <label class="field"><span>Sens</span><select name="sign"><option value="1">Ajouter</option><option value="-1">Retirer</option></select></label>
        <label class="field"><span>Minutes</span><input type="number" name="minutes" min="1" step="1" value="30" inputmode="numeric" required></label>
      </div>
      <label class="field"><span>Motif (obligatoire, conservé dans l’historique)</span><textarea name="reason" required minlength="3" maxlength="300"></textarea></label>
      <div class="form-error" role="alert" hidden></div>
      <div class="modal-actions"><button type="button" class="btn" data-act="close">Annuler</button>
        <button type="submit" class="btn btn-primary">Enregistrer l’ajustement</button></div>
    </form>`, {
    forms: {
      adj: (f) => submitForm(f, async () => {
        const v = formValues(f);
        const minutes = Number(v.minutes) * Number(v.sign);
        if (!Number.isInteger(minutes) || minutes === 0) throw new Error('Nombre de minutes invalide.');
        const res = await api.post(`/api/subscriptions/${sub.id}/adjust`, { minutes, reason: v.reason }, key);
        m.close();
        toast('Crédit ajusté.');
        onDone?.(res);
      }),
    },
  });
}

export const canRefund = () => isAdmin() || !state.settings.refunds_admin_only;
