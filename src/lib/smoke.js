// Cigar smoke for the theme switch. Puffs rise from the bottom of the screen and from the button that
// was pressed, thicken into a veil of the new theme's colour, the theme changes behind it at its
// densest, then the smoke drifts up and clears. One canvas at half resolution (smoke is soft
// anyway), removed when done. With reduced motion, only a short veil fades in and out.
const DURATION = 1200;
const REDUCED_DURATION = 360;
const SWAP_AT = 0.4; // fraction of the duration where the veil is densest
const RESOLUTION = 0.5;

const PALETTES = {
  light: { veil: [245, 237, 224], puffs: [[252, 247, 238], [226, 213, 192]] },
  dark: { veil: [20, 18, 16], puffs: [[48, 41, 35], [12, 11, 10]] },
};

const clamp01 = (t) => Math.min(1, Math.max(0, t));
const smoother = (t) => t * t * t * (t * (t * 6 - 15) + 10);
const easeOut = (t) => 1 - (1 - t) ** 3;
const rand = (a, b) => a + Math.random() * (b - a);

export const prefersReducedMotion = () => window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;

// A cluster of soft lobes reads as a puff of smoke rather than a disc. Lobes stay inside the square.
function puffSprite([r, g, b], size = 160) {
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');
  for (let i = 0; i < 16; i += 1) {
    const angle = Math.random() * Math.PI * 2;
    const distance = Math.random() * size * 0.12;
    const x = size / 2 + Math.cos(angle) * distance;
    const y = size / 2 + Math.sin(angle) * distance;
    const radius = size * rand(0.2, 0.36);
    const gradient = ctx.createRadialGradient(x, y, 0, x, y, radius);
    gradient.addColorStop(0, `rgba(${r}, ${g}, ${b}, 0.17)`);
    gradient.addColorStop(1, `rgba(${r}, ${g}, ${b}, 0)`);
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, size, size);
  }
  return canvas;
}

function makePuffs(w, h, origin, sprites) {
  const span = Math.max(w, h);
  const count = Math.round(Math.min(64, Math.max(30, (w * h) / 5200)));
  const puffs = [];
  for (let i = 0; i < count; i += 1) {
    const fromButton = origin && i < 8;
    const start = fromButton ? rand(0, 0.08) : rand(0, 0.32);
    puffs.push({
      sprite: sprites[i % sprites.length],
      start,
      end: Math.min(1, start + rand(0.6, 0.85)),
      x: fromButton ? origin.x * RESOLUTION : rand(-0.1, 1.1) * w,
      y: fromButton ? origin.y * RESOLUTION : h + span * 0.12,
      drift: rand(-0.12, 0.12) * w,
      rise: fromButton ? rand(0.25, 0.5) * h : rand(0.75, 1.25) * h,
      size0: (fromButton ? rand(0.08, 0.14) : rand(0.32, 0.55)) * span,
      grow: fromButton ? rand(2.4, 3.4) : rand(1.5, 2.1),
      angle: rand(0, Math.PI * 2),
      spin: rand(-0.8, 0.8),
      wobble: rand(8, 22),
      phase: rand(0, Math.PI * 2),
      peak: rand(0.45, 0.75),
    });
  }
  return puffs;
}

// Veil opacity over the animation: rises to near-opaque at SWAP_AT, then clears.
function veilAt(t, peak) {
  if (t <= SWAP_AT) return smoother(t / SWAP_AT) * peak;
  return (1 - smoother(clamp01((t - SWAP_AT) / (0.95 - SWAP_AT)))) * peak;
}

// Plays the smoke and calls onCovered() once, when the screen is hidden. Resolves when it is gone.
export function smokeTransition({ to, origin = null, onCovered }) {
  const palette = PALETTES[to] ?? PALETTES.dark;
  const reduced = prefersReducedMotion();
  const duration = reduced ? REDUCED_DURATION : DURATION;
  let covered = false;
  const cover = () => {
    if (covered) return;
    covered = true;
    onCovered();
  };

  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d');
  if (!ctx) {
    cover();
    return Promise.resolve();
  }
  const w = Math.ceil(window.innerWidth * RESOLUTION);
  const h = Math.ceil(window.innerHeight * RESOLUTION);
  canvas.width = w;
  canvas.height = h;
  canvas.className = 'smoke-layer';
  canvas.setAttribute('aria-hidden', 'true');
  document.body.append(canvas);

  const puffs = reduced ? [] : makePuffs(w, h, origin, palette.puffs.map((c) => puffSprite(c)));
  const [vr, vg, vb] = palette.veil;
  const veilPeak = reduced ? 1 : 0.96;

  return new Promise((resolve) => {
    let begin = null;
    let frame = 0;
    const finish = () => {
      cancelAnimationFrame(frame);
      cover();
      canvas.remove();
      resolve();
    };
    // Timers keep the switch and the clean-up going if frames are throttled (hidden tab).
    const swapTimer = setTimeout(cover, duration * SWAP_AT + 150);
    const endTimer = setTimeout(finish, duration + 400);

    const draw = (now) => {
      begin ??= now;
      const t = clamp01((now - begin) / duration);
      ctx.clearRect(0, 0, w, h);
      ctx.globalAlpha = veilAt(t, veilPeak);
      ctx.fillStyle = `rgb(${vr}, ${vg}, ${vb})`;
      ctx.fillRect(0, 0, w, h);
      for (const p of puffs) {
        if (t < p.start || t > p.end) continue;
        const u = (t - p.start) / (p.end - p.start);
        const size = p.size0 * (1 + (p.grow - 1) * easeOut(u));
        const x = p.x + p.drift * u + Math.sin(u * Math.PI * 2 + p.phase) * p.wobble;
        const y = p.y - p.rise * easeOut(u);
        ctx.globalAlpha = p.peak * Math.sin(Math.PI * u);
        ctx.save();
        ctx.translate(x, y);
        ctx.rotate(p.angle + p.spin * u);
        ctx.drawImage(p.sprite, -size / 2, -size / 2, size, size);
        ctx.restore();
      }
      if (t >= SWAP_AT) cover();
      if (t >= 1) {
        clearTimeout(swapTimer);
        clearTimeout(endTimer);
        finish();
        return;
      }
      frame = requestAnimationFrame(draw);
    };
    frame = requestAnimationFrame(draw);
  });
}
