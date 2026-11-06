import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App.jsx';
import './club.css';
import './app.css';

// A new version put online removes the files of the old one: a page left open since then can no longer load a
// part fetched on demand (the Excel or PDF export). It reloads to get the new version, once a minute at most so a
// real network failure cannot loop; with no storage to remember that, it does not reload and the error shows.
window.addEventListener('vite:preloadError', (event) => {
  try {
    if (Date.now() - (Number(sessionStorage.getItem('club-reload-at')) || 0) < 60_000) return;
    sessionStorage.setItem('club-reload-at', String(Date.now()));
  } catch {
    return;
  }
  event.preventDefault();
  window.location.reload();
});

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
