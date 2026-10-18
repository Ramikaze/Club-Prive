import { useState } from 'react';
import { Modal, openDialog } from '../components/ui/Modal.jsx';
import { FormError, Loaded, Notice } from '../components/ui/ui.jsx';
import { toast } from '../components/ui/toast.jsx';
import { useLoad, useSubmit } from '../lib/hooks.js';
import { api, newKey } from '../lib/api.js';
import { dayLabel } from '../lib/format.js';
import { addDays, addMonths } from '../../shared/time.js';

function SaveForm({ close, title, label = 'Enregistrer', onSave, onDone, children }) {
  const [key] = useState(newKey);
  const { busy, error, submit } = useSubmit();
  const dismiss = () => { if (!busy) close(); };
  return (
    <Modal title={title} onClose={dismiss}>
      <form className="form-grid" onSubmit={(e) => {
        e.preventDefault();
        const values = Object.fromEntries(new FormData(e.currentTarget));
        submit(async () => {
          const result = await onSave(values, key);
          close();
          onDone?.(result);
          toast('Enregistrement effectué.');
        });
      }}>
        {children}
        <FormError error={error} />
        <div className="modal-actions">
          <button type="button" className="btn" onClick={dismiss} disabled={busy}>Annuler</button>
          <button type="submit" className="btn btn-primary" disabled={busy} aria-busy={busy}>{busy ? 'Enregistrement…' : label}</button>
        </div>
      </form>
    </Modal>
  );
}

function HumidorForm({ close, humidor: h, onDone }) {
  return (
    <SaveForm close={close} title={h ? 'Configurer la cave' : 'Nouvelle cave'} onDone={onDone}
      onSave={(v, key) => h ? api.put(`/api/humidors/${h.id}`, v, key) : api.post('/api/humidors', v, key)}>
      <label className="field"><span>Nom de la cave</span><input name="name" required maxLength={80} defaultValue={h?.name} placeholder="Ex. La réserve du salon" /></label>
      <label className="field"><span>Emplacement</span><input name="location" maxLength={100} defaultValue={h?.location} placeholder="Ex. Salon principal" /></label>
      <p className="muted">Définissez vos seuils de conservation et la fréquence des contrôles manuels.</p>
      <div className="form-row">
        <label className="field"><span>Humidité min. (% HR)</span><input type="number" name="humidity_min" min="0" max="100" step="0.1" required defaultValue={h?.humidity_min} /></label>
        <label className="field"><span>Humidité max. (% HR)</span><input type="number" name="humidity_max" min="0" max="100" step="0.1" required defaultValue={h?.humidity_max} /></label>
      </div>
      <div className="form-row">
        <label className="field"><span>Température min. (°C)</span><input type="number" name="temperature_min" min="-20" max="60" step="0.1" required defaultValue={h?.temperature_min} /></label>
        <label className="field"><span>Température max. (°C)</span><input type="number" name="temperature_max" min="-20" max="60" step="0.1" required defaultValue={h?.temperature_max} /></label>
      </div>
      <label className="field"><span>Un contrôle au moins toutes les (heures)</span><input type="number" name="reading_interval_hours" min="1" max="168" step="1" required defaultValue={h?.reading_interval_hours ?? 24} /></label>
      <label className="field"><span>Consignes (facultatif)</span><textarea name="notes" maxLength={500} defaultValue={h?.notes} /></label>
    </SaveForm>
  );
}

function ReadingForm({ close, humidor: h, onDone }) {
  return (
    <SaveForm close={close} title={`Contrôler · ${h.name}`} label="Enregistrer le relevé" onDone={onDone}
      onSave={(v, key) => api.post(`/api/humidors/${h.id}/readings`, v, key)}>
      <Notice>Relevez les valeurs affichées par votre appareil. La date et votre nom sont enregistrés automatiquement.</Notice>
      <div className="form-row">
        <label className="field"><span>Humidité (% HR)</span><input type="number" name="humidity" min="0" max="100" step="0.1" inputMode="decimal" required placeholder="0,0" />
          <span className="help">Seuils : {h.humidity_min}–{h.humidity_max} %</span></label>
        <label className="field"><span>Température (°C)</span><input type="number" name="temperature" min="-20" max="60" step="0.1" inputMode="decimal" required placeholder="0,0" />
          <span className="help">Seuils : {h.temperature_min}–{h.temperature_max} °C</span></label>
      </div>
      <label className="field"><span>Observation ou action effectuée</span><textarea name="notes" maxLength={500} placeholder="Ex. Réservoir rempli, contrôle à refaire en fin de service." /></label>
    </SaveForm>
  );
}

function LockerForm({ close, humidors, onDone }) {
  return (
    <SaveForm close={close} title="Nouveau casier" label="Créer le casier" onDone={onDone} onSave={(v, key) => api.post('/api/lockers', v, key)}>
      <label className="field"><span>Numéro du casier</span><input name="code" required maxLength={20} placeholder="Ex. A-01" /></label>
      <label className="field"><span>Cave</span><select name="humidor_id" required>{humidors.map((h) => <option key={h.id} value={h.id}>{h.name}</option>)}</select></label>
      <label className="field"><span>Notes (facultatif)</span><textarea name="notes" maxLength={500} placeholder="Emplacement, clé, consignes…" /></label>
    </SaveForm>
  );
}

