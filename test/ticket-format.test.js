// The cash receipt's shared formatting (shared/ticket.js): number, code, initials and the WhatsApp text.
// Everything here is made up; no real code or phone number is written in the repository.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  TICKET_ALPHABET, TICKET_CODE_LENGTH, newTicketCode, formatTicketNumber, formatTicketCode,
  normalizeTicketCode, memberInitials, ticketVerifyUrl, ticketWhatsAppText, paymentLines, RECHARGE_LINE_LABEL,
} from '../shared/ticket.js';
import {
  bookingWhatsAppText, mealWhatsAppText, paymentWhatsAppText, rechargeWhatsAppText, renewalWhatsAppText, statementWhatsAppText,
  weekdayDayText,
} from '../shared/wallet.js';
import { formatMoney } from '../shared/rules.js';

// A generator that hands out the given bytes in order, then zeros.
const bytesFrom = (list) => {
  let i = 0;
  return (n) => Uint8Array.from({ length: n }, () => list[i++] ?? 0);
};

test('newTicketCode : 12 caractères, tous dans l’alphabet', () => {
  const code = newTicketCode(bytesFrom(Array.from({ length: 40 }, (_, i) => i * 6)));
  assert.equal(code.length, TICKET_CODE_LENGTH);
  assert.equal(TICKET_CODE_LENGTH, 12);
  for (const ch of code) assert.ok(TICKET_ALPHABET.includes(ch));
});

test('newTicketCode : les octets 248 et plus sont rejetés', () => {
  // 255 and 248 are rejected; the byte 1 gives the second letter, the zeros the first.
  const code = newTicketCode(bytesFrom([255, 248, 1, 255, ...Array(40).fill(0)]));
  assert.equal(code[0], TICKET_ALPHABET[1]);
  assert.equal(code.slice(1), TICKET_ALPHABET[0].repeat(11));
});

test('newTicketCode : alphabet sans caractères ambigus', () => {
  assert.equal(TICKET_ALPHABET, 'ABCDEFGHJKMNPQRSTUVWXYZ23456789');
});

test('formatTicketNumber : au moins 6 chiffres', () => {
  assert.equal(formatTicketNumber(123), 'T-000123');
  assert.equal(formatTicketNumber(1234567), 'T-1234567');
});

test('formatTicketCode : groupes de 4', () => {
  assert.equal(formatTicketCode('K7QM2XRP9TDA'), 'K7QM-2XRP-9TDA');
});

test('normalizeTicketCode : majuscules, sans tirets ni espaces', () => {
  assert.equal(normalizeTicketCode(' k7qm-2xrp 9tda '), 'K7QM2XRP9TDA');
  assert.equal(normalizeTicketCode(null), '');
  assert.equal(normalizeTicketCode(undefined), '');
  assert.equal(normalizeTicketCode(42), '42');
  assert.equal(normalizeTicketCode('ILO01'), '');
});

test('memberInitials : initiales avec accents, parties vides ignorées', () => {
  assert.equal(memberInitials('Élodie', "N'Diaye"), 'É. N.');
  assert.equal(memberInitials('Jean', 'Dupont'), 'J. D.');
  assert.equal(memberInitials('Jean', ''), 'J.');
  assert.equal(memberInitials(null, '  '), '');
});

test('ticketVerifyUrl : adresse de la page publique', () => {
  assert.equal(ticketVerifyUrl('https://club.example', 123, 'K7QM2XRP9TDA'), 'https://club.example/#/ticket/123/K7QM2XRP9TDA');
});

const base = {
  clubName: 'THE LIMEN · Club privé',
  number: 'T-000123',
  copyLabel: 'Original',
  paidAt: '2026-10-24T20:41:00',
  memberName: 'Jean Dupont',
  memberNo: 'M-0012',
  lines: [
    { label: 'Abonnement Mensuel', quantity: 1, amount: 5000000 },
    { label: 'Cigare', quantity: 2, amount: 1000000 },
  ],
  total: 6000000,
  method: 'Espèces',
  reference: '',
  cashier: 'Awa',
  refunded: 0,
  verifyUrl: 'https://club.example/#/ticket/123/K7QM2XRP9TDA',
  footer: 'Merci de votre visite',
  money: (n) => `${n / 100} FCFA`,
  dateTime: (iso) => `DT(${iso})`,
};

