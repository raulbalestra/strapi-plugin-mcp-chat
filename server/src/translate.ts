/**
 * Tradução resiliente a campos longos (a "Dor 1": EN→pt-BR estoura).
 *
 * NENHUM campo é enviado inteiro ao LLM. `splitForTranslation` quebra o valor em
 * pedaços abaixo de um teto de tokens (por parágrafo; parágrafos gigantes caem
 * para sentenças), cada pedaço é traduzido isolado e remontado na ordem. Assim a
 * tradução funciona para texto de qualquer tamanho.
 *
 * Funções puras (split/join) ficam testáveis sem rede; só `translateChunk` toca
 * a OpenAI, reusando o mesmo padrão `fetch` do services/chat.ts.
 */

const OPENAI_URL = 'https://api.openai.com/v1/chat/completions';
const MODEL = process.env.OPENAI_CHAT_MODEL || 'gpt-4o';

/** Estimativa grosseira de tokens (~4 chars/token) — suficiente para chunking. */
export const approxTokens = (s: string): number => Math.ceil((s || '').length / 4);

/** Teto de tokens de ENTRADA por pedaço. A saída pode crescer ~2x; o teto já
 *  deixa folga para isso dentro do limite do modelo. */
export const MAX_CHUNK_TOKENS = 1200;

const splitParagraphs = (text: string): string[] => text.split(/\n{2,}/);

/** Quebra em sentenças preservando a pontuação. */
const splitSentences = (text: string): string[] =>
  text.match(/[^.!?]+(?:[.!?]+|$)/g) || [text];

export interface SplitResult {
  chunks: string[];
  /** Remonta os pedaços traduzidos na ordem original. */
  join: (translated: string[]) => string;
}

/**
 * Divide um valor textual em pedaços traduzíveis. Curto → 1 pedaço. Longo →
 * agrupa parágrafos inteiros sob o teto; parágrafo isolado acima do teto é
 * subdividido em sentenças. A remontagem junta por linha dupla (fronteira de
 * parágrafo), preservando a estrutura do texto.
 */
export function splitForTranslation(value: string, _type?: string): SplitResult {
  const text = String(value ?? '');
  if (approxTokens(text) <= MAX_CHUNK_TOKENS) {
    return { chunks: [text], join: (t) => t[0] ?? '' };
  }

  // 1) segmentos = parágrafos; parágrafo grande → sentenças
  const segs: string[] = [];
  for (const para of splitParagraphs(text)) {
    if (approxTokens(para) <= MAX_CHUNK_TOKENS) {
      segs.push(para);
      continue;
    }
    let buf = '';
    for (const sent of splitSentences(para)) {
      if (buf && approxTokens(buf + sent) > MAX_CHUNK_TOKENS) {
        segs.push(buf);
        buf = '';
      }
      buf += sent;
    }
    if (buf) segs.push(buf);
  }

  // 2) empacota segmentos em pedaços sob o teto (juntando por linha dupla)
  const chunks: string[] = [];
  let buf: string[] = [];
  let bufTok = 0;
  for (const seg of segs) {
    const t = approxTokens(seg);
    if (buf.length && bufTok + t > MAX_CHUNK_TOKENS) {
      chunks.push(buf.join('\n\n'));
      buf = [];
      bufTok = 0;
    }
    buf.push(seg);
    bufTok += t;
  }
  if (buf.length) chunks.push(buf.join('\n\n'));

  return { chunks, join: (t) => t.join('\n\n') };
}

/** Traduz UM pedaço via OpenAI, preservando marcação/placeholders. */
export async function translateChunk(
  apiKey: string,
  text: string,
  sourceLang: string,
  targetLang: string
): Promise<string> {
  if (!text || !text.trim()) return text;
  const body = {
    model: MODEL,
    temperature: 0,
    max_tokens: Math.min(4000, approxTokens(text) * 3 + 256),
    messages: [
      {
        role: 'system',
        content:
          `You are a professional translator. Translate the user's text from ${sourceLang} to ${targetLang}. ` +
          'Preserve EXACTLY all markdown, HTML tags, URLs, and placeholders such as {name}, :slug, %s, {{var}}. ' +
          'Keep line breaks. Do NOT add quotes, notes, or explanations. Return ONLY the translated text.',
      },
      { role: 'user', content: text },
    ],
  };
  const res = await fetch(OPENAI_URL, {
    method: 'POST',
    headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`OpenAI translate: ${await res.text()}`);
  const data: any = await res.json();
  return (data.choices?.[0]?.message?.content ?? '').trim();
}

/** Executa `fn` sobre `items` com no máximo `limit` em paralelo (resolve
 *  rate-limit com muitos pedaços/locales). Preserva a ordem na saída. */
export async function mapPool<T, R>(
  items: T[],
  limit: number,
  fn: (item: T, index: number) => Promise<R>
): Promise<R[]> {
  const out = new Array<R>(items.length);
  let i = 0;
  const workers = Array.from({ length: Math.max(1, Math.min(limit, items.length)) }, async () => {
    while (i < items.length) {
      const idx = i++;
      out[idx] = await fn(items[idx], idx);
    }
  });
  await Promise.all(workers);
  return out;
}

/**
 * Traduz um valor textual completo: split → traduz pedaços (pool) → remonta.
 * Retorna o texto traduzido e quantos pedaços foram usados (para métrica).
 */
export async function translateText(
  apiKey: string,
  value: string,
  sourceLang: string,
  targetLang: string,
  type?: string
): Promise<{ text: string; chunks: number }> {
  if (typeof value !== 'string' || !value.trim()) return { text: value, chunks: 0 };
  const { chunks, join } = splitForTranslation(value, type);
  const translated = await mapPool(chunks, 4, (c) =>
    c.trim() ? translateChunk(apiKey, c, sourceLang, targetLang) : Promise.resolve(c)
  );
  return { text: join(translated), chunks: chunks.length };
}
