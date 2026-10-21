// ISO/IEC 18004 QR Code generator (Byte mode, ECC Level M, Versions 1–10).
// Zero external dependencies; renders crisp vector SVG paths suitable for screen and 85.6 × 54 mm card printing.

const EXP = new Uint8Array(512);
const LOG = new Uint8Array(256);
(() => {
  let x = 1;
  for (let i = 0; i < 255; i += 1) {
    EXP[i] = x;
    LOG[x] = i;
    x <<= 1;
    if (x & 0x100) x ^= 0x11d;
  }
  for (let i = 255; i < 512; i += 1) EXP[i] = EXP[i - 255];
})();

function rsGeneratorPoly(degree) {
  let poly = new Uint8Array([1]);
  for (let i = 0; i < degree; i += 1) {
    const next = new Uint8Array(poly.length + 1);
    const root = EXP[i];
    for (let j = 0; j < poly.length; j += 1) {
      next[j] ^= poly[j];
      next[j + 1] ^= poly[j] ? EXP[LOG[poly[j]] + LOG[root]] : 0;
    }
    poly = next;
  }
  return poly;
}

function rsEncode(data, ecLen) {
  const gen = rsGeneratorPoly(ecLen);
  const rem = new Uint8Array(ecLen);
  for (let i = 0; i < data.length; i += 1) {
    const factor = data[i] ^ rem[0];
    rem.copyWithin(0, 1);
    rem[ecLen - 1] = 0;
    if (factor !== 0) {
      const logF = LOG[factor];
      for (let j = 0; j < ecLen; j += 1) {
        rem[j] ^= EXP[LOG[gen[j + 1]] + logF];
      }
    }
  }
  return rem;
}

// Version 1..10 table for ECC Level M: [totalDataCodewords, ecCodewordsPerBlock, numBlocksGroup1, dataCwGroup1, numBlocksGroup2, dataCwGroup2, alignCoords]
const VERSION_TABLE_M = [
  null,
  [16, 10, 1, 16, 0, 0, []],
  [28, 16, 1, 28, 0, 0, [6, 18]],
  [44, 26, 1, 44, 0, 0, [6, 22]],
  [64, 18, 2, 32, 0, 0, [6, 26]],
  [86, 24, 2, 43, 0, 0, [6, 30]],
  [108, 16, 4, 27, 0, 0, [6, 34]],
  [124, 18, 4, 31, 0, 0, [6, 22, 38]],
  [154, 22, 2, 38, 2, 39, [6, 24, 42]],
  [182, 22, 3, 36, 2, 37, [6, 26, 46]],
  [216, 26, 4, 43, 1, 44, [6, 28, 50]],
];

const MASK_FNS = [
  (r, c) => (r + c) % 2 === 0,
  (r) => r % 2 === 0,
  (_, c) => c % 3 === 0,
  (r, c) => (r + c) % 3 === 0,
  (r, c) => (Math.floor(r / 2) + Math.floor(c / 3)) % 2 === 0,
  (r, c) => ((r * c) % 2) + ((r * c) % 3) === 0,
  (r, c) => (((r * c) % 2) + ((r * c) % 3)) % 2 === 0,
  (r, c) => (((r + c) % 2) + ((r * c) % 3)) % 2 === 0,
];

function formatBits(ecLevelBits, mask) {
  const data = (ecLevelBits << 3) | mask;
  let rem = data << 10;
  for (let i = 14; i >= 10; i -= 1) {
    if ((rem >> i) & 1) rem ^= 0x537 << (i - 10);
  }
  return ((data << 10) | rem) ^ 0x5412;
}

function versionBits(version) {
  let rem = version << 12;
  for (let i = 17; i >= 12; i -= 1) {
    if ((rem >> i) & 1) rem ^= 0x1f25 << (i - 12);
  }
  return (version << 12) | rem;
}

function penaltyScore(grid, size) {
  let score = 0;
  // Rule 1: 5+ consecutive same-colored modules in row/col
  for (let r = 0; r < size; r += 1) {
    let runR = 1;
    let runC = 1;
    for (let c = 1; c < size; c += 1) {
      if (grid[r][c] === grid[r][c - 1]) {
        runR += 1;
        if (runR === 5) score += 3;
        else if (runR > 5) score += 1;
      } else runR = 1;
      if (grid[c][r] === grid[c - 1][r]) {
        runC += 1;
        if (runC === 5) score += 3;
        else if (runC > 5) score += 1;
      } else runC = 1;
    }
  }
  // Rule 2: 2x2 blocks
  for (let r = 0; r < size - 1; r += 1) {
    for (let c = 0; c < size - 1; c += 1) {
      const v = grid[r][c];
      if (v === grid[r][c + 1] && v === grid[r + 1][c] && v === grid[r + 1][c + 1]) score += 3;
    }
  }
  return score;
}