test('ticketWhatsAppText : le message complet', () => {
  const text = ticketWhatsAppText(base);
  assert.equal(text, [
    'THE LIMEN · Club privé',
    'TICKET DE CAISSE T-000123 (Original)',
    'DT(2026-10-24T20:41:00)',
    'Client : Jean Dupont (M-0012)',
    '- Abonnement Mensuel  50000 FCFA',
    '- 2 × Cigare  10000 FCFA',
    'TOTAL : 60000 FCFA',
    'Payé : Espèces',
    'Encaissé par : Awa',
    'Vérifiez ce ticket : https://club.example/#/ticket/123/K7QM2XRP9TDA',
    'Merci de votre visite',
  ].join('\n'));
});

test('ticketWhatsAppText : sans verifyUrl (démo), pas de ligne Vérifiez', () => {
  const text = ticketWhatsAppText({ ...base, verifyUrl: '' });
  assert.ok(!text.includes('Vérifiez'));
  assert.ok(text.includes('TOTAL : '));
});

test('ticketWhatsAppText : référence et remboursement', () => {
  const text = ticketWhatsAppText({ ...base, reference: 'MP123', refunded: 1000000 });
  assert.ok(text.includes('Payé : Espèces (MP123)'));
  assert.ok(text.includes('Remboursé : 10000 FCFA'));
});

test('paymentLines : les lignes d’un encaissement, une ligne pour une recharge ou un repas', () => {
  const allocations = [{ charge_id: 4, label: 'Cigare', quantity: 2, amount: 1000000 }];
  assert.deepEqual(paymentLines({ kind: 'encaissement', amount: 1000000, allocations }), allocations);
  assert.deepEqual(paymentLines({ amount: 1000000, allocations }), allocations);
  assert.equal(RECHARGE_LINE_LABEL, 'Approvisionnement carte membre');
  assert.deepEqual(
    paymentLines({ kind: 'recharge', label: 'Approvisionnement de la carte membre', amount: 10000000, allocations: [] }),
    [{ label: 'Approvisionnement carte membre', quantity: 1, amount: 10000000 }],
  );
  assert.deepEqual(
    paymentLines({ kind: 'repas', label: 'Chez Fatou', amount: 1850000, allocations: [] }),
    [{ label: 'Chez Fatou', quantity: 1, amount: 1850000 }],
  );
});

test('ticketWhatsAppText : part de la carte, reste, solde, crédit temps et annulation', () => {
  const mixed = ticketWhatsAppText({ ...base, cardAmount: 2500000, balance: 0, timeAvailable: 90 });
  assert.ok(!mixed.includes('Payé : Espèces'));
  assert.ok(mixed.includes('Payé par carte membre : 25000 FCFA\nReste payé (Espèces) : 35000 FCFA\n'));
  assert.ok(mixed.includes('Solde carte : 0 FCFA\nCrédit temps (à ce jour) : 1 h 30 disponibles'));
  const allCard = ticketWhatsAppText({ ...base, method: 'Carte membre', cardAmount: 6000000, balance: 1000000 });
  assert.ok(allCard.includes('Payé par carte membre : 60000 FCFA\n'));
  assert.ok(!allCard.includes('Reste payé'));
  assert.ok(allCard.includes('Solde carte : 10000 FCFA'));
  assert.ok(!allCard.includes('Crédit temps'));
  const withRef = ticketWhatsAppText({ ...base, reference: 'MP9', cardAmount: 1000000 });
  assert.ok(withRef.includes('Reste payé (Espèces (MP9)) : 50000 FCFA'));
  // A cash-only receipt keeps its former text: no card line, no balance.
  const cash = ticketWhatsAppText({ ...base, balance: null, timeAvailable: null });
  assert.ok(cash.includes('Payé : Espèces'));
  assert.ok(!cash.includes('Solde carte'));
  assert.ok(ticketWhatsAppText({ ...base, cancelledAt: '2026-10-25T09:00:00' }).includes('Annulé le DT(2026-10-25T09:00:00)'));
});

