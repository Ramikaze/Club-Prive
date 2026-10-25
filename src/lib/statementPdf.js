// The member's statement as a real PDF file, made in the browser: the A4 document drawn on the page
// (`.statement-sheet`) is rendered to one picture (html-to-image), then cut into A4 pages for jsPDF. The cuts
// fall between rows and blocks, never through a line of text. jsPDF is loaded only when a PDF is asked for.
import { toCanvas } from 'html-to-image';

const PAGE = { width: 210, height: 297, margin: 12 }; // mm
const CONTENT_W = PAGE.width - 2 * PAGE.margin;
const CONTENT_H = PAGE.height - 2 * PAGE.margin - 6; // 6 mm kept at the bottom for the page number
// Phones refuse a canvas much above 16 million pixels, and no browser draws one taller than 16 384: a long history
// is drawn at a lower resolution, down to one pixel per CSS pixel (about 16 pages), and a longer one is refused.
const MAX_PIXELS = 16e6;
const MAX_SIDE = 16384;

// Where a page may end, in CSS pixels from the top of the sheet: under a table row or a block marked
// `.st-keep`, at the end of a section, and at the very end.
function breakPoints(sheet) {
  const top = sheet.getBoundingClientRect().top;
  const points = [...sheet.querySelectorAll('tbody tr, .st-keep, .st-section')]
    .map((el) => el.getBoundingClientRect().bottom - top);
  points.push(sheet.offsetHeight);
  return [...new Set(points.map((y) => Math.round(y)))].sort((a, b) => a - b);
}

// The slices [start, end) of each page: as much as fits, ending on the last break point that fits (a block
// taller than a page is cut where the page ends).
function pageSlices(points, pageHeight, total) {
  const slices = [];
  let start = 0;
  while (start < total - 1) {
    const limit = start + pageHeight;
    const end = limit >= total ? total : (points.filter((y) => y > start && y <= limit).pop() ?? limit);
    slices.push([start, end]);
    start = end;
  }
  return slices;
}

// The sheet as a PDF File named `name`.
export async function statementPdf(sheet, name) {
  const { jsPDF } = await import('jspdf');
  const width = sheet.offsetWidth;
  const height = sheet.offsetHeight;
  const ratio = Math.min(2, Math.sqrt(MAX_PIXELS / (width * height)), MAX_SIDE / height);
  if (ratio < 1) throw new Error('Relevé trop long pour un PDF : choisissez une période plus courte (il reste imprimable).');
  // The sheet uses the system's Arial: no web font to embed.
  const canvas = await toCanvas(sheet, { pixelRatio: ratio, backgroundColor: '#ffffff', cacheBust: true, skipFonts: true });
  const scale = canvas.width / width; // canvas pixels per CSS pixel
  const mmPerPx = CONTENT_W / width;
  const slices = pageSlices(breakPoints(sheet), CONTENT_H / mmPerPx, height);

  const pdf = new jsPDF({ unit: 'mm', format: 'a4', orientation: 'portrait', compress: true });
  const page = document.createElement('canvas');
  page.width = canvas.width;
  const ctx = page.getContext('2d');
  slices.forEach(([start, end], i) => {
    if (i > 0) pdf.addPage();
    page.height = Math.max(1, Math.round((end - start) * scale));
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, page.width, page.height);
    ctx.drawImage(canvas, 0, Math.round(start * scale), page.width, page.height, 0, 0, page.width, page.height);
    pdf.addImage(page.toDataURL('image/png'), 'PNG', PAGE.margin, PAGE.margin, CONTENT_W, (end - start) * mmPerPx, undefined, 'FAST');
    pdf.setFontSize(8);
    pdf.setTextColor(0);
    pdf.text(`Page ${i + 1} / ${slices.length}`, PAGE.width - PAGE.margin, PAGE.height - PAGE.margin + 2, { align: 'right' });
  });
  return new File([pdf.output('blob')], name, { type: 'application/pdf' });
}
