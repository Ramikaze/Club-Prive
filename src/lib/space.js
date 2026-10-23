// Which club this browser works on: the real one (default) or the demo space, a practice copy with
// fictitious data. The choice is kept in localStorage so that a reload stays where it was.
export const SPACE_KEY = 'club-espace';

// Storage can throw (private mode, blocked site data). Reading then means the real site and writing
// does nothing: failing towards the real site is the safe side.
function readChoice() {
  try { return localStorage.getItem(SPACE_KEY) === 'demo'; } catch { return false; }
}

function writeChoice(demo) {
  try {
    if (demo) localStorage.setItem(SPACE_KEY, 'demo');
    else localStorage.removeItem(SPACE_KEY);
  } catch { /* nothing to remember */ }
}

// A page reads the choice once, when it loads, and keeps it. If another tab enters or leaves the demo
// meanwhile, this page must not start sending its requests to the other space under a frame that says
// otherwise: only a reload (enterDemo, leaveDemo) or clearSpace changes the space of a page.
let inDemo = readChoice();

export const isDemoSpace = () => inDemo;

// Entering or leaving reloads the whole page on `/`, so no page keeps data of the other space.
export function enterDemo() {
  writeChoice(true);
  window.location.assign('/');
}

export function leaveDemo() {
  writeChoice(false);
  window.location.assign('/');
}

// Signing out (or an expired session) ends the practice session without a reload: signing in again
// always lands on the real site.
export function clearSpace() {
  inDemo = false;
  writeChoice(false);
}
