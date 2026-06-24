import fs from 'node:fs';
import path from 'node:path';
import { validateManifest, type Manifest, FRAMEWORKS } from './manifest';

/**
 * Inferência de manifest a partir do CÓDIGO do frontend.
 *
 * Cenário-alvo: frontends gerados por Figma/Lovable não trazem um
 * strapi.manifest.json — os dados ficam hardcoded (ex.: src/data/site.ts). Aqui
 * varremos esses arquivos, mandamos para a IA (mesma OpenAI do chat) e pedimos
 * que ela projete o modelo de conteúdo (content-types + seed). O resultado é
 * SEMPRE validado pelo mesmo schema Zod do contrato — nada entra na provisão sem
 * passar pela validação (e tentamos de novo, devolvendo os erros, se falhar).
 *
 * Nunca executa o código do frontend: só LÊ arquivos de texto.
 */

const OPENAI_URL = 'https://api.openai.com/v1/chat/completions';
const MODEL = process.env.OPENAI_CHAT_MODEL || 'gpt-4o';

const SKIP_DIRS = new Set([
  'node_modules', '.git', 'dist', '.next', '.output', '.vinxi', '.tanstack',
  'build', 'coverage', '.turbo', '.cache', 'public',
]);
const CODE_EXT = new Set(['.ts', '.tsx', '.js', '.jsx', '.mjs']);
const MAX_FILES = 18;
const MAX_TOTAL_CHARS = 60000;
const MAX_FILE_CHARS = 12000;

export interface InferResult {
  ok: boolean;
  /** manifest validado (só presente se ok). */
  manifest?: Manifest;
  /** manifest cru retornado pela IA (para exibir mesmo se inválido). */
  rawManifest?: any;
  /** true se gerado pela IA; false se já existia no projeto. */
  inferred: boolean;
  filesAnalyzed: string[];
  framework: string;
  warnings: string[];
  errors: string[];
}

// ---------------------------------------------------------------------------
// coleta de arquivos candidatos
// ---------------------------------------------------------------------------

/** pontuação heurística: caminhos "de dados" valem mais. */
function score(rel: string): number {
  const p = rel.toLowerCase();
  let s = 0;
  if (/(^|\/)(data|content|mocks?|seeds?|fixtures?)(\/|\.)/.test(p)) s += 10;
  if (/(site|config|constants|catalog|products?|services?|posts?|items?)/.test(p)) s += 4;
  if (p.startsWith('src/')) s += 2;
  if (p.endsWith('.tsx') || p.endsWith('.jsx')) s -= 1; // componentes valem menos
  return s;
}

function walk(dir: string, base: string, out: string[]) {
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const e of entries) {
    if (e.name.startsWith('.') && e.name !== '.') continue;
    const full = path.join(dir, e.name);
    if (e.isDirectory()) {
      if (SKIP_DIRS.has(e.name)) continue;
      walk(full, base, out);
    } else if (CODE_EXT.has(path.extname(e.name))) {
      out.push(path.relative(base, full));
    }
  }
}

interface CollectResult {
  files: { rel: string; content: string }[];
  tree: string[];
}

/** Detecta um array de objetos declarado inline (ex.: `const services = [{...}]`),
 *  inclusive DENTRO de componentes — é onde os frontends Lovable/Figma guardam
 *  os dados (serviços, avaliações, etc.). */
