import { strapi } from '@strapi/client'
import type { Produto } from '~/strapi-types'

/**
 * Acesso à Content API do Strapi 5 pelo client OFICIAL `@strapi/client`.
 *
 * - `VITE_STRAPI_URL` é pública (import.meta.env; cliente e servidor).
 * - `STRAPI_API_TOKEN` é server-only e OPCIONAL (leitura pública via permissões).
 * - Suporta `locale` (i18n) e `draft` (Draft & Publish → status).
 */

const STRAPI_URL = import.meta.env.VITE_STRAPI_URL ?? 'http://localhost:1337'
const API_TOKEN =
  typeof process !== 'undefined' ? process.env.STRAPI_API_TOKEN : undefined

const client = strapi({
  baseURL: `${STRAPI_URL.replace(/\/$/, '')}/api`,
  ...(API_TOKEN ? { auth: API_TOKEN } : {}),
})

export interface QueryOptions {
  /** Draft Mode → status=draft; senão status=published. */
  draft?: boolean
  /** Locale i18n (ex.: "pt-BR"). Omitido = locale default. */
  locale?: string
}

const baseParams = ({ draft, locale }: QueryOptions) => ({
  populate: '*' as const,
  status: (draft ? 'draft' : 'published') as 'draft' | 'published',
  ...(locale ? { locale } : {}),
})

export async function getProdutos(draft = false, locale?: string): Promise<Produto[]> {
  const r = await client.collection('produtos').find(baseParams({ draft, locale }))
  return ((r as any).data ?? []) as Produto[]
}

export async function getProdutoBySlug(
  slug: string,
  draft = false,
  locale?: string,
): Promise<Produto | null> {
  const r = await client.collection('produtos').find({
    ...baseParams({ draft, locale }),
    filters: { slug: { $eq: slug } },
  })
  return (((r as any).data ?? [])[0] ?? null) as Produto | null
}

/** Resolve a URL absoluta de uma mídia do Strapi (que pode vir relativa). */
export function mediaUrl(url?: string | null): string | null {
  if (!url) return null
  if (url.startsWith('http://') || url.startsWith('https://')) return url
  return `${STRAPI_URL}${url}`
}
