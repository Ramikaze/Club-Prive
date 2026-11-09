// A ticket of the client, as the paper the club prints (« Copie client »), with « Imprimer » and « Télécharger ». The
// copy is posted to the club only when the client really prints or downloads: opening the page records nothing.
import { Link, useParams } from 'react-router-dom';
import Icon from '../../components/ui/Icon.jsx';
import TicketSheet from '../../components/ui/TicketSheet.jsx';
import { sheetPicture } from '../../components/ui/ShareTicketDialog.jsx';
import { Loaded } from '../../components/ui/ui.jsx';
import { toast } from '../../components/ui/toast.jsx';
import { useBusy, useLoad } from '../../lib/hooks.js';
import { ARMED, setRollLength, useRollPage } from '../../lib/rollPrint.js';
import { clientApi } from '../clientApi.js';

function TicketPage({ ticket }) {
  const { busy, run } = useBusy();
  const record = (kind) => clientApi.post(`/api/client/tickets/${ticket.id}/copies`, { kind });

  // Print only through the button: it arms the paper (club.css prints nothing otherwise), once the copy is noted.
  const print = () => run(async () => {
    await record('impression');
    document.body.classList.add(ARMED);
    const done = () => { document.body.classList.remove(ARMED); window.removeEventListener('afterprint', done); };
    window.addEventListener('afterprint', done);
    try {
      setRollLength();
      window.print();
    } catch (e) {
      done();
      throw e;
    }
  });

  const download = () => run(async () => {
    const file = await sheetPicture(`ticket-${ticket.number}.png`);
    await record('telechargement');
    const href = URL.createObjectURL(file);
    const link = document.createElement('a');
    link.href = href;
    link.download = file.name;
    document.body.append(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(href), 10000);
    toast('Ticket téléchargé.');
  });

  return (
    <div className="ticket-page cl-stack">
      <div className="no-print cl-stack">
        <Link className="back" to="/historique"><Icon name="left" /> Historique</Link>
        <h1>Ticket {ticket.number}</h1>
        <div className="cl-actions">
          <button type="button" className="btn btn-primary" onClick={print} disabled={busy} aria-busy={busy}><Icon name="printer" /> Imprimer</button>
          <button type="button" className="btn" onClick={download} disabled={busy} aria-busy={busy}><Icon name="download" /> Télécharger</button>
        </div>
      </div>
      <p className="ticket-unarmed">Impression non enregistrée : utilisez le bouton Imprimer de la page.</p>
      <div className="ticket-stage"><TicketSheet ticket={ticket} copyNo={1} copyText="Copie client" /></div>
    </div>
  );
}

export default function ClientTicket() {
  const { id } = useParams();
  const state = useLoad(() => clientApi.get(`/api/client/tickets/${id}`), [id]);
  useRollPage();
  return <Loaded state={state}>{(data) => <TicketPage key={data.ticket.id} ticket={data.ticket} />}</Loaded>;
}
