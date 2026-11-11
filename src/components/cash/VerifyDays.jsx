// « Journées à vérifier » in the « Soldes » card, and the dialog where an associé checks one closed day: he reads
// what the manager counted, then validates the day, or reopens it to correct (he closes it again, then validates).
// Days are verified oldest first: only the first row has a button (the server refuses otherwise, JOURNEE_PRECEDENTE).
import Icon from '../ui/Icon.jsx';
import { Modal, actionDialog, openDialog } from '../ui/Modal.jsx';
import { FormError, Loaded } from '../ui/ui.jsx';
import { toast } from '../ui/toast.jsx';
import { gapText } from './CountDialog.jsx';
import { api, qs } from '../../lib/api.js';
import { dateTime, dayLabel, money } from '../../lib/format.js';
import { useLoad, useSubmit } from '../../lib/hooks.js';
import { useIsBoss } from '../../store/useStore.js';
import { CAISSE_LABEL } from '../../../shared/caisses.js';

export const verifyDayDialog = (day, onDone) => openDialog(VerifyDayDialog, { day, onDone });

export function PendingDaysBand({ days, onChange }) {
  const boss = useIsBoss();
  if (!days?.length) return null;
  return (
    <div className="pending-days">
      <h3>{days.length} journée{days.length > 1 ? 's' : ''} à vérifier</h3>
      <div className="list">
        {days.map((d, i) => (
          <div key={d.day} className="list-item">
            <div className="grow">
              <div className="title">{dayLabel(d.day, 'medium')}</div>
              <div className="meta">{d.closed ? `Fermée${d.closed_by_name ? ` par ${d.closed_by_name}` : ''} le ${dateTime(d.closed_at)}` : 'Pas encore fermée'}</div>
            </div>
            <span className="num">{money(d.total)}</span>
            {i > 0 && <span className="subtle">après le {dayLabel(days[i - 1].day, 'medium')}</span>}
            {/* The day is closed from the « Recette du jour par catégorie » tile below (owner's request, 2026-11-10). */}
            {i === 0 && !d.closed && <span className="subtle">à fermer dans « Recette du jour par catégorie »</span>}
            {i === 0 && d.closed && boss && (
              <button type="button" className="btn btn-sm btn-primary" onClick={() => verifyDayDialog(d.day, onChange)}>Vérifier</button>
            )}
            {i === 0 && d.closed && !boss && <span className="subtle">en attente de vérification</span>}
          </div>
        ))}
      </div>
    </div>
  );
}

export function VerifyDayDialog({ close, day, onDone }) {
  const state = useLoad(() => api.get(`/api/day-closing${qs({ day })}`), [day]);
  return (
    <Modal title={`Vérifier la caisse · ${dayLabel(day, 'medium')}`} size="wide" onClose={close}>
      <Loaded state={state}>{(d) => <Body close={close} day={day} data={d} onDone={onDone} />}</Loaded>
    </Modal>
  );
}

function Body({ close, day, data, onDone }) {
  const { busy, error, submit } = useSubmit();
  const c = data.closed;
  if (!c) return <p className="subtle">Cette journée n’est pas fermée.</p>;
  const s = c.summary;
  const notes = Object.entries(s.cash_detail ?? {}).filter(([, n]) => Number(n) > 0);
  const label = dayLabel(day, 'medium');

  const validate = () => submit(async () => {
    await api.post(`/api/day-closing/${day}/verify`, {});
    close();
    toast(`Caisse du ${label} vérifiée.`);
    onDone?.();
  });
  const reopen = () => actionDialog({
    title: `Rouvrir la caisse du ${label}`,
    message: 'La journée est rouverte pour que vous la corrigiez. La réouverture est tracée avec son motif.',
    reasonLabel: 'Motif de la réouverture',
    confirmLabel: 'Rouvrir pour corriger',
    run: async ({ reason }) => {
      await api.post(`/api/day-closing/${day}/reopen`, { reason });
      close();
      toast('La journée est rouverte : corrigez-la, refermez-la, puis validez-la.');
      onDone?.();
    },
  });

  return (
    <div className="form-grid">
      <p>Fermée le {dateTime(c.closed_at)}{c.closed_by_name ? ` par ${c.closed_by_name}` : ''}.</p>
      <dl className="calc">
        {s.accounts.map((a) => (
          <div key={a.method}><dt>{a.method}</dt><dd>attendu {money(a.expected)} · compté {money(a.counted)} · {gapText(a.gap)}</dd></div>
        ))}
      </dl>
      {s.gap_reason && <p>Motif de l’écart : {s.gap_reason}</p>}
      {notes.length > 0 && (
        <p className="subtle">Billetage : {notes.map(([n, k]) => (n === 'pieces' ? `pièces ${money(Math.round(Number(k)))}` : `${k} × ${money(Number(n) * 100)}`)).join(' · ')}</p>
      )}
      <p>{s.unchecked.length > 0 ? `${s.unchecked.length} ticket(s) non pointé(s)${s.unchecked_reason ? ` : ${s.unchecked_reason}` : ''}.` : 'Tous les tickets sont pointés.'}</p>
      <h3>Net de la journée par caisse</h3>
      <dl className="calc">
        {Object.keys(CAISSE_LABEL).map((k) => <div key={k}><dt>{CAISSE_LABEL[k]}</dt><dd>{money(data.net[k] ?? 0)}</dd></div>)}
      </dl>
      <FormError error={error} />
      <div className="modal-actions">
        <button type="button" className="btn" onClick={reopen}><Icon name="unlock" /> Rouvrir pour corriger</button>
        <button type="button" className="btn btn-primary" disabled={busy} aria-busy={busy} onClick={validate}><Icon name="check" /> Valider la journée</button>
      </div>
    </div>
  );
}
