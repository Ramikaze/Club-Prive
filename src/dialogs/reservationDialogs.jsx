// Reservation dialogs shared by several screens. Each dialog keeps one idempotency key for its whole
// life, so a double click or a retry after a network error never records the operation twice.
import { useEffect, useRef, useState } from 'react';
import { api, newKey } from '../lib/api.js';
import { money, fmtDuration, dayLabel, win, bizToday, parts, relLabel, subStateLabel } from '../lib/format.js';
import { useStore, useSettings } from '../store/useStore.js';
import { openDialog, Modal, actionDialog } from '../components/ui/Modal.jsx';
import { toast } from '../components/ui/toast.jsx';
import Icon from '../components/ui/Icon.jsx';
import { Hypothesis, Notice, FormError } from '../components/ui/ui.jsx';
import { useSubmit } from '../lib/hooks.js';
import { daysBetween, parseHHMM } from '../../shared/time.js';
import { supplementDetail } from '../../shared/rules.js';

export function supplementText(paid, tariff) {
  if (!paid) return 'aucun';
  const d = supplementDetail(paid);
  const pieces = [];
  if (d.hours) pieces.push(`${d.hours} h × ${money(tariff.hour)}`);
  if (d.halves) pieces.push(`1 demi-heure × ${money(tariff.half)}`);
  return `${fmtDuration(paid)} → ${pieces.join(' + ')}`;
}

const startRelOf = (time) => {
  const m = parseHHMM(time);
  return m < win().open ? m + 1440 : m;
};

function defaultStart(date) {
  const w = win();
  const { slot_min: slot, min_duration_min: minDur } = useStore.getState().settings.booking;
  const last = w.maxEnd - minDur;
  if (date === bizToday()) {
    const p = parts(Date.now());
    let rel = Math.ceil((daysBetween(date, p.date) * 1440 + p.minutes) / slot) * slot;
    if (rel < w.open) rel = w.open;
    if (rel <= last) return relLabel(rel);
  }
  const evening = 18 * 60;
  return relLabel(evening >= w.open && evening <= last ? evening : w.open);
}

const creditLine = (summary) => (summary?.credit
  ? ` · crédit disponible ${fmtDuration(summary.credit.available)}` : '');

const conflictText = (conflicts) => conflicts.map((c) => `${c.member_name} (${c.start_time} – ${c.end_time})`).join(', ');

// ---------------------------------------------------------------- new reservation

function startOptions(w, slot, minDur) {
  const out = [];
  for (let rel = w.open; rel + minDur <= w.maxEnd; rel += slot) {
    const note = rel >= 1440 ? ' (après minuit)' : rel >= w.close ? ' (hors horaires)' : '';
    out.push({ label: relLabel(rel), note });
  }
  return out;
}

function durationOptions(w, slot, minDur, startTime) {
  const rel = startRelOf(startTime);
  const out = [];
  for (let d = minDur; rel + d <= w.maxEnd; d += slot) out.push({ d, late: rel + d > w.close });
  return out;
}

function QuotePanel({ q, s }) {
  const warnings = [];
  if (q.conflicts.length) {
    warnings.push(<Notice key="conflicts" kind="danger">{`Créneau occupé : ${conflictText(q.conflicts)}.`}</Notice>);
  }
  if (q.off_hours) {
    warnings.push(<Notice key="off" kind="warn">{q.can_authorize_off_hours
      ? `Ce créneau dépasse les horaires habituels (${s.hours.open} – ${s.hours.close}) : une autorisation explicite est nécessaire.`
      : 'Ce créneau dépasse les horaires habituels : seul un administrateur peut l’autoriser.'}</Notice>);
  }
  if (q.paid_minutes && q.tariff_blocked) {
    warnings.push(<Notice key="tariff" kind="danger">Le tarif du temps supplémentaire n’est pas validé par un administrateur.</Notice>);
  }
  return (
    <>
      <dl className="calc">
        <div><dt>Horaire</dt><dd>{`${dayLabel(q.biz_day, 'medium')} · ${q.start_time} → ${q.end_time}${q.end_next_day ? ' (lendemain)' : ''}`}</dd></div>
        <div><dt>Durée</dt><dd>{fmtDuration(q.duration_min)}</dd></div>
        <div><dt>Formule</dt><dd>{`${q.subscription.plan_name} · jusqu’au ${dayLabel(q.subscription.end_date, 'short')}`}</dd></div>
        <div><dt>Crédit disponible</dt><dd>{fmtDuration(q.credit_before.available)}</dd></div>
        <div><dt>Heures incluses utilisées</dt><dd>{fmtDuration(q.included_minutes)}</dd></div>
        <div><dt>Temps payant</dt><dd>{supplementText(q.paid_minutes, q.tariff)}
          {q.paid_minutes && !q.tariff.validated
            ? <>{' '}<Hypothesis title="Tarif annoncé dans les messages audio, non encore validé par un administrateur." label="tarif à valider" /></>
            : null}</dd></div>
        <div className="total"><dt>Supplément à régler</dt><dd>{money(q.supplement_amount)}</dd></div>
        <div><dt>Crédit restant après</dt><dd>{fmtDuration(q.credit_after)}</dd></div>
      </dl>
      {warnings.length ? <div className="stack" style={{ marginTop: 10 }}>{warnings}</div> : null}
    </>
  );
}

