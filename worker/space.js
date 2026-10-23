// Which club answers an /api/* request: the real one, or the demo space. It lives apart from
// worker/index.js, which needs the Cloudflare runtime, so that the Node tests run this very code.
//
// The browser asks for the demo space with one header and says nothing else about itself. Who is
// asking is not its call: the real club checks the session cookie, and the demo space then serves the
// request as the account the real club vouched for. The identity travels as an argument of the call,
// never as a header, so there is nothing for a browser to forge.
import { sha256Hex, parseCookies } from './auth.js';
import { notSignedIn } from './errors.js';

export const SPACE_HEADER = 'x-club-espace';

// Sign-in, sign-out and installation work on sessions and accounts, which exist in the real club
// only: they go there whatever space the browser asks for. The demo space refuses them too
// (worker/api.js), so one mistake in this file is not enough to reach it.
export const ALWAYS_REAL = /^\/api\/(login|logout|setup)(\/|$)/;

// The answer the API gives a request without a valid session (errorResponse in worker/api.js), for
// the one request the router turns away itself.
function notSignedInResponse() {
  const { status, code, message } = notSignedIn();
  return new Response(JSON.stringify({ error: { code, message, details: null } }), {
    status,
    headers: {
      'X-Content-Type-Options': 'nosniff',
      'Referrer-Policy': 'same-origin',
      'X-Frame-Options': 'DENY',
      'Cache-Control': 'no-store',
      'Content-Type': 'application/json; charset=utf-8',
    },
  });
}

// `real`: { handle(request), demoContext(tokenHash) }, the real club. `demo`: { handleDemo(request,
// context) }, the demo space. Both answer asynchronously, as calls to a Durable Object do.
export async function routeApi(request, { real, demo }) {
  if (request.headers.get(SPACE_HEADER) !== 'demo' || ALWAYS_REAL.test(new URL(request.url).pathname)) {
    return real.handle(request);
  }
  // Step one: the real club checks the session. Without a valid one, the demo space is never called.
  const token = parseCookies(request.headers.get('cookie')).sid;
  const context = await real.demoContext(token ? await sha256Hex(token) : null);
  if (!context) return notSignedInResponse();
  // Step two: the demo space serves the request as the account the real club vouched for.
  return demo.handleDemo(request, context);
}
