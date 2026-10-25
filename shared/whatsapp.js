// The messages a manager sends to a member on WhatsApp. These pure functions build the number and the wa.me
// link in the browser (the messages themselves are in shared/wallet.js); nothing here sends anything: the link is
// opened by the manager's own click, and WhatsApp waits for him to press « Envoyer ».

const clean = (value) => String(value ?? '').trim();

// The digits of a member's phone number as wa.me wants them (country code first, no + and no 00), or null
// when the number cannot be used. People type it in any form, so:
//  - a + or a 00 in front says the number is international already;
//  - a local Congolese number is 9 digits starting with 0 (06 000 00 00): it gets the country code 242;
//  - an international number is 8 to 15 digits and never starts with 0. A number that still does is a
//    national number of some other country, which WhatsApp could not find: it is not usable either.
export function waDigits(phone) {
  const raw = clean(phone);
  let digits = raw.replace(/\D/g, '');
  if (digits.startsWith('00')) digits = digits.slice(2);
  else if (!raw.startsWith('+') && digits.length === 9 && digits.startsWith('0')) digits = `242${digits}`;
  return digits.length >= 8 && digits.length <= 15 && !digits.startsWith('0') ? digits : null;
}

// The wa.me link that opens WhatsApp on the message, written to `digits` (from waDigits) or, without a
// usable number, to nobody: WhatsApp then lets the manager pick the contact himself.
export function waLink(digits, text) {
  return `https://wa.me/${clean(digits).replace(/\D/g, '')}?text=${encodeURIComponent(String(text ?? ''))}`;
}
