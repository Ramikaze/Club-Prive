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

// The message of an outside meal: what was ordered, when, the card's part, the rest paid at the till if any,
// and the new balance.
export function mealWhatsAppText({ clubName, firstName, label, amount, cardAmount, balance, at, timezone, currency }) {
  const money = (n) => formatMoney(n, currency);
  const head = `Votre repas « ${clean(label)} » du ${instantText(at, timezone)} (${money(amount)})`;
  const body = cardAmount >= amount
    ? `${head} a été payé par votre carte membre : nouveau solde ${money(balance)}.`
    : `${head} : ${money(cardAmount)} payés par votre carte membre, ${money(amount - cardAmount)} réglés à la caisse. Nouveau solde ${money(balance)}.`;
  return [clean(clubName), `Bonjour ${clean(firstName)},`, body, 'Bon appétit !'].filter(Boolean).join('\n');
}

// The receipt of a recharge: the amount, the new balance and when. `at` is the payment's instant, shown in
// the club's `timezone`; `currency` is the club's (formatMoney's default otherwise).
export function rechargeWhatsAppText({ clubName, firstName, amount, balance, at, timezone, currency }) {
  const money = (n) => formatMoney(n, currency);
  return [
    clean(clubName),
    `Bonjour ${clean(firstName)},`,
    `Votre carte membre a été rechargée de ${money(amount)} le ${instantText(at, timezone)} : nouveau solde ${money(balance)}.`,
    'Merci de votre confiance.',
  ].filter(Boolean).join('\n');
}

// The renewal alert (renewalStatus): `bientot` before the end of the subscription, `bloque` after it, when the
// card's `balance` does not cover the plan's `price`; it says what is missing.
export function renewalWhatsAppText({ clubName, firstName, planName, endDate, balance, price, state, currency }) {
  const money = (n) => formatMoney(n, currency);
  const amounts = `${money(balance)} sur la carte, ${money(price)} nécessaires.`;
  const missing = `Il manque ${money(Math.max(0, price - balance))}`;
  const plan = clean(planName);
  const lines = state === 'bloque'
    ? [
      `Votre abonnement ${plan} s’est terminé le ${dayText(endDate)}. Renouvellement impossible : ${amounts}`,
      `${missing} : dès que vous rechargez votre carte, l’abonnement est renouvelé à partir du jour de la recharge.`,
    ]
    : [
      `Votre abonnement ${plan} se termine le ${dayText(endDate)}. Il se renouvelle avec votre carte membre, mais le solde ne suffit pas : ${amounts}`,
      `${missing} : rechargez votre carte pour que l’abonnement soit renouvelé.`,
    ];
  return [clean(clubName), `Bonjour ${clean(firstName)},`, ...lines].filter(Boolean).join('\n');
}
