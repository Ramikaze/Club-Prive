// The member's statement page (#/membres/:id/releve): the period (this month by default, or since the member
// joined), a preview of the A4 document, and the ways to get it out: print it, or send it as a PDF with a short
// message on WhatsApp. Nothing is recorded by the server: a statement can go out again at will.
import { useEffect, useRef, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import Icon from '../components/ui/Icon.jsx';
import StatementSheet from '../components/ui/StatementSheet.jsx';
import SharePdfDialog from '../components/ui/SharePdfDialog.jsx';
import { DateInput, usePeriod } from '../components/ui/PeriodPicker.jsx';
import { Loaded, Notice, PageHead } from '../components/ui/ui.jsx';
import { openDialog } from '../components/ui/Modal.jsx';
import { toast } from '../components/ui/toast.jsx';
import { api } from '../lib/api.js';
import { parts, win } from '../lib/format.js';
import { useLoad } from '../lib/hooks.js';
import { statementPdf } from '../lib/statementPdf.js';
import { useStore } from '../store/useStore.js';
import { addDays } from '../../shared/time.js';
import { statementWhatsAppText } from '../../shared/wallet.js';
import { waDigits } from '../../shared/whatsapp.js';

// A4 with 12 mm margins, for this page only: @page applies to the whole printout and cannot be limited to a class,
// so the rule exists only while the page is open (as the roll's size on the ticket pages). The body class scopes
// the page's other print rules in club.css.
function useA4Page() {
  useEffect(() => {
    document.body.classList.add('print-statement');
    const style = document.createElement('style');
    style.textContent = '@page { size: A4; margin: 12mm; }';
    document.head.append(style);
    return () => {
      document.body.classList.remove('print-statement');
      style.remove();
    };
  }, []);
}

// The business day an instant belongs to (a member created at 01:00 joined the evening before).
function bizDayOf(iso) {
  const p = parts(iso);
  return p.minutes < win().open ? addDays(p.date, -1) : p.date;
}

function StatementView({ s }) {
  const settings = useStore((st) => st.settings);
  const demo = useStore((st) => st.demo);
  const [busy, setBusy] = useState(false);
  const working = useRef(false);
  const m = s.member;
  const digits = waDigits(m.phone);

  // The PDF made from the sheet on the page, offered with the message in the share dialog. One at a time: a double
  // click must not open two dialogs.
  const sendWhatsApp = async () => {
    if (working.current) return;
    working.current = true;
    setBusy(true);
    try {
      const { from, to } = s.period;
      const file = await statementPdf(document.querySelector('.statement-sheet'), `releve-${m.member_no}-${from}-${to}.pdf`);
      const text = statementWhatsAppText({ clubName: settings.club_name, firstName: m.first_name, from, to });
      openDialog(SharePdfDialog, { file, text, digits, demo, title: 'Relevé de compte par WhatsApp' });
    } catch (e) {
      toast(e?.message || 'Le PDF du relevé n’a pas pu être créé.', 'error');
    } finally {
      working.current = false;
      setBusy(false);
    }
  };

  return (
    <>
      <div className="no-print">
        <div className="toolbar">
          <button type="button" className="btn btn-primary" onClick={() => window.print()}><Icon name="printer" /> Imprimer</button>
          <button type="button" className="btn" onClick={sendWhatsApp} disabled={busy} aria-busy={busy}>
            <Icon name="message" /> {busy ? 'Création du PDF…' : 'Envoyer sur WhatsApp'}</button>
        </div>
        {!demo && !digits && (
          <Notice kind="warn">
            Numéro WhatsApp du membre inutilisable : corrigez-le sur sa <Link to={`/membres/${m.id}`}>fiche</Link>.
          </Notice>
        )}
      </div>
      <div className="statement-stage">
        <div className="statement-paper">
          <StatementSheet s={s} settings={settings} demo={demo} />
        </div>
      </div>
    </>
  );
}

export default function Statement() {
  const { id } = useParams();
  const period = usePeriod('month');
  const { from, to, today, presets, setPeriod } = period;
  const state = useLoad(() => api.get(`/api/members/${id}/statement?from=${from}&to=${to}`), [id, from, to]);
  useA4Page();
  // The day the member joined, kept while another period loads: the start of « Tout l'historique ».
  const [joined, setJoined] = useState(null);
  const loaded = state.data;
  useEffect(() => {
    if (loaded?.member) setJoined(bizDayOf(loaded.member.created_at));
  }, [loaded]);
  const month = presets.find((p) => p.key === 'month');
  const all = joined ? { from: joined < today ? joined : today, to: today } : null;
  const name = loaded?.member?.name;

  return (
    <div className="statement-page">
      <div className="no-print">
        <PageHead
          title={name ? `Relevé de compte — ${name}` : 'Relevé de compte'}
          lead="Aperçu du relevé A4 : à imprimer ou à envoyer au client en PDF sur WhatsApp."
          back={{ to: `/membres/${id}`, label: 'Fiche du membre' }}
        />
        <div className="toolbar">
          <div className="period-presets" role="group" aria-label="Période">
            <button type="button" className="btn btn-sm" aria-pressed={month.from === from && month.to === to} onClick={() => setPeriod(month)}>Ce mois</button>
            <button type="button" className="btn btn-sm" disabled={!all} aria-pressed={Boolean(all) && all.from === from && all.to === to}
              onClick={() => all && setPeriod(all)}>Tout l’historique</button>
          </div>
          <div className="date-nav">
            <label className="row"><span className="subtle">Du</span>
              <DateInput value={from} max={today} aria-label="Début de la période" onCommit={(d) => setPeriod({ from: d, to })} /></label>
            <label className="row"><span className="subtle">au</span>
              <DateInput value={to} max={today} aria-label="Fin de la période" onCommit={(d) => setPeriod({ from, to: d })} /></label>
          </div>
        </div>
      </div>
      <Loaded state={state}>{(s) => <StatementView s={s} />}</Loaded>
    </div>
  );
}
