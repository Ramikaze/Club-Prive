// Database schema. Amounts are integers in hundredths of the currency unit (exact arithmetic).
// Credits are minutes. Timestamps are ISO-8601 UTC strings; business days are 'YYYY-MM-DD'.
// MIGRATIONS[n] brings the schema from version n to n + 1. Each statement runs on its own: the
// Durable Object storage takes one statement per call and has no PRAGMA user_version.
const V1 = [
  `CREATE TABLE users (
    id INTEGER PRIMARY KEY,
    login TEXT NOT NULL UNIQUE COLLATE NOCASE,
    name TEXT NOT NULL,
    role TEXT NOT NULL CHECK (role IN ('admin', 'gerant')),
    password_hash TEXT NOT NULL,
    active INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0, 1)),
    created_at TEXT NOT NULL,
    created_by INTEGER REFERENCES users(id),
    last_login_at TEXT
  )`,

  `CREATE TABLE sessions (
    token_hash TEXT PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id),
    created_at TEXT NOT NULL,
    expires_at TEXT NOT NULL
  )`,

  `CREATE TABLE settings (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    updated_by INTEGER REFERENCES users(id)
  )`,

  `CREATE TABLE plans (
    id INTEGER PRIMARY KEY,
    code TEXT NOT NULL UNIQUE,
    name TEXT NOT NULL,
    duration_months INTEGER NOT NULL CHECK (duration_months BETWEEN 1 AND 36),
    included_minutes INTEGER NOT NULL CHECK (included_minutes >= 0),
    price INTEGER CHECK (price IS NULL OR price >= 0),
    price_validated INTEGER NOT NULL DEFAULT 0 CHECK (price_validated IN (0, 1)),
    price_validated_by INTEGER REFERENCES users(id),
    price_validated_at TEXT,
    price_note TEXT,
    active INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0, 1)),
    updated_at TEXT,
    updated_by INTEGER REFERENCES users(id)
  )`,

  `CREATE TABLE members (
    id INTEGER PRIMARY KEY,
    member_no TEXT NOT NULL UNIQUE,
    first_name TEXT NOT NULL,
    last_name TEXT NOT NULL,
    phone TEXT NOT NULL,
    email TEXT,
    notes TEXT,
    is_demo INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL,
    created_by INTEGER REFERENCES users(id),
    updated_at TEXT,
    updated_by INTEGER REFERENCES users(id)
  )`,

  `CREATE TABLE subscriptions (
    id INTEGER PRIMARY KEY,
    member_id INTEGER NOT NULL REFERENCES members(id),
    plan_id INTEGER NOT NULL REFERENCES plans(id),
    plan_name TEXT NOT NULL,
    duration_months INTEGER NOT NULL,
    start_date TEXT NOT NULL,
    end_date TEXT NOT NULL,
    included_minutes INTEGER NOT NULL CHECK (included_minutes >= 0),
    allocation_mode TEXT NOT NULL CHECK (allocation_mode IN ('activation', 'mensuelle')),
    price INTEGER,
    price_validated INTEGER NOT NULL,
    status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'annulee')),
    renewal_of INTEGER REFERENCES subscriptions(id),
    created_at TEXT NOT NULL,
    created_by INTEGER REFERENCES users(id),
    cancelled_at TEXT,
    cancelled_by INTEGER REFERENCES users(id),
    cancel_reason TEXT,
    CHECK (end_date >= start_date)
  )`,
  'CREATE INDEX subscriptions_member ON subscriptions(member_id, start_date)',

  `CREATE TABLE cards (
    id INTEGER PRIMARY KEY,
    member_id INTEGER NOT NULL REFERENCES members(id),
    kind TEXT NOT NULL CHECK (kind IN ('physique', 'virtuelle')),
    code TEXT NOT NULL UNIQUE,
    status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'desactivee')),
    issued_at TEXT NOT NULL,
    issued_by INTEGER REFERENCES users(id),
    deactivated_at TEXT,
    deactivated_by INTEGER REFERENCES users(id),
    deactivation_reason TEXT
  )`,
  'CREATE INDEX cards_member ON cards(member_id)',

  `CREATE TABLE reservations (
    id INTEGER PRIMARY KEY,
    member_id INTEGER NOT NULL REFERENCES members(id),
    subscription_id INTEGER NOT NULL REFERENCES subscriptions(id),
    biz_day TEXT NOT NULL,
    start_ms INTEGER NOT NULL,
    end_ms INTEGER NOT NULL,
    duration_min INTEGER NOT NULL CHECK (duration_min > 0),
    status TEXT NOT NULL CHECK (status IN ('reservee', 'en_cours', 'terminee', 'annulee')),
    included_minutes INTEGER NOT NULL DEFAULT 0 CHECK (included_minutes >= 0),
    paid_minutes INTEGER NOT NULL DEFAULT 0 CHECK (paid_minutes >= 0),
    supplement_amount INTEGER NOT NULL DEFAULT 0 CHECK (supplement_amount >= 0),
    tariff_hour INTEGER NOT NULL,
    tariff_half INTEGER NOT NULL,
    tariff_validated INTEGER NOT NULL,
    off_hours INTEGER NOT NULL DEFAULT 0,
    off_hours_authorized_by INTEGER REFERENCES users(id),
    notes TEXT,
    created_at TEXT NOT NULL,
    created_by INTEGER REFERENCES users(id),
    updated_at TEXT,
    updated_by INTEGER REFERENCES users(id),
    started_at TEXT,
    started_by INTEGER REFERENCES users(id),
    finished_at TEXT,
    finished_by INTEGER REFERENCES users(id),
    cancelled_at TEXT,
    cancelled_by INTEGER REFERENCES users(id),
    cancel_reason TEXT,
    CHECK (end_ms > start_ms),
    CHECK (included_minutes + paid_minutes = duration_min)
  )`,
  'CREATE INDEX reservations_time ON reservations(start_ms, end_ms)',
  'CREATE INDEX reservations_day ON reservations(biz_day)',
  'CREATE INDEX reservations_member ON reservations(member_id)',

  // Single room: no two active occupations may overlap. Enforced by the database itself,
  // in addition to the application check, so concurrent writers cannot double-book.
  `CREATE TRIGGER reservations_no_overlap_insert BEFORE INSERT ON reservations
  WHEN NEW.status <> 'annulee'
  BEGIN
    SELECT RAISE(ABORT, 'CHEVAUCHEMENT') WHERE EXISTS (
      SELECT 1 FROM reservations r
      WHERE r.status <> 'annulee' AND r.start_ms < NEW.end_ms AND NEW.start_ms < r.end_ms);
  END`,

  `CREATE TRIGGER reservations_no_overlap_update BEFORE UPDATE OF start_ms, end_ms, status ON reservations
  WHEN NEW.status <> 'annulee'
  BEGIN
    SELECT RAISE(ABORT, 'CHEVAUCHEMENT') WHERE EXISTS (
      SELECT 1 FROM reservations r
      WHERE r.id <> NEW.id AND r.status <> 'annulee' AND r.start_ms < NEW.end_ms AND NEW.start_ms < r.end_ms);
  END`,

  // Credit ledger. available = granted - (engagement - liberation); consumed = consommation.
  `CREATE TABLE credit_movements (
    id INTEGER PRIMARY KEY,
    subscription_id INTEGER NOT NULL REFERENCES subscriptions(id),
    reservation_id INTEGER REFERENCES reservations(id),
    kind TEXT NOT NULL CHECK (kind IN ('engagement', 'liberation', 'consommation', 'ajustement')),
    minutes INTEGER NOT NULL CHECK (minutes <> 0),
    reason TEXT,
    created_at TEXT NOT NULL,
    created_by INTEGER REFERENCES users(id)
  )`,
  'CREATE INDEX credit_movements_sub ON credit_movements(subscription_id)',
  'CREATE INDEX credit_movements_res ON credit_movements(reservation_id)',

  `CREATE TABLE products (
    id INTEGER PRIMARY KEY,
    category TEXT NOT NULL CHECK (category IN ('cigare', 'bouteille')),
    name TEXT NOT NULL,
    reference TEXT NOT NULL UNIQUE COLLATE NOCASE,
    description TEXT,
    price INTEGER NOT NULL CHECK (price >= 0),
    stock_qty INTEGER NOT NULL DEFAULT 0 CHECK (stock_qty >= 0),
    low_stock_threshold INTEGER NOT NULL DEFAULT 3 CHECK (low_stock_threshold >= 0),
    active INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0, 1)),
    is_demo INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL,
    created_by INTEGER REFERENCES users(id),
    updated_at TEXT,
    updated_by INTEGER REFERENCES users(id)
  )`,

  // Financial lines. Each line belongs to exactly one sub-account.
  `CREATE TABLE charges (
    id INTEGER PRIMARY KEY,
    account TEXT NOT NULL CHECK (account IN ('reservations', 'alcool', 'cigares')),
    kind TEXT NOT NULL CHECK (kind IN ('temps_supplementaire', 'produit', 'abonnement')),
    member_id INTEGER NOT NULL REFERENCES members(id),
    reservation_id INTEGER REFERENCES reservations(id),
    subscription_id INTEGER REFERENCES subscriptions(id),
    product_id INTEGER REFERENCES products(id),
    label TEXT NOT NULL,
    quantity INTEGER NOT NULL DEFAULT 1 CHECK (quantity > 0),
    unit_price INTEGER NOT NULL CHECK (unit_price >= 0),
    amount INTEGER NOT NULL CHECK (amount > 0),
    status TEXT NOT NULL CHECK (status IN ('due', 'payee', 'annulee', 'remboursee')),
    tariff_validated INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL,
    created_by INTEGER REFERENCES users(id),
    cancelled_at TEXT,
    cancelled_by INTEGER REFERENCES users(id),
    cancel_reason TEXT,
    CHECK (amount = quantity * unit_price)
  )`,
  'CREATE INDEX charges_reservation ON charges(reservation_id)',
  'CREATE INDEX charges_member ON charges(member_id)',
  'CREATE INDEX charges_created ON charges(created_at)',

  `CREATE TABLE payments (
    id INTEGER PRIMARY KEY,
    member_id INTEGER NOT NULL REFERENCES members(id),
    reservation_id INTEGER REFERENCES reservations(id),
    amount INTEGER NOT NULL CHECK (amount > 0),
    method TEXT NOT NULL,
    reference TEXT,
    paid_at TEXT NOT NULL,
    created_by INTEGER REFERENCES users(id)
  )`,
  'CREATE INDEX payments_paid ON payments(paid_at)',

  // A line is collected in full by exactly one payment (UNIQUE charge_id).
  `CREATE TABLE payment_allocations (
    id INTEGER PRIMARY KEY,
    payment_id INTEGER NOT NULL REFERENCES payments(id),
    charge_id INTEGER NOT NULL UNIQUE REFERENCES charges(id),
    account TEXT NOT NULL CHECK (account IN ('reservations', 'alcool', 'cigares')),
    amount INTEGER NOT NULL CHECK (amount > 0)
  )`,

  `CREATE TABLE refunds (
    id INTEGER PRIMARY KEY,
    charge_id INTEGER NOT NULL UNIQUE REFERENCES charges(id),
    payment_id INTEGER NOT NULL REFERENCES payments(id),
    account TEXT NOT NULL CHECK (account IN ('reservations', 'alcool', 'cigares')),
    amount INTEGER NOT NULL CHECK (amount > 0),
    method TEXT NOT NULL,
    reference TEXT,
    reason TEXT NOT NULL,
    restocked INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL,
    created_by INTEGER REFERENCES users(id)
  )`,

  `CREATE TABLE stock_movements (
    id INTEGER PRIMARY KEY,
    product_id INTEGER NOT NULL REFERENCES products(id),
    kind TEXT NOT NULL CHECK (kind IN ('stock_initial', 'entree', 'vente', 'annulation_vente', 'retour', 'ajustement')),
    quantity INTEGER NOT NULL CHECK (quantity <> 0),
    stock_after INTEGER NOT NULL CHECK (stock_after >= 0),
    charge_id INTEGER REFERENCES charges(id),
    reason TEXT,
    created_at TEXT NOT NULL,
    created_by INTEGER REFERENCES users(id)
  )`,
  'CREATE INDEX stock_movements_product ON stock_movements(product_id)',

  // Expense and receipt categories for the manual entries below.
  `CREATE TABLE categories (
    id INTEGER PRIMARY KEY,
    kind TEXT NOT NULL CHECK (kind IN ('depense', 'recette')),
    name TEXT NOT NULL COLLATE NOCASE,
    active INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0, 1)),
    created_at TEXT NOT NULL,
    created_by INTEGER REFERENCES users(id),
    UNIQUE (kind, name)
  )`,

  // Money that does not come from a member: expenses, other receipts, transfers between treasury
  // accounts (a treasury account is a payment method). Never deleted: cancelled with a reason.
  `CREATE TABLE ledger_entries (
    id INTEGER PRIMARY KEY,
    kind TEXT NOT NULL CHECK (kind IN ('depense', 'recette', 'transfert')),
    biz_date TEXT NOT NULL,
    category_id INTEGER REFERENCES categories(id),
    account TEXT CHECK (account IS NULL OR account IN ('reservations', 'alcool', 'cigares')),
    method TEXT NOT NULL,
    to_method TEXT,
    amount INTEGER NOT NULL CHECK (amount > 0),
    label TEXT NOT NULL,
    reference TEXT,
    status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'annulee')),
    is_demo INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL,
    created_by INTEGER REFERENCES users(id),
    cancelled_at TEXT,
    cancelled_by INTEGER REFERENCES users(id),
    cancel_reason TEXT,
    CHECK ((kind = 'transfert') = (to_method IS NOT NULL)),
    CHECK (kind = 'transfert' OR category_id IS NOT NULL),
    CHECK (to_method IS NULL OR to_method <> method)
  )`,
  'CREATE INDEX ledger_entries_date ON ledger_entries(biz_date)',

  // A closed month ('YYYY-MM') refuses any new or cancelled entry dated inside it.
  // The summary keeps the figures as they stood at closing.
  `CREATE TABLE closed_periods (
    month TEXT PRIMARY KEY,
    closed_at TEXT NOT NULL,
    closed_by INTEGER REFERENCES users(id),
    summary TEXT NOT NULL
  )`,

  // Replayed requests (same Idempotency-Key) return the stored response instead of acting twice.
  `CREATE TABLE idempotency_keys (
    key TEXT NOT NULL,
    user_id INTEGER NOT NULL,
    request_hash TEXT NOT NULL,
    status INTEGER NOT NULL,
    response TEXT NOT NULL,
    created_at TEXT NOT NULL,
    PRIMARY KEY (key, user_id)
  )`,

  `CREATE TABLE audit_log (
    id INTEGER PRIMARY KEY,
    at TEXT NOT NULL,
    user_id INTEGER REFERENCES users(id),
    action TEXT NOT NULL,
    entity TEXT,
    entity_id INTEGER,
    details TEXT
  )`,
  'CREATE INDEX audit_entity ON audit_log(entity, entity_id)',
];