function BookingDialog({ close, preset, onDone }) {
  const s = useSettings();
  const w = win();
  const { slot_min: slot, min_duration_min: minDur } = s.booking;
  const [key] = useState(newKey);
  const { busy, error, submit } = useSubmit();
  const [init] = useState(() => {
    const date = preset.date ?? bizToday();
    const wanted = preset.start_time ?? defaultStart(date);
    const list = startOptions(win(), slot, minDur);
    // As a native select does: a start time missing from the list falls back to the first option.
    return { date, start: list.some((o) => o.label === wanted) ? wanted : (list[0]?.label ?? wanted) };
  });
  const [member, setMember] = useState(preset.member ?? null);
  const [date, setDate] = useState(init.date);
  const [start, setStart] = useState(init.start);
  const [duration, setDuration] = useState(minDur);
  const [notes, setNotes] = useState('');
  const [auth, setAuth] = useState(false);
  const [quote, setQuote] = useState(null);
  const [quoteError, setQuoteError] = useState(null);
  const [loading, setLoading] = useState(() => Boolean(preset.member));
  const [search, setSearch] = useState('');
  const [found, setFound] = useState({ list: null, error: null });

  const seq = useRef(0);
  const searchSeq = useRef(0);
  const quoteTimer = useRef(null);
  const searchTimer = useRef(null);
  const latest = useRef(null);
  latest.current = { member, date, start, duration, notes, auth };

  const payload = () => {
    const v = latest.current;
    return {
      member_id: v.member?.id, date: v.date, start_time: v.start, duration_min: Number(v.duration),
      notes: v.notes, authorize_off_hours: v.auth,
    };
  };

  const runQuote = async () => {
    if (!latest.current.member) {
      setQuote(null);
      setLoading(false);
      return;
    }
    const n = (seq.current += 1);
    setLoading(true);
    try {
      const q = await api.preview('/api/reservations/quote', payload());
      if (n !== seq.current) return;
      setQuote(q);
      setQuoteError(null);
    } catch (e) {
      if (n !== seq.current) return;
      setQuote(null);
      setQuoteError(e.message);
    }
    setLoading(false);
  };

  // Debounced: the form values are read when the request leaves, a stale answer is ignored.
  const requestQuote = () => {
    clearTimeout(quoteTimer.current);
    setLoading(true);
    quoteTimer.current = setTimeout(runQuote, 180);
  };

  const runSearch = async (value) => {
    const q = value.trim();
    const n = (searchSeq.current += 1);
    if (!q) {
      setFound({ list: null, error: null });
      return;
    }
    try {
      const list = await api.get(`/api/members?q=${encodeURIComponent(q)}`);
      if (n !== searchSeq.current) return;
      setFound({ list, error: null });
    } catch (e) {
      if (n !== searchSeq.current) return;
      setFound({ list: null, error: e.message });
    }
  };

  const onSearch = (e) => {
    const { value } = e.target;
    setSearch(value);
    clearTimeout(searchTimer.current);
    searchTimer.current = setTimeout(() => runSearch(value), 200);
  };

  const stopSearch = () => {
    clearTimeout(searchTimer.current);
    searchSeq.current += 1;
    setSearch('');
    setFound({ list: null, error: null });
  };

  const pick = (x) => {
    stopSearch();
    setMember(x);
    requestQuote();
  };

  const changeMember = () => {
    clearTimeout(quoteTimer.current);
    seq.current += 1;
    stopSearch();
    setMember(null);
    setQuote(null);
    setQuoteError(null);
    setLoading(false);
  };

  useEffect(() => () => {
    clearTimeout(quoteTimer.current);
    clearTimeout(searchTimer.current);
    seq.current += 1;
    searchSeq.current += 1;
  }, []);

  useEffect(() => {
    if (latest.current.member) requestQuote();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const onStart = (e) => {
    const next = e.target.value;
    setStart(next);
    const list = durationOptions(w, slot, minDur, next);
    if (!list.some((o) => o.d === Number(duration))) setDuration(list[0]?.d ?? 0);
    requestQuote();
  };

  const onSubmit = (e) => {
    e.preventDefault();
    submit(async () => {
      if (!member) throw new Error('Choisissez un membre.');
      const detail = await api.post('/api/reservations', payload(), key);
      close();
      toast(`Réservation confirmée : ${detail.reservation.member_name}, ${dayLabel(detail.reservation.biz_day, 'medium')} à ${detail.reservation.start_time}.`);
      onDone?.(detail);
    });
  };

  let quoteBox = null;
  if (!member) quoteBox = <p className="subtle">Choisissez un membre pour afficher le détail du calcul.</p>;
  else if (loading && !quote) quoteBox = <p className="subtle">Calcul en cours…</p>;
  else if (quoteError) quoteBox = <Notice kind="danger">{quoteError}</Notice>;
  else if (quote) quoteBox = <QuotePanel q={quote} s={s} />;

  const ready = Boolean(member && quote && !quoteError);
  const showOff = ready && quote.off_hours && quote.can_authorize_off_hours;
  const canSubmit = ready && !(quote.conflicts.length > 0 || quote.tariff_blocked
    || (quote.off_hours && (!quote.can_authorize_off_hours || !auth)));

  return (
    <Modal title="Nouvelle réservation" size="wide" onClose={close}>
      <form className="form-grid" onSubmit={onSubmit} noValidate>
        <fieldset><legend>Membre</legend><div id="bk-member">
          {member ? (
            <div className="row">
              <div className="grow" style={{ flex: 1, minWidth: 0 }}>
                <strong>{member.name}</strong> <span className="subtle">{member.member_no}</span>
                <div className="subtle">{subStateLabel(member.subscription)}{creditLine(member.subscription)}</div>
              </div>
              {preset.lockMember ? null : <button type="button" className="btn btn-sm" onClick={changeMember}>Changer</button>}
            </div>
          ) : (
            <>
              <div className="search"><Icon name="search" /><input type="search" value={search} onChange={onSearch}
                placeholder="Nom, téléphone, n° de membre ou de carte" aria-label="Rechercher un membre" autoComplete="off" autoFocus /></div>
              <div id="bk-results" className="list" aria-live="polite">
                {found.error ? <Notice kind="danger">{found.error}</Notice> : null}
                {found.list ? (found.list.length
                  ? found.list.slice(0, 8).map((x) => (
                    <button key={x.id} type="button" className="list-item" onClick={() => pick(x)}>
                      <div className="grow"><div className="title">{x.name} <span className="subtle">{x.member_no}</span></div>
                        <div className="meta">{subStateLabel(x.subscription)}{creditLine(x.subscription)}</div></div>
                    </button>
                  ))
                  : <p className="subtle">Aucun membre trouvé.</p>) : null}
              </div>
            </>
          )}
        </div></fieldset>
        <div className="form-row">
          <label className="field"><span>Journée</span>
            <input type="date" name="date" value={date} required onChange={(e) => { setDate(e.target.value); requestQuote(); }} /></label>
          <label className="field"><span>Début</span>
            <select name="start_time" value={start} onChange={onStart}>
              {startOptions(w, slot, minDur).map((o) => <option key={o.label} value={o.label}>{`${o.label}${o.note}`}</option>)}
            </select></label>
          <label className="field"><span>Durée</span>
            <select name="duration_min" value={duration} onChange={(e) => { setDuration(Number(e.target.value)); requestQuote(); }}>
              {durationOptions(w, slot, minDur, start).map((o) => (
                <option key={o.d} value={o.d}>{`${fmtDuration(o.d)}${o.late ? ` · après ${s.hours.close}` : ''}`}</option>
              ))}
            </select></label>
        </div>
        <p className="subtle">{`Créneaux de ${slot} min, ${fmtDuration(minDur)} minimum. Horaires habituels ${s.hours.open} – ${s.hours.close} ; fin possible jusqu’à ${s.hours.max_end} (lendemain) avec autorisation.`}</p>
        <label className="field"><span>Remarque (facultatif)</span>
          <input name="notes" maxLength={300} value={notes} onChange={(e) => setNotes(e.target.value)} /></label>
        <div id="bk-quote" aria-live="polite">{quoteBox}</div>
        <label className="check" id="bk-off" hidden={!showOff}>
          <input type="checkbox" name="authorize_off_hours" checked={auth} onChange={(e) => setAuth(e.target.checked)} />
          <span>J’autorise explicitement le dépassement des horaires habituels (autorisation enregistrée à mon nom).</span></label>
        <FormError error={error} />
        <div className="modal-actions">
          <button type="button" className="btn" onClick={close}>Annuler</button>
          <button type="submit" className="btn btn-primary" id="bk-submit" disabled={busy || !canSubmit} aria-busy={busy}>Confirmer la réservation</button>
        </div>
      </form>
    </Modal>
  );
}

export function openBookingDialog(preset = {}, onDone) {
  openDialog(BookingDialog, { preset: preset ?? {}, onDone });
}

// ---------------------------------------------------------------- extension

function ExtendDialog({ close, r, onDone, options, endRel }) {
  const s = useSettings();
  const [key] = useState(newKey);
  const { busy, error, submit } = useSubmit();
  const [minutes, setMinutes] = useState(options[0]);
  const [auth, setAuth] = useState(false);
  const [quote, setQuote] = useState(null);
  const [quoteError, setQuoteError] = useState(null);
  const seq = useRef(0);

  const requestQuote = async (value) => {
    const n = (seq.current += 1);
    try {
      const q = await api.preview(`/api/reservations/${r.id}/extend/quote`, { minutes: Number(value) });
      if (n !== seq.current) return;
      setQuote(q);
      setQuoteError(null);
    } catch (e) {
      if (n !== seq.current) return;
      setQuote(null);
      setQuoteError(e.message);
    }
  };

  useEffect(() => {
    requestQuote(options[0]);
    return () => { seq.current += 1; };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const onSubmit = (e) => {
    e.preventDefault();
    submit(async () => {
      const detail = await api.post(`/api/reservations/${r.id}/extend`, {
        minutes: Number(minutes), authorize_off_hours: auth,
      }, key);
      close();
      toast(`Réservation prolongée jusqu’à ${detail.reservation.end_time}.`);
      onDone?.(detail);
    });
  };

  const q = quote;
  let box = <p className="subtle">Calcul en cours…</p>;
  if (quoteError) box = <Notice kind="danger">{quoteError}</Notice>;
  else if (q) {
    const warnings = [];
    if (q.conflicts.length) warnings.push(<Notice key="conflicts" kind="danger">{`Créneau suivant occupé : ${conflictText(q.conflicts)}.`}</Notice>);
    if (q.off_hours) {
      warnings.push(<Notice key="off" kind="warn">{q.can_authorize_off_hours
        ? `La nouvelle fin dépasse les horaires habituels (${s.hours.close}) : autorisation explicite nécessaire.`
        : 'La nouvelle fin dépasse les horaires habituels : seul un administrateur peut l’autoriser.'}</Notice>);
    }
    if (q.tariff_blocked) warnings.push(<Notice key="tariff" kind="danger">Le tarif de cette réservation n’est pas validé : prolongation payante impossible hors démonstration.</Notice>);
    box = (
      <>
        <dl className="calc">
          <div><dt>Nouvelle fin</dt><dd>{q.new_end_time}{q.end_next_day ? ' (lendemain)' : ''}</dd></div>
          <div><dt>Crédit disponible</dt><dd>{fmtDuration(q.credit_available)}</dd></div>
          <div><dt>Heures incluses utilisées</dt><dd>{fmtDuration(q.included_minutes)}</dd></div>
          <div><dt>Temps payant ajouté</dt><dd>{fmtDuration(q.paid_minutes)}</dd></div>
          <div><dt>Temps payant total</dt><dd>{supplementText(q.total_paid_minutes, q.tariff)}</dd></div>
          <div><dt>Supplément</dt><dd>{`${money(q.supplement_before)} → ${money(q.supplement_after)}`}</dd></div>
          <div className="total"><dt>À ajouter à la note</dt><dd>{money(q.supplement_delta)}</dd></div>
        </dl>
        <p className="subtle" style={{ marginTop: 6 }}>{`Le tarif appliqué reste celui de la réservation confirmée (${money(q.tariff.hour)} / h, ${money(q.tariff.half)} / 30 min).`}</p>
        {warnings.length ? <div className="stack" style={{ marginTop: 10 }}>{warnings}</div> : null}
      </>
    );
  }

  const offHidden = !q?.off_hours || !q.can_authorize_off_hours;
  const blocked = Boolean(quoteError) || !q || q.conflicts.length > 0 || q.tariff_blocked
    || (q.off_hours && (!q.can_authorize_off_hours || !auth));

  return (
    <Modal title="Prolonger la réservation" onClose={close}>
      <form className="form-grid" onSubmit={onSubmit} noValidate>
        <p>{`${r.member_name} · actuellement ${r.start_time} → ${r.end_time} (${fmtDuration(r.duration_min)}).`}</p>
        <label className="field"><span>Prolonger de</span>
          <select name="minutes" value={minutes} onChange={(e) => { setMinutes(Number(e.target.value)); requestQuote(e.target.value); }}>
            {options.map((d) => (
              <option key={d} value={d}>{`+ ${fmtDuration(d)} (fin ${endRel + d === 1440 ? 'minuit' : relLabel(endRel + d)}${endRel + d > 1440 ? ', lendemain' : ''})`}</option>
            ))}
          </select></label>
        <div id="ex-quote" aria-live="polite">{box}</div>
        <label className="check" id="ex-off" hidden={offHidden}>
          <input type="checkbox" name="authorize_off_hours" checked={auth} onChange={(e) => setAuth(e.target.checked)} />
          <span>J’autorise explicitement le dépassement des horaires habituels.</span></label>
        <FormError error={error} />
        <div className="modal-actions"><button type="button" className="btn" onClick={close}>Annuler</button>
          <button type="submit" className="btn btn-primary" id="ex-submit" disabled={busy || blocked} aria-busy={busy}>Confirmer la prolongation</button></div>
      </form>
    </Modal>
  );
}

export function openExtendDialog(r, onDone) {
  const s = useStore.getState().settings;
  const w = win();
  const step = s.booking.extension_step_min;
  const end = parts(r.end_ms);
  const endRel = daysBetween(r.biz_day, end.date) * 1440 + end.minutes;
  const options = [];
  for (let d = step; endRel + d <= w.maxEnd; d += step) options.push(d);
  if (!options.length) {
    toast(`Prolongation impossible : la fin maximale (${s.hours.max_end}) est atteinte.`, 'error');
    return;
  }
  openDialog(ExtendDialog, { r, onDone, options, endRel });
}

// ---------------------------------------------------------------- cancellation

export function openCancelReservationDialog(detail, onDone) {
  const r = detail.reservation;
  const key = newKey();
  const committed = detail.credit_movements.reduce((sum, mv) => {
    if (mv.kind === 'engagement') return sum + mv.minutes;
    if (mv.kind === 'liberation' || mv.kind === 'consommation') return sum - mv.minutes;
    return sum;
  }, 0);
  const due = detail.charges.filter((c) => c.status === 'due');
  const paid = detail.charges.filter((c) => c.status === 'payee');
  actionDialog({
    title: 'Annuler la réservation',
    danger: true,
    confirmLabel: 'Annuler la réservation',
    reasonLabel: 'Motif de l’annulation',
    body: (
      <>
        <ul className="stack" style={{ paddingLeft: 18, margin: 0 }}>
          <li>{committed ? `${fmtDuration(committed)} de crédit seront libérées et redeviendront disponibles.` : 'Aucune heure incluse à libérer.'}</li>
          <li>{due.length ? `${due.length} ligne(s) non encaissée(s) seront annulées (les produits retournent en stock).` : 'Aucune ligne à annuler.'}</li>
          {paid.length ? <li><strong>{`${paid.length} ligne(s) déjà encaissée(s)`}</strong> resteront en l’état : un remboursement éventuel est une action distincte réservée à un administrateur.</li> : null}
        </ul>
        <p className="subtle">Les règles d’annulation tardive (frais, délai) restent à définir.</p>
      </>
    ),
    run: async (v) => {
      const res = await api.post(`/api/reservations/${r.id}/cancel`, { reason: v.reason }, key);
      toast('Réservation annulée.');
      onDone?.(res);
    },
  });
}
