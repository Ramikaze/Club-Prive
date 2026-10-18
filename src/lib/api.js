// API client: JSON over fetch with the same-origin session cookie and safe retries.
// Every write carries an Idempotency-Key, one per user action: a retried request (network drop,
// double click) is applied only once by the server.
export class ApiError extends Error {
  constructor(status, code, message, details) {
    super(message);
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

let onUnauthorized = () => {};
export const setUnauthorizedHandler = (fn) => { onUnauthorized = fn; };

export function newKey() {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const NO_REDIRECT = new Set(['/api/login', '/api/setup']);

async function request(method, url, body, key) {
  const headers = { Accept: 'application/json' };
  if (method !== 'GET') headers['Content-Type'] = 'application/json';
  if (key) headers['Idempotency-Key'] = key;
  const retriable = method === 'GET' || Boolean(key);
  for (let attempt = 0; ; attempt += 1) {
    let res;
    try {
      res = await fetch(url, {
        method, headers, credentials: 'same-origin',
        body: method === 'GET' ? undefined : JSON.stringify(body ?? {}),
      });
    } catch {
      if (retriable && attempt < 2) {
        await sleep(600 * (attempt + 1));
        continue;
      }
      throw new ApiError(0, 'RESEAU', "Connexion au serveur impossible. Vérifiez le réseau puis réessayez : l'opération ne sera pas enregistrée deux fois.");
    }
    if (res.status >= 502 && res.status <= 504 && retriable && attempt < 2) {
      await sleep(600 * (attempt + 1));
      continue;
    }
    let data = null;
    try { data = await res.json(); } catch { /* empty body */ }
    if (res.status === 401 && !NO_REDIRECT.has(url)) onUnauthorized();
    if (!res.ok) {
      throw new ApiError(res.status, data?.error?.code ?? 'ERREUR', data?.error?.message ?? `Erreur ${res.status}.`, data?.error?.details);
    }
    return data;
  }
}

export const api = {
  get: (url) => request('GET', url),
  post: (url, body, key = newKey()) => request('POST', url, body, key),
  put: (url, body, key = newKey()) => request('PUT', url, body, key),
  // Read-only computations sent with POST (previews): no idempotency key needed.
  preview: (url, body) => request('POST', url, body, null),
};

export const qs = (params) => {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== null && v !== '') p.set(k, v);
  const s = p.toString();
  return s ? `?${s}` : '';
};
