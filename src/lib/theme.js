// Light / dark theme: follows the device unless the user picked one on this browser.
export function applyTheme() {
  let t = null;
  try { t = localStorage.getItem('theme'); } catch { /* storage unavailable */ }
  if (t === 'light' || t === 'dark') document.documentElement.dataset.theme = t;
  else delete document.documentElement.dataset.theme;
}

export function toggleTheme() {
  const current = document.documentElement.dataset.theme
    || (matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');
  try { localStorage.setItem('theme', current === 'dark' ? 'light' : 'dark'); } catch { /* storage unavailable */ }
  applyTheme();
}
