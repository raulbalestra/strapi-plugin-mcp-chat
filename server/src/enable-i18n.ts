import fs from 'node:fs';
import path from 'node:path';

/**
 * Habilita i18n numa content-type JÁ existente, editando seu schema.json:
 * adiciona `pluginOptions.i18n.localized:true` no nível da CT e nos campos
 * textuais (ou nos `campos` indicados). Necessário para traduzir conteúdo que
 * foi provisionado antes do suporte a i18n (ex.: o site atual).
 *
 * Travas (mesma filosofia do writer):
 *  - DEV-ONLY: só edita em NODE_ENV=development.
 *  - ADITIVO: apenas ACRESCENTA pluginOptions; nunca remove campos/altera tipos.
 *  - Não chama strapi.reload(): em dev, gravar o schema dispara o watcher e a
 *    Strapi reinicia sozinha (evita o double-restart que derruba o worker).
 */

const TEXTUAL = ['string', 'text', 'richtext'];
const isDev = () => process.env.NODE_ENV === 'development';

function schemaPathFor(apiRoot: string, uid: string): string | null {
  const m = /^api::([^.]+)\.([^.]+)$/.exec(uid);
  if (!m) return null;
  const [, api, ct] = m;
  return path.join(apiRoot, api, 'content-types', ct, 'schema.json');
}

const withLocalized = (obj: any) => ({
  ...(obj || {}),
  i18n: { ...((obj || {}).i18n || {}), localized: true },
});

export interface EnableI18nResult {
  ok?: boolean;
  uid?: string;
  campos?: string[];
  restart?: boolean;
  erro?: string;
}

export function enableI18n(opts: {
  strapi: any;
  uid: string;
  campos?: string[];
  allowOutsideDev?: boolean;
}): EnableI18nResult {
  const { strapi, uid, campos, allowOutsideDev } = opts;
  if (!allowOutsideDev && !isDev()) {
    return { erro: 'habilitar i18n só é permitido em desenvolvimento (NODE_ENV=development).' };
  }
  const srcDir = strapi?.dirs?.app?.src || path.join(process.cwd(), 'src');
  const apiRoot = path.join(srcDir, 'api');
  const file = schemaPathFor(apiRoot, uid);
  if (!file) return { erro: `uid inválido: "${uid}" (esperado api::x.x)` };
  if (!fs.existsSync(file)) return { erro: `schema.json não encontrado para ${uid} (${file})` };

  let schema: any;
  try {
    schema = JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (e: any) {
    return { erro: `schema.json ilegível: ${e?.message ?? e}` };
  }

  // Nível CT (obrigatório para o i18n reconhecer a content-type).
  schema.pluginOptions = withLocalized(schema.pluginOptions);

  const attrs = schema.attributes || {};
  const alvos =
    campos && campos.length
      ? campos
      : Object.keys(attrs).filter((k) => TEXTUAL.includes(attrs[k]?.type));
  const changed: string[] = [];
  for (const name of alvos) {
    const a = attrs[name];
    if (!a) continue;
    a.pluginOptions = withLocalized(a.pluginOptions);
    changed.push(name);
  }

  try {
    fs.writeFileSync(file, JSON.stringify(schema, null, 2) + '\n', 'utf8');
  } catch (e: any) {
    return { erro: `falha ao gravar schema.json: ${e?.message ?? e}` };
  }
  return { ok: true, uid, campos: changed, restart: true };
}
