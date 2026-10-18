// Data loading and busy-state hooks used by pages and dialogs.
import { useCallback, useEffect, useRef, useState } from 'react';
import { toast } from '../components/ui/toast.jsx';

// Loads data when `deps` change (skeleton first) and exposes `reload()` for a quiet refresh after
// an action. `retry()` reloads after an error.
export function useLoad(loader, deps, { refreshMs = 0 } = {}) {
  const [state, setState] = useState({ data: undefined, error: null });
  const seq = useRef(0);
  const loaderRef = useRef(loader);
  loaderRef.current = loader;

  const load = useCallback(async (quiet) => {
    const id = (seq.current += 1);
    if (!quiet) setState({ data: undefined, error: null });
    try {
      const data = await loaderRef.current();
      if (id === seq.current) setState({ data, error: null });
    } catch (error) {
      if (id === seq.current && error.status !== 401) setState((s) => ({ data: quiet ? s.data : undefined, error }));
      if (quiet && error.status !== 401) toast(error.message, 'error');
    }
  }, []);

  useEffect(() => {
    load(false);
    return () => { seq.current += 1; };
  }, deps); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!refreshMs) return undefined;
    const refresh = () => { if (document.visibilityState === 'visible') load(true); };
    const interval = setInterval(refresh, refreshMs);
    document.addEventListener('visibilitychange', refresh);
    return () => {
      clearInterval(interval);
      document.removeEventListener('visibilitychange', refresh);
    };
  }, [refreshMs, load]);

  return { ...state, reload: () => load(true), retry: () => load(false) };
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
