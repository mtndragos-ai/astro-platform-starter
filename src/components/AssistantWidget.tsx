import { useState, useRef, useEffect, Fragment } from 'react';
import { createPortal } from 'react-dom';
import './AssistantWidget.css';
import { MACHINE_GROUPS } from '../lib/machine-groups.mjs';

type Citation = {
  manualTitle: string;
  sectionTitle: string;
  sourcePages: string;
  imageUrl?: string | null;
};

type Message = {
  role: 'user' | 'assistant';
  text: string;
  citations?: Citation[];
  imagePreview?: string;
};

type PendingImage = { dataUrl: string; base64: string; mediaType: string };

function renderMarkdown(text: string) {
  const withoutHeaders = text.replace(/^#{1,6}\s*/gm, '');
  const blocks = withoutHeaders.split(/\n\s*\n/).filter((b) => b.trim());

  return blocks.map((block, i) => {
    const lines = block.split('\n').map((l) => l.trim()).filter(Boolean);
    const isList = lines.every((l) => /^(-|\*|\d+\.)\s/.test(l));

    if (isList) {
      return (
        <ul className="ac-msg-list" key={i}>
          {lines.map((line, j) => (
            <li key={j}>{renderInline(line.replace(/^(-|\*|\d+\.)\s/, ''))}</li>
          ))}
        </ul>
      );
    }
    return <p key={i}>{renderInline(lines.join(' '))}</p>;
  });
}

function renderInline(text: string) {
  const parts = text.split(/(\*\*[^*]+\*\*)/g);
  return parts.map((part, i) => {
    if (part.startsWith('**') && part.endsWith('**')) {
      return <strong key={i}>{part.slice(2, -2)}</strong>;
    }
    return <Fragment key={i}>{part}</Fragment>;
  });
}

// Phone photos are often several MB and 4000px wide; shrink before sending
// so the request stays well under the serverless function's size limit.
// 1400px is still plenty to read a part number or a control panel screen.
function resizeImage(file: File, maxDim = 1400, quality = 0.75): Promise<PendingImage> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error('Could not read file'));
    reader.onload = () => {
      const img = new Image();
      img.onerror = () => reject(new Error('Could not load image'));
      img.onload = () => {
        let { width, height } = img;
        if (width > maxDim || height > maxDim) {
          const scale = maxDim / Math.max(width, height);
          width = Math.round(width * scale);
          height = Math.round(height * scale);
        }
        const canvas = document.createElement('canvas');
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext('2d');
        if (!ctx) return reject(new Error('Canvas not supported'));
        ctx.drawImage(img, 0, 0, width, height);
        const dataUrl = canvas.toDataURL('image/jpeg', quality);
        resolve({ dataUrl, base64: dataUrl.split(',')[1], mediaType: 'image/jpeg' });
      };
      img.src = reader.result as string;
    };
    reader.readAsDataURL(file);
  });
}

