// Makes the club's VAPID key pair, which signs the push notifications sent to the staff's devices (worker/push.js),
// and prints the three Worker secrets to create with it. Run once, on the owner's computer:
//
//   node scripts/vapid-keys.mjs mailto:adresse@du-club.com
//
// then paste each value when `npx wrangler secret put <NAME>` asks for it. The private key is shown here only: it is
// not written to any file, and must never go into the repository (it is public). A new pair makes every device turn
// notifications on again (its subscription belongs to the old public key).
const subject = process.argv[2] ?? 'mailto:adresse@du-club.com';
if (!/^(mailto:\S+@\S+|https:\/\/\S+)$/.test(subject)) {
  console.error('Le contact (VAPID_SUBJECT) est une adresse « mailto:… » ou « https://… ».');
  process.exit(1);
}

const pair = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify']);
const publicKey = Buffer.from(await crypto.subtle.exportKey('raw', pair.publicKey)).toString('base64url');
const { d: privateKey } = await crypto.subtle.exportKey('jwk', pair.privateKey);

console.log(`Les trois secrets des notifications push (à coller quand wrangler les demande) :

  npx wrangler secret put VAPID_PUBLIC_KEY
    ${publicKey}

  npx wrangler secret put VAPID_PRIVATE_KEY
    ${privateKey}

  npx wrangler secret put VAPID_SUBJECT
    ${subject}
${process.argv[2] ? '' : '\n(Contact par défaut : relancez avec votre adresse, par exemple node scripts/vapid-keys.mjs mailto:vous@exemple.com.)\n'}`);
