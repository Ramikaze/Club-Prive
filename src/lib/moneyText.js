// '25 000' or '25000,50' -> 2500050 (hundredths). Returns null when not a valid amount.
export function parseMoney(text) {
  const t = String(text ?? '').replace(/[\s  ]/g, '').replace(',', '.');
  if (!/^\d+(\.\d{1,2})?$/.test(t)) return null;
  const [int, frac = ''] = t.split('.');
  return Number(int) * 100 + Number(`${frac}00`.slice(0, 2));
}

export const toMajor = (minor) => {
  if (minor == null) return '';
  return minor % 100 === 0 ? String(minor / 100) : (minor / 100).toFixed(2).replace('.', ',');
};
