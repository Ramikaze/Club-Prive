// Dialogs. openDialog(Component, props) can be called from anywhere (a page, another dialog);
// the component receives `close` and renders a <Modal>. Escape and the backdrop close the top
// dialog; Tab stays inside it; focus returns to where it was.
import { createContext, useContext, useEffect, useId, useRef, useState } from 'react';
import { create } from 'zustand';
import Icon from './Icon.jsx';
import { FormError } from './ui.jsx';
import { useSubmit } from '../../lib/hooks.js';

const useDialogs = create(() => ({ stack: [] }));
const Closing = createContext(false);
const EXIT_MS = 160; // matches the exit animation in app.css
let seq = 0;

export function openDialog(Component, props = {}) {
  const id = (seq += 1);
  const remove = () => useDialogs.setState((s) => ({ stack: s.stack.filter((d) => d.id !== id) }));
  // The window plays its exit before it is removed; closing it twice does nothing.
  const close = () => {
    const entry = useDialogs.getState().stack.find((d) => d.id === id);
    if (!entry || entry.closing) return;
    useDialogs.setState((s) => ({ stack: s.stack.map((d) => (d.id === id ? { ...d, closing: true } : d)) }));
    setTimeout(remove, EXIT_MS);
  };
  useDialogs.setState((s) => ({ stack: [...s.stack, { id, Component, props, close, closing: false }] }));
  return close;
}

export const closeAllDialogs = () => useDialogs.setState({ stack: [] });

export function DialogRoot() {
  const stack = useDialogs((s) => s.stack);
  return stack.map(({ id, Component, props, close, closing }) => (
    <Closing.Provider key={id} value={closing}><Component {...props} close={close} /></Closing.Provider>
  ));
}

const open = [];
const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]):not([type="hidden"]), select:not([disabled]), textarea:not([disabled])';

export function Modal({ title, size = '', onClose, children }) {
  const closing = useContext(Closing);
  const titleId = useId();
  const backdrop = useRef(null);
  const body = useRef(null);
  const closeRef = useRef(onClose);
  closeRef.current = onClose;

  useEffect(() => {
    const previous = document.activeElement;
    const el = backdrop.current;
    open.push(el);
    const first = body.current?.querySelector('[autofocus], input:not([type="hidden"]):not([disabled]), select, textarea, button[type="submit"]');
    (first ?? body.current)?.focus?.();
    const onKey = (e) => {
      if (open[open.length - 1] !== el) return;
      if (e.key === 'Escape') {
        e.preventDefault();
        closeRef.current();
        return;
      }
      if (e.key === 'Tab') {
        const items = [...el.querySelectorAll(FOCUSABLE)].filter((x) => x.offsetParent !== null);
        if (!items.length) return;
        const firstItem = items[0];
        const last = items[items.length - 1];
        if (e.shiftKey && document.activeElement === firstItem) {
          e.preventDefault();
          last.focus();
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault();
          firstItem.focus();
        }
      }
    };
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('keydown', onKey);
      open.splice(open.indexOf(el), 1);
      // A window removed after its exit animation must not pull focus out of one opened since.
      if (!open.length && previous && document.contains(previous)) previous.focus?.();
    };
  }, []);

  return (
    <div className="modal-backdrop" ref={backdrop} data-closing={closing || undefined}
      onMouseDown={(e) => { if (e.target === backdrop.current) onClose(); }}>
      <div className={`modal ${size}`} role="dialog" aria-modal="true" aria-labelledby={titleId}>
        <div className="modal-head">
          <h2 id={titleId}>{title}</h2>
          <button type="button" className="icon-btn" onClick={onClose} aria-label="Fermer"><Icon name="x" /></button>
        </div>
        <div className="modal-body" ref={body} tabIndex={-1}>{children}</div>
      </div>
    </div>
  );
}

// A confirmation that runs `run({ reason })` and stays open with the error if the server refuses.
function ActionDialog({ close, title, message, body, confirmLabel = 'Confirmer', danger = false, reasonLabel = null, run }) {
  const [reason, setReason] = useState('');
  const { busy, error, submit } = useSubmit();
  const onSubmit = (e) => {
    e.preventDefault();
    submit(async () => {
      if (reasonLabel && reason.trim().length < 3) throw new Error('Indiquez un motif (3 caractères minimum).');
      await run({ reason: reason.trim() });
      close();
    });
  };
  return (
    <Modal title={title} onClose={close}>
      <form className="form-grid" onSubmit={onSubmit} noValidate>
        {message && <p>{message}</p>}
        {body}
        {reasonLabel && (
          <label className="field"><span>{reasonLabel}</span>
            <textarea value={reason} onChange={(e) => setReason(e.target.value)} required minLength={3} maxLength={300} />
          </label>
        )}
        <FormError error={error} />
        <div className="modal-actions">
          <button type="button" className="btn" onClick={close}>Retour</button>
          <button type="submit" className={`btn ${danger ? 'btn-danger' : 'btn-primary'}`} disabled={busy} aria-busy={busy}>{confirmLabel}</button>
        </div>
      </form>
    </Modal>
  );
}

export const actionDialog = (options) => openDialog(ActionDialog, options);
