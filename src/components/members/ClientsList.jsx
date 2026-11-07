// « Clients réguliers » tab: registered buyers who are not members. Day clients have no file.
import { useEffect, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import Icon from '../ui/Icon.jsx';
import SmartSearch from '../ui/SmartSearch.jsx';
import { Empty, Loaded, PageHead, Segmented } from '../ui/ui.jsx';
import MembersTabs from './MembersTabs.jsx';
import { toast } from '../ui/toast.jsx';
import { api, qs } from '../../lib/api.js';
import { useLoad } from '../../lib/hooks.js';
import { money, dateTime } from '../../lib/format.js';
import { openClientDialog, openConvertClientDialog, openReactivateClientDialog } from '../../dialogs/clientDialogs.jsx';

const STATUTS = [['actifs', 'Actifs'], ['desactives', 'Désactivés']];

function ClientsTable({ items, statut, onConvert, onReactivate }) {
  if (!items.length) {
    return <section className="card"><Empty icon="users">{statut === 'desactives' ? 'Aucun client désactivé.' : 'Aucun client régulier ne correspond.'}</Empty></section>;
  }
  return (
    <section className="card clients-card"><div className="table-wrap"><table className="table stack-sm">
      <thead><tr><th>Client</th><th>Téléphone</th><th className="num">Achats</th><th className="num">Total</th><th className="num">Doit</th><th>Dernier achat</th><th><span className="sr-only">Actions</span></th></tr></thead>
      <tbody>{items.map((c) => (
        <tr key={c.id}>
          <td data-label="Client"><Link to={`/membres/${c.id}`}><strong>{c.name}</strong></Link> <span className="subtle">{c.member_no}</span>
            {c.active === false && <> <span className="chip chip-danger">désactivé</span></>}</td>
          <td data-label="Téléphone" className="nowrap">{c.phone}</td>
          <td data-label="Achats" className="num">{c.purchases_count}</td>
          <td data-label="Total" className="num">{money(c.purchases_total)}</td>
          <td data-label="Doit" className="num">{c.owed ? <strong>{money(c.owed)}</strong> : '—'}</td>
          <td data-label="Dernier achat" className="nowrap nowrap-date">{c.last_purchase_at ? dateTime(c.last_purchase_at) : '—'}</td>
          <td className="actions"><span className="row-actions">
            <Link className="btn btn-sm btn-ghost" to={`/membres/${c.id}`}>Fiche</Link>
            {c.active === false ? (
              <button type="button" className="btn btn-sm" onClick={() => onReactivate(c)}><Icon name="undo" /> Réactiver</button>
            ) : (
              <button type="button" className="btn btn-sm btn-primary" onClick={() => onConvert(c)}>Passer en membre</button>
            )}
          </span></td>
        </tr>
      ))}</tbody>
    </table></div></section>
  );
}

export default function ClientsList() {
  const navigate = useNavigate();
  const state = useLoad(() => api.get('/api/clients'), []);
  const [text, setText] = useState('');
  const [statut, setStatut] = useState('actifs');
  const [found, setFound] = useState(null); // rows once the search box or the filter has been used
  const seq = useRef(0);
  const timer = useRef(null);

  useEffect(() => () => {
    clearTimeout(timer.current);
    seq.current += 1;
  }, []);

  const fetchList = async (q, s) => {
    const n = (seq.current += 1);
    try {
      const items = await api.get(`/api/clients${qs({ q: q.trim(), statut: s })}`);
      if (n === seq.current) setFound({ q: q.trim(), items });
    } catch (err) {
      toast(err.message, 'error');
    }
  };
  const onInput = (value) => {
    setText(value);
    clearTimeout(timer.current);
    timer.current = setTimeout(() => fetchList(value, statut), 220);
  };
  const onStatut = (s) => {
    setStatut(s);
    fetchList(text, s);
  };
  const refresh = () => fetchList(text, statut);

  return (
    <Loaded state={state}>{(list) => {
      const items = found ? found.items : list;
      // What the listed clients owe on credit (their « Compte client »).
      const owedTotal = items.reduce((n, c) => n + (c.owed ?? 0), 0);
      return (
        <>
          <PageHead
            title="Membres / Clients"
            lead={`${items.length} ${items.length > 1 ? 'clients réguliers' : 'client régulier'}${owedTotal ? ` · créances : ${money(owedTotal)}` : ''}`}
            actions={<button type="button" className="btn btn-primary" onClick={() => openClientDialog(null, (c) => navigate(`/membres/${c.id}`))}><Icon name="plus" /> Nouveau client régulier</button>}
          />
          <MembersTabs />
          <form className="toolbar" role="search" onSubmit={(e) => e.preventDefault()}>
            <SmartSearch
              value={text}
              onChange={onInput}
              suggestions={found && found.q === text.trim() ? found.items : []}
              onPick={(c) => navigate(`/membres/${c.id}`)}
              placeholder="Nom, téléphone ou n° de client"
              label="Rechercher un client régulier"
              renderSuggestion={(c) => (
                <div className="grow">
                  <div className="title">{c.name}</div>
                  <div className="meta">{[c.member_no, c.phone].filter(Boolean).join(' · ')}</div>
                </div>
              )}
            />
            <Segmented label="Statut des clients" value={statut} options={STATUTS} onChange={onStatut} />
          </form>
          <p className="subtle">Les clients journaliers n’ont pas de fiche : leurs achats se trouvent dans Caisse › Boutique.</p>
          <ClientsTable
            items={items}
            statut={statut}
            onConvert={(c) => openConvertClientDialog(c, () => refresh())}
            onReactivate={(c) => openReactivateClientDialog(c, refresh)}
          />
        </>
      );
    }}</Loaded>
  );
}
