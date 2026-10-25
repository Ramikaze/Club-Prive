import { useEffect } from 'react';
import { useParams } from 'react-router-dom';
import MemberCard3D from '../components/ui/MemberCard3D.jsx';
import Icon from '../components/ui/Icon.jsx';
import { Loaded, PageHead } from '../components/ui/ui.jsx';
import { api } from '../lib/api.js';
import { useLoad } from '../lib/hooks.js';

function CardPage({ v }) {
  const active = v.card.status === 'active';
  const qrPath = `/membres/${v.member.id}?card=${encodeURIComponent(v.card.code)}`;
  const face = (side, label) => (
    <figure className="card-face">
      <MemberCard3D name={v.member.name} code={v.card.code} active={active} qrPath={qrPath} interactive={false} side={side} />
      <figcaption className="no-print">{label}</figcaption>
    </figure>
  );

  return (
    <>
      <div className="no-print">
        <PageHead
          title={`Carte ${v.card.kind}`}
          lead="Recto et verso au format carte bancaire (85,6 × 54 mm), côte à côte, prêts à imprimer et à découper."
          back={{ to: `/membres/${v.member.id}`, label: v.member.name }}
          actions={<button type="button" className="btn btn-primary" onClick={() => window.print()}><Icon name="printer" /> Imprimer</button>}
          tour="card"
        />
      </div>
      {active ? null : <div className="notice notice-danger no-print" style={{ marginBottom: 14 }}><Icon name="alert" /><span>Carte désactivée{v.card.deactivation_reason ? ` : ${v.card.deactivation_reason}` : ''}. Seul le recto s’imprime.</span></div>}
      {/* A deactivated card has no back (no QR code in large): its front alone is drawn. */}
      <div className="card-sheet">
        {face('front', 'Recto')}
        {active ? face('back', 'Verso') : null}
      </div>
      <p className="subtle no-print" style={{ marginTop: 14, maxWidth: 560 }}>
        La carte n’affiche ni téléphone ni courriel. Le QR code ouvre directement la fiche du membre (uniquement pour un utilisateur connecté) et fonctionne aussi dans la barre de recherche par lecteur optique.
      </p>
    </>
  );
}

export default function MemberCard() {
  const { id } = useParams();
  const state = useLoad(() => api.get(`/api/cards/${id}`), [id]);
  // The body class scopes this page's print rules in club.css, as the receipt page does for its own.
  useEffect(() => {
    document.body.classList.add('print-card');
    return () => document.body.classList.remove('print-card');
  }, []);
  return <Loaded state={state}>{(v) => <CardPage v={v} />}</Loaded>;
}
