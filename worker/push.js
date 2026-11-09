// Push notifications on the staff's devices (spec « Espace client »): a client's Boutique order or reservation request
// is told to the manager and the associé(s) concerned, on every device each of them turned notifications on.
//  - The sending is Web Push, with WebCrypto alone (no library): the message is encrypted for the browser (RFC 8291,
//    aes128gcm) and the club signs as the sender with its VAPID key pair (RFC 8292). The keys are three Worker secrets,
//    VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY and VAPID_SUBJECT (scripts/vapid-keys.mjs makes them); without them nothing is sent.
//  - The rest is mixed into Club (end of club.js): who is told, the devices, and the texts. No method opens a transaction
//    of its own. The API sends once the write has committed (worker/api.js).
import { invalid } from './errors.js';
import { RAYONS, SHOP } from '../shared/roles.js';
import { fmtDuration } from '../shared/rules.js';
import { weekday } from '../shared/time.js';

const encoder = new TextEncoder();
// One record of 4096 bytes holds the whole message: 16 bytes of authentication tag and the 1-byte delimiter leave the rest.
const RECORD_SIZE = 4096;
const MAX_MESSAGE = RECORD_SIZE - 16 - 1;
// A push service that does not answer within this time is given up (the API waits for all the sends this long at most).
export const PUSH_TIMEOUT_MS = 4000;
const MAX_ENDPOINT = 1000;
const URL_COMMANDES = '/#/commandes';

function b64uEncode(bytes) {
  let s = '';
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

// base64url, padded or not; anything else gives null.
function b64uDecode(text) {
  const s = String(text ?? '');
  if (!/^[A-Za-z0-9_-]*={0,2}$/.test(s)) return null;
  try {
    const bin = atob(s.replace(/=+$/, '').replace(/-/g, '+').replace(/_/g, '/'));
    return Uint8Array.from(bin, (c) => c.charCodeAt(0));
  } catch {
    return null;
  }
}

function concat(...parts) {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let at = 0;
  for (const p of parts) {
    out.set(p, at);
    at += p.length;
  }
  return out;
}

async function hkdf(salt, ikm, info, length) {
  const key = await crypto.subtle.importKey('raw', ikm, 'HKDF', false, ['deriveBits']);
  return new Uint8Array(await crypto.subtle.deriveBits({ name: 'HKDF', hash: 'SHA-256', salt, info }, key, length * 8));
}

// A browser's public key (P-256, uncompressed: 65 bytes from 0x04) and its authentication secret (16 bytes).
const browserKey = (text) => {
  const key = b64uDecode(text);
  return key?.length === 65 && key[0] === 4 ? key : null;
};
const browserAuth = (text) => {
  const auth = b64uDecode(text);
  return auth?.length === 16 ? auth : null;
};

// RFC 8291: the message encrypted for one browser, as the body of the push request. A fresh key pair of the server and a
// fresh salt each time; the header carries the salt, the record size and, as key id, the server's public key.
export async function encryptPayload(payload, p256dhB64url, authB64url) {
  const uaPublic = browserKey(p256dhB64url);
  const authSecret = browserAuth(authB64url);
  if (!uaPublic || !authSecret) throw new Error('Clés de l’abonnement push invalides.');
  if (payload.length > MAX_MESSAGE) throw new Error('Message push trop long.');
  const server = await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits']);
  const asPublic = new Uint8Array(await crypto.subtle.exportKey('raw', server.publicKey));
  const uaKey = await crypto.subtle.importKey('raw', uaPublic, { name: 'ECDH', namedCurve: 'P-256' }, false, []);
  const shared = new Uint8Array(await crypto.subtle.deriveBits({ name: 'ECDH', public: uaKey }, server.privateKey, 256));
  const ikm = await hkdf(authSecret, shared, concat(encoder.encode('WebPush: info\0'), uaPublic, asPublic), 32);
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const cek = await hkdf(salt, ikm, encoder.encode('Content-Encoding: aes128gcm\0'), 16);
  const nonce = await hkdf(salt, ikm, encoder.encode('Content-Encoding: nonce\0'), 12);
  const key = await crypto.subtle.importKey('raw', cek, 'AES-GCM', false, ['encrypt']);
  // One record, so it is the last: the message, then the delimiter 0x02 (no padding).
  const sealed = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv: nonce }, key, concat(payload, Uint8Array.of(2))));
  const header = new Uint8Array(21);
  header.set(salt);
  new DataView(header.buffer).setUint32(16, RECORD_SIZE);
  header[20] = asPublic.length;
  return concat(header, asPublic, sealed);
}

