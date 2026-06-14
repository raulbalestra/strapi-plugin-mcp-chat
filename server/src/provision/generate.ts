import type { Manifest, ManifestContentType, ManifestAttribute } from './manifest';

/**
 * Gerador: manifest -> arquivos que a Strapi 5 espera em src/api/<api>/.
 *
 * Funções PURAS, sem efeito colateral: recebem o manifest já validado e
 * devolvem um mapa { caminho relativo -> conteúdo }. Quem escreve no disco é o
 * writer (separado), o que torna o gerador 100% testável e o dry-run trivial.
 *
 * O formato espelha exatamente o que o Content-Type Builder da Strapi gera
 * (conferido contra schema.json reais), para nunca produzir um schema que a
 * Strapi recuse.
 */

// ---------------------------------------------------------------------------
// helpers de nome
// ---------------------------------------------------------------------------

/** Pluralização simples (en/pt). O manifest pode sobrescrever via pluralName. */
export function toPlural(singular: string): string {
  if (/[^aeiou]y$/i.test(singular)) return singular.replace(/y$/i, 'ies');
  if (/(s|x|z|ch|sh)$/i.test(singular)) return `${singular}es`;
  return `${singular}s`;
}

/** kebab/hífen -> snake_case (collectionName é snake plural). */
function toSnake(s: string): string {
  return s.replace(/-/g, '_');
}

/** "post-blog" -> "Post Blog" */
function toTitle(s: string): string {
  return s
    .split('-')
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ');
}

/** UID Strapi de uma content-type pelo singularName: api::produto.produto */
export function apiUid(singularName: string): string {
  return `api::${singularName}.${singularName}`;
}

// ---------------------------------------------------------------------------
// atributos
// ---------------------------------------------------------------------------

/**
 * pluginOptions.i18n.localized:true para um campo, quando o manifest pediu.
 * Formato idêntico ao do Content-Type Builder. Relações e uid são localizados
 * automaticamente pelo i18n, então não recebem este bloco.
 */
function i18nField(attr: ManifestAttribute): Record<string, any> {
  return (attr as any).localized
    ? { pluginOptions: { i18n: { localized: true } } }
    : {};
}

function buildAttribute(attr: ManifestAttribute): Record<string, any> {
  switch (attr.type) {
    case 'uid':
      return clean({
        type: 'uid',
        targetField: attr.targetField,
        required: attr.required,
      });

    case 'enumeration':
      return clean({
        type: 'enumeration',
        ...i18nField(attr),
        enum: attr.enum,
        required: attr.required,
        unique: attr.unique,
        private: attr.private,
        default: attr.default,
      });

    case 'media':
      return clean({
        type: 'media',
        multiple: attr.multiple ?? false,
        required: attr.required,
        allowedTypes: attr.allowedTypes,
      });

    case 'relation':
      // Unidirecional de propósito: sem mappedBy/inversedBy. Relações bidirecionais
      // exigem o campo-par no outro lado e são a causa nº1 de schema quebrado.
      return {
        type: 'relation',
        relation: attr.relation,
        target: apiUid(attr.target),
      };

    default:
      // escalares (string, text, integer, boolean, date, json, ...)
      return clean({
        type: attr.type,
        ...i18nField(attr),
        required: (attr as any).required,
        unique: (attr as any).unique,
        private: (attr as any).private,
        default: (attr as any).default,
      });
  }
}

/** remove chaves undefined para o JSON ficar limpo como o da Strapi. */
function clean<T extends Record<string, any>>(obj: T): T {
  for (const k of Object.keys(obj)) if (obj[k] === undefined) delete obj[k];
  return obj;
}

// ---------------------------------------------------------------------------
// schema.json
// ---------------------------------------------------------------------------

export function buildSchema(ct: ManifestContentType): Record<string, any> {
  const pluralName = ct.pluralName ?? toPlural(ct.singularName);
  const attributes: Record<string, any> = {};
  for (const [key, attr] of Object.entries(ct.attributes)) {
    attributes[key] = buildAttribute(attr);
  }
  return clean({
    kind: ct.kind,
    collectionName: toSnake(pluralName),
    info: {
      singularName: ct.singularName,
      pluralName,
      displayName: ct.displayName ?? toTitle(ct.singularName),
      description: ct.description ?? '',
    },
    options: {
      draftAndPublish: ct.draftAndPublish,
    },
    // Nível CT é obrigatório p/ o i18n reconhecer a content-type como localizada
    // (@strapi/i18n: isLocalizedContentType lê pluginOptions.i18n.localized).
    pluginOptions: (ct as any).localized
      ? { i18n: { localized: true } }
      : undefined,
    attributes,
  });
}

// ---------------------------------------------------------------------------
// arquivos de fábrica (controller / route / service)
// ---------------------------------------------------------------------------

// O UID é castado para `any` de propósito: no momento em que estes arquivos são
// gerados e a Strapi reinicia, os tipos gerados (types/generated) ainda podem não
// conter o novo UID, e o `strapi develop` falharia a compilação TS. O cast desacopla
// o boot do timing do typegen — "nunca quebra". Em runtime o factory recebe a string
// normalmente; após o typegen incluir o type, o cast fica inócuo.
function controllerFile(singular: string): string {
  return `/**
 * ${singular} controller
 */
import { factories } from '@strapi/strapi';

export default factories.createCoreController('${apiUid(singular)}' as any);
`;
}

function routeFile(singular: string): string {
  return `/**
 * ${singular} router
 */
import { factories } from '@strapi/strapi';

export default factories.createCoreRouter('${apiUid(singular)}' as any);
`;
}

function serviceFile(singular: string): string {
  return `/**
 * ${singular} service
 */
import { factories } from '@strapi/strapi';

export default factories.createCoreService('${apiUid(singular)}' as any);
`;
}

// ---------------------------------------------------------------------------
// saída
// ---------------------------------------------------------------------------

export interface GeneratedApi {
  singularName: string;
  uid: string;
  /** caminhos relativos a src/api -> conteúdo do arquivo */
  files: Record<string, string>;
}

/** Gera os 4 arquivos de uma content-type, com caminhos relativos a src/api. */
export function generateApi(ct: ManifestContentType): GeneratedApi {
  const s = ct.singularName;
  const base = s; // nome da pasta da api = singularName
  return {
    singularName: s,
    uid: apiUid(s),
    files: {
      [`${base}/content-types/${s}/schema.json`]:
        JSON.stringify(buildSchema(ct), null, 2) + '\n',
      [`${base}/controllers/${s}.ts`]: controllerFile(s),
      [`${base}/routes/${s}.ts`]: routeFile(s),
      [`${base}/services/${s}.ts`]: serviceFile(s),
    },
  };
}

/** Gera todas as content-types do manifest. */
export function generateAll(manifest: Manifest): GeneratedApi[] {
  return manifest.contentTypes.map(generateApi);
}
