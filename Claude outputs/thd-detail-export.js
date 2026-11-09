/**
 * THD DETAIL EXPORT — run this on a single CNH ticket's detail page (the
 * page with the UNIT / REQUEST DETAILS / ATTACHED FILES / OWNER tabs).
 *
 * What it does:
 *   - Clicks through each tab on the page (Unit, Request Details, Attached
 *     Files, Owner) so their content loads, and scrapes every "Label :
 *     Value" pair it can find.
 *   - Grabs the long free-text fields (Symptom, Action taken, Question).
 *   - Grabs the Notes thread (date, author, message).
 *   - Lists the attached files it can see (filenames + any download link),
 *     WITHOUT downloading the file contents — that's a separate step.
 *   - Downloads everything as one JSON file.
 *
 * It never touches your login — it only reads and clicks what's already
 * on the page in your own logged-in browser tab, the same as you clicking
 * through the tabs yourself.
 *
 * HOW TO RUN:
 *   1. Open one THD ticket's detail page.
 *   2. Open DevTools: F12 (or Ctrl+Shift+I) → "Console" tab.
 *   3. Paste this entire file's contents in and press Enter.
 *   4. Wait a couple of seconds (it clicks through the tabs with a short
 *      pause between each so content has time to load).
 *   5. A file named thd-<ticket id or "ticket">.json will download. Send
 *      it back to me along with a note if any field looked wrong.
 *
 * This is a best-effort scraper written from screenshots, not the live
 * page's HTML, so field detection may need one round of fixing. Test it
 * on ONE ticket first before running it on many.
 */
(async function () {
  'use strict';

  function text(el) {
    return (el && el.textContent || '').replace(/\s+/g, ' ').trim();
  }

  function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  // --- 1. Click through the tabs, if present, pausing for content to load ---
  const tabNames = ['Unit', 'Request Details', 'Attached Files', 'Owner'];
  const clickableTabs = Array.from(document.querySelectorAll('*')).filter((el) => {
    const t = text(el).toUpperCase();
    return tabNames.some((name) => t === name.toUpperCase()) && el.children.length === 0;
  });

  for (const tab of clickableTabs) {
    try {
      tab.click();
      await sleep(400);
    } catch (e) {
      // ignore — not every "tab-like" element is clickable
    }
  }
  // Give the last tab's content a bit more time to settle.
  await sleep(300);

  // --- 2. Heuristic label:value extraction ---
  // Pattern seen on this portal: a label ending in " :" sits in its own
  // element, with the value as plain text right after it (either as a
  // sibling element, or as a text node immediately following).
  const labelPattern = /^[A-Za-z][A-Za-z0-9 \/.#-]{1,60}:\s*$/;

  function collectLabelValuePairs(root) {
    const result = {};
    const all = Array.from(root.querySelectorAll('*'));
    for (const el of all) {
      // Only consider "leaf-ish" elements as label candidates (their own
      // text, not a wrapper around other labeled fields).
      if (el.children.length > 0) continue;
      const t = text(el);
      if (!labelPattern.test(t)) continue;
      const label = t.replace(/:\s*$/, '').trim();
      if (!label) continue;

      // Try a few strategies to find the value:
      let value = '';
      // a) next sibling element's text
      let sib = el.nextElementSibling;
      if (sib && text(sib) && !labelPattern.test(text(sib))) {
        value = text(sib);
      }
      // b) parent's next sibling element's text (label and value are
      //    sometimes each wrapped in their own row/column div)
      if (!value && el.parentElement) {
        const parentSib = el.parentElement.nextElementSibling;
        if (parentSib && text(parentSib) && !labelPattern.test(text(parentSib))) {
          value = text(parentSib);
        }
      }
      // c) look inside the same parent for a sibling text-only node
      if (!value && el.parentElement) {
        const siblings = Array.from(el.parentElement.children).filter((c) => c !== el);
        for (const s of siblings) {
          const st = text(s);
          if (st && !labelPattern.test(st)) {
            value = st;
            break;
          }
        }
      }

      if (label && value && !(label in result)) {
        result[label] = value;
      }
    }
    return result;
  }

  const fields = collectLabelValuePairs(document.body);

  // --- 3. Notes thread ---
  // Look for a "Notes" heading, then collect repeating blocks that contain
  // a date-looking string plus an author plus a message.
  const notes = [];
  const dateLike = /\d{1,2}\/\d{1,2}\/\d{4}/;
  const noteBlocks = Array.from(document.querySelectorAll('*')).filter((el) => {
    if (el.children.length === 0) return false;
    const t = text(el);
    return dateLike.test(t) && t.length < 400 && t.length > 10;
  });
  // De-duplicate nested matches (keep the smallest/innermost blocks only).
  const noteBlocksFiltered = noteBlocks.filter((el, _, arr) => !arr.some((other) => other !== el && el.contains(other)));
  for (const block of noteBlocksFiltered) {
    const t = text(block);
    const dateMatch = t.match(dateLike);
    notes.push({
      raw: t,
      date: dateMatch ? dateMatch[0] : '',
    });
  }

  // --- 4. Attached files ---
  const attachments = [];
  const downloadButtons = Array.from(document.querySelectorAll('a, button')).filter(
    (el) => /download/i.test(text(el))
  );
  for (const btn of downloadButtons) {
    // Try to find a filename near this download button (usually just
    // above it in the same card/column).
    let filename = '';
    let card = btn.closest('div');
    let hops = 0;
    while (card && hops < 5 && !filename) {
      const m = text(card).match(/[\w.\-]+\.(bin|flt|ver|jpg|jpeg|png|pdf|txt|csv|xlsx?)/i);
      if (m) filename = m[0];
      card = card.parentElement;
      hops++;
    }
    attachments.push({
      filename: filename || '(name not detected)',
      href: btn.href || btn.getAttribute('data-href') || '',
    });
  }

  // --- 5. Ticket ID: try the URL, or any "Request / Report Number" field ---
  const ticketId =
    fields['Request / Report Number'] ||
    fields['Report Number'] ||
    fields['Request Number'] ||
    (location.pathname.match(/\d{5,}/) || [])[0] ||
    'ticket';

  const payload = {
    source: 'CNH THD',
    ticketId,
    pageUrl: location.href,
    scrapedAt: new Date().toISOString(),
    fields,
    notes,
    attachments,
  };

  const json = JSON.stringify(payload, null, 2);
  const blob = new Blob([json], { type: 'application/json;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `thd-${String(ticketId).replace(/[^\w-]/g, '_')}.json`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);

  console.log('THD detail export:', payload);
  console.log(`Found ${Object.keys(fields).length} fields, ${notes.length} note blocks, ${attachments.length} attachments.`);
})();
