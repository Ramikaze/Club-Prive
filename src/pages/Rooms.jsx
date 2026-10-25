import { useState } from 'react';
import { Link } from 'react-router-dom';
import Icon from '../components/ui/Icon.jsx';
import { Empty, FormError, Loaded, PageHead, Segmented } from '../components/ui/ui.jsx';
import { Modal, actionDialog, openDialog } from '../components/ui/Modal.jsx';
import SessionTimer from '../components/ui/SessionTimer.jsx';
import EndingSoonNotice from '../components/ui/EndingSoonNotice.jsx';
import ConsumptionBreakdown from '../components/ui/ConsumptionBreakdown.jsx';
import { toast } from '../components/ui/toast.jsx';
import { api, newKey } from '../lib/api.js';
import { dayLabel, fmtDuration, money } from '../lib/format.js';
import { useLoad, useSubmit } from '../lib/hooks.js';
import { useIsAdmin, useStore } from '../store/useStore.js';
import {
  openAddAttendeeDialog,
  openBookingDialog,
  openConsumptionDialog,
  openExtendDialog,
  openQuickPayReservation,
  quickFinishReservation,
  quickRemoveAttendee,
  quickStartReservation,
} from '../dialogs/index.js';

function RoomDialog({ close, room, onDone }) {
  const editing = Boolean(room);
  const [key] = useState(newKey);
  const { busy, error, submit } = useSubmit();
  const [name, setName] = useState(room?.name ?? '');
  const [capacity, setCapacity] = useState(room?.capacity ?? 6);
  const [description, setDescription] = useState(room?.description ?? '');
  const [active, setActive] = useState(room?.active ?? true);

  const onSubmit = (e) => {
    e.preventDefault();
    submit(async () => {
      const body = {
        name,
        capacity,
        description,
        active: editing ? Boolean(active) : true,
      };
      const res = editing
        ? await api.put(`/api/rooms/${room.id}`, body, key)
        : await api.post('/api/rooms', body, key);
      if (res?.bundle) useStore.getState().setBundle(res.bundle);
      close();
      toast(editing ? 'Salle modifiée.' : 'Salle créée.');
      onDone?.(res);
    });
  };

  return (
    <Modal title={editing ? `Modifier ${room.name}` : 'Nouvelle salle'} onClose={close}>
      <form className="form-grid" onSubmit={onSubmit} noValidate>
        <div className="form-row">
          <label className="field">
            <span>Nom de la salle</span>
            <input value={name} onChange={(e) => setName(e.target.value)} required maxLength={60} placeholder="Ex. Salon Privé" />
          </label>
          <label className="field">
            <span>Capacité (personnes)</span>
            <input type="number" min="1" max="200" value={capacity} onChange={(e) => setCapacity(e.target.value)} required />
          </label>
        </div>
        <label className="field">
          <span>Description / ambiance (facultatif)</span>
          <input value={description} onChange={(e) => setDescription(e.target.value)} maxLength={200} placeholder="Ex. Fauteuils club, table basse, cave dédiée" />
        </label>
        {editing && (
          <label className="check">
            <input type="checkbox" checked={active} onChange={(e) => setActive(e.target.checked)} />
            <span>Salle ouverte à la réservation</span>
          </label>
        )}
        <FormError error={error} />
        <div className="modal-actions">
          <button type="button" className="btn" onClick={close}>Annuler</button>
          <button type="submit" className="btn btn-primary" disabled={busy} aria-busy={busy}>
            {editing ? 'Enregistrer' : 'Créer la salle'}
          </button>
        </div>
      </form>
    </Modal>
  );
}

export function openRoomDialog(room, onDone) {
  openDialog(RoomDialog, { room, onDone });
}

