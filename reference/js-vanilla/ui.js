// UI building blocks: delegated event binding, modals, confirmations, toasts, icons.
import { html, raw, esc } from './core.js';

// ---------------------------------------------------------------- delegated handlers

const registry = new WeakMap();

function handlersFor(root) {
  let h = registry.get(root);
  if (h) return h;
  h = { actions: {}, forms: {}, changes: {}, inputs: {} };
  root.addEventListener('click', (e) => {
    const el = e.target.closest('[data-act]');
    if (!el || !root.contains(el)) return;
    const fn = h.actions[el.dataset.act];
    if (fn) {
      e.preventDefault();
      fn(el, e);
    }
  });
  root.addEventListener('submit', (e) => {
    const form = e.target.closest('form[data-form]');
    const fn = form && h.forms[form.dataset.form];
    if (fn) {
      e.preventDefault();
      fn(form, e);
    }
  });
  root.addEventListener('change', (e) => {
    const el = e.target.closest('[data-change]');
    if (el) h.changes[el.dataset.change]?.(el, e);
  });
  root.addEventListener('input', (e) => {
    const el = e.target.closest('[data-input]');
    if (el) h.inputs[el.dataset.input]?.(el, e);
  });
  registry.set(root, h);
  return h;
}

export function mount(root, tpl, { actions = {}, forms = {}, changes = {}, inputs = {} } = {}) {
  const h = handlersFor(root);
  h.actions = actions;
  h.forms = forms;
  h.changes = changes;
  h.inputs = inputs;
  root.innerHTML = String(tpl);
}

export const setHTML = (el, tpl) => {
  if (el) el.innerHTML = String(tpl);
};

export const formValues = (form) => Object.fromEntries(new FormData(form));

// ---------------------------------------------------------------- icons

const ICONS = {
  home: '<path d="M3 11.5 12 4l9 7.5"/><path d="M5 10v10h14V10"/><path d="M10 20v-5h4v5"/>',
  calendar: '<rect x="3.5" y="5" width="17" height="15" rx="2"/><path d="M3.5 9.5h17M8 3v4M16 3v4"/>',
  users: '<circle cx="9" cy="8.5" r="3.5"/><path d="M2.5 20c.8-3.6 3.3-5.5 6.5-5.5s5.7 1.9 6.5 5.5"/><path d="M16 5.2a3.3 3.3 0 0 1 0 6.6M18 14.8c1.9.7 3.1 2.4 3.5 5.2"/>',
  box: '<path d="M3.5 7.5 12 3l8.5 4.5v9L12 21l-8.5-4.5z"/><path d="M3.5 7.5 12 12l8.5-4.5M12 12v9"/>',
  wallet: '<rect x="3" y="6.5" width="18" height="13.5" rx="2.5"/><path d="M3 10.5h18M16 15.5h2"/><path d="M6.5 6.5 15 3.5l1.2 3"/>',
  settings: '<path d="M4 6h9M17 6h3M4 12h3M11 12h9M4 18h11M19 18h1"/><circle cx="15" cy="6" r="2"/><circle cx="9" cy="12" r="2"/><circle cx="17" cy="18" r="2"/>',
  logout: '<path d="M15 4h3a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2h-3"/><path d="M10 16l-4-4 4-4M6 12h10"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  left: '<path d="M15 5l-7 7 7 7"/>',
  right: '<path d="M9 5l7 7-7 7"/>',
  search: '<circle cx="11" cy="11" r="6.5"/><path d="M20 20l-4.2-4.2"/>',
  card: '<rect x="2.5" y="5.5" width="19" height="13" rx="2.5"/><path d="M2.5 10h19M6 15h4"/>',
  alert: '<path d="M12 3.5 2.5 20h19z"/><path d="M12 10v4.5M12 17.5v.01"/>',
  info: '<circle cx="12" cy="12" r="9"/><path d="M12 11v5.5M12 7.5v.01"/>',
  check: '<path d="M5 12.5l4.5 4.5L19 7.5"/>',
  x: '<path d="M6 6l12 12M18 6 6 18"/>',
  moon: '<path d="M20 14.5A8 8 0 0 1 9.5 4a8 8 0 1 0 10.5 10.5z"/>',
  printer: '<path d="M7 9V3.5h10V9"/><rect x="3.5" y="9" width="17" height="8" rx="2"/><path d="M7 14h10v6.5H7z"/>',
  download: '<path d="M12 4v11M7 10.5l5 5 5-5M4.5 20h15"/>',
  clock: '<circle cx="12" cy="12" r="8.5"/><path d="M12 7.5V12l3 2"/>',
  menu: '<path d="M4 7h16M4 12h16M4 17h16"/>',
  key: '<circle cx="8" cy="15" r="4"/><path d="M11 12l9-9M16 7l3 3"/>',
  edit: '<path d="M4 20h4L19 9l-4-4L4 16z"/><path d="M13.5 6.5l4 4"/>',
  list: '<path d="M8 6h12M8 12h12M8 18h12M4 6h.01M4 12h.01M4 18h.01"/>',
};

export const icon = (name) => raw(
  `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICONS[name] ?? ''}</svg>`,
);

export const brandMark = () => raw(
  '<svg class="brand-mark" viewBox="0 0 64 64" aria-hidden="true"><rect width="64" height="64" rx="14" fill="#2a2b2f"/><path d="M32 12 50 32 32 52 14 32Z" fill="none" stroke="#c8925a" stroke-width="4"/><path d="M32 23 41 32 32 41 23 32Z" fill="#c8925a"/></svg>',
);

// ---------------------------------------------------------------- states

export const empty = (text, name = 'info') => html`<div class="empty">${icon(name)}<p>${text}</p></div>`;

