// Application shell: login, layout, hash router.
import { api, html, state, setBundle, isAdmin, setUnauthorizedHandler, ROLE_LABEL } from './core.js';
import {
  mount, icon, brandMark, skeleton, errorState, closeAllModals, openModal, submitForm, formValues, toast,
} from './ui.js';
import { dashboardView } from './views/dashboard.js';
import { agendaView } from './views/agenda.js';
import { membersView, memberView, cardView } from './views/members.js';
import { reservationView } from './views/reservation.js';
import { productsView } from './views/products.js';
import { financeView } from './views/finance.js';
import { settingsView } from './views/settings.js';

const NAV = [
  { path: '/', label: 'Tableau de bord', short: 'Accueil', icon: 'home' },
  { path: '/agenda', label: 'Agenda', short: 'Agenda', icon: 'calendar' },
  { path: '/membres', label: 'Membres et cartes', short: 'Membres', icon: 'users' },
  { path: '/produits', label: 'Produits et stocks', short: 'Stocks', icon: 'box' },
  { path: '/caisse', label: 'Encaissements et sous-comptes', short: 'Caisse', icon: 'wallet' },
  { path: '/parametres', label: 'Paramètres', icon: 'settings', admin: true },
];

const ROUTES = [
  { re: /^\/$/, view: dashboardView, nav: '/' },
  { re: /^\/agenda$/, view: agendaView, nav: '/agenda' },
  { re: /^\/membres$/, view: membersView, nav: '/membres' },
  { re: /^\/membres\/(\d+)$/, view: memberView, nav: '/membres' },
  { re: /^\/cartes\/(\d+)$/, view: cardView, nav: '/membres' },
  { re: /^\/reservations\/(\d+)$/, view: reservationView, nav: '/agenda' },
  { re: /^\/produits$/, view: productsView, nav: '/produits' },
  { re: /^\/caisse$/, view: financeView, nav: '/caisse' },
  { re: /^\/parametres$/, view: settingsView, nav: '/parametres', admin: true },
];

let navToken = 0;
let loginShown = false;

// ---------------------------------------------------------------- theme

function applyTheme() {
  let t = null;
  try { t = localStorage.getItem('theme'); } catch { /* storage unavailable */ }
  if (t === 'light' || t === 'dark') document.documentElement.dataset.theme = t;
  else delete document.documentElement.dataset.theme;
}