const V2 = [
  `CREATE TABLE humidors (
    id INTEGER PRIMARY KEY,
    name TEXT NOT NULL UNIQUE COLLATE NOCASE,
    location TEXT,
    notes TEXT,
    humidity_min REAL NOT NULL CHECK (humidity_min >= 0),
    humidity_max REAL NOT NULL CHECK (humidity_max <= 100 AND humidity_max > humidity_min),
    temperature_min REAL NOT NULL CHECK (temperature_min >= -20),
    temperature_max REAL NOT NULL CHECK (temperature_max <= 60 AND temperature_max > temperature_min),
    reading_interval_hours INTEGER NOT NULL CHECK (reading_interval_hours BETWEEN 1 AND 168),
    created_at TEXT NOT NULL,
    created_by INTEGER REFERENCES users(id),
    updated_at TEXT
  )`,
  `CREATE TABLE humidor_readings (
    id INTEGER PRIMARY KEY,
    humidor_id INTEGER NOT NULL REFERENCES humidors(id),
    humidity REAL NOT NULL CHECK (humidity BETWEEN 0 AND 100),
    temperature REAL NOT NULL CHECK (temperature BETWEEN -20 AND 60),
    notes TEXT,
    measured_at TEXT NOT NULL,
    created_by INTEGER REFERENCES users(id),
    voided_at TEXT,
    voided_by INTEGER REFERENCES users(id),
    void_reason TEXT
  )`,
  'CREATE INDEX humidor_readings_latest ON humidor_readings(humidor_id, measured_at DESC, id DESC)',
];

