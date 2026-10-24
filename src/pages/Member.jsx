import { Link, useNavigate, useParams } from 'react-router-dom';
import Icon from '../components/ui/Icon.jsx';
import { AccountTag, Chip, DemoChip, Empty, Loaded, Notice, PageHead } from '../components/ui/ui.jsx';
import { toast } from '../components/ui/toast.jsx';
import { actionDialog } from '../components/ui/Modal.jsx';
import { api, newKey } from '../lib/api.js';
import { money, fmtDuration, dayLabel, dateTime } from '../lib/format.js';
import { useLoad } from '../lib/hooks.js';
import { useIsAdmin } from '../store/useStore.js';
import {
  openBookingDialog, openMemberDialog, openSubscriptionDialog, openCardDialog, openAdjustCreditDialog, openPaymentDialog,
  openDeactivateMemberDialog, openReactivateMemberDialog, memberRoomEligibility,
} from '../dialogs/index.js';

function CreditBlock({ credit }) {
  const total = Math.max(credit.granted, credit.committed + credit.consumed + credit.available, 1);
  const pct = (v) => `${Math.round((v / total) * 1000) / 10}%`;
  return (
    <>
      <div className="gauge" role="img" aria-label={`Crédit : ${fmtDuration(credit.consumed)} consommées, ${fmtDuration(credit.committed)} engagées, ${fmtDuration(credit.available)} disponibles`}>
        <span className="g-consumed" style={{ width: pct(credit.consumed) }} />
        <span className="g-committed" style={{ width: pct(credit.committed) }} />
        <span className="g-available" style={{ width: pct(credit.available) }} />
      </div>
      <div className="credit-legend">
        <div><span className="k">Attribuées</span><span className="v">{fmtDuration(credit.granted)}</span></div>
        <div><span className="k">Engagées</span><span className="v">{fmtDuration(credit.committed)}</span></div>
        <div><span className="k">Consommées</span><span className="v">{fmtDuration(credit.consumed)}</span></div>
        <div><span className="k">Disponibles</span><span className="v">{fmtDuration(credit.available)}</span></div>
      </div>
      {credit.adjustments ? <p className="subtle" style={{ marginTop: 6 }}>Dont ajustements manuels : {credit.adjustments > 0 ? '+' : '−'}{fmtDuration(Math.abs(credit.adjustments))}</p> : null}
      {credit.allocation_mode === 'mensuelle' ? <p className="subtle" style={{ marginTop: 6 }}>Attribution mensuelle : {fmtDuration(credit.allocated)} attribuées à ce jour sur {fmtDuration(credit.included)}.</p> : null}
    </>
  );
}

