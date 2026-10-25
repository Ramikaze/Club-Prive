// The cash receipt page for the staff (#/caisse/ticket/:id): a preview of exactly what will come out, and the
// ways to get it out: print on an 80 mm roll, or send it to the member on WhatsApp. Each way out is recorded by
// the server first (it answers with the copy number, « Original » then « Duplicata n°X »); the preview shows the
// copy that will come out at the next click. Nothing is recorded for the preview itself.
import { useEffect, useRef, useState } from 'react';
import { flushSync } from 'react-dom';
import { Link, useParams } from 'react-router-dom';
import Icon from '../components/ui/Icon.jsx';
import TicketSheet, { copyLabel } from '../components/ui/TicketSheet.jsx';
import { Empty, Loaded, Notice, PageHead } from '../components/ui/ui.jsx';
import { Modal, openDialog } from '../components/ui/Modal.jsx';
import { toBlob } from 'html-to-image';
import { toast } from '../components/ui/toast.jsx';
import { api } from '../lib/api.js';
import { dateTime, money } from '../lib/format.js';
import { useLoad } from '../lib/hooks.js';
import { useStore } from '../store/useStore.js';
import { paymentLines, ticketVerifyUrl, ticketWhatsAppText } from '../../shared/ticket.js';
import { mealWhatsAppText, rechargeWhatsAppText } from '../../shared/wallet.js';
import { waDigits, waLink } from '../../shared/whatsapp.js';

// The injected <style> that sets the roll's paper size, and the body class that lets the paper print. The paper
// prints only while `ticket-armed` is on the body: the button sets it right before window.print(), once the
// server has numbered the copy. The browser's own print command (Ctrl+P, menu, Share) finds it off and prints a
// notice instead, so no copy label that the server has not recorded can leave the club.
const PAGE_STYLE_ID = 'ticket-page-size';
const ARMED = 'ticket-armed';
const MM_PER_PX = 25.4 / 96;

// The roll is 80 mm wide and as long as the paper drawn: `size: 80mm auto` is not valid CSS (Chrome drops it),
// so the length is measured on the rendered sheet (+ about 4 mm) just before printing.
function setRollLength() {
  const sheet = document.querySelector('.ticket-sheet');
  const style = document.getElementById(PAGE_STYLE_ID);
  if (!sheet || !style) return;
  const height = Math.ceil(sheet.offsetHeight * MM_PER_PX) + 4;
  style.textContent = `@page { size: 80mm ${height}mm; margin: 0; }`;
}

const KIND_LABEL = { impression: 'Impression demandée', whatsapp: 'WhatsApp' };

// A recharge or an outside meal sends the member its short message instead (amount, card part, new balance,
// when), unless it was cancelled: that one goes out as the ticket, which says so.
const isMemberMessage = (ticket) => ['recharge', 'repas'].includes(ticket.kind) && !ticket.cancelled_at;
const MESSAGE_TITLE = { recharge: 'Reçu d’approvisionnement par WhatsApp', repas: 'Message du repas par WhatsApp' };
const MESSAGE_BUTTON = { recharge: 'Envoyer le reçu par WhatsApp', repas: 'Envoyer le message du repas par WhatsApp' };

// The text sent on WhatsApp for one copy: the same content as the sheet. The demo has no verification link.
function whatsAppText(ticket, copyNo) {
  if (isMemberMessage(ticket)) {
    const { timezone, currency } = useStore.getState().settings;
    const verifiable = !ticket.demo && Boolean(ticket.ticket_code);
    const common = {
      clubName: ticket.club_name, firstName: ticket.member_first_name, amount: ticket.amount, balance: ticket.wallet_balance_after,
      at: ticket.paid_at, timezone, currency, number: ticket.number,
      verifyUrl: verifiable ? ticketVerifyUrl(window.location.origin, ticket.id, ticket.ticket_code) : null,
    };
    return ticket.kind === 'repas'
      ? mealWhatsAppText({ ...common, label: ticket.label, cardAmount: ticket.card_amount })
      : rechargeWhatsAppText(common);
  }
  const verifiable = !ticket.demo && Boolean(ticket.ticket_code);
  return ticketWhatsAppText({
    clubName: ticket.club_name,
    number: ticket.number,
    copyLabel: copyLabel(copyNo),
    paidAt: ticket.paid_at,
    memberName: ticket.member_name,
    memberNo: ticket.member_no,
    lines: paymentLines({ kind: ticket.kind, label: ticket.label, amount: ticket.amount, allocations: ticket.allocations }),
    total: ticket.amount,
    method: ticket.method,
    reference: ticket.reference,
    cashier: ticket.created_by_name,
    refunded: ticket.refunded_amount,
    cardAmount: ticket.card_amount,
    balance: ticket.wallet_balance_after,
    timeAvailable: ticket.wallet_balance_after === null ? null : ticket.time_available,
    cancelledAt: ticket.cancelled_at,
    verifyUrl: verifiable ? ticketVerifyUrl(window.location.origin, ticket.id, ticket.ticket_code) : null,
    footer: ticket.footer,
    money,
    dateTime,
  });
}