// Private lockers are not part of the product: databases created with the first v2 lose them.
const V3 = [
  'DROP TABLE IF EXISTS locker_movements',
  'DROP TABLE IF EXISTS locker_items',
  'DROP TABLE IF EXISTS locker_assignments',
  'DROP TABLE IF EXISTS lockers',
];

const V4 = [
  `CREATE TABLE rooms (
    id INTEGER PRIMARY KEY,
    name TEXT NOT NULL UNIQUE COLLATE NOCASE,
    capacity INTEGER NOT NULL DEFAULT 6 CHECK (capacity BETWEEN 1 AND 200),
    description TEXT,
    active INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0, 1)),
    created_at TEXT NOT NULL,
    created_by INTEGER REFERENCES users(id),
    updated_at TEXT
  )`,
  'ALTER TABLE reservations ADD COLUMN room_id INTEGER REFERENCES rooms(id)',
  'ALTER TABLE reservations ADD COLUMN party_size INTEGER NOT NULL DEFAULT 1 CHECK (party_size BETWEEN 1 AND 200)',
  'CREATE INDEX reservations_room ON reservations(room_id, start_ms, end_ms)',
  'DROP TRIGGER IF EXISTS reservations_no_overlap_insert',
  'DROP TRIGGER IF EXISTS reservations_no_overlap_update',
  `CREATE TRIGGER reservations_no_overlap_insert BEFORE INSERT ON reservations
  WHEN NEW.status <> 'annulee'
  BEGIN
    SELECT RAISE(ABORT, 'CHEVAUCHEMENT') WHERE EXISTS (
      SELECT 1 FROM reservations r
      WHERE r.status <> 'annulee'
        AND COALESCE(r.room_id, 1) = COALESCE(NEW.room_id, 1)
        AND r.start_ms < NEW.end_ms AND NEW.start_ms < r.end_ms);
  END`,
  `CREATE TRIGGER reservations_no_overlap_update BEFORE UPDATE OF start_ms, end_ms, status, room_id ON reservations
  WHEN NEW.status <> 'annulee'
  BEGIN
    SELECT RAISE(ABORT, 'CHEVAUCHEMENT') WHERE EXISTS (
      SELECT 1 FROM reservations r
      WHERE r.id <> NEW.id AND r.status <> 'annulee'
        AND COALESCE(r.room_id, 1) = COALESCE(NEW.room_id, 1)
        AND r.start_ms < NEW.end_ms AND NEW.start_ms < r.end_ms);
  END`,
  `CREATE TABLE IF NOT EXISTS reservation_attendees (
    id INTEGER PRIMARY KEY,
    reservation_id INTEGER NOT NULL REFERENCES reservations(id),
    member_id INTEGER NOT NULL REFERENCES members(id),
    subscription_id INTEGER NOT NULL REFERENCES subscriptions(id),
    included_minutes INTEGER NOT NULL DEFAULT 0 CHECK (included_minutes >= 0),
    created_at TEXT NOT NULL,
    created_by INTEGER REFERENCES users(id),
    UNIQUE (reservation_id, member_id)
  )`,
  'CREATE INDEX IF NOT EXISTS reservation_attendees_res ON reservation_attendees(reservation_id)',
];