function RoomCard({ room, bizDay, canManage, canDelete, onReload }) {
  const r = room.current;
  const occupied = Boolean(r);
  const attendees = r?.attendees ?? (r ? [{
    member_id: r.member_id,
    name: r.member_name,
    member_no: r.member_no,
    is_primary: true,
  }] : []);
  const occupancy = Math.max(r?.party_size ?? 0, attendees.length);
  const atCapacity = occupancy >= room.capacity;
  // What the server says about extending this session. "Prolonger" is offered only when it can be (the
  // reason is shown instead); a session sent without the window keeps the button, and the server decides.
  const extension = r?.extension_window;
  const canExtend = !extension || extension.possible;

  const onDelete = () => actionDialog({
    title: `Supprimer ${room.name}`,
    danger: true,
    confirmLabel: 'Supprimer la salle',
    message: `Retirer « ${room.name} » des salles du club ? Son historique de réservations sera conservé.`,
    run: async () => {
      const res = await api.del(`/api/rooms/${room.id}`, {});
      if (res?.bundle) useStore.getState().setBundle(res.bundle);
      toast('Salle supprimée.');
      onReload();
    },
  });

  return (
    <article className={`room-card ${occupied ? 'is-occupied' : 'is-free'}`}>
      <div className="room-card-head">
        <div>
          <div className="row" style={{ gap: 8 }}>
            <h2 className="room-card-title">{room.name}</h2>
            <span className={`chip ${occupied ? 'chip-warn' : 'chip-ok'}`}>
              {!room.active ? 'Fermée' : occupied ? 'Occupée' : 'Disponible'}
            </span>
          </div>
          <p className="subtle" style={{ marginTop: 3 }}>
            Jusqu’à {room.capacity} personnes{room.description ? ` · ${room.description}` : ''}
          </p>
        </div>
        {canManage && (
          <div className="row" style={{ gap: 4 }}>
            <button type="button" className="btn btn-sm btn-ghost" onClick={() => openRoomDialog(room, onReload)} title="Modifier la salle">
              <Icon name="edit" />
            </button>
            {canDelete && !occupied && (
              <button type="button" className="btn btn-sm btn-ghost" onClick={onDelete} title="Supprimer la salle">
                <Icon name="trash" />
              </button>
            )}
          </div>
        )}
      </div>

      {!room.active ? (
        <div className="room-card-body">
          <p className="subtle">Cette salle est fermée aux nouvelles réservations. Modifiez-la pour la rouvrir.</p>
        </div>
      ) : occupied ? (
        <div className="room-card-body">
          <EndingSoonNotice reservation={r} onExtended={onReload} />
          <div className="room-occupant-bar" style={{ flexDirection: 'column', alignItems: 'stretch', gap: 10 }}>
            <div className="row" style={{ justifyContent: 'space-between', alignItems: 'flex-start' }}>
              <div>
                <Link to={`/reservations/${r.id}`} className="room-member-link">{r.member_name}</Link>
                <div className="subtle">
                  {r.start_time} → {r.end_time} ({fmtDuration(r.duration_min)})
                  {r.status === 'reservee' ? ' · arrivée à confirmer' : ' · séance en cours'}
                </div>
              </div>
              <button
                type="button"
                className="btn btn-sm"
                disabled={atCapacity}
                onClick={() => openAddAttendeeDialog(r, onReload)}
                title={atCapacity ? `Capacité maximale atteinte (${room.capacity} personnes)` : 'Ajouter un membre présent (seul le titulaire est débité)'}
              >
                <Icon name="plus" /> Membre ({occupancy}/{room.capacity})
              </button>
            </div>

            <SessionTimer reservation={r} compact />

            <div>
              <div className="subtle" style={{ fontSize: '0.76rem', marginBottom: 5 }}>
                Membres présents dans la salle :
              </div>
              <div className="attendee-chips">
                {attendees.map((att) => (
                  <span
                    key={att.member_id}
                    className={`chip ${att.is_primary ? 'chip-bronze' : 'chip-ok'}`}
                    style={{ gap: 6 }}
                  >
                    <Link to={`/membres/${att.member_id}`} style={{ color: 'inherit', textDecoration: 'none' }}>
                      {att.name}
                    </Link>
                    <span style={{ opacity: 0.8, fontWeight: 400 }}>
                      ({att.card_code || att.member_no})
                    </span>
                    {!att.is_primary && (
                      <button
                        type="button"
                        className="chip-remove-btn"
                        onClick={() => quickRemoveAttendee(r, att, onReload)}
                        aria-label={`Retirer ${att.name} de la salle`}
                        title={`Retirer ${att.name} de la salle`}
                      >
                        ×
                      </button>
                    )}
                  </span>
                ))}
              </div>
              {occupancy > attendees.length && <p className="subtle">{occupancy - attendees.length} personne(s) non identifiée(s) (réservation antérieure à la règle « membres uniquement »).</p>}
            </div>
          </div>

          <div className="room-conso-box">
            <div className="row" style={{ justifyContent: 'space-between', marginBottom: 4 }}>
              <span className="subtle">Consommations par membre</span>
              <span className="num">
                {r.due_amount > 0 ? <strong>À régler : {money(r.due_amount)}</strong> : <span className="chip chip-ok">Note à jour</span>}
              </span>
            </div>
            <ConsumptionBreakdown attendees={attendees} lines={r.consumptions ?? []} />
          </div>

          <div className="room-card-actions">
            <button type="button" className="btn btn-sm btn-primary" onClick={() => openConsumptionDialog(r, onReload)}>
              <Icon name="plus" /> Facturer bouteille / cigare
            </button>
            {r.due_amount > 0 && (
              <button type="button" className="btn btn-sm" onClick={() => openQuickPayReservation(r, onReload)}>
                <Icon name="wallet" /> Encaisser {money(r.due_amount)}
              </button>
            )}
            {r.status === 'reservee' && (
              <button type="button" className="btn btn-sm" onClick={() => quickStartReservation(r, onReload)}>
                <Icon name="check" /> Arrivée
              </button>
            )}
            {canExtend && (
              <button type="button" className="btn btn-sm" onClick={() => openExtendDialog(r, onReload, extension)}>
                Prolonger
              </button>
            )}
            <button type="button" className="btn btn-sm" onClick={() => quickFinishReservation(r, onReload)}>
              Libérer la salle
            </button>
            <Link className="btn btn-sm btn-ghost" to={`/reservations/${r.id}`}>Fiche</Link>
          </div>
          {!canExtend && extension.reason && <p className="subtle room-extension-reason">{extension.reason}</p>}
        </div>
      ) : (
        <div className="room-card-body">
          <div className="room-free-info">
            {room.next ? (
              <div>
                <div className="subtle">Prochaine réservation prévue :</div>
                <div style={{ marginTop: 2 }}>
                  <strong>{room.next.biz_day === bizDay ? '' : `${dayLabel(room.next.biz_day, 'short')} `}{room.next.start_time} – {room.next.end_time}</strong>
                  {' · '}
                  <Link to={`/reservations/${room.next.id}`}>{room.next.member_name}</Link> ({room.next.party_size || 1} membre(s))
                </div>
              </div>
            ) : (
              <span className="subtle">Aucune réservation prévue — la salle est immédiatement disponible.</span>
            )}
          </div>

          <div className="room-card-actions">
            <button
              type="button"
              className="btn btn-sm btn-primary"
              onClick={() => openBookingDialog({ date: bizDay, room_id: room.id, start_now: true }, onReload)}
            >
              <Icon name="plus" /> Installer un membre
            </button>
            <button
              type="button"
              className="btn btn-sm"
              onClick={() => openBookingDialog({ date: bizDay, room_id: room.id }, onReload)}
            >
              <Icon name="calendar" /> Réserver un créneau
            </button>
            <Link className="btn btn-sm btn-ghost" to={`/agenda?salle=${room.id}`}>
              Voir l’agenda
            </Link>
          </div>
        </div>
      )}
    </article>
  );
}

