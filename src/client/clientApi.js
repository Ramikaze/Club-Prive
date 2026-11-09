// API client of the client space (/api/client/*): the same retry and idempotency rules as src/lib/api.js (a write
// carries one Idempotency-Key per action, so a retried request is applied once), but it never carries the demo-space
// header: a client always talks to the real club. A 401 sends back to the client's own sign-in, a 403
// MOT_DE_PASSE_A_CHOISIR to the « choose your password » screen; the staff's sign-in is never involved.
import { ApiError, newKey } from '../lib/api.js';

export { ApiError };

let onSignedOut = () => {};
let onPasswordFirst = () => {};
export const setClientHandlers = ({ signedOut, passwordFirst }) => {
  onSignedOut = signedOut;
  onPasswordFirst = passwordFirst;
};

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
// A wrong password at sign-in answers 401 too: that is no lost session.
const NO_SIGNOUT = new Set(['/api/client/login']);

async function request(method, url, body, key) {
  const headers = { Accept: 'application/json' };
  if (method !== 'GET') headers['Content-Type'] = 'application/json';
  if (key) headers['Idempotency-Key'] = key;
  const retriable = method === 'GET' || Boolean(key);
  for (let attempt = 0; ; attempt += 1) {
    let res;
    try {
      res = await fetch(url, {
        method, headers, credentials: 'same-origin', body: method === 'GET' ? undefined : JSON.stringify(body ?? {}),
      });
    } catch {
      if (retriable && attempt < 2) {
        await sleep(600 * (attempt + 1));
        continue;
      }
      throw new ApiError(0, 'RESEAU', 'Connexion au serveur impossible. Vérifiez le réseau puis réessayez : l’opération ne sera pas enregistrée deux fois.');
    }
    if (res.status >= 502 && res.status <= 504 && retriable && attempt < 2) {
      await sleep(600 * (attempt + 1));
      continue;
    }
    let data = null;
    try { data = await res.json(); } catch { /* empty body */ }
    if (res.status === 401 && !NO_SIGNOUT.has(url)) onSignedOut();
    if (res.status === 403 && data?.error?.code === 'MOT_DE_PASSE_A_CHOISIR') onPasswordFirst();
    if (!res.ok) {
      throw new ApiError(res.status, data?.error?.code ?? 'ERREUR', data?.error?.message ?? `Erreur ${res.status}.`, data?.error?.details);
    }
    return data;
  }
}

export const qs = (params) => {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== null && v !== '') p.set(k, v);
  const s = p.toString();
  return s ? `?${s}` : '';
};

export const clientApi = {
  get: (url) => request('GET', url),
  // A write: one key per user action. Sign-in and password changes carry none (their bodies hold passwords, which the
  // server never keeps an idempotency record of).
  post: (url, body, key = newKey()) => request('POST', url, body, key),
  secret: (url, body) => request('POST', url, body, null),
  // Read-only computations sent with POST (the quote).
  preview: (url, body) => request('POST', url, body, null),
};

// A product picture: a plain <img> sends the session cookie (Path=/api/client). The version in the address changes
// with the photo, and the browser keeps each picture.
export const clientPhotoUrl = (product) => (
  product.photo_version ? `/api/client/products/${product.id}/photo?v=${encodeURIComponent(product.photo_version)}` : null
);
