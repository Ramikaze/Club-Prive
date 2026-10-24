import { Link, useSearchParams } from 'react-router-dom';
import Icon from '../components/ui/Icon.jsx';
import { AccountTag, CashTabs, Empty, Loaded, PageHead, Segmented } from '../components/ui/ui.jsx';
import { DateInput } from '../components/ui/PeriodPicker.jsx';
import { api, qs } from '../lib/api.js';
import { ACCOUNT_LABEL, bizToday, dateTime, dayLabel, money } from '../lib/format.js';
import { useBusy, useLoad } from '../lib/hooks.js';
import { useIsAdmin, useSettings } from '../store/useStore.js';
import { downloadExcel } from '../utils/exportExcel.js';
import { openPaymentDialog } from '../dialogs/index.js';
import { addDays, isValidDate } from '../../shared/time.js';

function Ventilation({ byAccount }) {
  return Object.entries(byAccount).filter(([, v]) => v).map(([k, v]) => (
    <span key={k} className="nowrap" style={{ marginRight: 10 }}><i className={`dot dot-${k}`} /> {ACCOUNT_LABEL[k]} {money(v)}</span>
  ));
}

function JournalTable({ payments }) {
  if (!payments.length) return <Empty icon="wallet">Aucun encaissement sur la période.</Empty>;
  return (
    <div className="table-wrap"><table className="table stack-sm">
      <thead><tr><th>Date</th><th>N°</th><th>Membre</th><th>Moyen</th><th>Ventilation</th><th className="num">Total</th><th>Par</th><th><span className="sr-only">Ticket</span></th></tr></thead>
      <tbody>{payments.map((p) => (
        <tr key={p.id}>
          <td data-label="Date" className="nowrap">{dateTime(p.paid_at)}</td>
          <td data-label="N°">{p.reservation_id ? <Link to={`/reservations/${p.reservation_id}`}>{p.id}</Link> : p.id}</td>
          <td data-label="Membre"><Link to={`/membres/${p.member_id}`}>{p.member_name}</Link></td>
          <td data-label="Moyen">{p.method}{p.reference && <> <span className="subtle">{p.reference}</span></>}</td>
          <td data-label="Ventilation"><Ventilation byAccount={p.by_account} /></td>
          <td data-label="Total" className="num"><strong>{money(p.amount)}</strong></td>
          <td data-label="Par">{p.created_by_name ?? ''}</td>
          <td className="num"><Link className="btn btn-sm" to={`/caisse/ticket/${p.id}`}>Ticket</Link></td>
        </tr>
      ))}</tbody>
    </table></div>
  );
}

function RefundsTable({ refunds }) {
  if (!refunds.length) return <Empty icon="check">Aucun remboursement sur la période.</Empty>;
  return (
    <div className="table-wrap"><table className="table stack-sm">
      <thead><tr><th>Date</th><th>Membre</th><th>Ligne</th><th>Sous-compte</th><th className="num">Montant</th><th>Motif</th><th>Par</th></tr></thead>
      <tbody>{refunds.map((r) => (
        <tr key={r.id}>
          <td data-label="Date" className="nowrap">{dateTime(r.created_at)}</td>
          <td data-label="Membre">{r.member_name}</td>
          <td data-label="Ligne">{r.reservation_id ? <Link to={`/reservations/${r.reservation_id}`}>{r.label}</Link> : r.label}</td>
          <td data-label="Sous-compte"><AccountTag account={r.account} /></td>
          <td data-label="Montant" className="num">{money(r.amount)}</td>
          <td data-label="Motif">{r.reason}</td>
          <td data-label="Par">{r.created_by_name ?? ''}</td>
        </tr>
      ))}</tbody>
    </table></div>
  );
}

function OpenTable({ groups, onPay }) {
  if (!groups.length) return <Empty icon="check">Aucune somme en attente.</Empty>;
  return (
    <div className="list">{groups.map((g) => (
      <div key={g.member_id} className="list-item">
        <div className="grow"><div className="title"><Link to={`/membres/${g.member_id}`}>{g.member_name}</Link> <span className="subtle">{g.member_no}</span></div>
          <div className="meta">{g.lines.length} ligne(s) · <Ventilation byAccount={g.by_account} /></div></div>
        <strong className="num">{money(g.total)}</strong>
        <button type="button" className="btn btn-sm btn-primary" onClick={() => onPay(g)}>Encaisser</button>
      </div>
    ))}</div>
  );
}

