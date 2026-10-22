// Cigar smoke behind the sign-in card, like filmed smoke on a dark background: soft white volumes
// rising from the bottom of the screen across its whole width, folding and curling, then thinning
// out towards the top. A WebGL fragment shader computes the smoke density of every pixel from
// fractal noise warped by itself (domain warping: the noise bends its own coordinates, which gives
// the swirls and folds of smoke); the whole field drifts upward and slowly changes shape. The
// canvas is transparent: the smoke is drawn over the page's brown background. Rendered at about
// the screen's resolution, at most 30 frames per second. One still frame under reduced motion;
// the browser pauses the loop while the tab is hidden. Without WebGL the page simply has no smoke.
import { prefersReducedMotion } from './smoke.js';

const FRAME_MS = 1000 / 30;
const STILL_TIME = 40; // seconds into the smoke, for the frame shown under reduced motion
const MAX_PIXELS = 1.3e6; // rendering budget: the resolution drops on very large screens

const VERTEX = `
attribute vec2 aPos;
varying vec2 vUv;
void main() {
  vUv = aPos * 0.5 + 0.5;
  gl_Position = vec4(aPos, 0.0, 1.0);
}`;

const FRAGMENT = `
#ifdef GL_FRAGMENT_PRECISION_HIGH
precision highp float;
#else
precision mediump float;
#endif
uniform vec2 uRes;
uniform float uTime;
varying vec2 vUv;

float hash(vec2 p) {
  p = fract(p * vec2(123.34, 456.21));
  p += dot(p, p + 45.32);
  return fract(p.x * p.y);
}

// Value noise with quintic smoothing, in [0, 1].
float noise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  vec2 u = f * f * f * (f * (f * 6.0 - 15.0) + 10.0);
  float a = hash(i);
  float b = hash(i + vec2(1.0, 0.0));
  float c = hash(i + vec2(0.0, 1.0));
  float d = hash(i + vec2(1.0, 1.0));
  return mix(mix(a, b, u.x), mix(c, d, u.x), u.y);
}

// Five octaves, each turned a little to hide the grid of the noise.
float fbm(vec2 p) {
  float v = 0.0;
  float a = 0.5;
  mat2 turn = mat2(0.8, -0.6, 0.6, 0.8);
  for (int i = 0; i < 5; i++) {
    v += a * noise(p);
    p = turn * p * 2.03 + vec2(1.7, 9.2);
    a *= 0.5;
  }
  return v;
}

// One plume rising from the bottom edge at x (in the same units as p): it widens as it climbs,
// meanders and sways, and its edges are frayed by the warped noise. Returns 0..1.
float plume(vec2 p, float x, float seed, float t, float height, vec2 fray) {
  float sway = 0.22 * sin(t * 0.07 + seed * 2.1);
  float meander = (fbm(vec2(p.y * 0.7 - t * 0.12, seed * 7.0)) - 0.5) * 1.6 * height;
  float width = 0.32 + 0.7 * height;
  float d = (p.x + (fray.x - 0.5) * 0.9 - x - sway - meander) / width;
  return exp(-d * d);
}

void main() {
  float aspect = uRes.x / uRes.y;
  vec2 uv = vUv;
  float zoom = 1.7;
  vec2 p = vec2(uv.x * aspect, uv.y) * zoom;
  float t = uTime;

  // The field rises: sampling further down as time goes moves every feature up the screen.
  vec2 rise = vec2(0.0, -t * 0.12);

  // Domain warping, twice: the swirls bend the smoke, and the smoke bends the swirls.
  vec2 q = vec2(
    fbm(p + rise + vec2(0.0, t * 0.02)),
    fbm(p + rise + vec2(5.2, 1.3) - vec2(t * 0.015, 0.0)));
  vec2 r = vec2(
    fbm(p + rise + 1.7 * q + vec2(1.7, 9.2) + vec2(t * 0.04, 0.0)),
    fbm(p + rise + 1.7 * q + vec2(8.3, 2.8) - vec2(0.0, t * 0.03)));
  float n = fbm(p + rise + 1.9 * r);

  // Three plumes from the bottom edge, as in filmed smoke, with dark air between them.
  float width = aspect * zoom;
  float a = plume(p, width * 0.17, 1.0, t, uv.y, q);
  float b = plume(p, width * 0.5, 2.0, t, uv.y, q);
  float c = plume(p, width * 0.83, 3.0, t, uv.y, q);
  float plumes = 1.0 - (1.0 - a) * (1.0 - b) * (1.0 - c);

  // Density: billows where the warped noise is high, with soft frayed edges.
  float body = smoothstep(0.42, 0.78, n) * plumes;

  // Fine bright folds inside the smoke, like the sheets that catch the light in filmed smoke.
  float fold = fbm(p * 1.9 + rise * 1.4 + 2.5 * r);
  float sheet = pow(1.0 - abs(2.0 * fold - 1.0), 6.0);

  // The smoke comes up from the bottom edge, thick there, and thins out as it rises, gone near
  // the top of the screen.
  float rising = smoothstep(1.2, 0.0, uv.y);

  float alpha = clamp(pow(body, 0.8) * rising * 1.35 * (0.85 + 0.35 * sheet), 0.0, 0.95);
  vec3 shadow = vec3(0.62, 0.58, 0.54);
  vec3 light = vec3(1.0, 0.97, 0.93);
  vec3 color = mix(shadow, light, clamp(body * 1.1 + sheet * 0.3, 0.0, 1.0));
  gl_FragColor = vec4(color * alpha, alpha);
}`;

