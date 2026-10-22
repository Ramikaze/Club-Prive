// Session state: the signed-in user and the club configuration sent by the server (/api/me).
// Business data is never cached here: each page loads it from the API.
import { create } from 'zustand';

export const useStore = create((set) => ({
  status: 'boot', // boot | login | ready | offline
  bootError: null,
  me: null,
  settings: null,
  plans: [],
  rooms: [],
  accounts: [],
  setBundle: (bundle) => {
    document.title = `${bundle.settings.club_name} — Gestion`;
    set({
      status: 'ready',
      me: bundle.user,
      settings: bundle.settings,
      plans: bundle.plans,
      rooms: bundle.rooms ?? [],
      accounts: bundle.accounts,
      bootError: null,
    });
  },
  signOut: () => {
    document.title = 'Connexion — Club Privé';
    set({ status: 'login', me: null });
  },
  setOffline: (error) => set({ status: 'offline', bootError: error }),
}));

export const isAdminNow = () => useStore.getState().me?.role === 'admin';
export const useIsAdmin = () => useStore((s) => s.me?.role === 'admin');
export const useSettings = () => useStore((s) => s.settings);
export const useRooms = () => useStore((s) => s.rooms);