function hasInlineDataArray(content: string): boolean {
  return /(?:export\s+)?const\s+\w+\s*(?::[^=\n]+)?=\s*\[\s*\{/.test(content);
}

/**
 * Coleta os arquivos de código mais promissores (com conteúdo) + árvore.
 *
 * Ciente de conteúdo: além da pontuação por caminho, dá um bônus forte a QUALQUER
 * arquivo que contenha um array de objetos inline — assim componentes (.tsx/.jsx)
 * com `const X = [{...}]` entram na análise (antes eram excluídos por serem
 * componentes, e os dados embutidos neles nunca eram modelados).
 */
function collectFiles(frontendDir: string): CollectResult {
  const all: string[] = [];
  walk(frontendDir, frontendDir, all);
  const tree = all.slice().sort();

  // lê e pontua cada candidato (pontuação por caminho + bônus por dados inline).
  const scored: { rel: string; content: string; s: number }[] = [];
  for (const rel of all) {
    let content: string;
    try {
      content = fs.readFileSync(path.join(frontendDir, rel), 'utf8');
    } catch {
      continue;
    }
    const dataArray = hasInlineDataArray(content);
    const hasExport = /export\s+(const|default|type|interface)/.test(content);
    if (!hasExport && !dataArray) continue; // sem dados nem exports → ignora
    let s = score(rel);
    if (dataArray) s += 8; // arrays de objetos inline valem muito (incl. componentes)
    if (s <= 0) continue;
    scored.push({ rel, content, s });
  }
  scored.sort((a, b) => b.s - a.s);

  const files: { rel: string; content: string }[] = [];
  let total = 0;
  for (const it of scored) {
    if (files.length >= MAX_FILES || total >= MAX_TOTAL_CHARS) break;
    let content = it.content;
    if (content.length > MAX_FILE_CHARS) content = content.slice(0, MAX_FILE_CHARS) + '\n/* …truncado… */';
    files.push({ rel: it.rel, content });
    total += content.length;
  }
  return { files, tree };
}

// ---------------------------------------------------------------------------
// textos soltos no JSX (headings, botões, labels) — agrupados por arquivo
// ---------------------------------------------------------------------------

const MAX_TEXT_FILES = 25;
const MAX_TEXTS_PER_FILE = 60;

/** Heurística: extrai strings de texto VISÍVEL de um arquivo JSX/TSX. */
function extractTexts(content: string): string[] {
  const found = new Set<string>();
  const add = (s: string) => {
    const t = s.replace(/\s+/g, ' ').trim();
    // precisa ter letra, tamanho razoável e PARECER texto natural (não código)
    if (t.length < 2 || t.length > 140) return;
    if (!/[A-Za-zÀ-ÿ]/.test(t)) return;
    // descarta fragmentos de código que vazam entre > < (mas mantém preços com $)
    if (/[{}<>()[\];=`|]|\$\{|=>|&&|\|\||https?:|@\//.test(t)) return;
    if (/\b(return|const|let|var|function|map|filter|import|export|className|props)\b/.test(t)) return;
    if (/\w\.\w/.test(t)) return; // acesso a propriedade (p.before, a.com)
    if (/^[a-z]+([A-Z][a-z]+)+$/.test(t)) return; // camelCase (identificador)
    // precisa ter ao menos uma "palavra" de verdade (3+ letras)
    if (!/[A-Za-zÀ-ÿ]{3,}/.test(t)) return;
    found.add(t);
  };
  // nós de texto JSX: >Texto<
  for (const m of content.matchAll(/>\s*([^<>{}\n][^<>{}]*?)\s*</g)) add(m[1]);
  // props textuais comuns
  for (const m of content.matchAll(/\b(?:placeholder|title|alt|label|aria-label)\s*=\s*"([^"]+)"/g)) add(m[1]);
  return [...found].slice(0, MAX_TEXTS_PER_FILE);
}

interface PageTexts {
  rel: string;
  texts: string[];
}

/** Varre rotas/componentes e extrai os textos visíveis, agrupados por arquivo. */
function collectPageTexts(frontendDir: string): PageTexts[] {
  const all: string[] = [];
  walk(frontendDir, frontendDir, all);
  const out: PageTexts[] = [];
  // prioriza rotas/páginas; depois componentes
  const ranked = all
    .filter((rel) => /\.(tsx|jsx)$/.test(rel))
    .filter((rel) => !/\/(ui)\//.test(rel)) // pula shadcn/ui primitivos
    .sort((a, b) => {
      const pa = /routes?\/|pages?\//.test(a) ? 0 : 1;
      const pb = /routes?\/|pages?\//.test(b) ? 0 : 1;
      return pa - pb;
    });
  for (const rel of ranked) {
    if (out.length >= MAX_TEXT_FILES) break;
    try {
      const texts = extractTexts(fs.readFileSync(path.join(frontendDir, rel), 'utf8'));
      if (texts.length) out.push({ rel, texts });
    } catch {
      /* ignore */
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// modelagem DETERMINÍSTICA dos textos de página (sem IA — nunca falha, escala)
// ---------------------------------------------------------------------------

const RESERVED = new Set([
  'id', 'documentId', 'createdAt', 'updatedAt', 'publishedAt',
  'createdBy', 'updatedBy', 'locale', 'localizations',
]);
// teto de single-types de texto; o excedente vai para uma coleção flat (escala infinita).
const MAX_PAGE_TYPES = 45;

/** "Crafted spaces, end-to-end." -> "craftedSpacesEndToEnd" (chave de campo válida). */
function toFieldKey(text: string): string {
  const words = text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 6);
  if (!words.length) return 'text';
  let key = words[0] + words.slice(1).map((w) => w[0].toUpperCase() + w.slice(1)).join('');
  key = key.slice(0, 44).replace(/^[^a-zA-Z]+/, '');
  if (!key) key = 'text';
  if (RESERVED.has(key)) key = key + 'Field';
  return key;
}

/** src/routes/index.tsx -> "home-content"; components/Footer.tsx -> "footer-content". */
function toPageName(rel: string): string {
  let base = rel.replace(/\\/g, '/').split('/').pop() || 'page';
  base = base.replace(/\.(tsx|jsx|ts|js)$/, '');
  base = base.replace(/^\$+/, '').replace(/\$/g, '');
  if (/^index$/.test(base)) base = 'home';
  else if (/^__?root$/.test(base)) base = 'layout';
  const kebab = base
    .replace(/([a-z0-9])([A-Z])/g, '$1-$2')
    .replace(/[^a-zA-Z0-9]+/g, '-')
    .toLowerCase()
    .replace(/^-+|-+$/g, '')
    .replace(/^[^a-z]+/, '');
  return ((kebab || 'page') + '-content').slice(0, 48);
}

/**
 * Constrói content-types determinísticos a partir dos textos extraídos:
 *  - 1 singleType por página (campos = chaves derivadas do texto, seed = texto exato);
 *  - se passar do teto de types, o excedente vira UMA coleção flat (page/key/value),
 *    garantindo que TUDO entra independente do tamanho.
 */
function buildPageContentTypes(
  pageTexts: PageTexts[],
  budget: number
): { contentTypes: any[]; seed: any[] } {
  const contentTypes: any[] = [];
  const seed: any[] = [];
  const usedNames = new Set<string>();
  const overflow: { page: string; value: string }[] = [];

  const allowed = Math.max(0, Math.min(budget, MAX_PAGE_TYPES));

  pageTexts.forEach((p, idx) => {
    if (idx >= allowed) {
      for (const t of p.texts) overflow.push({ page: toPageName(p.rel), value: t });
      return;
    }
    let name = toPageName(p.rel);
    while (usedNames.has(name)) name = name.replace(/(-\d+)?-content$/, '') + `-${idx}-content`;
    usedNames.add(name);

    const attributes: Record<string, any> = {};
    const entry: Record<string, any> = {};
    const usedKeys = new Set<string>();
    for (const text of p.texts) {
      let key = toFieldKey(text);
      let k = key;
      let n = 2;
      while (usedKeys.has(k)) k = `${key}${n++}`.slice(0, 46);
      usedKeys.add(k);
      attributes[k] = { type: text.length > 80 ? 'text' : 'string' };
      entry[k] = text;
    }
    if (!Object.keys(attributes).length) return;
    contentTypes.push({
      singularName: name,
      displayName: name.replace(/-/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase()),
      kind: 'singleType',
      draftAndPublish: true,
      attributes,
    });
    seed.push({ singularName: name, entries: [entry] });
  });

  // excedente → coleção flat (escala sem limite de types)
  if (overflow.length) {
    contentTypes.push({
      singularName: 'page-text',
      displayName: 'Page Text',
      kind: 'collectionType',
      draftAndPublish: true,
      attributes: {
        page: { type: 'string' },
        value: { type: 'text' },
      },
    });
    seed.push({ singularName: 'page-text', entries: overflow });
  }

  return { contentTypes, seed };
}

// ---------------------------------------------------------------------------
// framework (determinístico, a partir do package.json)
// ---------------------------------------------------------------------------

function detectFramework(frontendDir: string): string {
  try {
    const pkg = JSON.parse(fs.readFileSync(path.join(frontendDir, 'package.json'), 'utf8'));
    const deps = { ...(pkg.dependencies || {}), ...(pkg.devDependencies || {}) };
    if (deps.next) return 'next';
    if (deps['@tanstack/react-start']) return 'tanstack';
    // Vite/React puro (Lovable/Figma) → tanstack é o adapter Vite-compatível mais próximo
    if (deps.vite) return 'tanstack';
  } catch {
    /* ignore */
  }
  return 'tanstack';
}

// ---------------------------------------------------------------------------
// prompt
// ---------------------------------------------------------------------------

function buildPrompt(framework: string, c: CollectResult, name: string): string {
  const filesBlock = c.files
    .map((f) => `--- ARQUIVO: ${f.rel} ---\n${f.content}`)
    .join('\n\n');
  return `Você é um arquiteto de conteúdo Strapi 5. Analise o código de um frontend e projete o modelo de conteúdo.

Gere um JSON "strapi.manifest.json" com ESTE formato:
{
  "manifestVersion": 1,
  "name": "${name}",
  "framework": "${framework}",
  "strapiVersion": "^5.47",
  "contentTypes": [
    {
      "singularName": "kebab-case",          // ex.: "produto", "service", "blog-post"
      "displayName": "Nome legível",
      "kind": "collectionType" | "singleType", // listas = collectionType; config/único = singleType
      "draftAndPublish": true,
      "attributes": {
        "campo": { "type": "string|text|richtext|integer|decimal|boolean|date|datetime|email|json|uid|enumeration|media|relation", ... }
        // uid: { "type":"uid", "targetField":"umCampoString" }
        // enumeration: { "type":"enumeration", "enum":["a","b"] }
        // media: { "type":"media", "multiple":false, "allowedTypes":["images"] }
        // relation: { "type":"relation", "relation":"manyToOne|oneToMany|manyToMany|oneToOne", "target":"singularName-de-outro-type" }
      },
      "preview": { "route": "/rota/:slug" }   // opcional; só se houver página de detalhe
    }
  ],
  "seed": [
    { "singularName": "...", "entries": [ { ...dados-extraídos-do-código... } ] }
  ],
  "env": ["${framework === 'next' ? 'NEXT_PUBLIC_STRAPI_URL' : 'VITE_STRAPI_URL'}", "STRAPI_API_TOKEN", "PREVIEW_SECRET"]
}

REGRAS:
- Crie uma content-type para cada COLEÇÃO de dados (arrays de objetos). Use os MESMOS nomes de campo do código.
- IMPORTANTE: muitos frontends guardam os dados em arrays declarados INLINE dentro de componentes (.tsx/.jsx), ex.: \`const services = [{ name, price, desc }]\`, \`const reviews = [...]\`, \`const hours = [...]\`. TRATE esses arrays como coleções e modele cada um como um collectionType, mesmo que estejam dentro de um componente de UI.
- Ao modelar um array desses, inclua SOMENTE os campos que são dados/texto (ex.: name, price, desc, label, href, value). IGNORE props que são código/apresentação: componentes de ícone (ex.: \`icon: Scissors\`), elementos React, funções, classes CSS, imports de imagem.
- Dados de "configuração do site" (objeto único: nome, telefone, etc.) → singleType.
- Campos string longos/descrições → "text" ou "richtext". Listas de strings → "json".
- Use "date"/"datetime" SOMENTE para datas ISO completas (YYYY-MM-DD). Datas parciais como "2025-04" ou textos livres → use "string" (senão o seed falha).
- Imagens (imports de assets ou caminhos) → "media" (NÃO coloque o valor da imagem no seed; omita o campo no seed).
- Em "seed", copie o conteúdo REAL hardcoded no código, VERBATIM (exatamente como está, sem reescrever, traduzir ou inventar), omitindo campos de mídia e relações. Todo valor de seed TEM que existir literalmente no código fornecido.
- Foque APENAS em coleções/objetos de dados — NÃO precisa modelar textos soltos de UI (isso é tratado à parte).
- NÃO invente NADA. Se não tiver certeza de um valor, omita-o. singularName kebab-case, sem repetir. Relações só apontam para types definidos por você.
- Se não houver coleções de dados, devolva contentTypes: [] e seed: [].
- Responda APENAS com o JSON, nada de markdown.

Árvore de arquivos do projeto:
${c.tree.slice(0, 200).join('\n')}

Arquivos de dados (coleções):
${filesBlock}`;
}

// ---------------------------------------------------------------------------
// inferência
// ---------------------------------------------------------------------------

export async function inferManifest(
  strapi: any,
  frontendDir: string,
  opts: { name: string }
): Promise<InferResult> {
  const framework = detectFramework(frontendDir);
  const result: InferResult = {
    ok: false,
    inferred: true,
    filesAnalyzed: [],
    framework,
    warnings: [],
    errors: [],
  };

  // 1) já existe manifest no projeto? então não infere.
  const existing = path.join(frontendDir, 'strapi.manifest.json');
  if (fs.existsSync(existing)) {
    try {
      const raw = JSON.parse(fs.readFileSync(existing, 'utf8'));
      const v = validateManifest(raw);
      result.inferred = false;
      result.rawManifest = raw;
      if (v.ok) {
        result.ok = true;
        result.manifest = v.data;
      } else {
        result.errors.push(...(v.errors ?? []));
      }
      return result;
    } catch (e: any) {
      result.errors.push(`manifest existente ilegível: ${e?.message ?? e}`);
      return result;
    }
  }

  // 2) coleta de arquivos de dados + textos soltos do JSX
  const collected = collectFiles(frontendDir);
  const pageTexts = collectPageTexts(frontendDir);
  result.filesAnalyzed = [
    ...collected.files.map((f) => f.rel),
    ...pageTexts.map((p) => p.rel),
  ];
  if (collected.files.length === 0 && pageTexts.length === 0) {
    result.errors.push(
      'Não encontrei dados nem textos para analisar. Adicione um strapi.manifest.json manualmente.'
    );
    return result;
  }

  const envList = [
    framework === 'next' ? 'NEXT_PUBLIC_STRAPI_URL' : 'VITE_STRAPI_URL',
    'STRAPI_API_TOKEN',
    'PREVIEW_SECRET',
  ];

  // 3) DADOS via IA (best-effort, NÃO bloqueia). Falha aqui não impede a extração
  //    determinística dos textos abaixo.
  let dataCts: any[] = [];
  let dataSeed: any[] = [];
  const apiKey = process.env.OPENAI_API_KEY;
  if (apiKey && collected.files.length) {
    const callOpenAI = async (messages: any[]) => {
      const res = await fetch(OPENAI_URL, {
        method: 'POST',
        headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ model: MODEL, temperature: 0, response_format: { type: 'json_object' }, messages }),
      });
      if (!res.ok) throw new Error(`OpenAI: ${await res.text()}`);
      return res.json() as Promise<any>;
    };
    const messages: any[] = [
      { role: 'system', content: 'Você projeta modelos de conteúdo Strapi 5 e responde só com JSON válido.' },
      { role: 'user', content: buildPrompt(framework, collected, opts.name) },
    ];
    try {
      for (let attempt = 0; attempt < 2; attempt++) {
        const data = await callOpenAI(messages);
        const raw = JSON.parse(data.choices?.[0]?.message?.content ?? '{}');
        const candidate = {
          manifestVersion: 1, name: opts.name, framework,
          strapiVersion: '^5.47',
          contentTypes: Array.isArray(raw.contentTypes) ? raw.contentTypes : [],
          seed: Array.isArray(raw.seed) ? raw.seed : [],
          env: envList,
        };
        if (!candidate.contentTypes.length) break; // sem coleções de dados
        const v = validateManifest(candidate);
        if (v.ok) { dataCts = v.data.contentTypes as any[]; dataSeed = (v.data.seed as any[]) ?? []; break; }
        if (attempt === 0) {
          messages.push({ role: 'assistant', content: JSON.stringify(raw) });
          messages.push({ role: 'user', content: 'JSON REJEITADO pela validação:\n' + (v.errors ?? []).join('\n') + '\nCorrija e responda só com o JSON.' });
        } else {
          result.warnings.push('Modelo de dados (IA) inválido — seguindo só com os textos.');
        }
      }
    } catch (e: any) {
      result.warnings.push(`IA de dados indisponível (seguindo só com os textos): ${e?.message ?? e}`);
    }
  } else if (!apiKey) {
    result.warnings.push('Sem OPENAI_API_KEY: modelando os TEXTOS (determinístico); coleções de dados não inferidas.');
  }

  // 3b) TRAVA ANTI-ALUCINAÇÃO (determinística): todo valor de seed gerado pela IA
  //     TEM que existir literalmente no código analisado. Construímos um "haystack"
  //     com o código-fonte real (não truncado) e descartamos entradas cujo conteúdo
  //     não aparece nele. Assim a IA não consegue inventar dados — só transcrever.
  if (dataCts.length && dataSeed.length) {
    const parts: string[] = [];
    for (const f of collected.files) {
      try {
        parts.push(fs.readFileSync(path.join(frontendDir, f.rel), 'utf8'));
      } catch {
        parts.push(f.content);
      }
    }
    const norm = (x: any) => String(x).toLowerCase().replace(/[^a-z0-9]+/g, '');
    const hay = norm(parts.join('\n'));
    const present = (v: any) => {
      if (typeof v !== 'string') return false;
      const n = norm(v);
      return n.length >= 4 && hay.includes(n); // valores curtos não são distintivos
    };

    const keep = new Set<string>();
    const verifiedSeed: any[] = [];
    let droppedEntries = 0;
    for (const grp of dataSeed) {
      const entries = (grp.entries ?? []).filter((e: any) => {
        const ok = Object.values(e).some(present);
        if (!ok) droppedEntries++;
        return ok;
      });
      if (entries.length) {
        verifiedSeed.push({ ...grp, entries });
        keep.add(grp.singularName);
      }
    }
    // coleções de dados sem NENHUMA entrada verificada são provável alucinação → fora.
    const verifiedCts = dataCts.filter(
      (ct: any) => ct.kind === 'singleType' || keep.has(ct.singularName)
    );
    const droppedCts = dataCts.length - verifiedCts.length;
    if (droppedEntries || droppedCts) {
      result.warnings.push(
        `Anti-alucinação: descartei ${droppedEntries} entrada(s) e ${droppedCts} content-type(s) cujos valores não batiam com o código.`
      );
    }
    dataCts = verifiedCts;
    dataSeed = verifiedSeed;
  }

  // 4) TEXTOS via extração DETERMINÍSTICA (garantido, sem IA, escala em qualquer tamanho)
  const budget = 60 - dataCts.length - 1; // teto de content-types do manifest
  const page = buildPageContentTypes(pageTexts, budget);

  // 5) merge + validação resiliente (nunca aborta)
  const finalManifest: any = {
    manifestVersion: 1, name: opts.name, framework, strapiVersion: '^5.47',
    contentTypes: [...dataCts, ...page.contentTypes],
    seed: [...dataSeed, ...page.seed],
    env: envList,
  };
  result.rawManifest = finalManifest;
  let v = validateManifest(finalManifest);
  if (!v.ok) {
    // fallback: só os textos (determinístico — sempre válido)
    result.warnings.push('Manifest combinado inválido; caindo para só-textos. ' + (v.errors ?? []).join('; '));
    const pageOnly = { ...finalManifest, contentTypes: page.contentTypes, seed: page.seed };
    result.rawManifest = pageOnly;
    v = validateManifest(pageOnly);
  }
  if (v.ok) {
    result.ok = true;
    result.manifest = v.data;
  } else {
    result.errors.push(...(v.errors ?? []));
  }
  return result;
}
