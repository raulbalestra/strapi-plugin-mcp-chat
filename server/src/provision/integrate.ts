import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import type { Manifest } from './manifest';
import { apiUid } from './generate';

/**
 * Integração por "snapshot do módulo de dados".
 *
 * Em vez de reescrever os componentes (frágil), regeneramos o(s) arquivo(s) de
 * dados do frontend (ex.: src/data/site.ts) trocando os VALORES pelos do Strapi —
 * mantendo imports, tipos e nomes de export idênticos, e PRESERVANDO os campos de
 * imagem originais (casados por slug/title). Assim nada nos componentes muda e
 * tudo continua funcionando. É um snapshot: re-rode para sincronizar de novo.
 *
 * A regeneração de cada arquivo é feita pela IA, mas a tarefa é bem restrita
 * (mesmo arquivo, mesma estrutura, só troca os dados) — bem mais confiável que
 * reescrever código arbitrário. Original é salvo como .bak antes de gravar.
 */

const OPENAI_URL = 'https://api.openai.com/v1/chat/completions';
const MODEL = process.env.OPENAI_CHAT_MODEL || 'gpt-4o';

const SKIP_DIRS = new Set([
  'node_modules', '.git', 'dist', '.next', '.output', '.vinxi', '.tanstack',
  'build', 'coverage', '.turbo', '.cache', 'public',
]);
const CODE_EXT = new Set(['.ts', '.tsx', '.js', '.jsx', '.mjs']);
const MAX_DATA_FILES = 3;
const MAX_FILE_CHARS = 16000;

export interface IntegrateResult {
  ok: boolean;
  filesRewritten: string[];
  contentTypesFetched: { uid: string; count: number }[];
  warnings: string[];
  errors: string[];
}

function score(rel: string): number {
  const p = rel.toLowerCase();
  let s = 0;
  if (/(^|\/)(data|content|mocks?|seeds?|fixtures?)(\/|\.)/.test(p)) s += 10;
  if (/(site|config|constants|catalog|products?|services?|posts?|items?)/.test(p)) s += 4;
  if (p.startsWith('src/')) s += 2;
  if (p.endsWith('.tsx') || p.endsWith('.jsx')) s -= 3; // queremos arquivos de DADOS, não componentes
  return s;
}

function walk(dir: string, base: string, out: string[]) {
  let entries: fs.Dirent[];
  try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
  for (const e of entries) {
    if (e.name.startsWith('.')) continue;
    const full = path.join(dir, e.name);
    if (e.isDirectory()) {
      if (SKIP_DIRS.has(e.name)) continue;
      walk(full, base, out);
    } else if (CODE_EXT.has(path.extname(e.name))) {
      out.push(path.relative(base, full));
    }
  }
}

