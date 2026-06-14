import fs from 'node:fs';
import path from 'node:path';

/**
 * Habilita i18n em content-types JÁ existentes, editando o(s) schema.json:
 * adiciona `pluginOptions.i18n.localized:true` no nível da CT e nos campos
 * traduzíveis. Necessário para traduzir conteúdo provisionado sem i18n.
 *
 * `uid` omitido (ou "*") → habilita em TODAS as content-types de src/api de uma
 * vez (um único restart). Senão, só na CT indicada.
 *
 * Travas (mesma filosofia do writer):
 *  - DEV-ONLY: só edita em NODE_ENV=development.
 *  - ADITIVO: apenas ACRESCENTA pluginOptions; nunca remove campos/altera tipos.
 *  - Não chama strapi.reload(): em dev, gravar o schema dispara o watcher.
 */

// Campos cujo conteúdo deve passar a variar por locale. Componentes e dynamic
// zones entram inteiros (o conteúdo textual aninhado segue o atributo de topo).
const LOCALIZABLE = ['string', 'text', 'richtext', 'component', 'dynamiczone'];
const isDev = () => process.env.NODE_ENV === 'development';

function schemaPathFor(apiRoot: string, uid: string): string | null {
  const m = /^api::([^.]+)\.([^.]+)$/.exec(uid);
  if (!m) return null;
  const [, api, ct] = m;
  return path.join(apiRoot, api, 'content-types', ct, 'schema.json');
}

/** Lista os uids de todas as content-types em src/api (api::<api>.<ct>). */
function listAllUids(apiRoot: string): string[] {
  const out: string[] = [];
  let apis: string[] = [];
  try {
    apis = fs.readdirSync(apiRoot);
  } catch {
    return out;
  }
  for (const api of apis) {
    const ctDir = path.join(apiRoot, api, 'content-types');
    if (!fs.existsSync(ctDir)) continue;
    for (const ct of fs.readdirSync(ctDir)) {
      if (fs.existsSync(path.join(ctDir, ct, 'schema.json'))) out.push(`api::${api}.${ct}`);
    }
  }
  return out;
}

const withLocalized = (obj: any) => ({
  ...(obj || {}),
  i18n: { ...((obj || {}).i18n || {}), localized: true },
});

/** Aplica localized:true (CT + campos) em UM schema.json. */
function patchOne(file: string, campos?: string[]): { campos: string[] } | { erro: string } {
  if (!fs.existsSync(file)) return { erro: `schema.json não encontrado (${file})` };
  let schema: any;
  try {
    schema = JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (e: any) {
    return { erro: `schema.json ilegível: ${e?.message ?? e}` };
  }
  schema.pluginOptions = withLocalized(schema.pluginOptions);
  const attrs = schema.attributes || {};
  const alvos =
    campos && campos.length
      ? campos
      : Object.keys(attrs).filter((k) => LOCALIZABLE.includes(attrs[k]?.type));
  const changed: string[] = [];
  for (const name of alvos) {
    if (!attrs[name]) continue;
    attrs[name].pluginOptions = withLocalized(attrs[name].pluginOptions);
    changed.push(name);
  }
  try {
    fs.writeFileSync(file, JSON.stringify(schema, null, 2) + '\n', 'utf8');
  } catch (e: any) {
    return { erro: `falha ao gravar schema.json: ${e?.message ?? e}` };
  }
  return { campos: changed };
}

export interface EnableI18nResult {
  ok?: boolean;
  uid?: string;
  campos?: string[];
  /** quando uid é omitido/"*": resumo por content-type. */
  contentTypes?: { uid: string; campos: string[] }[];
  total?: number;
  restart?: boolean;
  erro?: string;
}

export function enableI18n(opts: {
  strapi: any;
  uid?: string;
  campos?: string[];
  allowOutsideDev?: boolean;
}): EnableI18nResult {
  const { strapi, uid, campos, allowOutsideDev } = opts;
  if (!allowOutsideDev && !isDev()) {
    return { erro: 'habilitar i18n só é permitido em desenvolvimento (NODE_ENV=development).' };
  }
  const srcDir = strapi?.dirs?.app?.src || path.join(process.cwd(), 'src');
  const apiRoot = path.join(srcDir, 'api');

  // TODAS as content-types (uid omitido ou "*") — um único restart.
  if (!uid || uid === '*') {
    const uids = listAllUids(apiRoot);
    if (!uids.length) return { erro: `nenhuma content-type encontrada em ${apiRoot}` };
    const done: { uid: string; campos: string[] }[] = [];
    const errors: string[] = [];
    for (const u of uids) {
      const file = schemaPathFor(apiRoot, u)!;
      const r = patchOne(file, campos);
      if ('erro' in r) errors.push(`${u}: ${r.erro}`);
      else done.push({ uid: u, campos: r.campos });
    }
    if (!done.length) return { erro: `nada habilitado. ${errors.join('; ')}` };
    return { ok: true, contentTypes: done, total: done.length, restart: true };
  }

  // Uma content-type específica.
  const file = schemaPathFor(apiRoot, uid);
  if (!file) return { erro: `uid inválido: "${uid}" (esperado api::x.x)` };
  const r = patchOne(file, campos);
  if ('erro' in r) return { erro: r.erro };
  return { ok: true, uid, campos: r.campos, restart: true };
}
