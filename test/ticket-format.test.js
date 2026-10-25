// The cash receipt's shared formatting (shared/ticket.js): number, code, initials and the WhatsApp text.
// Everything here is made up; no real code or phone number is written in the repository.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  TICKET_ALPHABET, TICKET_CODE_LENGTH, newTicketCode, formatTicketNumber, formatTicketCode,
  normalizeTicketCode, memberInitials, ticketVerifyUrl, ticketWhatsAppText, paymentLines, RECHARGE_LINE_LABEL,
} from '../shared/ticket.js';
import { rechargeWhatsAppText, renewalWhatsAppText } from '../shared/wallet.js';
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
  assert.equal(RECHARGE_LINE_LABEL, 'Recharge carte membre');
  assert.deepEqual(
    paymentLines({ kind: 'recharge', label: 'Recharge de la carte membre', amount: 10000000, allocations: [] }),
    [{ label: 'Recharge carte membre', quantity: 1, amount: 10000000 }],
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

test('rechargeWhatsAppText : montant, nouveau solde et date', () => {
  const text = rechargeWhatsAppText({
    clubName: 'THE LIMEN · Club privé', firstName: 'Jean', amount: 100000 * 100, balance: 100000 * 100,
    at: '2026-10-24T19:41:00.000Z', timezone: 'Africa/Brazzaville',
  });
  assert.match(text, /100\s000 FCFA/);
  assert.match(text, /nouveau solde 100\s000 FCFA/);
  const amount = formatMoney(100000 * 100);
  assert.equal(text, [
    'THE LIMEN · Club privé',
    'Bonjour Jean,',
    `Votre carte membre a été rechargée de ${amount} le 24/10/2026 à 20:41 : nouveau solde ${amount}.`,
    'Merci de votre confiance.',
  ].join('\n'));
  // The club's currency, when given, is the one shown.
  const other = rechargeWhatsAppText({
    clubName: 'Club', firstName: 'Awa', amount: 2500, balance: 7500, at: '2026-01-02T08:00:00.000Z',
    timezone: 'UTC', currency: { label: 'EUR', decimals: 2 },
  });
  assert.match(other, /rechargée de 25,00 EUR le 02\/01\/2026 à 08:00 : nouveau solde 75,00 EUR\./);
});

test('renewalWhatsAppText : bientôt et bloqué, avec ce qui manque', () => {
  const input = {
    clubName: 'THE LIMEN · Club privé', firstName: 'Jean', planName: 'Mensuelle', endDate: '2026-11-23',
    balance: 30000 * 100, price: 50000 * 100,
  };
  const m = (n) => formatMoney(n * 100);
  assert.equal(renewalWhatsAppText({ ...input, state: 'bientot' }), [
    'THE LIMEN · Club privé',
    'Bonjour Jean,',
    `Votre abonnement Mensuelle se termine le 23/11/2026. Il se renouvelle avec votre carte membre, mais le solde ne suffit pas : ${m(30000)} sur la carte, ${m(50000)} nécessaires.`,
    `Il manque ${m(20000)} : rechargez votre carte pour que l’abonnement soit renouvelé.`,
  ].join('\n'));
  assert.equal(renewalWhatsAppText({ ...input, state: 'bloque' }), [
    'THE LIMEN · Club privé',
    'Bonjour Jean,',
    `Votre abonnement Mensuelle s’est terminé le 23/11/2026. Renouvellement impossible : ${m(30000)} sur la carte, ${m(50000)} nécessaires.`,
    `Il manque ${m(20000)} : dès que vous rechargez votre carte, l’abonnement est renouvelé à partir du jour de la recharge.`,
  ].join('\n'));
  assert.match(renewalWhatsAppText({ ...input, state: 'bloque' }), /Il manque 20\s000 FCFA/);
});
