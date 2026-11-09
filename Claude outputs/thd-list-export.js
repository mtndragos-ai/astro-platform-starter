/**
 * THD LIST EXPORT — run this on the CNH "full history" ticket list page.
 *
 * What it does:
 *   - Reads every visible ticket row in the table (number, customer, model,
 *     group code, responsible contact, serial number, status, submitted
 *     date, substream) plus a link to that ticket's detail page.
 *   - Downloads everything as a CSV file (thd-list-export.csv).
 *
 * It never touches your login — it only reads what's already rendered on
 * the page in your own logged-in browser tab.
 *
 * HOW TO RUN:
 *   1. Open the CNH ticket list page (the "full history" table).
 *   2. Open DevTools: press F12 (or Ctrl+Shift+I), click the "Console" tab.
 *   3. Paste this entire file's contents in and press Enter.
 *   4. A file named thd-list-export.csv will download. Send that file back
 *      to me (attach it in the chat) along with any notes on what looked
 *      wrong, if anything.
 *
 * NOTE: this is a best-effort scraper written from screenshots, not the
 * live page's HTML, so column detection may need one round of fixing. If a
 * column comes out empty or shifted, tell me which one and paste a couple
 * of example rows' text (not screenshots) and I'll adjust the script.
 */
(function () {
  'use strict';

  function text(el) {
    return (el && el.textContent || '').replace(/\s+/g, ' ').trim();
  }

  // Find the table that actually looks like the ticket grid: has a header
  // row mentioning "REQUEST" or "REPORT NUMBER" somewhere in it.
  function findGridTable() {
    const candidates = Array.from(document.querySelectorAll('table'));
    for (const t of candidates) {
      const headerText = text(t.querySelector('thead') || t.rows[0]).toUpperCase();
      if (headerText.includes('REQUEST') || headerText.includes('REPORT NUMBER')) {
        return t;
      }
    }
    // Fallback: some grids are built from divs, not <table>. Look for a
    // repeating row-like structure with a role="row" attribute.
    return null;
  }

  function extractFromTable(table) {
    const rows = Array.from(table.querySelectorAll('tbody tr'));
    if (rows.length === 0) {
      // No <tbody>, just take all rows after the first (header).
      rows.push(...Array.from(table.querySelectorAll('tr')).slice(1));
    }
    return rows.map((row) => {
      const cells = Array.from(row.querySelectorAll('td, th'));
      const link = row.querySelector('a[href]');
      return {
        cells: cells.map(text),
        detailUrl: link ? link.href : '',
      };
    }).filter((r) => r.cells.some((c) => c.length > 0));
  }

  function extractFromDivGrid() {
    // Generic fallback for div/grid-based tables (e.g. ARIA grids): look
    // for elements with role="row" that contain multiple role="gridcell"
    // or role="cell" children.
    const rows = Array.from(document.querySelectorAll('[role="row"]'));
    return rows.map((row) => {
      const cells = Array.from(row.querySelectorAll('[role="gridcell"], [role="cell"]'));
      const link = row.querySelector('a[href]');
      return {
        cells: cells.map(text),
        detailUrl: link ? link.href : '',
      };
    }).filter((r) => r.cells.length > 2 && r.cells.some((c) => c.length > 0));
  }

  const table = findGridTable();
  let rows = table ? extractFromTable(table) : extractFromDivGrid();

  if (rows.length === 0) {
    alert('THD export: could not find the ticket grid on this page. Open DevTools Console and tell Claude what you see (any errors, or describe the page).');
    return;
  }

  // Build CSV. We don't know the exact column order for certain, so we
  // just dump every cell found, plus the detail link, and let column
  // headers be generic — Claude will re-map them once you confirm the
  // order looks right.
  const maxCols = Math.max(...rows.map((r) => r.cells.length));
  const header = ['detail_url', ...Array.from({ length: maxCols }, (_, i) => `col_${i + 1}`)];

  function csvEscape(v) {
    const s = String(v == null ? '' : v);
    if (/[",\n]/.test(s)) {
      return '"' + s.replace(/"/g, '""') + '"';
    }
    return s;
  }

  const lines = [header.map(csvEscape).join(',')];
  for (const r of rows) {
    const line = [r.detailUrl, ...r.cells];
    while (line.length < header.length) line.push('');
    lines.push(line.map(csvEscape).join(','));
  }

  const csv = lines.join('\r\n');
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = 'thd-list-export.csv';
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);

  console.log(`THD export: found ${rows.length} rows, ${maxCols} columns. File downloaded as thd-list-export.csv.`);
})();
