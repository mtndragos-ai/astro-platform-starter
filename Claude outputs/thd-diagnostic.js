/**
 * THD DIAGNOSTIC — run this on the ticket list page if thd-list-export.js
 * could not find the grid (it showed an alert saying so).
 *
 * This script does NOT export anything. It just prints the structure
 * around one ticket "card" to the Console so Claude can see what the real
 * markup looks like and fix the export script to match it.
 *
 * It never touches your login — it only reads what's already on the page.
 *
 * HOW TO RUN:
 *   1. Open the CNH ticket list page (the THD / Request-Report History page).
 *   2. Open DevTools: F12 (or Ctrl+Shift+I) → "Console" tab.
 *   3. Select ALL of this file's contents (from the very first /** down to
 *      the final })();), copy it, paste it into the Console, press Enter.
 *   4. A block of text will print in the Console. Select it all (click in
 *      the console, Ctrl+A, Ctrl+C) and paste that TEXT back to Claude
 *      (not a screenshot — the text is what's needed this time).
 */
(function () {
  'use strict';

  function short(html, max) {
    if (!html) return '';
    html = html.replace(/\s+/g, ' ').trim();
    return html.length > max ? html.slice(0, max) + '…[truncated]' : html;
  }

  const labelText = 'Request / Report Number';
  const candidates = Array.from(document.querySelectorAll('*')).filter((el) => {
    if (el.children.length > 0) return false;
    const t = (el.textContent || '').replace(/\s+/g, ' ').trim();
    return t === labelText;
  });

  console.log(`Found ${candidates.length} elements with exact text "${labelText}".`);

  if (candidates.length === 0) {
    console.log('No exact match. Trying a looser match ("report number" anywhere)...');
    const loose = Array.from(document.querySelectorAll('*')).filter((el) => {
      if (el.children.length > 0) return false;
      const t = (el.textContent || '').trim();
      return /report number/i.test(t);
    });
    console.log(`Loose match found ${loose.length} elements.`);
    loose.slice(0, 3).forEach((el, i) => {
      console.log(`--- loose match #${i + 1} ---`);
      console.log('tag:', el.tagName, 'class:', el.className);
      console.log('own text:', el.textContent.trim());
    });
  }

  // Walk up from the first couple of matches and print each ancestor's
  // tag/class/role, so we can see the card structure layer by layer.
  candidates.slice(0, 2).forEach((el, i) => {
    console.log(`\n========== CANDIDATE #${i + 1} ==========`);
    let node = el;
    for (let depth = 0; depth < 8 && node; depth++) {
      const role = node.getAttribute && node.getAttribute('role');
      console.log(
        `[depth ${depth}] <${node.tagName.toLowerCase()}` +
          (node.className ? ` class="${node.className}"` : '') +
          (role ? ` role="${role}"` : '') +
          `>`
      );
      node = node.parentElement;
    }
  });

  // Try to find the repeating "row" container: go up from the first
  // candidate until we find an element with several siblings that share
  // its tag + class (i.e. one such element per ticket).
  if (candidates.length > 0) {
    let node = candidates[0];
    for (let depth = 0; depth < 8 && node && node.parentElement; depth++) {
      const parent = node.parentElement;
      const sameClassSiblings = Array.from(parent.children).filter(
        (c) => c.tagName === node.tagName && c.className === node.className
      );
      if (sameClassSiblings.length >= 3) {
        console.log(
          `\n>>> Likely repeating row found at depth ${depth}: <${node.tagName.toLowerCase()} class="${node.className}">, ${sameClassSiblings.length} siblings like it.`
        );
        console.log('Sample outerHTML of this row (truncated to 2000 chars):');
        console.log(short(node.outerHTML, 2000));
        break;
      }
      node = parent;
    }
  }

  console.log('\n--- Copy everything printed above (as text) and send it back to Claude. ---');
})();
