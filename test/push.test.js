// Push notifications of the staff's devices: the message encrypted for the browser (RFC 8291, aes128gcm), the VAPID
// token that signs the sender (RFC 8292), and who is told of a client's order or reservation request. The browser and
// the push service are played by the tests: the API is given a recorder in place of the real sender.
import { test, describe, before, beforeEach, after } from 'node:test';
import assert from 'node:assert/strict';
import { Server, Client, ok, UM } from './harness.js';
import { encryptPayload, vapidAuthorization, sendWebPush } from '../worker/push.js';
import { addDays } from '../shared/time.js';

const subtle = globalThis.crypto.subtle;
const enc = (s) => new TextEncoder().encode(s);
const b64u = (bytes) => Buffer.from(bytes).toString('base64url');
const unb64u = (s) => new Uint8Array(Buffer.from(s, 'base64url'));
const concat = (...parts) => new Uint8Array(Buffer.concat(parts));

async function hkdf(salt, ikm, info, length) {
  const key = await subtle.importKey('raw', ikm, 'HKDF', false, ['deriveBits']);
  return new Uint8Array(await subtle.deriveBits({ name: 'HKDF', hash: 'SHA-256', salt, info }, key, length * 8));
}

// A browser's subscription: its P-256 key pair and its 16-byte authentication secret.
async function browserSubscription(endpoint = 'https://push.test/navigateur') {
  const pair = await subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits']);
  const publicRaw = new Uint8Array(await subtle.exportKey('raw', pair.publicKey));
  const auth = globalThis.crypto.getRandomValues(new Uint8Array(16));
  return { pair, publicRaw, auth, subscription: { endpoint, keys: { p256dh: b64u(publicRaw), auth: b64u(auth) } } };
}

// What the browser does with a message (RFC 8291 §3 and RFC 8188), written here independently of worker/push.js.
async function browserReads(body, { pair, publicRaw, auth }) {
  const salt = body.slice(0, 16);
  const rs = new DataView(body.buffer, body.byteOffset + 16, 4).getUint32(0);
  const idlen = body[20];
  const serverPublic = body.slice(21, 21 + idlen);
  const ciphertext = body.slice(21 + idlen);
  const serverKey = await subtle.importKey('raw', serverPublic, { name: 'ECDH', namedCurve: 'P-256' }, false, []);
  const shared = new Uint8Array(await subtle.deriveBits({ name: 'ECDH', public: serverKey }, pair.privateKey, 256));
  const ikm = await hkdf(auth, shared, concat(enc('WebPush: info\0'), publicRaw, serverPublic), 32);
  const cek = await hkdf(salt, ikm, enc('Content-Encoding: aes128gcm\0'), 16);
  const nonce = await hkdf(salt, ikm, enc('Content-Encoding: nonce\0'), 12);
  const key = await subtle.importKey('raw', cek, 'AES-GCM', false, ['decrypt']);
  const padded = new Uint8Array(await subtle.decrypt({ name: 'AES-GCM', iv: nonce }, key, ciphertext));
  let end = padded.length - 1;
  while (end > 0 && padded[end] === 0) end -= 1;
  assert.equal(padded[end], 2, 'délimiteur du dernier enregistrement');
  return { rs, idlen, serverPublic, text: new TextDecoder().decode(padded.slice(0, end)) };
}

// The club's VAPID key pair, in the form of the three Worker secrets.
async function vapidKeys(subject = 'mailto:club@club.test') {
  const pair = await subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify']);
  const publicKey = b64u(new Uint8Array(await subtle.exportKey('raw', pair.publicKey)));
  const privateKey = (await subtle.exportKey('jwk', pair.privateKey)).d;
  return { pair, vapid: { publicKey, privateKey, subject } };
}