/** Acha os arquivos de DADOS (exportam arrays/objetos de conteúdo). */
function findDataFiles(frontendDir: string): string[] {
  const all: string[] = [];
  walk(frontendDir, frontendDir, all);
  return all
    .map((rel) => ({ rel, s: score(rel) }))
    .filter((x) => x.s > 0)
    .filter(({ rel }) => {
      try {
        const c = fs.readFileSync(path.join(frontendDir, rel), 'utf8');
        // precisa exportar dados (array/objeto), não só componentes/funções
        return /export\s+const\s+\w+\s*[:=]\s*(\[|\{)/.test(c);
      } catch {
        return false;
      }
    })
    .sort((a, b) => b.s - a.s)
    .slice(0, MAX_DATA_FILES)
    .map((x) => x.rel);
}

// ---------------------------------------------------------------------------
// busca os dados do Strapi
// ---------------------------------------------------------------------------

async function fetchStrapiData(
  strapi: any,
  manifest: Manifest,
  locale?: string
): Promise<{ data: Record<string, any>; counts: { uid: string; count: number }[] }> {
  const data: Record<string, any> = {};
  const counts: { uid: string; count: number }[] = [];
  const loc = locale ? { locale } : {};
  for (const ct of manifest.contentTypes) {
    const uid = apiUid(ct.singularName);
    try {
      if (ct.kind === 'singleType') {
        const doc = await strapi.documents(uid).findFirst({ status: 'published', populate: '*', ...loc });
        data[ct.singularName] = doc ?? null;
        counts.push({ uid, count: doc ? 1 : 0 });
      } else {
        const docs = await strapi.documents(uid).findMany({ status: 'published', populate: '*', ...loc });
        data[ct.singularName] = docs ?? [];
        counts.push({ uid, count: Array.isArray(docs) ? docs.length : 0 });
      }
    } catch {
      data[ct.singularName] = ct.kind === 'singleType' ? null : [];
      counts.push({ uid, count: 0 });
    }
  }
  return { data, counts };
}

/** Locales configurados no Strapi: { codes, def }. Vazio se i18n off. */
async function getLocales(strapi: any): Promise<{ codes: string[]; def: string }> {
  try {
    const svc = strapi.plugin('i18n').service('locales');
    const all = (await svc.find()) || [];
    const def = (await svc.getDefaultLocale()) || 'en';
    const codes = all.map((l: any) => l.code);
    return { codes, def };
  } catch {
    return { codes: [], def: 'en' };
  }
}

/** Extrai o valor (expressão) de cada `export const NAME = <valor>;` do arquivo,
 *  respeitando chaves/colchetes/parênteses e strings (inclui template literals). */
export function findExportValues(src: string, names: string[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (const name of names) {
    const re = new RegExp(`export\\s+const\\s+${name}\\b[^=]*=\\s*`);
    const m = re.exec(src);
    if (!m) continue;
    let i = m.index + m[0].length;
    const start = i;
    let depth = 0;
    let inStr: string | null = null;
    let esc = false;
    for (; i < src.length; i++) {
      const c = src[i];
      if (inStr) {
        if (esc) esc = false;
        else if (c === '\\') esc = true;
        else if (c === inStr) inStr = null;
        continue;
      }
      if (c === '"' || c === "'" || c === '`') inStr = c;
      else if (c === '{' || c === '[' || c === '(') depth++;
      else if (c === '}' || c === ']' || c === ')') depth--;
      else if (c === ';' && depth === 0) break;
    }
    out[name] = src.slice(start, i).trim();
  }
  return out;
}

/** Linhas de import do topo do arquivo (assets etc., iguais em todos os locales). */
export function extractImports(src: string): string {
  return src
    .split('\n')
    .filter((l) => /^\s*import\s.+from\s+['"].+['"];?\s*$/.test(l))
    .join('\n');
}

/** Nomes dos exports `export const X` do arquivo. */
export function exportNames(src: string): string[] {
  const names: string[] = [];
  const re = /export\s+const\s+(\w+)\b/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(src))) names.push(m[1]);
  return names;
}

/**
 * Monta o módulo de dados MULTI-LOCALE a partir dos arquivos regenerados por
 * locale. Os exports viram "live" (Proxy) e seguem o locale ativo, definido
 * isomórficamente por `__setLocale` (chamado no beforeLoad do root). Assim os
 * componentes continuam fazendo `import { site } from "@/data/site"` sem mudança.
 */
export function buildMultiLocaleModule(
  perLocale: Record<string, string>, // locale -> conteúdo do arquivo regenerado
  defLocale: string
): string {
  const def = perLocale[defLocale];
  const names = exportNames(def);
  const imports = extractImports(def);
  const blocks: string[] = [];
  for (const [loc, content] of Object.entries(perLocale)) {
    const vals = findExportValues(content, names);
    const entries = names.map((n) => `    ${JSON.stringify(n)}: ${vals[n] ?? 'undefined'}`).join(',\n');
    blocks.push(`  ${JSON.stringify(loc)}: {\n${entries}\n  }`);
  }
  const locales = Object.keys(perLocale);
  const liveExports = names.map((n) => `export const ${n}: any = __live(${JSON.stringify(n)});`).join('\n');
  return `// Snapshot from Strapi (multi-locale — gerado pelo mcp-chat)
${imports}

const __data: Record<string, any> = {
${blocks.join(',\n')}
};

export const __availableLocales = ${JSON.stringify(locales)};
export const __defaultLocale = ${JSON.stringify(defLocale)};
let __locale = __defaultLocale;
export function __setLocale(l?: string | null) { if (l && __data[l]) __locale = l; }
export function __getLocale() { return __locale; }

// Auto-inicialização no CLIENTE: define o locale a partir de ?locale/cookie no
// momento em que o módulo carrega — ANTES de qualquer render. Garante que a
// hidratação use o mesmo locale do SSR (evita "voltar pro inglês"), mesmo que o
// beforeLoad do root não rode na hidratação.
if (typeof window !== "undefined") {
  try {
    let __l = new URL(window.location.href).searchParams.get("locale");
    if (!__l) { const __m = document.cookie.match(/(?:^|;\\s*)site-locale=([^;]+)/); if (__m) __l = decodeURIComponent(__m[1]); }
    if (__l) __setLocale(__l);
  } catch {}
}

// Exports "vivos": seguem o locale ativo sem precisar mudar os componentes.
function __live(key: string): any {
  return new Proxy(Array.isArray(__data[__defaultLocale]?.[key]) ? [] : {}, {
    get(_t, p) {
      const v = __data[__locale]?.[key];
      const r = v == null ? v : (v as any)[p as any];
      return typeof r === 'function' ? r.bind(v) : r;
    },
    has(_t, p) { const v = __data[__locale]?.[key]; return v != null && (p in (v as any)); },
    ownKeys() { const v = __data[__locale]?.[key]; return v ? Reflect.ownKeys(v as any) : []; },
    getOwnPropertyDescriptor(_t, p) {
      const v = __data[__locale]?.[key]; if (v == null) return undefined;
      const d = Object.getOwnPropertyDescriptor(v as any, p);
      if (d) (d as any).configurable = true;
      return d;
    },
  });
}

${liveExports}
`;
}

// ---------------------------------------------------------------------------
// regeneração via IA (1 arquivo)
// ---------------------------------------------------------------------------

function stripFence(s: string): string {
  // remove cerca de markdown com QUALQUER tag de linguagem (ts/tsx/js/jsx/
  // javascript/typescript…) — senão o nome da linguagem vaza pro início do código.
  const m = s.match(/```[a-zA-Z]*[ \t]*\r?\n([\s\S]*?)```/);
  let out = (m ? m[1] : s).trim();
  // defesa extra: linha 1 sendo só a tag de linguagem.
  out = out.replace(/^\s*(?:javascript|typescript|tsx?|jsx?)\s*\n/i, '');
  return out.trim();
}

async function regenFile(
  apiKey: string,
  original: string,
  rel: string,
  strapiData: Record<string, any>
): Promise<string> {
  const prompt = `Você vai REGENERAR um arquivo de dados de um frontend, trocando os valores hardcoded pelos dados vindos do Strapi (um snapshot).

REGRAS ESTRITAS:
- Mantenha EXATAMENTE os mesmos: imports, declarações de type/interface e NOMES de export.
- Para cada export que corresponde a um conteúdo do Strapi, substitua o valor pelos dados do Strapi.
- Campos de IMAGEM/asset (ex.: image, cover, gallery, before, after): se o Strapi tiver uma URL, use-a; SENÃO, mantenha o valor ORIGINAL do arquivo (casando os itens por "slug" ou "title"). Nunca deixe a imagem quebrada.
- Não invente conteúdo. Se um export não tiver correspondência no Strapi, mantenha o valor original.
- Mantenha o arquivo válido em TypeScript e compatível com os tipos existentes.
- Responda APENAS com o conteúdo final do arquivo (sem markdown, sem comentários extras além de um cabeçalho curto indicando que é um snapshot do Strapi).

ARQUIVO ATUAL (${rel}):
${original.length > MAX_FILE_CHARS ? original.slice(0, MAX_FILE_CHARS) + '\n/* …truncado… */' : original}

DADOS DO STRAPI (JSON, por content-type singularName):
${JSON.stringify(strapiData, null, 2).slice(0, 24000)}`;

  const res = await fetch(OPENAI_URL, {
    method: 'POST',
    headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: MODEL,
      temperature: 0,
      messages: [
        { role: 'system', content: 'Você regenera arquivos de dados TS preservando estrutura, só trocando os valores. Responde só com o código.' },
        { role: 'user', content: prompt },
      ],
    }),
  });
  if (!res.ok) throw new Error(await res.text());
  const json = (await res.json()) as any;
  return stripFence(json.choices?.[0]?.message?.content ?? '');
}

const LANG_NAMES: Record<string, string> = {
  en: 'English', 'pt-BR': 'Brazilian Portuguese', pt: 'Portuguese', es: 'Spanish',
  fr: 'French', de: 'German', it: 'Italian', nl: 'Dutch', ja: 'Japanese',
  ko: 'Korean', ru: 'Russian', ar: 'Arabic', 'zh-Hans': 'Simplified Chinese', zh: 'Chinese',
};

/**
 * Traduz os VALORES de texto exibível de um arquivo de dados já estruturado para
 * outro idioma, preservando tudo o mais (imports, chaves, identificadores,
 * números, URLs, e-mails, telefones, SLUGS e refs de imagem). Prompt pequeno
 * (só o arquivo) → confiável e sem truncar.
 */
async function translateDataFile(
  apiKey: string,
  fileContent: string,
  targetLang: string
): Promise<string> {
  const prompt = `Traduza para ${targetLang} APENAS os textos exibíveis (títulos, descrições, taglines, rótulos, benefícios, nomes de exibição, etc.) deste arquivo de dados TypeScript.

REGRAS ESTRITAS:
- NÃO altere: imports, nomes de chaves, identificadores, números, URLs, e-mails, telefones, refs de imagem (variáveis importadas) e valores de "slug" (mantenha os slugs EXATAMENTE iguais — são usados em rotas).
- Mantenha a estrutura/sintaxe TypeScript idêntica; só troque o conteúdo dos textos por humanos.
- Não traduza marcas/nomes próprios óbvios (ex.: nome da empresa) a menos que façam sentido.
- Responda APENAS com o arquivo final (sem markdown).

ARQUIVO:
${fileContent}`;
  const res = await fetch(OPENAI_URL, {
    method: 'POST',
    headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: MODEL,
      temperature: 0,
      messages: [
        { role: 'system', content: 'Você traduz apenas os textos exibíveis de arquivos de dados TS, preservando estrutura, identificadores e slugs. Responde só com o código.' },
        { role: 'user', content: prompt },
      ],
    }),
  });
  if (!res.ok) throw new Error(await res.text());
  const json = (await res.json()) as any;
  return stripFence(json.choices?.[0]?.message?.content ?? '');
}

