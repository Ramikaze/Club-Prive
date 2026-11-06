// Regular-client dialogs: the record (same identity fields and rules as a member, no plan), the conversion into a
// member, and deactivation. Each dialog keeps one idempotency key for its whole life.
import { useState } from 'react';
import { api, newKey, qs } from '../lib/api.js';
import { Modal, openDialog, actionDialog } from '../components/ui/Modal.jsx';
import { toast } from '../components/ui/toast.jsx';
import { FormError } from '../components/ui/ui.jsx';
import { useSubmit } from '../lib/hooks.js';

function ClientDialog({ close, client, onDone }) {
  const editing = Boolean(client);
  const [key] = useState(newKey);
  const { busy, error, submit } = useSubmit();
  const [v, setV] = useState(() => ({
    first_name: client?.first_name ?? '',
    last_name: client?.last_name ?? '',
    phone: client?.phone ?? '',
    email: client?.email ?? '',
    notes: client?.notes ?? '',
  }));
  const field = (name) => ({ name, value: v[name], onChange: (e) => setV((prev) => ({ ...prev, [name]: e.target.value })) });

  const onSubmit = (e) => {
    e.preventDefault();
    submit(async () => {
      const res = editing ? await api.put(`/api/members/${client.id}`, v, key) : await api.post('/api/clients', v, key);
      close();
      toast(editing ? 'Fiche enregistrée.' : `Client régulier ${res.member_no} créé.`);
      onDone?.(res);
    });
  };

  return (
    <Modal title={editing ? 'Modifier la fiche' : 'Nouveau client régulier'} size="wide" onClose={close}>
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
        <FormError error={error} />
        <div className="modal-actions"><button type="button" className="btn" onClick={close}>Annuler</button>
          <button type="submit" className="btn btn-primary" disabled={busy} aria-busy={busy}>{editing ? 'Enregistrer' : 'Créer le client'}</button></div>
      </form>
    </Modal>
  );
}

export function openClientDialog(client, onDone) {
  openDialog(ClientDialog, { client, onDone });
}

// « Passer en membre »: the count of purchases is the list's own (non-cancelled sales). Opened from the file, the
// client's row is read from the list route, so both places show the same number. One lookup at a time.
let converting = false;
export async function openConvertClientDialog(client, onDone) {
  if (converting) return;
  let count = client.purchases_count;
  if (count == null) {
    converting = true;
    try {
      const rows = await api.get(`/api/clients${qs({ q: client.member_no })}`);
      count = rows.find((r) => r.id === client.id)?.purchases_count ?? 0;
    } catch (err) {
      toast(err.message, 'error');
      return;
    } finally {
      converting = false;
    }
  }
  const key = newKey();
  actionDialog({
    title: `Passer ${client.name} en membre`,
    confirmLabel: 'Passer en membre',
    message: `${client.name} (${client.member_no}) reçoit un numéro de membre (M-…) et une carte membre. ${count > 1 ? `Ses ${count} achats sont conservés` : count === 1 ? 'Son achat est conservé' : 'Aucun achat à conserver pour l’instant'} sur sa fiche. Cette opération est irréversible : un membre ne redevient pas client régulier.`,
    run: async () => {
      const res = await api.post(`/api/clients/${client.id}/convert`, {}, key);
      toast(`${client.name} est maintenant membre (${res.member_no}).`);
      onDone?.(res);
    },
  });
}

export function openDeactivateClientDialog(client, onDone) {
  const key = newKey();
  actionDialog({
    title: `Désactiver ${client.name}`,
    danger: true,
    confirmLabel: 'Désactiver le client',
    message: `${client.name} (${client.member_no}) ne pourra plus être choisi comme acheteur à la Boutique. Sa fiche et ses achats restent conservés ; vous pourrez le réactiver à tout moment.`,
    reasonLabel: 'Motif de la désactivation',
    run: async ({ reason }) => {
      await api.post(`/api/members/${client.id}/deactivate`, { reason }, key);
      toast(`${client.name} est désactivé.`);
      onDone?.();
    },
  });
}

export function openReactivateClientDialog(client, onDone) {
  const key = newKey();
  actionDialog({
    title: `Réactiver ${client.name}`,
    confirmLabel: 'Réactiver le client',
    message: `${client.name} pourra de nouveau être choisi comme acheteur à la Boutique.`,
    run: async () => {
      await api.post(`/api/members/${client.id}/reactivate`, {}, key);
      toast(`${client.name} est réactivé.`);
      onDone?.();
    },
  });
}
