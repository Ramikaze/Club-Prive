import { Link, useNavigate, useParams } from 'react-router-dom';
import Icon from '../components/ui/Icon.jsx';
import { AccountTag, Chip, DemoChip, Empty, Loaded, Notice, PageHead } from '../components/ui/ui.jsx';
import { toast } from '../components/ui/toast.jsx';
import { actionDialog } from '../components/ui/Modal.jsx';
import { api, newKey } from '../lib/api.js';
import MemberCard3D from '../components/ui/MemberCard3D.jsx';
import SessionTimer, { isRunning } from '../components/ui/SessionTimer.jsx';
import EndingSoonNotice from '../components/ui/EndingSoonNotice.jsx';
import { money, fmtDuration, dayLabel, dateTime, dayMonth, paymentPurpose, paymentMethodText } from '../lib/format.js';
import { useLoad } from '../lib/hooks.js';
import { useIsAdmin } from '../store/useStore.js';
import {
  openBookingDialog, openMemberDialog, openSubscriptionDialog, openCardDialog, openAdjustCreditDialog, openPaymentDialog,
  openDeactivateMemberDialog, openReactivateMemberDialog, memberRoomEligibility, openRechargeDialog, openOutsideMealDialog,
  openCancelRechargeDialog, openCancelMealDialog, sendRenewalWhatsApp,
} from '../dialogs/index.js';

const plural = (minutes) => (minutes > 1 && minutes !== 60 ? 's' : '');

// The plan's hours: available in large, the gauge (consumed, committed, available), then the detail line.
function TimeBar({ current, summary }) {
  if (!current) {
    let text = 'Aucune formule : les réservations sont payées avec le crédit CFA.';
    if (summary.state === 'expiree') text = `Formule expirée le ${dayLabel(summary.end_date, 'short')} : les réservations sont payées avec le crédit CFA.`;
    if (summary.state === 'a_venir') text = `Formule ${summary.plan_name} à partir du ${dayLabel(summary.start_date, 'short')} ; d’ici là, les réservations sont payées avec le crédit CFA.`;
    return (
      <div className="tile-bar">
        <div className="tile-bar-top"><span className="k">Crédit temps</span><span className="v">—</span></div>
        <div className="gauge" aria-hidden="true" />
        <p className="subtle">{text}</p>
      </div>
    );
  }
  const c = current.credit;
  const total = Math.max(c.granted, c.committed + c.consumed + c.available, 1);
  const pct = (v) => `${Math.round((v / total) * 1000) / 10}%`;
  return (
    <div className="tile-bar">
      <div className="tile-bar-top"><span className="k">Crédit temps</span><span className="v">{`${fmtDuration(c.available)} disponible${plural(c.available)}`}</span></div>
      <div className="gauge" role="img" aria-label={`Crédit temps : ${fmtDuration(c.consumed)} consommées, ${fmtDuration(c.committed)} engagées, ${fmtDuration(c.available)} disponibles`}>
        <span className="g-consumed" style={{ width: pct(c.consumed) }} />
        <span className="g-committed" style={{ width: pct(c.committed) }} />
        <span className="g-available" style={{ width: pct(c.available) }} />
      </div>
      <p className="subtle">
        {`${fmtDuration(c.granted)} attribuées · ${fmtDuration(c.committed)} engagées · ${fmtDuration(c.consumed)} consommées · ${current.plan_name} jusqu’au ${dayLabel(current.end_date, 'short')}`}
        {summary.state === 'expire_bientot' ? <>{' '}<span className="chip chip-warn">{summary.days_left === 0 ? 'dernier jour' : `encore ${summary.days_left} j`}</span></> : null}
      </p>
      {c.adjustments ? <p className="subtle">Dont ajustements manuels : {c.adjustments > 0 ? '+' : '−'}{fmtDuration(Math.abs(c.adjustments))}</p> : null}
      {c.allocation_mode === 'mensuelle' ? <p className="subtle">Attribution mensuelle : {fmtDuration(c.allocated)} attribuées à ce jour sur {fmtDuration(c.included)}.</p> : null}
    </div>
  );
}

