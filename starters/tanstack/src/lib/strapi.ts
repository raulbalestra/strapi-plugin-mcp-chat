import type { Produto, StrapiResponse } from '~/strapi-types'

// Helper de acesso à REST API do Strapi 5.
// - VITE_STRAPI_URL é pública (import.meta.env), disponível no cliente e no servidor.
// - STRAPI_API_TOKEN é server-only (process.env); só existe dentro de loaders /
//   server functions, nunca é exposto ao navegador.

const STRAPI_URL = import.meta.env.VITE_STRAPI_URL ?? 'http://localhost:1337'

interface StrapiFetchOptions {
  /** Quando true, busca conteúdo em rascunho (status=draft). */
  draft?: boolean
}

export async function strapiFetch<T>(
  path: string,
  { draft = false }: StrapiFetchOptions = {},
): Promise<T> {
  const url = new URL(path.replace(/^\//, ''), `${STRAPI_URL}/`)
  url.searchParams.set('status', draft ? 'draft' : 'published')

  const headers: Record<string, string> = {}
  // process.env só está disponível no servidor; em código de cliente fica undefined.
  const token =
    typeof process !== 'undefined' ? process.env.STRAPI_API_TOKEN : undefined
  if (token) {
    headers.Authorization = `Bearer ${token}`
  }

  const res = await fetch(url.toString(), { headers })
  if (!res.ok) {
    throw new Error(`Strapi respondeu ${res.status} para ${url.pathname}`)
  }
  return (await res.json()) as T
}

export async function getProdutos(draft = false): Promise<Produto[]> {
  const json = await strapiFetch<StrapiResponse<Produto[]>>(
    '/api/produtos?populate=*',
    { draft },
  )
  return json.data
}

export async function getProdutoBySlug(
  slug: string,
  draft = false,
): Promise<Produto | null> {
  const query = `/api/produtos?filters[slug][$eq]=${encodeURIComponent(
    slug,
  )}&populate=*`
  const json = await strapiFetch<StrapiResponse<Produto[]>>(query, { draft })
  return json.data[0] ?? null
}
