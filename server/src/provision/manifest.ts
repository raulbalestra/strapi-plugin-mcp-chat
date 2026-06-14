import { z } from '@strapi/utils';

/**
 * O CONTRATO.
 *
 * Todo frontend "abençoado" (Next ou TanStack) traz um `strapi.manifest.json`
 * na raiz. O plugin NUNCA executa código vindo do upload — ele apenas lê e
 * valida este manifest com o schema abaixo e, a partir dele, provisiona o
 * backend (gera content-types, semeia conteúdo, liga o preview).
 *
 * Validar aqui, ANTES de tocar no disco, é o que torna o upload seguro e
 * previsível ("nunca quebra"). Tudo que não casar com o schema é rejeitado
 * com uma mensagem clara, e nada é escrito.
 */

// ---------------------------------------------------------------------------
// Nomes seguros
// ---------------------------------------------------------------------------

/** kebab-case, começa com letra, sem colidir com termos reservados da Strapi. */
const kebab = z
  .string()
  .min(1)
  .max(48)
  .regex(/^[a-z][a-z0-9-]*$/, 'use kebab-case (ex.: "produto", "post-blog")');

/** identificador de atributo: snake/camel simples, sem espaços. */
const attrKey = z
  .string()
  .min(1)
  .max(48)
  .regex(/^[a-zA-Z][a-zA-Z0-9_]*$/, 'nome de campo inválido (use letras/números/_)');

/** Campos que a Strapi cria sozinha — o manifest não pode redefinir. */
const RESERVED_ATTRS = new Set([
  'id',
  'documentId',
  'createdAt',
  'updatedAt',
  'publishedAt',
  'createdBy',
  'updatedBy',
  'locale',
  'localizations',
]);

// ---------------------------------------------------------------------------
// Atributos (subconjunto seguro do Strapi 5 — fase 1)
// Componentes e dynamic zones ficam para a fase 2.
// ---------------------------------------------------------------------------

const SCALAR_TYPES = [
  'string',
  'text',
  'richtext',
  'blocks',
  'email',
  'integer',
  'biginteger',
  'float',
  'decimal',
  'boolean',
  'date',
  'datetime',
  'time',
  'json',
] as const;

const commonOpts = {
  required: z.boolean().optional(),
  unique: z.boolean().optional(),
  private: z.boolean().optional(),
  default: z.union([z.string(), z.number(), z.boolean()]).optional(),
  /**
   * Marca o campo como traduzível por locale (i18n). Opt-in: ausente ⇒ o campo
   * é compartilhado entre locales (comportamento atual). Vira
   * `pluginOptions.i18n.localized:true` no schema gerado. Só faz efeito se a
   * própria content-type também tiver `localized:true`.
   */
  localized: z.boolean().optional(),
};

const scalarAttr = z.object({
  type: z.enum(SCALAR_TYPES),
  ...commonOpts,
});

/** uid: precisa apontar para um campo string da mesma content-type. */
const uidAttr = z.object({
  type: z.literal('uid'),
  targetField: attrKey.optional(),
  required: z.boolean().optional(),
});

const enumAttr = z.object({
  type: z.literal('enumeration'),
  enum: z.array(z.string().min(1)).min(1),
  ...commonOpts,
});

const mediaAttr = z.object({
  type: z.literal('media'),
  multiple: z.boolean().optional(),
  allowedTypes: z
    .array(z.enum(['images', 'videos', 'files', 'audios']))
    .optional(),
  required: z.boolean().optional(),
});

const RELATION_KINDS = [
  'oneToOne',
  'oneToMany',
  'manyToOne',
  'manyToMany',
] as const;

/**
 * Relação: `target` deve ser o singularName de OUTRA content-type declarada
 * neste mesmo manifest (validado no refinamento global abaixo). Mantemos as
 * relações internas ao manifest para garantir que nada aponte para um type
 * inexistente — uma das fontes clássicas de "schema quebrado".
 */
const relationAttr = z.object({
  type: z.literal('relation'),
  relation: z.enum(RELATION_KINDS),
  target: kebab,
  required: z.boolean().optional(),
});

const attribute = z.union([
  scalarAttr,
  uidAttr,
  enumAttr,
  mediaAttr,
  relationAttr,
]);

export type ManifestAttribute = z.infer<typeof attribute>;

// ---------------------------------------------------------------------------
// Content-type
// ---------------------------------------------------------------------------

