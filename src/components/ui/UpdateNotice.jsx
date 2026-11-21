// The notice of a new version put online (src/lib/update.js). It never takes the focus and is drawn over the page,
// never in its flow (club.css), so nothing moves under a field being typed in. « Mettre à jour » reloads now, which
// takes the new files; « Dans 5 minutes » hides it for 5 minutes, time to finish and save what is being typed.
import { useEffect, useSyncExternalStore } from 'react';
import Icon from './Icon.jsx';
import { createUpdates, pageBuild, watchUpdates } from '../../lib/update.js';

const updates = createUpdates({ build: pageBuild() });

export default function UpdateNotice() {
  const shown = useSyncExternalStore(updates.subscribe, updates.shown);
  useEffect(() => watchUpdates(updates), []);
  // The live region is always there, so that screen readers read the notice out when it comes.
  return (
    <div role="status" aria-live="polite">
      {shown && (
        <div className="update-notice">
          <Icon name="refresh" />
          <div className="update-notice-text">
            <strong>Nouvelle version disponible</strong>
            <span>La mise à jour recharge la page : terminez d’abord une saisie en cours.</span>
          </div>
          <div className="update-notice-actions">
            <button type="button" className="btn btn-sm update-later" onClick={() => updates.snooze()}>Dans 5 minutes</button>
            <button type="button" className="btn btn-sm btn-primary" onClick={() => window.location.reload()}>Mettre à jour</button>
          </div>
        </div>
      )}
    </div>
  );
}
