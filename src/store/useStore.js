// Session state: the signed-in user and the club configuration sent by the server (/api/me).
// Business data is never cached here: each page loads it from the API.
import { create } from 'zustand';
import { clearSpace } from '../lib/space.js';

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
  setBundle: (bundle) => {
    const demo = bundle.demo === true;
    document.title = `${demo ? '[DÉMO] ' : ''}${bundle.settings.club_name} — Gestion`;
    set({
      status: 'ready',
      me: bundle.user,
      settings: bundle.settings,
      plans: bundle.plans,
      rooms: bundle.rooms ?? [],
      accounts: bundle.accounts,
      demo,
      bootError: null,
    });
  },
  // Signing out, by choice or because the API answered 401, also ends the demo session: signing in
  // again lands on the real site.
  signOut: () => {
    clearSpace();
    document.title = 'Connexion — Limen';
    set({ status: 'login', me: null, demo: false });
  },
  setOffline: (error) => set({ status: 'offline', bootError: error }),
}));

export const isAdminNow = () => useStore.getState().me?.role === 'admin';
export const useIsAdmin = () => useStore((s) => s.me?.role === 'admin');
export const useSettings = () => useStore((s) => s.settings);
export const useRooms = () => useStore((s) => s.rooms);

