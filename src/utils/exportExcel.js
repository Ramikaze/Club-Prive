// Excel exports (.xlsx), built in the browser. The server prepares each table
// (GET /api/export/:kind?format=json: header, rows, amounts in currency units); several tables can
// go into one workbook, one sheet each. The spreadsheet library is loaded on first use only.
import { api, qs } from '../lib/api.js';
import { useStore } from '../store/useStore.js';

const MONEY_FORMAT = '#,##0';

function sheetFor(XLSX, { header, rows }) {
  const sheet = XLSX.utils.aoa_to_sheet([header, ...rows]);
  // Amount columns (their header names the currency) get a thousands format.
  const moneyCols = header.map((h, i) => (/\((FCFA|[A-Z€$]{1,5})\)$/.test(h) ? i : -1)).filter((i) => i >= 0);
  for (let r = 1; r <= rows.length; r += 1) {
    for (const c of moneyCols) {
      const cell = sheet[XLSX.utils.encode_cell({ r, c })];
      if (cell && cell.t === 'n') cell.z = MONEY_FORMAT;
    }
  }
  sheet['!cols'] = header.map((h, i) => ({
    wch: Math.min(60, Math.max(String(h).length, ...rows.map((row) => String(row[i] ?? '').length)) + 2),
  }));
  return sheet;
}

const safeSheetName = (name, used) => {
  const base = String(name).replace(/[\\/?*[\]:]/g, ' ').slice(0, 31) || 'Feuille';
  let candidate = base;
  for (let n = 2; used.has(candidate); n += 1) candidate = `${base.slice(0, 28)} ${n}`;
  used.add(candidate);
  return candidate;
};

// In the demo space a file name starts with DEMO_, so nobody takes the file for the club's own. Every
// workbook is saved from here: the server already names its own exports that way (such a name is kept
// as is), and this covers the names the pages choose themselves (closing, treasury, humidor journal).
// The space is the server's answer (store.demo), the same signal as the demo frame.
const workbookName = (fileName) => {
  const name = fileName.endsWith('.xlsx') ? fileName : `${fileName}.xlsx`;
  return useStore.getState().demo && !name.startsWith('DEMO_') ? `DEMO_${name}` : name;
};

export async function writeWorkbook(tables, fileName) {
  const XLSX = await import('xlsx');
  const workbook = XLSX.utils.book_new();
  const used = new Set();
  for (const t of tables) XLSX.utils.book_append_sheet(workbook, sheetFor(XLSX, t), safeSheetName(t.sheet, used));
  XLSX.writeFile(workbook, workbookName(fileName));
}

// exports: [{ kind, params }] -> one workbook. With a single export the server's file name is used.
export async function downloadExcel(exports, fileName) {
  const tables = [];
  for (const { kind, params } of exports) tables.push(await api.get(`/api/export/${kind}${qs({ ...params, format: 'json' })}`));
  await writeWorkbook(tables, fileName ?? tables[0].filename);
}