export function encodeQrMatrix(text) {
  const bytes = new TextEncoder().encode(String(text ?? ''));
  let version = 0;
  for (let v = 1; v <= 10; v += 1) {
    const countBits = v <= 9 ? 8 : 16;
    const totalDataCw = VERSION_TABLE_M[v][0];
    if (4 + countBits + bytes.length * 8 <= totalDataCw * 8) {
      version = v;
      break;
    }
  }
  if (!version) throw new Error('Texte trop long pour le QR code.');

  const [totalDataCw, ecCwPerBlock, g1Blocks, g1DataCw, g2Blocks, g2DataCw, alignCoords] = VERSION_TABLE_M[version];
  const countBits = version <= 9 ? 8 : 16;

  // Build bit stream
  const bits = [];
  const pushBits = (val, len) => {
    for (let i = len - 1; i >= 0; i -= 1) bits.push((val >> i) & 1);
  };
  pushBits(0b0100, 4); // Byte mode
  pushBits(bytes.length, countBits);
  for (const b of bytes) pushBits(b, 8);

  const maxBits = totalDataCw * 8;
  const term = Math.min(4, maxBits - bits.length);
  pushBits(0, term);
  while (bits.length % 8 !== 0) bits.push(0);

  const dataCw = new Uint8Array(totalDataCw);
  for (let i = 0; i < bits.length / 8; i += 1) {
    let b = 0;
    for (let j = 0; j < 8; j += 1) b = (b << 1) | bits[i * 8 + j];
    dataCw[i] = b;
  }
  const pads = [0xec, 0x11];
  for (let i = bits.length / 8, p = 0; i < totalDataCw; i += 1, p ^= 1) {
    dataCw[i] = pads[p];
  }

  // Split into blocks and compute Reed-Solomon EC
  const blocksData = [];
  const blocksEc = [];
  let offset = 0;
  for (let i = 0; i < g1Blocks; i += 1) {
    const slice = dataCw.subarray(offset, offset + g1DataCw);
    offset += g1DataCw;
    blocksData.push(slice);
    blocksEc.push(rsEncode(slice, ecCwPerBlock));
  }
  for (let i = 0; i < g2Blocks; i += 1) {
    const slice = dataCw.subarray(offset, offset + g2DataCw);
    offset += g2DataCw;
    blocksData.push(slice);
    blocksEc.push(rsEncode(slice, ecCwPerBlock));
  }

  // Interleave data and EC codewords
  const finalCw = [];
  const maxDataLen = Math.max(g1DataCw, g2DataCw);
  for (let i = 0; i < maxDataLen; i += 1) {
    for (const blk of blocksData) {
      if (i < blk.length) finalCw.push(blk[i]);
    }
  }
  for (let i = 0; i < ecCwPerBlock; i += 1) {
    for (const ec of blocksEc) finalCw.push(ec[i]);
  }

  const size = 17 + version * 4;
  const grid = Array.from({ length: size }, () => new Uint8Array(size));
  const reserved = Array.from({ length: size }, () => new Uint8Array(size));

  const setModule = (r, c, dark) => {
    if (r < 0 || r >= size || c < 0 || c >= size) return;
    grid[r][c] = dark ? 1 : 0;
    reserved[r][c] = 1;
  };

  // Finder patterns + separators
  const placeFinder = (row, col) => {
    for (let dr = -1; dr <= 7; dr += 1) {
      for (let dc = -1; dc <= 7; dc += 1) {
        const inOuter = dr >= 0 && dr <= 6 && dc >= 0 && dc <= 6;
        const onBorder = dr === 0 || dr === 6 || dc === 0 || dc === 6;
        const inCenter = dr >= 2 && dr <= 4 && dc >= 2 && dc <= 4;
        setModule(row + dr, col + dc, inOuter && (onBorder || inCenter));
      }
    }
  };
  placeFinder(0, 0);
  placeFinder(0, size - 7);
  placeFinder(size - 7, 0);

  // Alignment patterns
  for (const r of alignCoords) {
    for (const c of alignCoords) {
      if (reserved[r][c]) continue;
      for (let dr = -2; dr <= 2; dr += 1) {
        for (let dc = -2; dc <= 2; dc += 1) {
          const dark = Math.max(Math.abs(dr), Math.abs(dc)) !== 1;
          setModule(r + dr, c + dc, dark);
        }
      }
    }
  }

  // Timing patterns
  for (let i = 8; i < size - 8; i += 1) {
    if (!reserved[6][i]) setModule(6, i, i % 2 === 0);
    if (!reserved[i][6]) setModule(i, 6, i % 2 === 0);
  }

  // Dark module & format reserve
  setModule(size - 8, 8, true);
  for (let i = 0; i < 9; i += 1) {
    if (!reserved[8][i]) reserved[8][i] = 1;
    if (!reserved[i][8]) reserved[i][8] = 1;
  }
  for (let i = 0; i < 8; i += 1) {
    if (!reserved[8][size - 1 - i]) reserved[8][size - 1 - i] = 1;
    if (!reserved[size - 1 - i][8]) reserved[size - 1 - i][8] = 1;
  }

  // Version info (V >= 7)
  if (version >= 7) {
    const vBits = versionBits(version);
    for (let i = 0; i < 18; i += 1) {
      const bit = (vBits >> i) & 1;
      const a = size - 11 + (i % 3);
      const b = Math.floor(i / 3);
      setModule(b, a, bit);
      setModule(a, b, bit);
    }
  }

  // Place data bits in zig-zag
  const streamBits = [];
  for (const cw of finalCw) {
    for (let i = 7; i >= 0; i -= 1) streamBits.push((cw >> i) & 1);
  }
  let bitIdx = 0;
  let upward = true;
  for (let right = size - 1; right >= 1; right -= 2) {
    if (right === 6) right = 5;
    for (let vert = 0; vert < size; vert += 1) {
      const r = upward ? size - 1 - vert : vert;
      for (let j = 0; j < 2; j += 1) {
        const c = right - j;
        if (!reserved[r][c]) {
          grid[r][c] = bitIdx < streamBits.length ? streamBits[bitIdx] : 0;
          bitIdx += 1;
        }
      }
    }
    upward = !upward;
  }

  const writeFormat = (target, mask) => {
    // ECC Level M indicator in format info is 0b00
    const fBits = formatBits(0b00, mask);
    // Top-left vertical (bits 0..7) & horizontal (bits 8..14)
    for (let i = 0; i <= 5; i += 1) target[i][8] = (fBits >> i) & 1;
    target[7][8] = (fBits >> 6) & 1;
    target[8][8] = (fBits >> 7) & 1;
    target[8][7] = (fBits >> 8) & 1;
    for (let i = 9; i < 15; i += 1) target[8][14 - i] = (fBits >> i) & 1;

    // Top-right horizontal (bits 0..7) & bottom-left vertical (bits 8..14)
    for (let i = 0; i <= 7; i += 1) target[8][size - 1 - i] = (fBits >> i) & 1;
    for (let i = 8; i < 15; i += 1) target[size - 15 + i][8] = (fBits >> i) & 1;
  };

  // Pick mask with lowest penalty
  let bestMask = 0;
  let bestScore = Infinity;
  let bestGrid = null;
  for (let m = 0; m < 8; m += 1) {
    const candidate = grid.map((row) => new Uint8Array(row));
    const fn = MASK_FNS[m];
    for (let r = 0; r < size; r += 1) {
      for (let c = 0; c < size; c += 1) {
        if (!reserved[r][c] && fn(r, c)) candidate[r][c] ^= 1;
      }
    }
    writeFormat(candidate, m);
    const sc = penaltyScore(candidate, size);
    if (sc < bestScore) {
      bestScore = sc;
      bestMask = m;
      bestGrid = candidate;
    }
  }

  return { size, modules: bestGrid, mask: bestMask, version };
}

export function qrSvgPath(matrix, margin = 2) {
  const { size, modules } = matrix;
  let d = '';
  for (let r = 0; r < size; r += 1) {
    for (let c = 0; c < size; c += 1) {
      if (modules[r][c]) {
        d += `M${c + margin},${r + margin}h1v1h-1z`;
      }
    }
  }
  return { viewBoxSize: size + margin * 2, path: d };
}
