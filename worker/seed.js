// Demonstration data. Every person and product here is fictitious and flagged as such.
// History is created through the same business methods as real use, with a backdated clock.
// It is only loaded into the demo space (club.demo), under the author the caller passes.
// The accounts below have known passwords: only local development creates them (DEMO_ACCOUNTS=1),
// and without any data.
import { AppError, conflict } from './errors.js';
import { addDays, fmtHHMM, localParts, localToUtcMs, parseHHMM } from '../shared/time.js';
import { minDurationFor } from '../shared/rules.js';

export const DEMO_ACCOUNTS = [
  { login: 'proprietaire', name: 'Propriétaire A (démo)', role: 'admin', password: 'demo-proprio-2026' },
  { login: 'associe', name: 'Associé B (démo)', role: 'admin', password: 'demo-associe-2026' },
  { login: 'gerant', name: 'Gérant (démo)', role: 'gerant', password: 'demo-gerant-2026' },
  { login: 'admin', name: 'Administrateur (local)', role: 'admin', password: 'admin-club-2026' },
];

const HOUR = 3600000;
const DAY = 24 * HOUR;

// `actor`: the full `users` row of the author, an administrator, who owns every demonstration record.
// `catalogue`: the real club's products (Club.demoConfig), which the demo space shows beside the fictitious ones.
export function seedDemo(club, { actor, catalogue = [] }) {
  try {
    club.tx(() => fill(club, { actor, catalogue }));
  } finally {
    club.at = null;
  }
}

