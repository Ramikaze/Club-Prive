// The client's sign-in (phone number + password; the first time, the temporary code the club gave him in place of the
// password) and the « choose your password » screen, used for the first sign-in and for « Changer mon mot de passe ».
// No password is kept once it is sent: the fields are emptied as soon as the request leaves.
import { useState } from 'react';
import BrandLogo from '../../components/ui/BrandLogo.jsx';
import { FormError, PasswordField } from '../../components/ui/ui.jsx';
import { useSubmit } from '../../lib/hooks.js';
import { clientApi } from '../clientApi.js';

export function ClientLogin({ onSignedIn }) {
  const [login, setLogin] = useState('');
  const [password, setPassword] = useState('');
  const { busy, error, submit } = useSubmit();
  const onSubmit = (e) => {
    e.preventDefault();
    submit(async () => {
      if (!login.trim() || !password) throw new Error('Saisissez votre numéro de téléphone et votre mot de passe.');
      const body = { login, password };
      setPassword('');
      onSignedIn(await clientApi.secret('/api/client/login', body));
    });
  };
  return (
    <div className="login-page">
      <div className="login-stack">
        <BrandLogo className="login-logo" />
        <form className="login-card" onSubmit={onSubmit} noValidate>
          <div>
            <h1>Mon espace</h1>
            <p className="muted">Connectez-vous avec votre numéro de téléphone. La première fois, saisissez le code que le club vous a remis à la place du mot de passe.</p>
          </div>
          <label className="field"><span>Numéro de téléphone</span>
            <input type="tel" inputMode="tel" autoComplete="username" autoFocus required value={login} onChange={(e) => setLogin(e.target.value)} /></label>
          <PasswordField label="Mot de passe ou code" autoComplete="current-password" required value={password} onChange={(e) => setPassword(e.target.value)} />
          <FormError error={error} />
          <button className="btn btn-primary btn-block" type="submit" disabled={busy} aria-busy={busy}>Se connecter</button>
        </form>
      </div>
    </div>
  );
}

// `first`: the temporary code opened the session, so no current password is asked.
export function ClientPassword({ first, onDone, onCancel }) {
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [again, setAgain] = useState('');
  const { busy, error, submit } = useSubmit();
  const clear = () => { setCurrent(''); setNext(''); setAgain(''); };
  const onSubmit = (e) => {
    e.preventDefault();
    submit(async () => {
      if (!first && !current) throw new Error('Saisissez votre mot de passe actuel.');
      if (next.length < 10) throw new Error('Le mot de passe doit compter au moins 10 caractères.');
      if (next !== again) throw new Error('La confirmation ne correspond pas au nouveau mot de passe.');
      const body = first ? { new_password: next } : { current_password: current, new_password: next };
      clear();
      onDone(await clientApi.secret('/api/client/password', body));
    });
  };
  const form = (
    <form className={first ? 'login-card' : 'card stack'} onSubmit={onSubmit} noValidate>
      <div>
        <h1>{first ? 'Choisissez votre mot de passe' : 'Changer mon mot de passe'}</h1>
        {first && <p className="muted">Ce sera votre mot de passe pour toutes vos prochaines connexions. Le code remis par le club ne servira plus.</p>}
      </div>
      {!first && <PasswordField label="Mot de passe actuel" autoComplete="current-password" required value={current} onChange={(e) => setCurrent(e.target.value)} />}
      <PasswordField label="Nouveau mot de passe" help="10 caractères au minimum." autoComplete="new-password" required value={next} onChange={(e) => setNext(e.target.value)} />
      <PasswordField label="Nouveau mot de passe, une seconde fois" autoComplete="new-password" required value={again} onChange={(e) => setAgain(e.target.value)} />
      <FormError error={error} />
      <button className="btn btn-primary btn-block" type="submit" disabled={busy} aria-busy={busy}>Enregistrer</button>
      {onCancel && <button type="button" className="login-link" onClick={() => { clear(); onCancel(); }}>Annuler</button>}
    </form>
  );
  // At the first sign-in the screen stands alone; changing the password later it sits in the page.
  return first ? <div className="login-page"><div className="login-stack"><BrandLogo className="login-logo" />{form}</div></div> : form;
}