function MemberDetail({ m, reload }) {
  const navigate = useNavigate();
  const isAdmin = useIsAdmin();
  const summary = m.subscription;
  const current = m.subscriptions.find((s) => s.id === summary.id && ['active', 'expire_bientot'].includes(summary.state));
  const elig = memberRoomEligibility(m);
  const due = m.charges.filter((c) => c.status === 'due');
  const dueTotal = due.reduce((sum, c) => sum + c.amount, 0);
  const memberForDialogs = { ...m };

  const book = () => {
    if (!elig.ok) {
      toast(`Accès salle refusé pour ${m.name} : ${elig.reason}.`, 'error');
      return;
    }
    openBookingDialog({ member: { id: m.id, name: m.name, member_no: m.member_no, subscription: summary }, lockMember: true },
      (det) => navigate(`/reservations/${det.reservation.id}`));
  };

  const cancelSub = () => {
    const key = newKey();
    actionDialog({
      title: 'Annuler l’abonnement',
      message: `${current.plan_name} (${dayLabel(current.start_date, 'short')} → ${dayLabel(current.end_date, 'short')}). La ligne d’abonnement non encaissée sera annulée ; un remboursement éventuel est une action distincte.`,
      reasonLabel: 'Motif', danger: true, confirmLabel: 'Annuler l’abonnement',
      run: async (v) => {
        await api.post(`/api/subscriptions/${current.id}/cancel`, { reason: v.reason }, key);
        toast('Abonnement annulé.');
        reload();
      },
    });
  };

  const deactivate = (card) => {
    const key = newKey();
    actionDialog({
      title: 'Désactiver la carte', message: `Carte ${card.kind} ${card.code}.`, reasonLabel: 'Motif (perte, remplacement…)',
      danger: true, confirmLabel: 'Désactiver',
      run: async (v) => {
        await api.post(`/api/cards/${card.id}/deactivate`, { reason: v.reason }, key);
        toast('Carte désactivée.');
        reload();
      },
    });
  };

  return (
    <>
      <PageHead
        title={m.name}
        lead={<>{m.member_no} {m.active ? <Chip group="sub" value={summary.state} /> : <span className="chip chip-danger">désactivé</span>} <DemoChip on={m.is_demo} /></>}
        back={{ to: '/membres', label: 'Membres' }}
        actions={(
          <>
            <button type="button" className="btn" onClick={() => openMemberDialog(m, reload)}><Icon name="edit" /> Modifier</button>
            {m.active
              ? <button type="button" className="btn btn-danger" onClick={() => openDeactivateMemberDialog(m, reload)}><Icon name="ban" /> Désactiver</button>
              : <button type="button" className="btn" onClick={() => openReactivateMemberDialog(m, reload)}><Icon name="undo" /> Réactiver</button>}
            <button
              type="button"
              className="btn btn-primary"
              onClick={book}
              aria-disabled={!elig.ok}
              title={elig.ok ? 'Réserver une salle' : `Accès salle impossible : ${elig.reason}`}
            >
              <Icon name="plus" /> Réservation
              {elig.ok ? null : <span className="sr-only"> — indisponible : {elig.reason}</span>}
            </button>
          </>
        )}
        tour="member"
      />

      {!m.active && (
        <div className="toolbar">
          <Notice kind="warn">
            Membre désactivé le {dateTime(m.deactivated_at)}{m.deactivated_by_name ? ` par ${m.deactivated_by_name}` : ''} : {m.deactivation_reason}.
            Il ne peut plus réserver, entrer en salle, prendre une formule ni recevoir de carte ; tout son historique reste consultable ci-dessous.
          </Notice>
        </div>
      )}

      <div className="grid-2">
        <section className="card">
          <div className="card-head"><h2>Abonnement</h2>
            <button type="button" className={`btn btn-sm ${current ? '' : 'btn-primary'}`} onClick={() => openSubscriptionDialog(memberForDialogs, reload)}>{summary.state === 'aucun' ? 'Activer une formule' : 'Renouveler'}</button></div>
          {current ? (
            <>
              <p><strong>{current.plan_name}</strong> · du {dayLabel(current.start_date, 'short')} au {dayLabel(current.end_date, 'short')}
                {summary.state === 'expire_bientot' ? <>{' '}<span className="chip chip-warn">{summary.days_left === 0 ? 'dernier jour' : `encore ${summary.days_left} j`}</span></> : null}</p>
              <CreditBlock credit={current.credit} />
              {isAdmin ? (
                <div className="row" style={{ marginTop: 12 }}>
                  <button type="button" className="btn btn-sm" onClick={() => openAdjustCreditDialog(m, current, reload)}>Ajuster le crédit</button>
                  <button type="button" className="btn btn-sm btn-danger" onClick={cancelSub}>Annuler l’abonnement</button></div>
              ) : null}
            </>
          ) : (
            <Notice kind={summary.state === 'expiree' ? 'danger' : 'info'}>
              {summary.state === 'expiree'
                ? `Formule expirée le ${dayLabel(summary.end_date, 'short')} : les réservations sont refusées jusqu’au renouvellement.`
                : summary.state === 'a_venir' ? `Formule ${summary.plan_name} à partir du ${dayLabel(summary.start_date, 'short')}.` : 'Aucune formule : activez une formule pour permettre les réservations.'}
            </Notice>
          )}
        </section>

        <section className="card">
          <div className="card-head">
            <h2>Cartes</h2>
            <button
              type="button"
              className="btn btn-sm"
              onClick={() => openCardDialog(memberForDialogs, (res) => (res?.card_id ? navigate(`/cartes/${res.card_id}`) : reload()))}
            >
              <Icon name="card" /> Émettre une carte
            </button>
          </div>
          {m.cards.length ? (
            <div className="list">{m.cards.map((c) => (
              <div className="list-item" key={c.id}>
                <div className="grow"><div className="title"><span className="mono">{c.code}</span></div>
                  <div className="meta">Carte {c.kind} · émise le {dateTime(c.issued_at)}{c.deactivation_reason ? ` · ${c.deactivation_reason}` : ''}</div></div>
                {c.status === 'active' ? <span className="chip chip-ok">active</span> : <span className="chip">désactivée</span>}
                <Link className="btn btn-sm" to={`/cartes/${c.id}`} aria-label={`Afficher ou imprimer la carte ${c.code} avec son QR code`}>
                  <Icon name="printer" /> Carte & QR
                </Link>
                {c.status === 'active' ? <button type="button" className="btn btn-sm btn-ghost" onClick={() => deactivate(c)}>Désactiver</button> : null}
              </div>
            ))}</div>
          ) : <Empty icon="card">Aucune carte émise.</Empty>}
        </section>

        <section className="card">
          <div className="card-head"><h2>Coordonnées</h2></div>
          <dl className="kv">
            <dt>Téléphone</dt><dd>{m.phone}</dd>
            <dt>Courriel</dt><dd>{m.email ?? '—'}</dd>
            <dt>Notes</dt><dd>{m.notes ?? '—'}</dd>
            <dt>Membre depuis</dt><dd>{dateTime(m.created_at)}</dd>
          </dl>
        </section>

        <section className="card">
          <div className="card-head"><h2>À encaisser</h2>{due.length ? <button type="button" className="btn btn-sm btn-primary" onClick={() => openPaymentDialog({ lines: due, memberName: m.name }, reload)}>Encaisser {money(dueTotal)}</button> : null}</div>
          {due.length ? (
            <div className="list">{due.map((c) => (
              <div className="list-item" key={c.id}>
                <div className="grow"><div className="title">{c.label}{c.quantity > 1 ? ` × ${c.quantity}` : ''}</div><div className="meta"><AccountTag account={c.account} />{c.reservation_id ? <> · <Link to={`/reservations/${c.reservation_id}`}>réservation n° {c.reservation_id}</Link></> : null}</div></div>
                <span className="num">{money(c.amount)}</span></div>
            ))}</div>
          ) : <Empty icon="check">Rien à encaisser.</Empty>}
        </section>

        <section className="card span-2">
          <div className="card-head"><h2>Réservations</h2></div>
          {m.reservations.length ? (
            <div className="table-wrap"><table className="table stack-sm">
              <thead><tr><th>Journée</th><th>Salle</th><th>Horaire</th><th>Personnes</th><th>Durée</th><th className="num">Supplément</th><th>Statut</th></tr></thead>
              <tbody>{m.reservations.map((r) => (
                <tr key={r.id} className={r.status === 'annulee' ? 'is-muted' : ''}>
                  <td data-label="Journée"><Link to={`/reservations/${r.id}`}>{dayLabel(r.biz_day, 'medium')}</Link></td>
                  <td data-label="Salle">{r.room_name || 'Salon Principal'}{r.member_id !== m.id && <div className="subtle">Accompagnant · titulaire : {r.member_name}</div>}</td>
                  <td data-label="Horaire" className="nowrap">{r.start_time} – {r.end_time}</td>
                  <td data-label="Personnes">{r.party_size || 1} pers.</td>
                  <td data-label="Durée">{fmtDuration(r.duration_min)}</td>
                  <td data-label="Supplément" className="num">{r.member_id === m.id ? money(r.supplement_amount) : '—'}</td>
                  <td data-label="Statut"><Chip group="res" value={r.status} /></td></tr>
              ))}</tbody></table></div>
          ) : <Empty icon="calendar">Aucune réservation.</Empty>}
        </section>

        <section className="card">
          <div className="card-head"><h2>Historique des formules</h2></div>
          {m.subscriptions.length ? (
            <div className="list">{m.subscriptions.map((s) => (
              <div className="list-item" key={s.id}>
                <div className="grow"><div className="title">{s.plan_name}</div>
                  <div className="meta">{`${dayLabel(s.start_date, 'short')} → ${dayLabel(s.end_date, 'short')} · ${s.price == null ? 'prix non défini' : money(s.price)} · ${fmtDuration(s.credit.consumed)} consommées sur ${fmtDuration(s.credit.granted)}${s.cancel_reason ? ` · annulée : ${s.cancel_reason}` : ''}`}</div></div>
                <Chip group="sub" value={s.state} /></div>
            ))}</div>
          ) : <Empty icon="info">Aucune formule.</Empty>}
        </section>

        <section className="card">
          <div className="card-head"><h2>Paiements</h2></div>
          {m.payments.length ? (
            <div className="list">{m.payments.map((p) => (
              <div className="list-item" key={p.id}>
                <div className="grow"><div className="title">{money(p.amount)} — {p.method}</div>
                  <div className="meta">{dateTime(p.paid_at)}{p.reservation_id ? <> · <Link to={`/reservations/${p.reservation_id}`}>réservation n° {p.reservation_id}</Link></> : ' · abonnement'}</div></div>
                <span className="chip chip-ok">n° {p.id}</span>
                <Link className="btn btn-sm" to={`/caisse/ticket/${p.id}`}>Ticket</Link></div>
            ))}</div>
          ) : <Empty icon="wallet">Aucun paiement.</Empty>}
        </section>
      </div>
    </>
  );
}

export default function Member() {
  const { id } = useParams();
  const state = useLoad(() => api.get(`/api/members/${id}`), [id]);
  return <Loaded state={state}>{(m) => <MemberDetail m={m} reload={state.reload} />}</Loaded>;
}
