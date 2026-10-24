// The cash receipt's shared formatting (shared/ticket.js): number, code, initials and the WhatsApp text.
// Everything here is made up; no real code or phone number is written in the repository.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  TICKET_ALPHABET, TICKET_CODE_LENGTH, newTicketCode, formatTicketNumber, formatTicketCode,
  normalizeTicketCode, memberInitials, ticketVerifyUrl, ticketWhatsAppText,
} from '../shared/ticket.js';

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
