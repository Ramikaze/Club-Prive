// Notifications on this device (staff). The browser subscribes to the push service with the club's public key; the
// server keeps the subscription for the signed-in account (POST /api/push/subscriptions). The service worker is the
// static file /sw.js. Nothing here sends anything: the server does, after an order or a request.
import { api } from './api.js';

export const pushSupported = () => typeof window !== 'undefined'
  && 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;

// An iPhone or iPad outside the home-screen app has no push at all: the site must be added to the home screen first.
export function needsHomeScreen() {
  const ua = navigator.userAgent;
  const ios = /iPhone|iPad|iPod/.test(ua) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  const standalone = window.matchMedia?.('(display-mode: standalone)').matches || navigator.standalone === true;
  return ios && !standalone;
}

function keyBytes(base64url) {
  const pad = '='.repeat((4 - (base64url.length % 4)) % 4);
  const bin = atob((base64url + pad).replace(/-/g, '+').replace(/_/g, '/'));
  return Uint8Array.from(bin, (c) => c.charCodeAt(0));
}

// The club's public key, or null while the server has no push configured.
export async function pushKey() {
  return (await api.get('/api/push/key')).key ?? null;
}

// Is this device subscribed right now?
export async function pushActive() {
  if (!pushSupported() || Notification.permission !== 'granted') return false;
  const reg = await navigator.serviceWorker.getRegistration('/sw.js');
  return Boolean(reg && await reg.pushManager.getSubscription());
}

export async function enablePush() {
  if (!pushSupported()) throw new Error('Cet appareil ne permet pas les notifications.');
  const key = await pushKey();
  if (!key) throw new Error('Les notifications ne sont pas activées sur ce site.');
  if (await Notification.requestPermission() !== 'granted') {
    throw new Error('Notifications refusées : autorisez-les pour ce site dans les réglages du navigateur.');
  }
  const reg = await navigator.serviceWorker.register('/sw.js');
  await navigator.serviceWorker.ready;
  const sub = (await reg.pushManager.getSubscription())
    ?? await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: keyBytes(key) });
  const json = sub.toJSON();
  await api.post('/api/push/subscriptions', { endpoint: json.endpoint, keys: json.keys });
}

export async function disablePush() {
  const reg = await navigator.serviceWorker.getRegistration('/sw.js');
  const sub = await reg?.pushManager.getSubscription();
  if (!sub) return;
  await api.del('/api/push/subscriptions', { endpoint: sub.endpoint });
  await sub.unsubscribe();
}
