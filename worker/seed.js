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
  { login: 'admin', name: 'Administrateur (local)', role: 'admin', password: 'admin-club-2026' },
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

  // Members: five fictitious clients, numbered in order (Client Test 1 to 5).
  const member = (n, createdDaysAgo) => {
    club.at = realNow - createdDaysAgo * DAY;
    return club.createMember(manager, {
      first_name: 'Client', last_name: `Test ${n}`, phone: `+000 01 00 00 ${String(n).padStart(2, '0')}`,
      email: `client.test${n}@exemple.test`,
    }, { demo: true }).id;
  };
  const subscribe = (memberId, planId, startDay, payMethod) => {
    club.at = Math.min(realNow, startOf(startDay, '11:00'));
    const r = club.activateSubscription(manager, memberId, { plan_id: planId, start_date: startDay });
    if (r.charge_id && payMethod) club.recordPayment(manager, { charge_ids: [r.charge_id], method: method(payMethod) });
    return r.subscription_id;
  };
  const card = (memberId, kind, code) => club.issueCard(manager, memberId, { kind, code });

  const client1 = member(1, 70);
  const client2 = member(2, 60);
  const client3 = member(3, 35);
  const client4 = member(4, 10);
  const client5 = member(5, 2);

  subscribe(client1, monthly, addDays(today, -10), 'Espèces');
  card(client1, 'physique', 'CP-DEMO-0001');
  card(client1, 'virtuelle');
  subscribe(client2, annual, addDays(today, -60));
  card(client2, 'virtuelle');
  subscribe(client3, monthly, addDays(today, -26), 'MTN MoMo');
  card(client3, 'physique', 'CP-DEMO-0003');
  subscribe(client4, monthly, addDays(today, -6));
  card(client4, 'virtuelle');
  subscribe(client5, annual, today);
  card(client5, 'virtuelle');

  // Reservations, moved through their life cycle according to the real current time.
  const roomList = club.rooms();
  const rPrincipal = roomList[0]?.id ?? 1;
  const rVip = roomList[1]?.id ?? rPrincipal;
  const rPetit = roomList[2]?.id ?? rPrincipal;

  const book = (memberId, day, time, minutes, extra = {}) => {
    const start = startOf(day, time);
    club.at = Math.min(realNow - HOUR, start - 2 * DAY);
    return club.createReservation(manager, {
      member_id: memberId, date: day, start_time: time, duration_min: minutes,
      room_id: extra.roomId ?? rPrincipal, party_size: extra.partySize ?? 2,
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

  live(book(client2, addDays(today, -20), '18:00', 180, { roomId: rVip, partySize: 4 }), [[champagne, 1], [robusto, 2]], 'Carte bancaire');
  live(book(client1, addDays(today, -8), '20:00', 60, { roomId: rPrincipal, partySize: 2 }), [[whisky, 1]], 'Espèces');
  live(book(client4, addDays(today, -3), '19:00', 120, { roomId: rPetit, partySize: 2 }), [], null);
  // The example from the brief: 25 000 of room time + 40 000 bottle + 10 000 cigar = 75 000 in one payment.
  live(book(client4, addDays(today, -1), '21:00', 60, { roomId: rPrincipal, partySize: 3, notes: 'Crédit épuisé : heure entièrement payante' }),
    [[whisky, 1], [robusto, 1]], 'Espèces');
  live(book(client3, addDays(today, -1), '15:00', 150, { roomId: rVip, partySize: 4 }), [[corona, 2]], null);
  const cancelled = book(client2, addDays(today, -2), '17:00', 120, { roomId: rPrincipal, partySize: 2 });
  club.at = cancelled.start_ms - DAY;
  club.cancelReservation(manager, cancelled.id, { reason: 'Empêchement du membre (démo)' });

  live(book(client2, today, '12:00', 120, { roomId: rPrincipal, partySize: 3 }), [[robusto, 1]], 'Carte bancaire');
  live(book(client5, today, '16:00', 90, { roomId: rVip, partySize: 4 }), [], null);
  live(book(client1, today, '20:00', 60, { roomId: rPrincipal, partySize: 5 }), [[champagne, 1]], null);
  book(client2, addDays(today, 1), '22:00', 210, { roomId: rVip, partySize: 6, offHours: true, notes: 'Soirée privée — dépassement autorisé (démo)' });
  book(client5, addDays(today, 2), '14:00', 60, { roomId: rPetit, partySize: 2 });
  book(client3, addDays(today, 2), '19:30', 90, { roomId: rPrincipal, partySize: 4 });

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
}