// The card's money: the balance in large, the bar against the last recharge.
function CfaBar({ wallet }) {
  const last = wallet.last_recharge;
  const ratio = last ? Math.min(1, wallet.balance / last.amount) : (wallet.balance > 0 ? 1 : 0);
  return (
    <div className="tile-bar">
      <div className="tile-bar-top"><span className="k">Crédit CFA</span><span className="v">{money(wallet.balance)}</span></div>
      <div className="gauge" role="img" aria-label={`Crédit CFA : ${money(wallet.balance)}${last ? ` sur ${money(last.amount)} approvisionnés` : ''}`}>
        <span className="g-cfa" style={{ width: `${Math.round(ratio * 1000) / 10}%` }} />
      </div>
      <p className="subtle">{last ? `sur ${money(last.amount)} approvisionnés le ${dayMonth(last.at)}` : 'Aucun approvisionnement pour l’instant.'}</p>
    </div>
  );
}

// The automatic renewal that the card's money does not cover (soon, or already blocked), with the message to send.
function RenewalAlert({ m }) {
  const r = m.renewal;
  if (!r) return null;
  const end = dayLabel(r.end_date, 'short');
  return (
    <div className="tile-alert">
      <Notice kind={r.state === 'bloque' ? 'danger' : 'warn'}>
        {r.state === 'bloque'
          ? `Renouvellement impossible : ${money(r.balance)} sur la carte, ${money(r.price)} nécessaires (formule ${r.plan_name} terminée le ${end}). Il manque ${money(r.missing)} : l’abonnement sera renouvelé dès l’approvisionnement de la carte.`
          : `La formule ${r.plan_name} se termine le ${end} : ${money(r.balance)} sur la carte, ${money(r.price)} nécessaires pour la renouveler. Il manque ${money(r.missing)}.`}
        <div className="row">
          <button type="button" className="btn btn-sm" onClick={() => sendRenewalWhatsApp(r, { lastName: m.last_name, phone: m.phone })}>
            <Icon name="message" /> Prévenir par WhatsApp</button>
        </div>
      </Notice>
    </div>
  );
}

const MOVE_LABEL = {
  recharge: 'Approvisionnement', paiement: 'Payé par la carte', remboursement: 'Rendu sur la carte', annulation_recharge: 'Approvisionnement annulé',
};

function WalletMovements({ m, reload }) {
  const isAdmin = useIsAdmin();
  const moves = m.wallet.movements;
  const payments = new Map(m.payments.map((p) => [p.id, p]));
  const cancelled = new Set(moves.filter((w) => w.kind === 'annulation_recharge').map((w) => w.payment_id));
  return (
    <details className="tile-fold">
      <summary>{`Mouvements de la carte (${moves.length}${moves.length === 50 ? ' derniers' : ''})`}</summary>
      {moves.length ? (
        <div className="list">{moves.map((w) => {
          const isCancelled = w.kind === 'recharge' && (cancelled.has(w.payment_id) || Boolean(payments.get(w.payment_id)?.cancelled_at));
          return (
            <div className={`list-item list-item-wrap ${isCancelled ? 'is-cancelled' : ''}`} key={w.id}>
              <div className="grow">
                <div className="title">{MOVE_LABEL[w.kind] ?? w.kind}{' '}
                  <span className={w.amount > 0 ? 'amount-in' : ''}>{`${w.amount > 0 ? '+' : '−'}${money(Math.abs(w.amount))}`}</span></div>
                <div className="meta">{`${dateTime(w.at)} · solde ${money(w.balance_after)}${w.by_name ? ` · ${w.by_name}` : ''}${w.reason ? ` · ${w.reason}` : ''}`}</div>
              </div>
              {isCancelled ? <span className="chip">annulée</span> : null}
              {w.payment_id ? <Link className="btn btn-sm" to={`/caisse/ticket/${w.payment_id}`}>Ticket</Link> : null}
              {isAdmin && w.kind === 'recharge' && !isCancelled ? (
                <button type="button" className="btn btn-sm btn-ghost"
                  onClick={() => openCancelRechargeDialog({ paymentId: w.payment_id, amount: w.amount, at: w.at }, reload)}>Annuler l’approvisionnement</button>
              ) : null}
            </div>
          );
        })}</div>
      ) : <Empty icon="wallet">Aucun mouvement sur la carte.</Empty>}
    </details>
  );
}