function compile(gl, type, source) {
  const shader = gl.createShader(type);
  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    gl.deleteShader(shader);
    return null;
  }
  return shader;
}

export function startAmbientSmoke(canvas) {
  const gl = canvas.getContext('webgl', {
    alpha: true, premultipliedAlpha: true, antialias: false, depth: false, stencil: false, powerPreference: 'low-power',
  });
  if (!gl) return () => {};
  const vertex = compile(gl, gl.VERTEX_SHADER, VERTEX);
  const fragment = compile(gl, gl.FRAGMENT_SHADER, FRAGMENT);
  if (!vertex || !fragment) return () => {};
  const program = gl.createProgram();
  gl.attachShader(program, vertex);
  gl.attachShader(program, fragment);
  gl.linkProgram(program);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) return () => {};
  gl.useProgram(program);

  const quad = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, quad);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
  const aPos = gl.getAttribLocation(program, 'aPos');
  gl.enableVertexAttribArray(aPos);
  gl.vertexAttribPointer(aPos, 2, gl.FLOAT, false, 0, 0);
  const uRes = gl.getUniformLocation(program, 'uRes');
  const uTime = gl.getUniformLocation(program, 'uTime');

  const still = prefersReducedMotion();
  let raf = 0;
  let clock = STILL_TIME;
  let lost = false;

  const draw = () => {
    if (lost) return;
    gl.uniform1f(uTime, clock);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
  };

  const resize = () => {
    const w = canvas.clientWidth;
    const h = canvas.clientHeight;
    let scale = Math.min(window.devicePixelRatio || 1, 1.5);
    if (w * h * scale * scale > MAX_PIXELS) scale = Math.sqrt(MAX_PIXELS / (w * h));
    canvas.width = Math.max(1, Math.round(w * scale));
    canvas.height = Math.max(1, Math.round(h * scale));
    gl.viewport(0, 0, canvas.width, canvas.height);
    gl.uniform2f(uRes, canvas.width, canvas.height);
    draw(); // resizing clears the canvas: redraw at once rather than wait for the next frame
  };

  const onLost = (e) => {
    e.preventDefault();
    lost = true;
    cancelAnimationFrame(raf);
  };
  canvas.addEventListener('webglcontextlost', onLost);

  const observer = new ResizeObserver(resize);
  observer.observe(canvas);
  resize();
  if (!still) {
    const start = performance.now() - STILL_TIME * 1000;
    let last = 0;
    const frame = (now) => {
      if (now - last >= FRAME_MS) {
        last = now;
        clock = (now - start) / 1000;
        draw();
      }
      raf = requestAnimationFrame(frame);
    };
    raf = requestAnimationFrame(frame);
  }
  return () => {
    cancelAnimationFrame(raf);
    observer.disconnect();
    canvas.removeEventListener('webglcontextlost', onLost);
  };
}
