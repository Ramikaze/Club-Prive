import { HashRouter, Routes, Route, Navigate } from 'react-router-dom';
import AppShell from './components/layout/AppShell.jsx';
import Dashboard from './pages/Dashboard.jsx';
import GeneralLedger from './pages/GeneralLedger.jsx';
import FinancialClose from './pages/FinancialClose.jsx';
import Categories from './pages/Categories.jsx';
import Incomes from './pages/Incomes.jsx';
import Expenses from './pages/Expenses.jsx';

function App() {
  return (
    <HashRouter>
      <Routes>
        <Route path="/" element={<AppShell />}>
          <Route index element={<Navigate to="/dashboard" replace />} />
          <Route path="dashboard" element={<Dashboard />} />
          <Route path="incomes" element={<Incomes />} />
          <Route path="expenses" element={<Expenses />} />
          <Route path="ledger" element={<GeneralLedger />} />
          <Route path="close" element={<FinancialClose />} />
          <Route path="categories" element={<Categories />} />
        </Route>
      </Routes>
    </HashRouter>
  );
}

export default App;
