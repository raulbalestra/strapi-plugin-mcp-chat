import fs from 'node:fs';
import path from 'node:path';
import type { Manifest } from './manifest';
import { apiUid } from './generate';

/**
 * "Wire": liga o frontend à Strapi por FETCH AO VIVO (modelo live-fetch).
 *
 * Em vez do snapshot (integrate, que reescreve arquivos de dados), aqui:
 *  1) Geramos uma camada de dados DETERMINÍSTICA e SEM dependências externas
 *     (só React): src/lib/strapi.ts + src/hooks/useStrapi.ts. REST puro, flat,
 *     sem populate/nesting — chamadas leves.
 *  2) Religamos os componentes via IA, arquivo a arquivo, trocando o conteúdo
 *     hardcoded por leitura da Strapi COM fallback no texto original. Cada
 *     arquivo é salvo como .bak antes, e só é gravado se passar numa checagem de
 *     sanidade — se algo sair estranho, o arquivo é DEIXADO como estava. Assim o
 *     frontend nunca deixa de compilar por nossa causa.
 *
 * NUNCA toca na Strapi (só escreve no frontendDir, validado). No pior caso,
 * algum componente fica sem religar (ainda hardcoded) — nada quebra.
 */

const OPENAI_URL = 'https://api.openai.com/v1/chat/completions';
const MODEL = process.env.OPENAI_CHAT_MODEL || 'gpt-4o';

const SKIP_DIRS = new Set([
  'node_modules', '.git', 'dist', '.next', '.output', '.vinxi', '.tanstack',
  'build', 'coverage', '.turbo', '.cache', 'public',
]);

export interface WireResult {
  ok: boolean;
  dataLayer: string[];
  componentsWired: string[];
  componentsSkipped: { rel: string; reason: string }[];
  warnings: string[];
  errors: string[];
}

// ---------------------------------------------------------------------------
// util
// ---------------------------------------------------------------------------

function ensureInside(base: string, target: string): boolean {
  const b = path.resolve(base);
  const t = path.resolve(target);
  return t === b || t.startsWith(b + path.sep);
}

function isNext(manifest: Manifest): boolean {
  return manifest.framework === 'next';
}

/** Detecta se o projeto usa o alias "@/..." (tsconfig/jsconfig paths). */
function usesAtAlias(frontendDir: string): boolean {
  for (const f of ['tsconfig.json', 'tsconfig.app.json', 'jsconfig.json']) {
    try {
      const c = fs.readFileSync(path.join(frontendDir, f), 'utf8');
      if (/"@\/\*"\s*:/.test(c)) return true;
    } catch { /* ignore */ }
  }
  return false;
}

// ---------------------------------------------------------------------------
// 1) camada de dados (determinística, sem dependências além do React)
// ---------------------------------------------------------------------------

function strapiClientSrc(manifest: Manifest): string {
  const envExpr = isNext(manifest)
    ? "(typeof process !== 'undefined' ? process.env.NEXT_PUBLIC_STRAPI_URL : undefined)"
    : "(import.meta as any).env?.VITE_STRAPI_URL";
  return `// Gerado pelo mcp-chat — camada de acesso à Strapi (REST, flat, sem nesting).
// Não edite à mão: é regenerado ao religar o frontend.
export const STRAPI_URL =
  (${envExpr} || "http://localhost:1337").replace(/\\/$/, "");

export type PreviewMode = { isPreview: boolean; status: "draft" | "published" };

/** Lê o modo de preview da URL (?preview=1 / ?status=draft). */
export function getPreviewMode(): PreviewMode {
  if (typeof window === "undefined") return { isPreview: false, status: "published" };
  const p = new URLSearchParams(window.location.search);
  const status = p.get("status");
  const isPreview = p.get("preview") === "1" || p.has("preview") || status === "draft";
  return { isPreview, status: status === "draft" || isPreview ? "draft" : "published" };
}

/** Busca um singleType e devolve só os atributos (objeto). null em erro. */
export async function fetchSection<T = Record<string, any>>(
  name: string,
  status: "draft" | "published" = "published"
): Promise<T | null> {
  const qs = status === "draft" ? "?status=draft" : "";
  try {
    const res = await fetch(\`\${STRAPI_URL}/api/\${name}\${qs}\`);
    if (!res.ok) return null;
    const json = await res.json();
    return (json?.data ?? null) as T | null;
  } catch {
    return null;
  }
}

/** Busca uma collection (lista) pelo nome plural; ordena por sortOrder se existir. */
export async function fetchCollection<T = Record<string, any>>(
  pluralName: string,
  status: "draft" | "published" = "published"
): Promise<T[]> {
  const qs = new URLSearchParams({ "sort": "sortOrder:asc", "pagination[pageSize]": "100" });
  if (status === "draft") qs.set("status", "draft");
  try {
    const res = await fetch(\`\${STRAPI_URL}/api/\${pluralName}?\${qs.toString()}\`);
    if (!res.ok) return [];
    const json = await res.json();
    return (Array.isArray(json?.data) ? json.data : []) as T[];
  } catch {
    return [];
  }
}
`;
}