export const skeleton = () => html`<div class="skeleton" aria-busy="true" aria-label="Chargement"><div></div><div></div><div></div><div></div></div>`;

export const errorState = (e) => html`
  <div class="card"><div class="empty">${icon('alert')}
    <p><strong>Impossible d’afficher cette page.</strong></p>
    <p class="muted">${e?.message ?? 'Erreur inconnue.'}</p>
    <button class="btn" data-act="retry">Réessayer</button>
  </div></div>`;

// ---------------------------------------------------------------- toasts

export function toast(message, kind = 'ok') {
  const box = document.getElementById('toasts');
  const el = document.createElement('div');
  el.className = `toast ${kind === 'error' ? 'error' : ''}`;
  el.innerHTML = `${icon(kind === 'error' ? 'alert' : 'check')}<span>${esc(message)}</span>`;
  box.append(el);
  setTimeout(() => el.remove(), kind === 'error' ? 7000 : 4000);
}

// ---------------------------------------------------------------- busy forms and buttons

function showFormError(form, message) {
  const box = form.querySelector('.form-error');
  if (box) {
    box.textContent = message;
    box.hidden = false;
    box.scrollIntoView({ block: 'nearest' });
  } else {
    toast(message, 'error');
  }
}

export async function submitForm(form, fn) {
  const btn = form.querySelector('[type="submit"]');
  if (btn?.getAttribute('aria-busy') === 'true') return undefined;
  const box = form.querySelector('.form-error');
  if (box) box.hidden = true;
  btn?.setAttribute('aria-busy', 'true');
  if (btn) btn.disabled = true;
  try {
    return await fn();
  } catch (e) {
    showFormError(form, e.message);
    return undefined;
  } finally {
    btn?.removeAttribute('aria-busy');
    if (btn) btn.disabled = false;
  }
}

export async function busy(btn, fn) {
  if (btn.getAttribute('aria-busy') === 'true') return undefined;
  btn.setAttribute('aria-busy', 'true');
  btn.disabled = true;
  try {
    return await fn();
  } catch (e) {
    toast(e.message, 'error');
    return undefined;
  } finally {
    btn.removeAttribute('aria-busy');
    btn.disabled = false;
  }
}

// ---------------------------------------------------------------- modals

const stack = [];
let modalSeq = 0;

export function openModal({ title, size = '', onClose } = {}) {
  const root = document.getElementById('modal-root');
  const previous = document.activeElement;
  const id = `modal-title-${(modalSeq += 1)}`;
  const backdrop = document.createElement('div');
  backdrop.className = 'modal-backdrop';
  backdrop.innerHTML = `<div class="modal ${size}" role="dialog" aria-modal="true" aria-labelledby="${id}">
    <div class="modal-head"><h2 id="${id}">${esc(title)}</h2>
    <button type="button" class="icon-btn" data-close aria-label="Fermer">${icon('x')}</button></div>
    <div class="modal-body"></div></div>`;
  root.append(backdrop);
  const body = backdrop.querySelector('.modal-body');
  let closed = false;
  const modal = {
    el: backdrop,
    body,
    render(tpl, handlers = {}) {
      mount(body, tpl, { ...handlers, actions: { close: () => modal.close(), ...(handlers.actions ?? {}) } });
      const first = body.querySelector('[autofocus], input:not([type="hidden"]):not([disabled]), select, textarea, button[type="submit"]');
      (first ?? body).focus?.();
    },
    close() {
      if (closed) return;
      closed = true;
      backdrop.remove();
      stack.splice(stack.indexOf(modal), 1);
      onClose?.();
      if (previous && document.contains(previous)) previous.focus();
    },
  };
  backdrop.addEventListener('mousedown', (e) => {
    if (e.target === backdrop) modal.close();
  });
  backdrop.querySelector('[data-close]').addEventListener('click', () => modal.close());
  stack.push(modal);
  return modal;
}

export function closeAllModals() {
  while (stack.length) stack[stack.length - 1].close();
}

document.addEventListener('keydown', (e) => {
  const top = stack[stack.length - 1];
  if (!top) return;
  if (e.key === 'Escape') {
    e.preventDefault();
    top.close();
    return;
  }
  if (e.key === 'Tab') {
    const items = [...top.el.querySelectorAll('a[href], button:not([disabled]), input:not([disabled]):not([type="hidden"]), select:not([disabled]), textarea:not([disabled])')]
      .filter((el) => el.offsetParent !== null);
    if (!items.length) return;
    const first = items[0];
    const last = items[items.length - 1];
    if (e.shiftKey && document.activeElement === first) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && document.activeElement === last) {
      e.preventDefault();
      first.focus();
    }
  }
});

// A confirmation dialog that runs `run(values)` and stays open with the error if the server refuses.
export function actionDialog({ title, message = '', body = '', confirmLabel = 'Confirmer', danger = false, reasonLabel = null, run }) {
  const m = openModal({ title });
  m.render(html`
    <form data-form="act" class="form-grid" novalidate>
      ${message ? html`<p>${message}</p>` : ''}
      ${body}
      ${reasonLabel ? html`<label class="field"><span>${reasonLabel}</span>
        <textarea name="reason" required minlength="3" maxlength="300"></textarea></label>` : ''}
      <div class="form-error" role="alert" hidden></div>
      <div class="modal-actions">
        <button type="button" class="btn" data-act="close">Retour</button>
        <button type="submit" class="btn ${danger ? 'btn-danger' : 'btn-primary'}">${confirmLabel}</button>
      </div>
    </form>`, {
    forms: {
      act: (form) => submitForm(form, async () => {
        const values = formValues(form);
        if (reasonLabel && String(values.reason ?? '').trim().length < 3) throw new Error('Indiquez un motif (3 caractères minimum).');
        await run(values);
        m.close();
      }),
    },
  });
  return m;
}
