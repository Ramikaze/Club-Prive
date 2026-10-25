// The share dialog of a printed paper (the cash receipt, the booking confirmation): its picture and its written
// message, sent together on WhatsApp.
import { useEffect, useState } from 'react';
import { toBlob } from 'html-to-image';
import Icon from './Icon.jsx';
import { Modal } from './Modal.jsx';
import { Notice } from './ui.jsx';
import { toast } from './toast.jsx';
import { waLink } from '../../../shared/whatsapp.js';

// The paper drawn on the page (`.ticket-sheet`) as a PNG file named `name`, white behind, at twice the pixels.
export async function sheetPicture(name) {
  const blob = await toBlob(document.querySelector('.ticket-sheet'), { pixelRatio: 2, backgroundColor: '#ffffff', cacheBust: true });
  if (!blob) throw new Error('L’image du ticket n’a pas pu être créée.');
  return new File([blob], name, { type: 'image/png' });
}

// The ticket for WhatsApp: its picture (with the QR code) and the written message, together. A phone or a tablet
// shares both at once (WhatsApp, then the member); a computer opens the member's chat with the message and
// downloads the picture to attach. Each way needs its own click: a browser refuses a share or a new tab started
// after the picture was drawn and the copy recorded. The demo shows them and sends nothing.
export default function ShareTicketDialog({ close, file, text, title, digits, demo }) {
  const [url] = useState(() => URL.createObjectURL(file));
  useEffect(() => () => URL.revokeObjectURL(url), [url]);
  const canShare = typeof navigator.canShare === 'function' && navigator.canShare({ files: [file], text });
  // One way per device: a phone or a tablet shares to WhatsApp (it is in their share menu); a computer copies the
  // picture and opens the chat (WhatsApp is not in a computer's share menu).
  const touch = typeof window.matchMedia === 'function' && window.matchMedia('(pointer: coarse)').matches;
  const useShare = canShare && touch;
  // A WhatsApp link carries text only: opening it also copies the picture, pasted (Cmd/Ctrl + V) in the chat.
  const canCopy = typeof window.ClipboardItem === 'function' && Boolean(navigator.clipboard?.write);
  // The picture is copied first, then WhatsApp opens: a page that loses the focus to the new tab has its copy
  // cancelled. A browser that blocks the late tab gets a second click (the copy is already done).
  const [copied, setCopied] = useState(false);
  const openWhatsApp = async (e) => {
    if (!canCopy || copied) return;
    e.preventDefault();
    try {
      await navigator.clipboard.write([new window.ClipboardItem({ 'image/png': file })]);
      setCopied(true);
    } catch {
      toast('La copie du ticket a échoué : WhatsApp s’ouvre avec le message, joignez le ticket téléchargé.', 'error');
      window.open(waHref, '_blank');
      return;
    }
    const tab = window.open(waHref, '_blank');
    if (tab) tab.opener = null;
    toast(tab
      ? 'Ticket copié : dans WhatsApp, envoyez le message (Entrée), puis faites Cmd + V (ou Ctrl + V) et Entrée pour envoyer le ticket.'
      : 'Ticket copié : cliquez encore sur « Ouvrir WhatsApp », envoyez le message, puis Cmd + V et Entrée pour le ticket.');
  };
  const share = async () => {
    try {
      await navigator.share({ files: [file], text });
      close();
    } catch (e) {
      if (e?.name !== 'AbortError') toast('Le partage a échoué : téléchargez l’image et ouvrez WhatsApp avec le message.', 'error');
    }
  };
  const copyImage = async () => {
    try {
      await navigator.clipboard.write([new window.ClipboardItem({ 'image/png': file })]);
      toast('Ticket copié : collez-le (Cmd + V ou Ctrl + V) dans la conversation WhatsApp.');
    } catch {
      toast('La copie du ticket a échoué : utilisez « Télécharger le ticket ».', 'error');
    }
  };
  const copyText = async () => {
    try {
      await navigator.clipboard.writeText(text);
      toast('Message copié.');
    } catch {
      toast('La copie du message a échoué.', 'error');
    }
  };
  // The member's chat with the message written; without a usable number (or in the demo), WhatsApp opens with the
  // message and lets the contact be chosen.
  const waHref = !demo && digits ? waLink(digits, text) : `https://wa.me/?text=${encodeURIComponent(text)}`;
  return (
    <Modal title={title} size="wide" onClose={close}>
      <div className="form-grid">
        {demo ? <Notice kind="info">Démo : le ticket porte « DÉMO — SANS VALEUR » et les données sont fictives.</Notice> : null}
        <p className="muted">{useShare
            ? 'Touchez « Envoyer sur WhatsApp », choisissez WhatsApp puis le client : le ticket et le message partent ensemble.'
            : canCopy
              ? '« Envoyer sur WhatsApp » copie le ticket et ouvre la conversation avec le message écrit. Dans WhatsApp : 1. Entrée pour envoyer le message ; 2. Cmd + V (ou Ctrl + V) puis Entrée pour envoyer le ticket.'
              : '« Envoyer sur WhatsApp » ouvre la conversation avec le message écrit ; joignez le ticket téléchargé (trombone, puis Photos ou Document).'}</p>
        <div className="modal-actions share-actions">
          <a className="btn btn-ghost" href={url} download={file.name}><Icon name="download" /> Télécharger le ticket</a>
          {useShare
            ? <button type="button" className="btn btn-primary" onClick={share}><Icon name="message" /> Envoyer sur WhatsApp</button>
            : (
              <a className="btn btn-primary" href={waHref} target="_blank" rel="noopener noreferrer" onClick={openWhatsApp}>
                <Icon name="message" /> {copied ? 'Ouvrir WhatsApp (ticket copié)' : 'Envoyer sur WhatsApp'}</a>
            )}
        </div>
        {/* The picture and the message side by side, under the buttons: nothing to scroll to send. */}
        <div className="share-ticket">
          <div className="ticket-image-box">
            <img src={url} alt={`Ticket ${file.name}`} className="ticket-image-preview" />
            {canCopy ? (
              <button type="button" className="btn btn-sm btn-ghost wa-copy" onClick={copyImage} title="Copier l’image du ticket" aria-label="Copier l’image du ticket">
                <Icon name="copy" /></button>
            ) : null}
          </div>
          <div className="wa-message-box">
            <blockquote className="wa-message">{text}</blockquote>
            <button type="button" className="btn btn-sm btn-ghost wa-copy" onClick={copyText} title="Copier le message" aria-label="Copier le message">
              <Icon name="copy" /></button>
          </div>
        </div>
      </div>
    </Modal>
  );
}