// Early v4 databases did not yet have attendee rows. Bring both variants forward atomically.
const V5 = [
  'ALTER TABLE rooms ADD COLUMN archived_at TEXT',
  `CREATE TABLE IF NOT EXISTS reservation_attendees (
    id INTEGER PRIMARY KEY,
    reservation_id INTEGER NOT NULL REFERENCES reservations(id),
    member_id INTEGER NOT NULL REFERENCES members(id),
    subscription_id INTEGER NOT NULL REFERENCES subscriptions(id),
    included_minutes INTEGER NOT NULL DEFAULT 0 CHECK (included_minutes >= 0),
    created_at TEXT NOT NULL,
    created_by INTEGER REFERENCES users(id),
    UNIQUE (reservation_id, member_id)
  )`,
  'CREATE INDEX IF NOT EXISTS reservation_attendees_res ON reservation_attendees(reservation_id)',
  'CREATE INDEX reservation_attendees_member ON reservation_attendees(member_id, reservation_id)',
];

// Who consumed each bottle or cigar in a room. Billing stays with the reservation holder
// (charges.member_id); NULL means the holder.
const V6 = [
  'ALTER TABLE charges ADD COLUMN consumer_member_id INTEGER REFERENCES members(id)',
  'CREATE INDEX charges_consumer ON charges(consumer_member_id)',
];

