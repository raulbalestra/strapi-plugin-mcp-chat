import type {
  Manifest,
  ManifestContentType,
  ManifestAttribute,
} from './manifest';

/**
 * Gera tipos TypeScript a partir do manifest, para o frontend consumir o
 * @strapi/client com type-safety. Determinístico (não precisa do schema vivo),
 * o que mantém o gerador testável e desacoplado do boot da Strapi.
 *
 * Mapeia os tipos do manifest para TS, respeitando required (opcional vs não),
 * relações (objeto único vs array) e mídia.
 */

function toPascal(singular: string): string {
  return singular
    .split('-')
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join('');
}

function scalarToTs(type: string): string {
  switch (type) {
    case 'string':
    case 'text':
    case 'richtext':
    case 'blocks':
    case 'email':
    case 'uid':
    case 'date':
    case 'datetime':
    case 'time':
      return 'string';
    case 'integer':
    case 'biginteger':
    case 'float':
    case 'decimal':
      return 'number';
    case 'boolean':
      return 'boolean';
    case 'json':
      return 'unknown';
    default:
      return 'unknown';
  }
}

/** tipo TS do atributo + se é opcional (sem `required`). */
function attrToTs(
  attr: ManifestAttribute,
  pascalOf: (singular: string) => string
): { tsType: string; optional: boolean } {
  switch (attr.type) {
    case 'enumeration':
      return {
        tsType: attr.enum.map((e) => JSON.stringify(e)).join(' | '),
        optional: !attr.required,
      };
    case 'media':
      return {
        tsType: attr.multiple ? 'StrapiMedia[]' : 'StrapiMedia',
        optional: !attr.required,
      };
    case 'relation': {
      const target = pascalOf(attr.target);
      const many = attr.relation === 'oneToMany' || attr.relation === 'manyToMany';
      return { tsType: many ? `${target}[]` : target, optional: true };
    }
    case 'uid':
      return { tsType: 'string', optional: !attr.required };
    default:
      return {
        tsType: scalarToTs(attr.type),
        optional: !(attr as any).required,
      };
  }
}

function buildInterface(ct: ManifestContentType): string {
  const name = ct.displayName
    ? toPascal(ct.singularName)
    : toPascal(ct.singularName);
  const lines: string[] = [`export interface ${name} {`];
  // campos padrão da Strapi 5
  lines.push('  documentId: string;');
  for (const [key, attr] of Object.entries(ct.attributes)) {
    const { tsType, optional } = attrToTs(attr, toPascal);
    lines.push(`  ${key}${optional ? '?' : ''}: ${tsType};`);
  }
  lines.push('  createdAt: string;');
  lines.push('  updatedAt: string;');
  lines.push('  publishedAt?: string;');
  lines.push('}');
  return lines.join('\n');
}

const PREAMBLE = `// Tipos gerados automaticamente a partir do strapi.manifest.json.
// NÃO edite à mão — rode o link novamente para regenerar.

export interface StrapiMedia {
  id: number;
  documentId: string;
  url: string;
  alternativeText?: string;
  width?: number;
  height?: number;
  mime?: string;
  name?: string;
}
`;

/** Gera o conteúdo do arquivo de tipos (ex.: strapi-types.ts) do frontend. */
export function generateTypes(manifest: Manifest): string {
  const interfaces = manifest.contentTypes.map(buildInterface).join('\n\n');
  return `${PREAMBLE}\n${interfaces}\n`;
}
