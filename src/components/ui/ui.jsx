// Small building blocks shared by every page: status chips, empty / loading / error states,
// notices, the password field and the page header. Class names come from src/club.css.
import { useId, useRef, useState } from 'react';
import { flushSync } from 'react-dom';
import { Link, useLocation } from 'react-router-dom';
import Icon from './Icon.jsx';
import { STATUS, ACCOUNT_LABEL } from '../../lib/format.js';
import { photoUrl } from '../../lib/photo.js';

export function Chip({ group, value }) {
  const [label, kind] = STATUS[group]?.[value] ?? [value, 'neutral'];
  return <span className={`chip chip-${kind}`}>{label}</span>;
}

export function Hypothesis({ title, label = 'Hypothèse' }) {
  return <span className="chip chip-hyp" title={title}>{label}</span>;
}

export function DemoChip({ on }) {
  return on ? <span className="chip chip-demo" title="Donnée fictive de démonstration">démo</span> : null;
}

// The picture of a product on its light panel (.product-photo, app.css): a small square in a list, or large on the
// product's sheet. A cigar or a bottle stands in when the product has no photo or the photo cannot be loaded.
export function ProductPhoto({ product, large = false }) {
  const url = photoUrl(product);
  // The address that failed to load: a new photo has a new address, which is tried again.
  const [failed, setFailed] = useState(null);
  const shown = url !== null && failed !== url;
  return (
    <span className={`product-photo ${large ? 'product-photo-large' : 'product-photo-thumb'}${shown ? '' : ' is-empty'}`}>
      {shown ? (
        // In a list the product's name stands next to its thumbnail: the picture is not read out a second time.
        <img src={url} alt={large ? product.name : ''} loading={large ? undefined : 'lazy'} decoding="async" onError={() => setFailed(url)} />
      ) : (
        <span className="product-photo-none">
          <Icon name={product.category === 'bouteille' ? 'bottle' : 'cigar'} />
          {large && <span>{url === null ? 'Pas encore de photo' : 'Photo indisponible'}</span>}
        </span>
      )}
    </span>
  );
}

export function AccountTag({ account }) {
  return <span className="nowrap"><i className={`dot dot-${account}`} /> {ACCOUNT_LABEL[account]}</span>;
}

export function Empty({ icon = 'info', children }) {
  return <div className="empty"><Icon name={icon} /><div>{children}</div></div>;
}

export function Skeleton() {
  return <div className="skeleton" aria-busy="true" aria-label="Chargement"><div /><div /><div /><div /></div>;
}

export function ErrorState({ error, onRetry }) {
  return (
    <div className="card">
      <div className="empty">
        <Icon name="alert" />
        <p><strong>Impossible d’afficher cette page.</strong></p>
        <p className="muted">{error?.message ?? 'Erreur inconnue.'}</p>
        {onRetry && <button type="button" className="btn" onClick={onRetry}>Réessayer</button>}
      </div>
    </div>
  );
}

// Shows the skeleton while loading, the error with a retry button, then the page itself.
export function Loaded({ state, children }) {
  if (state.error && !state.data) return <ErrorState error={state.error} onRetry={state.retry} />;
  if (state.data === undefined) return <Skeleton />;
  return children(state.data);
}

export function Notice({ kind = 'info', icon, children }) {
  const glyph = icon ?? (kind === 'danger' || kind === 'warn' ? 'alert' : kind === 'ok' ? 'check' : 'info');
  return <div className={`notice notice-${kind}`}><Icon name={glyph} /><div>{children}</div></div>;
}

export function FormError({ error }) {
  return error ? <div className="form-error" role="alert">{error}</div> : null;
}

// Password field with an eye that shows or hides what was typed; other props go to the <input>.
// The eye stays outside the <label>, so the field is announced by its label alone. Shown as text, the
// password is never capitalised nor corrected by the keyboard.
export function PasswordField({ label, help, ...input }) {
  const id = useId();
  const field = useRef(null);
  const [shown, setShown] = useState(false);
  // Once the click is over, Chrome sends the caret of a field whose type changed back to the start:
  // it is put back where it was.
  const toggle = () => {
    const el = field.current;
    const { selectionStart, selectionEnd } = el;
    flushSync(() => setShown((s) => !s));
    setTimeout(() => { if (document.activeElement === el) el.setSelectionRange(selectionStart, selectionEnd); });
  };
  return (
    <div className="field">
      <label className="field-label" htmlFor={id}>{label}</label>
      <div className="password-input">
        <input
          {...input} ref={field} id={id} type={shown ? 'text' : 'password'}
          autoCapitalize="none" autoCorrect="off" spellCheck={false} aria-describedby={help ? `${id}-help` : undefined}
        />
        <button
          type="button"
          className="password-eye"
          aria-label="Afficher le mot de passe"
          aria-pressed={shown}
          onMouseDown={(e) => e.preventDefault()} // keeps the focus (and the phone keyboard) in the field
          onClick={toggle}
        >
          <Icon name={shown ? 'eye-off' : 'eye'} />
        </button>
      </div>
      {help && <span className="help" id={`${id}-help`}>{help}</span>}
    </div>
  );
}

export function PageHead({ title, lead, back, actions, tour }) {
  return (
    <>
      {back && <Link className="back" to={back.to}><Icon name="left" /> {back.label}</Link>}
      <div className="page-head" data-tour={tour}>
        <div>
          <h1>{title}</h1>
          {lead && <p className="lead">{lead}</p>}
        </div>
        {actions && <div className="actions no-print">{actions}</div>}
      </div>
    </>
  );
}

export function Segmented({ value, options, onChange, label }) {
  return (
    <div className="segmented" role="group" aria-label={label}>
      {options.map(([key, text]) => (
        <button key={key} type="button" aria-pressed={value === key} onClick={() => onChange(key)}>{text}</button>
      ))}
    </div>
  );
}

export function RouteTabs({ items, label }) {
  const { pathname } = useLocation();
  return (
    <nav className="section-tabs no-print" aria-label={label}>
      {items.map(([path, text, icon]) => {
        const active = pathname === path || pathname.startsWith(`${path}/`);
        return (
          <Link key={path} to={path} className={`section-tab ${active ? 'active' : ''}`} aria-current={active ? 'page' : undefined}>
            {icon && <Icon name={icon} />}
            <span>{text}</span>
          </Link>
        );
      })}
    </nav>
  );
}

export function StocksTabs() {
  return (
    <RouteTabs
      label="Rubriques Stocks et Cave"
      items={[
        ['/produits', 'Catalogue & Stocks', 'box'],
        ['/lounge', 'Cave (conservation)', 'humidor'],
      ]}
    />
  );
}

export function CashTabs() {
  return (
    <RouteTabs
      label="Rubriques Caisse"
      items={[
        ['/caisse', 'Encaissements & Notes', 'wallet'],
        ['/depenses', 'Dépenses & Mouvements', 'receipt'],
      ]}
    />
  );
}

export function AdminTabs() {
  return (
    <RouteTabs
      label="Rubriques Administration"
      items={[
        ['/parametres', 'Paramètres du club', 'settings'],
        ['/tresorerie', 'Trésorerie & Bilans', 'bank'],
        ['/grand-livre', 'Grand livre', 'book'],
        ['/cloture', 'Clôture mensuelle', 'lock'],
      ]}
    />
  );
}

