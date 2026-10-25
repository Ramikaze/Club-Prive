// The member card as the validated mockup draws it: black, a fine gold border, a gold chip and the club's logo on
// the front, the name and the code at the bottom left; the back carries the card's real QR code, large, and its
// code. On screen it tilts under the pointer or the finger (±8° up and down, ±11° sideways) with a gold glare that
// follows the gesture, and a click (or Enter, or Space) turns it over. A device asking for reduced motion keeps
// the card still: no tilt, no moving glare, the turn alone.
//
// `qrPath` is the route the QR code opens in the app (`/membres/12?card=CODE`); it is made into a full link on
// this site, as the printed card does. Only an active card has a back: without a code (a member with no card) or
// for a deactivated card, the card is drawn greyed, with no QR and no turn. `interactive={false}` draws it flat and still, showing `side` ('front' or 'back'), for print.
import { useMemo, useRef, useState } from 'react';
import { encodeQrMatrix, qrSvgPath } from '../../lib/qrcode.js';

const LOGO = '/limen-or-noir.jpg';
const TILT_X = 8; // degrees, up and down
const TILT_Y = 11; // degrees, sideways

function CardQr({ value, label }) {
  const { viewBoxSize, path } = useMemo(() => qrSvgPath(encodeQrMatrix(value), 2), [value]);
  return (
    <svg role="img" viewBox={`0 0 ${viewBoxSize} ${viewBoxSize}`} shapeRendering="crispEdges">
      <title>{label}</title>
      <path d={path} fill="#0a0908" />
    </svg>
  );
}

const reducedMotion = () => typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

export default function MemberCard3D({ name, code, active = true, qrPath, interactive = true, side = 'front' }) {
  const ref = useRef(null);
  const [flipped, setFlipped] = useState(side === 'back');
  // Only an active card turns over: a deactivated card must not show its QR code in large.
  const hasBack = Boolean(active && code && qrPath);
  const turned = hasBack && flipped;
  const qrValue = hasBack ? `${window.location.origin}${window.location.pathname}#${qrPath}` : '';
  // The pointer handlers read these refs, not the render's values: a move right after a click must already see the
  // card turned, and the tilt of that moment is kept by the turn.
  const turnedRef = useRef(turned);
  turnedRef.current = turned;
  const tilt = useRef({ rx: 0, ry: 0 });
  const turningUntil = useRef(0);

  // The tilt and the glare are written straight on the element: they follow the pointer at every move, which a
  // React render each time would only slow down. The written transform always carries the turn (180° around Y),
  // so it never hides it; while the card is turning, the slow transition of the turn is kept.
  const place = (isTurned) => {
    const el = ref.current;
    if (!el) return;
    const { rx, ry } = tilt.current;
    el.style.transition = Date.now() < turningUntil.current ? '' : 'transform .08s linear';
    el.style.transform = `rotateX(${rx}deg) rotateY(${ry + (isTurned ? 180 : 0)}deg)`;
  };
  const rest = () => {
    const el = ref.current;
    if (!el) return;
    tilt.current = { rx: 0, ry: 0 };
    el.style.transition = '';
    el.style.transform = '';
    el.style.removeProperty('--gx');
    el.style.removeProperty('--gy');
  };

  const onPointerMove = (e) => {
    if (reducedMotion()) return;
    const el = ref.current;
    const r = el.getBoundingClientRect();
    const isTurned = turnedRef.current;
    // Seen from the back, the card's left is the screen's right: the tilt is mirrored so it follows the pointer.
    let x = (e.clientX - r.left) / r.width;
    const y = (e.clientY - r.top) / r.height;
    if (isTurned) x = 1 - x;
    tilt.current = { rx: (0.5 - y) * 2 * TILT_X, ry: (x - 0.5) * 2 * TILT_Y };
    place(isTurned);
    el.style.setProperty('--gx', `${x * 100}%`);
    el.style.setProperty('--gy', `${y * 100}%`);
  };

  const turn = () => {
    if (!hasBack) return;
    const next = !turnedRef.current;
    turnedRef.current = next;
    // The turn plays at once with its own transition (0.5 s, see .c3d), from the tilt of the moment.
    turningUntil.current = reducedMotion() ? 0 : Date.now() + 500;
    if (ref.current?.style.transform) place(next);
    setFlipped(next);
  };
  const onKeyDown = (e) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      if (e.repeat) return;
      turn();
    }
  };

  const who = (name ?? '').toUpperCase();
  const front = (
    <div className="c3d-face c3d-front">
      <div className="c3d-chip" />
      <img className="c3d-logo" src={LOGO} alt="" draggable="false" />
      <div className="c3d-name">{who}</div>
      <div className="c3d-code">{code ?? 'AUCUNE CARTE'}</div>
      <div className="c3d-shine" /><div className="c3d-glare" />
    </div>
  );
  const back = hasBack ? (
    <div className="c3d-face c3d-back">
      <div className="c3d-qr"><CardQr value={qrValue} label={`QR code de la carte ${code} (${name})`} /></div>
      <div className="c3d-note">{code} · THE LIMEN</div>
      <div className="c3d-shine" /><div className="c3d-glare" />
    </div>
  ) : null;

  const className = `c3d ${turned ? 'is-turned' : ''} ${active ? '' : 'is-inactive'} ${interactive ? 'is-interactive' : ''}`;
  if (!interactive) {
    return (
      <div className="c3d-stage">
        <div className={className} role="img" aria-label={`Carte de membre de ${name}${code ? `, ${code}` : ''}`}>{front}{back}</div>
      </div>
    );
  }
  return (
    <div className="c3d-stage">
      <div
        ref={ref}
        className={className}
        role={hasBack ? 'button' : 'img'}
        tabIndex={hasBack ? 0 : undefined}
        aria-pressed={hasBack ? turned : undefined}
        aria-label={hasBack
          ? `Carte de membre de ${name}, ${code}. ${turned ? 'Verso, QR code affiché' : 'Recto'} : appuyer pour retourner la carte.`
          : `Carte de membre de ${name} : ${code ? `carte ${code} désactivée` : 'aucune carte active'}.`}
        onPointerMove={onPointerMove}
        onPointerLeave={rest}
        onClick={turn}
        onKeyDown={onKeyDown}
      >
        {front}{back}
      </div>
      {hasBack ? <p className="c3d-hint">{turned ? 'Cliquez sur la carte pour revenir au recto.' : 'Cliquez sur la carte pour afficher le QR code.'}</p> : null}
    </div>
  );
}
