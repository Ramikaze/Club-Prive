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
import { openDialog } from '../components/ui/Modal.jsx';
import ShareTicketDialog, { sheetPicture } from '../components/ui/ShareTicketDialog.jsx';
import { toast } from '../components/ui/toast.jsx';
import { api } from '../lib/api.js';
import { dateTime, money } from '../lib/format.js';
import { useLoad } from '../lib/hooks.js';
import { useStore } from '../store/useStore.js';
import { paymentLines, ticketVerifyUrl, ticketWhatsAppText } from '../../shared/ticket.js';
import { mealWhatsAppText, paymentWhatsAppText, rechargeWhatsAppText } from '../../shared/wallet.js';
import { waDigits } from '../../shared/whatsapp.js';
import { ARMED, setRollLength, useRollPage } from '../lib/rollPrint.js';

const KIND_LABEL = { impression: 'Impression demandée', whatsapp: 'WhatsApp' };

// Every receipt sends the member the same short message (what was paid and when, the card's part, the new balance,
// the ticket's number), unless it was cancelled: that one goes out as the full ticket, which says so.
const isMemberMessage = (ticket) => !ticket.cancelled_at;
const MESSAGE_TITLE = { recharge: 'Reçu d’approvisionnement par WhatsApp', repas: 'Message du repas par WhatsApp', encaissement: 'Ticket par WhatsApp' };
const MESSAGE_BUTTON = { recharge: 'Envoyer le reçu par WhatsApp', repas: 'Envoyer le message du repas par WhatsApp', encaissement: 'Envoyer par WhatsApp' };
// What a receipt's lines were for, in the member's words.
const FOR_LABEL = { reservations: 'salle', alcool: 'alcool', cigares: 'cigares' };
const paidFor = (ticket) => Object.entries(ticket.by_account ?? {}).filter(([, v]) => v > 0).map(([k]) => FOR_LABEL[k] ?? k).join(', ');

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
    if (ticket.kind === 'repas') return mealWhatsAppText({ ...common, label: ticket.label, cardAmount: ticket.card_amount });
    if (ticket.kind === 'recharge') return rechargeWhatsAppText(common);
    return paymentWhatsAppText({ ...common, cardAmount: ticket.card_amount, method: ticket.method, for: paidFor(ticket) });
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
    const file = await sheetPicture(`ticket-${ticket.number}.png`);
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

  useRollPage();

  return <Loaded state={state}>{(data) => <TicketPage key={data.ticket.id} data={data} reload={state.reload} />}</Loaded>;
}
