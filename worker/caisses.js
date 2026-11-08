// The associés' caisses (spec docs/superpowers/specs/2026-11-07-caisses-associes-design.md). These methods are mixed
// into Club (end of club.js) like the ledger's: `this` is the Club instance, and they never open transactions
// themselves. The real till is shared out into three caisses, one per owner of the money: Réservation de séance (the
// two associés' common money), Champagne et autres boissons and Cigare (each associé's). With the cash fund and the
// money waiting on the members' cards they add up to the till, to the unit, at every date: every movement of the
// till lands in exactly one of them, or cancels out with another (money passing through, as an outside meal).
import { invalid, forbidden, conflict } from './errors.js';
import { int, text } from './validate.js';
import { addDays, isValidDate } from '../shared/time.js';
import { isBoss } from '../shared/roles.js';
import { CAISSES, CAISSE_LABEL, splitHalves } from '../shared/caisses.js';
import { OUTSIDE_MEAL_CATEGORY } from './ledger.js';
import { DRINK_PART_SQL } from './billed.js';

// Tracking starts at the cash fund's date; with no fund, from the very beginning.
const EARLIEST = '2000-01-01';

const emptyCaisses = () => ({
  reservations: { balance: 0, sold: 0, expenses: 0, apports: 0, taken: 0, halves: splitHalves(0) },
  alcool: {
    balance: 0, sold_champagne: 0, sold_autres: 0, purchases_champagne: 0, purchases_autres: 0, other_expenses: 0, apports: 0, taken: 0,
  },
  cigares: { balance: 0, sold: 0, purchases: 0, other_expenses: 0, apports: 0, taken: 0 },
});

