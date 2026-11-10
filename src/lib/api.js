// API client: JSON over fetch with the same-origin session cookie and safe retries.
// Every write carries an Idempotency-Key, one per user action: a retried request (network drop,
// double click) is applied only once by the server.
// In the demo space every request also carries X-Club-Espace: demo, which makes the Worker serve it
// from the demo database (worker/space.js). Nothing else may call /api: a plain link or a raw fetch
// carries no such header and would get the real club's data, so files go through api.download.
import { isDemoSpace } from './space.js';

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

// A read the page no longer needs (filters changed, page left) is cancelled through its AbortSignal. It fails with
// this AbortError at once: never retried, never reported as a network failure, so the caller can ignore it.
const aborted = () => new DOMException('Lecture annulée.', 'AbortError');

// Waits before a retry; a cancelled read stops waiting at once.
const sleep = (ms, signal) => new Promise((resolve, reject) => {
  const stop = () => { clearTimeout(timer); reject(aborted()); };
  const timer = setTimeout(() => { signal?.removeEventListener('abort', stop); resolve(); }, ms);
  if (signal?.aborted) stop();
  else signal?.addEventListener('abort', stop, { once: true });
});

const NO_REDIRECT = new Set(['/api/login', '/api/setup']);

// A download answers with the file itself, named by the server; only its failures are JSON.
const fileName = (res) => /filename="?([^";]+)"?/i.exec(res.headers.get('Content-Disposition') ?? '')?.[1] ?? 'export.csv';

// `anonymous` is for the public pages (the receipt check): no demo header, since they always answer from the
// real club whatever space this browser was left in. `signal` cancels the request (see `aborted`).
async function request(method, url, body, key, { asFile = false, anonymous = false, signal } = {}) {
  const headers = { Accept: asFile ? 'text/csv, application/json' : 'application/json' };
  if (isDemoSpace() && !anonymous) headers['X-Club-Espace'] = 'demo';
  if (method !== 'GET') headers['Content-Type'] = 'application/json';
  if (key) headers['Idempotency-Key'] = key;
  const retriable = method === 'GET' || Boolean(key);
  for (let attempt = 0; ; attempt += 1) {
    if (signal?.aborted) throw aborted();
    let res;
    let blob = null;
    try {
      res = await fetch(url, {
        method, headers, credentials: 'same-origin', signal,
        body: method === 'GET' ? undefined : JSON.stringify(body ?? {}),
      });
      // Read with the fetch, so a connection cut half way is retried like any other network failure.
      if (asFile && res.ok) blob = await res.blob();
    } catch {
      if (signal?.aborted) throw aborted();
      if (retriable && attempt < 2) {
        await sleep(600 * (attempt + 1), signal);
        continue;
      }
      throw new ApiError(0, 'RESEAU', "Connexion au serveur impossible. Vérifiez le réseau puis réessayez : l'opération ne sera pas enregistrée deux fois.");
    }
    if (res.status >= 502 && res.status <= 504 && retriable && attempt < 2) {
      await sleep(600 * (attempt + 1), signal);
      continue;
    }
    if (blob) return { blob, name: fileName(res) };
    let data = null;
    try { data = await res.json(); } catch { /* empty body */ }
    // Cancelled while the body was read: the empty `data` above is not the answer.
    if (signal?.aborted) throw aborted();
    if (res.status === 401 && !NO_REDIRECT.has(url)) onUnauthorized();
    if (!res.ok) {
      throw new ApiError(res.status, data?.error?.code ?? 'ERREUR', data?.error?.message ?? `Le serveur n’a pas pu répondre (erreur ${res.status}). Réessayez ; si cela continue, prévenez l’administrateur.`, data?.error?.details);
    }
    return data;
  }
}

// Hands a file to the browser as a download.
function saveFile(blob, name) {
  const href = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = href;
  link.download = name;
  document.body.append(link);
  link.click();
  link.remove();
  // The download starts on its own time: free the object URL once it has had time to.
  setTimeout(() => URL.revokeObjectURL(href), 10000);
}

export const api = {
  // `signal` (optional): an AbortSignal that cancels the read, e.g. the one useLoad hands its loader.
  get: (url, { signal } = {}) => request('GET', url, undefined, null, { signal }),
  // A public read: never carries the demo-space header.
  getPublic: (url) => request('GET', url, undefined, null, { anonymous: true }),
  post: (url, body, key = newKey()) => request('POST', url, body, key),
  put: (url, body, key = newKey()) => request('PUT', url, body, key),
  del: (url, body = {}, key = newKey()) => request('DELETE', url, body, key),
  // Read-only computations sent with POST (previews): no idempotency key needed.
  preview: (url, body) => request('POST', url, body, null),
  // Saves a file the API sends (the CSV exports). A plain link cannot carry the demo header, so in the
  // demo space it would download the real club's data: the file is fetched here and saved from memory.
  download: async (url) => {
    const { blob, name } = await request('GET', url, undefined, null, { asFile: true });
    saveFile(blob, name);
  },
};

export const qs = (params) => {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== null && v !== '') p.set(k, v);
  const s = p.toString();
  return s ? `?${s}` : '';
};