// RFC 8292: the Authorization header that signs the club as the sender, for the push service of `endpoint`. The private
// key is the secret's `d`; its x and y come from the public key.
export async function vapidAuthorization(endpoint, { publicKey, privateKey, subject }) {
  const pub = b64uDecode(publicKey);
  if (pub?.length !== 65 || pub[0] !== 4) throw new Error('Clé publique VAPID invalide.');
  const jwk = { kty: 'EC', crv: 'P-256', x: b64uEncode(pub.slice(1, 33)), y: b64uEncode(pub.slice(33)), d: String(privateKey).trim() };
  const key = await crypto.subtle.importKey('jwk', jwk, { name: 'ECDSA', namedCurve: 'P-256' }, false, ['sign']);
  const part = (value) => b64uEncode(encoder.encode(JSON.stringify(value)));
  const unsigned = `${part({ typ: 'JWT', alg: 'ES256' })}.${part({
    aud: new URL(endpoint).origin, exp: Math.floor(Date.now() / 1000) + 12 * 3600, sub: subject,
  })}`;
  // WebCrypto signs ECDSA as r‖s (64 bytes), the form a JWS wants.
  const signature = new Uint8Array(await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, key, encoder.encode(unsigned)));
  return `vapid t=${unsigned}.${b64uEncode(signature)}, k=${publicKey}`;
}

// Sends one message to one device: `subscription` is the browser's ({ endpoint, keys: { p256dh, auth } }), `vapid` the
// club's three secrets. Gives the push service's status (201 sent; 404 or 410 the device is gone). Kept an hour by the
// push service if the device is off.
export async function sendWebPush(subscription, message, vapid) {
  const body = await encryptPayload(encoder.encode(JSON.stringify(message)), subscription.keys.p256dh, subscription.keys.auth);
  const res = await fetch(subscription.endpoint, {
    method: 'POST',
    headers: {
      TTL: '3600',
      'Content-Encoding': 'aes128gcm',
      'Content-Type': 'application/octet-stream',
      Urgency: 'high',
      Authorization: await vapidAuthorization(subscription.endpoint, vapid),
    },
    body,
    signal: AbortSignal.timeout(PUSH_TIMEOUT_MS),
  });
  try {
    await res.body?.cancel();
  } catch { /* the answer's body is not read */ }
  return { status: res.status };
}

// An address to send a device's notifications to: https, at most 1000 characters.
function pushEndpoint(value) {
  const bad = () => invalid('Adresse de notification invalide.');
  if (typeof value !== 'string' || !value || value.length > MAX_ENDPOINT) throw bad();
  let url;
  try {
    url = new URL(value);
  } catch {
    throw bad();
  }
  if (url.protocol !== 'https:') throw bad();
  return value;
}

const JOURS = ['dimanche', 'lundi', 'mardi', 'mercredi', 'jeudi', 'vendredi', 'samedi'];
const MOIS = ['janvier', 'février', 'mars', 'avril', 'mai', 'juin', 'juillet', 'août', 'septembre', 'octobre', 'novembre', 'décembre'];
// 'YYYY-MM-DD' -> « samedi 14 novembre ».
const dayLabel = (date) => {
  const [, m, d] = date.split('-').map(Number);
  return `${JOURS[weekday(date)]} ${d} ${MOIS[m - 1]}`;
};

