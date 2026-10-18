// Input validation helpers shared by the business modules. Errors carry French messages for the UI.
import { invalid } from './errors.js';

export const frDate = (d) => (d ? `${d.slice(8, 10)}/${d.slice(5, 7)}/${d.slice(0, 4)}` : '');
export const flag = (v) => v === true || v === 1 || v === '1' || v === 'true';

export function text(v, label, { required = false, max = 200, min = 0 } = {}) {
  if (v === undefined || v === null || (typeof v === 'string' && v.trim() === '')) {
    if (required) throw invalid(`${label} : champ obligatoire.`);
    return null;
  }
  if (typeof v !== 'string' && typeof v !== 'number') throw invalid(`${label} : valeur invalide.`);
  const t = String(v).trim();
  if (t.length < min) throw invalid(`${label} : ${min} caractères minimum.`);
  if (t.length > max) throw invalid(`${label} : ${max} caractères maximum.`);
  return t;
}

export function int(v, label, { min = -Infinity, max = Infinity } = {}) {
  const n = typeof v === 'string' && v.trim() !== '' ? Number(v) : v;
  if (!Number.isInteger(n)) throw invalid(`${label} : nombre entier attendu.`);
  if (n < min) throw invalid(`${label} : minimum ${min}.`);
  if (n > max) throw invalid(`${label} : maximum ${max}.`);
  return n;
}

export const toId = (v, label = 'Identifiant') => int(v, label, { min: 1 });
