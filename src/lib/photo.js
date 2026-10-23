// Product pictures in the browser: where one is fetched from, and how a chosen file is made ready to upload.
// The server keeps a JPEG, PNG or WebP of 200 KB at most (worker/photos.js). A photo taken with a phone weighs
// several MB, so it is reduced here, before it leaves the browser.

// A plain <img> fetches the picture: it carries the session cookie but cannot carry the demo header, so the
// picture always comes from the real club (the demo space copies the real products under the same ids). The
// version in the address changes with the photo, and the browser keeps each picture for a year.
export const photoUrl = (product) => (
  product.photo_version ? `/api/products/${product.id}/photo?v=${encodeURIComponent(product.photo_version)}` : null
);

const MAX_SIDE = 800; // px, the longest side of the picture sent
const MIN_SIDE = 240; // px, shrinking stops here
const MAX_BYTES = 190 * 1024; // the server takes 200 KB: this keeps a margin
const QUALITIES = [0.82, 0.74, 0.66, 0.58, 0.5]; // JPEG quality, tried in this order at each size
const SHRINK = 0.85; // each new size is this much of the previous one

const UNREADABLE = 'Cette image ne peut pas être lue. Choisissez une photo JPEG, PNG ou WebP.';
const TOO_HEAVY = 'Cette photo reste trop lourde même réduite. Choisissez-en une autre.';

function loadImage(file) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => { URL.revokeObjectURL(url); resolve(img); };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error(UNREADABLE)); };
    img.src = url;
  });
}

const toBlob = (canvas, quality) => new Promise((resolve) => canvas.toBlob(resolve, 'image/jpeg', quality));

// The bytes of a blob as plain base64 text, the way the API takes a picture: the reader answers a data URL
// (`data:image/jpeg;base64,...`), whose prefix is cut off; the rest has no line break and its padding is complete,
// which is what the server insists on.
function toBase64(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const url = String(reader.result);
      resolve(url.slice(url.indexOf(',') + 1));
    };
    reader.onerror = () => reject(new Error(UNREADABLE));
    reader.readAsDataURL(blob);
  });
}

// Turns the file the person chose into `{ mime, data }` for PUT /api/products/:id/photo: drawn on a canvas, its
// longest side at 800 px at most (never enlarged), saved as JPEG at 0.82. If that is still over 190 KB the quality
// goes down step by step to 0.5, then the picture is made smaller and the steps start again. The re-encoding also
// drops what a phone writes into a photo (position, date), which must not reach the club's database.
// Throws an Error whose message is meant for the person.
export async function preparePhoto(file) {
  const img = await loadImage(file);
  const { naturalWidth: w, naturalHeight: h } = img;
  if (!w || !h) throw new Error(UNREADABLE);
  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error(UNREADABLE);

  let side = Math.min(MAX_SIDE, Math.max(w, h));
  for (;;) {
    const scale = side / Math.max(w, h);
    // Resizing a canvas also resets its drawing state: everything is set again at each size.
    canvas.width = Math.max(1, Math.round(w * scale));
    canvas.height = Math.max(1, Math.round(h * scale));
    ctx.imageSmoothingQuality = 'high';
    // A JPEG has no clear pixels: the clear parts of a PNG would turn black without a white ground.
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
    for (const quality of QUALITIES) {
      const blob = await toBlob(canvas, quality);
      if (!blob) throw new Error(UNREADABLE);
      // blob.type is what the browser really produced: the server checks it against the first bytes.
      if (blob.size <= MAX_BYTES) return { mime: blob.type, data: await toBase64(blob) };
    }
    side = Math.floor(side * SHRINK);
    if (side < MIN_SIDE) throw new Error(TOO_HEAVY);
  }
}