export const pushMethods = {
  // Who is told: every active manager, and the active associés of the order's rayons (`accounts`), or of both for a
  // request. Never the administrator, never a deactivated account.
  pushRecipients(what) {
    const rayons = what?.request ? RAYONS : RAYONS.filter((r) => (what?.accounts ?? []).includes(r));
    return this.all(
      `SELECT id FROM users WHERE active = 1
         AND (role = 'gerant' OR (role = 'associe' AND rayon IN (SELECT value FROM json_each(?))))
       ORDER BY id`, JSON.stringify(rayons),
    ).map((u) => u.id);
  },

  // The devices of these accounts, in the browser's form.
  pushSubscriptionsOf(userIds) {
    return this.all(
      'SELECT endpoint, p256dh, auth FROM push_subscriptions WHERE user_id IN (SELECT value FROM json_each(?)) ORDER BY id',
      JSON.stringify(userIds ?? []),
    ).map((s) => ({ endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } }));
  },

  // A device turns notifications on for the signed-in account. A device is one row: signed in with another account, it
  // now notifies that one.
  subscribePush(user, input) {
    const endpoint = pushEndpoint(input?.endpoint);
    const p256dh = input?.keys?.p256dh;
    const auth = input?.keys?.auth;
    if (typeof p256dh !== 'string' || typeof auth !== 'string' || !browserKey(p256dh) || !browserAuth(auth)) {
      throw invalid('Clés de l’abonnement aux notifications invalides.');
    }
    this.run(
      `INSERT INTO push_subscriptions (user_id, endpoint, p256dh, auth, created_at) VALUES (?, ?, ?, ?, ?)
       ON CONFLICT(endpoint) DO UPDATE SET user_id = excluded.user_id, p256dh = excluded.p256dh, auth = excluded.auth,
         created_at = excluded.created_at`,
      user.id, endpoint, p256dh, auth, this.nowIso(),
    );
    return { ok: true };
  },

  // A device turns notifications off: only one of the account's own is removed (another's is left as it is).
  unsubscribePush(user, input) {
    if (typeof input?.endpoint !== 'string' || !input.endpoint) throw invalid('Adresse de notification invalide.');
    this.run('DELETE FROM push_subscriptions WHERE endpoint = ? AND user_id = ?', input.endpoint, user.id);
    return { ok: true };
  },

  // The push service no longer knows the device (404, 410).
  forgetPushSubscription(endpoint) {
    this.run('DELETE FROM push_subscriptions WHERE endpoint = ?', endpoint);
  },

  // « Cigares — Awa MBEMBA — 3 articles »: the rayons of the order, the client, the number of articles.
  orderNotification(orderId) {
    const o = this.get(
      'SELECT o.id, m.first_name, m.last_name FROM client_orders o JOIN members m ON m.id = o.member_id WHERE o.id = ?', orderId,
    );
    const lines = this.all('SELECT account, quantity FROM client_order_lines WHERE order_id = ?', o.id);
    const accounts = RAYONS.filter((r) => lines.some((l) => l.account === r));
    const count = lines.reduce((n, l) => n + l.quantity, 0);
    return {
      userIds: this.pushRecipients({ accounts }),
      title: 'Nouvelle commande Boutique',
      body: `${accounts.map((r) => SHOP[r].tab).join(' et ')} — ${o.first_name} ${o.last_name} — ${count} article${count > 1 ? 's' : ''}`,
      url: URL_COMMANDES,
    };
  },

  // « Awa MBEMBA — samedi 14 novembre 15:00, 1 h 30 »: the client, the day, the time of arrival, the duration.
  requestNotification(requestId) {
    const r = this.get(
      `SELECT r.date, r.start_time, r.duration_min, m.first_name, m.last_name
       FROM reservation_requests r JOIN members m ON m.id = r.member_id WHERE r.id = ?`, requestId,
    );
    return {
      userIds: this.pushRecipients({ request: true }),
      title: 'Demande de réservation',
      body: `${r.first_name} ${r.last_name} — ${dayLabel(r.date)} ${r.start_time}, ${fmtDuration(r.duration_min)}`,
      url: URL_COMMANDES,
    };
  },
};
