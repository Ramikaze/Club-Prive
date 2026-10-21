// Member dialogs: member record, subscription, card and credit adjustment. Each dialog keeps one
// idempotency key for its whole life, so a retry never records the operation twice.
import { useMemo, useState } from 'react';
import { api, newKey } from '../lib/api.js';
import { money, fmtDuration, dayLabel, bizToday, subStateLabel } from '../lib/format.js';
import { useStore, useSettings } from '../store/useStore.js';
import { openDialog, Modal, actionDialog } from '../components/ui/Modal.jsx';
import { toast } from '../components/ui/toast.jsx';
import { Notice, FormError } from '../components/ui/ui.jsx';
import { useSubmit } from '../lib/hooks.js';
import { addDays, addMonths } from '../../shared/time.js';

const planLabel = (p) => {
  const price = p.price == null ? 'prix non défini' : money(p.price);
  return `${p.name} (${price})`;
};

const useActivePlans = () => {
  const plans = useStore((st) => st.plans);
  return useMemo(() => plans.filter((p) => p.active), [plans]);
};

// ---------------------------------------------------------------- member record

function MemberDialog({ close, member, onDone }) {
  const editing = Boolean(member);
  const [key] = useState(newKey);
  const [subKey] = useState(newKey);
  const plans = useActivePlans();
  const { busy, error, submit } = useSubmit();
  const [v, setV] = useState(() => ({
    first_name: member?.first_name ?? '',
    last_name: member?.last_name ?? '',
    phone: member?.phone ?? '',
    email: member?.email ?? '',
    notes: member?.notes ?? '',
    plan_id: '',
    start_date: bizToday(),
  }));
  const field = (name) => ({ name, value: v[name], onChange: (e) => setV((prev) => ({ ...prev, [name]: e.target.value })) });

  const onSubmit = (e) => {
    e.preventDefault();
    submit(async () => {
      const body = { first_name: v.first_name, last_name: v.last_name, phone: v.phone, email: v.email, notes: v.notes };
      if (editing) {
        const res = await api.put(`/api/members/${member.id}`, body, key);
        close();
        toast('Fiche enregistrée.');
        onDone?.(res);
        return;
      }
      const created = await api.post('/api/members', body, key);
      let result = created;
      if (v.plan_id) {
        try {
          result = (await api.post(`/api/members/${created.id}/subscriptions`, { plan_id: Number(v.plan_id), start_date: v.start_date }, subKey)).member;
        } catch (err) {
          toast(`Membre créé, mais formule non activée : ${err.message}`, 'error');
        }
      }
      close();
      toast(`Membre ${created.member_no} créé.`);
      onDone?.(result);
    });
  };

  return (
    <Modal title={editing ? 'Modifier la fiche' : 'Nouveau membre'} size="wide" onClose={close}>
      <form className="form-grid" onSubmit={onSubmit} noValidate>
        <div className="form-row">
          <label className="field"><span>Prénom</span><input {...field('first_name')} required maxLength={60} autoComplete="off" /></label>
          <label className="field"><span>Nom</span><input {...field('last_name')} required maxLength={60} autoComplete="off" /></label>
        </div>
        <div className="form-row">
          <label className="field"><span>Téléphone</span><input {...field('phone')} type="tel" required maxLength={30} autoComplete="off" /></label>
          <label className="field"><span>Courriel (facultatif)</span><input {...field('email')} type="email" maxLength={120} autoComplete="off" /></label>
        </div>
        <label className="field"><span>Notes (facultatif)</span><textarea {...field('notes')} maxLength={500} /></label>
        {editing ? null : (
          <fieldset><legend>Formule (facultatif)</legend><div className="form-row">
            <label className="field"><span>Formule</span><select {...field('plan_id')}><option value="">— Plus tard —</option>
              {plans.map((p) => <option key={p.id} value={p.id}>{planLabel(p)}</option>)}</select></label>
            <label className="field"><span>Début de validité</span><input type="date" {...field('start_date')} /></label>
          </div></fieldset>
        )}
        <FormError error={error} />
        <div className="modal-actions"><button type="button" className="btn" onClick={close}>Annuler</button>
          <button type="submit" className="btn btn-primary" disabled={busy} aria-busy={busy}>{editing ? 'Enregistrer' : 'Créer le membre'}</button></div>
      </form>
    </Modal>
  );
}

export function openMemberDialog(member, onDone) {
  openDialog(MemberDialog, { member, onDone });
}

// ---------------------------------------------------------------- subscription