function AccountCard({ a, total = false }) {
  return (
    <div className={`account-card ${total ? 'total' : ''}`}>
      <h3>{total ? 'Total' : <><i className={`dot dot-${a.account}`} /> {a.label}</>}</h3>
      <div className="big">{money(a.net)}</div>
      <div className="calc-line"><span>Facturé (dû)</span><span>{money(a.billed)}</span></div>
      <div className="calc-line"><span>Encaissé</span><span>{money(a.collected)}</span></div>
      <div className="calc-line"><span>Remboursé</span><span>{money(a.refunded)}</span></div>
      <div className="calc-line"><span>Net encaissé</span><span>{money(a.net)}</span></div>
      <div className="calc-line"><span>Reste à payer</span><span>{money(a.outstanding)}</span></div>
      {a.cancelled ? <div className="calc-line"><span>Annulé</span><span>{money(a.cancelled)}</span></div> : null}
    </div>
  );
}

// The page's period: a preset, or the dates chosen in « Du » and « au » (one day or several). Chosen dates that
// match a preset show that preset selected.
function periodFor(query) {
  const today = bizToday();
  const first = `${today.slice(0, 8)}01`;
  const lastMonthEnd = addDays(first, -1);
  const presets = {
    jour: [today, today],
    semaine: [addDays(today, -6), today],
    mois: [first, today],
    'mois-precedent': [`${lastMonthEnd.slice(0, 8)}01`, lastMonthEnd],
  };
  if (query.p === 'perso' && isValidDate(query.du) && isValidDate(query.au) && query.du <= query.au) {
    const same = Object.keys(presets).find((k) => presets[k][0] === query.du && presets[k][1] === query.au);
    return { p: same ?? 'perso', from: query.du, to: query.au };
  }
  const p = Object.hasOwn(presets, query.p ?? '') ? query.p : 'jour';
  return { p, from: presets[p][0], to: presets[p][1] };
}

const payGroup = (g, onDone) => openPaymentDialog({ lines: g.lines, memberName: g.member_name }, onDone);

function ManagerCash() {
  const state = useLoad(() => Promise.all([api.get('/api/finance/journal'), api.get('/api/finance/open')]), []);
  return (
    <Loaded state={state}>{([journal, open]) => {
      const by = { reservations: 0, alcool: 0, cigares: 0 };
      for (const p of journal.payments) for (const [k, v] of Object.entries(p.by_account)) by[k] += v;
      for (const r of journal.refunds) by[r.account] -= r.amount;
      const total = by.reservations + by.alcool + by.cigares;
      return (
        <>
          <CashTabs />
          <PageHead title="Encaissements" lead={`Caisse du ${dayLabel(journal.from, 'title')}`} tour="cash" />
          <div className="account-cards" style={{ marginBottom: 16 }}>
            {Object.entries(by).map(([k, v]) => (
              <div key={k} className="account-card"><h3><i className={`dot dot-${k}`} /> {ACCOUNT_LABEL[k]}</h3><div className="big">{money(v)}</div><div className="subtle">net encaissé aujourd’hui</div></div>
            ))}
            <div className="account-card total"><h3>Total</h3><div className="big">{money(total)}</div><div className="calc-line"><span>{journal.payments.length} encaissement(s)</span><span /></div></div>
          </div>
          <div className="grid">
            <section className="card"><div className="card-head"><h2>Reste à encaisser</h2></div><OpenTable groups={open} onPay={(g) => payGroup(g, state.reload)} /></section>
            <section className="card"><div className="card-head"><h2>Encaissements du jour</h2></div><JournalTable payments={journal.payments} /></section>
            {journal.refunds.length > 0 && <section className="card"><div className="card-head"><h2>Remboursements du jour</h2></div><RefundsTable refunds={journal.refunds} /></section>}
          </div>
        </>
      );
    }}</Loaded>
  );
}

const PRESETS = [['jour', 'Aujourd’hui'], ['semaine', '7 jours'], ['mois', 'Mois en cours'], ['mois-precedent', 'Mois précédent']];
const EXPORTS = [['synthese', 'Synthèse'], ['lignes', 'Lignes facturées'], ['encaissements', 'Encaissements'],
  ['remboursements', 'Remboursements'], ['reservations', 'Réservations'], ['stock', 'Mouvements de stock']];