// The « Carte » tile: the card itself (turned over for its QR code), the two credits under it, then the actions.
function CardTile({ m, current, summary, reload, book }) {
  const navigate = useNavigate();
  const isAdmin = useIsAdmin();
  const shown = m.cards.find((c) => c.status === 'active') ?? m.cards[0] ?? null;
  const older = m.cards.filter((c) => c !== shown);
  const activeCard = shown?.status === 'active' ? shown : null;
  const issueCard = () => openCardDialog({ ...m }, (res) => (res?.card_id ? navigate(`/cartes/${res.card_id}`) : reload()));
  const inactiveTitle = m.active ? undefined : 'Membre désactivé';

  const cancelSub = () => {
    const key = newKey();
    actionDialog({
      title: 'Annuler l’abonnement',
      message: `${current.plan_name} (${dayLabel(current.start_date, 'short')} → ${dayLabel(current.end_date, 'short')}). La ligne d’abonnement non encaissée sera annulée ; un remboursement éventuel est une action distincte. L’abonnement ne sera plus renouvelé sur la carte.`,
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
      title: 'Désactiver la carte', message: `Carte ${card.kind} ${card.code}. Le crédit CFA reste au membre : il passe sur sa prochaine carte.`,
      reasonLabel: 'Motif (perte, remplacement…)', danger: true, confirmLabel: 'Désactiver',
      run: async (v) => {
        await api.post(`/api/cards/${card.id}/deactivate`, { reason: v.reason }, key);
        toast('Carte désactivée.');
        reload();
      },
    });
  };

  return (
    <section className="card card-tile">
      <div className="card-head"><h2>Carte</h2>
        {activeCard ? <span className="chip chip-ok">active</span> : shown ? <span className="chip">désactivée</span> : <span className="chip">aucune carte</span>}</div>
      <MemberCard3D
        name={m.name}
        code={shown?.code ?? null}
        active={Boolean(activeCard)}
        qrPath={shown ? `/membres/${m.id}?card=${encodeURIComponent(shown.code)}` : null}
      />
      {!activeCard ? (
        <div className="row" style={{ justifyContent: 'center', marginTop: 10 }}>
          <button type="button" className="btn btn-sm btn-primary" onClick={issueCard}><Icon name="card" /> Émettre une carte</button>
        </div>
      ) : null}

      <TimeBar current={current} summary={summary} />
      <CfaBar wallet={m.wallet} />
      <RenewalAlert m={m} />

      <div className="tile-actions-main">
        <button type="button" className="btn btn-primary" onClick={() => openRechargeDialog(m, reload)} disabled={!m.active} title={inactiveTitle}>
          <Icon name="wallet" /> Approvisionner</button>
        <button type="button" className="btn" onClick={book}><Icon name="calendar" /> Réserver</button>
        <button type="button" className="btn" onClick={() => openOutsideMealDialog(m, reload)} disabled={!m.active} title={inactiveTitle}>
          <Icon name="receipt" /> Repas extérieur</button>
        {shown ? <Link className="btn" to={`/cartes/${shown.id}`}><Icon name="printer" /> Imprimer la carte</Link> : null}
      </div>
      <div className="tile-actions-minor">
        {isAdmin && current ? <button type="button" className="btn btn-sm btn-ghost" onClick={() => openAdjustCreditDialog(m, current, reload)}>Ajuster le crédit temps</button> : null}
        {activeCard ? <button type="button" className="btn btn-sm btn-ghost" onClick={() => deactivate(activeCard)}>Désactiver la carte</button> : null}
        {activeCard ? <button type="button" className="btn btn-sm btn-ghost" onClick={issueCard}>Émettre une autre carte</button> : null}
        <button type="button" className="btn btn-sm btn-ghost" onClick={() => openSubscriptionDialog({ ...m }, reload)}>{summary.state === 'aucun' ? 'Activer une formule' : 'Renouveler la formule'}</button>
        {isAdmin && current ? <button type="button" className="btn btn-sm btn-ghost" onClick={cancelSub}>Annuler l’abonnement</button> : null}
      </div>

      <WalletMovements m={m} reload={reload} />
      {older.length ? (
        <details className="tile-fold">
          <summary>{`Anciennes cartes (${older.length})`}</summary>
          <div className="list">{older.map((c) => (
            <div className="list-item list-item-wrap" key={c.id}>
              <div className="grow"><div className="title"><span className="mono">{c.code}</span></div>
                <div className="meta">Carte {c.kind} · émise le {dateTime(c.issued_at)}{c.deactivation_reason ? ` · ${c.deactivation_reason}` : ''}</div></div>
              {c.status === 'active' ? <span className="chip chip-ok">active</span> : <span className="chip">désactivée</span>}
              <Link className="btn btn-sm" to={`/cartes/${c.id}`} aria-label={`Afficher ou imprimer la carte ${c.code} avec son QR code`}><Icon name="printer" /> Carte & QR</Link>
              {c.status === 'active' ? <button type="button" className="btn btn-sm btn-ghost" onClick={() => deactivate(c)}>Désactiver</button> : null}
            </div>
          ))}</div>
        </details>
      ) : null}
    </section>
  );
}