test('chiffrement : le navigateur relit le message', async () => {
  const browser = await browserSubscription();
  const message = { title: 'Nouvelle commande Boutique', body: 'Cigares — Awa MBEMBA — 3 articles', url: '/#/commandes' };
  const { keys } = browser.subscription;
  const body = await encryptPayload(enc(JSON.stringify(message)), keys.p256dh, keys.auth);
  const read = await browserReads(body, browser);
  assert.deepEqual(JSON.parse(read.text), message);
  assert.equal(read.rs, 4096);
  assert.equal(read.idlen, 65);
  assert.equal(read.serverPublic[0], 4);
  // A fresh server key and salt for every message.
  const again = await encryptPayload(enc(JSON.stringify(message)), keys.p256dh, keys.auth);
  assert.notDeepEqual(again.slice(0, 86), body.slice(0, 86));
});

test('VAPID : jeton ES256 vérifiable', async () => {
  const { pair, vapid } = await vapidKeys();
  const from = Math.floor(Date.now() / 1000);
  const header = await vapidAuthorization('https://fcm.googleapis.com/fcm/send/abc:def', vapid);
  const m = /^vapid t=([\w-]+)\.([\w-]+)\.([\w-]+), k=([\w-]+)$/.exec(header);
  assert.ok(m, header);
  assert.equal(m[4], vapid.publicKey);
  assert.deepEqual(JSON.parse(Buffer.from(m[1], 'base64url')), { typ: 'JWT', alg: 'ES256' });
  const signature = unb64u(m[3]);
  assert.equal(signature.length, 64);
  assert.equal(await subtle.verify({ name: 'ECDSA', hash: 'SHA-256' }, pair.publicKey, signature, enc(`${m[1]}.${m[2]}`)), true);
  const claims = JSON.parse(Buffer.from(m[2], 'base64url'));
  assert.equal(claims.aud, 'https://fcm.googleapis.com');
  assert.equal(claims.sub, 'mailto:club@club.test');
  assert.ok(claims.exp >= from + 12 * 3600 && claims.exp <= Math.floor(Date.now() / 1000) + 12 * 3600, String(claims.exp));
});

test('envoi : un POST chiffré et signé au service du navigateur', async () => {
  const browser = await browserSubscription('https://push.test/envoi/123');
  const { vapid } = await vapidKeys();
  const calls = [];
  const realFetch = globalThis.fetch;
  globalThis.fetch = async (url, init) => {
    calls.push({ url: String(url), init });
    return new Response(null, { status: 201 });
  };
  try {
    const res = await sendWebPush(browser.subscription, { title: 'T', body: 'B', url: '/#/commandes' }, vapid);
    assert.deepEqual(res, { status: 201 });
  } finally {
    globalThis.fetch = realFetch;
  }
  assert.equal(calls.length, 1);
  const { url, init } = calls[0];
  assert.equal(url, 'https://push.test/envoi/123');
  assert.equal(init.method, 'POST');
  const headers = new Headers(init.headers);
  assert.equal(headers.get('ttl'), '3600');
  assert.equal(headers.get('content-encoding'), 'aes128gcm');
  assert.equal(headers.get('urgency'), 'high');
  assert.match(headers.get('authorization'), new RegExp(`^vapid t=[\\w-]+\\.[\\w-]+\\.[\\w-]+, k=${vapid.publicKey}$`));
  const read = await browserReads(new Uint8Array(init.body), browser);
  assert.deepEqual(JSON.parse(read.text), { title: 'T', body: 'B', url: '/#/commandes' });
});

// ---------------------------------------------------------------- who is told

const sent = [];
// What the push service answers each send: a status, or an error, or nothing at all.
let answer;
const server = new Server({}, {
  lenientTariffs: true,
  sendPush: async (subscription, message) => {
    sent.push({ endpoint: subscription.endpoint, message, subscription });
    return answer(subscription);
  },
});
const PASSWORD = 'mon-mot-de-passe-client';
const ENDPOINT = (name) => `https://push.test/${name}`;
let device; // the keys every staff device subscribes with
let admin;
let ger;
let cig;
let alc;
let CIG;
let BTL;
let today;
let n = 0;