// The ticket for WhatsApp: its picture (with the QR code) and the written message, together. A phone or a tablet
// shares both at once (WhatsApp, then the member); a computer opens the member's chat with the message and
// downloads the picture to attach. Each way needs its own click: a browser refuses a share or a new tab started
// after the picture was drawn and the copy recorded. The demo shows them and sends nothing.
function ShareTicketDialog({ close, file, text, title, digits, demo }) {
  const [url] = useState(() => URL.createObjectURL(file));
  useEffect(() => () => URL.revokeObjectURL(url), [url]);
  const canShare = typeof navigator.canShare === 'function' && navigator.canShare({ files: [file], text });
  const share = async () => {
    try {
      await navigator.share({ files: [file], text });
      close();
    } catch (e) {
      if (e?.name !== 'AbortError') toast('Le partage a échoué : téléchargez l’image et ouvrez WhatsApp avec le message.', 'error');
    }
  };
  return (
    <Modal title={title} onClose={close}>
      <div className="form-grid">
        {demo ? <Notice kind="info">Démo : le ticket porte « DÉMO — SANS VALEUR » et les données sont fictives.</Notice> : null}
        <p className="muted">{canShare
            ? 'Touchez « Partager sur WhatsApp », choisissez WhatsApp puis le client : le ticket et le message partent ensemble.'
            : 'Ouvrez WhatsApp avec le message, puis joignez le ticket téléchargé (trombone, puis Photos ou Document).'}</p>
        <img src={url} alt={`Ticket ${file.name}`} className="ticket-image-preview" />
        <blockquote className="wa-message">{text}</blockquote>
        <div className="modal-actions">
          <a className="btn" href={url} download={file.name}><Icon name="download" /> Télécharger le ticket</a>
          {!demo && digits ? (
            <a className="btn" href={waLink(digits, text)} target="_blank" rel="noopener noreferrer"><Icon name="message" /> Ouvrir WhatsApp avec le message</a>
          ) : null}
          {canShare ? <button type="button" className="btn btn-primary" onClick={share}><Icon name="message" /> Partager sur WhatsApp</button> : null}
        </div>
      </div>
    </Modal>
  );
}

// Admin only: every copy that went out, with who asked for it.
function TicketEvents({ events }) {
  return (
    <section className="card no-print">
      <div className="card-head"><h2>Historique de ce ticket</h2></div>
      {events.length ? (
        <div className="table-wrap"><table className="table stack-sm">
          <thead><tr><th>Date</th><th>Type</th><th>Exemplaire</th><th>Numéro</th><th>Par</th></tr></thead>
          <tbody>{events.map((e) => (
            <tr key={e.copy_no}>
              <td data-label="Date" className="nowrap">{dateTime(e.at)}</td>
              <td data-label="Type">{KIND_LABEL[e.kind] ?? e.kind}</td>
              <td data-label="Exemplaire">{copyLabel(e.copy_no)}</td>
              <td data-label="Numéro">{e.phone ?? ''}</td>
              <td data-label="Par">{e.user_name ?? ''}</td>
            </tr>
          ))}</tbody>
        </table></div>
      ) : <Empty icon="info">Ce ticket n’est encore jamais sorti.</Empty>}
    </section>
  );
}

