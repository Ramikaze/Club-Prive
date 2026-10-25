// The member card's WhatsApp texts, shared by the Worker and the browser: the receipt of a recharge and the
// renewal alert. Pure: amounts are formatted by formatMoney in the club's currency, dates as the club reads
// them; nothing is sent from here.
import { formatMoney } from './rules.js';
import { localParts } from './time.js';

const clean = (value) => String(value ?? '').trim();

// 'YYYY-MM-DD' -> '23/11/2026'.
const dayText = (date) => clean(date).split('-').reverse().join('/');

// An instant -> '24/10/2026 à 20:41' on the club's clock.
function instantText(iso, timezone) {
  const p = localParts(Date.parse(iso), timezone);
  return `${dayText(p.date)} à ${p.time}`;
}

// The ticket's number, and the link anyone can open to check that it is genuine (absent in the demo).
// « L’équipe Limen »: how the club signs its messages.
// How every message greets the member: « Bonjour Monsieur DUPONT, » (the last name as the member file keeps it).
const greeting = (lastName) => (clean(lastName) ? `Bonjour Monsieur ${clean(lastName)},` : 'Bonjour Monsieur,');

const signature = (clubName) => (clean(clubName) ? `L’équipe ${clean(clubName)}` : '').trim();

const ticketLines = (number, verifyUrl) => [
  number ? `Ticket ${clean(number)} (ci-dessous)` : '',
  verifyUrl ? `Vérifier le ticket : ${verifyUrl}` : '',
];

// The message of an outside meal, as the owner words it: what was ordered and when, the card's part (and the rest
// paid at the till), the new balance, the ticket's number and verification link, signed by the club's team.
export function mealWhatsAppText({ clubName, lastName, label, amount, cardAmount, balance, at, timezone, currency, number, verifyUrl }) {
  const money = (n) => formatMoney(n, currency);
  const head = `Votre repas « ${clean(label)} » du ${instantText(at, timezone)} (${money(amount)})`;
  const body = cardAmount >= amount
    ? `${head} a été payé par votre carte membre.`
    : `${head} : ${money(cardAmount)} payés par votre carte membre, ${money(amount - cardAmount)} réglés à la caisse.`;
  // One sentence per line; the thanks and the signature share the last one.
  return [greeting(lastName), body, `Votre nouveau solde est de ${money(balance)}.`, ...ticketLines(number, verifyUrl),
    `Merci de votre confiance. ${signature(clubName)}`]
    .filter(Boolean).join('\n');
}

// The message of any other receipt (drinks and cigars taken during a session, room time, a subscription), in the
// same words as the others: what was paid and when (with what it was for), the card's part and the rest with its
// method, the new balance when the card paid, the ticket's number and verification link, signed by the club's team.
export function paymentWhatsAppText({ clubName, lastName, amount, cardAmount = 0, method, balance, for: what, at, timezone, currency, number, verifyUrl }) {
  const money = (n) => formatMoney(n, currency);
  const head = `Votre paiement de ${money(amount)} du ${instantText(at, timezone)}${clean(what) ? ` (${clean(what)})` : ''}`;
  const body = cardAmount <= 0
    ? `${head} a bien été reçu (${clean(method)}).`
    : cardAmount >= amount
      ? `${head} a été payé par votre carte membre.`
      : `${head} : ${money(cardAmount)} payés par votre carte membre, ${money(amount - cardAmount)} réglés en ${clean(method)}.`;
  return [
    greeting(lastName),
    body,
    cardAmount > 0 && balance != null ? `Votre nouveau solde est de ${money(balance)}.` : '',
    ...ticketLines(number, verifyUrl),
    `Merci de votre confiance. ${signature(clubName)}`,
  ].filter(Boolean).join('\n');
}

// The receipt of a recharge, as the owner words it: the amount and when, the new balance, the ticket's number and
// verification link, signed by the club's team. `at` is the payment's instant, shown in the club's `timezone`;
// `currency` is the club's (formatMoney's default otherwise).
export function rechargeWhatsAppText({ clubName, lastName, amount, balance, at, timezone, currency, number, verifyUrl }) {
  const money = (n) => formatMoney(n, currency);
  return [
    greeting(lastName),
    `Votre carte membre a été approvisionnée de ${money(amount)} le ${instantText(at, timezone)}.`,
    `Votre nouveau solde est de ${money(balance)}.`,
    ...ticketLines(number, verifyUrl),
    `Merci de votre confiance. ${signature(clubName)}`,
  ].filter(Boolean).join('\n');
}

// A calendar date 'YYYY-MM-DD' with its weekday, as the booking confirmation writes it: 'mar. 27/10/2026'.
const WEEKDAYS = ['dim.', 'lun.', 'mar.', 'mer.', 'jeu.', 'ven.', 'sam.'];
export function weekdayDayText(date) {
  const [y, m, d] = clean(date).split('-').map(Number);
  if (!y || !m || !d) return '';
  return `${WEEKDAYS[new Date(Date.UTC(y, m - 1, d)).getUTCDay()]} ${dayText(date)}`;
}

// The message of a booking confirmation, sent with its picture: the room, the day the session starts on (`day`,
// 'YYYY-MM-DD'), its times and party size, the booking's number, signed by the club's team.
export function bookingWhatsAppText({ clubName, lastName, roomName, day, startTime, endTime, partySize, number }) {
  const people = Math.max(1, Number(partySize) || 1);
  const where = clean(roomName) ? ` au ${clean(roomName)}` : '';
  return [
    greeting(lastName),
    `Votre réservation${where} est confirmée pour le ${weekdayDayText(day)} de ${clean(startTime)} à ${clean(endTime)} (${people} personne${people > 1 ? 's' : ''}).`,
    number ? `Réservation n° ${clean(number)} (ci-dessous)` : '',
    `Merci de votre confiance. ${signature(clubName)}`,
  ].filter(Boolean).join('\n');
}

// The message sent with the member's statement (its PDF follows it): the period, from `from` to `to`
// ('YYYY-MM-DD'), signed by the club's team.
export function statementWhatsAppText({ clubName, lastName, from, to }) {
  return [
    greeting(lastName),
    `Voici votre relevé de compte du ${dayText(from)} au ${dayText(to)}.`,
    'Relevé (ci-dessous)',
    `Merci de votre confiance. ${signature(clubName)}`,
  ].join('\n');
}

// The renewal alert (renewalStatus): `bientot` before the end of the subscription, `bloque` after it, when the
// card's `balance` does not cover the plan's `price`; it says what is missing.
export function renewalWhatsAppText({ clubName, lastName, planName, endDate, balance, price, state, currency }) {
  const money = (n) => formatMoney(n, currency);
  const amounts = `${money(balance)} sur la carte, ${money(price)} nécessaires.`;
  const missing = `Il manque ${money(Math.max(0, price - balance))}`;
  const plan = clean(planName);
  const lines = state === 'bloque'
    ? [
      `Votre abonnement ${plan} s’est terminé le ${dayText(endDate)}. Renouvellement impossible : ${amounts}`,
      `${missing} : dès que vous approvisionnez votre carte, l’abonnement est renouvelé à partir du jour de l’approvisionnement.`,
    ]
    : [
      `Votre abonnement ${plan} se termine le ${dayText(endDate)}. Il se renouvelle avec votre carte membre, mais le solde ne suffit pas : ${amounts}`,
      `${missing} : approvisionnez votre carte pour que l’abonnement soit renouvelé.`,
    ];
  return [clean(clubName), greeting(lastName), ...lines].filter(Boolean).join('\n');
}
