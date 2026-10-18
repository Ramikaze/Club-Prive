// Password hashing and session tokens with WebCrypto, available on Cloudflare Workers and in Node.
// Hashing is asynchronous, so the API layer runs it before opening the (synchronous) transaction.
const ITERATIONS = 100000; // the Workers runtime refuses PBKDF2 above 100 000 iterations
const encoder = new TextEncoder();

const toBase64 = (bytes) => btoa(String.fromCharCode(...bytes));
const fromBase64 = (s) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));

async function derive(password, salt, iterations) {
  const key = await crypto.subtle.importKey('raw', encoder.encode(password), 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt, iterations }, key, 256);
  return new Uint8Array(bits);
}

export function timingSafeEqual(a, b) {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i += 1) diff |= a[i] ^ b[i];
  return diff === 0;
}

export async function hashPassword(password) {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const hash = await derive(password, salt, ITERATIONS);
  return `pbkdf2-sha256$${ITERATIONS}$${toBase64(salt)}$${toBase64(hash)}`;
}

export async function verifyPassword(password, stored) {
  const [alg, n, salt, expected] = String(stored ?? '').split('$');
  const iterations = Number(n);
  if (alg !== 'pbkdf2-sha256' || !salt || !expected || !Number.isInteger(iterations) || iterations < 1 || iterations > ITERATIONS) {
    return false;
  }
  const hash = await derive(password, fromBase64(salt), iterations);
  return timingSafeEqual(hash, fromBase64(expected));
}

export async function sha256Hex(s) {
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', encoder.encode(s)));
  return [...digest].map((b) => b.toString(16).padStart(2, '0')).join('');
}

export function newToken() {
  return toBase64(crypto.getRandomValues(new Uint8Array(32))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export function checkPasswordStrength(password) {
  if (typeof password !== 'string' || password.length < 10) return 'Le mot de passe doit contenir au moins 10 caractères.';
  if (password.length > 200) return 'Mot de passe trop long.';
  return null;
}
