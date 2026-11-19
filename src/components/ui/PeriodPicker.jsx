// Period of business days kept in the query string (?from=YYYY-MM-DD&to=YYYY-MM-DD), with presets.
import { useEffect, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import Icon from './Icon.jsx';
import { Modal, openDialog } from './Modal.jsx';
import { addDays, addMonths, isValidDate } from '../../../shared/time.js';
import { bizToday } from '../../lib/format.js';
import { periodButtonLabel } from '../../lib/period.js';

export function periodPresets(today) {
  const first = `${today.slice(0, 8)}01`;
  return [
    { key: 'today', label: 'Aujourd’hui', from: today, to: today },
    { key: 'week', label: '7 jours', from: addDays(today, -6), to: today },
    { key: 'month', label: 'Ce mois', from: first, to: today },
    { key: 'last-month', label: 'Mois précédent', from: addMonths(first, -1), to: addDays(first, -1) },
  ];
}

export function usePeriod(defaultPreset = 'month') {
  const [params, setParams] = useSearchParams();
  const today = bizToday();
  const presets = periodPresets(today);
  const preset = presets.find((p) => p.key === defaultPreset);
  let from = isValidDate(params.get('from')) ? params.get('from') : preset.from;
  let to = isValidDate(params.get('to')) ? params.get('to') : (isValidDate(params.get('from')) ? from : preset.to);
  if (to < from) [from, to] = [to, from];
  const update = (changes) => {
    const next = new URLSearchParams(params);
    for (const [k, v] of Object.entries(changes)) {
      if (v === null || v === undefined || v === '') next.delete(k);
      else next.set(k, v);
    }
    setParams(next, { replace: true });
  };
  return {
    from, to, today, presets, params,
    setPeriod: ({ from: f, to: t }) => update(t < f ? { from: t, to: f } : { from: f, to: t }),
    setParam: (k, v) => update({ [k]: v }),
  };
}

// Applies the date when the field is committed (picker choice or leaving the field), not on every
// keystroke: a half-typed year would otherwise load an absurd period.
export function DateInput({ value, onCommit, ...props }) {
  const ref = useRef(null);
  const commit = useRef(onCommit);
  commit.current = onCommit;
  useEffect(() => {
    if (ref.current && ref.current.value !== value) ref.current.value = value;
  }, [value]);
  useEffect(() => {
    const el = ref.current;
    const onChange = () => {
      if (isValidDate(el.value)) commit.current(el.value);
    };
    el.addEventListener('change', onChange);
    return () => el.removeEventListener('change', onChange);
  }, []);
  return <input type="date" ref={ref} defaultValue={value} {...props} />;
}

// On phones the presets and the dates fold into one button (owner, 2026-11-19: the cash page « prend trop de place »).
// Its window keeps the dates it is given until « Afficher »: the period it was opened with is a snapshot, so it is
// set once, when the window closes.
function PeriodDialog({ period, close }) {
  const { presets, today, setPeriod } = period;
  const [range, setRange] = useState({ from: period.from, to: period.to });
  const pick = (r) => {
    setPeriod(r);
    close();
  };
  const current = (p) => p.from === period.from && p.to === period.to;
  return (
    <Modal title="Période" onClose={close}>
      <div className="period-presets period-sheet" role="group" aria-label="Période">
        {presets.map((p) => (
          <button key={p.key} type="button" className="btn" aria-pressed={current(p)} data-autofocus={current(p) || undefined} onClick={() => pick(p)}>
            {p.label}
          </button>
        ))}
      </div>
      {/* As beside the presets: while one day is chosen, « Du » moves that day; « au » then widens it. */}
      <div className="date-nav period-sheet-dates">
        <label className="row"><span className="subtle">Du</span>
          <DateInput value={range.from} max={today} aria-label="Début de la période" onCommit={(d) => setRange((r) => ({ from: d, to: r.from === r.to ? d : r.to }))} /></label>
        <label className="row"><span className="subtle">au</span>
          <DateInput value={range.to} max={today} aria-label="Fin de la période" onCommit={(d) => setRange((r) => ({ ...r, to: d }))} /></label>
      </div>
      <div className="modal-actions">
        <button type="button" className="btn" onClick={close}>Annuler</button>
        <button type="button" className="btn btn-primary" onClick={() => pick(range)}>Afficher</button>
      </div>
    </Modal>
  );
}

export default function PeriodPicker({ period }) {
  const { from, to, today, presets, setPeriod } = period;
  return (
    <>
      <button type="button" className="btn btn-sm only-phone" aria-label={`Période : ${periodButtonLabel(from, to, presets)}`}
        onClick={() => openDialog(PeriodDialog, { period })}>
        <Icon name="calendar" /> {periodButtonLabel(from, to, presets)} <Icon name="down" />
      </button>
      <div className="period-presets only-desktop" role="group" aria-label="Période">
        {presets.map((p) => (
          <button key={p.key} type="button" className="btn btn-sm" aria-pressed={p.from === from && p.to === to} onClick={() => setPeriod(p)}>
            {p.label}
          </button>
        ))}
      </div>
      {/* While one day is shown, a date chosen in « Du » shows that day instead; « au » then widens it. */}
      <div className="date-nav only-desktop">
        <label className="row"><span className="subtle">Du</span>
          <DateInput value={from} max={today} aria-label="Début de la période" onCommit={(d) => setPeriod({ from: d, to: from === to ? d : to })} /></label>
        <label className="row"><span className="subtle">au</span>
          <DateInput value={to} max={today} aria-label="Fin de la période" onCommit={(d) => setPeriod({ from, to: d })} /></label>
      </div>
    </>
  );
}
