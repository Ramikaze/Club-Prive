// A regular client's account statement page (#/clients/:id/releve): a preview of the A4 document (its whole account,
// from the first operation, with the balance after each) and the ways to get it out: print it, or send it as a PDF
// with a short message on WhatsApp. Nothing is recorded by the server: a statement can go out again at will.
import { useMemo, useRef, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import Icon from '../components/ui/Icon.jsx';
import ClientStatementSheet from '../components/ui/ClientStatementSheet.jsx';
import SharePdfDialog from '../components/ui/SharePdfDialog.jsx';
import { Loaded, Notice, PageHead } from '../components/ui/ui.jsx';
import { openDialog } from '../components/ui/Modal.jsx';
import { toast } from '../components/ui/toast.jsx';
import { api } from '../lib/api.js';
import { useLoad } from '../lib/hooks.js';
import { statementPdf } from '../lib/statementPdf.js';
import { useA4Page } from '../lib/useA4Page.js';
import { useStore } from '../store/useStore.js';
import { clientStatementWhatsAppText } from '../../shared/wallet.js';
import { waDigits } from '../../shared/whatsapp.js';

function StatementView({ a }) {
  const settings = useStore((st) => st.settings);
  const demo = useStore((st) => st.demo);
  const [busy, setBusy] = useState(false);
  const working = useRef(false);
  const digits = waDigits(a.phone);

  // The PDF made from the sheet on the page, offered with the message in the share dialog. One at a time: a double
  // click must not open two dialogs.
  const sendWhatsApp = async () => {
    if (working.current) return;
    working.current = true;
    setBusy(true);
    try {
      const day = a.issued_at.slice(0, 10);
      const file = await statementPdf(document.querySelector('.statement-sheet'), `releve-${a.member_no}-${day}.pdf`);
      const text = clientStatementWhatsAppText({ clubName: settings.club_name, day });
      openDialog(SharePdfDialog, { file, text, digits, demo, title: 'Relevé de compte client par WhatsApp' });
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
            Pas de numéro WhatsApp utilisable sur la <Link to={`/membres/${a.member_id}`}>fiche</Link> : le PDF s’envoie en
            choisissant le contact dans WhatsApp, ou s’imprime.
          </Notice>
        )}
      </div>
      <div className="statement-stage">
        <div className="statement-paper">
          <ClientStatementSheet a={a} settings={settings} demo={demo} />
        </div>
      </div>
    </>
  );
}

export default function ClientStatement() {
  const { id } = useParams();
  const state = useLoad((signal) => api.get(`/api/clients/${id}/account`, { signal }), [id]);
  useA4Page();
  const name = state.data?.name;
  // The statement is dated when its account is read (the server's account is a state, not a document).
  const issuedAt = useMemo(() => new Date().toISOString(), [state.data]);

  return (
    <div className="statement-page">
      <div className="no-print">
        <PageHead
          title={name ? `Relevé de compte client — ${name}` : 'Relevé de compte client'}
          lead="Aperçu du relevé A4 : à imprimer ou à envoyer au client en PDF sur WhatsApp."
          back={{ to: `/membres/${id}`, label: 'Fiche du client' }}
        />
      </div>
      <Loaded state={state}>{(a) => <StatementView a={{ ...a, issued_at: issuedAt }} />}</Loaded>
    </div>
  );
}
