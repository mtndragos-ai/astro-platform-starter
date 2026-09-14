import type { Handler } from '@netlify/functions';
import { MACHINE_GROUPS, detectMachineSlugs } from './machine-groups.mjs';

// Full RAG pipeline: embed the question with OpenAI, retrieve the closest
// manual chunks from Supabase (pgvector), then ask Claude to answer using
// only those excerpts.

const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

const EMBED_MODEL = 'text-embedding-3-small'; // must match the ingestion script
const MATCH_COUNT = 8; // fetched for Claude's context — more raw material to work with
const CITATION_MIN_SIMILARITY = 0.3; // only chunks at least this relevant get shown as a citation card
const MAX_CITATIONS = 3; // Claude still sees all 8; this just keeps the card list readable

type RetrievedChunk = {
  manualTitle: string;
  manualSlug: string;
  sectionTitle: string;
  sourcePages: string;
  text: string;
  similarity: number;
};

export const handler: Handler = async (event) => {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'Method Not Allowed' };
  }

  const missing = [
    !ANTHROPIC_API_KEY && 'ANTHROPIC_API_KEY',
    !OPENAI_API_KEY && 'OPENAI_API_KEY',
    !SUPABASE_URL && 'SUPABASE_URL',
    !SUPABASE_SERVICE_ROLE_KEY && 'SUPABASE_SERVICE_ROLE_KEY',
  ].filter(Boolean);
  if (missing.length > 0) {
    return {
      statusCode: 500,
      body: JSON.stringify({ error: `Missing env vars: ${missing.join(', ')}` }),
    };
  }

  let question: string;
  let image: { base64: string; mediaType: string } | undefined;
  let machineId: string | undefined;
  let history: { role: 'user' | 'assistant'; text: string }[] = [];
  try {
    const body = JSON.parse(event.body || '{}');
    question = typeof body.question === 'string' ? body.question : '';
    image = body.image;
    machineId = typeof body.machineId === 'string' ? body.machineId : undefined;
    // Prior turns, oldest first. Capped client-side; capped again here so a
    // malformed request can't blow up the prompt size.
    if (Array.isArray(body.history)) {
      history = body.history
        .filter(
          (m: any) =>
            m &&
            (m.role === 'user' || m.role === 'assistant') &&
            typeof m.text === 'string'
        )
        .slice(-8);
    }
    if (!question.trim() && !image) {
      throw new Error('Need a question, an image, or both');
    }
    if (image && (typeof image.base64 !== 'string' || typeof image.mediaType !== 'string')) {
      throw new Error('Malformed image payload');
    }
  } catch {
    return { statusCode: 400, body: JSON.stringify({ error: 'Invalid request body.' }) };
  }

  // A follow-up like "and what pressure should I find?" has almost no
  // searchable content on its own — embedding it alone retrieves noise.
  // Prepending the recent exchange gives the search enough context to land
  // on the same part of the manual the person is still asking about.
  const recentContext = history
    .slice(-4)
    .map((m) => m.text)
    .join(' ');
  const questionForRetrieval = question.trim()
    ? recentContext
      ? `${recentContext} ${question.trim()}`
      : question.trim()
    : 'identify this component, error code, or issue shown in the photo';

  let retrievalQuery: string;
  try {
    retrievalQuery = await translateForRetrieval(questionForRetrieval);
  } catch {
    // If translation fails for any reason, fall back to the raw question
    // rather than blocking the whole request.
    retrievalQuery = questionForRetrieval;
  }

  // Scope the search to one machine's manuals when we can. An explicit
  // dropdown choice always wins; otherwise we try to infer the machine from
  // the question, and fall back to searching everything when it's unclear.
  // This matters because the largest manual would otherwise dominate results
  // for generic questions regardless of which machine the person meant.
  const selectedGroup = machineId
    ? MACHINE_GROUPS.find((g: any) => g.id === machineId)
    : undefined;
  const filterSlugs: string[] | null =
    selectedGroup?.slugs ?? detectMachineSlugs(retrievalQuery) ?? null;

  let retrievedChunks: RetrievedChunk[];
  try {
    retrievedChunks = await retrieveRelevantChunks(retrievalQuery, filterSlugs);
  } catch (err: any) {
    return {
      statusCode: 502,
      body: JSON.stringify({ error: 'Retrieval failed.', detail: String(err?.message ?? err) }),
    };
  }

  const contextChunks = retrievedChunks.filter((c) => c.similarity >= 0.15);
  const context = contextChunks
    .map(
      (c, i) =>
        `[${i + 1}] ${c.manualTitle} — ${c.sectionTitle} (p. ${c.sourcePages})\n${c.text}`
    )
    .join('\n\n');

  const systemPrompt = `You are Dispatch — a two-way-radio-style assistant helping farmers get quick, practical answers from their equipment manuals mid-job. Talk like a knowledgeable dispatcher, not a document: short, direct sentences, no headers, no document titles.

The person may attach a photo (a part, a control panel, an error screen, damage) along with or instead of a typed question. Look at it directly and answer based on what you see, combined with the manual excerpts below.

Answer only using the manual excerpts provided below for factual claims about the equipment. If they don't contain the answer, say so plainly rather than guessing — but you can still describe what's visible in a photo even if the manual excerpts don't cover it.

The excerpts may come from more than one machine. Only use excerpts that match the machine the person is asking about. If the excerpts are all about a different machine, say you don't have the manual content for theirs rather than answering from the wrong one.

This may be a follow-up in an ongoing conversation. If the person says "it", "that", or asks a short follow-up, work out what they mean from the earlier messages rather than asking them to repeat themselves. Note the excerpts below are re-fetched for each question, so they may be less specific than the ones behind your previous answer — if you already gave a detail earlier in the conversation, you can rely on it.

Always answer in the same language the person's question was asked in, even though the excerpts below are in English — translate the substance, not just quote English back.

Formatting: use **bold** only for the specific values that matter most (torque specs, part numbers, measurements) — not whole phrases. Use a short dash-bulleted list only for multi-step procedures. Otherwise, write in plain sentences. Never use markdown headers (#, ##).

Manual excerpts:
${context || '(no matching excerpts found)'}`;

  const userContent: any[] = [];
  if (image) {
    userContent.push({
      type: 'image',
      source: { type: 'base64', media_type: image.mediaType, data: image.base64 },
    });
  }
  userContent.push({
    type: 'text',
    text: question.trim() || 'What is shown in this photo, and how do I address it based on the manual?',
  });

  // Replay prior turns so Claude can resolve "it", "that valve", "and the
  // pressure?" against what was already discussed. Only the text is kept —
  // earlier photos aren't resent, to keep the request small.
  const priorMessages = history.map((m) => ({
    role: m.role,
    content: m.text,
  }));

  const response = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': ANTHROPIC_API_KEY as string,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: 'claude-sonnet-4-6',
      max_tokens: 1000,
      system: systemPrompt,
      messages: [...priorMessages, { role: 'user', content: userContent }],
    }),
  });

  if (!response.ok) {
    const errText = await response.text();
    return {
      statusCode: 502,
      body: JSON.stringify({ error: 'Upstream model call failed.', detail: errText }),
    };
  }

  const data = await response.json();
  const answer = data.content?.find((b: any) => b.type === 'text')?.text ?? '';

  return {
    statusCode: 200,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      answer,
      citations: dedupeCitations(
        retrievedChunks.filter((c) => c.similarity >= CITATION_MIN_SIMILARITY)
      )
        .slice(0, MAX_CITATIONS)
        .map((c) => ({
          manualTitle: c.manualTitle,
          sectionTitle: c.sectionTitle,
          sourcePages: c.sourcePages,
          imageUrl: pageImageUrl(c.manualSlug, c.sourcePages),
        })),
    }),
  };
};

