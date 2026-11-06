// Journal des opérations (/journal, club management): the last operations, for the administrator and the associés.
import AuditTable from '../components/AuditTable.jsx';
import { AdminTabs, Loaded, PageHead } from '../components/ui/ui.jsx';
import { api } from '../lib/api.js';
import { useLoad } from '../lib/hooks.js';

export default function AuditJournal() {
  const state = useLoad(() => api.get('/api/audit?limit=150'), []);
  return (
    <>
      <AdminTabs />
      <PageHead title="Journal des opérations" lead="Les 150 dernières opérations enregistrées dans le club." />
      <Loaded state={state}>{(audit) => (
        <section className="card">
          <AuditTable audit={audit} />
        </section>
      )}</Loaded>
    </>
  );
}
