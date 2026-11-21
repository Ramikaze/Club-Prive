// A new version put online (npm run deploy) must reach the pages already open (computers, phones, the app on the home
// screen) without losing a form being filled in. Each build has its own name, written into the page and into
// /version.json (vite.config.js); a page compares its own with the server's (src/lib/update.js), and the notice offers
// « Mettre à jour » (reload now) or « Dans 5 minutes » (hide, then show again).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import config from '../vite.config.js';
import { CHECK_EVERY_MS, SNOOZE_MS, createUpdates, serverBuild, watchUpdates } from '../src/lib/update.js';

const read = (path) => readFileSync(new URL(path, import.meta.url), 'utf8');

test('chaque construction porte un nom, le même dans la page et dans version.json', () => {
  const plugin = config.plugins.flat().find((p) => p?.name === 'club-version');
  assert.ok(plugin, 'vite.config.js ajoute le plugin club-version');
  const meta = plugin.transformIndexHtml().find((tag) => tag.tag === 'meta' && tag.attrs.name === 'club-build');
  assert.ok(meta, 'la page reçoit <meta name="club-build">');
  const files = [];
  plugin.generateBundle.call({ emitFile: (file) => files.push(file) });
  const file = files.find((f) => f.fileName === 'version.json');
  assert.ok(file, 'la construction écrit version.json');
  assert.equal(JSON.parse(file.source).build, meta.attrs.content);
  assert.match(meta.attrs.content, /^\d{4}-\d\d-\d\dT\d\d:\d\d/);
});

test('version.json n’est jamais gardé en cache', () => {
  assert.match(read('../public/_headers'), /\n\/version\.json\n\s+Cache-Control: no-store\n/);
});

test('la version du serveur est lue dans /version.json, sans le cache du navigateur', async () => {
  const calls = [];
  const build = await serverBuild(async (url, init) => {
    calls.push({ url, init });
    return Response.json({ build: '2026-11-21T19:00:00.000Z' });
  });
  assert.equal(build, '2026-11-21T19:00:00.000Z');
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, '/version.json');
  assert.equal(calls[0].init.cache, 'no-store');
});

test('pas de réponse lisible (hors ligne, fichier absent, autre chose) : aucune version', async () => {
  assert.equal(await serverBuild(async () => { throw new TypeError('Failed to fetch'); }), null);
  assert.equal(await serverBuild(async () => new Response('introuvable', { status: 404 })), null);
  assert.equal(await serverBuild(async () => new Response('<!doctype html><title>Limen</title>')), null);
  assert.equal(await serverBuild(async () => Response.json(null)), null);
  assert.equal(await serverBuild(async () => Response.json({})), null);
  assert.equal(await serverBuild(async () => Response.json({ build: '' })), null);
  assert.equal(await serverBuild(async () => Response.json({ build: 42 })), null);
});

test('même version que le serveur : pas de bandeau', async () => {
  const updates = createUpdates({ build: 'v1', read: async () => 'v1' });
  await updates.check();
  assert.equal(updates.shown(), false);
});

test('serveur muet (hors ligne) : pas de bandeau', async () => {
  const updates = createUpdates({ build: 'v1', read: async () => null });
  await updates.check();
  assert.equal(updates.shown(), false);
});

test('nouvelle version en ligne : le bandeau s’affiche et l’écran en est prévenu', async () => {
  const updates = createUpdates({ build: 'v1', read: async () => 'v2' });
  let told = 0;
  updates.subscribe(() => { told += 1; });
  await updates.check();
  assert.equal(updates.shown(), true);
  assert.equal(told, 1);
});

test('la nouvelle version vue, le serveur n’est plus interrogé', async () => {
  let reads = 0;
  const updates = createUpdates({ build: 'v1', read: async () => { reads += 1; return 'v2'; } });
  await updates.check();
  await updates.check();
  assert.equal(reads, 1);
  assert.equal(updates.shown(), true);
});

test('page sans nom de version (npm run dev) : jamais de bandeau, rien n’est demandé', async () => {
  let reads = 0;
  const updates = createUpdates({ build: '', read: async () => { reads += 1; return 'v2'; } });
  await updates.check();
  assert.equal(updates.shown(), false);
  assert.equal(reads, 0);
});