// Several chunks often come from the same manual page, which would show as
// duplicate cards pointing at the same image. Keep the highest-scoring chunk
// per page — the input is already sorted by similarity, so first wins.
function dedupeCitations(chunks: RetrievedChunk[]): RetrievedChunk[] {
  const seen = new Set<string>();
  return chunks.filter((c) => {
    const key = `${c.manualSlug}:${c.sourcePages}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

// Page images live in a public Supabase Storage bucket named "manual-pages",
// inside a subfolder per manual (matching manual_slug), uploaded by
// scripts/upload-page-images.mjs, named p-0001.jpg (4-digit, zero-padded
// page number). source_pages can be a single page ("255") or a range
// ("142-145") — we use the first page as the representative image.
function pageImageUrl(manualSlug: string, sourcePages: string): string | null {
  if (!manualSlug) return null;
  const match = sourcePages.match(/\d+/);
  if (!match) return null;
  const pageNum = parseInt(match[0], 10);
  const padded = String(pageNum).padStart(4, '0');
  return `${SUPABASE_URL}/storage/v1/object/public/manual-pages/${manualSlug}/p-${padded}.jpg`;
}

// The manual's content is embedded in English, so retrieval accuracy drops
// sharply for non-English questions even when asking the exact same thing —
// the question's meaning-vector just doesn't land as close to the right
// chunks. Translating to English before embedding fixes this; the actual
// answer is still generated in the user's original language (see system
// prompt), so this step is invisible to them.
async function translateForRetrieval(question: string): Promise<string> {
  const response = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': ANTHROPIC_API_KEY as string,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: 'claude-sonnet-4-6',
      max_tokens: 200,
      system:
        'Translate the user message to English for a search query. If it is already in English, return it unchanged. Output ONLY the translated text, nothing else — no preamble, no quotes.',
      messages: [{ role: 'user', content: question }],
    }),
  });
  if (!response.ok) {
    throw new Error(`Translation call failed: ${response.status}`);
  }
  const data = await response.json();
  const translated = data.content?.find((b: any) => b.type === 'text')?.text?.trim();
  return translated || question;
}

async function embed(text: string): Promise<number[]> {
  const res = await fetch('https://api.openai.com/v1/embeddings', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${OPENAI_API_KEY}`,
    },
    body: JSON.stringify({ model: EMBED_MODEL, input: text }),
  });
  if (!res.ok) {
    throw new Error(`OpenAI embed failed: ${res.status} ${await res.text()}`);
  }
  const data = await res.json();
  return data.data[0].embedding;
}

async function retrieveRelevantChunks(
  question: string,
  filterSlugs: string[] | null
): Promise<RetrievedChunk[]> {
  const queryEmbedding = await embed(question);

  const res = await fetch(`${SUPABASE_URL}/rest/v1/rpc/match_manual_chunks`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      apikey: SUPABASE_SERVICE_ROLE_KEY as string,
      Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
    },
    body: JSON.stringify({
      query_embedding: queryEmbedding,
      match_count: MATCH_COUNT,
      min_similarity: 0.1,
      filter_slugs: filterSlugs,
    }),
  });

  if (!res.ok) {
    throw new Error(`Supabase RPC failed: ${res.status} ${await res.text()}`);
  }

  const rows = await res.json();
  return (rows as any[]).map((r) => ({
    manualTitle: r.manual_title,
    manualSlug: r.manual_slug,
    sectionTitle: r.section_title,
    sourcePages: r.source_pages ?? 'unknown',
    text: r.content,
    similarity: r.similarity ?? 0,
  }));
}
