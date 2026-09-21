import { useState, useRef, useEffect, Fragment } from 'react';
import { createPortal } from 'react-dom';
import './AssistantWidget.css';
import { MACHINE_GROUPS } from '../lib/machine-groups.mjs';

type Citation = {
  number: number;
  manualTitle: string;
  sectionTitle: string;
  sourcePages: string;
  imageUrl?: string | null;
};

type Message = {
  id: string;
  role: 'user' | 'assistant';
  text: string;
  citations?: Citation[];
  relatedQuestions?: string[];
  imagePreview?: string;
};

type PendingImage = { dataUrl: string; base64: string; mediaType: string };

type SavedConversation = {
  id: string;
  title: string;
  updatedAt: number;
  messages: Message[];
};

const HISTORY_KEY = 'ac-chat-conversations';
const FEEDBACK_KEY = 'ac-chat-feedback';
const MAX_SAVED_CONVERSATIONS = 20;

function genId(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) {
    return crypto.randomUUID();
  }
  return `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

// localStorage can throw in private browsing or when full — every call here
// is wrapped so a storage failure never breaks the actual conversation.
function loadHistory(): SavedConversation[] {
  try {
    const raw = localStorage.getItem(HISTORY_KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function saveHistory(list: SavedConversation[]) {
  try {
    localStorage.setItem(HISTORY_KEY, JSON.stringify(list.slice(0, MAX_SAVED_CONVERSATIONS)));
  } catch {
    // storage unavailable or full — history just won't persist this session
  }
}

function loadFeedback(): Record<string, 'up' | 'down'> {
  try {
    const raw = localStorage.getItem(FEEDBACK_KEY);
    const parsed = raw ? JSON.parse(raw) : {};
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}

function saveFeedback(map: Record<string, 'up' | 'down'>) {
  try {
    localStorage.setItem(FEEDBACK_KEY, JSON.stringify(map));
  } catch {
    // non-fatal — feedback is a nice-to-have, not core functionality
  }
}

function relativeTime(ts: number): string {
  const diffMs = Date.now() - ts;
  const min = Math.floor(diffMs / 60000);
  if (min < 1) return 'chiar acum';
  if (min < 60) return `acum ${min} min`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `acum ${hr} h`;
  const days = Math.floor(hr / 24);
  if (days < 7) return `acum ${days} zile`;
  return new Date(ts).toLocaleDateString('ro-RO');
}

function renderMarkdown(
  text: string,
  citations: Citation[] | undefined,
  onCiteClick: (n: number) => void
) {
  const withoutHeaders = text.replace(/^#{1,6}\s*/gm, '');
  const blocks = withoutHeaders.split(/\n\s*\n/).filter((b) => b.trim());

  return blocks.map((block, i) => {
    const lines = block.split('\n').map((l) => l.trim()).filter(Boolean);
    const isList = lines.every((l) => /^(-|\*|\d+\.)\s/.test(l));

    if (isList) {
      return (
        <ul className="ac-msg-list" key={i}>
          {lines.map((line, j) => (
            <li key={j}>
              {renderInline(line.replace(/^(-|\*|\d+\.)\s/, ''), citations, onCiteClick)}
            </li>
          ))}
        </ul>
      );
    }
    return <p key={i}>{renderInline(lines.join(' '), citations, onCiteClick)}</p>;
  });
}

function renderInline(
  text: string,
  citations: Citation[] | undefined,
  onCiteClick: (n: number) => void
) {
  const parts = text.split(/(\*\*[^*]+\*\*|\[\d+\])/g);
  return parts.map((part, i) => {
    if (part.startsWith('**') && part.endsWith('**')) {
      return <strong key={i}>{part.slice(2, -2)}</strong>;
    }
    const citeMatch = part.match(/^\[(\d+)\]$/);
    if (citeMatch) {
      const n = parseInt(citeMatch[1], 10);
      const citation = citations?.find((c) => c.number === n);
      if (citation) {
        return (
          <button
            key={i}
            type="button"
            className="ac-cite-badge"
            title={`${citation.manualTitle} — ${citation.sectionTitle}, p.${citation.sourcePages}`}
            onClick={() => onCiteClick(n)}
          >
            {n}
          </button>
        );
      }
      return <Fragment key={i}>{part}</Fragment>;
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

  const [conversationId, setConversationId] = useState(() => genId());
  const [savedConversations, setSavedConversations] = useState<SavedConversation[]>([]);
  const [historyOpen, setHistoryOpen] = useState(false);

  const [feedback, setFeedback] = useState<Record<string, 'up' | 'down'>>({});
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [shareFallbackId, setShareFallbackId] = useState<string | null>(null);

  const [expandedRefs, setExpandedRefs] = useState<Record<string, boolean>>({});
  const [highlight, setHighlight] = useState<string | null>(null);

  const inputRef = useRef<HTMLInputElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const logRef = useRef<HTMLDivElement>(null);
  const historyPanelRef = useRef<HTMLDivElement>(null);

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

  useEffect(() => {
    setSavedConversations(loadHistory());
    setFeedback(loadFeedback());
  }, []);

  // Close the history dropdown on an outside click.
  useEffect(() => {
    if (!historyOpen) return;
    function onClick(e: MouseEvent) {
      if (historyPanelRef.current && !historyPanelRef.current.contains(e.target as Node)) {
        setHistoryOpen(false);
      }
    }
    document.addEventListener('mousedown', onClick);
    return () => document.removeEventListener('mousedown', onClick);
  }, [historyOpen]);

  // Persist the current thread into history whenever it gains a full
  // exchange. Keyed by conversationId, so continuing an old conversation
  // updates its existing entry instead of forking a new one.
  useEffect(() => {
    if (messages.length === 0) return;
    const firstUser = messages.find((m) => m.role === 'user');
    const title = (firstUser?.text || 'Conversație').slice(0, 60);

    setSavedConversations((prev) => {
      const withoutCurrent = prev.filter((c) => c.id !== conversationId);
      const next = [
        { id: conversationId, title, updatedAt: Date.now(), messages },
        ...withoutCurrent,
      ].slice(0, MAX_SAVED_CONVERSATIONS);
      saveHistory(next);
      return next;
    });
  }, [messages, conversationId]);

  function startNewConversation() {
    setMessages([]);
    setConversationId(genId());
    setHistoryOpen(false);
    setPendingImage(null);
    setImageError(null);
  }

  function loadConversation(conv: SavedConversation) {
    setMessages(conv.messages);
    setConversationId(conv.id);
    setHistoryOpen(false);
  }

  function deleteConversation(id: string, e: React.MouseEvent) {
    e.stopPropagation();
    setSavedConversations((prev) => {
      const next = prev.filter((c) => c.id !== id);
      saveHistory(next);
      return next;
    });
  }

  function setMessageFeedback(id: string, value: 'up' | 'down') {
    setFeedback((prev) => {
      const next = { ...prev };
      if (next[id] === value) {
        delete next[id];
      } else {
        next[id] = value;
      }
      saveFeedback(next);
      return next;
    });
  }

  async function copyText(text: string, id: string) {
    try {
      await navigator.clipboard.writeText(text);
      setCopiedId(id);
      window.setTimeout(() => setCopiedId((cur) => (cur === id ? null : cur)), 1500);
    } catch {
      // Clipboard API can be unavailable — fail quietly.
    }
  }

  async function shareText(text: string, id: string) {
    if (navigator.share) {
      try {
        await navigator.share({ text });
      } catch {
        // person cancelled the share sheet — not an error
      }
      return;
    }
    try {
      await navigator.clipboard.writeText(text);
      setShareFallbackId(id);
      window.setTimeout(() => setShareFallbackId((cur) => (cur === id ? null : cur)), 1500);
    } catch {
      // non-fatal
    }
  }

  function handleCiteClick(messageId: string, n: number) {
    setExpandedRefs((prev) => ({ ...prev, [messageId]: true }));
    const key = `${messageId}:${n}`;
    setHighlight(key);
    window.setTimeout(() => {
      setHighlight((cur) => (cur === key ? null : cur));
    }, 1400);
    window.setTimeout(() => {
      document.getElementById(`ac-cite-${messageId}-${n}`)?.scrollIntoView({
        behavior: 'smooth',
        block: 'nearest',
      });
    }, 50);
  }

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

  async function sendMessage(e?: React.FormEvent, overrideQuestion?: string) {
    e?.preventDefault();
    const isOverride = overrideQuestion !== undefined;
    const question = (overrideQuestion ?? input).trim();
    if ((!question && !pendingImage) || loading) return;

    // O întrebare conexă e doar text — nu atașăm o poză rămasă de la un
    // mesaj anterior, fără legătură.
    const imageToSend = isOverride ? null : pendingImage;

    setMessages((m) => [
      ...m,
      {
        id: genId(),
        role: 'user',
        text: question || '(poză atașată)',
        imagePreview: imageToSend?.dataUrl,
      },
    ]);
    if (!isOverride) {
      setInput('');
      setPendingImage(null);
    }
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
      setMessages((m) => [
        ...m,
        {
          id: genId(),
          role: 'assistant',
          text: data.answer,
          citations: data.citations,
          relatedQuestions: data.relatedQuestions,
        },
      ]);
    } catch {
      setMessages((m) => [
        ...m,
        { id: genId(), role: 'assistant', text: 'Ceva nu a mers. Mai încearcă o dată.' },
      ]);
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
                    onClick={startNewConversation}
                    title="Începe o conversație nouă"
                  >
                    Conversație nouă
                  </button>
                )}
                <div className="ac-history-wrap" ref={historyPanelRef}>
                  <button
                    type="button"
                    className="ac-chat-reset"
                    onClick={() => setHistoryOpen((v) => !v)}
                    title="Conversații anterioare"
                  >
                    Istoric
                  </button>
                  {historyOpen && (
                    <div className="ac-history-panel">
                      {savedConversations.length === 0 ? (
                        <p className="ac-history-empty">Nicio conversație salvată.</p>
                      ) : (
                        savedConversations
                          .slice()
                          .sort((a, b) => b.updatedAt - a.updatedAt)
                          .map((conv) => (
                            <button
                              type="button"
                              key={conv.id}
                              className={`ac-history-item${
                                conv.id === conversationId ? ' ac-history-item--active' : ''
                              }`}
                              onClick={() => loadConversation(conv)}
                            >
                              <span className="ac-history-item-title">{conv.title}</span>
                              <span className="ac-history-item-time">
                                {relativeTime(conv.updatedAt)}
                              </span>
                              <span
                                className="ac-history-item-delete"
                                onClick={(e) => deleteConversation(conv.id, e)}
                                role="button"
                                aria-label="Șterge conversația"
                                tabIndex={-1}
                              >
                                &times;
                              </span>
                            </button>
                          ))
                      )}
                    </div>
                  )}
                </div>
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
              {messages.map((m) => (
                <div key={m.id} className={`ac-msg ac-msg--${m.role}`}>
                  {m.imagePreview && (
                    <img className="ac-msg-image" src={m.imagePreview} alt="Poză atașată" />
                  )}
                  {m.role === 'assistant' ? (
                    <div className="ac-msg-markdown">
                      {renderMarkdown(m.text, m.citations, (n) => handleCiteClick(m.id, n))}
                    </div>
                  ) : (
                    <span>{m.text}</span>
                  )}

                  {m.citations && m.citations.length > 0 && (
                    <div className="ac-references">
                      <button
                        type="button"
                        className="ac-references-toggle"
                        onClick={() =>
                          setExpandedRefs((prev) => ({ ...prev, [m.id]: !(prev[m.id] ?? true) }))
                        }
                      >
                        {m.citations.length === 1
                          ? '1 referință'
                          : `${m.citations.length} referințe`}
                        <span className="ac-references-chevron">
                          {(expandedRefs[m.id] ?? true) ? '\u25BE' : '\u25B8'}
                        </span>
                      </button>
                      {(expandedRefs[m.id] ?? true) && (
                        <div className="ac-citations">
                          {m.citations.map((c) => (
                            <a
                              key={c.number}
                              id={`ac-cite-${m.id}-${c.number}`}
                              className={`ac-citation${
                                highlight === `${m.id}:${c.number}` ? ' ac-citation--highlight' : ''
                              }`}
                              href={c.imageUrl ?? undefined}
                              target="_blank"
                              rel="noreferrer"
                            >
                              <span className="ac-citation-number">{c.number}</span>
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
                  )}

                  {m.role === 'assistant' && (
                    <div className="ac-msg-actions">
                      <button
                        type="button"
                        className={`ac-action-btn${feedback[m.id] === 'up' ? ' ac-action-btn--active' : ''}`}
                        onClick={() => setMessageFeedback(m.id, 'up')}
                        aria-label="Util"
                        title="Util"
                      >
                        &#128077;
                      </button>
                      <button
                        type="button"
                        className={`ac-action-btn${feedback[m.id] === 'down' ? ' ac-action-btn--active' : ''}`}
                        onClick={() => setMessageFeedback(m.id, 'down')}
                        aria-label="Nu a ajutat"
                        title="Nu a ajutat"
                      >
                        &#128078;
                      </button>
                      <button
                        type="button"
                        className="ac-action-btn ac-action-text"
                        onClick={() => copyText(m.text, m.id)}
                      >
                        {copiedId === m.id ? 'Copiat' : 'Copiază'}
                      </button>
                      <button
                        type="button"
                        className="ac-action-btn ac-action-text"
                        onClick={() => shareText(m.text, m.id)}
                      >
                        {shareFallbackId === m.id ? 'Copiat' : 'Distribuie'}
                      </button>
                    </div>
                  )}

                  {m.relatedQuestions && m.relatedQuestions.length > 0 && (
                    <div className="ac-related-questions">
                      {m.relatedQuestions.map((q, i) => (
                        <button
                          key={i}
                          type="button"
                          className="ac-related-chip"
                          disabled={loading}
                          onClick={() => sendMessage(undefined, q)}
                        >
                          {q}
                        </button>
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
                placeholder="Ex: Calibrare debitmetru iXtrack"
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