// ---------------------------------------------------------------------------
// orquestração
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// PADRÃO OFICIAL: consumo ao vivo da Content API via @strapi/client
// ---------------------------------------------------------------------------

/** Client oficial (@strapi/client). URL pública do env do framework; token é
 *  server-only e opcional (a leitura é pública via permissions.grantPublicRead). */
const STRAPI_CLIENT_TS = `// Gerado pelo mcp-chat — client oficial @strapi/client.
import { strapi } from "@strapi/client";

function baseUrl(): string {
  // Vite (TanStack) expõe via import.meta.env; Next via process.env.
  try {
    // @ts-ignore
    const v = import.meta?.env?.VITE_STRAPI_URL;
    if (v) return v;
  } catch {}
  if (typeof process !== "undefined") {
    const p = process.env.NEXT_PUBLIC_STRAPI_URL || process.env.STRAPI_URL;
    if (p) return p;
  }
  return "http://localhost:1337";
}
const token = typeof process !== "undefined" ? process.env.STRAPI_API_TOKEN : undefined;

const client = strapi({ baseURL: baseUrl().replace(/\\/$/, "") + "/api", ...(token ? { auth: token } : {}) });

export type FetchOpts = { locale?: string; status?: "draft" | "published" };
const params = (o: FetchOpts) => ({ populate: "*" as const, ...(o.locale ? { locale: o.locale } : {}), ...(o.status ? { status: o.status } : {}) });

/** Coleção (usa o pluralName). Retorna o array de documentos (shape flat v5). */
export async function fetchCollection(plural: string, o: FetchOpts = {}): Promise<any[]> {
  const r = await client.collection(plural).find(params(o));
  return (r as any).data ?? [];
}
/** Single type (usa o singularName). Retorna o documento. */
export async function fetchSingle(singular: string, o: FetchOpts = {}): Promise<any> {
  const r = await client.single(singular).find(params(o));
  return (r as any).data ?? null;
}
`;

