// The cash receipt (ticket de caisse): the pure helpers shared by the Worker and the browser. They build
// the ticket number, the check code, the member's initials and the WhatsApp text; nothing here reads or
// sends anything. The code is drawn by the caller's source of random bytes, so tests can drive it.
import { fmtDuration } from './rules.js';

// 31 letters and digits without the look-alikes (no I, L, O, 0, 1). 248 = 8 * 31 is the largest multiple of
// 31 under 256, so a byte below it maps to a letter with no bias.
export const TICKET_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
export const TICKET_CODE_LENGTH = 12;

const clean = (value) => String(value ?? '').trim();

// A new check code of TICKET_CODE_LENGTH characters. `randomBytes(n)` returns n random bytes; a byte of 248
// or more is thrown away (rejection sampling) and another batch is asked for until the code is full.
export function newTicketCode(randomBytes) {
  const limit = TICKET_ALPHABET.length * 8;
  let code = '';
  while (code.length < TICKET_CODE_LENGTH) {
    for (const byte of randomBytes(TICKET_CODE_LENGTH * 2)) {
      if (byte >= limit) continue;
      code += TICKET_ALPHABET[byte % TICKET_ALPHABET.length];
      if (code.length === TICKET_CODE_LENGTH) break;
    }
  }
  return code;
}

// « T-000123 »: the payment's id on at least 6 digits.
export function formatTicketNumber(id) {
  return `T-${String(Math.trunc(Number(id) || 0)).padStart(6, '0')}`;
}

// « K7QM-2XRP-9TDA »: the code in groups of four, as it is printed.
export function formatTicketCode(code) {
  return (clean(code).match(/.{1,4}/g) || []).join('-');
}

// What a person typed or scanned, reduced to the bare code: upper case, and only the characters of the
// alphabet (dashes, spaces and anything else fall away).
export function normalizeTicketCode(input) {
  return clean(input).toUpperCase().split('').filter((ch) => TICKET_ALPHABET.includes(ch)).join('');
}

// « J. D. »: the first letter of each name, accents kept, an empty part skipped. This is all of the member's
// name the public verification page may show.
export function memberInitials(firstName, lastName) {
  return [firstName, lastName]
    .map((part) => [...clean(part)][0])
    .filter(Boolean)
    .map((letter) => `${letter.toUpperCase()}.`)
    .join(' ');
}

// The address the QR code and the WhatsApp text point to (the public page, no sign-in).
export function ticketVerifyUrl(origin, id, code) {
  return `${origin}/#/ticket/${id}/${code}`;
}

export const RECHARGE_LINE_LABEL = 'Approvisionnement carte membre';

// The lines a receipt shows. A recharge or an outside meal is a payment with no line (nothing is sold through
// a charge), so it shows one line of its own: « Recharge carte membre », or the meal's label.
export function paymentLines({ kind, label, amount, allocations }) {
  if (kind === 'recharge') return [{ label: RECHARGE_LINE_LABEL, quantity: 1, amount }];
  if (kind === 'repas') return [{ label: clean(label), quantity: 1, amount }];
  return allocations || [];
}

// The receipt as text, for WhatsApp. `money(hundredths)` and `dateTime(iso)` are the caller's formatters.
// Without `verifyUrl` (the demo) there is no « Vérifiez » line; a positive `refunded` adds a « Remboursé » line.
// A positive `cardAmount` replaces « Payé » by the card's share and the rest with its method; `balance` (the
// card's balance after the payment) and `timeAvailable` (minutes) add the member's balances when not null.
export function ticketWhatsAppText({
  clubName, number, copyLabel, paidAt, memberName, memberNo, lines, total, method, reference, cashier,
  refunded, verifyUrl, footer, money, dateTime, cardAmount = 0, balance = null, timeAvailable = null, cancelledAt = null,
}) {
  const client = [clean(memberName), clean(memberNo) && `(${clean(memberNo)})`].filter(Boolean).join(' ');
  const paid = [clean(method), clean(reference) && `(${clean(reference)})`].filter(Boolean).join(' ');
  const card = Number(cardAmount) || 0;
  const rest = total - card;
  const payment = card > 0
    ? [`Payé par carte membre : ${money(card)}`, rest > 0 && `Reste payé (${paid}) : ${money(rest)}`]
    : [`Payé : ${paid}`];
  return [
    clean(clubName),
    `TICKET DE CAISSE ${number}${clean(copyLabel) ? ` (${clean(copyLabel)})` : ''}`,
    dateTime(paidAt),
    client && `Client : ${client}`,
    ...(lines || []).map((line) => {
      const quantity = Number(line.quantity) > 1 ? `${line.quantity} × ` : '';
      return `- ${quantity}${line.label}  ${money(line.amount)}`;
    }),
    `TOTAL : ${money(total)}`,
    ...payment,
    balance !== null && balance !== undefined && `Solde carte : ${money(balance)}`,
    timeAvailable !== null && timeAvailable !== undefined && `Crédit temps (à ce jour) : ${fmtDuration(timeAvailable)} disponibles`,
    clean(cashier) && `Encaissé par : ${clean(cashier)}`,
    Number(refunded) > 0 && `Remboursé : ${money(refunded)}`,
    cancelledAt && `Annulé le ${dateTime(cancelledAt)}`,
    clean(verifyUrl) && `Vérifiez ce ticket : ${clean(verifyUrl)}`,
    clean(footer),
  ].filter(Boolean).join('\n');
}
