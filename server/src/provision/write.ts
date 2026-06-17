import fs from 'node:fs';
import path from 'node:path';
import type { GeneratedApi } from './generate';

/**
 * Writer: grava no disco os arquivos que o gerador produziu.
 *
 * Três travas de segurança, nessa ordem:
 *  1. DEV-ONLY  — só escreve em NODE_ENV=development (o Content-Type Builder da
 *     Strapi também só opera em dev; gerar schema em prod é proibido).
 *  2. ADITIVO   — se a pasta da api já existe, a content-type inteira é PULADA.
 *     Nunca sobrescrevemos nem alteramos types existentes → zero risco de perda
 *     de dados.
 *  3. DRY-RUN   — calcula o plano completo sem tocar no disco.
 *
 * A reinicialização (para a Strapi reconhecer os novos types) é responsabilidade
 * separada — ver requestReload().
 */

export interface WriteOptions {
  /** caminho absoluto para src/api da app Strapi. */
  apiRoot: string;
  /** se true, não escreve nada — só devolve o plano. */
  dryRun?: boolean;
  /**
   * pula a trava dev-only. Use APENAS em testes; em produção o controller
   * nunca passa isto.
   */
  allowOutsideDev?: boolean;
}

export interface SkippedApi {
  singularName: string;
  reason: string;
}

export interface WriteResult {
  ok: boolean;
  dryRun: boolean;
  /** caminhos (relativos a apiRoot) que foram/serão escritos. */
  planned: string[];
  written: string[];
  /** content-types puladas por já existirem (proteção aditiva). */
  skipped: SkippedApi[];
  errors: string[];
}

function isDev(): boolean {
  return process.env.NODE_ENV === 'development';
}

// Tipos de atributo que a Strapi 5 aceita num schema.json. Um type fora desta
// lista faz a Strapi recusar o boot — então validamos ANTES de escrever.
const KNOWN_ATTR_TYPES = new Set([
  'string', 'text', 'richtext', 'blocks', 'email', 'password', 'uid', 'enumeration',
  'json', 'integer', 'biginteger', 'decimal', 'float', 'date', 'time', 'datetime',
  'timestamp', 'boolean', 'media', 'relation', 'component', 'dynamiczone',
]);

/**
 * Valida o conteúdo de um schema.json gerado contra o formato que a Strapi 5
 * exige. Retorna a lista de erros (vazia = ok). É a trava que garante que uma
 * provisão NUNCA escreva um schema que impeça o Strapi de bootar.
 */
function validateApi(api: GeneratedApi): string[] {
  const errs: string[] = [];
  const rel = Object.keys(api.files).find((r) => r.endsWith('schema.json'));
  if (!rel) {
    errs.push(`${api.singularName}: schema.json ausente nos arquivos gerados`);
    return errs;
  }
  let schema: any;
  try {
    schema = JSON.parse(api.files[rel]);
  } catch (e: any) {
    errs.push(`${api.singularName}: schema.json não é JSON válido (${e?.message ?? e})`);
    return errs;
  }
  if (schema?.kind !== 'collectionType' && schema?.kind !== 'singleType') {
    errs.push(`${api.singularName}: "kind" inválido (${schema?.kind})`);
  }
  if (!schema?.info?.singularName || !schema?.info?.pluralName) {
    errs.push(`${api.singularName}: info.singularName/pluralName obrigatórios`);
  }
  const attrs = schema?.attributes;
  if (!attrs || typeof attrs !== 'object') {
    errs.push(`${api.singularName}: "attributes" ausente ou inválido`);
  } else {
    for (const [name, a] of Object.entries(attrs) as any[]) {
      if (!a || typeof a !== 'object' || !a.type) {
        errs.push(`${api.singularName}.${name}: atributo sem "type"`);
      } else if (!KNOWN_ATTR_TYPES.has(a.type)) {
        errs.push(`${api.singularName}.${name}: type desconhecido "${a.type}"`);
      } else if (a.type === 'relation' && !a.target) {
        errs.push(`${api.singularName}.${name}: relation sem "target"`);
      } else if (a.type === 'component' && !a.component) {
        errs.push(`${api.singularName}.${name}: component sem "component"`);
      }
    }
  }
  return errs;
}

/**
 * Escreve as content-types geradas em src/api. Aditivo e idempotente: o que já
 * existe é preservado e reportado em `skipped`.
 */
