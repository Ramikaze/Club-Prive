import { useState } from 'react';
import { Modal, openDialog } from '../components/ui/Modal.jsx';
import { FormError, Notice } from '../components/ui/ui.jsx';
import { toast } from '../components/ui/toast.jsx';
import { useSubmit } from '../lib/hooks.js';
import { api, newKey } from '../lib/api.js';

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

export const openHumidorForm = (humidor, onDone) => openDialog(HumidorForm, { humidor, onDone });
export const openReadingForm = (humidor, onDone) => openDialog(ReadingForm, { humidor, onDone });
