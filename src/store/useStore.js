import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { isSameDay, isSameWeek, isSameMonth, parseISO } from 'date-fns';

const generateId = () => Math.random().toString(36).substr(2, 9);

// Mock Data
const generateMockData = () => {
  const txs = [];
  let idCounter = 1;
  // Generate data for every day of April 2026
  for (let day = 1; day <= 30; day++) {
    const dateStr = `2026-04-${day.toString().padStart(2, '0')}`;
    
    // PN Income (Every day)
    txs.push({ id: `mock${idCounter++}`, date: dateStr, entityId: 'pn', type: 'income', category: 'Ventes Restaurant', account: 'MTN Momo', amount: Math.floor(400000 + Math.random() * 600000), description: 'Recette journalière', department: 'Cuisine' });
    
    // PN Expense (Every 2 days)
    if (day % 2 === 0) {
      txs.push({ id: `mock${idCounter++}`, date: dateStr, entityId: 'pn', type: 'expense', category: 'Achats Ingrédients', account: 'Espèces', amount: Math.floor(100000 + Math.random() * 200000), description: 'Approvisionnement marché', department: 'Cuisine' });
    }

    // Brazza Income (Every day)
    txs.push({ id: `mock${idCounter++}`, date: dateStr, entityId: 'brazza', type: 'income', category: 'Ventes Bar', account: 'Airtel Money', amount: Math.floor(300000 + Math.random() * 500000), description: 'Recette journalière', department: 'Bar' });
    
    // Brazza Expense (Every 3 days)
    if (day % 3 === 0) {
      txs.push({ id: `mock${idCounter++}`, date: dateStr, entityId: 'brazza', type: 'expense', category: 'Entretien', account: 'Banque', amount: Math.floor(50000 + Math.random() * 100000), description: 'Frais divers', department: 'Opérations' });
    }
  }
  
  // Quelques gros montants fixes pour les salaires en fin de mois
  txs.push({ id: `mock${idCounter++}`, date: '2026-04-28', entityId: 'pn', type: 'expense', category: 'Salaires', account: 'Banque', amount: 2500000, description: 'Salaires PN', department: 'Finance' });
  txs.push({ id: `mock${idCounter++}`, date: '2026-04-28', entityId: 'brazza', type: 'expense', category: 'Salaires', account: 'Banque', amount: 2100000, description: 'Salaires Brazza', department: 'Finance' });

  return txs;
};

const initialTransactions = generateMockData();

const initialCategories = [
  { id: 'c1', name: 'Ventes Restaurant', type: 'income' },
  { id: 'c2', name: 'Ventes Bar', type: 'income' },
  { id: 'c3', name: 'Prestation de services', type: 'income' },
  { id: 'c4', name: 'Achats Ingrédients', type: 'expense' },
  { id: 'c5', name: 'Salaires', type: 'expense' },
  { id: 'c6', name: 'Entretien', type: 'expense' },
  { id: 'c7', name: 'Électricité / Eau', type: 'expense' },
];