function MemberDetail({ m, reload }) {
  const navigate = useNavigate();
  const isAdmin = useIsAdmin();
  const summary = m.subscription;
  const current = m.subscriptions.find((s) => s.id === summary.id && ['active', 'expire_bientot'].includes(summary.state));
  // The booking member may pay the room with his card when his plan has no time left, or when he has none.
  const elig = memberRoomEligibility(m, { card: true });
  const due = m.charges.filter((c) => c.status === 'due');
  const dueTotal = due.reduce((sum, c) => sum + c.amount, 0);

  const book = () => {
    if (!elig.ok) {
      toast(`Accès salle refusé pour ${m.name} : ${elig.reason}.`, 'error');
      return;
    }
    openBookingDialog({ member: { id: m.id, name: m.name, member_no: m.member_no, subscription: summary }, lockMember: true },
      (det) => navigate(`/reservations/${det.reservation.id}`));
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
            <Link className="btn" to={`/membres/${m.id}/releve`}><Icon name="statement" /> Relevé</Link>
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

      {/* The member is in a room right now (holder or guest): the same countdown as on Salles and the booking. */}
      {m.reservations.filter(isRunning).map((r) => (
        <section className="card session-timer-block" key={r.id}>
          <div className="card-head">
            <h2>En salle : {r.room_name}</h2>
            <Link className="btn btn-sm" to={`/reservations/${r.id}`}>Réservation n° {r.id}</Link>
          </div>
          <SessionTimer reservation={r} />
          <EndingSoonNotice reservation={r} onExtended={reload} />
        </section>
      ))}

      <div className="grid-2">
        <CardTile m={m} current={current} summary={summary} reload={reload} book={book} />

        <div className="stack-cards">
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
        </div>

        <section className="card span-2">
          <div className="card-head"><h2>Réservations</h2></div>
          {m.reservations.length ? (
            <div className="table-wrap"><table className="table stack-sm">
              <thead><tr><th>Journée</th><th>Salle</th><th>Horaire</th><th>Personnes</th><th>Durée</th><th className="num">Supplément</th><th>Statut</th></tr></thead>
              <tbody>{m.reservations.map((r) => (
                <tr key={r.id} className={r.status === 'annulee' ? 'is-muted' : ''}>
                  <td data-label="Journée"><Link to={`/reservations/${r.id}`}>{dayLabel(r.biz_day, 'medium')}</Link></td>
                  <td data-label="Salle">{r.room_name || 'Salon Principal'}</td>
                  <td data-label="Horaire" className="nowrap">{r.start_time} – {r.end_time}</td>
                  <td data-label="Personnes">{r.party_size || 1} pers.</td>
                  <td data-label="Durée">{fmtDuration(r.duration_min)}</td>
                  <td data-label="Supplément" className="num">{money(r.supplement_amount)}</td>
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
              <div className={`list-item list-item-wrap ${p.cancelled_at ? 'is-cancelled' : ''}`} key={p.id}>
                <div className="grow"><div className="title">{money(p.amount)} — {paymentMethodText(p)}</div>
                  <div className="meta">{dateTime(p.paid_at)}
                    {paymentPurpose(p) ? ` · ${paymentPurpose(p)}` : null}
                    {p.reservation_id ? <> · <Link to={`/reservations/${p.reservation_id}`}>réservation n° {p.reservation_id}</Link></> : (paymentPurpose(p) ? null : ' · abonnement')}
                    {p.cancelled_at ? ` · annulé le ${dateTime(p.cancelled_at)} : ${p.cancel_reason}` : null}</div></div>
                {p.cancelled_at ? <span className="chip">annulé</span> : <span className="chip chip-ok">n° {p.id}</span>}
                {isAdmin && p.kind === 'repas' && !p.cancelled_at
                  ? <button type="button" className="btn btn-sm btn-ghost" onClick={() => openCancelMealDialog(p, reload)}>Annuler le repas</button> : null}
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
