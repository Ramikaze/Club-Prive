import {
  api, html, raw, state, money, dateTime, hypothesis, newKey, parseMoney, toMajor, fmtDuration, ACTION_LABELS, ROLE_LABEL, ACCOUNT_LABEL,
} from '../core.js';
import { icon, openModal, submitForm, formValues, toast, actionDialog } from '../ui.js';
import { auditSummary } from './reservation.js';

const TIME_ZONES = ['Africa/Brazzaville', 'Africa/Kinshasa', 'Africa/Douala', 'Africa/Lagos', 'Africa/Abidjan', 'Africa/Casablanca',
  'Europe/Paris', 'Europe/Brussels', 'Europe/London', 'America/Montreal', 'America/New_York', 'Asia/Dubai', 'UTC'];

const selected = (cond) => (cond ? raw('selected') : '');
const checked = (cond) => (cond ? raw('checked') : '');

const money2minor = (text, label) => {
  const v = parseMoney(text);
  if (v == null) throw new Error(`${label} : montant invalide (exemple : 25000 ou 25000,50).`);
  return v;
};

function userDialog(user, onDone) {
  const editing = Boolean(user);
  const key = newKey();
  const m = openModal({ title: editing ? `Modifier ${user.name}` : 'Nouvel utilisateur' });
  m.render(html`
    <form data-form="user" class="form-grid" novalidate>
      ${editing ? '' : html`<label class="field"><span>Identifiant de connexion</span><input name="login" required maxlength="40" autocapitalize="none" autocomplete="off"
        pattern="[a-zA-Z0-9._-]{3,40}"><span class="help">3 à 40 caractères : lettres, chiffres, point, tiret.</span></label>`}
      <label class="field"><span>Nom affiché</span><input name="name" required maxlength="80" value="${user?.name ?? ''}"></label>
      <label class="field"><span>Rôle</span><select name="role">
        <option value="gerant" ${selected(user?.role === 'gerant')}>${ROLE_LABEL.gerant}</option>
        <option value="admin" ${selected(user?.role === 'admin')}>${ROLE_LABEL.admin}</option></select></label>
      ${editing
        ? html`<label class="check"><input type="checkbox" name="active" value="1" ${checked(user.active)}><span>Compte actif</span></label>`
        : html`<label class="field"><span>Mot de passe provisoire</span><input type="password" name="password" required minlength="10" autocomplete="new-password">
          <span class="help">10 caractères minimum ; à communiquer à la personne, qui pourra le changer.</span></label>`}
      <div class="form-error" role="alert" hidden></div>
      <div class="modal-actions"><button type="button" class="btn" data-act="close">Annuler</button>
        <button type="submit" class="btn btn-primary">${editing ? 'Enregistrer' : 'Créer le compte'}</button></div>
    </form>`, {
    forms: {
      user: (f) => submitForm(f, async () => {
        const v = formValues(f);
        if (editing) await api.put(`/api/users/${user.id}`, { name: v.name, role: v.role, active: Boolean(v.active) }, key);
        else await api.post('/api/users', { login: v.login, name: v.name, role: v.role, password: v.password }, key);
        m.close();
        toast(editing ? 'Utilisateur modifié.' : 'Compte créé.');
        onDone?.();
      }),
    },
  });
}

function passwordResetDialog(user) {
  const key = newKey();
  const m = openModal({ title: `Nouveau mot de passe — ${user.name}` });
  m.render(html`
    <form data-form="reset" class="form-grid" novalidate>
      <label class="field"><span>Mot de passe provisoire</span><input type="password" name="password" required minlength="10" autocomplete="new-password"></label>
      <p class="subtle">Les sessions ouvertes de ce compte seront fermées.</p>
      <div class="form-error" role="alert" hidden></div>
      <div class="modal-actions"><button type="button" class="btn" data-act="close">Annuler</button>
        <button type="submit" class="btn btn-primary">Enregistrer</button></div>
    </form>`, {
    forms: {
      reset: (f) => submitForm(f, async () => {
        await api.post(`/api/users/${user.id}/password`, { password: f.password.value }, key);
        m.close();
        toast('Mot de passe réinitialisé.');
      }),
    },
  });
}

