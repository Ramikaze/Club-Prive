// Sign-in, and on a brand-new club the first installation: the first administrator account is
// created with the installation code (SETUP_TOKEN secret on Cloudflare). The same code gives that
// account a new identifier and password when they are lost.
import { useEffect, useRef, useState } from 'react';
import BrandLogo from '../components/ui/BrandLogo.jsx';
import { FormError, Notice, PasswordField, Skeleton } from '../components/ui/ui.jsx';
import { prefersReducedMotion } from '../lib/smoke.js';
import { api } from '../lib/api.js';
import { useSubmit } from '../lib/hooks.js';
import { useStore } from '../store/useStore.js';

function LoginForm({ onSignedIn, onForgot }) {
  const [v, setV] = useState({ login: '', password: '' });
  const { busy, error, submit } = useSubmit();
  const set = (k) => (e) => setV({ ...v, [k]: e.target.value });
  const onSubmit = (e) => {
    e.preventDefault();
    submit(async () => {
      if (!v.login || !v.password) throw new Error('Saisissez votre identifiant et votre mot de passe.');
      onSignedIn(await api.post('/api/login', { login: v.login, password: v.password }));
    });
  };
  return (
    <form className="login-card" onSubmit={onSubmit} noValidate>
      <div><h1>Connexion</h1><p className="muted">Espace réservé au personnel et aux propriétaires.</p></div>
      <label className="field"><span>Identifiant</span>
        <input autoComplete="username" autoCapitalize="none" spellCheck="false" required autoFocus value={v.login} onChange={set('login')} /></label>
      <PasswordField label="Mot de passe" autoComplete="current-password" required value={v.password} onChange={set('password')} />
      <FormError error={error} />
      <button className="btn btn-primary btn-block" type="submit" disabled={busy} aria-busy={busy}>Se connecter</button>
      <button type="button" className="login-link" onClick={onForgot}>Identifiant ou mot de passe oublié ?</button>
    </form>
  );
}

function SetupForm({ tokenConfigured, onSignedIn }) {
  const [v, setV] = useState({ setup_token: '', name: '', login: '', password: '', confirm: '' });
  const { busy, error, submit } = useSubmit();
  const set = (k) => (e) => setV({ ...v, [k]: e.target.value });
  const onSubmit = (e) => {
    e.preventDefault();
    submit(async () => {
      if (!v.setup_token || !v.name || !v.login || !v.password) throw new Error('Remplissez tous les champs.');
      if (v.password !== v.confirm) throw new Error('La confirmation ne correspond pas au mot de passe.');
      const { confirm, ...body } = v;
      onSignedIn(await api.post('/api/setup', body));
    });
  };
  return (
    <form className="login-card" onSubmit={onSubmit} noValidate>
      <div>
        <h1>Installation du club</h1>
        <p className="muted">Créez le compte du premier propriétaire. Il pourra ensuite créer les comptes des associés et du gérant.</p>
      </div>
      {!tokenConfigured && (
        <Notice kind="warn">
          Le code d’installation n’est pas encore configuré sur le serveur. Définissez le secret SETUP_TOKEN
          (npx wrangler secret put SETUP_TOKEN), puis rechargez cette page.
        </Notice>
      )}
      <PasswordField label="Code d’installation" help="La valeur du secret SETUP_TOKEN, choisie lors de la mise en ligne."
        autoComplete="off" required autoFocus value={v.setup_token} onChange={set('setup_token')} />
      <label className="field"><span>Votre nom</span>
        <input autoComplete="name" required maxLength={80} value={v.name} onChange={set('name')} /></label>
      <label className="field"><span>Identifiant</span>
        <input autoComplete="username" autoCapitalize="none" spellCheck="false" required value={v.login} onChange={set('login')} />
        <span className="help">3 à 40 caractères : lettres, chiffres, point, tiret.</span></label>
      <PasswordField label="Mot de passe" help="10 caractères minimum."
        autoComplete="new-password" minLength={10} required value={v.password} onChange={set('password')} />
      <PasswordField label="Confirmation" autoComplete="new-password" required value={v.confirm} onChange={set('confirm')} />
      <FormError error={error} />
      <button className="btn btn-primary btn-block" type="submit" disabled={busy || !tokenConfigured} aria-busy={busy}>Créer le compte et entrer</button>
    </form>
  );
}

