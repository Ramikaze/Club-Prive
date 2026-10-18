import { useCallback, useEffect, useRef, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import Icon from '../components/ui/Icon.jsx';
import { Chip, DemoChip, Empty, Loaded, PageHead } from '../components/ui/ui.jsx';
import { toast } from '../components/ui/toast.jsx';
import { api, qs } from '../lib/api.js';
import { fmtDuration, subStateLabel } from '../lib/format.js';
import { useLoad } from '../lib/hooks.js';
import { openMemberDialog } from '../dialogs/index.js';

const creditCell = (sub) => (sub?.credit ? fmtDuration(sub.credit.available) : '—');

function MembersTable({ items }) {
  if (!items.length) return <section className="card"><Empty icon="users">Aucun membre ne correspond à la recherche.</Empty></section>;
  return (
    <section className="card"><div className="table-wrap"><table className="table stack-sm">
      <thead><tr><th>Membre</th><th>Téléphone</th><th>Formule</th><th>État</th><th className="num">Crédit disponible</th></tr></thead>
      <tbody>{items.map((m) => (
        <tr key={m.id}>
          <td data-label="Membre"><Link to={`/membres/${m.id}`}><strong>{m.name}</strong></Link> <span className="subtle">{m.member_no}</span> <DemoChip on={m.is_demo} /></td>
          <td data-label="Téléphone" className="nowrap">{m.phone}</td>
          <td data-label="Formule">{subStateLabel(m.subscription)}</td>
          <td data-label="État"><Chip group="sub" value={m.subscription.state} /></td>
          <td data-label="Crédit disponible" className="num">{creditCell(m.subscription)}</td>
        </tr>
      ))}</tbody>
    </table></div></section>
  );
}

function MemberSearch({ initialQ, setQuery }) {
  const navigate = useNavigate();
  const state = useLoad(() => api.get(`/api/members${qs({ q: initialQ })}`), []);
  const [text, setText] = useState(initialQ);
  const [found, setFound] = useState(null); // { q, items } once the search box has been used
  const seq = useRef(0);
  const timer = useRef(null);

  useEffect(() => () => {
    clearTimeout(timer.current);
    seq.current += 1;
  }, []);

  const onInput = (e) => {
    const value = e.target.value;
    setText(value);
    clearTimeout(timer.current);
    timer.current = setTimeout(async () => {
      const v = value.trim();
      setQuery(v);
      const n = (seq.current += 1);
      try {
        const items = await api.get(`/api/members${qs({ q: v })}`);
        if (n === seq.current) setFound({ q: v, items });
      } catch (err) {
        toast(err.message, 'error');
      }
    }, 220);
  };

  return (
    <Loaded state={state}>{(list) => {
      const q = found ? found.q : initialQ;
      const items = found ? found.items : list;
      return (
        <>
          <PageHead
            title="Membres et cartes"
            lead={`${items.length} membre(s)${q ? ' trouvé(s)' : ''}. La carte de membre est nécessaire pour accéder au club.`}
            actions={<button type="button" className="btn btn-primary" onClick={() => openMemberDialog(null, (m) => navigate(`/membres/${m.id}`))}><Icon name="plus" /> Nouveau membre</button>}
            tour="members"
          />
          <form className="toolbar" role="search" onSubmit={(e) => e.preventDefault()}>
            <div className="search" style={{ flex: 1, minWidth: 220 }}><Icon name="search" />
              <input type="search" name="q" value={text} onChange={onInput} placeholder="Nom, téléphone, n° de membre ou de carte" aria-label="Rechercher un membre" autoComplete="off" /></div>
          </form>
          <div id="member-results"><MembersTable items={items} /></div>
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