function AdminCash() {
  const settings = useSettings();
  const [searchParams, setSearchParams] = useSearchParams();
  const query = Object.fromEntries(searchParams);
  const { p, from, to } = periodFor(query);
  const account = ['reservations', 'alcool', 'cigares'].includes(query.compte) ? query.compte : '';
  const setQuery = (q) => setSearchParams(Object.fromEntries(Object.entries(q).filter(([, v]) => v !== undefined && v !== null && v !== '')));
  const excel = useBusy();
  const csv = useBusy();

  const state = useLoad(() => Promise.all([
    api.get(`/api/finance/summary${qs({ from, to })}`),
    api.get(`/api/finance/journal${qs({ from, to })}`),
    api.get('/api/finance/open'),
  ]), [from, to]);

  // « Du » and « au » apply as soon as a date is chosen, in either order. While one day is shown, a date chosen
  // in « Du » shows that day instead; « au » then widens it into several days.
  const setDates = (du, au) => setQuery({ p: 'perso', du: du <= au ? du : au, au: du <= au ? au : du, compte: account });
  const exportLink = (kind, label) => (
    <span key={kind} className="row">
      <button type="button" className="btn btn-sm" disabled={csv.busy} aria-busy={csv.busy}
        onClick={() => csv.run(() => api.download(`/api/export/${kind}${qs({ from, to, account })}`))}>
        <Icon name="download" /> {label}</button>
      <button type="button" className="btn btn-sm" title={`${label} (Excel)`} disabled={excel.busy} aria-busy={excel.busy}
        onClick={() => excel.run(() => downloadExcel([{ kind, params: { from, to, account } }]))}>
        <Icon name="excel" /> Excel<span className="sr-only"> : {label}</span></button>
    </span>
  );

  return (
    <Loaded state={state}>{([sum, journal, open]) => (
      <>
        <CashTabs />
        <PageHead
          title="Encaissements & Notes"
          lead={`${from === to ? dayLabel(from, 'title') : `Du ${dayLabel(from, 'medium')} au ${dayLabel(to, 'medium')}`}`}
          tour="cash"
        />
        <div className="toolbar">
          <Segmented label="Période" value={p} options={PRESETS} onChange={(k) => setQuery({ p: k, compte: account })} />
          <div className="date-nav">
            <label className="row"><span className="subtle">Du</span>
              <DateInput value={from} max={bizToday()} aria-label="Début de la période" onCommit={(d) => setDates(d, from === to ? d : to)} /></label>
            <label className="row"><span className="subtle">au</span>
              <DateInput value={to} max={bizToday()} aria-label="Fin de la période" onCommit={(d) => setDates(from, d)} /></label>
          </div>
        </div>

        <div className="account-cards">
          {sum.accounts.map((a) => <AccountCard key={a.account} a={a} />)}
          <AccountCard a={sum.total} total />
        </div>

        <div className="grid-2 section-gap">
          <section className="card">
            <div className="card-head"><h2>Exports CSV</h2></div>
            <div className="form-grid">
              <label className="field"><span>Sous-compte</span>
                <select value={account} onChange={(e) => setQuery({ p, du: from, au: to, compte: e.target.value })}>
                  <option value="">Tous les sous-comptes</option>
                  {Object.entries(ACCOUNT_LABEL).map(([k, label]) => <option key={k} value={k}>{label}</option>)}
                </select></label>
              <div className="row">{EXPORTS.map(([kind, label]) => exportLink(kind, label))}</div>
              <p className="subtle">Format CSV (séparateur « ; »), lisible dans Excel ou LibreOffice. Les montants sont exprimés en {settings.currency.label}.</p>
            </div>
          </section>
          <section className="card">
            <div className="card-head"><h2>Par moyen de paiement</h2></div>
            {sum.methods.length ? (
              <dl className="calc">{sum.methods.map((x) => (
                <div key={x.method}><dt>{x.method} <span className="subtle">({x.n})</span></dt><dd>{money(x.total)}</dd></div>
              ))}</dl>
            ) : <Empty icon="wallet">Aucun encaissement sur la période.</Empty>}
          </section>
          <section className="card span-2"><div className="card-head"><h2>Reste à encaisser</h2><span className="subtle">toutes périodes</span></div><OpenTable groups={open} onPay={(g) => payGroup(g, state.reload)} /></section>
          <section className="card span-2"><div className="card-head"><h2>Journal des encaissements</h2></div><JournalTable payments={journal.payments} /></section>
          <section className="card span-2"><div className="card-head"><h2>Remboursements</h2></div><RefundsTable refunds={journal.refunds} /></section>
        </div>
      </>
    )}</Loaded>
  );
}

export default function Cash() {
  const admin = useIsAdmin();
  return admin ? <AdminCash /> : <ManagerCash />;
}
