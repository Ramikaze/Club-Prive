// Session state: the signed-in user and the club configuration sent by the server (/api/me).
// Business data is never cached here: each page loads it from the API. The Boutique's carts are kept here (screen
// state, not data): cashing one tab's cart opens its ticket on another page, and the other tab's cart must wait.
import { create } from 'zustand';
import { clearSpace } from '../lib/space.js';
import { clearActionToasts } from '../components/ui/toast.jsx';
import { isBoss } from '../../shared/roles.js';

export const useStore = create((set) => ({
  status: 'boot', // boot | login | ready | offline
  bootError: null,
  me: null,
  settings: null,
  plans: [],
  rooms: [],
  accounts: [],
  // True in the demo space. It is the server's answer (bundle.demo), never the space stored in the
  // browser: if the demo header is ever lost, the real site shows with no demo frame, not real data
  // under one.
  demo: false,
  entering: false, // true just after signing in: the app zooms in out of the dark
  // The Boutique's two carts, { cigares, alcool } (null until one changes). They belong to the user and the space
  // they were filled in: another user, the demo or the real club starts with empty carts.
  shopCarts: null,
  setShopCarts: (update) => set((s) => ({ shopCarts: update(s.shopCarts) })),
  // What waits on the « Commandes » page (open orders + reservation requests), for the menu's counter. Read by the same
  // poll as the page itself.
  orderCounts: 0,
  setOrderCounts: (n) => set({ orderCounts: n }),
  setBundle: (bundle) => {
    const demo = bundle.demo === true;
    document.title = `${demo ? '[DÉMO] ' : ''}${bundle.settings.club_name} — Gestion`;
    set((s) => ({
      ...(s.me?.id !== bundle.user?.id || s.demo !== demo ? { shopCarts: null } : {}),
      status: 'ready',
      me: bundle.user,
      settings: bundle.settings,
      plans: bundle.plans,
      rooms: bundle.rooms ?? [],
      accounts: bundle.accounts,
      demo,
      bootError: null,
    }));
  },
  // Signing out, by choice or because the API answered 401, also ends the demo session: signing in
  // again lands on the real site. The toasts with a button end with it: none outlives its session.
  signOut: () => {
    clearSpace();
    clearActionToasts();
    document.title = 'Connexion — Limen';
    set({ status: 'login', me: null, demo: false, shopCarts: null, orderCounts: 0 });
  },
  setOffline: (error) => set({ status: 'offline', bootError: error }),
}));

export const isAdminNow = () => useStore.getState().me?.role === 'admin';
export const useIsAdmin = () => useStore((s) => s.me?.role === 'admin');
// Club management: the administrator and the associés. useIsAdmin stays for the application's own settings.
export const isBossNow = () => isBoss(useStore.getState().me);
export const useIsBoss = () => useStore((s) => isBoss(s.me));
export const useMe = () => useStore((s) => s.me);
export const useSettings = () => useStore((s) => s.settings);
export const useRooms = () => useStore((s) => s.rooms);