export const caisseMethods = {
  // Per-caisse sums for the business days `from`..`to` inclusive (every movement of the period, verified or not).
  caisseSums(from, to) {
    const caisses = emptyCaisses();
    const a = this.dayStartIso(from);
    const b = this.dayStartIso(addDays(to, 1));
    const sale = (r, sign) => {
      const amount = sign * r.total;
      if (r.account === 'alcool') caisses.alcool[r.drink === 'autres_boissons' ? 'sold_autres' : 'sold_champagne'] += amount;
      else caisses[r.account].sold += amount;
    };
    for (const r of this.all(
      `SELECT pa.account, ${DRINK_PART_SQL} AS drink, SUM(pa.amount) AS total
       FROM payment_allocations pa JOIN payments p ON p.id = pa.payment_id
       LEFT JOIN charges c ON c.id = pa.charge_id LEFT JOIN products pr ON pr.id = c.product_id
       WHERE p.paid_at >= ? AND p.paid_at < ? GROUP BY pa.account, drink`, a, b,
    )) sale(r, 1);
    for (const r of this.all(
      `SELECT rf.account, ${DRINK_PART_SQL} AS drink, SUM(rf.amount) AS total
       FROM refunds rf JOIN charges c ON c.id = rf.charge_id LEFT JOIN products pr ON pr.id = c.product_id
       WHERE rf.created_at >= ? AND rf.created_at < ? GROUP BY rf.account, drink`, a, b,
    )) sale(r, -1);
    for (const r of this.all(
      `SELECT e.kind, e.account, c.code, c.name, SUM(e.amount) AS total FROM ledger_entries e
       LEFT JOIN categories c ON c.id = e.category_id
       WHERE e.status = 'active' AND e.kind <> 'transfert' AND e.biz_date >= ? AND e.biz_date <= ?
       GROUP BY e.kind, e.account, e.category_id`, from, to,
    )) {
      const k = r.account ?? 'reservations';
      if (r.kind === 'retrait') caisses[k].taken += r.total;
      else if (r.kind === 'recette') caisses[k].apports += r.total;
      else if (r.name === OUTSIDE_MEAL_CATEGORY) continue;
      else if (k === 'reservations') caisses.reservations.expenses += r.total;
      else if (k === 'alcool') {
        const line = { achat_champagne: 'purchases_champagne', achat_autres_boissons: 'purchases_autres' }[r.code] ?? 'other_expenses';
        caisses.alcool[line] += r.total;
      } else caisses.cigares[r.code === 'achat_cigares' ? 'purchases' : 'other_expenses'] += r.total;
    }
    const x = caisses;
    x.reservations.balance = x.reservations.sold - x.reservations.expenses + x.reservations.apports - x.reservations.taken;
    x.reservations.halves = splitHalves(x.reservations.balance);
    x.alcool.balance = x.alcool.sold_champagne + x.alcool.sold_autres - x.alcool.purchases_champagne - x.alcool.purchases_autres
      - x.alcool.other_expenses + x.alcool.apports - x.alcool.taken;
    x.cigares.balance = x.cigares.sold - x.cigares.purchases - x.cigares.other_expenses + x.cigares.apports - x.cigares.taken;
    return caisses;
  },

  // True when the business day `day` holds money: a payment or a refund of that day, or an active ledger entry other
  // than a transfer dated on it.
  dayHasMoney(day) {
    const a = this.dayStartIso(day);
    const b = this.dayStartIso(addDays(day, 1));
    return !!(
      this.get('SELECT 1 AS x FROM payments WHERE paid_at >= ? AND paid_at < ? LIMIT 1', a, b)
      || this.get('SELECT 1 AS x FROM refunds WHERE created_at >= ? AND created_at < ? LIMIT 1', a, b)
      || this.get("SELECT 1 AS x FROM ledger_entries WHERE status = 'active' AND kind <> 'transfert' AND biz_date = ? LIMIT 1", day)
    );
  },

  // The days whose money is not yet verified, oldest first: from the feature's start day (or the cash fund's date if
  // later) up to `to`, each with money and with no closing verified.
  pendingDays(to = this.bizToday()) {
    const since = this.get("SELECT value FROM meta WHERE key = 'day_verification_since'")?.value ?? '9999-12-31';
    const fund = this.settings().opening_balances.date ?? EARLIEST;
    const verified = new Set(this.all('SELECT biz_day FROM day_closings WHERE verified_at IS NOT NULL').map((r) => r.biz_day));
    const closings = new Map(this.all(
      'SELECT dc.biz_day, dc.closed_at, u.name AS closed_by_name FROM day_closings dc LEFT JOIN users u ON u.id = dc.closed_by',
    ).map((r) => [r.biz_day, r]));
    const out = [];
    // The walk stops at today: no day after it can hold money yet.
    const end = to < this.bizToday() ? to : this.bizToday();
    for (let day = since > fund ? since : fund; day <= end; day = addDays(day, 1)) {
      if (verified.has(day) || !this.dayHasMoney(day)) continue;
      const c = closings.get(day);
      out.push({ day, closed: !!c, closed_at: c?.closed_at ?? null, closed_by_name: c?.closed_by_name ?? null });
    }
    return out;
  },

  // The six tiles of « Soldes » at the end of the business day `to`, each summed from the cash fund's date:
  // - fund: the cash fund, less what the members' cards held then (that money is in the till, but it is theirs);
  // - cards: what the members' cards hold;
  // - caisses: what was sold (card part included, refunds off), less the expenses, plus the apports, less the profits
  //   taken, by caisse. An expense or a receipt with no caisse belongs to Réservation de séance; the courier of an
  //   outside meal is money passing through, in no caisse;
  // - till: the money of every till and account.
  // Before the fund's date the tracking has not started: every figure is 0.
  // Each caisse holds its VALIDATED figures (days whose till was not verified are taken out, see pendingDays) and
  // `pending`, the net money of those days; validated + pending is the full balance. `till` stays « En tout ».
  caisseBalances(to = this.bizToday()) {
    if (!isValidDate(to)) throw invalid('Date invalide.');
    const start = this.settings().opening_balances.date ?? null;
    if (start && to < start) {
      const empty = emptyCaisses();
      for (const k of CAISSES) empty[k].pending = 0;
      return {
        start, to, started: false, fund: { amount: 0, total: 0, card_credit: 0 }, cards: 0, caisses: empty, till: 0,
        pending_days: [], pending_total: 0, till_validated: 0, verified_through: to,
      };
    }
    const from = start ?? EARLIEST;
    const caisses = this.caisseSums(from, to);
    const pendingList = this.pendingDays(to);
    const pending_days = [];
    for (const k of CAISSES) caisses[k].pending = 0;
    for (const p of pendingList) {
      const d = this.caisseSums(p.day, p.day);
      const net = {};
      for (const k of CAISSES) {
        net[k] = d[k].balance;
        caisses[k].pending += d[k].balance;
        for (const f of Object.keys(d[k])) if (f !== 'halves') caisses[k][f] -= d[k][f];
      }
      pending_days.push({ ...p, net, total: CAISSES.reduce((s, k) => s + net[k], 0) });
    }
    caisses.reservations.halves = splitHalves(caisses.reservations.balance);
    const pending_total = CAISSES.reduce((s, k) => s + caisses[k].pending, 0);
    const total = Object.values(this.settings().opening_balances.amounts).reduce((s, n) => s + n, 0);
    const cardCredit = start ? this.walletLiability(new Date(Date.parse(this.dayStartIso(start)) - 1).toISOString()) : 0;
    const till = this.treasuryBalances(to, to).total.closing;
    return {
      start, to, started: true,
      fund: { amount: total - cardCredit, total, card_credit: cardCredit },
      cards: this.walletLiabilityAt(to),
      caisses,
      till,
      pending_days, pending_total, till_validated: till - pending_total,
      verified_through: pendingList.length ? addDays(pendingList[0].day, -1) : to,
    };
  },

  // « Prendre des bénéfices »: an associé takes his money out of the till and out of a caisse. It is no expense and no
  // cut in the club's result (owner's rule, 2026-11-07), but the till holds less. An associé takes from his own caisse
  // or from the common one, whose amount is shared in two halves, one per associé; the administrator takes from any.
  // Never more than the caisse holds. Cancelled like any entry (POST /api/ledger/entries/:id/cancel).
  takeProfits(actor, input) {
    if (!isBoss(actor)) throw forbidden('Seuls l’administrateur et les associés prennent des bénéfices.');
    const account = input?.account;
    if (!CAISSES.includes(account)) throw invalid('Caisse invalide.');
    if (actor.role === 'associe' && account !== 'reservations' && account !== actor.rayon) {
      throw forbidden('Un associé ne prend des bénéfices que dans sa propre caisse ou dans la caisse commune.');
    }
    const today = this.bizToday();
    const date = input.biz_date === undefined || input.biz_date === null || input.biz_date === '' ? today : input.biz_date;
    if (!isValidDate(date)) throw invalid('Date invalide.');
    if (date > today) throw invalid('La date ne peut pas être dans le futur.');
    this.assertOpen(date, 'Cette prise de bénéfices');
    const amount = int(input.amount, 'Montant', { min: 1, max: 1e13 });
    const method = this.treasuryAccount(input.method, 'Payé depuis');
    const label = text(input.label, 'Libellé', { max: 120 }) ?? `Prise de bénéfices — ${CAISSE_LABEL[account]}`;
    this.assertCaisseCovers(account, amount, 'Cette prise de bénéfices', actor, { available: true });
    const id = this.insert(
      `INSERT INTO ledger_entries (kind, biz_date, category_id, account, method, to_method, amount, label, reference,
         status, is_demo, created_at, created_by)
       VALUES ('retrait', ?, NULL, ?, ?, NULL, ?, ?, NULL, 'active', 0, ?, ?)`,
      date, account, method, amount, label, this.nowIso(), actor.id,
    );
    this.audit(actor, 'caisse.benefices', 'ledger', id, {
      caisse: account, montant: amount, compte: method, date, ...(account === 'reservations' ? { parts: splitHalves(amount) } : {}),
    });
    return { entry: this.entryRows('e.id = ?', id)[0], caisses: this.caisseBalances(today) };
  },

  // Refuses an operation that would take a caisse below zero (owner's rule: a caisse never goes negative). The
  // balance is the caisse's today, every movement recorded so far included, pending money too; with `available`
  // (profits, expenses) the money of unverified days is not spendable, except that a negative pending still counts.
  // The manager, who neither sees the caisses nor makes an apport, is told whom to ask, without the balance.
  assertCaisseCovers(account, amount, what, actor = null, { available = false } = {}) {
    if (!CAISSES.includes(account)) throw invalid('Caisse invalide.');
    const c = this.caisseBalances(this.bizToday()).caisses[account];
    const balance = c.balance + (available ? Math.min(0, c.pending) : c.pending);
    if (balance < amount && actor && !isBoss(actor)) {
      throw conflict(
        'CAISSE_INSUFFISANTE',
        available && c.balance + c.pending >= amount
          ? `${what} n’est pas possible : l’argent de la caisse « ${CAISSE_LABEL[account]} » attend la vérification des journées précédentes par un associé ou l’administrateur.`
          : `${what} n’est pas possible : la caisse « ${CAISSE_LABEL[account]} » ne contient pas assez d’argent. Demandez à un associé ou à l’administrateur d’y remettre de l’argent.`,
        { account },
      );
    }
    if (balance < amount) {
      throw conflict(
        'CAISSE_INSUFFISANTE',
        available
          ? `${what} demande ${this.money(amount)}, mais la caisse « ${CAISSE_LABEL[account]} » ne peut payer que ${this.money(Math.max(0, balance))} : l’argent en attente de vérification ne se dépense pas.`
          : `${what} demande ${this.money(amount)}, mais la caisse « ${CAISSE_LABEL[account]} » ne contient que ${this.money(balance)}. Remettez d'abord de l'argent dans cette caisse (Entrée diverse « Apport des associés »).`,
        { account, balance, needed: amount },
      );
    }
  },
};
