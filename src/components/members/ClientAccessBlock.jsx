// « Accès client » on a member's or regular client's file: the state of his access to the client space and the actions
// on it. The temporary code is shown ONCE, in a dialog, and forgotten when the dialog closes: it is held in that
// dialog's own state only (never in the store, the address or the browser's storage), and the server never keeps it
// in clear nor returns it again. A refusal (the demo space has no client access) shows the server's message.
// Only the administrator and the associés create an access, give a code or restore it; any staff may cut one.
import Icon from '../ui/Icon.jsx';
import { Modal, actionDialog, openDialog } from '../ui/Modal.jsx';
import { Notice, Skeleton } from '../ui/ui.jsx';
import { toast } from '../ui/toast.jsx';
import { sendWhatsAppText } from '../../dialogs/reservationDialogs.jsx';
import { api } from '../../lib/api.js';
import { dateTime } from '../../lib/format.js';
import { useBusy, useLoad } from '../../lib/hooks.js';
import { useIsBoss } from '../../store/useStore.js';
import { clientAccessText } from '../../../shared/whatsapp.js';

const STATE_LINE = {
  aucun: () => 'Pas d’accès client.',
  en_attente: (s) => `En attente de première connexion${s.temp_expires_at ? ` · code valable jusqu’au ${dateTime(s.temp_expires_at)}` : ''}.`,
  actif: (s) => `Accès actif${s.last_login_at ? ` · dernière connexion le ${dateTime(s.last_login_at)}` : ' · jamais connecté'}.`,
  coupe: () => 'Accès coupé : le client ne peut plus se connecter.',
};

function CodeDialog({ close, member, access }) {
  // `access` lives in this dialog's props only: closing it drops the code with the dialog.
  const url = `${window.location.origin}/client`;
  const chosen = Boolean(access.status?.login_chosen);
  const send = () => sendWhatsAppText(member.phone, clientAccessText({
    first_name: member.first_name, url, member_no: member.member_no, code: access.code, login_chosen: chosen, login: access.login,
  }));
  return (
    <Modal title="Code provisoire" onClose={close}>
      <div className="form-grid">
        <Notice kind="warn">Ce code ne s’affichera plus. Notez-le ou envoyez-le maintenant : en le fermant, vous devrez en générer un nouveau.</Notice>
        <dl className="kv">
          <dt>Adresse</dt><dd>{url}</dd>
          <dt>{chosen ? 'Identifiant' : 'Identifiant provisoire'}</dt><dd className="mono">{chosen ? access.login : member.member_no}</dd>
          <dt>Code provisoire</dt><dd className="mono"><strong>{access.code}</strong></dd>
          <dt>Valable jusqu’au</dt><dd>{dateTime(access.expires_at)}</dd>
        </dl>
        <div className="modal-actions">
          <button type="button" className="btn" onClick={close}>Fermer</button>
          <button type="button" className="btn btn-primary" onClick={send}><Icon name="message" /> Envoyer sur WhatsApp</button>
        </div>
      </div>
    </Modal>
  );
}

export default function ClientAccessBlock({ member }) {
  const state = useLoad(() => api.get(`/api/members/${member.id}/client-access`), [member.id]);
  const action = useBusy();
  const boss = useIsBoss();
  const base = `/api/members/${member.id}/client-access`;

  const showCode = (access) => openDialog(CodeDialog, { member, access });
  const run = (fn) => action.run(async () => {
    try { await fn(); } finally { state.reload(); }
  });
  const create = () => run(async () => showCode(await api.post(base, {})));
  const renew = () => actionDialog({
    title: 'Nouveau code provisoire',
    message: 'L’ancien mot de passe ne fonctionnera plus et les sessions ouvertes du client seront fermées. Son identifiant reste le même.',
    confirmLabel: 'Générer un code',
    run: async () => {
      const access = await api.post(`${base}/code`, {});
      showCode(access);
      state.reload();
    },
  });
  const disable = () => actionDialog({
    title: 'Couper l’accès client',
    message: `${member.name} ne pourra plus se connecter à son espace. Ses commandes en cours restent à traiter.`,
    confirmLabel: 'Couper l’accès',
    danger: true,
    run: async () => {
      await api.post(`${base}/disable`, {});
      toast('Accès coupé.');
      state.reload();
    },
  });
  const enable = () => run(async () => {
    await api.post(`${base}/enable`, {});
    toast('Accès rétabli.');
  });

  const s = state.data;
  return (
    <section className="card" aria-label="Accès client">
      <div className="card-head"><h2>Accès client</h2></div>
      {state.error && !state.data ? <Notice kind="warn">{state.error.message}</Notice> : null}
      {!s && !state.error ? <Skeleton /> : null}
      {s ? (
        <div className="stack">
          <p>{STATE_LINE[s.state](s)}</p>
          {!boss && s.state === 'aucun' ? <p className="subtle">Seuls l’administrateur et les associés créent un accès client.</p> : null}
          {s.state === 'aucun' ? null : s.login_chosen
            ? <p className="subtle">Identifiant : <span className="mono">{s.login}</span></p>
            : <p className="subtle">Identifiant : pas encore choisi (provisoire : <span className="mono">{member.member_no}</span>)</p>}
          <div className="row" style={{ flexWrap: 'wrap', gap: 8 }}>
            {s.state === 'aucun' ? (
              boss ? <button type="button" className="btn btn-primary" disabled={action.busy} onClick={create}><Icon name="key" /> Créer l’accès client</button> : null
            ) : (
              <>
                {boss ? <button type="button" className="btn" disabled={action.busy} onClick={renew}><Icon name="key" /> Nouveau code provisoire</button> : null}
                {s.state === 'coupe'
                  ? (boss ? <button type="button" className="btn" disabled={action.busy} onClick={enable}><Icon name="unlock" /> Rétablir l’accès</button> : null)
                  : <button type="button" className="btn btn-danger" disabled={action.busy} onClick={disable}><Icon name="ban" /> Couper l’accès</button>}
              </>
            )}
          </div>
        </div>
      ) : null}
    </section>
  );
}
