// Data loading and busy-state hooks used by pages and dialogs.
import { useCallback, useEffect, useRef, useState } from 'react';
import { toast } from '../components/ui/toast.jsx';

// Loads data when `deps` change (skeleton first) and exposes `reload()` for a quiet refresh after
// an action. `retry()` reloads after an error.
// The loader receives an AbortSignal as its first argument: a newer load, or leaving the page, cancels the
// older one, so a changed filter stops downloading the previous period on a weak connection. A loader may
// ignore it; its result is then dropped as before (`seq`).
export function useLoad(loader, deps, { refreshMs = 0 } = {}) {
  const [state, setState] = useState({ data: undefined, error: null });
  const seq = useRef(0);
  const loaderRef = useRef(loader);
  loaderRef.current = loader;
  const running = useRef(null);
  // A load has failed and none has succeeded since: the automatic refresh then fails without a toast, so a
  // page polling on a bad network shows one error, not a new one every 30 seconds and on each return to the tab.
  const failing = useRef(false);

  // `mode`: 'full' (skeleton first), 'quiet' (keeps the data shown and always says when it fails: `reload()`
  // after the user's action) or 'auto' (the timed refresh and the return to the tab: one toast per failure streak).
  const load = useCallback(async (mode) => {
    const quiet = mode !== 'full';
    const id = (seq.current += 1);
    running.current?.abort();
    const controller = new AbortController();
    running.current = controller;
    if (!quiet) setState({ data: undefined, error: null });
    try {
      const data = await loaderRef.current(controller.signal);
      if (id === seq.current) {
        failing.current = false;
        setState({ data, error: null });
      }
    } catch (error) {
      // Cancelled: a newer load replaces it, or the page is gone. Nothing to show.
      if (controller.signal.aborted || error.status === 401) return;
      if (id === seq.current) setState((s) => ({ data: quiet ? s.data : undefined, error }));
      const streak = failing.current;
      failing.current = true;
      if (mode === 'quiet' || (mode === 'auto' && !streak)) toast(error.message, 'error');
    }
  }, []);

  useEffect(() => {
    load('full');
    return () => {
      seq.current += 1;
      running.current?.abort();
    };
  }, deps); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!refreshMs) return undefined;
    const refresh = () => { if (document.visibilityState === 'visible') load('auto'); };
    const interval = setInterval(refresh, refreshMs);
    document.addEventListener('visibilitychange', refresh);
    return () => {
      clearInterval(interval);
      document.removeEventListener('visibilitychange', refresh);
    };
  }, [refreshMs, load]);

  return { ...state, reload: () => load('quiet'), retry: () => load('full') };
}

// Form submission: one at a time, error kept for display in the form.
export function useSubmit() {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const running = useRef(false);
  const submit = useCallback(async (fn) => {
    if (running.current) return undefined;
    running.current = true;
    setBusy(true);
    setError(null);
    try {
      return await fn();
    } catch (e) {
      setError(e.message);
      return undefined;
    } finally {
      running.current = false;
      setBusy(false);
    }
  }, []);
  return { busy, error, setError, submit };
}

// Button actions: one at a time, errors shown as a toast.
export function useBusy() {
  const [busy, setBusy] = useState(false);
  const running = useRef(false);
  const run = useCallback(async (fn) => {
    if (running.current) return undefined;
    running.current = true;
    setBusy(true);
    try {
      return await fn();
    } catch (e) {
      toast(e.message, 'error');
      return undefined;
    } finally {
      running.current = false;
      setBusy(false);
    }
  }, []);
  return { busy, run };
}
