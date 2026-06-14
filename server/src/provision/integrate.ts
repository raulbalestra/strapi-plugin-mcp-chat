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
  manifest: Manifest
): Promise<{ data: Record<string, any>; counts: { uid: string; count: number }[] }> {
  const data: Record<string, any> = {};
  const counts: { uid: string; count: number }[] = [];
  for (const ct of manifest.contentTypes) {
    const uid = apiUid(ct.singularName);
    try {
      if (ct.kind === 'singleType') {
        const doc = await strapi.documents(uid).findFirst({ status: 'published', populate: '*' });
        data[ct.singularName] = doc ?? null;
        counts.push({ uid, count: doc ? 1 : 0 });
      } else {
        const docs = await strapi.documents(uid).findMany({ status: 'published', populate: '*' });
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

// ---------------------------------------------------------------------------
// orquestração
// ---------------------------------------------------------------------------

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

  const { data, counts } = await fetchStrapiData(strapi, opts.manifest);
  result.contentTypesFetched = counts;

  for (const rel of dataFiles) {
    const abs = path.join(opts.frontendDir, rel);
    try {
      const original = fs.readFileSync(abs, 'utf8');
      const regenerated = await regenFile(apiKey, original, rel, data);
      if (!regenerated || regenerated.length < 20) {
        result.warnings.push(`${rel}: regeneração vazia, pulado.`);
        continue;
      }
      // backup do original (só na 1ª vez, para não perder o código-fonte real)
      const bak = abs + '.bak';
      if (!fs.existsSync(bak)) fs.writeFileSync(bak, original, 'utf8');
      fs.writeFileSync(abs, regenerated, 'utf8');
      result.filesRewritten.push(rel);
    } catch (e: any) {
      result.errors.push(`${rel}: ${e?.message ?? e}`);
    }
  }

  result.ok = result.filesRewritten.length > 0;
  return result;
}
