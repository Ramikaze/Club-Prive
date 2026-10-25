// The share dialog of a PDF document (the member's statement) and its written message, sent on WhatsApp. The
// pattern of ShareTicketDialog, for a file a browser cannot put on the clipboard: a phone or a tablet shares the
// PDF and the message at once; a computer downloads the PDF and opens the member's chat with the message, and the
// PDF is dropped in it by hand. The demo works the same, with fictitious data and its watermark.
import { useEffect, useState } from 'react';
import Icon from './Icon.jsx';
import { Modal } from './Modal.jsx';
import { Notice } from './ui.jsx';
import { toast } from './toast.jsx';
import { waLink } from '../../../shared/whatsapp.js';

const sizeText = (bytes) => (bytes < 1024 * 1024 ? `${Math.max(1, Math.round(bytes / 1024))} Ko` : `${(bytes / 1024 / 1024).toFixed(1).replace('.', ',')} Mo`);

export default function SharePdfDialog({ close, file, text, title, digits, demo }) {
  const [url] = useState(() => URL.createObjectURL(file));
  useEffect(() => () => URL.revokeObjectURL(url), [url]);
  // One way per device, as for the tickets: the share menu on a touch screen (WhatsApp is in it), the chat's link
  // on a computer.
  const touch = typeof window.matchMedia === 'function' && window.matchMedia('(pointer: coarse)').matches;
  const useShare = touch && typeof navigator.canShare === 'function' && navigator.canShare({ files: [file] });
  // The member's chat with the message written; without a usable number (or in the demo), WhatsApp opens with the
  // message and lets the contact be chosen.
  const waHref = !demo && digits ? waLink(digits, text) : `https://wa.me/?text=${encodeURIComponent(text)}`;

  const download = () => {
    const a = document.createElement('a');
    a.href = url;
    a.download = file.name;
    document.body.append(a);
    a.click();
    a.remove();
  };
  // The click downloads the PDF, then the link itself opens WhatsApp in a new tab (same click, so no blocked tab).
  const openWhatsApp = () => {
    download();
    toast('PDF téléchargé : dans WhatsApp, envoyez le message (Entrée), puis glissez le PDF dans la conversation et Entrée.');
  };
  const share = async () => {
    try {
      await navigator.share({ files: [file], text });
      close();
    } catch (e) {
      if (e?.name !== 'AbortError') toast('Le partage a échoué : téléchargez le PDF et ouvrez WhatsApp avec le message.', 'error');
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

  return (
    <Modal title={title} size="wide" onClose={close}>
      <div className="form-grid">
        {demo ? <Notice kind="info">Démo : le relevé porte « DÉMO — SANS VALEUR » et les données sont fictives.</Notice> : null}
        <p className="muted">{useShare
          ? 'Touchez « Envoyer sur WhatsApp », choisissez WhatsApp puis le client : le PDF et le message partent ensemble.'
          : '« Envoyer sur WhatsApp » télécharge le PDF et ouvre la conversation avec le message écrit. Dans WhatsApp : 1. Entrée pour envoyer le message ; 2. glissez le PDF téléchargé dans la conversation (ou trombone → Document), puis Entrée.'}</p>
        <div className="modal-actions share-actions">
          <a className="btn btn-ghost" href={url} download={file.name}><Icon name="download" /> Télécharger le PDF</a>
          {useShare
            ? <button type="button" className="btn btn-primary" onClick={share}><Icon name="message" /> Envoyer sur WhatsApp</button>
            : (
              <a className="btn btn-primary" href={waHref} target="_blank" rel="noopener noreferrer" onClick={openWhatsApp}>
                <Icon name="message" /> Envoyer sur WhatsApp</a>
            )}
        </div>
        <div className="share-ticket">
          <div className="pdf-file-box">
            <Icon name="statement" size={36} />
            <div>
              <div className="title">{file.name}</div>
              <div className="subtle">PDF · {sizeText(file.size)}</div>
              <a className="btn btn-sm btn-ghost" href={url} target="_blank" rel="noopener noreferrer"><Icon name="eye" /> Ouvrir</a>
            </div>
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
