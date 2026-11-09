/**
 * THD IFRAME CHECK — run this on the same ticket detail page.
 *
 * Checks whether the "NOTES" panel lives inside an iframe (which would
 * explain why the notes diagnostic found nothing there), and if so,
 * whether that iframe's content is reachable from a script running on
 * the main page.
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

  var iframes = Array.from(document.querySelectorAll('iframe'));
  console.log('Found ' + iframes.length + ' <iframe> element(s) on the page.');

  iframes.forEach(function (f, i) {
    console.log('\n--- iframe #' + (i + 1) + ' ---');
    console.log('src: ' + (f.src || '(no src attribute)'));
    console.log('id: ' + (f.id || '(none)') + '  class: ' + (f.className || '(none)'));
    console.log('width/height: ' + f.offsetWidth + 'x' + f.offsetHeight);
    try {
      var doc = f.contentDocument || (f.contentWindow && f.contentWindow.document);
      if (!doc) {
        console.log('contentDocument: not accessible (null) — likely cross-origin.');
      } else {
        console.log('contentDocument: ACCESSIBLE. Body text length: ' + text(doc.body).length);
        console.log('First 300 chars of its body text: ' + text(doc.body).slice(0, 300));
      }
    } catch (err) {
      console.log('contentDocument: blocked by the browser (' + err.message + ') — cross-origin iframe.');
    }
  });

  // Also: does the word "NOTES" or "Support Agent" appear anywhere in the
  // main document at all (outside any iframe)?
  var allEls = Array.from(document.querySelectorAll('*')).filter(function (el) { return el.children.length === 0; });
  var notesMatches = allEls.filter(function (el) { return /^notes$/i.test(text(el)); });
  var agentMatches = allEls.filter(function (el) { return /support agent/i.test(text(el)); });
  console.log('\n"NOTES" label found in main document: ' + notesMatches.length + ' time(s).');
  console.log('"Support Agent" text found in main document: ' + agentMatches.length + ' time(s).');

  console.log('\n--- Copy everything printed above (as text) and send it back to Claude. ---');
})();
