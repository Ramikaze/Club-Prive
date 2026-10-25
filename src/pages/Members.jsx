import { useCallback, useEffect, useRef, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import Icon from '../components/ui/Icon.jsx';
import SmartSearch from '../components/ui/SmartSearch.jsx';
import { Chip, DemoChip, Empty, Loaded, PageHead, Segmented } from '../components/ui/ui.jsx';
import { toast } from '../components/ui/toast.jsx';
import { api, qs } from '../lib/api.js';
import { fmtDuration, subStateLabel } from '../lib/format.js';
import { useLoad } from '../lib/hooks.js';
import {
  openBookingDialog, openMemberDialog, openDeactivateMemberDialog, openReactivateMemberDialog, memberRoomEligibility,
} from '../dialogs/index.js';

const creditCell = (sub) => (sub?.credit ? fmtDuration(sub.credit.available) : '—');
const STATUTS = [['actifs', 'Actifs'], ['desactives', 'Désactivés']];

function MembersTable({ items, onBook, onDeactivate, onReactivate, statut }) {
  if (!items.length) {
    return (
      <section className="card">
        <Empty icon="users">{statut === 'desactives' ? 'Aucun membre désactivé.' : 'Aucun membre ne correspond à la recherche.'}</Empty>
      </section>
    );
  }
  return (
    <section className="card"><div className="table-wrap"><table className="table stack-sm">
      <thead><tr><th>Membre</th><th>Téléphone</th><th>Formule</th><th>État</th><th className="num">Crédit disponible</th><th><span className="sr-only">Actions</span></th></tr></thead>
      <tbody>{items.map((m) => {
        const elig = memberRoomEligibility(m, { card: true });
        return (
          <tr key={m.id}>
            <td data-label="Membre"><Link to={`/membres/${m.id}`}><strong>{m.name}</strong></Link> <span className="subtle">{m.member_no}</span> <DemoChip on={m.is_demo} />
              {m.active === false && <> <span className="chip chip-danger">désactivé</span></>}</td>
            <td data-label="Téléphone" className="nowrap">{m.phone}</td>
            <td data-label="Formule">{subStateLabel(m.subscription)}</td>
            <td data-label="État"><Chip group="sub" value={m.subscription.state} /></td>
            <td data-label="Crédit disponible" className="num">{creditCell(m.subscription)}</td>
            <td className="actions">
              <button
                type="button"
                className="btn btn-sm"
                aria-disabled={!elig.ok}
                title={elig.ok ? `Réserver une salle pour ${m.name}` : `Accès salle impossible : ${elig.reason}`}
                onClick={() => (elig.ok ? onBook(m) : toast(`Accès salle refusé pour ${m.name} : ${elig.reason}.`, 'error'))}
              >
                <Icon name="calendar" /> Réserver
                {elig.ok ? null : <span className="sr-only"> — indisponible : {elig.reason}</span>}
              </button>
              <Link className="btn btn-sm btn-ghost" to={`/membres/${m.id}`}>Fiche</Link>
              {m.active === false ? (
                <button type="button" className="btn btn-sm" onClick={() => onReactivate(m)} title={`Réactiver ${m.name}`}>
                  <Icon name="undo" /> Réactiver
                </button>
              ) : (
                <button type="button" className="btn btn-sm btn-danger" onClick={() => onDeactivate(m)} title={`Désactiver ${m.name} (historique conservé)`}>
                  <Icon name="ban" /> Désactiver
                </button>
              )}
            </td>
          </tr>
        );
      })}</tbody>
    </table></div></section>
  );
}

function MemberSearch({ initialQ, setQuery }) {
  const navigate = useNavigate();
  const state = useLoad(() => api.get(`/api/members${qs({ q: initialQ })}`), []);
  const [text, setText] = useState(initialQ);
  const [found, setFound] = useState(null); // { q, items } once the search box has been used
  const [statut, setStatut] = useState('actifs');
  const seq = useRef(0);
  const timer = useRef(null);

  useEffect(() => () => {
    clearTimeout(timer.current);
    seq.current += 1;
  }, []);

  const refreshList = async (s = statut) => {
    const v = text.trim();
    const n = (seq.current += 1);
    try {
      const items = await api.get(`/api/members${qs({ q: v, statut: s })}`);
      if (n === seq.current) setFound({ q: v, items });
    } catch (err) {
      toast(err.message, 'error');
    }
  };

  const onInput = (value) => {
    setText(value);
    clearTimeout(timer.current);
    timer.current = setTimeout(async () => {
      const v = value.trim();
      setQuery(v);
      const n = (seq.current += 1);
      try {
        const items = await api.get(`/api/members${qs({ q: v, statut })}`);
        if (n === seq.current) setFound({ q: v, items });
      } catch (err) {
        toast(err.message, 'error');
      }
    }, 220);
  };

  const onStatut = (s) => {
    setStatut(s);
    refreshList(s);
  };

  const onBook = (m) => openBookingDialog(
    { member: { id: m.id, name: m.name, member_no: m.member_no, subscription: m.subscription }, lockMember: true },
    (det) => navigate(`/reservations/${det.reservation.id}`),
  );

  const onDeactivate = (m) => openDeactivateMemberDialog(m, () => refreshList());
  const onReactivate = (m) => openReactivateMemberDialog(m, () => refreshList());

  return (
    <Loaded state={state}>{(list) => {
      const q = found ? found.q : initialQ;
      const items = found ? found.items : list;
      return (
        <>
          <PageHead
            title="Membres"
            lead={`${items.length} membre(s)${statut === 'desactives' ? ' désactivé(s)' : ''}${q ? ' trouvé(s)' : ''}`}
            actions={<button type="button" className="btn btn-primary" onClick={() => openMemberDialog(null, (m) => navigate(`/membres/${m.id}`))}><Icon name="plus" /> Nouveau membre</button>}
            tour="members"
          />
          <form className="toolbar" role="search" onSubmit={(e) => e.preventDefault()}>
            <SmartSearch
              value={text}
              onChange={onInput}
              suggestions={found && found.q === text.trim() ? found.items : []}
              onPick={(m) => navigate(`/membres/${m.id}`)}
              placeholder="Nom, téléphone, n° de membre ou de carte"
              label="Rechercher un membre"
              renderSuggestion={(m) => (
                <div className="grow">
                  <div className="title">{m.name}</div>
                  <div className="meta">{[m.member_no, m.phone].filter(Boolean).join(' · ')}</div>
                </div>
              )}
            />
            <Segmented label="Statut des membres" value={statut} options={STATUTS} onChange={onStatut} />
          </form>
          <div id="member-results">
            <MembersTable items={items} onBook={onBook} onDeactivate={onDeactivate} onReactivate={onReactivate} statut={statut} />
          </div>
        </>
      );
    }}</Loaded>
  );
}

export default function Members() {
  const [params, setParams] = useSearchParams();
  const q = params.get('q') ?? '';
  const written = useRef(q); // last value written to the URL by the search box
  const [round, setRound] = useState(0);

  // A navigation to /membres from elsewhere (not the search box) reloads the page.
  useEffect(() => {
    if (q !== written.current) {
      written.current = q;
      setRound((n) => n + 1);
    }
  }, [q]);

  const setQuery = useCallback((v) => {
    written.current = v;
    setParams(v ? { q: v } : {}, { replace: true });
  }, [setParams]);

  return <MemberSearch key={round} initialQ={q} setQuery={setQuery} />;
}
