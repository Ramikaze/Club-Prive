// Demonstration data. Every person and product here is fictitious and flagged as such.
// History is created through the same business methods as real use, with a backdated clock.
// Accounts with known passwords are only created when the caller passes them (local development,
// DEMO_ACCOUNTS=1). Online, an administrator loads the demonstration under their own account.
import { conflict } from './errors.js';
import { addDays, localToUtcMs } from '../shared/time.js';

export const DEMO_ACCOUNTS = [
  { login: 'proprietaire', name: 'Propriétaire A (démo)', role: 'admin', password: 'demo-proprio-2026' },
  { login: 'associe', name: 'Associé B (démo)', role: 'admin', password: 'demo-associe-2026' },
  { login: 'gerant', name: 'Gérant (démo)', role: 'gerant', password: 'demo-gerant-2026' },
];

const HOUR = 3600000;
const DAY = 24 * HOUR;

// `accounts`: DEMO_ACCOUNTS with a `password_hash` each; otherwise `actor` (an administrator) owns
// every demonstration record.
export function seedDemo(club, options = {}) {
  try {
    club.tx(() => fill(club, options));
  } finally {
    club.at = null;
  }
}

function fill(club, { accounts = null, actor = null }) {
  if (!club.isEmpty()) {
    throw conflict('DONNEES_EXISTANTES', 'Des membres, produits ou opérations existent déjà : effacez les données avant de charger la démonstration.');
  }
  const s = club.settings();
  if (!s.demo_mode) throw conflict('MODE_DEMO_INACTIF', 'Activez le mode démonstration dans les paramètres avant de charger les données fictives.');
  const realNow = Date.now();
  const tz = s.timezone;
  let owner = actor;
  let manager = actor;
  if (accounts) {
    const users = accounts.map((u) => club.userRow(club.createUser(null, u).id));
    [owner, , manager] = users;
  }
  const today = club.bizToday();
  const monthly = club.get("SELECT id FROM plans WHERE code = 'MENSUELLE'").id;
  const annual = club.get("SELECT id FROM plans WHERE code = 'ANNUELLE'").id;
  const startOf = (day, time) => localToUtcMs(time < s.hours.open ? addDays(day, 1) : day, time, tz);
  const method = (preferred) => (s.payment_methods.includes(preferred) ? preferred : s.payment_methods[0]);

  // Treasury starting point (fictitious amounts)
  if (!Object.keys(s.opening_balances.amounts).length) {
    club.at = realNow - 75 * DAY;
    club.updateSettings(owner, {
      opening_balances: { date: addDays(today, -75), amounts: { [method('Espèces')]: 150000 * 100, [method('Virement')]: 800000 * 100 } },
    });
  }

  // Catalogue (fictitious; real list and quantities to be supplied)
  club.at = realNow - 70 * DAY;
  const product = (category, name, reference, price, stock, threshold) => club.createProduct(owner, {
    category, name, reference, price: price * 100, initial_stock: stock, low_stock_threshold: threshold,
    description: 'Produit fictif — démonstration',
  }, { demo: true }).id;
  const robusto = product('cigare', 'Robusto (démo)', 'CIG-DEMO-01', 10000, 30, 6);
  const corona = product('cigare', 'Corona (démo)', 'CIG-DEMO-02', 8000, 20, 6);
  product('cigare', 'Churchill (démo)', 'CIG-DEMO-03', 15000, 3, 3);
  const whisky = product('bouteille', 'Whisky 12 ans (démo)', 'BOU-DEMO-01', 40000, 10, 3);
  const champagne = product('bouteille', 'Champagne brut (démo)', 'BOU-DEMO-02', 60000, 6, 2);
  product('bouteille', 'Cognac VSOP (démo)', 'BOU-DEMO-03', 55000, 2, 2);
  product('bouteille', 'Rhum ambré (démo)', 'BOU-DEMO-04', 35000, 0, 1);
  club.at = realNow - 30 * DAY;
  club.stockOperation(manager, whisky, { kind: 'entree', quantity: 4, reason: 'Livraison fournisseur (démo)' });

  // Members (fictitious)
  const member = (first, last, n, createdDaysAgo) => {
    club.at = realNow - createdDaysAgo * DAY;
    return club.createMember(manager, {
      first_name: first, last_name: last, phone: `+000 01 00 00 ${String(n).padStart(2, '0')}`,
      email: `${first.toLowerCase().normalize('NFD').replace(/[^a-z]/g, '')}@exemple.test`,
    }, { demo: true }).id;
  };
  const subscribe = (memberId, planId, startDay, payMethod) => {
    club.at = Math.min(realNow, startOf(startDay, '11:00'));
    const r = club.activateSubscription(manager, memberId, { plan_id: planId, start_date: startDay });
    if (r.charge_id && payMethod) club.recordPayment(manager, { charge_ids: [r.charge_id], method: method(payMethod) });
    return r.subscription_id;
  };
  const card = (memberId, kind, code) => club.issueCard(manager, memberId, { kind, code });

  const albert = member('Albert', 'Exemple', 1, 40);
  const beatrice = member('Béatrice', 'Fictive', 2, 70);
  const charles = member('Charles', 'Démo', 3, 35);
  const diane = member('Diane', 'Test', 4, 60);
  const emile = member('Émile', 'Essai', 5, 10);
  member('Fanny', 'Modèle', 6, 1);
  const gaston = member('Gaston', 'Placeholder', 7, 2);

  subscribe(albert, monthly, addDays(today, -10), 'Espèces');
  card(albert, 'physique', 'CP-DEMO-0001');
  card(albert, 'virtuelle');
  subscribe(beatrice, annual, addDays(today, -60));
  card(beatrice, 'virtuelle');
  subscribe(charles, monthly, addDays(today, -26), 'MTN MoMo');
  card(charles, 'physique', 'CP-DEMO-0003');
  subscribe(diane, monthly, addDays(today, -50), 'Carte bancaire');
  card(diane, 'physique', 'CP-DEMO-0004');
  subscribe(emile, monthly, addDays(today, -6));
  card(emile, 'virtuelle');
  subscribe(gaston, annual, today);
  card(gaston, 'virtuelle');

  // Reservations, moved through their life cycle according to the real current time.
  const book = (memberId, day, time, minutes, extra = {}) => {
    const start = startOf(day, time);
    club.at = Math.min(realNow - HOUR, start - 2 * DAY);
    return club.createReservation(manager, {
      member_id: memberId, date: day, start_time: time, duration_min: minutes,
      authorize_off_hours: extra.offHours ?? false, notes: extra.notes ?? null,
    }).reservation;
  };
  const live = (r, items = [], payMethod = null) => {
    if (r.start_ms <= realNow) {
      club.at = r.start_ms;
      club.startReservation(manager, r.id);
    }
    const itemsAt = r.start_ms + 30 * 60000;
    if (items.length && itemsAt <= realNow) {
      club.at = itemsAt;
      for (const [productId, quantity] of items) club.addItem(manager, r.id, { product_id: productId, quantity });
    }
    if (r.end_ms <= realNow) {
      club.at = r.end_ms;
      club.finishReservation(manager, r.id);
      if (payMethod) {
        const ids = club.all("SELECT id FROM charges WHERE reservation_id = ? AND status = 'due'", r.id).map((x) => x.id);
        if (ids.length) club.recordPayment(manager, { charge_ids: ids, method: method(payMethod) });
      }
    }
  };

  live(book(beatrice, addDays(today, -20), '18:00', 180), [[champagne, 1], [robusto, 2]], 'Carte bancaire');
  live(book(albert, addDays(today, -8), '20:00', 60), [[whisky, 1]], 'Espèces');
  live(book(emile, addDays(today, -3), '19:00', 120), [], null);
  // The example from the brief: 25 000 of room time + 40 000 bottle + 10 000 cigar = 75 000 in one payment.
  live(book(emile, addDays(today, -1), '21:00', 60, { notes: 'Crédit épuisé : heure entièrement payante' }),
    [[whisky, 1], [robusto, 1]], 'Espèces');
  live(book(charles, addDays(today, -1), '15:00', 150), [[corona, 2]], null);
  const cancelled = book(beatrice, addDays(today, -2), '17:00', 120);
  club.at = cancelled.start_ms - DAY;
  club.cancelReservation(manager, cancelled.id, { reason: 'Empêchement du membre (démo)' });

  live(book(beatrice, today, '12:00', 120), [[robusto, 1]], 'Carte bancaire');
  live(book(gaston, today, '16:00', 90), [], null);
  live(book(albert, today, '20:00', 60), [[champagne, 1]], null);
  book(beatrice, addDays(today, 1), '22:00', 210, { offHours: true, notes: 'Soirée privée — dépassement autorisé (démo)' });
  book(gaston, addDays(today, 2), '14:00', 60);
  book(charles, addDays(today, 2), '19:30', 90);

  // Overheads and a bank deposit (fictitious), entered by the owner on their own day.
  const categoryId = (name) => (club.get("SELECT id FROM categories WHERE kind = 'depense' AND active = 1 AND name = ?", name)
    ?? club.get("SELECT id FROM categories WHERE kind = 'depense' AND active = 1 ORDER BY id LIMIT 1"))?.id;
  const entry = (daysAgo, input) => {
    const day = addDays(today, -daysAgo);
    club.at = Math.min(realNow, startOf(day, '11:30'));
    club.createEntry(owner, { biz_date: day, ...input }, { demo: true });
  };
  const expense = (daysAgo, category, amount, payMethod, label, account = null) => {
    const id = categoryId(category);
    if (id) entry(daysAgo, { kind: 'depense', category_id: id, amount: amount * 100, method: method(payMethod), label, account });
  };
  expense(60, 'Loyer', 250000, 'Virement', 'Loyer du salon (démo)');
  expense(45, 'Achats cigares', 90000, 'Espèces', 'Réassort cigares (démo)', 'cigares');
  expense(30, 'Loyer', 250000, 'Virement', 'Loyer du salon (démo)');
  expense(28, 'Achats boissons', 120000, 'Virement', 'Commande de bouteilles (démo)', 'alcool');
  expense(12, 'Électricité et eau', 38000, 'MTN MoMo', 'Facture électricité (démo)');
  expense(5, 'Entretien et réparations', 15000, 'Espèces', 'Entretien de la climatisation (démo)');
  if (method('Espèces') !== method('Virement')) {
    entry(20, { kind: 'transfert', amount: 100000 * 100, method: method('Espèces'), to_method: method('Virement'), label: 'Dépôt en banque (démo)' });
  }

  // Example thresholds and readings, explicitly fictitious; real thresholds are set by the club.
  club.at = realNow - 5 * DAY;
  const reserve = club.createHumidor(owner, {
    name: 'La réserve (démo)', location: 'Arrière-salon', humidity_min: 65, humidity_max: 72,
    temperature_min: 18, temperature_max: 22, reading_interval_hours: 24, notes: 'Seuils fictifs à adapter à votre cave.',
  });
  const salon = club.createHumidor(owner, {
    name: 'Le cabinet du salon (démo)', location: 'Salon privé', humidity_min: 65, humidity_max: 72,
    temperature_min: 18, temperature_max: 22, reading_interval_hours: 12, notes: 'Données de démonstration.',
  });
  for (let i = 5; i >= 0; i -= 1) {
    club.at = realNow - i * DAY - HOUR;
    club.recordHumidorReading(manager, reserve.id, { humidity: 68 + (i % 3) * 0.5, temperature: 20 + (i % 2) * 0.4, notes: 'Contrôle de démonstration' });
    club.recordHumidorReading(manager, salon.id, { humidity: i === 0 ? 74 : 69, temperature: 21, notes: 'Contrôle de démonstration' });
  }
  club.at = realNow - 3 * DAY;
  for (let n = 1; n <= 8; n += 1) {
    const locker = club.createLocker(owner, { code: `A-${String(n).padStart(2, '0')}`, humidor_id: reserve.id });
    if (n <= 3) {
      const detail = club.assignLocker(manager, locker.id, { member_id: [albert, beatrice, charles][n - 1], end_date: addDays(today, n === 3 ? 3 : 30) });
      club.depositLockerItems(manager, detail.assignment_id, { name: 'Collection personnelle (démo)', quantity: n * 6 });
    }
    if (n === 8) club.setLockerAvailability(owner, locker.id, { active: false, reason: 'Entretien du casier (démo)' });
  }
}
