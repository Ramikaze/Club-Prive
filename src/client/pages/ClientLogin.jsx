// The client's sign-in (identifier or member number + password; the first time, his member number and the temporary
// code the club gave him in place of the password) and the « choose » screen: his identifier and password at the first
// sign-in, his identifier alone for an access made with the phone, and « Changer mon mot de passe » later.
// No password is kept once it is sent: the fields are emptied as soon as the request leaves.
import { useId, useState } from 'react';
import BrandLogo from '../../components/ui/BrandLogo.jsx';
import { FormError, PasswordField } from '../../components/ui/ui.jsx';
import { useSubmit } from '../../lib/hooks.js';
import { clientApi } from '../clientApi.js';

export function ClientLogin({ onSignedIn }) {
  const helpId = useId();
  const [login, setLogin] = useState('');
  const [password, setPassword] = useState('');
  const { busy, error, submit } = useSubmit();
  const onSubmit = (e) => {
    e.preventDefault();
    submit(async () => {
      if (!login.trim() || !password) throw new Error('Saisissez votre identifiant (ou votre numéro de membre) et votre mot de passe.');
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
            <p className="muted">Connectez-vous avec votre identifiant. La première fois, saisissez le code que le club vous a remis à la place du mot de passe.</p>
          </div>
          <label className="field"><span>Identifiant ou numéro de membre</span>
            <input
              type="text" autoCapitalize="none" autoCorrect="off" spellCheck={false} autoComplete="username" autoFocus required
              aria-describedby={`${helpId}-help`} value={login} onChange={(e) => setLogin(e.target.value)}
            />
            <span className="help" id={`${helpId}-help`}>La première fois : votre numéro de membre (M-… ou C-…) et le code reçu du club.</span>
          </label>
          <PasswordField label="Mot de passe ou code" autoComplete="current-password" required value={password} onChange={(e) => setPassword(e.target.value)} />
          <FormError error={error} />
          <button className="btn btn-primary btn-block" type="submit" disabled={busy} aria-busy={busy}>Se connecter</button>
        </form>
      </div>
    </div>
  );
}

const LOGIN_RULES = '4 à 30 caractères : lettres sans accent, chiffres, point ou tiret. Pas uniquement des chiffres.';

// `first`: the « choose » step at sign-in; `mustSetPassword`: the temporary code opened the session, so no current
// password is asked and the new one comes with the identifier; without it (an access made with the phone, signed in
// with its password) only the identifier is chosen. `login`: the identifier already chosen, offered for a change.
// Not `first`: « Changer mon mot de passe » (the identifier does not change there).
export function ClientPassword({ first, mustSetPassword = true, login = null, onDone, onCancel }) {
  const loginId = useId();
  const [name, setName] = useState(login ?? '');
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [again, setAgain] = useState('');
  const { busy, error, submit } = useSubmit();
  const onlyLogin = first && !mustSetPassword;
  const withPassword = !onlyLogin;
  const clear = () => { setCurrent(''); setNext(''); setAgain(''); };
  const onSubmit = (e) => {
    e.preventDefault();
    submit(async () => {
      if (first && !name.trim()) throw new Error('Choisissez votre identifiant.');
      if (!first && !current) throw new Error('Saisissez votre mot de passe actuel.');
      if (withPassword) {
        if (next.length < 10) throw new Error('Le mot de passe doit compter au moins 10 caractères.');
        if (next !== again) throw new Error('La confirmation ne correspond pas au nouveau mot de passe.');
      }
      if (onlyLogin) {
        onDone(await clientApi.secret('/api/client/login-name', { login: name }));
        return;
      }
      const body = first ? { login: name, new_password: next } : { current_password: current, new_password: next };
      clear();
      onDone(await clientApi.secret('/api/client/password', body));
    });
  };
  let title = 'Changer mon mot de passe';
  if (onlyLogin) title = 'Choisissez votre identifiant';
  else if (first) title = 'Choisissez votre identifiant et votre mot de passe';
  let intro = null;
  if (onlyLogin) intro = 'Ce sera votre identifiant pour toutes vos prochaines connexions, avec votre mot de passe actuel.';
  else if (first) intro = 'Ils serviront à toutes vos prochaines connexions. Le code remis par le club ne servira plus.';
  const form = (
    <form className={first ? 'login-card' : 'card stack'} onSubmit={onSubmit} noValidate>
      <div>
        <h1>{title}</h1>
        {intro && <p className="muted">{intro}</p>}
      </div>
      {first && (
        <label className="field"><span>Votre identifiant</span>
          <input
            type="text" autoCapitalize="none" autoCorrect="off" spellCheck={false} autoComplete="username" autoFocus required
            aria-describedby={`${loginId}-help`} value={name} onChange={(e) => setName(e.target.value)}
          />
          <span className="help" id={`${loginId}-help`}>{LOGIN_RULES}</span>
        </label>
      )}
      {!first && <PasswordField label="Mot de passe actuel" autoComplete="current-password" required value={current} onChange={(e) => setCurrent(e.target.value)} />}
      {withPassword && <PasswordField label="Nouveau mot de passe" help="10 caractères au minimum." autoComplete="new-password" required value={next} onChange={(e) => setNext(e.target.value)} />}
      {withPassword && <PasswordField label="Nouveau mot de passe, une seconde fois" autoComplete="new-password" required value={again} onChange={(e) => setAgain(e.target.value)} />}
      <FormError error={error} />
      <button className="btn btn-primary btn-block" type="submit" disabled={busy} aria-busy={busy}>Enregistrer</button>
      {onCancel && <button type="button" className="login-link" onClick={() => { clear(); onCancel(); }}>Annuler</button>}
    </form>
  );
  // At the first sign-in the screen stands alone; changing the password later it sits in the page.
  return first ? <div className="login-page"><div className="login-stack"><BrandLogo className="login-logo" />{form}</div></div> : form;
}