const endpoints = () => sent.map((s) => s.endpoint).sort();
const subscriptionOf = (name) => server.club.get('SELECT * FROM push_subscriptions WHERE endpoint = ?', ENDPOINT(name));
const subscribe = (client, name) => client.post('/api/push/subscriptions', { endpoint: ENDPOINT(name), keys: device });
const refused = (r, status, code) => {
  assert.equal(r.status, status, JSON.stringify(r.data));
  assert.equal(r.data.error.code, code);
};
// A regular client (orders) or member (requests) with a client access, signed in on a client of his own.
async function person(kind = 'client') {
  n += 1;
  const phone = `06 7${String(n).padStart(2, '0')} 00 00`;
  const m = ok(await ger.post(kind === 'client' ? '/api/clients' : '/api/members', { first_name: 'awa', last_name: `push${n}`, phone }));
  const { code } = ok(await admin.post(`/api/members/${m.id}/client-access`, {}));
  const client = new Client(server);
  ok(await client.post('/api/client/login', { login: phone, password: code }));
  ok(await client.post('/api/client/password', { new_password: PASSWORD }));
  return { member: m, client, name: `${m.first_name} ${m.last_name}` };
}
const order = (who, lines, headers) => who.client.post('/api/client/orders', { lines }, headers);
async function staff(login, role, rayon = null) {
  await server.addUser(login, login, role, `${login}-push-password`, rayon);
  const client = new Client(server);
  await client.login(login, `${login}-push-password`);
  ok(await subscribe(client, login));
  return client;
}