function fill(club, { actor, catalogue }) {
  if (!club.isEmpty()) {
    throw conflict('DONNEES_EXISTANTES', 'Des membres, produits ou opérations existent déjà : effacez les données avant de charger la démonstration.');
  }
  const s = club.settings();
  if (!s.demo_mode) throw conflict('MODE_DEMO_INACTIF', "Les données fictives ne se chargent que dans l'espace démo.");
  const realNow = Date.now();
  const tz = s.timezone;
  const slot = s.booking.slot_min;
  const owner = actor;
  const manager = actor;
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

  // Catalogue: the real club's products first, under the ids and the references they have there (the manager
  // trains with the references he sees for real), then the fictitious ones below, which take the ids that follow.
  // The history sells the fictitious ones only.
  club.at = realNow - 70 * DAY;
  club.copyCatalogue(catalogue, owner);
  // A fictitious product wants a reference of its series (CIG-DEMO-01...). A real product may hold it already, in
  // whatever case, and so may a fictitious one made before: it then takes the next free number of its series.
  const freeReference = (wanted) => {
    const [, series, digits] = /^(.*?)(\d+)$/.exec(wanted);
    let number = Number(digits);
    let reference = wanted;
    while (club.get('SELECT 1 AS x FROM products WHERE reference = ?', reference)) {
      number += 1;
      reference = `${series}${String(number).padStart(digits.length, '0')}`;
    }
    return reference;
  };
  const product = (category, name, reference, price, stock, threshold) => club.createProduct(owner, {
    category, name, reference: freeReference(reference), price: price * 100, initial_stock: stock, low_stock_threshold: threshold,
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

  // Reservations, moved through their life cycle according to the real current time. The club has a
  // single room: every booking goes to the first open one.
  const room = club.rooms()[0];
  const roomId = room?.id ?? 1;

  // A booking on a Friday or Saturday evening is lengthened to that minimum (2 h by default). Whatever
  // the club's settings, a duration is a whole number of slots (rounded down) and the party fits the room.
  const book = (memberId, day, time, minutes, extra = {}) => {
    const start = startOf(day, time);
    const startRel = time < s.hours.open ? parseHHMM(time) + 1440 : parseHHMM(time);
    club.at = Math.min(realNow - HOUR, start - 2 * DAY);
    return club.createReservation(manager, {
      member_id: memberId, date: day, start_time: time,
      duration_min: Math.max(Math.floor(minutes / slot) * slot, minDurationFor(s.booking, day, startRel)),
      room_id: roomId, party_size: Math.min(extra.partySize ?? 2, room?.capacity ?? Infinity), notes: extra.notes ?? null,
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

  // A booking the room refuses is left out and the demo fills all the same: the room held by the session in
  // progress, or two of the seed's own bookings closer than the club's gap between bookings (up to 4 hours).
  const unlessTaken = (create) => {
    try {
      create();
    } catch (err) {
      if (!(err instanceof AppError)) throw err;
    }
  };

  live(book(client2, addDays(today, -20), '18:00', 180, { partySize: 4 }), [[champagne, 1], [robusto, 2]], 'Carte bancaire');
  live(book(client1, addDays(today, -8), '20:00', 60, { partySize: 2 }), [[whisky, 1]], 'Espèces');
  live(book(client4, addDays(today, -3), '19:00', 120, { partySize: 2 }), [], null);
  // The example from the brief: 25 000 of room time + 40 000 bottle + 10 000 cigar = 75 000 in one payment.
  unlessTaken(() => live(book(client4, addDays(today, -1), '21:00', 60, { partySize: 3, notes: 'Crédit épuisé : heure entièrement payante' }),
    [[whisky, 1], [robusto, 1]], 'Espèces'));
  // Ending 3 h 30 before the one above (15:00-17:30): a gap between bookings beyond that leaves this one out.
  unlessTaken(() => live(book(client3, addDays(today, -1), '15:00', 150, { partySize: 4 }), [[corona, 2]], null));
  const cancelled = book(client2, addDays(today, -2), '17:00', 120, { partySize: 2 });
  club.at = cancelled.start_ms - DAY;
  club.cancelReservation(manager, cancelled.id, { reason: 'Empêchement du membre (démo)' });

  // A session already running when the demonstration is loaded, whatever the hour (the club has
  // no opening hours), so the room timer and the per-member breakdown show at once: started about
  // 45 minutes ago, two members present, each with cigars and a bottle. Created before today's
  // other bookings, which give way to it in the single room.
  const win = club.window();
  const ago = localParts(realNow - 45 * 60000, tz);
  const startMin = ago.minutes - (ago.minutes % slot);
  const date = startMin < win.open ? addDays(ago.date, -1) : ago.date;
  const time = fmtHHMM(startMin);
  const pairs = [[client1, client2], [client3, client5], [client4, client2], [client1, client5]];
  const inRoom = (() => {
    const start = startOf(date, time);
    for (const [holder, guest] of pairs) {
      club.at = start - 30 * 60000;
      try {
        const r = club.createReservation(manager, {
          member_id: holder, attendee_ids: [guest], date, start_time: time, duration_min: 120,
          room_id: roomId, party_size: 2,
        }).reservation;
        return { r, holder, guest };
      } catch (err) {
        if (!(err instanceof AppError)) throw err; // a member without credit or busy: try the next pair
      }
    }
    return null;
  })();
  if (inRoom) {
    const { r, holder, guest } = inRoom;
    club.at = r.start_ms;
    club.startReservation(manager, r.id);
    // Served within the elapsed time, so both members have cigars and a bottle even in a young session.
    const served = [[10, holder, robusto, 1], [20, holder, whisky, 1], [25, guest, corona, 2], [35, guest, champagne, 1]];
    served.forEach(([afterMin, consumer, productId, quantity], i) => {
      club.at = r.start_ms + Math.min(afterMin * 60000, ((realNow - r.start_ms) * (i + 1)) / (served.length + 1));
      club.addItem(manager, r.id, { product_id: productId, quantity, consumer_member_id: consumer });
    });
  }

  // Today's and later bookings, skipped where the session in progress already holds the room.
  unlessTaken(() => live(book(client2, today, '12:00', 120, { partySize: 3 }), [[robusto, 1]], 'Carte bancaire'));
  unlessTaken(() => live(book(client5, today, '16:00', 90, { partySize: 4 }), [], null));
  unlessTaken(() => live(book(client1, today, '20:00', 60, { partySize: 5 }), [[champagne, 1]], null));
  unlessTaken(() => book(client2, addDays(today, 1), '22:00', 210, { partySize: 6, notes: 'Soirée privée jusque tard dans la nuit (démo)' }));
  unlessTaken(() => book(client5, addDays(today, 2), '14:00', 60, { partySize: 2 }));
  unlessTaken(() => book(client3, addDays(today, 2), '19:30', 90, { partySize: 4 }));

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
