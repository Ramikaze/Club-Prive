// Who buys: a day client (default, no file), a regular client or a member found by the same search as the Membres page.
// Only active people are offered. A regular client can also be created on the spot.
import { useEffect, useState } from 'react';
import SmartSearch from '../ui/SmartSearch.jsx';
import { FormError, Segmented } from '../ui/ui.jsx';
import { Modal, openDialog } from '../ui/Modal.jsx';
import { toast } from '../ui/toast.jsx';
import { api, newKey, qs } from '../../lib/api.js';
import { useSubmit } from '../../lib/hooks.js';
import { smartFilter } from '../../../shared/search.js';

const KINDS = [['journalier', 'Client journalier'], ['client', 'Client régulier'], ['membre', 'Membre']];
const ENDPOINT = { client: '/api/clients', membre: '/api/members' };

// What the sale keeps of a person.
const asPerson = (m) => ({ id: m.id, name: m.name ?? `${m.first_name} ${m.last_name}`, member_no: m.member_no, in_room: m.in_room === true });

function NewClientDialog({ close, onDone }) {
  const [key] = useState(newKey);
  const { busy, error, submit } = useSubmit();
  const [v, setV] = useState({ first_name: '', last_name: '', phone: '', email: '', notes: '' });
  const field = (name) => ({ name, value: v[name], onChange: (e) => setV((prev) => ({ ...prev, [name]: e.target.value })) });
  const onSubmit = (e) => {
    e.preventDefault();
    submit(async () => {
      const created = await api.post('/api/clients', v, key);
      close();
      toast(`Client ${created.member_no} créé.`);
      onDone(created);
    });
  };
  return (
    <Modal title="Nouveau client régulier" size="wide" onClose={close}>
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
          <button type="submit" className="btn btn-primary" disabled={busy} aria-busy={busy}>Créer le client</button></div>
      </form>
    </Modal>
  );
}

export default function BuyerPicker({ buyer, onChange }) {
  const [text, setText] = useState('');
  // Every active member (or regular client), read once per kind: the suggestions show as soon as the field is touched
  // and narrow at each letter on the device itself, with no wait on a weak network (same matching as the server's).
  const [all, setAll] = useState({ kind: '', items: [] });
  useEffect(() => {
    if (buyer.kind === 'journalier') return undefined;
    let live = true;
    api.get(`${ENDPOINT[buyer.kind]}${qs({ statut: 'actifs' })}`)
      .then((items) => { if (live) setAll({ kind: buyer.kind, items }); })
      .catch((err) => { if (live) toast(err.message, 'error'); });
    return () => { live = false; };
  }, [buyer.kind]);

  const setKind = (kind) => {
    setText('');
    onChange({ kind, person: null });
  };
  const list = all.kind === buyer.kind ? all.items : [];
  const q = text.trim();
  const suggestions = q ? smartFilter(list, q, (m) => [m.name ?? `${m.first_name} ${m.last_name}`, m.member_no, m.phone]) : list;

  return (
    <div className="buyer-picker">
      <Segmented label="Acheteur" value={buyer.kind} options={KINDS} onChange={setKind} />
      {buyer.kind !== 'journalier' && (buyer.person ? (
        <div className="buyer-chosen">
          <span><strong>{buyer.person.name}</strong> <span className="subtle">{buyer.person.member_no}</span></span>
          <button type="button" className="btn btn-sm btn-ghost" onClick={() => onChange({ kind: buyer.kind, person: null })}>Changer</button>
        </div>
      ) : (
        <>
          <SmartSearch
            value={text}
            onChange={setText}
            instant
            suggestions={suggestions}
            onPick={(m) => onChange({ kind: buyer.kind, person: asPerson(m) })}
            placeholder="Nom, téléphone ou numéro"
            label={buyer.kind === 'membre' ? 'Rechercher un membre' : 'Rechercher un client régulier'}
            renderSuggestion={(m) => (
              <div className="grow">
                <div className="title">{m.name}</div>
                <div className="meta">{m.member_no} · {m.phone}</div>
              </div>
            )}
          />
          {buyer.kind === 'client' && (
            <button type="button" className="btn btn-sm" onClick={() => openDialog(NewClientDialog, { onDone: (c) => onChange({ kind: 'client', person: asPerson(c) }) })}>
              + Nouveau client régulier
            </button>
          )}
        </>
      ))}
    </div>
  );
}
