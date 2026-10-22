// Light (warm cream) / dark theme: defaults to the warm cream light theme unless the user picked dark.
import { smokeTransition } from './smoke.js';

export function applyTheme() {
  let t = null;
  try { t = localStorage.getItem('theme'); } catch { /* storage unavailable */ }
  document.documentElement.dataset.theme = t === 'dark' ? 'dark' : 'light';
}

let switching = false;

// The new theme arrives through cigar smoke rising from the button that was pressed (see smoke.js).
export function toggleTheme(event) {
  if (switching) return;
  const next = document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark';
  const box = event?.currentTarget?.getBoundingClientRect?.();
  const origin = box?.width ? { x: box.left + box.width / 2, y: box.top + box.height / 2 } : null;
  switching = true;
  smokeTransition({
    to: next,
    origin,
    onCovered: () => {
      try { localStorage.setItem('theme', next); } catch { /* storage unavailable */ }
      applyTheme();
    },
  }).finally(() => { switching = false; });
}