function ResetForm({ tokenConfigured, onSignedIn, onBack }) {
  const [v, setV] = useState({ setup_token: '', login: '', password: '', confirm: '' });
  const { busy, error, submit } = useSubmit();
  const set = (k) => (e) => setV({ ...v, [k]: e.target.value });
  const onSubmit = (e) => {
    e.preventDefault();
    submit(async () => {
      if (!v.setup_token || !v.login || !v.password) throw new Error('Remplissez tous les champs.');
      if (v.password !== v.confirm) throw new Error('La confirmation ne correspond pas au mot de passe.');
      const { confirm, ...body } = v;
      onSignedIn(await api.post('/api/setup/reset', body));
    });
  };
  return (
    <form className="login-card" onSubmit={onSubmit} noValidate>
      <div>
        <h1>Identifiants oubliés</h1>
        <p className="muted">Avec le code d’installation, choisissez un nouvel identifiant et un nouveau mot de passe pour le compte du propriétaire.</p>
      </div>
      {!tokenConfigured && (
        <Notice kind="warn">Le code d’installation n’est pas configuré sur le serveur : la réinitialisation est impossible.</Notice>
      )}
      <PasswordField label="Code d’installation" help="La valeur du secret SETUP_TOKEN, choisie lors de la mise en ligne."
        autoComplete="off" required autoFocus value={v.setup_token} onChange={set('setup_token')} />
      <label className="field"><span>Nouvel identifiant</span>
        <input autoComplete="username" autoCapitalize="none" spellCheck="false" required value={v.login} onChange={set('login')} />
        <span className="help">3 à 40 caractères : lettres, chiffres, point, tiret.</span></label>
      <PasswordField label="Nouveau mot de passe" help="10 caractères minimum."
        autoComplete="new-password" minLength={10} required value={v.password} onChange={set('password')} />
      <PasswordField label="Confirmation" autoComplete="new-password" required value={v.confirm} onChange={set('confirm')} />
      <FormError error={error} />
      <button className="btn btn-primary btn-block" type="submit" disabled={busy || !tokenConfigured} aria-busy={busy}>Réinitialiser et entrer</button>
      <button type="button" className="login-link" onClick={onBack}>Retour à la connexion</button>
    </form>
  );
}

// Once signed in, the card and the smoke zoom towards the viewer, then the app comes out of the
// dark (AppShell, `entering`). With reduced motion, a short fade only.
const LEAVE_MS = 420;

export default function Login() {
  const [setup, setSetup] = useState(null);
  const [forgot, setForgot] = useState(false);
  const [leaving, setLeaving] = useState(false);
  const smoke = useRef(null);
  const onSignedIn = (bundle) => {
    setLeaving(true);
    setTimeout(() => {
      useStore.getState().setBundle(bundle);
      useStore.setState({ entering: true });
    }, prefersReducedMotion() ? 150 : LEAVE_MS);
  };
  // Filmed cigar smoke in a seamless loop (Pexels « A Smoke in a Dark Room », free licence), muted;
  // under reduced motion only its still frame shows.
  useEffect(() => {
    const video = smoke.current;
    video.muted = true;
    if (!prefersReducedMotion()) video.play().catch(() => {});
  }, []);
  useEffect(() => {
    api.get('/api/setup').then(setSetup).catch(() => setSetup({ needed: false }));
  }, []);
  return (
    <div className={`login-page${leaving ? ' is-leaving' : ''}`}>
      <video ref={smoke} className="login-smoke" src="/login-smoke.mp4" poster="/login-smoke.jpg" muted loop playsInline preload="auto" aria-hidden="true" />
      <div className="login-stack">
        <BrandLogo className="login-logo" />
        {!setup && <div className="login-card"><Skeleton /></div>}
        {setup && (setup.needed
          ? <SetupForm tokenConfigured={setup.token_configured} onSignedIn={onSignedIn} />
          : forgot
            ? <ResetForm tokenConfigured={setup.token_configured} onSignedIn={onSignedIn} onBack={() => setForgot(false)} />
            : <LoginForm onSignedIn={onSignedIn} onForgot={() => setForgot(true)} />)}
      </div>
    </div>
  );
}
