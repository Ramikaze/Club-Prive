// Short confirmations and errors, bottom right (above the tab bar on phones). A toast can carry one action,
// { label, icon?, onClick }: a button under the message that runs it and dismisses the toast. Such a toast stays
// longer, so there is time to reach the button.
import { create } from 'zustand';
import Icon from './Icon.jsx';

const useToasts = create(() => ({ list: [] }));
let seq = 0;

const dismiss = (id) => useToasts.setState((s) => ({ list: s.list.filter((t) => t.id !== id) }));

export function toast(message, kind = 'ok', action = null) {
  const id = (seq += 1);
  useToasts.setState((s) => ({ list: [...s.list, { id, message, kind, action }] }));
  setTimeout(() => dismiss(id), action ? 20000 : kind === 'error' ? 7000 : 4000);
}

export function Toasts() {
  const list = useToasts((s) => s.list);
  return (
    <div className="toasts" role="status" aria-live="polite">
      {list.map((t) => (
        <div key={t.id} className={`toast ${t.kind === 'error' ? 'error' : ''}`}>
          <Icon name={t.kind === 'error' ? 'alert' : 'check'} />
          <div className="toast-body">
            <span>{t.message}</span>
            {t.action ? (
              <button type="button" className="toast-action" onClick={() => { dismiss(t.id); t.action.onClick(); }}>
                {t.action.icon ? <Icon name={t.action.icon} /> : null}{t.action.label}
              </button>
            ) : null}
          </div>
        </div>
      ))}
    </div>
  );
}