/** Garante que `@strapi/client` está instalado no frontend (o módulo ao vivo o
 *  importa). Adiciona à package.json e instala se faltar. Best-effort. */
async function ensureClientDep(frontendDir: string, warnings: string[]): Promise<void> {
  if (fs.existsSync(path.join(frontendDir, 'node_modules', '@strapi', 'client'))) return;
  // declara na package.json
  try {
    const pkgPath = path.join(frontendDir, 'package.json');
    const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
    pkg.dependencies = pkg.dependencies || {};
    if (!pkg.dependencies['@strapi/client']) {
      pkg.dependencies['@strapi/client'] = '^1.6.2';
      fs.writeFileSync(pkgPath, JSON.stringify(pkg, null, 2) + '\n', 'utf8');
    }
  } catch (e: any) {
    warnings.push(`package.json do frontend: ${e?.message ?? e}`);
  }
  // detecta o PM e instala só o @strapi/client
  const pm = fs.existsSync(path.join(frontendDir, 'bun.lock')) || fs.existsSync(path.join(frontendDir, 'bun.lockb'))
    ? 'bun'
    : fs.existsSync(path.join(frontendDir, 'pnpm-lock.yaml'))
      ? 'pnpm'
      : fs.existsSync(path.join(frontendDir, 'yarn.lock'))
        ? 'yarn'
        : 'npm';
  const args = pm === 'npm' ? ['install', '@strapi/client', '--no-audit', '--no-fund'] : ['add', '@strapi/client'];
  await new Promise<void>((resolve) => {
    try {
      const c = spawn(pm, args, { cwd: frontendDir, stdio: 'ignore' });
      c.on('exit', () => resolve());
      c.on('error', () => { warnings.push(`não consegui instalar @strapi/client (${pm}); instale manualmente.`); resolve(); });
    } catch {
      warnings.push('falha ao instalar @strapi/client; instale manualmente.');
      resolve();
    }
  });
}

/** Busca uma AMOSTRA real (1 doc por content-type) p/ a IA gerar o mapeador. */
async function fetchSample(
  strapi: any,
  cts: { singularName: string; kind: string }[]
): Promise<Record<string, any>> {
  const sample: Record<string, any> = {};
  for (const ct of cts) {
    const uid = apiUid(ct.singularName);
    try {
      if (ct.kind === 'singleType') {
        sample[ct.singularName] = await strapi.documents(uid).findFirst({ status: 'published', populate: '*' });
      } else {
        const docs = await strapi.documents(uid).findMany({ status: 'published', populate: '*', limit: 2 });
        sample[ct.singularName] = Array.isArray(docs) ? docs : [];
      }
    } catch {
      sample[ct.singularName] = ct.kind === 'singleType' ? null : [];
    }
  }
  return sample;
}

/**
 * Gera (1 chamada de IA) uma FUNÇÃO PURA `mapStrapiToData(raw)` que converte a
 * resposta da Content API (raw, por singularName) no shape exato dos exports do
 * arquivo de dados original (.bak). Imagens: usa a URL de mídia do Strapi quando
 * houver; senão mantém o asset importado original (fallback). Determinística e
 * reutilizável em runtime (não roda por locale).
 */
async function generateMapper(
  apiKey: string,
  baseSrc: string,
  sample: Record<string, any>,
  assetIds: string[]
): Promise<string> {
  const prompt = `Gere uma FUNÇÃO TypeScript pura chamada exatamente \`mapStrapiToData(raw: Record<string, any>)\` que recebe os dados da Content API do Strapi e retorna um objeto com EXATAMENTE os mesmos exports (mesmas chaves e MESMO shape) do arquivo de dados abaixo.

REGRAS:
- A função retorna um objeto cujas chaves são os nomes dos \`export const\` do arquivo (ex.: site, services, projects…), cada um no MESMO formato que o arquivo original.
- \`raw\` tem uma chave por content-type (singularName): coleções são arrays de documentos; single types são um objeto. Documentos vêm no shape FLAT do Strapi 5 (campos no topo: documentId, e os atributos diretamente).
- Mapeie os campos do Strapi para os campos esperados pelo arquivo (casando por nome/significado). Para listas, use \`(raw.x ?? []).map(...)\`.
- IMAGENS: o campo pode ser objeto de mídia com \`.url\`, uma string, ou null. Use \`(doc?.campo?.url ?? doc?.campo)\` quando houver; SENÃO use o asset importado original como fallback. Assets importados disponíveis (use como variáveis): ${assetIds.join(', ') || '(nenhum)'}.
- DEFENSIVO (OBRIGATÓRIO — o SSR não pode quebrar): use SEMPRE optional chaining \`?.\` e defaults \`??\`. NUNCA chame métodos (\`.replace\`, \`.map\`, \`.split\`, etc.) em valores que possam ser null/undefined — guarde antes: \`(x ?? "").replace(...)\`, \`(arr ?? []).map(...)\`. Todo acesso a sub-campo deve tolerar ausência.
- Não invente conteúdo; campo ausente → default sensato (string vazia, array vazio, ou o fallback de imagem).
- ISOLAMENTO POR EXPORT (OBRIGATÓRIO): construa o resultado com CADA export no seu próprio try/catch, para que uma falha num export NÃO derrube os outros. Padrão EXATO:
  \`function mapStrapiToData(raw) { const out = {}; try { out.site = (/* ... */); } catch { out.site = {}; } try { out.services = (raw.service ?? []).map((s) => (/* ... */)); } catch { out.services = []; } /* ...um try/catch por export... */ return out; }\`
- Responda APENAS com o código da função (sem imports, sem markdown, sem exports — só \`function mapStrapiToData(raw) { ... }\`).

ARQUIVO DE DADOS ORIGINAL (shape alvo):
${baseSrc.length > MAX_FILE_CHARS ? baseSrc.slice(0, MAX_FILE_CHARS) : baseSrc}

AMOSTRA REAL DA RESPOSTA DO STRAPI (JSON, por singularName):
${JSON.stringify(sample, null, 1).slice(0, 18000)}`;
  const res = await fetch(OPENAI_URL, {
    method: 'POST',
    headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: MODEL,
      temperature: 0,
      messages: [
        { role: 'system', content: 'Você gera uma função pura de mapeamento Strapi→shape do frontend. Responde só com a função.' },
        { role: 'user', content: prompt },
      ],
    }),
  });
  if (!res.ok) throw new Error(await res.text());
  const json = (await res.json()) as any;
  return stripFence(json.choices?.[0]?.message?.content ?? '');
}