function toggleTheme() {
  const current = document.documentElement.dataset.theme
    || (matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');
  try { localStorage.setItem('theme', current === 'dark' ? 'light' : 'dark'); } catch { /* storage unavailable */ }
  applyTheme();
}

// ---------------------------------------------------------------- account actions

async function logout() {
  try { await api.post('/api/logout', {}); } catch { /* session already gone */ }
  state.me = null;
  showLogin();
}

function openPasswordDialog() {
  const m = openModal({ title: 'Changer mon mot de passe' });
  m.render(html`
    <form data-form="pw" class="form-grid" novalidate>
      <label class="field"><span>Mot de passe actuel</span><input type="password" name="current_password" autocomplete="current-password" required></label>
      <label class="field"><span>Nouveau mot de passe</span><input type="password" name="new_password" autocomplete="new-password" minlength="10" required>
        <span class="help">10 caractères minimum.</span></label>
      <label class="field"><span>Confirmation</span><input type="password" name="confirm" autocomplete="new-password" required></label>
      <div class="form-error" role="alert" hidden></div>
      <div class="modal-actions"><button type="button" class="btn" data-act="close">Annuler</button>
        <button type="submit" class="btn btn-primary">Enregistrer</button></div>
    </form>`, {
    forms: {
      pw: (form) => submitForm(form, async () => {
        const v = formValues(form);
        if (v.new_password !== v.confirm) throw new Error('La confirmation ne correspond pas au nouveau mot de passe.');
        await api.post('/api/me/password', { current_password: v.current_password, new_password: v.new_password });
        m.close();
        toast('Mot de passe modifié. Vos autres sessions ont été fermées.');
      }),
    },
  });
}

function openAccountMenu() {
  const m = openModal({ title: state.me.name });
  m.render(html`
    <div class="stack">
      <p class="muted">${ROLE_LABEL[state.me.role]} · identifiant ${state.me.login}</p>
      ${isAdmin() ? html`<a class="btn btn-block" href="#/parametres" data-act="go-settings">${icon('settings')} Paramètres</a>` : ''}
      <button class="btn btn-block" data-act="password">${icon('key')} Changer mon mot de passe</button>
      <button class="btn btn-block" data-act="theme">${icon('moon')} Thème clair / sombre</button>
      <button class="btn btn-block btn-danger" data-act="logout">${icon('logout')} Se déconnecter</button>
    </div>`, {
    actions: {
      'go-settings': () => { m.close(); location.hash = '#/parametres'; },
      password: () => { m.close(); openPasswordDialog(); },
      theme: () => toggleTheme(),
      logout: () => { m.close(); logout(); },
    },
  });
}

// ---------------------------------------------------------------- layout

function renderShell() {
  const s = state.settings;
  const nav = NAV.filter((n) => !n.admin || isAdmin());
  mount(document.getElementById('app'), html`
    <div class="shell">
      <aside class="sidebar" aria-label="Navigation principale">
        <div class="brand">${brandMark()}<div><div class="brand-name">${s.club_name}</div><div class="brand-sub">Gestion du club</div></div></div>
        <nav class="side-nav">
          ${nav.map((n) => html`<a href="#${n.path}" data-nav="${n.path}">${icon(n.icon)}<span>${n.label}</span></a>`)}
        </nav>
        <div class="side-user">
          <div><div class="who">${state.me.name}</div><div class="role">${ROLE_LABEL[state.me.role]}</div></div>
          <div class="row">
            <button class="btn btn-sm" data-act="password" title="Changer mon mot de passe">${icon('key')}<span class="sr-only">Mot de passe</span></button>
            <button class="btn btn-sm" data-act="theme" title="Thème clair / sombre">${icon('moon')}<span class="sr-only">Thème</span></button>
            <button class="btn btn-sm" data-act="logout">${icon('logout')} Déconnexion</button>
          </div>
        </div>
      </aside>
      <div class="main-col">
        <header class="topbar">
          <div class="brand">${brandMark()}<div class="brand-name">${s.club_name}</div></div>
          <button class="icon-btn" data-act="menu" aria-label="Compte et réglages">${icon('menu')}</button>
        </header>
        ${s.demo_mode ? html`<div class="banner" role="note">${icon('info')}
          <span><strong>Mode démonstration</strong> — membres et produits fictifs ; tarifs non validés utilisables et signalés.</span>
          ${isAdmin() ? html`<a href="#/parametres">Paramètres</a>` : ''}</div>` : ''}
        <main id="main" tabindex="-1"></main>
      </div>
      <nav class="tabbar" aria-label="Navigation">
        ${NAV.filter((n) => !n.admin).map((n) => html`<a href="#${n.path}" data-nav="${n.path}">${icon(n.icon)}<span>${n.short}</span></a>`)}
      </nav>
    </div>`, {
    actions: { logout, password: openPasswordDialog, theme: toggleTheme, menu: openAccountMenu },
  });
}

// ---------------------------------------------------------------- router

function parseHash() {
  const h = location.hash.replace(/^#/, '') || '/';
  const [path, query = ''] = h.split('?');
  return { path, query: Object.fromEntries(new URLSearchParams(query)) };
}

async function navigate({ keepScroll = false } = {}) {
  const main = document.getElementById('main');
  if (!main || !state.me) return;
  const { path, query } = parseHash();
  const route = ROUTES.find((r) => r.re.test(path));
  closeAllModals();
  for (const a of document.querySelectorAll('[data-nav]')) {
    if (a.dataset.nav === route?.nav) a.setAttribute('aria-current', 'page');
    else a.removeAttribute('aria-current');
  }
  const token = (navToken += 1);
  const ctx = {
    main, query, path,
    params: route ? path.match(route.re).slice(1) : [],
    isCurrent: () => token === navToken,
    render: (tpl, handlers) => {
      if (token === navToken) mount(main, tpl, handlers);
    },
    refresh: () => navigate({ keepScroll: true }),
    go: (p) => { location.hash = `#${p}`; },
    setQuery: (q, { replace = false } = {}) => {
      const qsText = new URLSearchParams(Object.entries(q).filter(([, v]) => v !== undefined && v !== null && v !== '')).toString();
      const target = `#${path}${qsText ? `?${qsText}` : ''}`;
      if (replace) history.replaceState(null, '', target);
      else location.hash = target;
    },
    reloadShell: (bundle) => {
      setBundle(bundle);
      renderShell();
      navigate({ keepScroll: true });
    },
  };
  if (!route) {
    mount(main, html`<div class="card"><div class="empty">${icon('alert')}<p>Page introuvable.</p><a class="btn" href="#/">Tableau de bord</a></div></div>`);
    return;
  }
  if (route.admin && !isAdmin()) {
    mount(main, html`<div class="card"><div class="empty">${icon('alert')}<p>Cette page est réservée aux administrateurs.</p></div></div>`);
    return;
  }
  if (!keepScroll) {
    mount(main, skeleton());
    window.scrollTo(0, 0);
  }
  try {
    await route.view(ctx);
    if (!keepScroll && token === navToken) main.focus({ preventScroll: true });
  } catch (e) {
    if (token !== navToken || e.status === 401) return;
    mount(main, errorState(e), { actions: { retry: () => navigate() } });
  }
}

// ---------------------------------------------------------------- login & boot

function showLogin() {
  if (loginShown) return;
  loginShown = true;
  closeAllModals();
  state.me = null;
  document.title = 'Connexion — Gestion du club';
  mount(document.getElementById('app'), html`
    <div class="login-page">
      <form class="login-card" data-form="login" novalidate>
        ${brandMark()}
        <div><h1>Connexion</h1><p class="muted">Espace réservé au personnel et aux propriétaires du club.</p></div>
        <label class="field"><span>Identifiant</span><input name="login" autocomplete="username" autocapitalize="none" spellcheck="false" required autofocus></label>
        <label class="field"><span>Mot de passe</span><input name="password" type="password" autocomplete="current-password" required></label>
        <div class="form-error" role="alert" hidden></div>
        <button class="btn btn-primary btn-block" type="submit">Se connecter</button>
      </form>
    </div>`, {
    forms: {
      login: (form) => submitForm(form, async () => {
        const v = formValues(form);
        if (!v.login || !v.password) throw new Error('Saisissez votre identifiant et votre mot de passe.');
        const bundle = await api.post('/api/login', { login: v.login, password: v.password });
        loginShown = false;
        start(bundle);
      }),
    },
  });
  document.querySelector('.login-card input[name="login"]')?.focus();
}

function start(bundle) {
  setBundle(bundle);
  renderShell();
  if (!location.hash) history.replaceState(null, '', '#/');
  navigate();
}

async function boot() {
  applyTheme();
  setUnauthorizedHandler(() => showLogin());
  window.addEventListener('hashchange', () => navigate());
  try {
    start(await api.get('/api/me'));
  } catch (e) {
    if (e.status === 401) {
      showLogin();
      return;
    }
    mount(document.getElementById('app'), html`<div class="login-page"><div class="login-card">
      <h1>Serveur injoignable</h1><p class="muted">${e.message}</p>
      <button class="btn btn-primary" data-act="reload">Réessayer</button></div></div>`, { actions: { reload: () => location.reload() } });
  }
}

boot();