function SubscriptionDialog({ close, member, onDone }) {
  const settings = useSettings();
  const plans = useActivePlans();
  const [key] = useState(newKey);
  const { busy, error, submit } = useSubmit();
  const sub = member.subscription;
  const renewing = sub && sub.state !== 'aucun';
  const [planId, setPlanId] = useState(() => (plans[0] ? String(plans[0].id) : ''));
  const [startDate, setStartDate] = useState(() => (sub && ['active', 'expire_bientot', 'a_venir'].includes(sub.state) ? addDays(sub.end_date, 1) : bizToday()));
  // The summary keeps the last complete choice while the date field is being edited.
  const [shown, setShown] = useState({ planId, startDate });

  const change = (nextPlan, nextStart) => {
    setPlanId(nextPlan);
    setStartDate(nextStart);
    if (plans.some((x) => x.id === Number(nextPlan)) && nextStart) setShown({ planId: nextPlan, startDate: nextStart });
  };

  const onSubmit = (e) => {
    e.preventDefault();
    submit(async () => {
      const res = await api.post(`/api/members/${member.id}/subscriptions`, { plan_id: Number(planId), start_date: startDate }, key);
      close();
      toast(res.charge_id ? 'Formule activée : la ligne d’abonnement est à encaisser.' : 'Formule activée.');
      onDone?.(res.member);
    });
  };

  const p = plans.find((x) => x.id === Number(shown.planId));
  let info = null;
  if (p && shown.startDate) {
    const end = addDays(addMonths(shown.startDate, p.duration_months), -1);
    const annual = p.duration_months > 1;
    const mode = settings.annual_allocation_mode;
    info = (
      <>
        <dl className="calc">
          <div><dt>Validité</dt><dd>{`${dayLabel(shown.startDate, 'short')} → ${dayLabel(end, 'short')}`}</dd></div>
          <div><dt>Heures incluses</dt><dd>{fmtDuration(p.included_minutes)}{annual ? (mode === 'mensuelle' ? ' (2 h attribuées chaque mois)' : ' (disponibles dès l’activation)') : ''}</dd></div>
          <div className="total"><dt>Prix</dt><dd>{p.price == null ? 'non défini' : money(p.price)}</dd></div>
        </dl>
        {p.price == null ? <Notice kind="warn">Aucun prix n’est défini pour cette formule.</Notice> : null}
      </>
    );
  }

  return (
    <Modal title={renewing ? 'Renouveler la formule' : 'Activer une formule'} onClose={close}>
      <form className="form-grid" onSubmit={onSubmit} noValidate>
        <p>{`${member.name} · ${subStateLabel(sub)}`}</p>
        <div className="form-row">
          <label className="field"><span>Formule</span>
            <select name="plan_id" value={planId} onChange={(e) => change(e.target.value, startDate)}>
              {plans.map((x) => <option key={x.id} value={x.id}>{planLabel(x)}</option>)}</select></label>
          <label className="field"><span>Début de validité</span>
            <input type="date" name="start_date" value={startDate} onChange={(e) => change(planId, e.target.value)} required /></label>
        </div>
        <div id="sub-info">{info}</div>
        <FormError error={error} />
        <div className="modal-actions"><button type="button" className="btn" onClick={close}>Annuler</button>
          <button type="submit" className="btn btn-primary" disabled={busy} aria-busy={busy}>{renewing ? 'Renouveler' : 'Activer'}</button></div>
      </form>
    </Modal>
  );
}

export function openSubscriptionDialog(member, onDone) {
  openDialog(SubscriptionDialog, { member, onDone });
}

// ---------------------------------------------------------------- card

function CardDialog({ close, member, onDone }) {
  const [key] = useState(newKey);
  const { busy, error, submit } = useSubmit();
  const [kind, setKind] = useState('physique');
  const [code, setCode] = useState('');

  const onSubmit = (e) => {
    e.preventDefault();
    submit(async () => {
      const res = await api.post(`/api/members/${member.id}/cards`, { kind, code: kind === 'physique' ? code : '' }, key);
      close();
      toast('Carte émise.');
      onDone?.(res);
    });
  };

  return (
    <Modal title="Émettre une carte" onClose={close}>
      <form className="form-grid" onSubmit={onSubmit} noValidate>
        <Notice kind="info">La carte renvoie au même membre et au même abonnement : elle ne crée pas de second crédit.
          Une nouvelle carte du même type remplace l’ancienne.</Notice>
        <fieldset><legend>Type de carte</legend>
          <label className="check"><input type="radio" name="kind" value="physique" checked={kind === 'physique'} onChange={() => setKind('physique')} /><span>Carte physique</span></label>
          <label className="check"><input type="radio" name="kind" value="virtuelle" checked={kind === 'virtuelle'} onChange={() => setKind('virtuelle')} /><span>Carte virtuelle (affichable et imprimable)</span></label>
        </fieldset>
        <label className="field"><span>Numéro imprimé sur la carte physique (facultatif)</span>
          <input name="code" maxLength={40} placeholder="Laisser vide pour générer un numéro" autoComplete="off" value={code} onChange={(e) => setCode(e.target.value)} />
          <span className="help">Lettres, chiffres et tirets. Ignoré pour une carte virtuelle.</span></label>
        <FormError error={error} />
        <div className="modal-actions"><button type="button" className="btn" onClick={close}>Annuler</button>
          <button type="submit" className="btn btn-primary" disabled={busy} aria-busy={busy}>Émettre la carte</button></div>
      </form>
    </Modal>
  );
}