/** Identificadores de assets importados (p/ fallback de imagem no mapeador). */
export function assetImportIds(src: string): string[] {
  const ids: string[] = [];
  const re = /import\s+(\w+)\s+from\s+['"][^'"]+['"]/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(src))) ids.push(m[1]);
  return ids;
}

/**
 * Monta o módulo de dados AO VIVO: imports de assets (fallback) + client oficial
 * + mapeador + store + exports "vivos" (Proxy) + loadAllData/hydrate. Os
 * componentes seguem fazendo `import { site } from "@/data/site"` sem mudança; o
 * loader do root chama loadAllData({locale,status}) e hidrata antes do render.
 */
export function buildLiveDataModule(
  baseSrc: string,
  mapperCode: string,
  cts: { singularName: string; pluralName: string; kind: string }[],
  locales: string[],
  defLocale: string
): string {
  const imports = extractImports(baseSrc).split('\n').filter((l) => /@\/assets|\.(png|jpe?g|svg|webp|gif)/i.test(l)).join('\n');
  const names = exportNames(baseSrc);
  const ctMeta = JSON.stringify(cts.map((c) => ({ s: c.singularName, p: c.pluralName, k: c.kind })));
  // single types (ex.: home-content) viram exports camelCase (homeContent) com o
  // documento bruto traduzido — usados pelos componentes religados ao CMS.
  const camel = (s: string) => s.replace(/-+([a-zA-Z0-9])/g, (_m, c) => c.toUpperCase());
  const singleMap: Record<string, string> = {};
  // single types viram exports camelCase, EXCETO os que colidem com um export já
  // existente no data file (ex.: o single type `site` vs o export `site`) — esses
  // o mapeador já trata.
  for (const c of cts) {
    if (c.kind !== 'singleType') continue;
    const e = camel(c.singularName);
    if (names.includes(e)) continue;
    singleMap[c.singularName] = e;
  }
  const pageExports = Object.values(singleMap)
    .map((e) => `export const ${e}: any = __live(${JSON.stringify(e)});`)
    .join('\n');
  const liveExports =
    names.map((n) => `export const ${n}: any = __live(${JSON.stringify(n)});`).join('\n') +
    (pageExports ? '\n' + pageExports : '');
  return `// Live data from Strapi Content API (gerado pelo mcp-chat)
${imports}
import { fetchCollection, fetchSingle } from "./strapi-client";

const __cts = ${ctMeta};
const __single: Record<string, string> = ${JSON.stringify(singleMap)};
export const __availableLocales = ${JSON.stringify(locales)};
export const __defaultLocale = ${JSON.stringify(defLocale)};
/** Locale ativo a partir de ?locale/cookie (cliente) — p/ o seletor. */
export function __getLocale(): string {
  try {
    if (typeof window !== "undefined") {
      const u = new URL(window.location.href).searchParams.get("locale");
      if (u) return u;
      const m = document.cookie.match(/(?:^|;\\s*)site-locale=([^;]+)/);
      if (m) return decodeURIComponent(m[1]);
    }
  } catch {}
  return __defaultLocale;
}

${mapperCode}

const __store: Record<string, any> = {};
export function hydrate(d: any) { if (d) for (const k of Object.keys(d)) __store[k] = d[k]; }

export async function loadAllData(opts: { locale?: string; status?: "draft" | "published" } = {}) {
  const raw: Record<string, any> = {};
  await Promise.all(
    __cts.map(async (c: any) => {
      try {
        raw[c.s] = c.k === "singleType" ? await fetchSingle(c.s, opts) : await fetchCollection(c.p, opts);
      } catch {
        raw[c.s] = c.k === "singleType" ? null : [];
      }
    })
  );
  let data: any = {};
  try { data = mapStrapiToData(raw) || {}; }
  catch (e) { if (typeof console !== "undefined") console.error("[mcp-chat] mapStrapiToData falhou:", e); }
  hydrate(data);
  // expõe o conteúdo de página (single types) bruto/traduzido p/ os componentes.
  for (const s of Object.keys(__single)) __store[__single[s]] = raw[s] || {};
  return data;
}

// Exports "vivos": leem o store hidratado pelo loader (sem mudar os componentes).
function __live(key: string): any {
  return new Proxy(function () {} as any, {
    get(_t, p) {
      const v = __store[key];
      const r = v == null ? (Array.isArray(__fallback(key)) ? [] : undefined) : (v as any)[p as any];
      return typeof r === "function" ? r.bind(v) : r;
    },
    has(_t, p) { const v = __store[key]; return v != null && (p in (v as any)); },
    ownKeys() { const v = __store[key]; return v ? Reflect.ownKeys(v as any) : []; },
    getOwnPropertyDescriptor(_t, p) {
      const v = __store[key]; if (v == null) return undefined;
      const d = Object.getOwnPropertyDescriptor(v as any, p);
      if (d) (d as any).configurable = true;
      return d;
    },
  });
}
function __fallback(_k: string): any { return []; }

${liveExports}
`;
}

