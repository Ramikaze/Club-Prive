// Small building blocks shared by every page: status chips, empty / loading / error states,
// notices and the page header. Class names come from src/club.css.
import { Link } from 'react-router-dom';
import Icon from './Icon.jsx';
import { STATUS, ACCOUNT_LABEL } from '../../lib/format.js';

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
