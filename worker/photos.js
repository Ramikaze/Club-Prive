// Product photos: what the API accepts, and how a picture is told from what it claims to be. A photo comes
// as `{ mime, data }`, `data` being base64; it is checked here, once, whether an administrator adds it
// or the catalogue import does.
import { invalid } from './errors.js';

export const PHOTO_MAX_BYTES = 200 * 1024;
// The longest base64 text a photo of that size can take (4 characters for 3 bytes, the last group padded).
const MAX_BASE64_LENGTH = Math.ceil(PHOTO_MAX_BYTES / 3) * 4;

const ascii = (bytes, start, length) => String.fromCharCode(...bytes.subarray(start, start + length));

// The first bytes of each format. The type a client announces is not taken on trust: a file that does
// not start like its format is refused, so an SVG or an HTML page cannot be stored under an image type.
const SIGNATURES = {
  'image/jpeg': (b) => b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff,
  'image/png': (b) => [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a].every((x, i) => b[i] === x),
  'image/webp': (b) => ascii(b, 0, 4) === 'RIFF' && ascii(b, 8, 4) === 'WEBP',
};

const tooHeavy = () => invalid('Photo trop lourde : 200 Ko au plus.');

// Gives `{ mime, bytes }` (the decoded picture, a Uint8Array of its exact size) or throws a 400 with a message
// for the person who picked the file.
export function decodePhoto(input) {
  if (input === null || typeof input !== 'object' || Array.isArray(input)) throw invalid('Photo : données manquantes.');
  const mime = typeof input.mime === 'string' ? input.mime.trim().toLowerCase() : '';
  if (!Object.hasOwn(SIGNATURES, mime)) throw invalid('Photo : format non accepté (JPEG, PNG ou WebP).');
  const { data } = input;
  if (typeof data !== 'string' || data === '') throw invalid('Photo : données manquantes.');
  if (data.length > MAX_BASE64_LENGTH) throw tooHeavy();
  // Strict base64, without the line breaks or missing padding that atob would forgive.
  if (data.length % 4 !== 0 || !/^[A-Za-z0-9+/]+={0,2}$/.test(data)) throw invalid('Photo : données illisibles.');
  const binary = atob(data);
  if (binary.length > PHOTO_MAX_BYTES) throw tooHeavy();
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  if (!SIGNATURES[mime](bytes)) throw invalid('Photo : le contenu ne correspond pas au format annoncé.');
  return { mime, bytes };
}