function AssignmentForm({ close, locker, today, onDone }) {
  const members = useLoad(() => api.get('/api/members'), []);
  const [search, setSearch] = useState('');
  const [memberId, setMemberId] = useState('');
  return (
    <SaveForm close={close} title={`Attribuer le casier ${locker.code}`} label="Attribuer le casier" onDone={onDone}
      onSave={(v, key) => api.post(`/api/lockers/${locker.id}/assign`, v, key)}>
      <Loaded state={members}>{(rows) => (
        <>
          <label className="field"><span>Rechercher un membre</span><input type="search" value={search} onChange={(e) => { setSearch(e.target.value); setMemberId(''); }} placeholder="Nom, téléphone ou numéro…" /></label>
          <label className="field"><span>Membre</span><select name="member_id" required value={memberId} onChange={(e) => setMemberId(e.target.value)}>
            <option value="">Sélectionner un membre</option>
            {rows.filter((m) => `${m.name} ${m.member_no} ${m.phone}`.toLocaleLowerCase('fr').includes(search.toLocaleLowerCase('fr'))).map((m) => (
              <option value={m.id} key={m.id}>{m.name} · {m.member_no}</option>
            ))}
          </select></label>
          {!rows.length && <Notice>Créez d’abord une fiche dans la rubrique Membres.</Notice>}
        </>
      )}</Loaded>
      <label className="field"><span>Mis à disposition jusqu’au (inclus)</span><input type="date" name="end_date" min={today} defaultValue={addMonths(today, 1)} required /></label>
      <label className="field"><span>Consignes du membre (facultatif)</span><textarea name="notes" maxLength={500} placeholder="Préférences, modalités de restitution…" /></label>
      <p className="subtle">L’attribution commence aujourd’hui. Aucune facturation automatique n’est créée.</p>
    </SaveForm>
  );
}

function RenewForm({ close, locker, today, onDone }) {
  const start = locker.end_date > today ? locker.end_date : today;
  return (
    <SaveForm close={close} title={`Renouveler · ${locker.code}`} onDone={onDone}
      onSave={(v, key) => api.post(`/api/locker-assignments/${locker.assignment_id}/renew`, v, key)}>
      <p>{locker.member_name} · échéance actuelle : {dayLabel(locker.end_date, 'short')}.</p>
      <label className="field"><span>Nouvelle date de fin (incluse)</span><input type="date" name="end_date" required min={addDays(start, 1)} defaultValue={addMonths(start, 1)} /></label>
    </SaveForm>
  );
}

function DepositForm({ close, locker, onDone }) {
  return (
    <SaveForm close={close} title={`Déposer des cigares · ${locker.code}`} label="Enregistrer le dépôt" onDone={onDone}
      onSave={(v, key) => api.post(`/api/locker-assignments/${locker.assignment_id}/items`, v, key)}>
      <p className="muted">Collection de {locker.member_name}.</p>
      <label className="field"><span>Cigares déposés</span><input name="name" required maxLength={100} list={`items-${locker.id}`} placeholder="Marque, vitole, boîte ou lot…" />
        <datalist id={`items-${locker.id}`}>{locker.items.map((i) => <option key={i.id} value={i.name} />)}</datalist>
        <span className="help">Reprenez le même libellé pour compléter une référence existante.</span></label>
      <label className="field"><span>Nombre de cigares</span><input type="number" name="quantity" required min="1" max="10000" step="1" defaultValue="1" /></label>
      <label className="field"><span>Observation (facultatif)</span><textarea name="notes" maxLength={500} /></label>
    </SaveForm>
  );
}

function WithdrawForm({ close, item, locker, onDone }) {
  return (
    <SaveForm close={close} title={`Retirer des cigares · ${locker.code}`} label="Enregistrer le retrait" onDone={onDone}
      onSave={(v, key) => api.post(`/api/locker-items/${item.id}/withdraw`, v, key)}>
      <p><strong>{item.name}</strong><br /><span className="muted">{item.quantity} disponible(s) · {locker.member_name}</span></p>
      <label className="field"><span>Nombre de cigares retirés</span><input type="number" name="quantity" required min="1" max={item.quantity} step="1" defaultValue="1" /></label>
      <label className="field"><span>Motif ou destinataire</span><textarea name="notes" required minLength={3} maxLength={500} placeholder="Ex. Remis au membre pour dégustation." /></label>
    </SaveForm>
  );
}

export const openHumidorForm = (humidor, onDone) => openDialog(HumidorForm, { humidor, onDone });
export const openReadingForm = (humidor, onDone) => openDialog(ReadingForm, { humidor, onDone });
export const openLockerForm = (humidors, onDone) => openDialog(LockerForm, { humidors, onDone });
export const openAssignmentForm = (locker, today, onDone) => openDialog(AssignmentForm, { locker, today, onDone });
export const openRenewForm = (locker, today, onDone) => openDialog(RenewForm, { locker, today, onDone });
export const openDepositForm = (locker, onDone) => openDialog(DepositForm, { locker, onDone });
export const openWithdrawForm = (item, locker, onDone) => openDialog(WithdrawForm, { item, locker, onDone });