// ---------------------------------------------------------------------------
// injeção do seletor de idioma (LanguageSwitcher) + resolução isomórfica
// ---------------------------------------------------------------------------

/** Componente self-contained (sem libs externas) que troca o locale e recarrega. */
const switcherTsx = (dataImport: string) => `// Gerado pelo mcp-chat — seletor de idioma.
import { __availableLocales, __getLocale } from "${dataImport}";

const LABELS: Record<string, string> = {
  en: "EN", "pt-BR": "PT", pt: "PT", es: "ES", fr: "FR", de: "DE", it: "IT",
  nl: "NL", ja: "JA", ko: "KO", ru: "RU", ar: "AR", "zh-Hans": "ZH", zh: "ZH",
};

export function LanguageSwitcher() {
  if (!__availableLocales || __availableLocales.length < 2) return null;
  const current = __getLocale();
  const onChange = (e: any) => {
    const loc = e.target.value;
    try { document.cookie = "site-locale=" + loc + ";path=/;max-age=31536000"; } catch {}
    const u = new URL(window.location.href);
    u.searchParams.set("locale", loc);
    window.location.href = u.toString();
  };
  return (
    <select
      aria-label="Language"
      value={current}
      onChange={onChange}
      style={{
        border: "1px solid rgba(0,0,0,.15)", borderRadius: 9999, padding: "4px 10px",
        fontSize: 13, fontWeight: 600, background: "transparent", cursor: "pointer",
      }}
    >
      {__availableLocales.map((l: string) => (
        <option key={l} value={l}>{LABELS[l] || l.toUpperCase()}</option>
      ))}
    </select>
  );
}

export default LanguageSwitcher;
`;

/**
 * Liga o consumo ao vivo: no __root injeta um loader que chama loadAllData (busca
 * da Content API por locale/status e hidrata o store ANTES do render — isomórfico,
 * sem hydration mismatch) e renderiza o <LanguageSwitcher/> no Header.
 * `dataImport` é o specifier do módulo de dados (ex.: "@/data/site").
 */