test('mealWhatsAppText : repas, part carte, reste éventuel et nouveau solde', () => {
  const base = {
    clubName: 'THE LIMEN · Club privé', lastName: 'DUPONT', label: 'Le Gourmet, poulet braisé',
    at: '2026-10-24T19:41:00.000Z', timezone: 'Africa/Brazzaville',
  };
  const m = (n) => formatMoney(n * 100);
  assert.equal(mealWhatsAppText({ ...base, amount: 18500 * 100, cardAmount: 18500 * 100, balance: 31500 * 100 }), [
    'Bonjour Monsieur DUPONT,',
    `Votre repas « Le Gourmet, poulet braisé » du 24/10/2026 à 20:41 (${m(18500)}) a été payé par votre carte membre.`,
    `Votre nouveau solde est de ${m(31500)}.`,
    'Merci de votre confiance. L’équipe THE LIMEN · Club privé',
  ].join('\n'));
  assert.equal(mealWhatsAppText({ ...base, amount: 18500 * 100, cardAmount: 10000 * 100, balance: 0 }).split('\n')[1],
    `Votre repas « Le Gourmet, poulet braisé » du 24/10/2026 à 20:41 (${m(18500)}) : ${m(10000)} payés par votre carte membre, ${m(8500)} réglés à la caisse.`);
});

test('messages de la carte : numéro du ticket et lien de vérification', () => {
  const base = { clubName: 'Limen', lastName: 'DUPONT', at: '2026-10-24T19:41:00.000Z', timezone: 'Africa/Brazzaville' };
  const url = 'https://club.test/#/ticket/12/ABCDEFGHJKMN';
  const recharge = rechargeWhatsAppText({ ...base, amount: 100, balance: 100, number: 'T-000012', verifyUrl: url }).split('\n');
  assert.deepEqual(recharge.slice(3), ['Ticket T-000012 (ci-dessous)', `Vérifier le ticket : ${url}`, 'Merci de votre confiance. L’équipe Limen']);
  const meal = mealWhatsAppText({ ...base, label: 'Le Gourmet', amount: 100, cardAmount: 100, balance: 0, number: 'T-000013', verifyUrl: url }).split('\n');
  assert.deepEqual(meal.slice(3), ['Ticket T-000013 (ci-dessous)', `Vérifier le ticket : ${url}`, 'Merci de votre confiance. L’équipe Limen']);
  // The demo has no verification link: only the number.
  assert.ok(!rechargeWhatsAppText({ ...base, amount: 100, balance: 100, number: 'T-000012' }).includes('Vérifier'));
});

test('paymentWhatsAppText : consommations payées en espèces, par la carte ou les deux', () => {
  const base = { clubName: 'Limen', lastName: 'MARTIN', at: '2026-10-25T21:10:00.000Z', timezone: 'Africa/Brazzaville', number: 'T-000020' };
  const m = (n) => formatMoney(n * 100);
  assert.equal(paymentWhatsAppText({ ...base, amount: 75000 * 100, method: 'Espèces', for: 'cigares, alcool' }), [
    'Bonjour Monsieur MARTIN,',
    `Votre paiement de ${m(75000)} du 25/10/2026 à 22:10 (cigares, alcool) a bien été reçu (Espèces).`,
    'Ticket T-000020 (ci-dessous)',
    'Merci de votre confiance. L’équipe Limen',
  ].join('\n'));
  const card = paymentWhatsAppText({ ...base, amount: 75000 * 100, cardAmount: 75000 * 100, balance: 25000 * 100, method: 'Carte membre' }).split('\n');
  assert.deepEqual(card.slice(1, 3), [`Votre paiement de ${m(75000)} du 25/10/2026 à 22:10 a été payé par votre carte membre.`, `Votre nouveau solde est de ${m(25000)}.`]);
  const mixed = paymentWhatsAppText({ ...base, amount: 75000 * 100, cardAmount: 50000 * 100, balance: 0, method: 'Espèces' }).split('\n');
  assert.equal(mixed[1], `Votre paiement de ${m(75000)} du 25/10/2026 à 22:10 : ${m(50000)} payés par votre carte membre, ${m(25000)} réglés en Espèces.`);
});

test('rechargeWhatsAppText : montant, nouveau solde et date', () => {
  const text = rechargeWhatsAppText({
    clubName: 'THE LIMEN · Club privé', lastName: 'DUPONT', amount: 100000 * 100, balance: 100000 * 100,
    at: '2026-10-24T19:41:00.000Z', timezone: 'Africa/Brazzaville',
  });
  assert.match(text, /100\s000 FCFA/);
  assert.match(text, /Votre nouveau solde est de 100\s000 FCFA\./);
  const amount = formatMoney(100000 * 100);
  assert.equal(text, [
    'Bonjour Monsieur DUPONT,',
    `Votre carte membre a été approvisionnée de ${amount} le 24/10/2026 à 20:41.`,
    `Votre nouveau solde est de ${amount}.`,
    'Merci de votre confiance. L’équipe THE LIMEN · Club privé',
  ].join('\n'));
  // The club's currency, when given, is the one shown.
  const other = rechargeWhatsAppText({
    clubName: 'Club', lastName: 'DIALLO', amount: 2500, balance: 7500, at: '2026-01-02T08:00:00.000Z',
    timezone: 'UTC', currency: { label: 'EUR', decimals: 2 },
  });
  assert.match(other, /approvisionnée de 25,00 EUR le 02\/01\/2026 à 08:00\.\nVotre nouveau solde est de 75,00 EUR\./);
});