describe('qui est prévenu', () => {
  before(async () => {
    await server.start();
    device = (await browserSubscription()).subscription.keys;
    await server.addUser('admin', 'Propriétaire', 'admin', 'push-admin-password');
    admin = new Client(server);
    today = (await admin.login('admin', 'push-admin-password')).biz_today;
    ok(await subscribe(admin, 'admin'));
    ger = await staff('ger', 'gerant');
    cig = await staff('cig', 'associe', 'cigares');
    alc = await staff('alc', 'associe', 'alcool');
    CIG = ok(await admin.post('/api/products', { category: 'cigare', name: 'Robusto', reference: 'PUSH-C', price: 5000 * UM, initial_stock: 100 })).id;
    BTL = ok(await admin.post('/api/products', { category: 'bouteille', name: 'Brut', reference: 'PUSH-B', price: 40000 * UM, initial_stock: 100 })).id;
  });
  after(() => server.destroy());
  beforeEach(() => {
    sent.length = 0;
    answer = () => ({ status: 201 });
  });

  test('commande cigares : le gérant et l’associé cigares, pas l’associé champagne ni l’admin', async () => {
    const a = await person();
    ok(await order(a, [{ product_id: CIG, quantity: 2 }]));
    assert.deepEqual(endpoints(), [ENDPOINT('cig'), ENDPOINT('ger')]);
    for (const s of sent) {
      assert.deepEqual(s.message, { title: 'Nouvelle commande Boutique', body: `Cigares — ${a.name} — 2 articles`, url: '/#/commandes' });
      assert.deepEqual(s.subscription, { endpoint: s.endpoint, keys: device });
    }
  });

  test('commande des deux rayons : le gérant et les deux associés', async () => {
    const a = await person();
    ok(await order(a, [{ product_id: BTL, quantity: 1 }]));
    assert.deepEqual(endpoints(), [ENDPOINT('alc'), ENDPOINT('ger')]);
    assert.equal(sent[0].message.body, `Champagnes — ${a.name} — 1 article`);
    sent.length = 0;
    ok(await order(a, [{ product_id: BTL, quantity: 1 }, { product_id: CIG, quantity: 3 }]));
    assert.deepEqual(endpoints(), [ENDPOINT('alc'), ENDPOINT('cig'), ENDPOINT('ger')]);
    assert.equal(sent[0].message.body, `Cigares et Champagnes — ${a.name} — 4 articles`);
  });

  test('une commande rejouée ne prévient pas une deuxième fois', async () => {
    const a = await person();
    const headers = { 'idempotency-key': 'push-rejouee-0001' };
    ok(await order(a, [{ product_id: CIG, quantity: 1 }], headers));
    assert.equal(sent.length, 2);
    const again = await order(a, [{ product_id: CIG, quantity: 1 }], headers);
    ok(again);
    assert.equal(again.headers.get('idempotent-replayed'), 'true');
    assert.equal(sent.length, 2);
    // A write that fails tells nobody.
    refused(await order(a, [{ product_id: CIG, quantity: 99 }]), 400, 'INVALIDE');
    assert.equal(sent.length, 2);
  });

  test('demande de réservation : le gérant et les deux associés', async () => {
    const m = await person('membre');
    const day = addDays(today, 3);
    ok(await m.client.post('/api/client/reservation-requests', { date: day, start_time: '15:00', duration_min: 90, party_size: 2 }));
    assert.deepEqual(endpoints(), [ENDPOINT('alc'), ENDPOINT('cig'), ENDPOINT('ger')]);
    const jour = new Intl.DateTimeFormat('fr-FR', { timeZone: 'UTC', weekday: 'long', day: 'numeric', month: 'long' }).format(new Date(`${day}T00:00:00Z`));
    for (const s of sent) {
      assert.deepEqual(s.message, { title: 'Demande de réservation', body: `${m.name} — ${jour} 15:00, 1 h 30`, url: '/#/commandes' });
    }
  });

  test('compte désactivé : rien', async () => {
    const ger2 = await staff('ger2', 'gerant');
    await staff('cig2', 'associe', 'cigares');
    const a = await person();
    ok(await order(a, [{ product_id: CIG, quantity: 1 }]));
    assert.deepEqual(endpoints(), [ENDPOINT('cig'), ENDPOINT('cig2'), ENDPOINT('ger'), ENDPOINT('ger2')]);
    for (const login of ['ger2', 'cig2']) {
      const id = server.club.get('SELECT id FROM users WHERE login = ?', login).id;
      ok(await admin.put(`/api/users/${id}`, { active: false }));
    }
    sent.length = 0;
    ok(await order(a, [{ product_id: CIG, quantity: 1 }]));
    assert.deepEqual(endpoints(), [ENDPOINT('cig'), ENDPOINT('ger')]);
    sent.length = 0;
    const m = await person('membre');
    ok(await m.client.post('/api/client/reservation-requests', { date: addDays(today, 4), start_time: '15:00', duration_min: 60 }));
    assert.deepEqual(endpoints(), [ENDPOINT('alc'), ENDPOINT('cig'), ENDPOINT('ger')]);
    // The device stays known: the account may be activated again.
    assert.ok(subscriptionOf('ger2'));
    refused(await ger2.get('/api/push/key'), 401, 'NON_CONNECTE');
  });

  test('un envoi qui échoue ne bloque pas la commande', async () => {
    const logged = [];
    const realError = console.error;
    console.error = (...args) => logged.push(args.map(String).join(' '));
    try {
      answer = (subscription) => {
        if (subscription.endpoint === ENDPOINT('cig')) throw new Error('service indisponible');
        return Promise.reject(new Error('réseau coupé'));
      };
      const a = await person();
      const o = ok(await order(a, [{ product_id: CIG, quantity: 1 }]));
      assert.ok(server.club.get('SELECT 1 AS x FROM client_orders WHERE id = ?', o.id));
      assert.equal(sent.length, 2);
      // A push service that answers with an error is no worse.
      answer = () => ({ status: 500 });
      ok(await order(a, [{ product_id: CIG, quantity: 1 }]));
    } finally {
      console.error = realError;
    }
    assert.equal(logged.length, 4, logged.join('\n'));
    assert.ok(logged.some((l) => l.includes('service indisponible')));
    assert.ok(logged.some((l) => l.includes('500')));
    // The devices stay: only the push service's « unknown » forgets one.
    assert.ok(subscriptionOf('cig') && subscriptionOf('ger'));
  });

  test('un service qui ne répond pas retient la réponse 4 s au plus', async () => {
    const logged = [];
    const realError = console.error;
    console.error = (...args) => logged.push(args.map(String).join(' '));
    let elapsed;
    try {
      answer = () => new Promise(() => {});
      const a = await person();
      const started = Date.now();
      ok(await order(a, [{ product_id: CIG, quantity: 1 }]));
      elapsed = Date.now() - started;
    } finally {
      console.error = realError;
    }
    assert.ok(elapsed >= 3900 && elapsed < 6000, `${elapsed} ms`);
    assert.equal(logged.length, 1, logged.join('\n'));
  });

  test('410 : l’abonnement est effacé', async () => {
    answer = (subscription) => ({ status: subscription.endpoint === ENDPOINT('cig') ? 410 : 404 });
    const a = await person();
    ok(await order(a, [{ product_id: CIG, quantity: 1 }]));
    assert.deepEqual(endpoints(), [ENDPOINT('cig'), ENDPOINT('ger')]);
    assert.equal(subscriptionOf('cig'), undefined);
    assert.equal(subscriptionOf('ger'), undefined);
    assert.ok(subscriptionOf('alc'));
    assert.ok(subscriptionOf('admin'));
    ok(await subscribe(cig, 'cig'));
    ok(await subscribe(ger, 'ger'));
  });

  test('abonnement : on n’efface que le sien', async () => {
    const gerId = subscriptionOf('ger').user_id;
    ok(await cig.del('/api/push/subscriptions', { endpoint: ENDPOINT('ger') }));
    assert.equal(subscriptionOf('ger').user_id, gerId);
    ok(await ger.del('/api/push/subscriptions', { endpoint: ENDPOINT('ger') }));
    assert.equal(subscriptionOf('ger'), undefined);
    ok(await subscribe(ger, 'ger'));
    // The same device signed in with another account now notifies that account (one row per device).
    ok(await subscribe(cig, 'partage'));
    ok(await subscribe(alc, 'partage'));
    assert.equal(subscriptionOf('partage').user_id, server.club.get("SELECT id FROM users WHERE login = 'alc'").id);
    assert.equal(server.club.get('SELECT COUNT(*) AS n FROM push_subscriptions WHERE endpoint = ?', ENDPOINT('partage')).n, 1);
    ok(await alc.del('/api/push/subscriptions', { endpoint: ENDPOINT('partage') }));
    // A subscription is an https address of at most 1000 characters, with the browser's keys.
    refused(await ger.post('/api/push/subscriptions', { endpoint: 'http://push.test/clair', keys: device }), 400, 'INVALIDE');
    refused(await ger.post('/api/push/subscriptions', { endpoint: `https://push.test/${'x'.repeat(1000)}`, keys: device }), 400, 'INVALIDE');
    refused(await ger.post('/api/push/subscriptions', { endpoint: 'pas une adresse', keys: device }), 400, 'INVALIDE');
    refused(await ger.post('/api/push/subscriptions', { endpoint: ENDPOINT('cle'), keys: { p256dh: 'abc', auth: device.auth } }), 400, 'INVALIDE');
    refused(await ger.post('/api/push/subscriptions', { endpoint: ENDPOINT('cle'), keys: { p256dh: device.p256dh, auth: 'abc' } }), 400, 'INVALIDE');
    refused(await ger.post('/api/push/subscriptions', { endpoint: ENDPOINT('cle') }), 400, 'INVALIDE');
    assert.equal(subscriptionOf('cle'), undefined);
    // Signed in only.
    refused(await new Client(server).post('/api/push/subscriptions', { endpoint: ENDPOINT('anonyme'), keys: device }), 401, 'NON_CONNECTE');
  });

  test('clé publique : celle des secrets, sinon null ; rien dans l’espace démo', async () => {
    assert.deepEqual(ok(await ger.get('/api/push/key')), { key: null });
    refused(await new Client(server).get('/api/push/key'), 401, 'NON_CONNECTE');
    const { vapid } = await vapidKeys();
    const configured = new Server({ VAPID_PUBLIC_KEY: vapid.publicKey, VAPID_PRIVATE_KEY: vapid.privateKey, VAPID_SUBJECT: vapid.subject });
    const demo = new Server({}, { demo: true, sendPush: () => assert.fail('l’espace démo n’envoie rien') });
    try {
      await configured.start();
      await configured.addUser('ger', 'Gérant', 'gerant', 'key-ger-password');
      const g = new Client(configured);
      await g.login('ger', 'key-ger-password');
      assert.deepEqual(ok(await g.get('/api/push/key')), { key: vapid.publicKey });
      await demo.start();
      refused(await new Client(demo).get('/api/push/key'), 404, 'INTROUVABLE');
    } finally {
      configured.destroy();
      demo.destroy();
    }
  });
});
