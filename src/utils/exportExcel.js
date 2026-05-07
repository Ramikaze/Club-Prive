import * as XLSX from 'xlsx';

/**
 * Exporte un tableau de données vers un fichier Excel (.xlsx)
 * @param {Array} data - Tableau d'objets à exporter
 * @param {string} sheetName - Nom de l'onglet dans Excel
 * @param {string} fileName - Nom du fichier (sans extension)
 */
export function exportToExcel(data, sheetName, fileName) {
  const worksheet = XLSX.utils.json_to_sheet(data);
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, worksheet, sheetName);

  // Auto-largeur des colonnes
  const cols = Object.keys(data[0] || {}).map(key => ({
    wch: Math.max(key.length, ...data.map(row => String(row[key] ?? '').length)) + 2
  }));
  worksheet['!cols'] = cols;

  XLSX.writeFile(workbook, `${fileName}.xlsx`);
}

/**
 * Exporte plusieurs onglets dans un seul fichier Excel
 * @param {Array} sheets - Tableau de { data, sheetName }
 * @param {string} fileName - Nom du fichier (sans extension)
 */
export function exportMultiSheetExcel(sheets, fileName) {
  const workbook = XLSX.utils.book_new();

  sheets.forEach(({ data, sheetName }) => {
    if (!data || data.length === 0) return;
    const worksheet = XLSX.utils.json_to_sheet(data);
    const cols = Object.keys(data[0] || {}).map(key => ({
      wch: Math.max(key.length, ...data.map(row => String(row[key] ?? '').length)) + 2
    }));
    worksheet['!cols'] = cols;
    XLSX.utils.book_append_sheet(workbook, worksheet, sheetName);
  });

  XLSX.writeFile(workbook, `${fileName}.xlsx`);
}

/**
 * Formate les transactions pour l'export
 */
export function formatTransactionsForExport(transactions) {
  return transactions.map(t => ({
    'Date': t.date,
    'Entité': t.entityId === 'pn' ? 'Meiji Pointe-Noire' : 'Meiji Brazzaville',
    'Type': t.type === 'income' ? 'Recette' : 'Dépense',
    'Catégorie': t.category,
    'Description': t.description,
    'Compte': t.account,
    'Montant (FCFA)': t.type === 'income' ? t.amount : -t.amount,
    'Réf. Chèque': t.checkRef || '',
  }));
}