function hooksSrc(manifest: Manifest, libImport: string): string {
  const clientDirective = isNext(manifest) ? `"use client";\n\n` : '';
  return `${clientDirective}// Gerado pelo mcp-chat — hooks de leitura da Strapi (sem dependências além do React).
// Em modo preview faz polling curto + refetch via postMessage (reflete edições ao vivo).
import { useEffect, useState } from "react";
import { fetchSection, fetchCollection, getPreviewMode } from "${libImport}";

export function useSection<T = Record<string, any>>(name: string): Partial<T> {
  const [data, setData] = useState<Partial<T>>({});
  useEffect(() => {
    let alive = true;
    const { isPreview, status } = getPreviewMode();
    const load = () => fetchSection<T>(name, status).then((d) => { if (alive && d) setData(d as Partial<T>); });
    load();
    if (!isPreview) return () => { alive = false; };
    const id = window.setInterval(load, 2500);
    const onMsg = () => load();
    window.addEventListener("message", onMsg);
    return () => { alive = false; window.clearInterval(id); window.removeEventListener("message", onMsg); };
  }, [name]);
  return data;
}

export function useCollection<T = Record<string, any>>(pluralName: string): T[] {
  const [data, setData] = useState<T[]>([]);
  useEffect(() => {
    let alive = true;
    const { isPreview, status } = getPreviewMode();
    const load = () => fetchCollection<T>(pluralName, status).then((d) => { if (alive) setData(d); });
    load();
    if (!isPreview) return () => { alive = false; };
    const id = window.setInterval(load, 2500);
    const onMsg = () => load();
    window.addEventListener("message", onMsg);
    return () => { alive = false; window.clearInterval(id); window.removeEventListener("message", onMsg); };
  }, [pluralName]);
  return data;
}
`;
}

/** Escreve a camada de dados. Determinístico e seguro (arquivos novos). */
function writeDataLayer(frontendDir: string, manifest: Manifest, dryRun?: boolean): string[] {
  const written: string[] = [];
  const libDir = path.join(frontendDir, 'src', 'lib');
  const hooksDir = path.join(frontendDir, 'src', 'hooks');
  const libFile = path.join(libDir, 'strapi.ts');
  const hooksFile = path.join(hooksDir, 'useStrapi.ts');
  if (!ensureInside(frontendDir, libFile) || !ensureInside(frontendDir, hooksFile)) {
    throw new Error('camada de dados fora do frontendDir');
  }
  const libImport = usesAtAlias(frontendDir) ? '@/lib/strapi' : '../lib/strapi';
  if (!dryRun) {
    fs.mkdirSync(libDir, { recursive: true });
    fs.mkdirSync(hooksDir, { recursive: true });
    fs.writeFileSync(libFile, strapiClientSrc(manifest), 'utf8');
    fs.writeFileSync(hooksFile, hooksSrc(manifest, libImport), 'utf8');
  }
  written.push('src/lib/strapi.ts', 'src/hooks/useStrapi.ts');
  return written;
}

// ---------------------------------------------------------------------------
// 2) religação dos componentes (IA, com .bak + checagem de sanidade)
// ---------------------------------------------------------------------------

const CODE_EXT = new Set(['.tsx', '.jsx']);
const MAX_COMPONENT_CHARS = 16000;

function walkComponents(dir: string, base: string, out: string[]) {
  let entries: fs.Dirent[];
  try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
  for (const e of entries) {
    if (e.name.startsWith('.')) continue;
    const full = path.join(dir, e.name);
    if (e.isDirectory()) {
      if (SKIP_DIRS.has(e.name) || e.name === 'ui') continue; // pula primitivos shadcn/ui
      walkComponents(full, base, out);
    } else if (CODE_EXT.has(path.extname(e.name))) {
      out.push(path.relative(base, full));
    }
  }
}