test('« Dans 5 minutes » cache le bandeau, qui revient 5 minutes plus tard', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout', 'Date'] });
  assert.equal(SNOOZE_MS, 5 * 60 * 1000);
  const updates = createUpdates({ build: 'v1', read: async () => 'v2' });
  await updates.check();
  const seen = [];
  updates.subscribe(() => seen.push(updates.shown()));
  updates.snooze();
  assert.equal(updates.shown(), false);
  t.mock.timers.tick(SNOOZE_MS - 1000);
  await updates.check();
  assert.equal(updates.shown(), false, 'un contrôle pendant la pause ne le ramène pas');
  t.mock.timers.tick(1000);
  assert.equal(updates.shown(), true);
  assert.deepEqual(seen, [false, true]);
});

test('appareil en veille pendant la pause : le bandeau revient au premier contrôle après les 5 minutes', async (t) => {
  // The timers are frozen (a device asleep runs none), while the clock goes on.
  t.mock.timers.enable({ apis: ['setTimeout'] });
  let clock = 1_000_000;
  const updates = createUpdates({ build: 'v1', read: async () => 'v2', now: () => clock });
  await updates.check();
  updates.snooze();
  clock += SNOOZE_MS;
  assert.equal(updates.shown(), false);
  await updates.check();
  assert.equal(updates.shown(), true);
});

function fakePage() {
  const doc = new EventTarget();
  doc.visibilityState = 'visible';
  return { doc, win: new EventTarget() };
}

test('contrôle à l’ouverture, puis chaque minute tant que la page est visible, et dès qu’elle revient', (t) => {
  t.mock.timers.enable({ apis: ['setInterval'] });
  assert.equal(CHECK_EVERY_MS, 60 * 1000);
  const { doc, win } = fakePage();
  let checks = 0;
  const stop = watchUpdates({ check: () => { checks += 1; } }, { doc, win });
  assert.equal(checks, 1, 'à l’ouverture');
  t.mock.timers.tick(CHECK_EVERY_MS);
  assert.equal(checks, 2, 'une minute plus tard');
  doc.visibilityState = 'hidden';
  t.mock.timers.tick(CHECK_EVERY_MS * 3);
  assert.equal(checks, 2, 'page cachée (téléphone en veille, autre application) : rien n’est demandé');
  doc.visibilityState = 'visible';
  doc.dispatchEvent(new Event('visibilitychange'));
  assert.equal(checks, 3, 'page de nouveau visible : demandé tout de suite');
  win.dispatchEvent(new Event('online'));
  assert.equal(checks, 4, 'réseau revenu : demandé tout de suite');
  stop();
  t.mock.timers.tick(CHECK_EVERY_MS * 2);
  doc.dispatchEvent(new Event('visibilitychange'));
  win.dispatchEvent(new Event('online'));
  assert.equal(checks, 4, 'arrêté : plus rien');
});

test('le bandeau est posé par-dessus la page (rien ne bouge sous la saisie) et au-dessus des fenêtres', () => {
  const css = read('../src/club.css');
  const rule = (selector) => css.match(new RegExp(`(^|\\n)${selector}\\s*\\{([^}]*)\\}`))?.[2] ?? '';
  const z = (selector) => Number(rule(selector).match(/z-index:\s*(\d+)/)?.[1]);
  assert.match(rule('\\.update-notice'), /position:\s*fixed/);
  assert.ok(z('\\.update-notice') > z('\\.modal-backdrop'), 'au-dessus des fenêtres de saisie');
});

test('le bandeau ne s’imprime pas sur un ticket ou un relevé', () => {
  const css = read('../src/club.css');
  const print = css.slice(css.indexOf('@media print {'));
  const hidden = print.match(/\n\s*([^{}\n]+)\{\s*display:\s*none\s*!important;\s*\}/)?.[1] ?? '';
  assert.ok(hidden.split(',').map((s) => s.trim()).includes('.update-notice'), hidden);
});