export function openCardDialog(member, onDone) {
  openDialog(CardDialog, { member, onDone });
}

// ---------------------------------------------------------------- credit adjustment

function AdjustCreditDialog({ close, member, sub, onDone }) {
  const [key] = useState(newKey);
  const { busy, error, submit } = useSubmit();
  const [sign, setSign] = useState('1');
  const [minutesText, setMinutesText] = useState('30');
  const [reason, setReason] = useState('');

  const onSubmit = (e) => {
    e.preventDefault();
    submit(async () => {
      const minutes = Number(minutesText) * Number(sign);
      if (!Number.isInteger(minutes) || minutes === 0) throw new Error('Nombre de minutes invalide.');
      const res = await api.post(`/api/subscriptions/${sub.id}/adjust`, { minutes, reason }, key);
      close();
      toast('Crédit ajusté.');
      onDone?.(res);
    });
  };

  return (
    <Modal title="Ajuster le crédit d’heures" onClose={close}>
      <form className="form-grid" onSubmit={onSubmit} noValidate>
        <p>{`${member.name} · ${sub.plan_name} · disponible ${fmtDuration(sub.credit.available)}`}</p>
        <div className="form-row">
          <label className="field"><span>Sens</span>
            <select name="sign" value={sign} onChange={(e) => setSign(e.target.value)}><option value="1">Ajouter</option><option value="-1">Retirer</option></select></label>
          <label className="field"><span>Minutes</span>
            <input type="number" name="minutes" min="1" step="1" inputMode="numeric" required value={minutesText} onChange={(e) => setMinutesText(e.target.value)} /></label>
        </div>
        <label className="field"><span>Motif (obligatoire, conservé dans l’historique)</span>
          <textarea name="reason" required minLength={3} maxLength={300} value={reason} onChange={(e) => setReason(e.target.value)} /></label>
        <FormError error={error} />
        <div className="modal-actions"><button type="button" className="btn" onClick={close}>Annuler</button>
          <button type="submit" className="btn btn-primary" disabled={busy} aria-busy={busy}>Enregistrer l’ajustement</button></div>
      </form>
    </Modal>
  );
}

export function openAdjustCreditDialog(member, sub, onDone) {
  openDialog(AdjustCreditDialog, { member, sub, onDone });
}

// ---------------------------------------------------------------- deactivate / reactivate member

// A member is never deleted: deactivation keeps payments, bookings and consumption in the books and
// stops new bookings and room access until the member is reactivated.
export function openDeactivateMemberDialog(member, onDone) {
  const key = newKey();
  actionDialog({
    title: `Désactiver ${member.name}`,
    danger: true,
    confirmLabel: 'Désactiver le membre',
    message: `${member.name} (${member.member_no}) ne pourra plus réserver, entrer en salle, prendre une formule ni recevoir de carte. Sa fiche, ses paiements, ses réservations et ses consommations restent conservés ; vous pourrez le réactiver à tout moment.`,
    reasonLabel: 'Motif de la désactivation',
    run: async ({ reason }) => {
      await api.post(`/api/members/${member.id}/deactivate`, { reason }, key);
      toast(`${member.name} est désactivé.`);
      onDone?.();
    },
  });
}

export function openReactivateMemberDialog(member, onDone) {
  const key = newKey();
  actionDialog({
    title: `Réactiver ${member.name}`,
    confirmLabel: 'Réactiver le membre',
    message: `${member.name} pourra de nouveau réserver et entrer en salle, selon sa formule, sa carte et son crédit.`,
    run: async () => {
      await api.post(`/api/members/${member.id}/reactivate`, {}, key);
      toast(`${member.name} est réactivé.`);
      onDone?.();
    },
  });
}