export const useStore = create(
  persist(
    (set, get) => ({
      // Multi-Entity Context
      currentEntity: 'global',
      setEntity: (entityId) => set({ currentEntity: entityId }),

      // Multi-Currency
      usdRate: 600, // Variable
      setUsdRate: (rate) => set({ usdRate: rate }),
      eurRate: 655.957, // Fixe

      // Date Filter
      dateFilter: { type: 'all', value: '', start: '', end: '' }, // type: 'all', 'day', 'week', 'month', 'custom'
      setDateFilter: (filter) => set({ dateFilter: filter }),

      // Authentication
      isAuthenticated: false,
      login: (password) => {
        const VALID_PASSWORD = 'meiji2026';
        if (password === VALID_PASSWORD) {
          set({ isAuthenticated: true });
          return true;
        }
        return false;
      },
      logout: () => set({ isAuthenticated: false }),

      // App State
      isLoading: false,

      // Initial Treasury Balances (per entity, editable)
      initialBalances: {
        pn: { 'Espèces': 0, 'Banque': 0, 'MTN Momo': 0, 'Airtel Money': 0 },
        brazza: { 'Espèces': 0, 'Banque': 0, 'MTN Momo': 0, 'Airtel Money': 0 }
      },
      setInitialBalance: (entityId, account, amount) => {
        set((state) => ({
          initialBalances: {
            ...state.initialBalances,
            [entityId]: { ...state.initialBalances[entityId], [account]: Number(amount) }
          }
        }));
      },

      // Financial Close
      closedPeriods: ['2026-03', '2026-04'],
      closePeriod: async (period) => {
        set({ isLoading: true });
        // Simulate Backend Call
        await new Promise(resolve => setTimeout(resolve, 500));
        set((state) => ({ closedPeriods: [...state.closedPeriods, period], isLoading: false }));
      },
      isPeriodClosed: (dateString) => {
        const period = dateString.substring(0, 7);
        return get().closedPeriods.includes(period);
      },

      // General Ledger Transactions (Async Ready)
      transactions: initialTransactions,
      
      fetchTransactions: async () => {
        // Ready for Supabase: const { data } = await supabase.from('transactions').select('*');
        set({ isLoading: true });
        await new Promise(resolve => setTimeout(resolve, 300));
        set({ isLoading: false });
      },

      addTransaction: async (tx) => {
        set({ isLoading: true });
        
        // Simulate Backend Insert
        await new Promise(resolve => setTimeout(resolve, 400));
        
        const newTx = { id: generateId(), ...tx };
        set((state) => ({ 
          transactions: [newTx, ...state.transactions],
          isLoading: false 
        }));
      },

      deleteTransaction: async (id) => {
        set({ isLoading: true });
        // Simulate Backend Delete
        await new Promise(resolve => setTimeout(resolve, 400));
        set((state) => ({
          transactions: state.transactions.filter(t => t.id !== id),
          isLoading: false
        }));
      },

      deleteTransactions: async (ids) => {
        set({ isLoading: true });
        // Simulate Backend Delete
        await new Promise(resolve => setTimeout(resolve, 400));
        set((state) => ({
          transactions: state.transactions.filter(t => !ids.includes(t.id)),
          isLoading: false
        }));
      },

      // Categories Management
      categories: initialCategories,
      
      addCategory: async (category) => {
        set({ isLoading: true });
        await new Promise(resolve => setTimeout(resolve, 300));
        const newCat = { id: generateId(), ...category };
        set((state) => ({ categories: [...state.categories, newCat], isLoading: false }));
      },

      updateCategory: async (id, updatedFields) => {
        set({ isLoading: true });
        await new Promise(resolve => setTimeout(resolve, 300));
        set((state) => ({
          categories: state.categories.map(c => c.id === id ? { ...c, ...updatedFields } : c),
          isLoading: false
        }));
      },

      deleteCategory: async (id) => {
        set({ isLoading: true });
        await new Promise(resolve => setTimeout(resolve, 300));
        set((state) => ({
          categories: state.categories.filter(c => c.id !== id),
          isLoading: false
        }));
      },

      // Selectors
      getFilteredTransactions: (entityId = get().currentEntity) => {
        const { transactions, dateFilter } = get();
        let filtered = transactions;
        
        if (entityId !== 'global') {
          filtered = filtered.filter(t => t.entityId === entityId);
        }

        if (dateFilter.type !== 'all') {
          filtered = filtered.filter(t => {
            const txDate = parseISO(t.date);
            if (dateFilter.type === 'custom') {
              if (dateFilter.start && dateFilter.end) {
                const txTime = txDate.getTime();
                const sTime = new Date(dateFilter.start).getTime();
                const eTime = new Date(dateFilter.end).getTime();
                return txTime >= sTime && txTime <= eTime;
              }
              return true;
            }
            if (dateFilter.value) {
              const filterDate = new Date(dateFilter.value);
              if (dateFilter.type === 'day') return isSameDay(txDate, filterDate);
              if (dateFilter.type === 'week') return isSameWeek(txDate, filterDate, { weekStartsOn: 1 });
              if (dateFilter.type === 'month') return isSameMonth(txDate, filterDate);
            }
            return true;
          });
        }

        return filtered;
      },

      getKPIs: (entityId = get().currentEntity) => {
        const txs = get().getFilteredTransactions(entityId);
        let income = 0;
        let expense = 0;
        txs.forEach(t => {
          if (t.type === 'income') income += t.amount;
          if (t.type === 'expense') expense += t.amount;
        });
        return { income, expense, net: income - expense };
      },

      getCashBalances: (entityId = get().currentEntity) => {
        // For balances, we use ALL transactions (not date-filtered) to get true balance
        const { transactions, initialBalances } = get();
        let allTxs = transactions;
        if (entityId !== 'global') {
          allTxs = allTxs.filter(t => t.entityId === entityId);
        }
        const balances = {
          'Espèces': 0,
          'Banque': 0,
          'MTN Momo': 0,
          'Airtel Money': 0
        };

        allTxs.forEach(t => {
          if (balances[t.account] !== undefined) {
            balances[t.account] += t.type === 'income' ? t.amount : -t.amount;
          }
        });

        // Add initial balances
        const accounts = ['Espèces', 'Banque', 'MTN Momo', 'Airtel Money'];
        if (entityId === 'global') {
          accounts.forEach(acc => {
            balances[acc] += (initialBalances.pn[acc] || 0) + (initialBalances.brazza[acc] || 0);
          });
        } else {
          accounts.forEach(acc => {
            balances[acc] += (initialBalances[entityId]?.[acc] || 0);
          });
        }

        return balances;
      },

      getTransactionsByAccount: (accountName) => {
        const txs = get().getFilteredTransactions();
        return txs.filter(t => t.account === accountName);
      }
    }),
    {
      name: 'meiji-business-storage',
      partialize: (state) => ({
        transactions: state.transactions,
        categories: state.categories,
        closedPeriods: state.closedPeriods,
        usdRate: state.usdRate,
        initialBalances: state.initialBalances,
        isAuthenticated: state.isAuthenticated,
      }),
    }
  )
);

// Currency Formatters
export const formatFCFA = (amount) => {
  return new Intl.NumberFormat('fr-FR', { style: 'currency', currency: 'XAF', minimumFractionDigits: 0 }).format(amount);
};

export const formatEUR = (amount) => {
  const eur = amount / 655.957;
  return new Intl.NumberFormat('fr-FR', { style: 'currency', currency: 'EUR', minimumFractionDigits: 2 }).format(eur);
};

export const formatUSD = (amount, rate) => {
  const usd = amount / rate;
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 2 }).format(usd);
};