/** pluralName REAL da content-type (Strapi sabe pluralizar); fallback +s. */
function resolvePlural(strapi: any, singularName: string): string {
  const real = strapi?.contentTypes?.[apiUid(singularName)]?.info?.pluralName;
  return real || `${singularName}s`;
}

/** Resumo do modelo de conteúdo (tipos + campos) para orientar a IA. */
function contentModelSummary(strapi: any, manifest: Manifest): string {
  const lines: string[] = [];
  for (const ct of manifest.contentTypes) {
    const fields = Object.keys(ct.attributes || {}).join(', ');
    if (ct.kind === 'singleType') {
      lines.push(`singleType "${ct.singularName}" (useSection("${ct.singularName}")) campos: ${fields}`);
    } else {
      const plural = resolvePlural(strapi, ct.singularName);
      lines.push(`collection "${ct.singularName}" (useCollection("${plural}")) campos: ${fields}`);
    }
  }
  return lines.join('\n');
}

function wirePrompt(rel: string, source: string, model: string, hooksImport: string, seedSnippet: string): string {
  return `Você religa um componente React para ler o conteúdo da Strapi, SEM quebrar nada.

MODELO DE CONTEÚDO (use EXATAMENTE estes nomes de hook/campo):
${model}

DADOS SEMEADOS (para casar o texto hardcoded com o campo certo):
${seedSnippet}

REGRAS (siga à risca):
- Importe os hooks de "${hooksImport}" (ex.: import { useSection, useCollection } from "${hooksImport}";).
- Dentro do componente, chame os hooks necessários (ex.: const hero = useSection("hero-section-content");).
- Troque CADA texto hardcoded que casa com um campo por { obj.campo ?? "TEXTO ORIGINAL" } — SEMPRE mantenha o texto original como fallback no ?? .
- Para listas (arrays hardcoded de objetos), troque o array por useCollection(...) e itere sobre ele; mantenha ícones/imagens/classes/animacoes/layout EXATAMENTE como estão (não são conteúdo).
- NÃO altere imports de ícones/assets, JSX estrutural, classes Tailwind, hooks de animação, nada que não seja texto/dado.
- NÃO invente campos nem textos. Se um trecho não casa com nenhum campo, deixe como está.
- Mantenha o arquivo VÁLIDO e COMPLETO (TypeScript/TSX que compila). Responda com JSON: {"code":"<arquivo .tsx completo>"} e NADA além disso.

ARQUIVO: ${rel}
\`\`\`tsx
${source}
\`\`\``;
}

/**
 * Validação de sintaxe REAL via esbuild (presente em projetos Strapi/Vite).
 * Retorna a mensagem de erro se NÃO parsear, '' se parsear, ou null se o esbuild
 * não estiver disponível (aí caímos só na checagem heurística).
 */
function syntaxError(code: string): string | null {
  let esbuild: any;
  try {
    // resolve do node_modules do host (o bundle é --packages=external).
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    esbuild = require('esbuild');
  } catch {
    return null; // sem esbuild → não dá pra validar aqui
  }
  try {
    esbuild.transformSync(code, { loader: 'tsx', jsx: 'automatic' });
    return '';
  } catch (e: any) {
    return (e?.message || 'erro de sintaxe').split('\n')[0];
  }
}

