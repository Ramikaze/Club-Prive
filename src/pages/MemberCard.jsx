import { useParams } from 'react-router-dom';
import Icon from '../components/ui/Icon.jsx';
import { Loaded, PageHead } from '../components/ui/ui.jsx';
import { api } from '../lib/api.js';
import { dayLabel } from '../lib/format.js';
import { useLoad } from '../lib/hooks.js';

function CardPage({ v }) {
  const sub = v.subscription;
  const valid = ['active', 'expire_bientot'].includes(sub.state);
  const active = v.card.status === 'active';
  return (
    <>
      <div className="no-print">
        <PageHead
          title={`Carte ${v.card.kind}`}
          lead="Format carte bancaire (85,6 × 54 mm), prête à imprimer ou à présenter à l’écran."
          back={{ to: `/membres/${v.member.id}`, label: v.member.name }}
          actions={<button type="button" className="btn btn-primary" onClick={() => window.print()}><Icon name="printer" /> Imprimer</button>}
          tour="card"
        />
      </div>
      {active ? null : <div className="notice notice-danger no-print" style={{ marginBottom: 14 }}><Icon name="alert" /><span>Carte désactivée{v.card.deactivation_reason ? ` : ${v.card.deactivation_reason}` : ''}.</span></div>}
      <div className={`member-card ${active ? '' : 'inactive'}`} role="img" aria-label={`Carte de membre de ${v.member.name}, numéro ${v.card.code}`}>
        <div className="mc-top"><div className="mc-club">{v.club_name}</div><div className="mc-kind">Carte de membre · {v.card.kind}</div></div>
        <div><div className="mc-name">{v.member.name}</div><div className="mc-code">{v.card.code}</div></div>
        <div className="mc-foot">
          <div>N° membre<strong>{v.member.member_no}</strong></div>
          <div>Formule<strong>{valid ? sub.plan_name : 'Aucune formule active'}</strong></div>
          <div>Validité<strong>{valid ? `jusqu’au ${dayLabel(sub.end_date, 'short')}` : '—'}</strong></div>
        </div>
      </div>
      <p className="subtle no-print" style={{ marginTop: 14, maxWidth: 560 }}>La carte n’affiche ni téléphone ni courriel. Le QR code de recherche du membre (amélioration facultative)
        {' '}n’est pas inclus dans cette version ; il ne devra ouvrir la fiche qu’à un utilisateur connecté.</p>
    </>
  );
}

export default function MemberCard() {
  const { id } = useParams();
  const state = useLoad(() => api.get(`/api/cards/${id}`), [id]);
  return <Loaded state={state}>{(v) => <CardPage v={v} />}</Loaded>;
}
