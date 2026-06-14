import fs from 'node:fs';
import path from 'node:path';
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
  const m = s.match(/```(?:ts|tsx|typescript|js|jsx)?\s*([\s\S]*?)```/);
  return (m ? m[1] : s).trim();
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
// injeção do seletor de idioma (LanguageSwitcher) + resolução isomórfica
// ---------------------------------------------------------------------------

/** Componente self-contained (sem libs externas) que troca o locale e recarrega. */
const SWITCHER_TSX = `// Gerado pelo mcp-chat — seletor de idioma.
import { __availableLocales, __getLocale } from "@/data/site";

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

/** Resolve o locale a partir de ?locale ou do cookie (server + client). */
const LOCALE_INIT_TS = `// Gerado pelo mcp-chat — resolve o locale de ?locale/cookie e aplica.
import { __setLocale } from "@/data/site";

export function applyLocaleFromRequest(searchOrUrl?: any, cookieHeader?: string) {
  let loc: string | null = null;
  try {
    if (searchOrUrl && typeof searchOrUrl === "object" && searchOrUrl.locale) loc = String(searchOrUrl.locale);
  } catch {}
  if (!loc && typeof window !== "undefined") {
    try { loc = new URL(window.location.href).searchParams.get("locale"); } catch {}
    if (!loc) {
      const m = document.cookie.match(/(?:^|;\\s*)site-locale=([^;]+)/);
      if (m) loc = decodeURIComponent(m[1]);
    }
  }
  if (!loc && cookieHeader) {
    const m = cookieHeader.match(/(?:^|;\\s*)site-locale=([^;]+)/);
    if (m) loc = decodeURIComponent(m[1]);
  }
  __setLocale(loc);
  return loc;
}
`;

/** Injeta o switcher: cria os componentes e liga no __root + Header. */
function injectSwitcher(frontendDir: string, warnings: string[]): void {
  const compDir = path.join(frontendDir, 'src', 'components');
  fs.mkdirSync(compDir, { recursive: true });
  fs.writeFileSync(path.join(compDir, 'LanguageSwitcher.tsx'), SWITCHER_TSX, 'utf8');
  fs.writeFileSync(path.join(frontendDir, 'src', 'data', 'locale-init.ts'), LOCALE_INIT_TS, 'utf8');

  // 1) __root: aplicar o locale ANTES de renderizar (isomórfico) via beforeLoad.
  const rootCandidates = ['src/routes/__root.tsx', 'src/routes/__root.jsx'];
  const rootRel = rootCandidates.find((r) => fs.existsSync(path.join(frontendDir, r)));
  if (rootRel) {
    const abs = path.join(frontendDir, rootRel);
    let src = fs.readFileSync(abs, 'utf8');
    if (!src.includes('applyLocaleFromRequest')) {
      src = `import { applyLocaleFromRequest } from "@/data/locale-init";\n` + src;
      // injeta beforeLoad logo após a abertura das opções da rota raiz
      const m = src.match(/createRootRoute\w*\s*(?:<[\s\S]*?>)?\s*\([\s\S]*?\)\s*\(\s*\{/);
      if (m) {
        const at = m.index! + m[0].length;
        src =
          src.slice(0, at) +
          `\n  validateSearch: (s: Record<string, unknown>) => ({ locale: typeof s.locale === "string" ? s.locale : undefined }),\n  beforeLoad: ({ search }: any) => { applyLocaleFromRequest(search); },` +
          src.slice(at);
      } else {
        warnings.push('não consegui injetar beforeLoad no __root (padrão não encontrado).');
      }
      fs.writeFileSync(abs, src, 'utf8');
    }
  } else {
    warnings.push('__root não encontrado — switcher não ligado ao SSR.');
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
      // injeta antes do botão de menu mobile (presente na maioria dos headers);
      // senão, antes do fechamento do </header>.
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
  const multi = codes.length > 1;

  // dados do Strapi no locale default → regenera a estrutura canônica do arquivo.
  const { data: defData, counts } = await fetchStrapiData(strapi, opts.manifest, multi ? def : undefined);
  result.contentTypesFetched = counts;

  for (const rel of dataFiles) {
    const abs = path.join(opts.frontendDir, rel);
    try {
      const original = fs.readFileSync(abs, 'utf8');
      const bak = abs + '.bak';
      // backup do original (só na 1ª vez, para não perder o código-fonte real)
      if (!fs.existsSync(bak)) fs.writeFileSync(bak, original, 'utf8');
      // SEMPRE regenera a partir da estrutura pristina (o .bak), pois em re-runs
      // o arquivo atual já pode ser o módulo multi-locale gerado.
      const baseSrc = fs.existsSync(bak) ? fs.readFileSync(bak, 'utf8') : original;

      // 1) regenera o arquivo no locale default (estrutura + dados do Strapi)
      const defFile = await regenFile(apiKey, baseSrc, rel, defData);
      if (!defFile || defFile.length < 20) {
        result.warnings.push(`${rel}: regeneração vazia, pulado.`);
        continue;
      }

      if (!multi) {
        fs.writeFileSync(abs, defFile, 'utf8');
        result.filesRewritten.push(rel);
        continue;
      }

      // 2) MULTI-LOCALE: traduz o bloco default p/ cada outro locale (prompt
      //    pequeno = confiável, sem truncar) e combina num módulo com exports
      //    "vivos" + seletor de idioma.
      const perLocale: Record<string, string> = { [def]: defFile };
      for (const loc of codes) {
        if (loc === def) continue;
        try {
          const t = await translateDataFile(apiKey, defFile, LANG_NAMES[loc] || loc);
          if (t && t.length >= 20) perLocale[loc] = t;
          else result.warnings.push(`${rel}: tradução vazia p/ ${loc}, usando default.`);
        } catch (e: any) {
          result.warnings.push(`${rel}: tradução ${loc} falhou (${e?.message ?? e}).`);
        }
      }
      const moduleSrc = buildMultiLocaleModule(perLocale, def);
      fs.writeFileSync(abs, moduleSrc, 'utf8');
      result.filesRewritten.push(rel);
    } catch (e: any) {
      result.errors.push(`${rel}: ${e?.message ?? e}`);
    }
  }

  // injeta o seletor de idioma quando há >1 locale
  if (multi && result.filesRewritten.length > 0) {
    try {
      injectSwitcher(opts.frontendDir, result.warnings);
    } catch (e: any) {
      result.warnings.push(`switcher: ${e?.message ?? e}`);
    }
  }

  result.ok = result.filesRewritten.length > 0;
  return result;
}