function TicketPage({ data, reload }) {
  const { ticket, events } = data;
  const me = useStore((s) => s.me);
  // The copy the next click puts out, and who/when it will be stamped with. After a copy goes out, the answer
  // of the server replaces it (so what is printed is what was recorded).
  const next = (copyNo) => ({ copyNo, printedBy: me?.name ?? '', printedAt: new Date().toISOString() });
  const [sheet, setSheet] = useState(() => next(ticket.next_copy_no));
  const [busy, setBusy] = useState(null);
  const [last, setLast] = useState(null);
  const working = useRef(false);
  const printedCopy = useRef(null);
  // True from the button's window.print() until the browser reports it (beforeprint consumes it).
  const buttonPrint = useRef(false);

  // The browser moves on from the printed copy once its print window closes: the next one will be a duplicate.
  useEffect(() => {
    // A print the button did not start (Ctrl+P, menu) must find the paper unarmed, whatever stayed on the body.
    const onBeforePrint = () => {
      if (buttonPrint.current) buttonPrint.current = false;
      else document.body.classList.remove(ARMED);
    };
    const onAfterPrint = () => {
      document.body.classList.remove(ARMED);
      buttonPrint.current = false;
      if (printedCopy.current === null) return;
      setSheet(next(printedCopy.current + 1));
      printedCopy.current = null;
      if (events) reload();
    };
    window.addEventListener('beforeprint', onBeforePrint);
    window.addEventListener('afterprint', onAfterPrint);
    return () => {
      window.removeEventListener('beforeprint', onBeforePrint);
      window.removeEventListener('afterprint', onAfterPrint);
    };
  });

  const digits = waDigits(ticket.member_phone);

  // Records the way out, runs it, and keeps one at a time (a double click must not use up two copies).
  const run = async (kind, action) => {
    if (working.current) return;
    working.current = true;
    setBusy(kind);
    try {
      await action();
    } catch (e) {
      toast(e.message, 'error');
    } finally {
      working.current = false;
      setBusy(null);
    }
  };

  const print = () => run('impression', async () => {
    const out = await api.post(`/api/payments/${ticket.id}/ticket-events`, { kind: 'impression' });
    // Draw the recorded copy before the print window takes its picture of the page.
    flushSync(() => {
      setSheet({ copyNo: out.copy_no, printedBy: out.printed_by_name, printedAt: out.at });
      document.body.classList.add(ARMED);
    });
    setLast({ kind: 'impression', copyNo: out.copy_no });
    printedCopy.current = out.copy_no;
    buttonPrint.current = true;
    try {
      setRollLength();
      window.print();
    } catch (e) {
      document.body.classList.remove(ARMED);
      buttonPrint.current = false;
      throw e;
    }
  });

  // WhatsApp: the copy is recorded first (its number goes on the picture), then the sheet is drawn to a PNG with
  // its QR code, and the picture and the written message are offered together. The demo records nothing.
  const sendWhatsApp = () => run('whatsapp', async () => {
    let copyNo = sheet.copyNo;
    if (!ticket.demo) {
      const out = await api.post(`/api/payments/${ticket.id}/ticket-events`, { kind: 'whatsapp' });
      copyNo = out.copy_no;
      flushSync(() => setSheet({ copyNo, printedBy: out.printed_by_name, printedAt: out.at }));
    }
    const blob = await toBlob(document.querySelector('.ticket-sheet'), { pixelRatio: 2, backgroundColor: '#ffffff', cacheBust: true });
    if (!blob) throw new Error('L’image du ticket n’a pas pu être créée.');
    const file = new File([blob], `ticket-${ticket.number}.png`, { type: 'image/png' });
    if (!ticket.demo) {
      setLast({ kind: 'whatsapp', copyNo });
      setSheet(next(copyNo + 1));
      if (events) reload();
    }
    openDialog(ShareTicketDialog, {
      file, text: whatsAppText(ticket, copyNo), digits, demo: ticket.demo,
      title: isMemberMessage(ticket) ? MESSAGE_TITLE[ticket.kind] : 'Ticket par WhatsApp',
    });
  });

  return (
    <div className="ticket-page">
      <div className="no-print">
        <PageHead
          title={`Ticket ${ticket.number}`}
          lead="Aperçu de ce qui sortira au prochain clic. Chaque impression ou envoi est enregistré."
          actions={(
            <>
              <button type="button" className="btn btn-primary" onClick={print} disabled={busy !== null} aria-busy={busy === 'impression'}>
                <Icon name="printer" /> Imprimer</button>
              <button type="button" className="btn" onClick={sendWhatsApp} disabled={busy !== null} aria-busy={busy === 'whatsapp'}>
                <Icon name="message" /> {isMemberMessage(ticket) ? MESSAGE_BUTTON[ticket.kind] : 'Envoyer par WhatsApp'}</button>
              <Link className="btn" to="/caisse"><Icon name="left" /> Retour à la caisse</Link>
              <Link className="btn" to={`/membres/${ticket.member_id}`}><Icon name="users" /> Fiche du membre</Link>
            </>
          )}
        />
        {!ticket.demo && !digits && (
          <Notice kind="warn">
            Numéro WhatsApp du membre inutilisable : corrigez-le sur sa <Link to={`/membres/${ticket.member_id}`}>fiche</Link>.
          </Notice>
        )}
        {last && (
          <Notice kind="ok">
            {last.kind === 'impression' ? 'Impression demandée' : 'Envoi WhatsApp demandé'} : {copyLabel(last.copyNo)}.
            Le prochain exemplaire sera le {copyLabel(last.copyNo + 1).toLowerCase()}.
          </Notice>
        )}
      </div>

      <p className="ticket-unarmed">Impression non enregistrée : utilisez le bouton Imprimer de la page.</p>
      <div className="ticket-stage">
        <TicketSheet ticket={ticket} copyNo={sheet.copyNo} printedBy={sheet.printedBy} printedAt={sheet.printedAt} />
      </div>

      {events && <TicketEvents events={events} />}
    </div>
  );
}

export default function Ticket() {
  const { id } = useParams();
  const state = useLoad(() => api.get(`/api/payments/${id}/ticket`), [id]);

  // The roll size (@page) applies to the whole printout and cannot be limited to a class, so it exists only
  // while this page is open: the member card keeps its own page size (the roll's length is set at print time,
  // see setRollLength). The body class scopes the page's other print rules in club.css.
  useEffect(() => {
    document.body.classList.add('print-ticket');
    const style = document.createElement('style');
    style.id = PAGE_STYLE_ID;
    style.textContent = '@page { margin: 0; }';
    document.head.append(style);
    return () => {
      document.body.classList.remove('print-ticket', ARMED);
      style.remove();
    };
  }, []);

  return <Loaded state={state}>{(data) => <TicketPage key={data.ticket.id} data={data} reload={state.reload} />}</Loaded>;
}
