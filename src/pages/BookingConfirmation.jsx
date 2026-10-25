// The booking confirmation page (#/reservations/:id/confirmation): a preview of the paper, and the ways to get it
// out, as for the cash receipt: print on the 80 mm roll, or send its picture with a short message on WhatsApp.
// Unlike the receipt, nothing is numbered or recorded by the server: the confirmation can go out again at will.
import { useEffect, useRef, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import Icon from '../components/ui/Icon.jsx';
import BookingSheet from '../components/ui/BookingSheet.jsx';
import ShareTicketDialog, { sheetPicture } from '../components/ui/ShareTicketDialog.jsx';
import { Loaded, Notice, PageHead } from '../components/ui/ui.jsx';
import { openDialog } from '../components/ui/Modal.jsx';
import { toast } from '../components/ui/toast.jsx';
import { api } from '../lib/api.js';
import { useLoad } from '../lib/hooks.js';
import { ARMED, setRollLength, useRollPage } from '../lib/rollPrint.js';
import { useStore } from '../store/useStore.js';
import { bookingWhatsAppText } from '../../shared/wallet.js';
import { waDigits } from '../../shared/whatsapp.js';

function ConfirmationPage({ d }) {
  const r = d.reservation;
  const settings = useStore((s) => s.settings);
  const demo = useStore((s) => s.demo);
  const [busy, setBusy] = useState(false);
  const working = useRef(false);
  const digits = waDigits(d.member_phone);

  // No copy to record: any print, the button's or the browser's own (Ctrl+P, menu), finds the paper armed and
  // the roll measured.
  useEffect(() => {
    const onBeforePrint = () => {
      document.body.classList.add(ARMED);
      setRollLength();
    };
    const onAfterPrint = () => document.body.classList.remove(ARMED);
    window.addEventListener('beforeprint', onBeforePrint);
    window.addEventListener('afterprint', onAfterPrint);
    return () => {
      window.removeEventListener('beforeprint', onBeforePrint);
      window.removeEventListener('afterprint', onAfterPrint);
    };
  }, []);

  const print = () => {
    document.body.classList.add(ARMED);
    setRollLength();
    window.print();
  };

  // The sheet drawn to a PNG, offered with the message in the shared dialog. One at a time: a double click must
  // not open two dialogs.
  const sendWhatsApp = async () => {
    if (working.current) return;
    working.current = true;
    setBusy(true);
    try {
      const file = await sheetPicture(`reservation-${r.id}.png`);
      const text = bookingWhatsAppText({
        clubName: settings.club_name, lastName: d.member_last_name, roomName: r.room_name, day: r.start_date,
        startTime: r.start_time, endTime: r.end_time, partySize: r.party_size, number: r.id,
      });
      openDialog(ShareTicketDialog, { file, text, digits, demo, title: 'Confirmation de réservation par WhatsApp' });
    } catch (e) {
      toast(e.message, 'error');
    } finally {
      working.current = false;
      setBusy(false);
    }
  };

  return (
    <div className="ticket-page">
      <div className="no-print">
        <PageHead
          title={`Confirmation de la réservation n° ${r.id}`}
          lead="Aperçu de ce qui sortira : à imprimer sur le rouleau ou à envoyer au client sur WhatsApp."
          actions={(
            <>
              <button type="button" className="btn btn-primary" onClick={print}><Icon name="printer" /> Imprimer</button>
              <button type="button" className="btn" onClick={sendWhatsApp} disabled={busy} aria-busy={busy}>
                <Icon name="message" /> Envoyer sur WhatsApp</button>
              <Link className="btn" to={`/reservations/${r.id}`}><Icon name="left" /> Retour</Link>
            </>
          )}
        />
        {!demo && !digits && (
          <Notice kind="warn">
            Numéro WhatsApp du membre inutilisable : corrigez-le sur sa <Link to={`/membres/${r.member_id}`}>fiche</Link>.
          </Notice>
        )}
      </div>

      <div className="ticket-stage">
        <BookingSheet detail={d} settings={settings} demo={demo} />
      </div>
    </div>
  );
}

export default function BookingConfirmation() {
  const { id } = useParams();
  const state = useLoad(() => api.get(`/api/reservations/${id}`), [id]);
  useRollPage();
  return <Loaded state={state}>{(d) => <ConfirmationPage key={d.reservation.id} d={d} />}</Loaded>;
}