export default function AssistantWidget() {
  const [open, setOpen] = useState(false);
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [pendingImage, setPendingImage] = useState<PendingImage | null>(null);
  const [imageError, setImageError] = useState<string | null>(null);
  const [machineId, setMachineId] = useState('');
  // The site's header lives in each page rather than the layout, so instead
  // of editing every page we mount the trigger into the existing
  // `.header-right` container — the same hook the dark-mode button uses.
  const [headerSlot, setHeaderSlot] = useState<Element | null>(null);

  const inputRef = useRef<HTMLInputElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const logRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let mount: HTMLElement | null = null;
    let observer: MutationObserver | null = null;

    function tryMount() {
      const header = document.querySelector('.header-right');
      if (!header) return false;
      mount = document.createElement('div');
      mount.className = 'ac-chat-mount';
      // Place it before the user profile so it sits next to Admin / theme toggle.
      const profile = document.getElementById('user-profile-trigger');
      if (profile) header.insertBefore(mount, profile);
      else header.appendChild(mount);
      setHeaderSlot(mount);
      return true;
    }

    if (!tryMount()) {
      // The header is rendered by the page's own scripts, which may run after
      // React mounts — watch for it rather than giving up. If it never shows
      // (e.g. the login page), the trigger falls back to a floating button.
      observer = new MutationObserver(() => {
        if (tryMount()) observer?.disconnect();
      });
      observer.observe(document.body, { childList: true, subtree: true });
      // Stop watching after a few seconds so we don't observe forever.
      setTimeout(() => observer?.disconnect(), 5000);
    }

    return () => {
      observer?.disconnect();
      mount?.remove();
    };
  }, []);

  useEffect(() => {
    if (logRef.current) logRef.current.scrollTop = logRef.current.scrollHeight;
  }, [messages, loading]);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') setOpen(false);
    }
    if (open) window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open]);

  useEffect(() => {
    if (open) inputRef.current?.focus();
  }, [open]);

  async function handleFileSelect(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    if (!file.type.startsWith('image/')) {
      setImageError('Fișierul nu este o imagine.');
      return;
    }
    try {
      setImageError(null);
      setPendingImage(await resizeImage(file));
    } catch {
      setImageError('Nu am putut citi poza. Încearcă alta.');
    }
  }

  async function sendMessage(e: React.FormEvent) {
    e.preventDefault();
    const question = input.trim();
    if ((!question && !pendingImage) || loading) return;

    const imageToSend = pendingImage;
    setMessages((m) => [
      ...m,
      { role: 'user', text: question || '(poză atașată)', imagePreview: imageToSend?.dataUrl },
    ]);
    setInput('');
    setPendingImage(null);
    setLoading(true);

    try {
      // Send the recent exchange so follow-ups ("and the pressure?") make
      // sense. Capped at 8 turns — enough to hold a thread, small enough to
      // keep requests fast and cheap.
      const historyToSend = messages.slice(-8).map((m) => ({
        role: m.role,
        text: m.text,
      }));

      const res = await fetch('/.netlify/functions/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          question,
          machineId: machineId || undefined,
          history: historyToSend,
          image: imageToSend
            ? { base64: imageToSend.base64, mediaType: imageToSend.mediaType }
            : undefined,
        }),
      });
      if (!res.ok) throw new Error(`Request failed: ${res.status}`);
      const data = await res.json();
      setMessages((m) => [...m, { role: 'assistant', text: data.answer, citations: data.citations }]);
    } catch {
      setMessages((m) => [...m, { role: 'assistant', text: 'Ceva nu a mers. Mai încearcă o dată.' }]);
    } finally {
      setLoading(false);
      inputRef.current?.focus();
    }
  }

  const trigger = (
    <button
      type="button"
      className="ac-chat-trigger"
      onClick={() => setOpen((o) => !o)}
      aria-expanded={open}
      title="Asistent Manuale"
    >
      <span aria-hidden="true">💬</span>
      <span className="ac-chat-trigger-text">Asistent</span>
    </button>
  );

  return (
    <>
      {headerSlot ? (
        createPortal(trigger, headerSlot)
      ) : (
        // Header not found on this page — show the trigger as a floating
        // button instead of letting it land wherever the layout put it.
        <div className="ac-chat-floating">{trigger}</div>
      )}

      {open && (
        <>
          <div className="ac-chat-backdrop" onClick={() => setOpen(false)} />
          <section className="ac-chat-panel" aria-label="Asistent manuale">
            <header className="ac-chat-header">
              <div>
                <h2 className="ac-chat-title">Asistent Manuale</h2>
                <p className="ac-chat-subtitle">Răspunsuri direct din manualele tehnice</p>
              </div>
              <div className="ac-chat-header-actions">
                {messages.length > 0 && (
                  <button
                    type="button"
                    className="ac-chat-reset"
                    onClick={() => setMessages([])}
                    title="Începe o conversație nouă"
                  >
                    Conversație nouă
                  </button>
                )}
                <button
                  type="button"
                  className="ac-chat-close"
                  onClick={() => setOpen(false)}
                  aria-label="Închide"
                >
                  &times;
                </button>
              </div>
            </header>

            <div className="ac-chat-machine">
              <label htmlFor="ac-machine-select">Echipament</label>
              <select
                id="ac-machine-select"
                value={machineId}
                onChange={(e) => setMachineId(e.target.value)}
              >
                <option value="">Toate manualele</option>
                {(MACHINE_GROUPS as any[]).map((g) => (
                  <option key={g.id} value={g.id}>{g.label}</option>
                ))}
              </select>
            </div>

            <div className="ac-chat-log" ref={logRef} role="log" aria-live="polite">
              {messages.length === 0 && !loading && (
                <p className="ac-chat-empty">
                  Selectează echipamentul, apoi scrie întrebarea ta — sau atașează o poză.
                </p>
              )}
              {messages.map((m, i) => (
                <div key={i} className={`ac-msg ac-msg--${m.role}`}>
                  {m.imagePreview && (
                    <img className="ac-msg-image" src={m.imagePreview} alt="Poză atașată" />
                  )}
                  {m.role === 'assistant' ? (
                    <div className="ac-msg-markdown">{renderMarkdown(m.text)}</div>
                  ) : (
                    <span>{m.text}</span>
                  )}
                  {m.citations && m.citations.length > 0 && (
                    <div className="ac-citations">
                      {m.citations.map((c, j) => (
                        <a
                          key={j}
                          className="ac-citation"
                          href={c.imageUrl ?? undefined}
                          target="_blank"
                          rel="noreferrer"
                        >
                          {c.imageUrl && (
                            <img
                              className="ac-citation-thumb"
                              src={c.imageUrl}
                              alt={`Pagina ${c.sourcePages}`}
                              loading="lazy"
                            />
                          )}
                          <span className="ac-citation-label">
                            <strong>{c.manualTitle}</strong>
                            <span>{c.sectionTitle} · p.{c.sourcePages}</span>
                          </span>
                        </a>
                      ))}
                    </div>
                  )}
                </div>
              ))}
              {loading && (
                <div className="ac-typing" aria-label="Se încarcă">
                  <span></span><span></span><span></span>
                </div>
              )}
            </div>

            {pendingImage && (
              <div className="ac-chat-preview">
                <img src={pendingImage.dataUrl} alt="Poză de trimis" />
                <span>Poză atașată</span>
                <button type="button" onClick={() => setPendingImage(null)} aria-label="Elimină poza">
                  &times;
                </button>
              </div>
            )}
            {imageError && <p className="ac-chat-error">{imageError}</p>}

            <form className="ac-chat-form" onSubmit={sendMessage}>
              <input
                type="file"
                accept="image/*"
                ref={fileInputRef}
                onChange={handleFileSelect}
                className="ac-chat-file"
              />
              <button
                type="button"
                className="ac-chat-attach"
                onClick={() => fileInputRef.current?.click()}
                disabled={loading}
                title="Atașează o poză"
              >
                📷
              </button>
              <input
                ref={inputRef}
                type="text"
                className="ac-chat-input"
                value={input}
                onChange={(e) => setInput(e.target.value)}
                placeholder="Ex: Unde este compensatorul?"
                disabled={loading}
              />
              <button
                type="submit"
                className="ac-chat-send"
                disabled={loading || (!input.trim() && !pendingImage)}
              >
                Trimite
              </button>
            </form>
          </section>
        </>
      )}
    </>
  );
}
