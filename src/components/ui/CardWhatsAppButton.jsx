// The « Envoyer sur WhatsApp » button of an active member card. A click draws the card's front and back, one under
// the other, to a PNG and offers it with a short message in the shared WhatsApp dialog, to the member's number.
// The picture is drawn from a copy of the card kept off screen at a fixed width: the same picture on a phone and on
// a computer, large enough for the QR code to be read on the member's screen.
import { useRef, useState } from 'react';
import { toBlob } from 'html-to-image';
import Icon from './Icon.jsx';
import MemberCard3D from './MemberCard3D.jsx';
import { openDialog } from './Modal.jsx';
import ShareTicketDialog, { CARD_WORDS } from './ShareTicketDialog.jsx';
import { toast } from './toast.jsx';
import { useStore } from '../../store/useStore.js';
import { cardWhatsAppText } from '../../../shared/wallet.js';
import { waDigits } from '../../../shared/whatsapp.js';

export default function CardWhatsAppButton({ member, card, label = 'Envoyer sur WhatsApp', className = 'btn' }) {
  const picture = useRef(null);
  const working = useRef(false);
  const [busy, setBusy] = useState(false);
  const clubName = useStore((s) => s.settings?.club_name);
  const demo = useStore((s) => s.demo);
  const qrPath = `/membres/${member.id}?card=${encodeURIComponent(card.code)}`;

  // One at a time: a double click must not open two dialogs.
  const send = async () => {
    if (working.current) return;
    working.current = true;
    setBusy(true);
    try {
      const blob = await toBlob(picture.current, { pixelRatio: 3, backgroundColor: '#ffffff', cacheBust: true });
      if (!blob) throw new Error('L’image de la carte n’a pas pu être créée.');
      const file = new File([blob], `carte-${card.code}.png`, { type: 'image/png' });
      const text = cardWhatsAppText({ clubName, lastName: member.last_name, code: card.code });
      openDialog(ShareTicketDialog, {
        file, text, digits: waDigits(member.phone), demo, words: CARD_WORDS, title: 'Carte de membre par WhatsApp',
      });
    } catch (e) {
      toast(e?.message || 'L’image de la carte n’a pas pu être créée.', 'error');
    } finally {
      working.current = false;
      setBusy(false);
    }
  };

  return (
    <>
      <button type="button" className={className} onClick={send} disabled={busy}>
        <Icon name="message" /> {busy ? 'Préparation…' : label}</button>
      {/* Out of sight and out of the printout; the copy of the card the picture is drawn from. */}
      <div className="card-picture-host no-print" aria-hidden="true">
        <div className="card-picture" ref={picture}>
          <MemberCard3D name={member.name} code={card.code} qrPath={qrPath} interactive={false} side="front" />
          <MemberCard3D name={member.name} code={card.code} qrPath={qrPath} interactive={false} side="back" />
        </div>
      </div>
    </>
  );
}
