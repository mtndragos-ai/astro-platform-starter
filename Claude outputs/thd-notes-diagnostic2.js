/**
 * THD NOTES DIAGNOSTIC v2 — run this on the same ticket detail page
 * (110281575). Anchors on "Support Agent" instead of a date pattern,
 * since the previous attempt showed the date/time isn't a single clean
 * "MM/DD/YYYY HH:MM" leaf the way the top summary box is.
 *
 * Prints the real structure around each "Support Agent" occurrence: its
 * own element, its ancestor chain, and the full note card's HTML.
 *
 * It never touches your login — it only reads what's already on the page.
 *
 * HOW TO RUN: same as before — DevTools Console → paste the whole file →
 * Enter → copy the printed text back here.
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

  var allEls = Array.from(document.querySelectorAll('*'));
  var matches = allEls.filter(function (el) {
    if (el.children.length !== 0) return false;
    return /support agent/i.test(text(el));
  });

  console.log('Found ' + matches.length + ' leaf elements whose own text matches "Support Agent".');

  matches.forEach(function (el, i) {
    console.log('\n========== MATCH #' + (i + 1) + ': "' + text(el) + '" ==========');
    var node = el;
    for (var depth = 0; depth < 8 && node; depth++) {
      var role = node.getAttribute && node.getAttribute('role');
      console.log(
        '[depth ' + depth + '] <' + node.tagName.toLowerCase() +
        (node.className ? ' class="' + node.className + '"' : '') +
        (role ? ' role="' + role + '"' : '') +
        '> — total text length here: ' + text(node).length
      );
      node = node.parentElement;
    }
  });

  // Print the full HTML of the smallest ancestor that contains BOTH
  // "Support Agent" occurrences, which should be the whole Notes thread
  // container (or close to it).
  if (matches.length >= 2) {
    var a = matches[0];
    var commonAncestor = a;
    while (commonAncestor && !commonAncestor.contains(matches[1])) {
      commonAncestor = commonAncestor.parentElement;
    }
    console.log('\n========== SMALLEST COMMON ANCESTOR OF BOTH MATCHES ==========');
    console.log('<' + commonAncestor.tagName.toLowerCase() + ' class="' + commonAncestor.className + '"> — text length: ' + text(commonAncestor).length);
    console.log('\nFull HTML (truncated to 6000 chars):');
    console.log(short(commonAncestor.outerHTML, 6000));
  }

  console.log('\n--- Copy everything printed above (as text) and send it back to Claude. ---');
})();
