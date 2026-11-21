// A new version put online (npm run deploy) reaches the pages already open: computers, phones, the app added to the
// home screen. Each build has its own name, written into the page (<meta name="club-build">) and next to it in
// /version.json (vite.config.js). A page compares its own name with the server's: another one means a new version is
// online, and the notice (UpdateNotice.jsx) offers to reload now or in 5 minutes, so nobody loses what they are typing.
// The reload is enough to take the new files, the home-screen app included: the service worker (public/sw.js) keeps
// nothing in cache.

export const CHECK_EVERY_MS = 60_000;
export const SNOOZE_MS = 5 * 60_000;

// The name of the build this page was loaded from; empty without one (`npm run dev`): no notice then.
export const pageBuild = () => globalThis.document?.querySelector('meta[name="club-build"]')?.content ?? '';

// The name of the build the server holds now, or null when it cannot tell (no network, no file, another answer).
// Never from the browser's cache: an old answer would hide the new version.
export async function serverBuild(fetchImpl = globalThis.fetch) {
  try {
    const res = await fetchImpl('/version.json', { cache: 'no-store' });
    if (!res.ok) return null;
    const { build } = await res.json();
    return typeof build === 'string' && build ? build : null;
  } catch {
    return null;
  }
}

// Whether the notice shows: once the server holds another build, unless « Dans 5 minutes » hid it less than 5 minutes
// ago. Every change is told to the subscribers (the notice, through useSyncExternalStore).
export function createUpdates({ build, read = serverBuild, now = () => Date.now() }) {
  let available = false;
  let until = 0;
  let shown = false;
  let timer = null;
  const listeners = new Set();
  const refresh = () => {
    const next = available && now() >= until;
    if (next === shown) return;
    shown = next;
    for (const listener of listeners) listener();
  };
  return {
    shown: () => shown,
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    // Asks the server until it holds another build, then asks nothing more. Each check also looks at the clock: a
    // device asleep during the 5 minutes may not have run the timer of snooze().
    async check() {
      if (build && !available) {
        const server = await read();
        if (server && server !== build) available = true;
      }
      refresh();
    },
    // « Dans 5 minutes »: hidden now, shown again 5 minutes later.
    snooze() {
      until = now() + SNOOZE_MS;
      clearTimeout(timer);
      timer = setTimeout(() => {
        until = 0;
        refresh();
      }, SNOOZE_MS);
      refresh();
    },
  };
}

// Asks at once, then every minute while the page is shown, and again as soon as it is shown or the network is back.
// A hidden page (phone asleep, another app in front) asks nothing. Gives the function that stops it.
export function watchUpdates(updates, { doc = globalThis.document, win = globalThis.window, every = CHECK_EVERY_MS } = {}) {
  const check = () => {
    if (doc?.visibilityState !== 'hidden') updates.check();
  };
  check();
  const timer = setInterval(check, every);
  doc?.addEventListener('visibilitychange', check);
  win?.addEventListener('online', check);
  return () => {
    clearInterval(timer);
    doc?.removeEventListener('visibilitychange', check);
    win?.removeEventListener('online', check);
  };
}
