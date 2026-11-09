/**
 * THD DETAIL EXPORT (v12) — run this on a single CNH ticket's detail page
 * (the page with the UNIT / REQUEST DETAILS / ATTACHED FILES / OWNER tabs).
 *
 * What it does:
 *   - Clicks through each tab on the page (Unit, Request Details, Attached
 *     Files, Owner) so their content loads, and scrapes every "Label :
 *     Value" pair it can find.
 *   - Grabs the long free-text fields (Symptom, Action taken, Question).
 *   - Grabs the Notes reply thread (date, author, message).
 *   - Lists the attached files it can see (filenames + any download link),
 *     and downloads the actual file bytes for any attachment that has a
 *     same-origin link (see v7 below), using your own browser session —
 *     it never asks for or sees your password.
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
 * v5 changes:
 *   - Long free-text fields (Symptom, Action taken, Question) and the
 *     Notes thread used to come out with their original line breaks
 *     stripped, running separate lines together with no space (e.g.
 *     "Hello,Client complain..."). Field and note values are now read
 *     with the page's rendered line breaks preserved, so multi-line text
 *     comes out the same way it's laid out on the CNH page.
 *
 * v6 changes:
 *   - Notes extraction was previously a heuristic guess (any block with a
 *     date in it) and it missed long replies, split headers from their
 *     message bodies, and occasionally grabbed a message's own signature
 *     date as if it were a separate note. It now reads the real reply
 *     thread structure directly (".msg-container .chat-message" cards),
 *     so every reply comes through complete with its date, author, and
 *     full message text, in order.
 *
 * v7 changes:
 *   - Attachments now get their actual file bytes downloaded, not just
 *     their filename/link. For each attachment with a link on the SAME
 *     site as the ticket page, the script fetches it using your browser's
 *     existing logged-in session (the same cookies your browser already
 *     sends when you click the link yourself — this script never touches
 *     your password or any login form) and stores it as base64 in the
 *     JSON, along with a guessed MIME type and its size in bytes.
 *   - Files bigger than 15 MB are skipped automatically (too big to carry
 *     in the JSON) and files linked to a different domain are skipped,
 *     since those need you to open them manually. Either case is noted
 *     in that attachment's "fetchError" field instead of failing the
 *     whole export.
 *   - This step runs after the page's tabs are clicked and takes a little
 *     longer than before (one extra network request per attachment), so
 *     give it a few more seconds before the JSON downloads.
 *
 * v8 changes:
 *   - Fixed attachment downloads that were failing with "Failed to fetch"
 *     even though the link was on the right domain. The CNH page's own
 *     attachment link actually redirects to Azure Blob Storage (a
 *     separate host) with a signed, self-authenticating link — it needs
 *     no cookies at all, and it answers in a way that specifically
 *     forbids credentialed requests. The fetch now sends your CNH cookies
 *     only to CNH's own page (so it can build that redirect), and
 *     correctly stops sending them once redirected to Blob Storage,
 *     instead of forcing them onto both and getting blocked.
 *
 * v9 changes:
 *   - Only photos, PDFs, and videos get their bytes downloaded now.
 *     Diagnostic/log files (.bin, .flt, .ver, .txt, .csv, etc.) are still
 *     listed in the JSON with their filename, but are no longer fetched
 *     or carried as base64 — they're skipped on purpose, with a note
 *     saying so, so only the file types worth having on the portal get
 *     uploaded there.
 *
 * v10 changes:
 *   - Fixed video attachments (.mp4 etc.) being wrongly marked "tip de
 *     fișier neacceptat" even though videos ARE one of the allowed types.
 *     Two separate bugs caused it: (1) the regex that first recognizes a
 *     link as an attachment, and pulls out its filename, never included
 *     video extensions at all, so a video's filename came out as
 *     "(name not detected)"; (2) the allowed-type check required the
 *     extension to sit right before a "?" or the very end of the link,
 *     but on this site the real extension is often buried mid-way
 *     through a query string (e.g. "...blobName=xxx.mp4&container=..."),
 *     followed by "&" — which that check didn't allow for. Both are
 *     fixed now, and video files are recognized and downloaded properly.
 *
 * v11 changes:
 *   - Raised the size cap from 15MB to 30MB raw (real phone videos, like a
 *     2-minute WhatsApp clip, commonly land in the 20-30MB range and were
 *     getting skipped). This isn't a guaranteed-safe number — I don't have
 *     a confirmed figure for the exact ceiling the Apps Script web app
 *     will accept in one POST body (base64 inflates this 30MB by about a
 *     third, so a maxed-out file means a ~40MB request). Treat the first
 *     send of a ticket with a large video as a test: if thd-import.html
 *     reports a network/script error instead of success, say so and the
 *     cap gets lowered back down, or the video gets attached by hand
 *     instead for that one ticket.
 *
 * v12 changes:
 *   - The 30MB cap from v11 turned out to be too big in practice: a 24MB
 *     video (~32MB base64) made the import tool's send to Apps Script
 *     hang for 15+ minutes with nothing ever reaching the spreadsheet —
 *     not a clean error, just stuck. Pulled the cap back down to 8MB raw
 *     (~11MB base64) until there's a confirmed-working larger size to
 *     raise it back to. thd-import.html also now gives up on a stuck send
 *     after 100 seconds instead of hanging forever, so a ticket can't get
 *     stuck with no way to retry it.
 *   - A ticket with a video or other file over this cap will still import
 *     fine — it just won't carry that one attachment automatically; it
 *     can be attached to the portal entry by hand afterward if needed.
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

  // Like text(), but preserves the line breaks the browser actually
  // renders (innerText follows layout — separate block elements become
  // separate lines) instead of collapsing everything to one line.
  function valueText(el) {
    if (!el) return '';
    var raw = typeof el.innerText === 'string' ? el.innerText : (el.textContent || '');
    return raw
      .split(/\r\n|\r|\n/)
      .map((line) => line.replace(/[ \t]+/g, ' ').trim())
      .filter((line) => line.length > 0)
      .join('\n');
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

    let valueEl = null;
    let sib = el.nextElementSibling;
    if (sib) {
      const st = text(sib);
      if (isUsableValue(st)) valueEl = sib;
    }
    if (!valueEl && el.parentElement) {
      const parentSib = el.parentElement.nextElementSibling;
      if (parentSib) {
        const pst = text(parentSib);
        if (isUsableValue(pst)) valueEl = parentSib;
      }
    }
    if (!valueEl && el.parentElement) {
      const siblings = Array.from(el.parentElement.children).filter((c) => c !== el);
      for (const s of siblings) {
        const st = text(s);
        if (isUsableValue(st)) {
          valueEl = s;
          break;
        }
      }
    }

    if (label && valueEl) {
      const flatValue = text(valueEl);
      fields[label] = valueText(valueEl) || flatValue;
      consumedTexts.add(t);
      consumedTexts.add(flatValue);
    }
  }

  // --- 3. Notes thread ---
  // Confirmed from the live page's real markup: each reply is a
  // ".msg-container .chat-message" card with a ".data-message" (date +
  // time), an ".author-message" (who wrote it), and the message body as
  // the card's remaining <div> child (its header and the ".line-bottom"
  // divider are excluded).
  const notes = [];
  const noteCards = Array.from(document.querySelectorAll('.msg-container .chat-message'));
  for (const card of noteCards) {
    const dataMsgEl = card.querySelector('.data-message');
    const authorEl = card.querySelector('.author-message');
    const dateStr = dataMsgEl ? text(dataMsgEl) : '';
    const authorStr = authorEl ? text(authorEl) : '';
    const bodyEl = Array.from(card.children).find(
      (c) => c.tagName === 'DIV' && !c.classList.contains('line-bottom')
    );
    const bodyText = bodyEl ? valueText(bodyEl) : '';
    if (!dateStr && !authorStr && !bodyText) continue;
    notes.push({
      date: dateStr,
      author: authorStr,
      text: bodyText,
      raw: (authorStr || '') + (dateStr ? ' (' + dateStr + ')' : '') + (bodyText ? ':\n' + bodyText : ''),
    });
  }

  // --- 4. Attached files ---
  // Match both "looks like a download control" and "link points at a
  // known attachment file extension" so icon-only buttons are still caught.
  const attachments = [];
  const seenHrefs = new Set();
  // Lookahead (not a hard "?" or end-of-string" anchor) because on this
  // site the real extension can sit in the middle of a query string (e.g.
  // "...blobName=xxx.mp4&containerName=..."), followed by "&", not just
  // by "?" or the end of the URL.
  const KNOWN_FILE_EXT = 'bin|flt|ver|jpg|jpeg|png|gif|bmp|webp|heic|tiff?|pdf|txt|csv|xlsx?|docx?|mp4|mov|m4v|avi|mkv|webm|wmv';
  const extPattern = new RegExp('\\.(' + KNOWN_FILE_EXT + ')(?=[?&]|$)', 'i');
  const filenamePattern = new RegExp('[\\w.\\-]+\\.(' + KNOWN_FILE_EXT + ')', 'i');
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
    let m = ownText.match(filenamePattern);
    if (m) filename = m[0];
    if (!filename && href) {
      m = href.match(filenamePattern);
      if (m) filename = m[0];
    }
    if (!filename) {
      let card = el.closest('div');
      let hops = 0;
      while (card && hops < 5 && !filename) {
        const cm = text(card).match(filenamePattern);
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

  // --- 4b. Download each attachment's actual bytes, so it can be
  // re-uploaded (by the import tool, via the same Drive upload the
  // normal report form already uses) instead of staying a dead link
  // into a system you'd need to log into. This only works for files on
  // this same CNH domain — the browser sends your existing session
  // cookies automatically, the same as clicking the link yourself.
  const MAX_ATTACHMENT_BYTES = 8 * 1024 * 1024; // skip anything bigger than 8MB raw — see v12 note below
  // Only these are downloaded and carried into the portal: photos, PDFs,
  // and videos. Diagnostic/log files (.bin, .flt, .ver, .txt, .csv, etc.)
  // are left out on purpose — they're still listed below with a note, but
  // their bytes are never fetched and they never reach the "poze" upload.
  // Same lookahead reasoning as extPattern above — the extension can be
  // followed by "&" (buried in a query string), not just "?" or the end.
  const ALLOWED_DOWNLOAD_EXT = /\.(jpe?g|png|gif|bmp|webp|heic|tiff?|pdf|mp4|mov|m4v|avi|mkv|webm|wmv)(?=[?&]|$)/i;
  function guessMimeType(filename, blobType) {
    if (blobType) return blobType;
    const ext = (filename.match(/\.([a-z0-9]+)$/i) || [])[1];
    const map = {
      jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', gif: 'image/gif',
      bmp: 'image/bmp', webp: 'image/webp', heic: 'image/heic', tif: 'image/tiff', tiff: 'image/tiff',
      pdf: 'application/pdf',
      mp4: 'video/mp4', mov: 'video/quicktime', m4v: 'video/x-m4v', avi: 'video/x-msvideo',
      mkv: 'video/x-matroska', webm: 'video/webm', wmv: 'video/x-ms-wmv',
    };
    return (ext && map[ext.toLowerCase()]) || 'application/octet-stream';
  }
  for (const att of attachments) {
    if (!ALLOWED_DOWNLOAD_EXT.test(att.filename) && !ALLOWED_DOWNLOAD_EXT.test(att.href || '')) {
      att.fetchError = 'Tip de fișier neacceptat — se descarcă automat doar poze, PDF și video.';
      continue;
    }
    if (!att.href) { att.fetchError = 'Niciun link direct — nu poate fi descărcat automat.'; continue; }
    let sameOrigin = false;
    try { sameOrigin = new URL(att.href, location.href).origin === location.origin; } catch (e) { sameOrigin = false; }
    if (!sameOrigin) { att.fetchError = 'Link către alt domeniu — nu poate fi descărcat automat.'; continue; }
    try {
      // 'same-origin' (not 'include'): send cookies to the CNH page's own
      // redirector, but NOT to the Azure Blob Storage URL it redirects to
      // — that one is already authenticated via a signed SAS token in its
      // query string, and it answers with a wildcard CORS header that
      // browsers refuse to pair with credentialed requests.
      const resp = await fetch(att.href, { credentials: 'same-origin' });
      if (!resp.ok) { att.fetchError = 'HTTP ' + resp.status; continue; }
      const blob = await resp.blob();
      if (blob.size > MAX_ATTACHMENT_BYTES) {
        att.fetchError = 'Fișier prea mare (' + Math.round(blob.size / 1024 / 1024) + ' MB) — sărit automat.';
        continue;
      }
      const dataUrl = await new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result);
        reader.onerror = reject;
        reader.readAsDataURL(blob);
      });
      att.mimeType = guessMimeType(att.filename, blob.type);
      att.dataBase64 = String(dataUrl).split(',')[1] || '';
      att.sizeBytes = blob.size;
    } catch (err) {
      att.fetchError = 'Eroare la descărcare: ' + err.message;
    }
  }

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