/** Checagem de sanidade leve (sem AST): evita gravar lixo. */
function looksSane(original: string, next: string, hooksImport: string): string | null {
  if (!next || next.length < 40) return 'saída vazia/curta demais';
  if (next.length < original.length * 0.5) return 'saída muito menor que o original (possível truncamento)';
  if (!/export\s+default|export\s+function|export\s+const/.test(next)) return 'sem export';
  if (!next.includes(hooksImport)) return 'não importou os hooks';
  const balanced = (s: string, a: string, b: string) =>
    (s.split(a).length - 1) === (s.split(b).length - 1);
  if (!balanced(next, '{', '}')) return 'chaves desbalanceadas';
  if (!balanced(next, '(', ')')) return 'parênteses desbalanceados';
  if (!balanced(next, '[', ']')) return 'colchetes desbalanceados';
  // não pode ter sobrado cerca de código markdown
  if (/```/.test(next)) return 'markdown na saída';
  return null;
}

async function callOpenAI(apiKey: string, prompt: string): Promise<string> {
  const res = await fetch(OPENAI_URL, {
    method: 'POST',
    headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: MODEL,
      temperature: 0,
      response_format: { type: 'json_object' },
      messages: [
        { role: 'system', content: 'Você religa componentes React para a Strapi e responde só com JSON {"code": "..."} válido.' },
        { role: 'user', content: prompt },
      ],
    }),
  });
  if (!res.ok) throw new Error(`OpenAI: ${await res.text()}`);
  const data = await res.json();
  const raw = JSON.parse(data.choices?.[0]?.message?.content ?? '{}');
  return typeof raw.code === 'string' ? raw.code : '';
}

// ---------------------------------------------------------------------------
// orquestração
// ---------------------------------------------------------------------------

export async function wireFrontend(
  _strapi: any,
  opts: { frontendDir: string; manifest: Manifest; dryRun?: boolean }
): Promise<WireResult> {
  const { frontendDir, manifest } = opts;
  const result: WireResult = {
    ok: false, dataLayer: [], componentsWired: [], componentsSkipped: [], warnings: [], errors: [],
  };

  if (!path.isAbsolute(frontendDir)) { result.errors.push('frontendDir deve ser absoluto'); return result; }

  // 1) camada de dados (sempre — determinística e segura)
  try {
    result.dataLayer = writeDataLayer(frontendDir, manifest, opts.dryRun);
  } catch (e: any) {
    result.errors.push(`camada de dados: ${e?.message ?? e}`);
    return result; // sem a camada, não adianta religar
  }

  // 2) religação dos componentes (best-effort, com .bak + sanidade)
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    result.warnings.push('Sem OPENAI_API_KEY: camada de dados criada, mas os componentes NÃO foram religados (precisa da chave).');
    result.ok = true;
    return result;
  }

  const srcDir = path.join(frontendDir, 'src');
  const all: string[] = [];
  walkComponents(srcDir, frontendDir, all);
  const components = all.filter((rel) => /(\/|^)(components|pages|app|routes)(\/|$)/.test(rel.replace(/\\/g, '/')));

  const model = contentModelSummary(_strapi, manifest);
  const hooksImport = usesAtAlias(frontendDir) ? '@/hooks/useStrapi' : '../hooks/useStrapi';
  const seedSnippet = JSON.stringify(manifest.seed ?? []).slice(0, 6000);

  for (const rel of components) {
    const abs = path.join(frontendDir, rel);
    if (!ensureInside(frontendDir, abs)) continue;
    let source: string;
    try { source = fs.readFileSync(abs, 'utf8'); } catch { continue; }
    if (source.length > MAX_COMPONENT_CHARS) { result.componentsSkipped.push({ rel, reason: 'arquivo grande demais' }); continue; }
    // já religado? pula.
    if (source.includes('useStrapi')) { result.componentsSkipped.push({ rel, reason: 'já religado' }); continue; }

    // valida: heurística + sintaxe real (esbuild). Se falhar, 1 retry pedindo correção.
    const check = (code: string): string | null => {
      const h = looksSane(source, code, hooksImport);
      if (h) return h;
      const s = syntaxError(code); // '' ok, null = sem esbuild, string = erro
      return s ? `sintaxe: ${s}` : null;
    };

    try {
      const prompt = wirePrompt(rel, source, model, hooksImport, seedSnippet);
      let next = await callOpenAI(apiKey, prompt);
      let bad = check(next);
      if (bad) {
        // retry único, devolvendo o erro pra IA corrigir.
        const fix = `${prompt}\n\nA sua tentativa anterior foi REJEITADA por: ${bad}. Corrija e responda só com o JSON {"code":"..."} do arquivo completo e válido.`;
        const next2 = await callOpenAI(apiKey, fix);
        const bad2 = check(next2);
        if (bad2) { result.componentsSkipped.push({ rel, reason: bad2 }); continue; }
        next = next2;
      }
      if (!opts.dryRun) {
        const bak = abs + '.bak';
        if (!fs.existsSync(bak)) fs.writeFileSync(bak, source, 'utf8');
        fs.writeFileSync(abs, next, 'utf8');
      }
      result.componentsWired.push(rel);
    } catch (e: any) {
      result.componentsSkipped.push({ rel, reason: `IA: ${e?.message ?? e}` });
    }
  }

  result.ok = true;
  return result;
}
