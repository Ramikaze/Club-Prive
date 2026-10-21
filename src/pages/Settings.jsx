import { useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import Icon from '../components/ui/Icon.jsx';
import { AdminTabs, Empty, FormError, Loaded, Notice, PageHead, Segmented } from '../components/ui/ui.jsx';
import { Modal, actionDialog, openDialog } from '../components/ui/Modal.jsx';
import { toast } from '../components/ui/toast.jsx';
import { api, newKey } from '../lib/api.js';
import { ACCOUNT_LABEL, ROLE_LABEL, dateTime, fmtDuration, parseMoney, toMajor } from '../lib/format.js';
import { ACTION_LABELS, auditSummary } from '../lib/audit.js';
import { useBusy, useLoad, useSubmit } from '../lib/hooks.js';
import { useIsAdmin, useSettings, useStore } from '../store/useStore.js';

const TIME_ZONES = ['Africa/Brazzaville', 'Africa/Kinshasa', 'Africa/Douala', 'Africa/Lagos', 'Africa/Abidjan', 'Africa/Casablanca',
  'Europe/Paris', 'Europe/Brussels', 'Europe/London', 'America/Montreal', 'America/New_York', 'Asia/Dubai', 'UTC'];

const SETTINGS_TABS = [
  ['club', 'Club & Horaires'],
  ['tarifs', 'Tarifs & Formules'],
  ['finances', 'Paiements & Catégories'],
  ['systeme', 'Équipe & Système'],
];

const CATEGORY_KIND = { depense: 'Dépense', recette: 'Entrée diverse' };

const formValues = (form) => Object.fromEntries(new FormData(form));

const money2minor = (text, label) => {
  const v = parseMoney(text);
  if (v == null) throw new Error(`${label} : montant invalide (exemple : 25000 ou 25000,50).`);
  return v;
};

// Opening balance: empty means 0; a leading minus is allowed (overdrawn account).
const balance2minor = (text, label) => {
  const t = String(text ?? '').trim();
  if (t === '') return 0;
  if (t.startsWith('-')) return -money2minor(t.slice(1), label);
  return money2minor(t, label);
};

// Reads the form values synchronously, then runs `handler(values)` as a busy submission.
function useFormAction(handler) {
  const { busy, error, submit } = useSubmit();
  const onSubmit = (e) => {
    e.preventDefault();
    const v = formValues(e.currentTarget);
    submit(() => handler(v));
  };
  return { busy, error, onSubmit };
}

function FormFooter({ busy, error }) {
  return (
    <>
      <FormError error={error} />
      <div><button className="btn btn-primary" type="submit" disabled={busy} aria-busy={busy}>Enregistrer</button></div>
    </>
  );
}

// ---------------------------------------------------------------- dialogs

function UserDialog({ close, user, onDone }) {
  const editing = Boolean(user);
  const [key] = useState(newKey);
  const { busy, error, onSubmit } = useFormAction(async (v) => {
    if (editing) await api.put(`/api/users/${user.id}`, { name: v.name, role: v.role, active: Boolean(v.active) }, key);
    else await api.post('/api/users', { login: v.login, name: v.name, role: v.role, password: v.password }, key);
    close();
    toast(editing ? 'Utilisateur modifié.' : 'Compte créé.');
    onDone?.();
  });
  return (
    <Modal title={editing ? `Modifier ${user.name}` : 'Nouvel utilisateur'} onClose={close}>
      <form className="form-grid" onSubmit={onSubmit} noValidate>
        {!editing && (
          <label className="field"><span>Identifiant de connexion</span><input name="login" required maxLength={40} autoCapitalize="none" autoComplete="off"
            pattern="[a-zA-Z0-9._-]{3,40}" /><span className="help">3 à 40 caractères : lettres, chiffres, point, tiret.</span></label>
        )}
        <label className="field"><span>Nom affiché</span><input name="name" required maxLength={80} defaultValue={user?.name ?? ''} /></label>
        <label className="field"><span>Rôle</span><select name="role" defaultValue={user?.role === 'admin' ? 'admin' : 'gerant'}>
          <option value="gerant">{ROLE_LABEL.gerant}</option>
          <option value="admin">{ROLE_LABEL.admin}</option></select></label>
        {editing
          ? <label className="check"><input type="checkbox" name="active" value="1" defaultChecked={user.active} /><span>Compte actif</span></label>
          : (
            <label className="field"><span>Mot de passe provisoire</span><input type="password" name="password" required minLength={10} autoComplete="new-password" />
              <span className="help">10 caractères minimum ; à communiquer à la personne, qui pourra le changer.</span></label>
          )}
        <FormError error={error} />
        <div className="modal-actions"><button type="button" className="btn" onClick={close}>Annuler</button>
          <button type="submit" className="btn btn-primary" disabled={busy} aria-busy={busy}>{editing ? 'Enregistrer' : 'Créer le compte'}</button></div>
      </form>
    </Modal>
  );
}

function PasswordResetDialog({ close, user }) {
  const [key] = useState(newKey);
  const { busy, error, onSubmit } = useFormAction(async (v) => {
    await api.post(`/api/users/${user.id}/password`, { password: v.password }, key);
    close();
    toast('Mot de passe réinitialisé.');
  });
  return (
    <Modal title={`Nouveau mot de passe — ${user.name}`} onClose={close}>
      <form className="form-grid" onSubmit={onSubmit} noValidate>
        <label className="field"><span>Mot de passe provisoire</span><input type="password" name="password" required minLength={10} autoComplete="new-password" /></label>
        <p className="subtle">Les sessions ouvertes de ce compte seront fermées.</p>
        <FormError error={error} />
        <div className="modal-actions"><button type="button" className="btn" onClick={close}>Annuler</button>
          <button type="submit" className="btn btn-primary" disabled={busy} aria-busy={busy}>Enregistrer</button></div>
      </form>
    </Modal>
  );
}

function RenameCategoryDialog({ close, category, onDone }) {
  const [key] = useState(newKey);
  const { busy, error, onSubmit } = useFormAction(async (v) => {
    const list = await api.put(`/api/ledger/categories/${category.id}`, { name: v.name }, key);
    close();
    toast('Catégorie renommée.');
    onDone?.(list);
  });
  return (
    <Modal title={`Renommer « ${category.name} »`} onClose={close}>
      <form className="form-grid" onSubmit={onSubmit} noValidate>
        <label className="field"><span>Nom de la catégorie</span><input name="name" required maxLength={60} defaultValue={category.name} /></label>
        <p className="subtle">Le nouveau nom s’affiche aussi sur les opérations déjà enregistrées.</p>
        <FormError error={error} />
        <div className="modal-actions"><button type="button" className="btn" onClick={close}>Annuler</button>
          <button type="submit" className="btn btn-primary" disabled={busy} aria-busy={busy}>Enregistrer</button></div>
      </form>
    </Modal>
  );
}

function ResetDialog({ close, onDone }) {
  const [key] = useState(newKey);
  const [confirm, setConfirm] = useState('');
  const { busy, error, submit } = useSubmit();
  const onSubmit = (e) => {
    e.preventDefault();
    submit(async () => {
      if (confirm !== 'EFFACER') throw new Error('Pour confirmer, saisissez EFFACER en majuscules.');
      await api.post('/api/admin/reset', { confirm }, key);
      close();
      toast('Toutes les données ont été effacées.');
      onDone?.();
    });
  };
  return (
    <Modal title="Effacer toutes les données" onClose={close}>
      <form className="form-grid" onSubmit={onSubmit} noValidate>
        <Notice kind="danger">Opération définitive : les données effacées ne peuvent pas être récupérées. Utilisez-la pour repartir d’un club vide, par exemple après une démonstration.</Notice>
        <dl className="kv">
          <dt>Supprimés</dt>
          <dd>membres, cartes, abonnements, réservations, encaissements, remboursements, produits, stocks, caves et relevés, dépenses, clôtures, historique et soldes d’ouverture.</dd>
          <dt>Conservés</dt>
          <dd>comptes utilisateurs, paramètres, formules, catégories.</dd>
        </dl>
        <label className="field"><span>Pour confirmer, saisissez EFFACER</span>
          <input value={confirm} onChange={(e) => setConfirm(e.target.value)} autoComplete="off" autoCapitalize="characters" spellCheck={false} /></label>
        <FormError error={error} />
        <div className="modal-actions"><button type="button" className="btn" onClick={close}>Annuler</button>
          <button type="submit" className="btn btn-danger" disabled={busy || confirm !== 'EFFACER'} aria-busy={busy}>Effacer les données</button></div>
      </form>
    </Modal>
  );
}

// ---------------------------------------------------------------- sections

function ClubSection({ save }) {
  const s = useSettings();
  const { busy, error, onSubmit } = useFormAction((v) => save({
    club_name: v.club_name, currency: { label: v.currency_label, decimals: Number(v.currency_decimals) }, timezone: v.timezone,
  }));
  return (
    <section className="card settings-section" id="sec-club">
      <div className="card-head"><h2>Identité du club</h2></div>
      <form className="form-grid" onSubmit={onSubmit} noValidate>
        <label className="field"><span>Nom du club</span>
          <input name="club_name" defaultValue={s.club_name} required maxLength={80} /></label>
        <div className="form-row">
          <label className="field"><span>Libellé de la devise</span>
            <input name="currency_label" defaultValue={s.currency.label} required maxLength={12} /></label>
          <label className="field"><span>Décimales affichées</span><select name="currency_decimals" defaultValue={String(s.currency.decimals)}>
            <option value="0">0 (ex. 25 000)</option><option value="2">2 (ex. 25 000,00)</option></select></label>
          <label className="field"><span>Fuseau horaire</span><input name="timezone" list="tz-list" defaultValue={s.timezone} required />
            <datalist id="tz-list">{TIME_ZONES.map((z) => <option key={z} value={z} />)}</datalist></label>
        </div>
        <FormFooter busy={busy} error={error} />
      </form>
    </section>
  );
}

function RoomDialog({ close, room, onDone }) {
  const editing = Boolean(room);
  const [key] = useState(newKey);
  const { busy, error, onSubmit } = useFormAction(async (v) => {
    const body = {
      name: v.name,
      capacity: Number(v.capacity) || 4,
      description: v.description,
      active: editing ? Boolean(v.active) : true,
    };
    const list = editing
      ? await api.put(`/api/rooms/${room.id}`, body, key)
      : await api.post('/api/rooms', body, key);
    close();
    toast(editing ? 'Salle modifiée.' : 'Salle ajoutée.');
    onDone?.(list);
  });
  return (
    <Modal title={editing ? `Modifier ${room.name}` : 'Nouvelle salle'} onClose={close}>
      <form className="form-grid" onSubmit={onSubmit} noValidate>
        <div className="form-row">
          <label className="field"><span>Nom de la salle</span><input name="name" required maxLength={80} defaultValue={room?.name ?? ''} placeholder="Ex. Salon Privé" /></label>
          <label className="field"><span>Capacité (personnes)</span><input type="number" name="capacity" min="1" max="100" required defaultValue={room?.capacity ?? 6} /></label>
        </div>
        <label className="field"><span>Description (facultatif)</span><input name="description" maxLength={200} defaultValue={room?.description ?? ''} placeholder="Ex. Fauteuils club, table basse, cave dédiée" /></label>
        {editing ? (
          <label className="check"><input type="checkbox" name="active" value="1" defaultChecked={room.active} /><span>Salle disponible à la réservation</span></label>
        ) : null}
        <FormError error={error} />
        <div className="modal-actions"><button type="button" className="btn" onClick={close}>Annuler</button>
          <button type="submit" className="btn btn-primary" disabled={busy} aria-busy={busy}>{editing ? 'Enregistrer' : 'Ajouter la salle'}</button></div>
      </form>
    </Modal>
  );
}

function RoomsSection() {
  const rooms = useStore((st) => st.rooms);
  const updateRooms = (list) => useStore.setState({ rooms: list });
  const onDelete = (rm) => actionDialog({
    title: `Supprimer ${rm.name}`,
    danger: true,
    confirmLabel: 'Supprimer la salle',
    message: `Confirmer la suppression de la salle « ${rm.name} » ?`,
    run: async () => {
      const list = await api.del(`/api/rooms/${rm.id}`, {});
      updateRooms(list);
      toast('Salle supprimée.');
    },
  });
  return (
    <section className="card settings-section" id="sec-rooms">
      <div className="card-head">
        <h2>Salles & Salons</h2>
        <button type="button" className="btn btn-sm btn-primary" onClick={() => openDialog(RoomDialog, { room: null, onDone: updateRooms })}>
          <Icon name="plus" /> Nouvelle salle
        </button>
      </div>
      <div className="table-wrap">
        <table className="table stack-sm">
          <thead><tr><th>Salle</th><th>Capacité</th><th>Description</th><th>État</th><th><span className="sr-only">Actions</span></th></tr></thead>
          <tbody>
            {rooms.map((rm) => (
              <tr key={rm.id} className={rm.active ? undefined : 'is-muted'}>
                <td data-label="Salle"><strong>{rm.name}</strong></td>
                <td data-label="Capacité">{rm.capacity} pers.</td>
                <td data-label="Description" className="subtle">{rm.description || '—'}</td>
                <td data-label="État">{rm.active ? <span className="chip chip-ok">active</span> : <span className="chip">désactivée</span>}</td>
                <td className="actions">
                  <button type="button" className="btn btn-sm btn-ghost" onClick={() => openDialog(RoomDialog, { room: rm, onDone: updateRooms })}>Modifier</button>{' '}
                  {rooms.length > 1 && (
                    <button type="button" className="btn btn-sm btn-danger" onClick={() => onDelete(rm)}>Supprimer</button>
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

function HoursSection({ save }) {
  const s = useSettings();
  const { busy, error, onSubmit } = useFormAction((v) => save({
    hours: { open: v.open, close: v.close, max_end: v.max_end },
    booking: { slot_min: Number(v.slot_min), min_duration_min: Number(v.min_duration_min), extension_step_min: Number(v.extension_step_min) },
    manager_can_authorize_off_hours: Boolean(v.manager_can_authorize_off_hours),
  }));
  return (
    <section className="card settings-section" id="sec-hours">
      <div className="card-head"><h2>Horaires et créneaux</h2></div>
      <form className="form-grid" onSubmit={onSubmit} noValidate>
        <div className="form-row">
          <label className="field"><span>Ouverture</span><input name="open" defaultValue={s.hours.open} pattern="\d{1,2}:\d{2}" required /></label>
          <label className="field"><span>Fermeture habituelle</span><input name="close" defaultValue={s.hours.close} pattern="\d{1,2}:\d{2}" required /><span className="help">24:00 = minuit</span></label>
          <label className="field"><span>Fin maximale de prolongation</span><input name="max_end" defaultValue={s.hours.max_end} pattern="\d{1,2}:\d{2}" required /><span className="help">heure du lendemain</span></label>
        </div>
        <div className="form-row">
          <label className="field"><span>Créneaux</span><select name="slot_min" defaultValue={s.booking.slot_min}>{[15, 30, 60].map((n) => <option key={n} value={n}>{n} min</option>)}</select></label>
          <label className="field"><span>Durée minimale</span><select name="min_duration_min" defaultValue={s.booking.min_duration_min}>{[30, 60, 90, 120].map((n) => <option key={n} value={n}>{fmtDuration(n)}</option>)}</select></label>
          <label className="field"><span>Pas de prolongation</span><select name="extension_step_min" defaultValue={s.booking.extension_step_min}>{[15, 30, 60].map((n) => <option key={n} value={n}>{n} min</option>)}</select></label>
        </div>
        <label className="check"><input type="checkbox" name="manager_can_authorize_off_hours" value="1" defaultChecked={s.manager_can_authorize_off_hours} />
          <span>Le gérant peut autoriser un dépassement des horaires habituels</span></label>
        <FormFooter busy={busy} error={error} />
      </form>
    </section>
  );
}

function TariffSection({ save }) {
  const s = useSettings();
  const t = s.overtime_tariff;
  const { busy, error, onSubmit } = useFormAction((v) => save({
    overtime_tariff: { hour: money2minor(v.hour, 'Heure'), half: money2minor(v.half, 'Demi-heure'), validated: Boolean(v.validated) },
  }));
  return (
    <section className="card settings-section" id="sec-tariffs">
      <div className="card-head"><h2>Tarif du temps supplémentaire</h2>
        {t.validated
          ? <span className="chip chip-ok">{`validé${t.validated_by ? ` par ${t.validated_by}` : ''}${t.validated_at ? `, ${dateTime(t.validated_at)}` : ''}`}</span>
          : <span className="chip chip-warn">non validé</span>}</div>
      <form className="form-grid" onSubmit={onSubmit} noValidate>
        <div className="form-row">
          <label className="field"><span>Heure complète ({s.currency.label})</span><input name="hour" inputMode="decimal" defaultValue={toMajor(t.hour)} required /></label>
          <label className="field"><span>Demi-heure restante ({s.currency.label})</span><input name="half" inputMode="decimal" defaultValue={toMajor(t.half)} required /></label>
        </div>
        <label className="check"><input type="checkbox" name="validated" value="1" defaultChecked={t.validated} /><span>Je valide ce tarif pour une utilisation réelle</span></label>
        <p className="subtle">Un changement de tarif ne recalcule pas les réservations déjà confirmées.</p>
        <FormFooter busy={busy} error={error} />
      </form>
    </section>
  );
}

function PlanForm({ plan: p, applyBundle }) {
  const s = useSettings();
  const { busy, error, onSubmit } = useFormAction(async (v) => {
    const hours = Number(v.hours);
    if (!Number.isFinite(hours) || hours < 0) throw new Error('Heures incluses invalides.');
    const price = String(v.price ?? '').trim() === '' ? null : money2minor(v.price, 'Prix');
    const bundle = await api.put(`/api/plans/${p.id}`, {
      name: v.name, included_minutes: Math.round(hours * 60), price, price_note: v.price_note,
      price_validated: Boolean(v.price_validated), active: Boolean(v.active),
    });
    toast('Formule enregistrée.');
    applyBundle(bundle);
  });
  let priceChip;
  if (p.price == null) priceChip = <span className="chip chip-danger">prix non défini</span>;
  else if (p.price_validated) priceChip = <span className="chip chip-ok">{`prix validé${p.price_validated_by_name ? ` par ${p.price_validated_by_name}` : ''}`}</span>;
  else priceChip = <span className="chip chip-warn">prix à confirmer</span>;
  return (
    <form className="plan-box" onSubmit={onSubmit} noValidate>
      <div className="row"><strong>{p.code}</strong><span className="spacer" />{priceChip}</div>
      <label className="field"><span>Nom</span><input name="name" defaultValue={p.name} required maxLength={80} /></label>
      <div className="form-row">
        <label className="field"><span>Heures incluses</span><input type="number" name="hours" min="0" step="0.5" defaultValue={p.included_minutes / 60} required /></label>
        <label className="field"><span>Durée</span><input defaultValue={`${p.duration_months} mois`} readOnly /></label>
        <label className="field"><span>Prix ({s.currency.label})</span><input name="price" inputMode="decimal" defaultValue={toMajor(p.price)} placeholder="non défini" /></label>
      </div>
      <label className="field"><span>Note</span><input name="price_note" defaultValue={p.price_note ?? ''} maxLength={300} /></label>
      <label className="check"><input type="checkbox" name="price_validated" value="1" defaultChecked={p.price_validated} /><span>Prix validé pour une utilisation réelle</span></label>
      <label className="check"><input type="checkbox" name="active" value="1" defaultChecked={p.active} /><span>Formule proposée</span></label>
      <FormFooter busy={busy} error={error} />
    </form>
  );
}

function PlansSection({ version, applyBundle }) {
  const plans = useStore((st) => st.plans);
  return (
    <section className="card settings-section" id="sec-plans">
      <div className="card-head"><h2>Formules d’abonnement</h2></div>
      <div className="grid-2">{plans.map((p) => <PlanForm key={`${p.id}-${version}`} plan={p} applyBundle={applyBundle} />)}</div>
      <p className="subtle" style={{ marginTop: 10 }}>Une modification ne s’applique qu’aux nouvelles activations.</p>
    </section>
  );
}

function RulesSection({ save }) {
  const s = useSettings();
  const { busy, error, onSubmit } = useFormAction((v) => save({
    annual_allocation_mode: v.annual_allocation_mode, subscription_revenue_account: v.subscription_revenue_account,
    expiry_warning_days: Number(v.expiry_warning_days), low_stock_default: Number(v.low_stock_default),
    refunds_admin_only: Boolean(v.refunds_admin_only),
  }));
  return (
    <section className="card settings-section" id="sec-rules">
      <div className="card-head"><h2>Règles d’exploitation</h2></div>
      <form className="form-grid" onSubmit={onSubmit} noValidate>
        <div className="form-row">
          <label className="field"><span>Attribution des heures annuelles</span>
            <select name="annual_allocation_mode" defaultValue={s.annual_allocation_mode}>
              <option value="activation">Toutes disponibles dès l’activation</option>
              <option value="mensuelle">2 h attribuées chaque mois</option></select>
            <span className="help">S’applique aux nouvelles activations.</span></label>
          <label className="field"><span>Sous-compte des ventes de formules</span>
            <select name="subscription_revenue_account" defaultValue={s.subscription_revenue_account}>
              {Object.entries(ACCOUNT_LABEL).map(([k, label]) => <option key={k} value={k}>{label}</option>)}</select></label>
        </div>
        <div className="form-row">
          <label className="field"><span>Alerte d’expiration (jours)</span><input type="number" name="expiry_warning_days" min="1" max="90" defaultValue={s.expiry_warning_days} /></label>
          <label className="field"><span>Seuil d’alerte de stock par défaut</span><input type="number" name="low_stock_default" min="0" defaultValue={s.low_stock_default} /></label>
        </div>
        <label className="check"><input type="checkbox" name="refunds_admin_only" value="1" defaultChecked={s.refunds_admin_only} />
          <span>Remboursements réservés aux administrateurs</span></label>
        <FormFooter busy={busy} error={error} />
      </form>
    </section>
  );
}

function PaymentsSection({ save }) {
  const s = useSettings();
  const { busy, error, onSubmit } = useFormAction((v) => save({
    payment_methods: String(v.methods ?? '').split('\n').map((x) => x.trim()).filter(Boolean),
  }));
  return (
    <section className="card settings-section" id="sec-payments">
      <div className="card-head"><h2>Moyens de paiement</h2></div>
      <form className="form-grid" onSubmit={onSubmit} noValidate>
        <label className="field"><span>Un moyen par ligne</span>
          <textarea name="methods" rows={5} defaultValue={s.payment_methods.join('\n')} /></label>
        <FormFooter busy={busy} error={error} />
      </form>
    </section>
  );
}

function TreasurySection({ save }) {
  const s = useSettings();
  const ob = s.opening_balances ?? { date: null, amounts: {} };
  const { busy, error, onSubmit } = useFormAction((v) => {
    const amounts = {};
    s.payment_methods.forEach((method, i) => { amounts[method] = balance2minor(v[`amount-${i}`], method); });
    return save({ opening_balances: { date: v.date || null, amounts } }, 'Soldes d’ouverture enregistrés.');
  });
  return (
    <section className="card settings-section" id="sec-treasury">
      <div className="card-head"><h2>Trésorerie</h2><span className="subtle">soldes d’ouverture</span></div>
      <form className="form-grid" onSubmit={onSubmit} noValidate>
        <label className="field"><span>Date de début du suivi (facultatif)</span><input type="date" name="date" defaultValue={ob.date ?? ''} />
          <span className="help">Vide : depuis le début.</span></label>
        <div className="form-row">{s.payment_methods.map((method, i) => (
          <label key={method} className="field"><span>{method} ({s.currency.label})</span>
            <input name={`amount-${i}`} inputMode="decimal" defaultValue={toMajor(ob.amounts?.[method])} placeholder="0" /></label>
        ))}</div>
        <p className="subtle">Soldes des caisses et comptes au début du suivi. Les mouvements antérieurs à cette date sont ignorés.</p>
        <FormFooter busy={busy} error={error} />
      </form>
    </section>
  );
}

function CategoryTable({ title, rows, busy, onRename, onToggle }) {
  return (
    <div className="stack">
      <h3>{title}</h3>
      {rows.length ? (
        <div className="table-wrap"><table className="table stack-sm">
          <thead><tr><th>Nom</th><th><span className="sr-only">Actions</span></th></tr></thead>
          <tbody>{rows.map((c) => (
            <tr key={c.id} className={c.active ? undefined : 'is-muted'}>
              <td data-label="Nom"><strong>{c.name}</strong> {!c.active && <span className="chip">désactivée</span>}</td>
              <td className="actions">
                <button type="button" className="btn btn-sm btn-ghost" onClick={() => onRename(c)}>Renommer</button>{' '}
                <button type="button" className="btn btn-sm btn-ghost" disabled={busy} onClick={() => onToggle(c)}>{c.active ? 'Désactiver' : 'Activer'}</button>
              </td>
            </tr>
          ))}</tbody>
        </table></div>
      ) : <Empty icon="list">Aucune catégorie.</Empty>}
    </div>
  );
}

function CategoriesSection({ list, onChange }) {
  const toggle = useBusy();
  const { busy, error, submit } = useSubmit();
  const [kind, setKind] = useState('depense');
  const [name, setName] = useState('');
  const onAdd = (e) => {
    e.preventDefault();
    submit(async () => {
      onChange(await api.post('/api/ledger/categories', { kind, name }));
      setName('');
      toast('Catégorie ajoutée.');
    });
  };
  const onToggle = (c) => toggle.run(async () => {
    onChange(await api.put(`/api/ledger/categories/${c.id}`, { active: !c.active }));
    toast(c.active ? 'Catégorie désactivée.' : 'Catégorie activée.');
  });
  const onRename = (c) => openDialog(RenameCategoryDialog, { category: c, onDone: onChange });
  return (
    <section className="card settings-section" id="sec-categories">
      <div className="card-head"><h2>Catégories</h2><span className="subtle">dépenses et entrées diverses</span></div>
      <div className="grid-2">
        <CategoryTable title="Dépenses" rows={list.filter((c) => c.kind === 'depense')} busy={toggle.busy} onRename={onRename} onToggle={onToggle} />
        <CategoryTable title="Entrées diverses" rows={list.filter((c) => c.kind === 'recette')} busy={toggle.busy} onRename={onRename} onToggle={onToggle} />
      </div>
      <form className="form-grid section-gap" onSubmit={onAdd} noValidate>
        <div className="form-row">
          <label className="field"><span>Type</span><select value={kind} onChange={(e) => setKind(e.target.value)}>
            {Object.entries(CATEGORY_KIND).map(([k, label]) => <option key={k} value={k}>{label}</option>)}</select></label>
          <label className="field"><span>Nouvelle catégorie</span><input value={name} onChange={(e) => setName(e.target.value)} required maxLength={60} /></label>
        </div>
        <p className="subtle">Une catégorie désactivée n’est plus proposée à la saisie ; les opérations déjà enregistrées la conservent.</p>
        <FormError error={error} />
        <div><button className="btn btn-primary" type="submit" disabled={busy} aria-busy={busy}><Icon name="plus" /> Ajouter</button></div>
      </form>
    </section>
  );
}

function DemoSection({ save }) {
  const s = useSettings();
  const toggleDemo = () => actionDialog({
    title: s.demo_mode ? 'Passer en utilisation réelle' : 'Réactiver le mode démonstration',
    message: s.demo_mode
      ? 'Les opérations fondées sur un tarif non validé ou un prix non défini seront refusées. Pensez à remplacer les données fictives et à valider les tarifs.'
      : 'Les tarifs non validés redeviendront utilisables (signalés).',
    confirmLabel: 'Confirmer',
    run: () => save({ demo_mode: !s.demo_mode }, 'Mode mis à jour.'),
  });
  return (
    <section className="card settings-section" id="sec-demo">
      <div className="card-head"><h2>Mode démonstration</h2>{s.demo_mode ? <span className="chip chip-bronze">activé</span> : <span className="chip chip-ok">utilisation réelle</span>}</div>
      <p>En mode démonstration, les tarifs non validés et la formule annuelle sans prix restent utilisables et sont signalés. Hors démonstration, toute opération fondée sur un tarif non validé ou non défini est refusée par le serveur.</p>
      <div className="row" style={{ marginTop: 12 }}>
        <button type="button" className={`btn ${s.demo_mode ? 'btn-primary' : ''}`} onClick={toggleDemo}>{s.demo_mode ? 'Passer en utilisation réelle' : 'Réactiver le mode démonstration'}</button>
      </div>
    </section>
  );
}

function DataSection({ applyBundle, onReset }) {
  const { busy, error, submit } = useSubmit();
  const loadDemo = () => submit(async () => {
    const bundle = await api.post('/api/admin/demo', {});
    applyBundle(bundle);
    toast('Données de démonstration chargées.');
  });
  return (
    <section className="card settings-section" id="sec-data">
      <div className="card-head"><h2>Données</h2></div>
      <div className="stack">
        <p>Les données de démonstration (membres, produits, caves et opérations fictifs) se chargent uniquement sur un club vide, en mode démonstration.
          {' '}Pour démarrer en utilisation réelle, effacez toutes les données : les comptes utilisateurs, les paramètres, les formules et les catégories sont conservés.</p>
        <div className="row">
          <button type="button" className="btn" onClick={loadDemo} disabled={busy} aria-busy={busy}><Icon name="database" /> Charger les données de démonstration</button>
          <button type="button" className="btn btn-danger" onClick={() => openDialog(ResetDialog, { onDone: onReset })}><Icon name="reset" /> Effacer toutes les données</button>
        </div>
        <FormError error={error} />
      </div>
    </section>
  );
}

function UsersSection({ users, onChanged }) {
  const me = useStore((st) => st.me);
  return (
    <section className="card settings-section" id="sec-users">
      <div className="card-head"><h2>Utilisateurs</h2>
        <button type="button" className="btn btn-sm btn-primary" onClick={() => openDialog(UserDialog, { user: null, onDone: onChanged })}><Icon name="plus" /> Nouvel utilisateur</button></div>
      <div className="table-wrap"><table className="table stack-sm">
        <thead><tr><th>Nom</th><th>Identifiant</th><th>Rôle</th><th>Dernière connexion</th><th><span className="sr-only">Actions</span></th></tr></thead>
        <tbody>{users.map((u) => (
          <tr key={u.id} className={u.active ? undefined : 'is-muted'}>
            <td data-label="Nom"><strong>{u.name}</strong> {!u.active && <span className="chip">désactivé</span>} {u.id === me.id && <span className="chip chip-bronze">vous</span>}</td>
            <td data-label="Identifiant" className="mono">{u.login}</td>
            <td data-label="Rôle">{ROLE_LABEL[u.role]}</td>
            <td data-label="Dernière connexion">{u.last_login_at ? dateTime(u.last_login_at) : 'jamais'}</td>
            <td className="actions"><button type="button" className="btn btn-sm btn-ghost" onClick={() => openDialog(UserDialog, { user: u, onDone: onChanged })}>Modifier</button>{' '}
              <button type="button" className="btn btn-sm btn-ghost" onClick={() => openDialog(PasswordResetDialog, { user: u })}>Mot de passe</button></td>
          </tr>
        ))}</tbody>
      </table></div>
      <p className="subtle" style={{ marginTop: 8 }}>Gérant : membres, cartes, réservations, consommations, encaissements et mouvements de stock. Administrateur : en plus, paramètres, tarifs, formules, produits, utilisateurs, sous-comptes et exports. Contrôlé côté serveur.</p>
    </section>
  );
}

function AuditSection({ audit }) {
  return (
    <section className="card settings-section" id="sec-audit">
      <div className="card-head"><h2>Journal des opérations</h2><span className="subtle">150 dernières</span></div>
      <div className="table-wrap"><table className="table stack-sm">
        <thead><tr><th>Date</th><th>Utilisateur</th><th>Opération</th><th>Détail</th></tr></thead>
        <tbody>{audit.map((a) => {
          const label = ACTION_LABELS[a.action] ?? a.action;
          let operation = label;
          if (a.entity === 'reservation' && a.entity_id) operation = <Link to={`/reservations/${a.entity_id}`}>{label}</Link>;
          else if (a.entity === 'member' && a.entity_id) operation = <Link to={`/membres/${a.entity_id}`}>{label}</Link>;
          return (
            <tr key={a.id}>
              <td data-label="Date" className="nowrap">{dateTime(a.at)}</td>
              <td data-label="Utilisateur">{a.user_name ?? 'système'}</td>
              <td data-label="Opération">{operation}</td>
              <td data-label="Détail" className="subtle">{auditSummary(a)}</td>
            </tr>
          );
        })}</tbody>
      </table></div>
    </section>
  );
}

// ---------------------------------------------------------------- page

function SettingsPage() {
  const setBundle = useStore((st) => st.setBundle);
  const [searchParams, setSearchParams] = useSearchParams();
  const qTab = searchParams.get('onglet');
  const tab = SETTINGS_TABS.some(([k]) => k === qTab) ? qTab : 'club';
  const state = useLoad(() => Promise.all([
    api.get('/api/users'), api.get('/api/audit?limit=150'), api.get('/api/ledger/categories'),
  ]), []);
  const [version, setVersion] = useState(0);
  const [categories, setCategories] = useState(null);

  const applyBundle = (bundle) => {
    setBundle(bundle);
    setVersion((v) => v + 1);
    state.reload();
  };
  const save = async (patch, message = 'Paramètres enregistrés.') => {
    const bundle = await api.put('/api/settings', patch);
    toast(message);
    applyBundle(bundle);
  };
  const onReset = () => {
    setCategories(null);
    api.get('/api/me').then(applyBundle, (e) => toast(e.message, 'error'));
  };

  return (
    <Loaded state={state}>{([users, audit, loadedCategories]) => (
      <>
        <AdminTabs />
        <PageHead
          title="Paramètres du club"
          lead="Configuration générale, tarifs, moyens de paiement et comptes utilisateurs."
          tour="settings"
        />
        <div className="toolbar">
          <Segmented
            label="Catégorie de paramètres"
            value={tab}
            options={SETTINGS_TABS}
            onChange={(k) => setSearchParams(k === 'club' ? {} : { onglet: k })}
          />
        </div>

        {tab === 'club' && (
          <>
            <RoomsSection />
            <ClubSection key={`club-${version}`} save={save} />
            <HoursSection key={`hours-${version}`} save={save} />
            <RulesSection key={`rules-${version}`} save={save} />
          </>
        )}

        {tab === 'tarifs' && (
          <>
            <TariffSection key={`tariff-${version}`} save={save} />
            <PlansSection version={version} applyBundle={applyBundle} />
          </>
        )}

        {tab === 'finances' && (
          <>
            <PaymentsSection key={`payments-${version}`} save={save} />
            <TreasurySection key={`treasury-${version}`} save={save} />
            <CategoriesSection list={categories ?? loadedCategories} onChange={setCategories} />
          </>
        )}

        {tab === 'systeme' && (
          <>
            <UsersSection users={users} onChanged={() => state.reload()} />
            <DemoSection save={save} />
            <DataSection applyBundle={(bundle) => { setCategories(null); applyBundle(bundle); }} onReset={onReset} />
            <AuditSection audit={audit} />
          </>
        )}
      </>
    )}</Loaded>
  );
}

export default function Settings() {
  const admin = useIsAdmin();
  if (!admin) {
    return <div className="card"><div className="empty"><Icon name="alert" /><p>Cette page est réservée aux administrateurs.</p></div></div>;
  }
  return <SettingsPage />;
}