const contentType = z
  .object({
    singularName: kebab,
    pluralName: kebab.optional(),
    displayName: z.string().min(1).max(64).optional(),
    kind: z.enum(['collectionType', 'singleType']).default('collectionType'),
    draftAndPublish: z.boolean().default(true),
    /**
     * Liga a localização (i18n) na content-type. Necessário no nível da CT
     * (confirmado em @strapi/i18n: `isLocalizedContentType` checa
     * `pluginOptions.i18n.localized`). Os campos a traduzir devem marcar
     * `localized:true` individualmente.
     */
    localized: z.boolean().optional(),
    description: z.string().max(255).optional(),
    attributes: z
      .record(attrKey, attribute)
      .refine((attrs) => Object.keys(attrs).length > 0, {
        message: 'a content-type precisa de pelo menos 1 campo',
      })
      .refine(
        (attrs) => Object.keys(attrs).every((k) => !RESERVED_ATTRS.has(k)),
        { message: 'um campo usa nome reservado da Strapi (ex.: id, createdAt)' }
      ),
    /**
     * Rota do frontend usada para o preview, com placeholders de campo entre
     * dois-pontos. Ex.: "/produtos/:slug". O adapter de cada framework usa isso
     * para montar a URL de preview no PreviewPanel.
     */
    preview: z
      .object({
        route: z
          .string()
          .startsWith('/', 'a rota de preview deve começar com "/"'),
      })
      .optional(),
  })
  // uid.targetField precisa existir e ser string/text
  .superRefine((ct, ctx) => {
    for (const [key, attr] of Object.entries(ct.attributes)) {
      if (attr.type === 'uid' && attr.targetField) {
        const target = ct.attributes[attr.targetField];
        if (!target) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: `uid "${key}" aponta para campo inexistente "${attr.targetField}"`,
          });
        } else if (!['string', 'text'].includes((target as any).type)) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: `uid "${key}" deve apontar para um campo string/text`,
          });
        }
      }
    }
  });

export type ManifestContentType = z.infer<typeof contentType>;

// ---------------------------------------------------------------------------
// Manifest raiz
// ---------------------------------------------------------------------------

export const FRAMEWORKS = ['next', 'tanstack'] as const;
export type Framework = (typeof FRAMEWORKS)[number];

export const manifestSchema = z
  .object({
    /** versão do formato do manifest, não do app. */
    manifestVersion: z.literal(1).default(1),
    name: kebab,
    framework: z.enum(FRAMEWORKS),
    strapiVersion: z.string().optional(),
    contentTypes: z.array(contentType).min(1).max(60),
    /** dados demo opcionais, semeados via Document Service após o restart. */
    seed: z
      .array(
        z.object({
          uid: z.string().optional(), // resolvido pelo provisionador
          singularName: kebab,
          entries: z.array(z.record(z.string(), z.any())).max(500),
        })
      )
      .optional(),
    /** nomes de env vars que o frontend espera (o adapter escreve o .env). */
    env: z.array(z.string()).optional(),
  })
  // nenhum singularName repetido + relações apontam para types existentes
  .superRefine((m, ctx) => {
    const names = m.contentTypes.map((c) => c.singularName);
    const seen = new Set<string>();
    for (const n of names) {
      if (seen.has(n)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `content-type duplicada: "${n}"`,
        });
      }
      seen.add(n);
    }
    const known = new Set(names);
    for (const ct of m.contentTypes) {
      for (const [key, attr] of Object.entries(ct.attributes)) {
        if (attr.type === 'relation' && !known.has(attr.target)) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: `relação "${ct.singularName}.${key}" aponta para "${attr.target}", que não está no manifest`,
          });
        }
      }
    }
  });

export type Manifest = z.infer<typeof manifestSchema>;

// ---------------------------------------------------------------------------
// Validador público
// ---------------------------------------------------------------------------

export type ValidationResult =
  | { ok: true; data: Manifest }
  | { ok: false; errors: string[] };

/**
 * Valida um manifest cru (objeto JS já parseado de JSON). Retorna ou os dados
 * já normalizados (defaults aplicados), ou uma lista de erros legíveis. Esta é
 * a única porta de entrada: o provisionador só roda com `ok: true`.
 */
export function validateManifest(raw: unknown): ValidationResult {
  const parsed = manifestSchema.safeParse(raw);
  if (parsed.success) return { ok: true, data: parsed.data };

  const errors = parsed.error.issues.map((i) => {
    const path = i.path.length ? `${i.path.join('.')}: ` : '';
    return `${path}${i.message}`;
  });
  return { ok: false, errors };
}
