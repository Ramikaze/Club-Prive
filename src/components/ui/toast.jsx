// Short confirmations and errors, bottom right (above the tab bar on phones).
import { create } from 'zustand';
import Icon from './Icon.jsx';

const useToasts = create(() => ({ list: [] }));
let seq = 0;

export function toast(message, kind = 'ok') {
  const id = (seq += 1);
  useToasts.setState((s) => ({ list: [...s.list, { id, message, kind }] }));
  setTimeout(() => useToasts.setState((s) => ({ list: s.list.filter((t) => t.id !== id) })), kind === 'error' ? 7000 : 4000);
}

export function Toasts() {
  const list = useToasts((s) => s.list);
  return (
    <div className="toasts" role="status" aria-live="polite">
      {list.map((t) => (
        <div key={t.id} className={`toast ${t.kind === 'error' ? 'error' : ''}`}>
          <Icon name={t.kind === 'error' ? 'alert' : 'check'} />
          <span>{t.message}</span>
        </div>
      ))}
    </div>
  );
}