export default function Rooms() {
  const admin = useIsAdmin();
  const [filter, setFilter] = useState('toutes');
  const state = useLoad(async () => {
    const [dashboard, allRooms] = await Promise.all([
      api.get('/api/dashboard'), admin ? api.get('/api/rooms?all=1') : Promise.resolve([]),
    ]);
    return { ...dashboard, closed_rooms: allRooms.filter((r) => !r.active) };
  }, [admin], { refreshMs: 30000 });

  return (
    <Loaded state={state}>
      {(d) => {
        const reload = state.reload;
        const roomsStatus = d.rooms_status ?? [];
        const occupiedCount = roomsStatus.filter((rm) => rm.occupied).length;
        const freeCount = roomsStatus.length - occupiedCount;
        const totalGuestsNow = roomsStatus.reduce((sum, rm) => sum + (rm.current?.party_size || 0), 0);

        const filtered = roomsStatus.filter((rm) => {
          if (filter === 'libres') return !rm.occupied;
          if (filter === 'occupees') return rm.occupied;
          return true;
        });

        return (
          <>
            <PageHead
              title="Salles & Salons"
              lead={`${freeCount} salle(s) disponible(s) sur ${roomsStatus.length}${occupiedCount > 0 ? ` · ${occupiedCount} occupée(s) (${totalGuestsNow} membre(s) présent(s))` : ''}`}
              actions={(
                <>
                  {admin && (
                    <button type="button" className="btn" onClick={() => openRoomDialog(null, reload)}>
                      <Icon name="plus" /> Nouvelle salle
                    </button>
                  )}
                  <button
                    type="button"
                    className="btn"
                    onClick={() => openBookingDialog({ date: d.biz_day }, reload)}
                  >
                    <Icon name="calendar" /> Réserver
                  </button>
                  <button
                    type="button"
                    className="btn btn-primary"
                    onClick={() => openBookingDialog({ date: d.biz_day, start_now: true }, reload)}
                  >
                    <Icon name="plus" /> Installer un membre
                  </button>
                </>
              )}
            />

            <div className="toolbar">
              <Segmented
                label="Filtrer les salles"
                value={filter}
                options={[
                  ['toutes', `Toutes (${roomsStatus.length})`],
                  ['libres', `Disponibles (${freeCount})`],
                  ['occupees', `Occupées (${occupiedCount})`],
                ]}
                onChange={setFilter}
              />
            </div>

            {filtered.length ? (
              <div className="rooms-grid">
                {filtered.map((rm) => (
                  <RoomCard
                    key={rm.id}
                    room={rm}
                    bizDay={d.biz_day}
                    canManage={admin}
                    canDelete={roomsStatus.length > 1}
                    onReload={reload}
                  />
                ))}
              </div>
            ) : (
              <section className="card">
                <Empty icon="home">Aucune salle dans cette catégorie pour le moment.</Empty>
              </section>
            )}
            {admin && d.closed_rooms.length > 0 && (
              <section style={{ marginTop: 24 }} aria-labelledby="closed-rooms-title">
                <h2 id="closed-rooms-title">Salles fermées ({d.closed_rooms.length})</h2>
                <div className="rooms-grid" style={{ marginTop: 12 }}>
                  {d.closed_rooms.map((room) => (
                    <RoomCard key={room.id} room={room} bizDay={d.biz_day} canManage canDelete onReload={reload} />
                  ))}
                </div>
              </section>
            )}
          </>
        );
      }}
    </Loaded>
  );
}