export async function settingsView(ctx) {
  const [users, audit] = await Promise.all([api.get('/api/users'), api.get('/api/audit?limit=150')]);
  const s = state.settings;
  const t = s.overtime_tariff;
  const save = async (patch, message = 'Paramètres enregistrés.') => {
    const bundle = await api.put('/api/settings', patch);
    toast(message);
    ctx.reloadShell(bundle);
  };
  const sections = [['sec-club', 'Club'], ['sec-hours', 'Horaires'], ['sec-tariffs', 'Tarifs'], ['sec-plans', 'Formules'],
    ['sec-rules', 'Règles à confirmer'], ['sec-payments', 'Paiements'], ['sec-demo', 'Mode démonstration'], ['sec-users', 'Utilisateurs'], ['sec-audit', 'Journal']];
  const formFooter = html`<div class="form-error" role="alert" hidden></div><div><button class="btn btn-primary" type="submit">Enregistrer</button></div>`;

  ctx.render(html`
    <div class="page-head"><div><h1>Paramètres</h1><p class="lead">Réservés aux administrateurs. Les éléments marqués « hypothèse » ou « à définir » attendent une décision.</p></div></div>
    <nav class="settings-nav" aria-label="Sections">${sections.map(([id, label]) => html`<button class="btn btn-sm" data-act="jump" data-id="${id}">${label}</button>`)}</nav>

    <section class="card settings-section" id="sec-club">
      <div class="card-head"><h2>Club</h2></div>
      <form data-form="club" class="form-grid" novalidate>
        <label class="field"><span>Nom du club ${hypothesis('Nom, logo et charte graphique non fournis.', 'à définir')}</span>
          <input name="club_name" value="${s.club_name}" required maxlength="80"></label>
        <div class="form-row">
          <label class="field"><span>Libellé de la devise</span>
            <input name="currency_label" value="${s.currency.label}" required maxlength="12"></label>
          <label class="field"><span>Décimales affichées</span><select name="currency_decimals">
            <option value="0" ${selected(s.currency.decimals === 0)}>0 (ex. 25 000)</option><option value="2" ${selected(s.currency.decimals === 2)}>2 (ex. 25 000,00)</option></select></label>
          <label class="field"><span>Fuseau horaire</span><input name="timezone" list="tz-list" value="${s.timezone}" required>
            <datalist id="tz-list">${TIME_ZONES.map((z) => html`<option value="${z}"></option>`)}</datalist></label>
        </div>
        <p class="subtle">Les montants sont enregistrés de façon exacte : changer le libellé de la devise ne modifie aucune valeur.</p>
        ${formFooter}
      </form>
    </section>

    <section class="card settings-section" id="sec-hours">
      <div class="card-head"><h2>Horaires et créneaux</h2></div>
      <form data-form="hours" class="form-grid" novalidate>
        <div class="form-row">
          <label class="field"><span>Ouverture</span><input name="open" value="${s.hours.open}" pattern="\\d{1,2}:\\d{2}" required></label>
          <label class="field"><span>Fermeture habituelle</span><input name="close" value="${s.hours.close}" pattern="\\d{1,2}:\\d{2}" required><span class="help">24:00 = minuit</span></label>
          <label class="field"><span>Fin maximale de prolongation</span><input name="max_end" value="${s.hours.max_end}" pattern="\\d{1,2}:\\d{2}" required><span class="help">heure du lendemain</span></label>
        </div>
        <div class="form-row">
          <label class="field"><span>Créneaux</span><select name="slot_min">${[15, 30, 60].map((n) => html`<option value="${n}" ${selected(s.booking.slot_min === n)}>${n} min</option>`)}</select></label>
          <label class="field"><span>Durée minimale</span><select name="min_duration_min">${[30, 60, 90, 120].map((n) => html`<option value="${n}" ${selected(s.booking.min_duration_min === n)}>${fmtDuration(n)}</option>`)}</select></label>
          <label class="field"><span>Pas de prolongation</span><select name="extension_step_min">${[15, 30, 60].map((n) => html`<option value="${n}" ${selected(s.booking.extension_step_min === n)}>${n} min</option>`)}</select></label>
        </div>
        <label class="check"><input type="checkbox" name="manager_can_authorize_off_hours" value="1" ${checked(s.manager_can_authorize_off_hours)}>
          <span>Le gérant peut autoriser un dépassement des horaires habituels ${hypothesis('Rôle habilité à autoriser les prolongations après la fermeture : à confirmer.')}</span></label>
        <p class="subtle">Horaires envisagés : 10 h à minuit, prolongation possible jusqu’à 2 h, 3 h, 4 h ou 5 h. Créneaux de 30 min et minimum d’une heure : hypothèses de la version 1.</p>
        ${formFooter}
      </form>
    </section>

    <section class="card settings-section" id="sec-tariffs">
      <div class="card-head"><h2>Tarif du temps supplémentaire</h2>
        ${t.validated ? html`<span class="chip chip-ok">validé${t.validated_by ? ` par ${t.validated_by}` : ''}${t.validated_at ? `, ${dateTime(t.validated_at)}` : ''}</span>`
          : html`<span class="chip chip-warn">non validé</span>`}</div>
      <form data-form="tariff" class="form-grid" novalidate>
        <div class="form-row">
          <label class="field"><span>Heure complète (${s.currency.label})</span><input name="hour" inputmode="decimal" value="${toMajor(t.hour)}" required></label>
          <label class="field"><span>Demi-heure restante (${s.currency.label})</span><input name="half" inputmode="decimal" value="${toMajor(t.half)}" required></label>
        </div>
        <label class="check"><input type="checkbox" name="validated" value="1" ${checked(t.validated)}><span>Je valide ce tarif pour une utilisation réelle</span></label>
        <p class="subtle">Montants annoncés dans les messages audio (25 000 l’heure, 15 000 la demi-heure). Exemple : 90 minutes payantes = 1 heure + 1 demi-heure.
          Un changement de tarif ne recalcule pas les réservations déjà confirmées.</p>
        ${formFooter}
      </form>
    </section>

    <section class="card settings-section" id="sec-plans">
      <div class="card-head"><h2>Formules</h2></div>
      <div class="grid-2">${state.plans.map((p) => html`
        <form data-form="plan" data-id="${p.id}" class="plan-box" novalidate>
          <div class="row"><strong>${p.code}</strong><span class="spacer"></span>
            ${p.price == null ? html`<span class="chip chip-danger">prix non défini</span>` : p.price_validated
              ? html`<span class="chip chip-ok">prix validé${p.price_validated_by_name ? ` par ${p.price_validated_by_name}` : ''}</span>` : html`<span class="chip chip-warn">prix à confirmer</span>`}</div>
          <label class="field"><span>Nom</span><input name="name" value="${p.name}" required maxlength="80"></label>
          <div class="form-row">
            <label class="field"><span>Heures incluses</span><input type="number" name="hours" min="0" step="0.5" value="${p.included_minutes / 60}" required></label>
            <label class="field"><span>Durée</span><input value="${p.duration_months} mois" readonly></label>
            <label class="field"><span>Prix (${s.currency.label})</span><input name="price" inputmode="decimal" value="${toMajor(p.price)}" placeholder="non défini"></label>
          </div>
          <label class="field"><span>Note</span><input name="price_note" value="${p.price_note ?? ''}" maxlength="300"></label>
          <label class="check"><input type="checkbox" name="price_validated" value="1" ${checked(p.price_validated)}><span>Prix validé pour une utilisation réelle</span></label>
          <label class="check"><input type="checkbox" name="active" value="1" ${checked(p.active)}><span>Formule proposée</span></label>
          ${formFooter}
        </form>`)}</div>
      <p class="subtle" style="margin-top:10px">Le prix annuel n’est pas déduit du prix mensuel. Une modification ne s’applique qu’aux nouvelles activations.</p>
    </section>

    <section class="card settings-section" id="sec-rules">
      <div class="card-head"><h2>Règles à confirmer</h2></div>
      <form data-form="rules" class="form-grid" novalidate>
        <div class="form-row">
          <label class="field"><span>Attribution des 24 h annuelles ${hypothesis('Mode d’attribution à confirmer.')}</span><select name="annual_allocation_mode">
            <option value="activation" ${selected(s.annual_allocation_mode === 'activation')}>Toutes disponibles dès l’activation</option>
            <option value="mensuelle" ${selected(s.annual_allocation_mode === 'mensuelle')}>2 h attribuées chaque mois</option></select>
            <span class="help">S’applique aux nouvelles activations.</span></label>
          <label class="field"><span>Sous-compte des ventes de formules ${hypothesis('Rattachement des ventes de cartes à valider.')}</span><select name="subscription_revenue_account">
            ${Object.entries(ACCOUNT_LABEL).map(([k, label]) => html`<option value="${k}" ${selected(s.subscription_revenue_account === k)}>${label}</option>`)}</select></label>
        </div>
        <div class="form-row">
          <label class="field"><span>Alerte d’expiration (jours)</span><input type="number" name="expiry_warning_days" min="1" max="90" value="${s.expiry_warning_days}"></label>
          <label class="field"><span>Seuil d’alerte de stock par défaut</span><input type="number" name="low_stock_default" min="0" value="${s.low_stock_default}"></label>
        </div>
        <label class="check"><input type="checkbox" name="refunds_admin_only" value="1" ${checked(s.refunds_admin_only)}>
          <span>Remboursements réservés aux administrateurs ${hypothesis('Règles de remboursement à valider.')}</span></label>
        <dl class="kv">
          <dt>Report des heures</dt><dd>Non géré : les heures non utilisées expirent avec la formule.</dd>
          <dt>Suspension, renouvellement auto.</dt><dd>Non gérés : renouvellement manuel avec historique.</dd>
          <dt>Annulation tardive</dt><dd>Aucun frais : l’annulation libère les heures engagées.</dd>
          <dt>Paiements partiels</dt><dd>Non gérés : chaque ligne est encaissée intégralement.</dd>
          <dt>Répartition entre associés</dt><dd>À définir.</dd>
          <dt>Comptabilité</dt><dd>Suivi des recettes uniquement ; reconnaissance des revenus d’abonnement à définir.</dd>
        </dl>
        ${formFooter}
      </form>
    </section>

    <section class="card settings-section" id="sec-payments">
      <div class="card-head"><h2>Moyens de paiement</h2></div>
      <form data-form="methods" class="form-grid" novalidate>
        <label class="field"><span>Un moyen par ligne ${hypothesis('Moyens de paiement réels à confirmer. Paiements enregistrés manuellement en version 1.')}</span>
          <textarea name="methods" rows="5">${s.payment_methods.join('\n')}</textarea></label>
        ${formFooter}
      </form>
    </section>

    <section class="card settings-section" id="sec-demo">
      <div class="card-head"><h2>Mode démonstration</h2>${s.demo_mode ? html`<span class="chip chip-bronze">activé</span>` : html`<span class="chip chip-ok">utilisation réelle</span>`}</div>
      <p>En mode démonstration, les tarifs non validés et la formule annuelle sans prix restent utilisables et sont signalés.
        Hors démonstration, toute opération fondée sur un tarif non validé ou non défini est refusée par le serveur.</p>
      <div class="row" style="margin-top:12px">
        <button class="btn ${s.demo_mode ? 'btn-primary' : ''}" data-act="demo">${s.demo_mode ? 'Passer en utilisation réelle' : 'Réactiver le mode démonstration'}</button>
      </div>
    </section>

    <section class="card settings-section" id="sec-users">
      <div class="card-head"><h2>Utilisateurs</h2><button class="btn btn-sm btn-primary" data-act="new-user">${icon('plus')} Nouvel utilisateur</button></div>
      <div class="table-wrap"><table class="table stack-sm">
        <thead><tr><th>Nom</th><th>Identifiant</th><th>Rôle</th><th>Dernière connexion</th><th><span class="sr-only">Actions</span></th></tr></thead>
        <tbody>${users.map((u) => html`<tr class="${u.active ? '' : 'is-muted'}">
          <td data-label="Nom"><strong>${u.name}</strong> ${u.active ? '' : html`<span class="chip">désactivé</span>`} ${u.id === state.me.id ? html`<span class="chip chip-bronze">vous</span>` : ''}</td>
          <td data-label="Identifiant" class="mono">${u.login}</td>
          <td data-label="Rôle">${ROLE_LABEL[u.role]}</td>
          <td data-label="Dernière connexion">${u.last_login_at ? dateTime(u.last_login_at) : 'jamais'}</td>
          <td class="actions"><button class="btn btn-sm btn-ghost" data-act="edit-user" data-id="${u.id}">Modifier</button>
            <button class="btn btn-sm btn-ghost" data-act="reset-user" data-id="${u.id}">Mot de passe</button></td></tr>`)}</tbody>
      </table></div>
      <p class="subtle" style="margin-top:8px">Gérant : membres, cartes, réservations, consommations, encaissements et mouvements de stock.
        Administrateur : en plus, paramètres, tarifs, formules, produits, utilisateurs, sous-comptes et exports. Contrôlé côté serveur.</p>
    </section>

    <section class="card settings-section" id="sec-audit">
      <div class="card-head"><h2>Journal des opérations</h2><span class="subtle">150 dernières</span></div>
      <div class="table-wrap"><table class="table stack-sm">
        <thead><tr><th>Date</th><th>Utilisateur</th><th>Opération</th><th>Détail</th></tr></thead>
        <tbody>${audit.map((a) => html`<tr>
          <td data-label="Date" class="nowrap">${dateTime(a.at)}</td>
          <td data-label="Utilisateur">${a.user_name ?? 'système'}</td>
          <td data-label="Opération">${a.entity === 'reservation' && a.entity_id ? html`<a href="#/reservations/${a.entity_id}">${ACTION_LABELS[a.action] ?? a.action}</a>`
            : a.entity === 'member' && a.entity_id ? html`<a href="#/membres/${a.entity_id}">${ACTION_LABELS[a.action] ?? a.action}</a>` : (ACTION_LABELS[a.action] ?? a.action)}</td>
          <td data-label="Détail" class="subtle">${auditSummary(a)}</td></tr>`)}</tbody>
      </table></div>
    </section>`, {
    actions: {
      jump: (el) => document.getElementById(el.dataset.id)?.scrollIntoView({ behavior: 'smooth', block: 'start' }),
      demo: () => actionDialog({
        title: s.demo_mode ? 'Passer en utilisation réelle' : 'Réactiver le mode démonstration',
        message: s.demo_mode
          ? 'Les opérations fondées sur un tarif non validé ou un prix non défini seront refusées. Pensez à remplacer les données fictives et à valider les tarifs.'
          : 'Les tarifs non validés redeviendront utilisables (signalés).',
        confirmLabel: 'Confirmer',
        run: () => save({ demo_mode: !s.demo_mode }, 'Mode mis à jour.'),
      }),
      'new-user': () => userDialog(null, () => ctx.refresh()),
      'edit-user': (el) => userDialog(users.find((u) => u.id === Number(el.dataset.id)), () => ctx.refresh()),
      'reset-user': (el) => passwordResetDialog(users.find((u) => u.id === Number(el.dataset.id))),
    },
    forms: {
      club: (f) => submitForm(f, async () => {
        const v = formValues(f);
        await save({ club_name: v.club_name, currency: { label: v.currency_label, decimals: Number(v.currency_decimals) }, timezone: v.timezone });
      }),
      hours: (f) => submitForm(f, async () => {
        const v = formValues(f);
        await save({
          hours: { open: v.open, close: v.close, max_end: v.max_end },
          booking: { slot_min: Number(v.slot_min), min_duration_min: Number(v.min_duration_min), extension_step_min: Number(v.extension_step_min) },
          manager_can_authorize_off_hours: Boolean(v.manager_can_authorize_off_hours),
        });
      }),
      tariff: (f) => submitForm(f, async () => {
        const v = formValues(f);
        await save({ overtime_tariff: { hour: money2minor(v.hour, 'Heure'), half: money2minor(v.half, 'Demi-heure'), validated: Boolean(v.validated) } });
      }),
      plan: (f) => submitForm(f, async () => {
        const v = formValues(f);
        const hours = Number(v.hours);
        if (!Number.isFinite(hours) || hours < 0) throw new Error('Heures incluses invalides.');
        const price = String(v.price ?? '').trim() === '' ? null : money2minor(v.price, 'Prix');
        const bundle = await api.put(`/api/plans/${f.dataset.id}`, {
          name: v.name, included_minutes: Math.round(hours * 60), price, price_note: v.price_note,
          price_validated: Boolean(v.price_validated), active: Boolean(v.active),
        });
        toast('Formule enregistrée.');
        ctx.reloadShell(bundle);
      }),
      rules: (f) => submitForm(f, async () => {
        const v = formValues(f);
        await save({
          annual_allocation_mode: v.annual_allocation_mode, subscription_revenue_account: v.subscription_revenue_account,
          expiry_warning_days: Number(v.expiry_warning_days), low_stock_default: Number(v.low_stock_default),
          refunds_admin_only: Boolean(v.refunds_admin_only),
        });
      }),
      methods: (f) => submitForm(f, async () => {
        const list = f.methods.value.split('\n').map((x) => x.trim()).filter(Boolean);
        await save({ payment_methods: list });
      }),
    },
  });
}