function injectSwitcher(frontendDir: string, warnings: string[], dataImport = '@/data/site'): void {
  const compDir = path.join(frontendDir, 'src', 'components');
  fs.mkdirSync(compDir, { recursive: true });
  fs.writeFileSync(path.join(compDir, 'LanguageSwitcher.tsx'), switcherTsx(dataImport), 'utf8');

  // 1) __root: loader isomórfico que carrega os dados (locale/status) antes do render.
  const rootRel = ['src/routes/__root.tsx', 'src/routes/__root.jsx'].find((r) =>
    fs.existsSync(path.join(frontendDir, r))
  );
  if (rootRel) {
    const abs = path.join(frontendDir, rootRel);
    let src = fs.readFileSync(abs, 'utf8');
    if (!src.includes('loadAllData')) {
      src = `import { loadAllData } from "${dataImport}";\n` + src;
      const m = src.match(/createRootRoute\w*\s*(?:<[\s\S]*?>)?\s*\([\s\S]*?\)\s*\(\s*\{/);
      if (m) {
        const at = m.index! + m[0].length;
        src =
          src.slice(0, at) +
          `\n  validateSearch: (s: Record<string, unknown>) => ({ locale: typeof s.locale === "string" ? s.locale : undefined }),` +
          `\n  loaderDeps: ({ search }: any) => ({ locale: search.locale }),` +
          `\n  loader: async ({ deps }: any) => { const data = await loadAllData({ locale: deps?.locale }); return { data }; },` +
          src.slice(at);
      } else {
        warnings.push('não consegui injetar o loader no __root (padrão não encontrado).');
      }
      fs.writeFileSync(abs, src, 'utf8');
    }
  } else {
    warnings.push('__root não encontrado — dados ao vivo não ligados ao SSR.');
  }

  // 2) Header: renderizar o <LanguageSwitcher/>.
  const headerRel = ['src/components/Header.tsx', 'src/components/Header.jsx'].find((r) =>
    fs.existsSync(path.join(frontendDir, r))
  );
  if (headerRel) {
    const abs = path.join(frontendDir, headerRel);
    let src = fs.readFileSync(abs, 'utf8');
    if (!src.includes('LanguageSwitcher')) {
      src = `import { LanguageSwitcher } from "@/components/LanguageSwitcher";\n` + src;
      if (/<button[^>]*lg:hidden/.test(src)) {
        src = src.replace(/(\s*)(<button[^>]*lg:hidden)/, `$1<LanguageSwitcher />$1$2`);
      } else {
        src = src.replace(/<\/header>/, `  <LanguageSwitcher />\n    </header>`);
      }
      fs.writeFileSync(abs, src, 'utf8');
    }
  } else {
    warnings.push('Header não encontrado — adicione <LanguageSwitcher/> manualmente.');
  }
}

// ---------------------------------------------------------------------------
// religar componentes ao CMS (texto hardcoded → conteúdo do Strapi por locale)
// ---------------------------------------------------------------------------

const SYS_FIELDS = new Set(['id', 'documentId', 'createdAt', 'updatedAt', 'publishedAt', 'locale', 'slug', 'url']);

/** Mapa: valor-de-texto-EN → expressão JS (lê do export de conteúdo + fallback). */
function buildValueMap(
  sample: Record<string, any>,
  cts: { singularName: string; kind: string }[]
): Record<string, string> {
  const camel = (s: string) => s.replace(/-+([a-zA-Z0-9])/g, (_m, c) => c.toUpperCase());
  const map: Record<string, string> = {};
  for (const ct of cts) {
    if (ct.kind !== 'singleType') continue;
    const doc = sample[ct.singularName];
    if (!doc || typeof doc !== 'object') continue;
    const exp = camel(ct.singularName);
    for (const [field, val] of Object.entries(doc)) {
      if (SYS_FIELDS.has(field)) continue;
      if (typeof val !== 'string') continue;
      const v = val.trim();
      if (v.length < 4) continue; // muito curto/ambíguo
      if (/^https?:\/\//.test(v)) continue; // URLs
      if (map[v]) continue; // 1ª ocorrência vence
      map[v] = `${exp}?.${field} ?? ${JSON.stringify(v)}`;
    }
  }
  return map;
}

/** Religa UM componente: a IA troca os textos hardcoded pelas expressões do CMS. */
async function generateRewire(
  apiKey: string,
  src: string,
  subset: Record<string, string>,
  dataImport: string
): Promise<string> {
  const pairs = Object.entries(subset)
    .map(([v, expr]) => `- ${JSON.stringify(v)}  →  {${expr}}`)
    .join('\n');
  const prompt = `Religue este componente React/JSX ao CMS, trocando textos hardcoded por expressões que leem do Strapi (já localizadas).

MAPA (texto exato no arquivo → expressão a usar):
${pairs}

REGRAS ESTRITAS:
- Para CADA ocorrência EXATA de um texto do mapa, substitua pela expressão, no formato correto do contexto:
  • nó de texto JSX:  Texto  →  {EXPR}
  • atributo string:  attr="Texto"  →  attr={EXPR}
  • string JS usada como conteúdo:  "Texto"  →  (EXPR)
- A EXPR já tem fallback (?? "texto original"); use-a como veio (entre {} no JSX).
- Adicione os imports necessários no topo: importe os símbolos usados (ex.: ${dataImport.includes('~') ? '~' : '@'}/data/site). Os exports de conteúdo são camelCase (ex.: homeContent).
- NÃO altere mais NADA: estrutura, classes, lógica, imports existentes, nada fora do mapa.
- Responda APENAS com o arquivo final (sem markdown).

ARQUIVO:
${src.length > MAX_FILE_CHARS ? src.slice(0, MAX_FILE_CHARS) : src}`;
  const res = await fetch(OPENAI_URL, {
    method: 'POST',
    headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: MODEL,
      temperature: 0,
      messages: [
        { role: 'system', content: 'Você religa componentes ao CMS trocando só os textos do mapa por expressões. Responde só com o código.' },
        { role: 'user', content: prompt },
      ],
    }),
  });
  if (!res.ok) throw new Error(await res.text());
  const json = (await res.json()) as any;
  return stripFence(json.choices?.[0]?.message?.content ?? '');
}

/** Checa sintaxe de um .tsx/.ts. Usa esbuild se disponível; senão cai num
 *  heurístico de balanceamento (delimitadores + presença de export/JSX). */
async function syntaxOk(code: string): Promise<boolean> {
  let esbuild: any;
  try { esbuild = require('esbuild'); } catch { esbuild = null; }
  if (esbuild?.transform) {
    try { await esbuild.transform(code, { loader: 'tsx' }); return true; }
    catch { return false; }
  }
  // fallback: balanceamento de () {} [] fora de strings/comentários
  let depthC = 0, depthB = 0, depthP = 0, inStr: string | null = null, esc = false;
  for (let i = 0; i < code.length; i++) {
    const c = code[i];
    if (inStr) { if (esc) esc = false; else if (c === '\\') esc = true; else if (c === inStr) inStr = null; continue; }
    if (c === '"' || c === "'" || c === '`') inStr = c;
    else if (c === '{') depthC++; else if (c === '}') depthC--;
    else if (c === '[') depthB++; else if (c === ']') depthB--;
    else if (c === '(') depthP++; else if (c === ')') depthP--;
    if (depthC < 0 || depthB < 0 || depthP < 0) return false;
  }
  return depthC === 0 && depthB === 0 && depthP === 0 && /export\s/.test(code);
}

/** Religa todos os componentes que contêm textos do CMS. */
async function rewireComponents(
  strapi: any,
  opts: { frontendDir: string; sample: Record<string, any>; cts: any[]; apiKey: string; dataImport: string },
  warnings: string[]
): Promise<string[]> {
  const map = buildValueMap(opts.sample, opts.cts);
  if (!Object.keys(map).length) return [];
  const rewired: string[] = [];
  const files: string[] = [];
  walk(opts.frontendDir, opts.frontendDir, files);
  const targets = files.filter(
    (rel) =>
      /\.(tsx|jsx)$/.test(rel) &&
      !/__root|routeTree\.gen|\/api\/|LanguageSwitcher|PreviewBridge|\/ui\//.test(rel)
  );
  for (const rel of targets) {
    const abs = path.join(opts.frontendDir, rel);
    let src: string;
    try { src = fs.readFileSync(abs, 'utf8'); } catch { continue; }
    const subset: Record<string, string> = {};
    for (const [v, expr] of Object.entries(map)) if (src.includes(v)) subset[v] = expr;
    if (!Object.keys(subset).length) continue; // nada do CMS aqui
    try {
      const out = await generateRewire(opts.apiKey, src, subset, opts.dataImport);
      if (!out || out.length < 30) { warnings.push(`${rel}: rewire vazio, pulado.`); continue; }
      if (!(await syntaxOk(out))) { warnings.push(`${rel}: rewire com erro de sintaxe, mantido original.`); continue; }
      const bak = abs + '.bak';
      if (!fs.existsSync(bak)) fs.writeFileSync(bak, src, 'utf8');
      fs.writeFileSync(abs, out, 'utf8');
      rewired.push(rel);
    } catch (e: any) {
      warnings.push(`${rel}: rewire falhou (${e?.message ?? e}).`);
    }
  }
  return rewired;
}

export async function integrateFrontend(
  strapi: any,
  opts: { frontendDir: string; manifest: Manifest }
): Promise<IntegrateResult> {
  const result: IntegrateResult = {
    ok: false,
    filesRewritten: [],
    contentTypesFetched: [],
    warnings: [],
    errors: [],
  };

  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    result.errors.push('OPENAI_API_KEY não configurada no .env do Strapi.');
    return result;
  }

  const dataFiles = findDataFiles(opts.frontendDir);
  if (dataFiles.length === 0) {
    result.errors.push('Não encontrei um arquivo de dados para sincronizar (ex.: src/data/site.ts).');
    return result;
  }

  const { codes, def } = await getLocales(strapi);
  const locales = codes.length ? codes : [def];

  // metadados das content-types (singular/plural/kind) p/ o client oficial.
  const ctMeta = opts.manifest.contentTypes.map((ct) => ({
    singularName: ct.singularName,
    pluralName:
      strapi?.contentTypes?.[apiUid(ct.singularName)]?.info?.pluralName || `${ct.singularName}s`,
    kind: ct.kind,
  }));

  // amostra real (default) p/ a IA gerar o mapeador; também serve de contagem.
  const sample = await fetchSample(strapi, ctMeta);
  result.contentTypesFetched = ctMeta.map((c) => ({
    uid: apiUid(c.singularName),
    count: Array.isArray(sample[c.singularName]) ? sample[c.singularName].length : sample[c.singularName] ? 1 : 0,
  }));

  for (const rel of dataFiles) {
    const abs = path.join(opts.frontendDir, rel);
    try {
      const original = fs.readFileSync(abs, 'utf8');
      const bak = abs + '.bak';
      if (!fs.existsSync(bak)) fs.writeFileSync(bak, original, 'utf8');
      // estrutura-alvo SEMPRE do .bak (em re-runs o arquivo atual já é gerado).
      const baseSrc = fs.existsSync(bak) ? fs.readFileSync(bak, 'utf8') : original;

      // PADRÃO OFICIAL: gera o mapeador (Strapi→shape) 1x e monta o módulo que
      // consome a Content API ao vivo (@strapi/client) por locale/status.
      const mapper = await generateMapper(apiKey, baseSrc, sample, assetImportIds(baseSrc));
      if (!mapper || !/mapStrapiToData/.test(mapper)) {
        result.warnings.push(`${rel}: mapeador inválido, pulado.`);
        continue;
      }
      const moduleSrc = buildLiveDataModule(baseSrc, mapper, ctMeta, locales, def);
      fs.writeFileSync(abs, moduleSrc, 'utf8');
      result.filesRewritten.push(rel);
    } catch (e: any) {
      result.errors.push(`${rel}: ${e?.message ?? e}`);
    }
  }

  // client oficial + loader isomórfico (loadAllData) + seletor de idioma.
  if (result.filesRewritten.length > 0) {
    try {
      const rel0 = result.filesRewritten[0];
      const dataDir = path.dirname(path.join(opts.frontendDir, rel0));
      fs.writeFileSync(path.join(dataDir, 'strapi-client.ts'), STRAPI_CLIENT_TS, 'utf8');
      const dataImport = '@/' + rel0.replace(/^src\//, '').replace(/\.(tsx?|jsx?)$/, '');
      injectSwitcher(opts.frontendDir, result.warnings, dataImport);
      await ensureClientDep(opts.frontendDir, result.warnings);
      // religa os componentes ao CMS (texto hardcoded → conteúdo do Strapi por locale)
      try {
        const rewired = await rewireComponents(
          strapi,
          { frontendDir: opts.frontendDir, sample, cts: ctMeta, apiKey, dataImport },
          result.warnings
        );
        if (rewired.length) result.filesRewritten.push(...rewired);
      } catch (e: any) {
        result.warnings.push(`rewire: ${e?.message ?? e}`);
      }
    } catch (e: any) {
      result.warnings.push(`wiring: ${e?.message ?? e}`);
    }
  }

  result.ok = result.filesRewritten.length > 0;
  return result;
}