// Members are deactivated, never deleted: payments, bookings and consumption stay in the books.
const V7 = [
  'ALTER TABLE members ADD COLUMN active INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0, 1))',
  'ALTER TABLE members ADD COLUMN deactivated_at TEXT',
  'ALTER TABLE members ADD COLUMN deactivated_by INTEGER REFERENCES users(id)',
  'ALTER TABLE members ADD COLUMN deactivation_reason TEXT',
];

// The club has a single room. The two extra rooms created by default are retired when they were
// never used; a room with reservations stays, so its history keeps its place.
const V8 = [
  `UPDATE rooms SET active = 0,
     archived_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
   WHERE name IN ('Salon VIP', 'Petit Salon') AND created_by IS NULL AND archived_at IS NULL
     AND NOT EXISTS (SELECT 1 FROM reservations r WHERE r.room_id = rooms.id)`,
];

// The club is named Limen. A name still at the former default is updated; a name chosen in the
// settings is kept.
const V9 = [
  `UPDATE settings SET value = '"Limen"', updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
   WHERE key = 'club_name' AND value = '"Club Privé"'`,
];

// The club has no opening hours: it opens whenever the room is booked. Only the start of the
// business day remains; one still at the former default 10:00 moves to 06:00, so a night session
// counts with the evening before. The off-hours authorization setting goes with the hours.
const V10 = [
  `UPDATE settings SET value = json_object('open',
     CASE WHEN json_extract(value, '$.open') = '10:00' THEN '06:00' ELSE json_extract(value, '$.open') END),
     updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
   WHERE key = 'hours'`,
  "DELETE FROM settings WHERE key = 'manager_can_authorize_off_hours'",
];