export function writeApis(
  apis: GeneratedApi[],
  opts: WriteOptions
): WriteResult {
  const result: WriteResult = {
    ok: false,
    dryRun: !!opts.dryRun,
    planned: [],
    written: [],
    skipped: [],
    errors: [],
  };

  // Trava 1: dev-only
  if (!opts.allowOutsideDev && !isDev()) {
    result.errors.push(
      'Geração de content-types só é permitida em desenvolvimento (NODE_ENV=development). ' +
        'Em produção, gere os types em dev e faça deploy do código.'
    );
    return result;
  }

  if (!path.isAbsolute(opts.apiRoot)) {
    result.errors.push(`apiRoot deve ser um caminho absoluto: ${opts.apiRoot}`);
    return result;
  }

  // ── Validação ALL-OR-NOTHING (antes de tocar no disco) ──────────────────────
  // Só serão escritas as apis que ainda não existem (trava aditiva). Validamos
  // TODAS elas; se UMA for inválida, não escrevemos NENHUMA — assim uma provisão
  // jamais pode deixar o Strapi com um schema quebrado e sem bootar.
  const toWrite = apis.filter((api) => !fs.existsSync(path.join(opts.apiRoot, api.singularName)));
  const knownSingulars = new Set<string>([
    ...apis.map((a) => a.singularName),
    ...(fs.existsSync(opts.apiRoot)
      ? fs.readdirSync(opts.apiRoot, { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => d.name)
      : []),
  ]);
  const validationErrors: string[] = [];
  for (const api of toWrite) {
    validationErrors.push(...validateApi(api));
    // relações: o target (api::<s>.<s>) precisa existir (gerado agora ou já no disco)
    const rel = Object.keys(api.files).find((r) => r.endsWith('schema.json'));
    if (rel) {
      try {
        const attrs = JSON.parse(api.files[rel])?.attributes || {};
        for (const [name, a] of Object.entries(attrs) as any[]) {
          if (a?.type === 'relation' && typeof a.target === 'string') {
            const tgt = a.target.split('::')[1]?.split('.')[0];
            if (tgt && !knownSingulars.has(tgt)) {
              validationErrors.push(`${api.singularName}.${name}: relation aponta para "${a.target}" inexistente`);
            }
          }
        }
      } catch {
        /* já reportado por validateApi */
      }
    }
  }
  if (validationErrors.length) {
    result.errors.push(
      'Schema gerado inválido — nada foi escrito (provisão abortada com segurança):',
      ...validationErrors
    );
    return result;
  }

  for (const api of apis) {
    const apiDir = path.join(opts.apiRoot, api.singularName);

    // Trava 2: aditivo — nunca toca em api existente
    if (fs.existsSync(apiDir)) {
      result.skipped.push({
        singularName: api.singularName,
        reason: `já existe em ${path.relative(opts.apiRoot, apiDir)} — preservado`,
      });
      continue;
    }

    for (const [rel, content] of Object.entries(api.files)) {
      const full = path.join(opts.apiRoot, rel);

      // defesa extra: o caminho final tem que ficar DENTRO de apiRoot
      const normalized = path.normalize(full);
      if (
        normalized !== opts.apiRoot &&
        !normalized.startsWith(opts.apiRoot + path.sep)
      ) {
        result.errors.push(`caminho fora de apiRoot bloqueado: ${rel}`);
        continue;
      }

      result.planned.push(rel);

      if (opts.dryRun) continue;

      try {
        fs.mkdirSync(path.dirname(full), { recursive: true });
        fs.writeFileSync(full, content, 'utf8');
        result.written.push(rel);
      } catch (e: any) {
        result.errors.push(`falha ao escrever ${rel}: ${e?.message ?? e}`);
      }
    }
  }

  result.ok = result.errors.length === 0;
  return result;
}

/**
 * Pede para a Strapi recarregar, de modo que os novos content-types passem a
 * existir. Em dev, escrever em src/ já dispara o watcher; chamar reload() torna
 * o efeito determinístico. Isolado aqui para o controller decidir quando chamar
 * (normalmente após responder ao cliente, para não cortar a resposta).
 */
export function requestReload(strapi: any): void {
  if (typeof strapi?.reload === 'function') {
    strapi.reload();
  }
}
