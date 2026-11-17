// The message that goes with the member card's picture on WhatsApp.
import test from 'node:test';
import assert from 'node:assert/strict';
import { cardWhatsAppText } from '../shared/wallet.js';

test('cardWhatsAppText : salutation, carte et code, signature du club', () => {
  assert.equal(cardWhatsAppText({ clubName: 'Limen', lastName: 'MARTIN', code: 'LIM-0042' }), [
    'Bonjour Monsieur MARTIN,',
    'Voici votre carte de membre Limen n° LIM-0042 (recto et verso ci-dessous).',
    'Merci de votre confiance. L’équipe Limen',
  ].join('\n'));
});

test('cardWhatsAppText : sans nom de famille ni nom du club, le message reste lisible', () => {
  assert.equal(cardWhatsAppText({ code: ' LIM-0007 ' }), [
    'Bonjour Monsieur,',
    'Voici votre carte de membre n° LIM-0007 (recto et verso ci-dessous).',
    'Merci de votre confiance.',
  ].join('\n'));
});