test('renewalWhatsAppText : bientôt et bloqué, avec ce qui manque', () => {
  const input = {
    clubName: 'THE LIMEN · Club privé', lastName: 'DUPONT', planName: 'Mensuelle', endDate: '2026-11-23',
    balance: 30000 * 100, price: 50000 * 100,
  };
  const m = (n) => formatMoney(n * 100);
  assert.equal(renewalWhatsAppText({ ...input, state: 'bientot' }), [
    'THE LIMEN · Club privé',
    'Bonjour Monsieur DUPONT,',
    `Votre abonnement Mensuelle se termine le 23/11/2026. Il se renouvelle avec votre carte membre, mais le solde ne suffit pas : ${m(30000)} sur la carte, ${m(50000)} nécessaires.`,
    `Il manque ${m(20000)} : approvisionnez votre carte pour que l’abonnement soit renouvelé.`,
  ].join('\n'));
  assert.equal(renewalWhatsAppText({ ...input, state: 'bloque' }), [
    'THE LIMEN · Club privé',
    'Bonjour Monsieur DUPONT,',
    `Votre abonnement Mensuelle s’est terminé le 23/11/2026. Renouvellement impossible : ${m(30000)} sur la carte, ${m(50000)} nécessaires.`,
    `Il manque ${m(20000)} : dès que vous approvisionnez votre carte, l’abonnement est renouvelé à partir du jour de l’approvisionnement.`,
  ].join('\n'));
  assert.match(renewalWhatsAppText({ ...input, state: 'bloque' }), /Il manque 20\s000 FCFA/);
});

test('weekdayDayText : jour de la semaine abrégé et date', () => {
  assert.equal(weekdayDayText('2026-10-27'), 'mar. 27/10/2026');
  assert.equal(weekdayDayText('2026-11-01'), 'dim. 01/11/2026');
  assert.equal(weekdayDayText('2026-10-31'), 'sam. 31/10/2026');
  assert.equal(weekdayDayText(''), '');
});

test('bookingWhatsAppText : une phrase par ligne, signée par l’équipe du club', () => {
  const booking = {
    clubName: 'Limen', lastName: 'MARTIN', roomName: 'Salon Principal', day: '2026-10-27',
    startTime: '20:00', endTime: '22:00', partySize: 2, number: 13,
  };
  assert.equal(bookingWhatsAppText(booking), [
    'Bonjour Monsieur MARTIN,',
    'Votre réservation au Salon Principal est confirmée pour le mar. 27/10/2026 de 20:00 à 22:00 (2 personnes).',
    'Réservation n° 13 (ci-dessous)',
    'Merci de votre confiance. L’équipe Limen',
  ].join('\n'));
  // One person is singular; a missing or broken party size counts one.
  assert.match(bookingWhatsAppText({ ...booking, partySize: 1 }), /\(1 personne\)\.\n/);
  assert.match(bookingWhatsAppText({ ...booking, partySize: null }), /\(1 personne\)\.\n/);
});

test('statementWhatsAppText : la période du relevé, une phrase par ligne, signée par l’équipe du club', () => {
  assert.equal(statementWhatsAppText({ clubName: 'Limen', lastName: ' MARTIN ', from: '2026-10-01', to: '2026-10-25' }), [
    'Bonjour Monsieur MARTIN,',
    'Voici votre relevé de compte du 01/10/2026 au 25/10/2026.',
    'Relevé (ci-dessous)',
    'Merci de votre confiance. L’équipe Limen',
  ].join('\n'));
});

test('Salutation : « Monsieur » et le nom de famille, « Monsieur » seul sans nom', () => {
  const at = { clubName: 'Limen', from: '2026-10-01', to: '2026-10-25' };
  assert.equal(statementWhatsAppText({ ...at, lastName: 'DUPONT' }).split('\n')[0], 'Bonjour Monsieur DUPONT,');
  assert.equal(statementWhatsAppText({ ...at, lastName: '  ' }).split('\n')[0], 'Bonjour Monsieur,');
});
