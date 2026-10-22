// Sign-in, and on a brand-new club the first installation: the first administrator account is
// created with the installation code (SETUP_TOKEN secret on Cloudflare).
import { useEffect, useRef, useState } from 'react';
import { FormError, Notice, Skeleton } from '../components/ui/ui.jsx';
import { startAmbientSmoke } from '../lib/ambientSmoke.js';
import { prefersReducedMotion } from '../lib/smoke.js';
import { api } from '../lib/api.js';
import { useSubmit } from '../lib/hooks.js';
import { useStore } from '../store/useStore.js';

function LoginForm({ onSignedIn }) {
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
      <p className="login-eyebrow">Limen · Club privé</p>
      <div><h1>Connexion</h1><p className="muted">Espace réservé au personnel et aux propriétaires.</p></div>
      <label className="field"><span>Identifiant</span>
        <input autoComplete="username" autoCapitalize="none" spellCheck="false" required autoFocus value={v.login} onChange={set('login')} /></label>
      <label className="field"><span>Mot de passe</span>
        <input type="password" autoComplete="current-password" required value={v.password} onChange={set('password')} /></label>
      <FormError error={error} />
      <button className="btn btn-primary btn-block" type="submit" disabled={busy} aria-busy={busy}>Se connecter</button>
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
      <p className="login-eyebrow">Limen · Club privé</p>
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
      <label className="field"><span>Code d’installation</span>
        <input type="password" autoComplete="off" required autoFocus value={v.setup_token} onChange={set('setup_token')} />
        <span className="help">La valeur du secret SETUP_TOKEN, choisie lors de la mise en ligne.</span></label>
      <label className="field"><span>Votre nom</span>
        <input autoComplete="name" required maxLength={80} value={v.name} onChange={set('name')} /></label>
      <label className="field"><span>Identifiant</span>
        <input autoComplete="username" autoCapitalize="none" spellCheck="false" required value={v.login} onChange={set('login')} />
        <span className="help">3 à 40 caractères : lettres, chiffres, point, tiret.</span></label>
      <label className="field"><span>Mot de passe</span>
        <input type="password" autoComplete="new-password" minLength={10} required value={v.password} onChange={set('password')} />
        <span className="help">10 caractères minimum.</span></label>
      <label className="field"><span>Confirmation</span>
        <input type="password" autoComplete="new-password" required value={v.confirm} onChange={set('confirm')} /></label>
      <FormError error={error} />
      <button className="btn btn-primary btn-block" type="submit" disabled={busy || !tokenConfigured} aria-busy={busy}>Créer le compte et entrer</button>
    </form>
  );
}

// Once signed in, the card and the smoke zoom towards the viewer, then the app comes out of the
// dark (AppShell, `entering`). With reduced motion, a short fade only.
const LEAVE_MS = 420;

export default function Login() {
  const [setup, setSetup] = useState(null);
  const [leaving, setLeaving] = useState(false);
  const smoke = useRef(null);
  const onSignedIn = (bundle) => {
    setLeaving(true);
    setTimeout(() => {
      useStore.getState().setBundle(bundle);
      useStore.setState({ entering: true });
    }, prefersReducedMotion() ? 150 : LEAVE_MS);
  };
  useEffect(() => startAmbientSmoke(smoke.current), []);
  useEffect(() => {
    api.get('/api/setup').then((s) => {
      setSetup(s);
      if (s.instance_label) document.title = `[${s.instance_label}] Connexion — Limen`;
    }).catch(() => setSetup({ needed: false }));
  }, []);
  return (
    <div className={`login-page${leaving ? ' is-leaving' : ''}`}>
      <canvas ref={smoke} className="login-smoke" aria-hidden="true" />
      <div className="login-stack">
        {setup?.instance_label && <p className="login-instance" role="note">{setup.instance_label} · site d’essai</p>}
        {!setup && <div className="login-card"><Skeleton /></div>}
        {setup && (setup.needed
          ? <SetupForm tokenConfigured={setup.token_configured} onSignedIn={onSignedIn} />
          : <LoginForm onSignedIn={onSignedIn} />)}
      </div>
    </div>
  );
}