// On Friday, Saturday and Sunday a booking lasts at least 2 hours: clubs that already saved their
// booking settings get the weekend minimum too.
const V11 = [
  `UPDATE settings SET value = json_set(value, '$.weekend_min_duration_min',
     max(120, coalesce(json_extract(value, '$.min_duration_min'), 60))),
     updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
   WHERE key = 'booking' AND json_extract(value, '$.weekend_min_duration_min') IS NULL`,
];

// Bookings of 3 hours or more are secured by a deposit (half of their paid time): the amount taken
// is kept on the booking, and its line is marked so it can be told from the balance.
const V12 = [
  'ALTER TABLE reservations ADD COLUMN deposit_amount INTEGER NOT NULL DEFAULT 0 CHECK (deposit_amount >= 0)',
  'ALTER TABLE charges ADD COLUMN deposit INTEGER NOT NULL DEFAULT 0 CHECK (deposit IN (0, 1))',
];

// Product photos live apart from the products, so that a list of products never reads a picture. One photo
// per product, replaced in place (JPEG, PNG or WebP, 200 KB at most: the API checks the size and the
// content). `data` comes last on purpose: SQLite reads a row's columns in order, and the version of a photo
// (`updated_at`), which every list of products asks for, would otherwise be read through all the pages that
// the picture takes.
const V13 = [
  `CREATE TABLE product_photos (
    product_id INTEGER PRIMARY KEY REFERENCES products(id),
    mime TEXT NOT NULL CHECK (mime IN ('image/jpeg', 'image/png', 'image/webp')),
    bytes INTEGER NOT NULL,
    updated_at TEXT NOT NULL,
    updated_by INTEGER REFERENCES users(id),
    data BLOB NOT NULL
  )`,
];

// Cash receipt: every payment carries a check code (the proof printed on the ticket; NULL only until
// fillTicketCodes() has run at startup), and every printing or WhatsApp sending of a ticket is kept, one
// numbered copy after the other. SQLite cannot add a UNIQUE column, hence the separate unique index.
const V14 = [
  'ALTER TABLE payments ADD COLUMN ticket_code TEXT',
  'CREATE UNIQUE INDEX payments_ticket_code ON payments(ticket_code)',
  `CREATE TABLE ticket_events (
    id INTEGER PRIMARY KEY,
    payment_id INTEGER NOT NULL REFERENCES payments(id),
    kind TEXT NOT NULL CHECK (kind IN ('impression', 'whatsapp')),
    copy_no INTEGER NOT NULL CHECK (copy_no >= 1),
    phone TEXT,
    at TEXT NOT NULL,
    user_id INTEGER REFERENCES users(id),
    UNIQUE (payment_id, copy_no)
  )`,
  'CREATE INDEX ticket_events_at ON ticket_events(at)',
];

export const MIGRATIONS = [V1, V2, V3, V4, V5, V6, V7, V8, V9, V10, V11, V12, V13, V14];

export function migrate(db) {
  db.exec('CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT NOT NULL)');
  const row = db.get("SELECT value FROM meta WHERE key = 'schema_version'");
  for (let version = row ? Number(row.value) : 0; version < MIGRATIONS.length; version += 1) {
    db.transaction(() => {
      for (const statement of MIGRATIONS[version]) db.exec(statement);
      db.run(
        "INSERT INTO meta (key, value) VALUES ('schema_version', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
        String(version + 1),
      );
    });
  }
}
