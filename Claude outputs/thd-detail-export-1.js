/**
 * THD DETAIL EXPORT (v3) — run this on a single CNH ticket's detail page
 * (the page with the UNIT / REQUEST DETAILS / ATTACHED FILES / OWNER tabs).
 *
 * What it does:
 *   - Clicks through each tab on the page (Unit, Request Details, Attached
 *     Files, Owner) so their content loads, and scrapes every "Label :
 *     Value" pair it can find.
 *   - Grabs the long free-text fields (Symptom, Action taken, Question).
 *   - Grabs the Notes reply thread (date, author, message).
 *   - Lists the attached files it can see (filenames + any download link),
 *     WITHOUT downloading the file contents — that's a separate step.
 *   - Downloads everything as one JSON file.
 *
 * It never touches your login — it only reads and clicks what's already
 * on the page in your own logged-in browser tab, the same as you clicking
 * through the tabs yourself.
 *
 * v2 changes from the first version:
 *   - Fixed ticket ID detection (was showing "ticket" instead of the real
 *     number).
 *   - Fields that are blank on a given ticket no longer "steal" the next
 *     field's text.
 *   - Notes no longer include ordinary dated fields (Submitted On, Build
 *     Date, etc.) as if they were reply-thread messages.
 *   - Attachment detection now also matches by file extension (.bin,
 *     .flt, .jpg, .pdf, etc.), not just buttons literally labeled
 *     "download".
 *
 * v3 changes:
 *   - Label detection now allows punctuation like "?" in the label text
 *     (e.g. "Have you observed the symptom?"), so those fields stop
 *     leaking into unrelated neighboring fields.
 *   - Label:value pairs with no space after the colon (seen on this page
 *     for a few fields) are now recognized too, so they stop appearing
 *     twice, once as a field and once as a fake "note".
 *   - "Last Update <timestamp>" page metadata is now ignored everywhere.
 *   - Site-wide footer links (Cookie Policy, legal, terms) are excluded
 *     from attachments, and placeholder entries with neither a filename
 *     nor a link are dropped.
 *
 * HOW TO RUN:
 *   1. Open one THD ticket's detail page.
 *   2. Open DevTools: F12 (or Ctrl+Shift+I) → "Console" tab.
 *   3. Select ALL of this file's contents (from the very first /** down to
 *      the final })();), copy it, paste it in, press Enter.
 *   4. Wait a couple of seconds (it clicks through the tabs with a short
 *      pause between each so content has time to load).
 *   5. A file named thd-<ticket number>.json will download. Send it back
 *      along with a note on anything that still looks wrong.
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
  await sleep(300);

  // --- 2. Label:value extraction (two passes + bleed-through guard) ---
  // Label text can hold punctuation like "?" or "/", so the only thing we
  // require is "no colon" before the colon that separates label from value.
  const labelOnlyPattern = /^[A-Za-z][^:]{1,78}:\s*$/;
  const combinedPattern = /^([A-Za-z][^:]{1,78}):\s*(\S.*)$/;
  const boilerplatePattern = /^Last Update\b/i;

  const fields = {};
  const consumedTexts = new Set(); // raw text already used as a field label or value

  // Pass 1: elements whose own text is a single "Label : Value" string.
  // Exclude script/style/etc. tags — their "text" is code, not page content.
  const nonContentTags = new Set(['SCRIPT', 'STYLE', 'NOSCRIPT', 'TEMPLATE']);
  const allLeaf = Array.from(document.querySelectorAll('*')).filter(
    (el) => el.children.length === 0 && !nonContentTags.has(el.tagName)
  );
  for (const el of allLeaf) {
    const t = text(el);
    if (boilerplatePattern.test(t)) continue;
    const m = t.match(combinedPattern);
    if (m) {
      const label = m[1].trim();
      const value = m[2].trim();
      if (label && value && !(label in fields)) {
        fields[label] = value;
        consumedTexts.add(t);
      }
    }
  }

  // Pass 2: elements whose own text is JUST "Label :", value lives nearby.
  for (const el of allLeaf) {
    const t = text(el);
    if (boilerplatePattern.test(t)) continue;
    if (!labelOnlyPattern.test(t)) continue;
    const label = t.replace(/:\s*$/, '').trim();
    if (!label || label in fields) continue;

    function isUsableValue(candidate) {
      if (!candidate) return false;
      if (labelOnlyPattern.test(candidate)) return false; // it's another label
      if (combinedPattern.test(candidate)) return false; // it's another field's "Label : Value"
      return true;
    }

    let value = '';
    let sib = el.nextElementSibling;
    if (sib) {
      const st = text(sib);
      if (isUsableValue(st)) value = st;
    }
    if (!value && el.parentElement) {
      const parentSib = el.parentElement.nextElementSibling;
      if (parentSib) {
        const pst = text(parentSib);
        if (isUsableValue(pst)) value = pst;
      }
    }
    if (!value && el.parentElement) {
      const siblings = Array.from(el.parentElement.children).filter((c) => c !== el);
      for (const s of siblings) {
        const st = text(s);
        if (isUsableValue(st)) {
          value = st;
          break;
        }
      }
    }

    if (label && value) {
      fields[label] = value;
      consumedTexts.add(t);
      consumedTexts.add(value);
    }
  }

  // --- 3. Notes thread ---
  // A real note is free text that happens to contain a date, but is NOT
  // itself a "Label : Value" field we already captured above.
  const notes = [];
  const dateLike = /\d{1,2}\/\d{1,2}\/\d{4}/;
  const noteBlocks = Array.from(document.querySelectorAll('*')).filter((el) => {
    if (el.children.length === 0) return false;
    const t = text(el);
    if (!dateLike.test(t)) return false;
    if (t.length <= 10 || t.length >= 400) return false;
    if (boilerplatePattern.test(t)) return false; // page metadata, not a note
    if (combinedPattern.test(t)) return false; // it's a "Label : Value" field, not a note
    if (consumedTexts.has(t)) return false; // already captured as a field
    return true;
  });
  const noteBlocksFiltered = noteBlocks.filter(
    (el, _, arr) => !arr.some((other) => other !== el && el.contains(other))
  );
  for (const block of noteBlocksFiltered) {
    const t = text(block);
    const dateMatch = t.match(dateLike);
    notes.push({
      raw: t,
      date: dateMatch ? dateMatch[0] : '',
    });
  }

  // --- 4. Attached files ---
  // Match both "looks like a download control" and "link points at a
  // known attachment file extension" so icon-only buttons are still caught.
  const attachments = [];
  const seenHrefs = new Set();
  const extPattern = /\.(bin|flt|ver|jpg|jpeg|png|pdf|txt|csv|xlsx?|docx?)(\?|$)/i;
  // Site-wide footer/legal links that are NOT ticket attachments.
  const boilerplateHrefPattern = /CookiePolicy|legal_en|terms_en|privacy_en|portal\.cnh\.com\/resources/i;

  const downloadButtons = Array.from(document.querySelectorAll('a, button')).filter((el) => {
    const label = text(el) + ' ' + (el.getAttribute('aria-label') || '') + ' ' + (el.getAttribute('title') || '');
    if (!/download/i.test(label)) return false;
    const href = el.href || el.getAttribute('data-href') || '';
    return !boilerplateHrefPattern.test(href);
  });
  const extLinks = Array.from(document.querySelectorAll('a[href]')).filter(
    (a) => (extPattern.test(a.href) || extPattern.test(text(a))) && !boilerplateHrefPattern.test(a.href)
  );

  function addAttachment(el) {
    const href = el.href || el.getAttribute('data-href') || '';
    const key = href || text(el);
    if (seenHrefs.has(key)) return;
    seenHrefs.add(key);

    let filename = '';
    const ownText = text(el);
    let m = ownText.match(/[\w.\-]+\.(bin|flt|ver|jpg|jpeg|png|pdf|txt|csv|xlsx?|docx?)/i);
    if (m) filename = m[0];
    if (!filename && href) {
      m = href.match(/[\w.\-]+\.(bin|flt|ver|jpg|jpeg|png|pdf|txt|csv|xlsx?|docx?)/i);
      if (m) filename = m[0];
    }
    if (!filename) {
      let card = el.closest('div');
      let hops = 0;
      while (card && hops < 5 && !filename) {
        const cm = text(card).match(/[\w.\-]+\.(bin|flt|ver|jpg|jpeg|png|pdf|txt|csv|xlsx?|docx?)/i);
        if (cm) filename = cm[0];
        card = card.parentElement;
        hops++;
      }
    }

    if (!filename && !href) return; // no usable info — likely an unrelated page control

    attachments.push({
      filename: filename || '(name not detected)',
      href,
    });
  }

  downloadButtons.forEach(addAttachment);
  extLinks.forEach(addAttachment);

  // --- 5. Ticket ID: prefer the actual "Request No" field, then the URL ---
  const urlParams = new URLSearchParams(location.search);
  const ticketId =
    fields['Request No'] ||
    fields['Request / Report Number'] ||
    fields['Report Number'] ||
    fields['Request Number'] ||
    urlParams.get('idRequest') ||
    (location.href.match(/\d{5,}/) || [])[0] ||
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
