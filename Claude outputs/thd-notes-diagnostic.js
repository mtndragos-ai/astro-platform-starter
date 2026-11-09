/**
 * THD NOTES DIAGNOSTIC — run this on a ticket detail page that has at
 * least one entry under "NOTES" (like ticket 110281575).
 *
 * This does NOT export anything. It finds each date+time header in the
 * Notes thread (e.g. "10/09/2026 16:03") and prints the real DOM
 * structure around it — its ancestors and the full note card's HTML —
 * so Claude can see exactly how the header and the message body relate,
 * instead of guessing again.
 *
 * It never touches your login — it only reads what's already on the page.
 *
 * HOW TO RUN:
 *   1. Open a THD ticket detail page with Notes replies on it.
 *   2. Open DevTools: F12 (or Ctrl+Shift+I) → "Console" tab.
 *   3. Select ALL of this file's contents, copy it, paste it in, press Enter.
 *   4. Select all the printed output (click in the console, Ctrl+A, Ctrl+C)
 *      and paste that TEXT back here (not a screenshot).
 */
(function () {
  'use strict';

  function text(el) {
    return (el && el.textContent || '').replace(/\s+/g, ' ').trim();
  }

  function short(html, max) {
    if (!html) return '';
    html = html.replace(/\s+/g, ' ').trim();
    return html.length > max ? html.slice(0, max) + '…[truncated]' : html;
  }

  // A header line looks like "10/09/2026 16:03" (and nothing else) on its
  // own, as a leaf element (no children).
  var headerPattern = /^\d{1,2}\/\d{1,2}\/\d{4}\s+\d{1,2}:\d{2}$/;
  var allLeaf = Array.from(document.querySelectorAll('*')).filter(function (el) {
    return el.children.length === 0;
  });
  var headers = allLeaf.filter(function (el) { return headerPattern.test(text(el)); });

  console.log('Found ' + headers.length + ' date-time header elements matching "MM/DD/YYYY HH:MM".');

  headers.slice(0, 3).forEach(function (headerEl, i) {
    console.log('\n========== HEADER #' + (i + 1) + ': "' + text(headerEl) + '" ==========');

    // Print the ancestor chain, each level's tag/class and how much text
    // that level contains in total (helps spot which ancestor also wraps
    // the message body below it).
    var node = headerEl;
    for (var depth = 0; depth < 7 && node; depth++) {
      var role = node.getAttribute && node.getAttribute('role');
      console.log(
        '[depth ' + depth + '] <' + node.tagName.toLowerCase() +
        (node.className ? ' class="' + node.className + '"' : '') +
        (role ? ' role="' + role + '"' : '') +
        '> — total text length here: ' + text(node).length
      );
      node = node.parentElement;
    }

    // Print the full HTML of the 3rd-level-up ancestor (a reasonable
    // guess for "the whole note card"), truncated.
    var card = headerEl;
    for (var hop = 0; hop < 3 && card && card.parentElement; hop++) card = card.parentElement;
    console.log('\nFull HTML of ancestor 3 levels up (likely the note card):');
    console.log(short(card.outerHTML, 3000));
  });

  console.log('\n--- Copy everything printed above (as text) and send it back to Claude. ---');
})();
