import { useMemo } from 'react';
import { useParams } from 'react-router-dom';
import Icon from '../components/ui/Icon.jsx';
import { Loaded, PageHead } from '../components/ui/ui.jsx';
import { api } from '../lib/api.js';
import { dayLabel } from '../lib/format.js';
import { useLoad } from '../lib/hooks.js';
import { encodeQrMatrix, qrSvgPath } from '../lib/qrcode.js';

function CardQrCode({ value, label }) {
  const { viewBoxSize, path } = useMemo(() => {
    const matrix = encodeQrMatrix(value);
    return qrSvgPath(matrix, 2);
  }, [value]);

  return (
    <svg
      className="mc-qr-svg"
      role="img"
      viewBox={`0 0 ${viewBoxSize} ${viewBoxSize}`}
      shapeRendering="crispEdges"
    >
      <title>{label}</title>
      <rect width={viewBoxSize} height={viewBoxSize} fill="#fcf8f0" rx="1.5" />
      <path d={path} fill="#1b140e" />
    </svg>
  );
}

function CardPage({ v }) {
  const sub = v.subscription;
  const valid = ['active', 'expire_bientot'].includes(sub.state);
  const active = v.card.status === 'active';
  const qrUrl = `${window.location.origin}${window.location.pathname}#/membres/${v.member.id}?card=${encodeURIComponent(v.card.code)}`;

  return (
    <>
      <div className="no-print">
        <PageHead
          title={`Carte ${v.card.kind}`}
          lead="Format carte bancaire (85,6 × 54 mm) avec QR code intégré, prête à imprimer ou à présenter à l’écran."
          back={{ to: `/membres/${v.member.id}`, label: v.member.name }}
          actions={<button type="button" className="btn btn-primary" onClick={() => window.print()}><Icon name="printer" /> Imprimer</button>}
          tour="card"
        />
      </div>
      {active ? null : <div className="notice notice-danger no-print" style={{ marginBottom: 14 }}><Icon name="alert" /><span>Carte désactivée{v.card.deactivation_reason ? ` : ${v.card.deactivation_reason}` : ''}.</span></div>}
      <article className={`member-card ${active ? '' : 'inactive'}`} aria-label={`Carte de membre de ${v.member.name}, numéro ${v.card.code}`}>
        <div className="mc-top">
          <div className="mc-club">{v.club_name}</div>
          <div className="mc-kind">Carte de membre · {v.card.kind}</div>
        </div>
        <div className="mc-mid">
          <div className="mc-identity">
            <div className="mc-name">{v.member.name}</div>
            <div className="mc-code">{v.card.code}</div>
          </div>
          <div className="mc-qr">
            <CardQrCode
              value={qrUrl}
              label={`QR code de la carte ${v.card.code} (${v.member.name})`}
            />
          </div>
        </div>
        <div className="mc-foot">
          <div>N° membre<strong>{v.member.member_no}</strong></div>
          <div>Formule<strong>{valid ? sub.plan_name : 'Aucune formule active'}</strong></div>
          <div>Validité<strong>{valid ? `jusqu’au ${dayLabel(sub.end_date, 'short')}` : '—'}</strong></div>
        </div>
      </article>
      <p className="subtle no-print" style={{ marginTop: 14, maxWidth: 560 }}>
        La carte n’affiche ni téléphone ni courriel. Le QR code ouvre directement la fiche du membre (uniquement pour un utilisateur connecté) et fonctionne aussi dans la barre de recherche par lecteur optique.
      </p>
    </>
  );
}

export default function MemberCard() {
  const { id } = useParams();
  const state = useLoad(() => api.get(`/api/cards/${id}`), [id]);
  return <Loaded state={state}>{(v) => <CardPage v={v} />}</Loaded>;
}
